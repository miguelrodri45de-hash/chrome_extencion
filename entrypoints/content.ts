export default defineContentScript({
  matches: ['https://gemini.google.com/*'],
  main() {
    console.log('[Gemini MD] ✅ v11 - solo respuestas.');

    // --- Wrapper callback-based para runtime.sendMessage ---
    function sendToBg(msg: Record<string, unknown>): Promise<unknown> {
      return new Promise((resolve, reject) => {
        try {
          const bk = (browser as any);
          bk.runtime.sendMessage(msg, (resp: unknown) => {
            const err = bk.runtime.lastError;
            if (err) reject(new Error(err.message));
            else resolve(resp);
          });
        } catch (e) {
          reject(e);
        }
      });
    }

    // --- Extraer texto de un nodo (incluyendo Shadow DOM) ---
    function getAllText(node: Node): string {
      const parts: string[] = [];
      if (node.nodeType === Node.TEXT_NODE) {
        const t = (node.textContent || '').trim();
        if (t) parts.push(t);
      } else if (node instanceof HTMLElement) {
        if (node.shadowRoot) {
          for (const child of Array.from(node.shadowRoot.childNodes)) {
            const t = getAllText(child);
            if (t) parts.push(t);
          }
        }
        for (const child of Array.from(node.childNodes)) {
          const t = getAllText(child);
          if (t) parts.push(t);
        }
      } else if (node instanceof DocumentFragment) {
        for (const child of Array.from(node.childNodes)) {
          const t = getAllText(child);
          if (t) parts.push(t);
        }
      }
      return parts.join('\n');
    }

    // --- Buscar el ÚLTIMO model-response ---
    function getLatestResponseEl(): HTMLElement | null {
      const all = document.querySelectorAll('model-response');
      return all.length > 0 ? (all[all.length - 1] as HTMLElement) : null;
    }

    // --- Obtener texto DENTRO de model-response (solo respuesta AI) ---
    function getResponseText(): string {
      const el = getLatestResponseEl();
      if (!el) return '';
      const text = getAllText(el).trim();
      // Si dentro de model-response no hay texto, buscar en descendientes
      if (text.length < 10) {
        for (const sel of [
          '.markdown', 'message-content', '.message-content',
          '.model-response-text', '[class*="markdown"]',
        ]) {
          const found = el.querySelector(sel) as HTMLElement | null;
          if (found) {
            const t = getAllText(found).trim();
            if (t.length > 10) return t;
          }
        }
        return getAllText(el);
      }
      return text;
    }

    // --- Estado ---
    let lastDownloaded = '';
    let lastUrl = location.href;
    let lastResponseCount = document.querySelectorAll('model-response').length;
    let stableTimer: ReturnType<typeof setTimeout> | null = null;

    // --- Descargar ---
    function download(text: string) {
      if (!text || text === lastDownloaded || text.length < 20) return;
      lastDownloaded = text;

      const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      const preview = text
        .replace(/[^\w\sáéíóúüñ]/gi, '')
        .trim().split(/\s+/).slice(0, 5).join('_').toLowerCase().slice(0, 50);
      const filename = preview ? `gemini_${preview}_${ts}.md` : `gemini_response_${ts}.md`;

      console.log('[Gemini MD] 📥 Descargando:', filename.slice(0, 60));

      sendToBg({ type: 'DOWNLOAD_MARKDOWN', content: text, filename })
        .then(() => console.log('[Gemini MD] ✅ OK'))
        .catch(err => {
          console.error('[Gemini MD] ❌ Error sendMessage, descarga directa:', err);
          try {
            const a = document.createElement('a');
            const blob = new Blob([text], { type: 'text/markdown' });
            a.href = URL.createObjectURL(blob);
            a.download = filename;
            a.click();
            URL.revokeObjectURL(a.href);
            console.log('[Gemini MD] ✅ Descarga directa OK');
          } catch (e2) {
            console.error('[Gemini MD] ❌ Fallback falló:', e2);
          }
        });
    }

    // --- ESTRATEGIA ÚNICA: vigilar SOLO model-response ---
    function checkModelResponse() {
      const el = getLatestResponseEl();
      if (!el) return;

      const text = getResponseText();
      if (!text || text.length < 20) return;

      if (stableTimer) clearTimeout(stableTimer);
      stableTimer = setTimeout(() => {
        const finalText = getResponseText();
        if (finalText === text && finalText !== lastDownloaded) {
          console.log('[Gemini MD] ✅ Respuesta AI estable. Descargando...');
          download(finalText);
        }
      }, 2000);
    }

    // Observer: detectar NUEVOS model-response o cambios en ellos
    const bodyObs = new MutationObserver((mutations) => {
      let hit = false;

      for (const m of mutations) {
        // Nuevos elementos
        if (m.type === 'childList') {
          for (const node of m.addedNodes) {
            if (node instanceof HTMLElement) {
              if (node.tagName?.toLowerCase() === 'model-response' ||
                  node.querySelector?.('model-response')) {
                hit = true;
                break;
              }
              // Si tiene shadowRoot, revisar dentro
              if (node.shadowRoot && node.shadowRoot.querySelector('model-response')) {
                hit = true;
                break;
              }
            }
          }
        }

        // Si el target es un model-response o está dentro de uno
        if (m.target instanceof HTMLElement || m.target instanceof Node) {
          const target = m.target instanceof HTMLElement ? m.target : m.target.parentElement;
          if (target && target.closest?.('model-response')) {
            hit = true;
            break;
          }
        }

        // Si cambió texto dentro de shadowRoot de model-response
        if (m.target instanceof Node && (m.target as any).getRootNode?.() instanceof ShadowRoot) {
          const host = (m.target as any).getRootNode?.()?.host;
          if (host?.tagName?.toLowerCase() === 'model-response' || host?.closest?.('model-response')) {
            hit = true;
            break;
          }
        }
      }

      if (hit) checkModelResponse();
    });

    bodyObs.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
    });

    // --- Observar shadow roots existentes ---
    function observeShadowRoot(host: HTMLElement) {
      if ((host as any).__gmObserved || !host.shadowRoot) return;
      (host as any).__gmObserved = true;
      try {
        const srObs = new MutationObserver(() => checkModelResponse());
        srObs.observe(host.shadowRoot!, { childList: true, subtree: true, characterData: true });
      } catch (_) {}
    }

    function scanShadowRoots(root: Node) {
      if (root instanceof HTMLElement) observeShadowRoot(root);
      for (const child of Array.from(root.childNodes)) {
        scanShadowRoots(child);
        if (child instanceof HTMLElement && child.shadowRoot) {
          scanShadowRoots(child.shadowRoot);
        }
      }
    }
    setTimeout(() => scanShadowRoots(document.body), 500);

    // --- Polling de respaldo ---
    setInterval(() => {
      const count = document.querySelectorAll('model-response').length;
      if (count > lastResponseCount) {
        lastResponseCount = count;
        console.log('[Gemini MD] 🔍 Nuevo model-response detectado.');
        checkModelResponse();
      }
    }, 2000);

    // --- Botón flotante ---
    setTimeout(() => {
      if (document.getElementById('gm-download-btn')) return;
      const btn = document.createElement('button');
      btn.id = 'gm-download-btn';
      btn.textContent = '⬇ MD';
      Object.assign(btn.style, {
        position: 'fixed', bottom: '20px', right: '20px', zIndex: '99999',
        padding: '10px 16px', background: '#1a73e8', color: '#fff',
        border: 'none', borderRadius: '8px', cursor: 'pointer',
        fontSize: '14px', fontWeight: 'bold',
        boxShadow: '0 2px 8px rgba(0,0,0,.3)',
      });
      btn.addEventListener('click', () => {
        const text = getResponseText();
        if (text && text.length > 20) download(text);
        else alert('No hay respuesta de AI disponible.');
      });
      document.body.appendChild(btn);
      console.log('[Gemini MD] 🟦 Botón manual añadido.');
    }, 4000);

    // --- URL change ---
    setInterval(() => {
      if (location.href !== lastUrl) {
        lastUrl = location.href;
        lastDownloaded = '';
        lastResponseCount = 0;
        if (stableTimer) clearTimeout(stableTimer);
        console.log('[Gemini MD] 🔄 Nueva URL.');
      }
    }, 1000);

    // --- Helper consola ---
    (window as any).__downloadGemini = () => {
      const text = getResponseText();
      if (text && text.length > 20) {
        download(text);
        console.log('[Gemini MD] Manual download triggered.');
      } else {
        console.warn('[Gemini MD] No hay respuesta de AI.');
      }
    };

    // --- Diagnóstico ---
    setTimeout(() => {
      const el = getLatestResponseEl();
      console.log('[Gemini MD] 📊 Diagnóstico:', {
        modelResponseExists: !!el,
        modelResponseCount: document.querySelectorAll('model-response').length,
        textLength: getResponseText().length,
        hasShadow: !!el?.shadowRoot,
        buttonExists: !!document.getElementById('gm-download-btn'),
      });
      console.log('[Gemini MD] 💡 Descarga manual: __downloadGemini()');
    }, 3000);

    console.log('[Gemini MD] 👁️ Activo.');
  },
});
