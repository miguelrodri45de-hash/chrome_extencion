export default defineBackground(() => {
  // Configurar que el sidepanel se abra automáticamente al hacer click en el ícono
  browser.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });

  console.log('Gemini Automation Bridge background ready.', { id: browser.runtime.id });
});
