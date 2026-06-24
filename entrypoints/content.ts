export default defineContentScript({
  matches: ['https://gemini.google.com/*'],
  main() {
    console.log('[Gemini MD] Content script iniciado.');

    // ─── Estado global ────────────────────────────────────────────────────────
    let lastSnapshotText  = '';          // Último texto capturado
    let lastChangeTime    = Date.now();  // Cuando cambió por última vez
    let pendingDownload   = false;       // Flag para evitar descargas dobles
    let initialMarkTimestamp = Date.now(); // Para ignorar respuestas anteriores al inicio

    // ─── Obtener el panel de respuestas del modelo ────────────────────────────
    // Intentar múltiples selectores en orden de prioridad
    function getResponsePanel(): HTMLElement | null {
      const candidates = [
        '.conversation-container',
        'chat-history',
        'chat-window',
        '.chat-history',
        'main',
        'body',
      ];
      for (const sel of candidates) {
        const el = document.querySelector(sel);
        if (el) return el as HTMLElement;
      }
      return document.body;
    }

    // ─── Obtener el último bloque de respuesta del modelo ────────────────────
    function getLatestModelResponse(): HTMLElement | null {
      // Selectores en orden de especificidad
      const selectors = [
        'model-response',
        '.model-response',
        '[data-test-id="model-response"]',
        'response-container',
        '.response-container',
        'message-content',
        '[data-test-id="message-content"]',
        'structured-content-container',
        '.structured-content-container',
        '.model-response-text',
      ];

      for (const sel of selectors) {
        const all = document.querySelectorAll(sel);
        if (all.length > 0) {
          return all[all.length - 1] as HTMLElement;
        }
      }

      // Fallback: buscar el último párrafo dentro de divs con role=presentation o similares
      const allTurns = document.querySelectorAll('[class*="response"], [class*="model"], [class*="assistant"]');
      if (allTurns.length > 0) {
        return allTurns[allTurns.length - 1] as HTMLElement;
      }

      return null;
    }

    // ─── Obtener la fuente HTML para convertir ────────────────────────────────
    // Intenta primero el contenedor .markdown, si no hay usa el bloque completo
    function getMarkdownSource(responseEl: HTMLElement): HTMLElement {
      const candidates = [
        '.markdown.markdown-main-panel',
        '.markdown-main-panel',
        '.markdown',
        '[class*="markdown"]',
        '[class*="response-text"]',
        '.model-response-text',
      ];
      for (const sel of candidates) {
        const found = responseEl.querySelector(sel);
        if (found && (found.textContent || '').trim().length > 0) {
          return found as HTMLElement;
        }
      }
      return responseEl;
    }

    // ─── Comprobar si la IA está generando actualmente ────────────────────────
    function isGenerating(): boolean {
      // 1. Botón de detener visible
      const stopBtn = document.querySelector(
        '[aria-label*="Stop" i], [aria-label*="Detener" i], [aria-label*="Cancelar" i], [aria-label*="Parar" i]'
      );
      if (stopBtn && isVisible(stopBtn as HTMLElement)) return true;

      // 2. Indicador de carga visible
      const loader = document.querySelector('.processing-state-visible, [class*="loading"], [class*="spinner"], [class*="thinking"]');
      if (loader && isVisible(loader as HTMLElement)) return true;

      return false;
    }

    function isVisible(el: HTMLElement): boolean {
      return !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
    }

    // ─── Ciclo principal de monitoreo ─────────────────────────────────────────
    function checkForCompletion() {
      // No hacer nada si ya hay una descarga pendiente
      if (pendingDownload) return;

      const responseEl = getLatestModelResponse();
      if (!responseEl) return;

      const currentText = (responseEl.textContent || '').trim();

      // Ignorar si está vacío
      if (currentText.length < 10) return;

      const now = Date.now();

      // Si el texto cambió, actualizar timestamp
      if (currentText !== lastSnapshotText) {
        lastSnapshotText = currentText;
        lastChangeTime   = now;
        return; // Todavía cambia — esperar
      }

      // Calcular cuánto tiempo lleva sin cambiar
      const stableMs = now - lastChangeTime;

      // Si el texto lleva menos de 2.5 segundos sin cambiar, esperar
      if (stableMs < 2500) return;

      // Si aún está generando según la UI, esperar
      if (isGenerating()) return;

      // Si el elemento ya fue procesado, ignorar
      if ((responseEl as HTMLElement).dataset.geminiProcessed === 'true') return;

      // ✅ La respuesta está completa y estable — iniciar descarga
      (responseEl as HTMLElement).dataset.geminiProcessed = 'true';
      pendingDownload = true;

      console.log('[Gemini MD] Respuesta estable detectada. Convirtiendo a Markdown...');

      const source   = getMarkdownSource(responseEl);
      const mdText   = cleanMarkdown(convertHtmlToMarkdown(source));
      const filename = generateFilename(mdText);

      console.log('[Gemini MD] Enviando para descarga:', filename);

      browser.runtime.sendMessage({
        type: 'DOWNLOAD_MARKDOWN',
        content: mdText,
        filename: filename,
      }).catch((err) => {
        console.error('[Gemini MD] Error al enviar mensaje:', err);
      });

      // Resetear para la próxima respuesta tras 3 segundos
      setTimeout(() => {
        pendingDownload   = false;
        lastSnapshotText  = '';
        console.log('[Gemini MD] Listo para la próxima respuesta.');
      }, 3000);
    }

    // ─── Observador de mutaciones ─────────────────────────────────────────────
    const observer = new MutationObserver(() => {
      checkForCompletion();
    });

    observer.observe(document.body, {
      childList:     true,
      subtree:       true,
      characterData: true,
    });

    // ─── Intervalo de respaldo cada 1 segundo ─────────────────────────────────
    setInterval(checkForCompletion, 1000);

    // ─── Resetear al cambiar de URL (nueva conversación) ─────────────────────
    let lastUrl = location.href;
    setInterval(() => {
      if (location.href !== lastUrl) {
        lastUrl          = location.href;
        lastSnapshotText = '';
        lastChangeTime   = Date.now();
        pendingDownload  = false;
        console.log('[Gemini MD] Nueva URL — estado reiniciado.');
      }
    }, 500);
  },
});

