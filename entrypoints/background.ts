export default defineBackground(() => {
  (browser as any).sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  console.log('[Gemini MD] Background ready.', { id: (browser as any).runtime.id });

  // Wrapper: chrome.downloads.download usa callbacks, no Promises
  function downloadFile(opts: Record<string, unknown>): Promise<number> {
    return new Promise((resolve, reject) => {
      try {
        (browser as any).downloads.download(opts, (downloadId: number) => {
          const err = (browser as any).runtime.lastError;
          if (err) reject(new Error(err.message));
          else resolve(downloadId);
        });
      } catch (e) {
        reject(e);
      }
    });
  }

  (browser as any).runtime.onMessage.addListener(
    (message: any, _sender: any, sendResponse: (resp: any) => void) => {
      if (message?.type === 'DOWNLOAD_MARKDOWN') {
        const { content, filename } = message;
        console.log('[Gemini MD] Solicitud de descarga:', filename);

        const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' });
        const url = URL.createObjectURL(blob);

        downloadFile({ url, filename, saveAs: false })
          .then((id) => {
            console.log('[Gemini MD] ✅ Descargado, ID:', id);
            setTimeout(() => URL.revokeObjectURL(url), 5000);
            sendResponse({ success: true, downloadId: id });
          })
          .catch((err) => {
            console.error('[Gemini MD] Error:', err);
            try {
              const b64 = btoa(unescape(encodeURIComponent(content)));
              downloadFile({ url: `data:text/markdown;base64,${b64}`, filename, saveAs: false })
                .then(id => sendResponse({ success: true, downloadId: id }))
                .catch(e => sendResponse({ success: false, error: e.message }));
            } catch (e) {
              sendResponse({ success: false, error: String(e) });
            }
          });

        return true; // Mantener canal abierto para respuesta async
      }
    },
  );
});
