export default defineContentScript({
  matches: ['https://gemini.google.com/*'],
  main() {
    console.log('[Gemini MD] Content script iniciado.');

    // ─── Estado global ─────────────────────────────────────────────────────────
    let isMonitoringGeneration = false; // ¿Estamos monitoreando una generación activa?
    let lastProcessedText      = '';    // Texto de la última respuesta descargada (evitar duplicados)
    let lastUrl                = location.href;
    let generationObserver: MutationObserver | null = null;

    // ─── Selector del botón de parar (indicador de que Gemini está generando) ──
    // El botón con aria-label="Stop response" SOLO aparece durante la generación.
    // Su desaparición = respuesta completa. Este es nuestro indicador de control.
    function getStopButton(): HTMLElement | null {
      return (
        document.querySelector('button[aria-label="Stop response"]') ||
        document.querySelector('button[aria-label="Detener respuesta"]') ||
        document.querySelector('button[aria-label="Parar respuesta"]') ||
        document.querySelector('button[aria-label*="Stop" i][aria-label*="response" i]')
      ) as HTMLElement | null;
    }

    // ─── ¿Está Gemini generando actualmente? ──────────────────────────────────
    function isGenerating(): boolean {
      return getStopButton() !== null;
    }

    // ─── Obtener el último bloque de respuesta del modelo ─────────────────────
    // <model-response> es el custom element de Angular de Gemini (confirmado por DOM real)
    function getLatestModelResponse(): HTMLElement | null {
      const responses = document.querySelectorAll('model-response');
      if (responses.length > 0) {
        return responses[responses.length - 1] as HTMLElement;
      }
      return null;
    }

    // ─── Obtener la fuente HTML para convertir ────────────────────────────────
    function getMarkdownSource(responseEl: HTMLElement): HTMLElement {
      const candidates = [
        '.markdown.markdown-main-panel',
        '.markdown-main-panel',
        '.markdown',
        'message-content',
        '.message-content',
        '.model-response-text',
        '[class*="markdown"]',
        '[class*="response-text"]',
      ];
      for (const sel of candidates) {
        const found = responseEl.querySelector(sel);
        if (found && (found.textContent || '').trim().length > 10) {
          return found as HTMLElement;
        }
      }
      // Si no encontramos ninguno, retornar el propio elemento de respuesta
      return responseEl;
    }

    // ─── Cuando la generación termina ────────────────────────────────────────
    function onGenerationComplete() {
      isMonitoringGeneration = false;
      generationObserver = null;

      console.log('[Gemini MD] Generación completada. Extrayendo respuesta...');

      // Pequeño delay para que el DOM actualice el contenido final
      setTimeout(() => {
        const responseEl = getLatestModelResponse();
        if (!responseEl) {
          console.warn('[Gemini MD] No se encontró <model-response> en el DOM.');
          return;
        }

        const source      = getMarkdownSource(responseEl);
        const currentText = (source.textContent || '').trim();

        if (currentText.length < 10) {
          console.warn('[Gemini MD] Respuesta demasiado corta, ignorando.');
          return;
        }

        if (currentText === lastProcessedText) {
          console.log('[Gemini MD] Respuesta ya procesada, ignorando duplicado.');
          return;
        }

        lastProcessedText = currentText;

        const mdText   = cleanMarkdown(convertHtmlToMarkdown(source));
        const filename = generateFilename(mdText);

        console.log('[Gemini MD] Enviando para descarga:', filename);

        browser.runtime.sendMessage({
          type: 'DOWNLOAD_MARKDOWN',
          content: mdText,
          filename: filename,
        }).then(() => {
          console.log('[Gemini MD] Mensaje de descarga enviado correctamente.');
        }).catch((err) => {
          console.error('[Gemini MD] Error al enviar mensaje de descarga:', err);
        });
      }, 500);
    }

    // ─── Iniciar monitoreo de fin de generación ───────────────────────────────
    // Se llama cuando detectamos que el botón "Stop response" apareció.
    // Creamos un MutationObserver que vigila el body hasta que ese botón desaparezca.
    function startMonitoringForCompletion() {
      if (isMonitoringGeneration) return;
      isMonitoringGeneration = true;

      console.log('[Gemini MD] Botón "Stop response" detectado → Gemini está generando...');

      // Usamos un MutationObserver para detectar cuando el botón de stop desaparece
      const obs = new MutationObserver(() => {
        if (!isGenerating()) {
          // El botón de stop desapareció → la generación terminó
          obs.disconnect();
          onGenerationComplete();
        }
      });

      obs.observe(document.body, {
        childList:  true,
        subtree:    true,
        attributes: true,
        attributeFilter: ['aria-label', 'hidden', 'style', 'class'],
      });

      generationObserver = obs;
    }

    // ─── Observador principal: vigila la aparición del botón "Stop response" ──
    // Este observador siempre está activo y detecta el inicio de una generación.
    const mainObserver = new MutationObserver(() => {
      if (!isMonitoringGeneration && isGenerating()) {
        startMonitoringForCompletion();
      }
    });

    mainObserver.observe(document.body, {
      childList:  true,
      subtree:    true,
      attributes: true,
      attributeFilter: ['aria-label'],
    });

    // ─── Detectar cambios de URL (nueva conversación) ─────────────────────────
    setInterval(() => {
      if (location.href !== lastUrl) {
        lastUrl = location.href;

        // Resetear estado
        isMonitoringGeneration = false;
        lastProcessedText      = '';

        if (generationObserver) {
          generationObserver.disconnect();
          generationObserver = null;
        }

        // Marcar las respuestas existentes como ya procesadas para no descargarlas
        const existingResponse = getLatestModelResponse();
        if (existingResponse) {
          const src = getMarkdownSource(existingResponse);
          lastProcessedText = (src.textContent || '').trim();
        }

        console.log('[Gemini MD] Nueva URL → estado reiniciado.');
      }
    }, 500);

    // ─── Al cargar la página, marcar respuestas existentes como procesadas ────
    // Esto evita que al recargar la página se descarguen respuestas anteriores.
    const initExisting = () => {
      const existingResponse = getLatestModelResponse();
      if (existingResponse) {
        const src = getMarkdownSource(existingResponse);
        lastProcessedText = (src.textContent || '').trim();
        console.log('[Gemini MD] Respuesta preexistente marcada (no se descargará).');
      }
    };

    // Intentar inicializar después de que el DOM cargue
    if (document.readyState === 'complete') {
      initExisting();
    } else {
      window.addEventListener('load', initExisting, { once: true });
      // También intentar después de un segundo por si la SPA carga más tarde
      setTimeout(initExisting, 1500);
    }

    console.log('[Gemini MD] Observador activo. Esperando generaciones...');
  },
});

