export default defineBackground(() => {
  // Configurar que el sidepanel se abra automáticamente al hacer click en el ícono
  browser.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });

  console.log('Gemini Automation Bridge background ready.', { id: browser.runtime.id });

  // Escuchar mensajes del content script para descargar archivos Markdown
  browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.type === 'DOWNLOAD_MARKDOWN') {
      const { content, filename } = message;
      
      console.log('Solicitud de descarga recibida:', filename);
      
      // Convertir el contenido markdown a Base64 para crear un Data URL
      const base64Content = btoa(unescape(encodeURIComponent(content)));
      const dataUrl = `data:text/markdown;base64,${base64Content}`;
      
      browser.downloads.download({
        url: dataUrl,
        filename: filename,
        saveAs: false // Descargar directamente sin abrir diálogo
      }).then((downloadId) => {
        console.log('Descarga iniciada con ID:', downloadId);
      }).catch((err) => {
        console.error('Error al realizar la descarga:', err);
      });
    }
  });
});
