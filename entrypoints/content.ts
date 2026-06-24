export default defineContentScript({
  matches: ['https://gemini.google.com/*'],
  main() {
    console.log('[Gemini MD] ✅ Content script iniciado v5 (send-button.stop class detection).');

    // ─── Estado global ─────────────────────────────────────────────────────────
    let generationActive   = false; // ¿Está Gemini generando ahora mismo?
    let lastUrl            = location.href;
    let lastDownloadedText = '';    // Evitar descargas duplicadas

    // ─── Buscar el botón de enviar (siempre presente) ─────────────────────────
    // En Gemini, gem-icon-button.send-button ES el botón que cambia de clase:
    //   - Estado normal:     class="send-button ..."
    //   - Generando:         class="send-button ... stop ..."
    function getSendButton(): HTMLElement | null {
      return document.querySelector('gem-icon-button.send-button') as HTMLElement | null;
    }

    // ─── Obtener el último model-response del DOM ─────────────────────────────
    function getLatestModelResponse(): HTMLElement | null {
      const all = document.querySelectorAll('model-response');
      return all.length > 0 ? (all[all.length - 1] as HTMLElement) : null;
    }

    // ─── Obtener el contenedor de markdown dentro de la respuesta ─────────────
    function getMarkdownSource(el: HTMLElement): HTMLElement {
      const selectors = [
        '.markdown.markdown-main-panel',
        '.markdown-main-panel',
        '.markdown',
        'message-content',
        '.message-content',
        '.model-response-text',
        '[class*="markdown"]',
        '[class*="response-content"]',
      ];
      for (const sel of selectors) {
        const found = el.querySelector(sel);
        if (found && (found.textContent || '').trim().length > 10) {
          return found as HTMLElement;
        }
      }
      return el;
    }

    // ─── Extraer la respuesta y descargar ─────────────────────────────────────
    function extractAndDownload() {
      const responseEl = getLatestModelResponse();
      if (!responseEl) {
        console.warn('[Gemini MD] ⚠️ No se encontró <model-response> después de generación.');
        return;
      }

      const src  = getMarkdownSource(responseEl);
      const text = (src.textContent || '').trim();

      if (text.length < 10) {
        console.warn('[Gemini MD] ⚠️ Texto de respuesta muy corto, ignorando.');
        return;
      }

      // Evitar descargar la misma respuesta dos veces
      if (text === lastDownloadedText) {
        console.log('[Gemini MD] ⚠️ Misma respuesta ya descargada, ignorando duplicado.');
        return;
      }

      lastDownloadedText = text;

      const mdText   = cleanMarkdown(convertHtmlToMarkdown(src));
      const filename = generateFilename(mdText);

      console.log('[Gemini MD] 📥 Descargando:', filename);

      browser.runtime.sendMessage({
        type: 'DOWNLOAD_MARKDOWN',
        content: mdText,
        filename: filename,
      }).then(() => {
        console.log('[Gemini MD] ✅ Mensaje de descarga enviado correctamente.');
      }).catch(err => {
        console.error('[Gemini MD] ❌ Error al enviar mensaje de descarga:', err);
      });
    }

    // ─── Iniciar observador del botón de enviar ────────────────────────────────
    // La estrategia principal: vigilar cambios de clase en gem-icon-button.send-button
    // Cuando aparece la clase 'stop' → generando
    // Cuando desaparece la clase 'stop' → respuesta completa
    function setupSendButtonObserver() {
      const btn = getSendButton();
      if (!btn) {
        console.warn('[Gemini MD] ⚠️ No se encontró gem-icon-button.send-button. Reintentando...');
        return false;
      }

      console.log('[Gemini MD] 🎯 send-button encontrado. Vigilando cambios de clase...');

      const observer = new MutationObserver((mutations) => {
        for (const m of mutations) {
          if (m.type !== 'attributes' || m.attributeName !== 'class') continue;

          const oldClasses = (m.oldValue || '');
          const newClasses = btn.className;
          const wasStop    = oldClasses.includes('stop');
          const isStop     = newClasses.includes('stop');

          if (!wasStop && isStop) {
            // La clase 'stop' apareció → Gemini empezó a generar
            generationActive = true;
            console.log('[Gemini MD] 🟡 Generación iniciada (clase "stop" detectada en send-button).');
          } else if (wasStop && !isStop && generationActive) {
            // La clase 'stop' desapareció → Gemini terminó de generar
            generationActive = false;
            console.log('[Gemini MD] ✅ Generación completada (clase "stop" eliminada). Extrayendo...');

            // Pequeño delay para que el DOM actualice el contenido final
            setTimeout(extractAndDownload, 400);
          }
        }
      });

      observer.observe(btn, {
        attributes:        true,
        attributeOldValue: true,
        attributeFilter:   ['class'],
      });

      return true;
    }

    // ─── Estrategia de fallback: vigilar count de model-response ──────────────
    // Si no se puede encontrar el send-button, usar detección por model-response + estabilidad
    let fallbackTimer: ReturnType<typeof setInterval> | null = null;
    let fallbackTarget: HTMLElement | null = null;
    let fallbackText   = '';
    let stableCount    = 0;
    let lastResponseCount = document.querySelectorAll('model-response').length;

    function startFallbackMonitor(el: HTMLElement) {
      if (fallbackTimer) clearInterval(fallbackTimer);
      fallbackTarget = el;
      fallbackText   = '';
      stableCount    = 0;

      console.log('[Gemini MD] 🔄 Usando fallback: monitor de estabilidad en model-response...');

      fallbackTimer = setInterval(() => {
        if (!fallbackTarget) return;
        const src     = getMarkdownSource(fallbackTarget);
        const current = (src.textContent || '').trim();

        if (current.length < 10) { stableCount = 0; fallbackText = current; return; }
        if (current !== fallbackText) { fallbackText = current; stableCount = 0; return; }

        stableCount++;
        if (stableCount >= 3) {
          clearInterval(fallbackTimer!);
          fallbackTimer = null;
          if (current !== lastDownloadedText) {
            lastDownloadedText = current;
            console.log('[Gemini MD] ✅ Fallback: texto estable 3s. Extrayendo...');
            const mdText   = cleanMarkdown(convertHtmlToMarkdown(src));
            const filename = generateFilename(mdText);
            browser.runtime.sendMessage({ type: 'DOWNLOAD_MARKDOWN', content: mdText, filename }).catch(console.error);
          }
        }
      }, 1000);
    }

    // ─── Observer de fallback para nuevos model-response ──────────────────────
    const fallbackObserver = new MutationObserver(() => {
      const all = document.querySelectorAll('model-response');
      if (all.length > lastResponseCount) {
        lastResponseCount = all.length;
        const newEl = all[all.length - 1] as HTMLElement;
        startFallbackMonitor(newEl);
      }
    });

    // ─── Intentar configurar el observador principal ───────────────────────────
    // El send-button puede no estar en el DOM al cargar, así que reintentamos
    let setupAttempts = 0;
    const trySetup = setInterval(() => {
      if (setupSendButtonObserver()) {
        clearInterval(trySetup);
        console.log('[Gemini MD] 🎯 Observador principal activo.');
      } else {
        setupAttempts++;
        if (setupAttempts >= 10) {
          clearInterval(trySetup);
          console.warn('[Gemini MD] ⚠️ No se pudo encontrar send-button. Activando fallback...');
          // Activar fallback: vigilar cambios en model-response
          lastResponseCount = document.querySelectorAll('model-response').length;
          fallbackObserver.observe(document.body, { childList: true, subtree: true });
        }
      }
    }, 500);

    // ─── Detectar cambios de URL (nueva conversación) ─────────────────────────
    setInterval(() => {
      if (location.href !== lastUrl) {
        lastUrl = location.href;
        generationActive   = false;
        lastDownloadedText = '';
        stableCount        = 0;

        if (fallbackTimer) { clearInterval(fallbackTimer); fallbackTimer = null; }
        fallbackTarget = null;

        console.log('[Gemini MD] 🔄 Nueva URL detectada. Estado reiniciado.');

        // Re-configurar el observer del send-button tras navegación SPA
        // (El elemento puede haber sido recreado por Angular)
        let retryCount = 0;
        const retrySetup = setInterval(() => {
          if (setupSendButtonObserver()) {
            clearInterval(retrySetup);
            // Al navegar a nueva URL, actualizar lastResponseCount con lo que haya
            lastResponseCount = document.querySelectorAll('model-response').length;
          } else {
            retryCount++;
            if (retryCount >= 6) {
              clearInterval(retrySetup);
              lastResponseCount = document.querySelectorAll('model-response').length;
            }
          }
        }, 400);
      }
    }, 500);

    // ─── Diagnóstico inicial (2s después de cargar) ───────────────────────────
    setTimeout(() => {
      const responses = document.querySelectorAll('model-response').length;
      const sendBtn   = getSendButton();
      console.log(`[Gemini MD] 📊 Diagnóstico:`, {
        'model-response count': responses,
        'send-button encontrado': !!sendBtn,
        'send-button clases': sendBtn?.className ?? '—',
      });
    }, 2000);

    console.log('[Gemini MD] 👁️ Script activo. Esperando generaciones...');
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
        case 'hr':         md += '\n\n---\n\n'; break;
        case 'blockquote': md += `\n\n> ${convertHtmlToMarkdown(el).trim().replace(/\n/g, '\n> ')}\n\n`; break;
        case 'table':      md += convertTable(el); break;
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
        if (childTag === 'ul')      content += `\n${convertList(childEl, false, depth + 1)}`;
        else if (childTag === 'ol') content += `\n${convertList(childEl, true,  depth + 1)}`;
        else                        content += convertHtmlToMarkdown(childEl);
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
  rows.forEach((row, i) => {
    const cells = Array.from(row.querySelectorAll('td, th')) as HTMLElement[];
    const texts = cells.map(c => convertHtmlToMarkdown(c).trim().replace(/\n/g, ' '));
    md += `| ${texts.join(' | ')} |\n`;
    if (i === 0) md += `| ${texts.map(() => '---').join(' | ')} |\n`;
  });
  return md + '\n';
}

function cleanMarkdown(text: string): string {
  return text.replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

function generateFilename(content: string): string {
  const words = content
    .replace(/[#*`[\]()>_\-]/g, '')
    .trim()
    .split(/\s+/)
    .slice(0, 5)
    .join('_')
    .replace(/[^a-zA-Z0-9_áéíóúüñÁÉÍÓÚÜÑ]/g, '')
    .toLowerCase()
    .slice(0, 50);

  const d   = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const ts  = `${d.getFullYear()}${pad(d.getMonth()+1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;

  return words ? `gemini_${words}_${ts}.md` : `gemini_response_${ts}.md`;
}