// ─── Conversión HTML → Markdown ────────────────────────────────────────────────

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
          const text = convertHtmlToMarkdown(el);
          md += href ? `[${text}](${href})` : text;
          break;
        }
        case 'hr': md += '\n\n---\n\n'; break;
        case 'blockquote': md += `\n\n> ${convertHtmlToMarkdown(el).trim().replace(/\n/g, '\n> ')}\n\n`; break;
        case 'table': md += convertTable(el); break;
        // Ignorar elementos de UI (no son contenido de la respuesta)
        case 'button':
        case 'svg':
        case 'mat-icon':
        case 'img': break;
        default: md += convertHtmlToMarkdown(el); break;
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

function convertTable(tableEl: HTMLElement): string {
  const rows = Array.from(tableEl.querySelectorAll('tr')) as HTMLElement[];
  if (rows.length === 0) return '';

  let md = '\n\n';
  rows.forEach((row, rowIdx) => {
    const cells = Array.from(row.querySelectorAll('td, th')) as HTMLElement[];
    const cellTexts = cells.map(c => convertHtmlToMarkdown(c).trim().replace(/\n/g, ' '));
    md += `| ${cellTexts.join(' | ')} |\n`;
    if (rowIdx === 0) {
      md += `| ${cellTexts.map(() => '---').join(' | ')} |\n`;
    }
  });

  return md + '\n';
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