// ─── Conversión HTML → Markdown ───────────────────────────────────────────────

function convertHtmlToMarkdown(element: Node): string {
  let md = '';
  for (const child of Array.from(element.childNodes)) {
    if (child.nodeType === Node.TEXT_NODE) {
      md += child.textContent;
    } else if (child.nodeType === Node.ELEMENT_NODE) {
      const el  = child as HTMLElement;
      const tag = el.tagName.toLowerCase();
      switch (tag) {
        case 'h1': md += `\n\n# ${convertHtmlToMarkdown(el).trim()}\n\n`; break;
        case 'h2': md += `\n\n## ${convertHtmlToMarkdown(el).trim()}\n\n`; break;
        case 'h3': md += `\n\n### ${convertHtmlToMarkdown(el).trim()}\n\n`; break;
        case 'h4': md += `\n\n#### ${convertHtmlToMarkdown(el).trim()}\n\n`; break;
        case 'h5': md += `\n\n##### ${convertHtmlToMarkdown(el).trim()}\n\n`; break;
        case 'h6': md += `\n\n###### ${convertHtmlToMarkdown(el).trim()}\n\n`; break;
        case 'p':  md += `\n\n${convertHtmlToMarkdown(el).trim()}\n\n`; break;
        case 'br': md += '\n'; break;
        case 'strong':
        case 'b':  md += `**${convertHtmlToMarkdown(el)}**`; break;
        case 'em':
        case 'i':  md += `*${convertHtmlToMarkdown(el)}*`; break;
        case 'code': {
          const isBlock = el.parentElement?.tagName.toLowerCase() === 'pre';
          md += isBlock ? convertHtmlToMarkdown(el) : ` \`${el.textContent}\` `;
          break;
        }
        case 'pre': {
          const codeEl  = el.querySelector('code');
          const classes = [
            ...Array.from(codeEl?.classList ?? []),
            ...Array.from(el.classList),
          ];
          const langCls = classes.find(c => c.startsWith('language-'));
          const lang    = langCls ? langCls.replace('language-', '') : '';
          const content = (codeEl ?? el).textContent ?? '';
          md += `\n\n\`\`\`${lang}\n${content}\n\`\`\`\n\n`;
          break;
        }
        case 'ul': md += `\n${convertList(el, false)}\n`; break;
        case 'ol': md += `\n${convertList(el, true)}\n`;  break;
        case 'a': {
          const href = el.getAttribute('href') ?? '';
          md += `[${convertHtmlToMarkdown(el)}](${href})`;
          break;
        }
        case 'hr': md += '\n\n---\n\n'; break;
        case 'blockquote': md += `\n\n> ${convertHtmlToMarkdown(el).trim().replace(/\n/g, '\n> ')}\n\n`; break;
        default:   md += convertHtmlToMarkdown(el); break;
      }
    }
  }
  return md;
}

function convertList(listEl: HTMLElement, ordered: boolean, depth = 0): string {
  let md = '';
  let idx = 1;
  const pad = '  '.repeat(depth);
  for (const item of Array.from(listEl.children) as HTMLElement[]) {
    if (item.tagName.toLowerCase() !== 'li') continue;
    const prefix = ordered ? `${idx++}. ` : '- ';
    let content  = '';
    for (const child of Array.from(item.childNodes)) {
      if (child.nodeType === Node.ELEMENT_NODE) {
        const childEl  = child as HTMLElement;
        const childTag = childEl.tagName.toLowerCase();
        if (childTag === 'ul') content += `\n${convertList(childEl, false, depth + 1)}`;
        else if (childTag === 'ol') content += `\n${convertList(childEl, true, depth + 1)}`;
        else content += convertHtmlToMarkdown(childEl);
      } else if (child.nodeType === Node.TEXT_NODE) {
        content += child.textContent;
      }
    }
    md += `${pad}${prefix}${content.trim()}\n`;
  }
  return md.trimEnd();
}

function cleanMarkdown(text: string): string {
  return text
    .replace(/\r\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function generateFilename(content: string): string {
  const words = content
    .replace(/[#*`[\]()>_\-]/g, '')
    .trim()
    .split(/\s+/)
    .slice(0, 5)
    .join('_')
    .replace(/[^a-zA-Z0-9_]/g, '')
    .toLowerCase();

  const d   = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const ts  = `${d.getFullYear()}${pad(d.getMonth()+1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;

  return words ? `gemini_${words}_${ts}.md` : `gemini_response_${ts}.md`;
}
