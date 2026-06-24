// =====================================================================
// SCRIPT DE DIAGNÓSTICO — Pegar en la consola de gemini.google.com (F12)
// Ejecutar ANTES de enviar un mensaje para verificar qué selectores existen
// =====================================================================

(function diagnostico() {
  console.group('[DIAGNÓSTICO] Selectores de Gemini');

  // 1. Botones disponibles y sus aria-labels
  const botones = [...document.querySelectorAll('button')].map(b => ({
    ariaLabel: b.getAttribute('aria-label'),
    texto: b.textContent?.trim().slice(0, 40),
    clase: b.className.slice(0, 60),
    deshabilitado: b.disabled || b.getAttribute('aria-disabled') === 'true'
  })).filter(b => b.ariaLabel || b.texto);
  console.log('BOTONES ENCONTRADOS:', botones);

  // 2. ¿Existe el elemento model-response?
  const modelResponses = document.querySelectorAll('model-response');
  console.log('model-response count:', modelResponses.length);
  if (modelResponses.length > 0) {
    const last = modelResponses[modelResponses.length - 1];
    console.log('Último model-response tag:', last.tagName);
    console.log('Último model-response innerHTML (primeros 500 chars):', last.innerHTML.slice(0, 500));
  }

  // 3. ¿Existe el botón de stop?
  const stopSelectors = [
    'button[aria-label="Stop response"]',
    'button[aria-label="Detener respuesta"]',
    'button[aria-label="Parar respuesta"]',
    'button[aria-label*="Stop" i]',
    'button[aria-label*="Detener" i]',
    'button[aria-label*="Parar" i]',
    'button[aria-label*="Cancel" i]',
    'button[aria-label*="Cancelar" i]'
  ];
  console.group('Selectores del botón STOP:');
  stopSelectors.forEach(s => {
    const el = document.querySelector(s);
    console.log(s + ':', el ? '✅ ENCONTRADO' : '❌ no encontrado');
  });
  console.groupEnd();

  // 4. ¿Existe el contenedor de markdown?
  const mdSelectors = [
    '.markdown.markdown-main-panel',
    '.markdown-main-panel',
    '.markdown',
    'message-content',
    '.message-content',
    '.model-response-text',
    '[class*="markdown"]',
    '[class*="response-text"]'
  ];
  console.group('Selectores del contenedor MARKDOWN:');
  mdSelectors.forEach(s => {
    const els = document.querySelectorAll(s);
    if (els.length > 0) {
      console.log(s + ': ✅ ENCONTRADO (' + els.length + ' elementos), primer texto:', els[0].textContent?.slice(0, 100));
    } else {
      console.log(s + ': ❌ no encontrado');
    }
  });
  console.groupEnd();

  // 5. Elementos custom de Angular
  const customEls = ['model-response', 'user-query', 'gem-icon-button', 'rich-textarea', 'response-container', 'message-content', 'structured-content-container'];
  console.group('Elementos CUSTOM (Angular):');
  customEls.forEach(tag => {
    const count = document.querySelectorAll(tag).length;
    console.log(tag + ':', count > 0 ? '✅ ' + count + ' elementos' : '❌ no encontrado');
  });
  console.groupEnd();

  // 6. ¿El content script de la extensión está activo?
  console.log('URL actual:', location.href);
  console.log('Buscar logs [Gemini MD] arriba en la consola para confirmar que el content script cargó');

  console.groupEnd();
})();
