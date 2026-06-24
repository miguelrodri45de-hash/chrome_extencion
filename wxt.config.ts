import { defineConfig } from 'wxt';

// See https://wxt.dev/api/config.html
export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  manifest: {
    name: 'Gemini Automation Bridge',
    description: 'Prueba inicial para cargar texto e imágenes en Gemini.google.com',
    permissions: ['sidePanel', 'activeTab', 'scripting', 'clipboardWrite', 'downloads'],
    host_permissions: ['https://gemini.google.com/*'],
    action: {
      default_title: 'Abrir Automatizador',
    },
  },
});
