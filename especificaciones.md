# Especificaciones Técnicas — Gemini Automation Bridge

> **Extensión de Chrome** construida con el framework **WXT** (v0.20.26) + React 19 + TypeScript.  
> URL objetivo: `https://gemini.google.com/*`  
> Última actualización: 2026-06-24

---

## 1. Descripción General

La extensión automatiza dos flujos principales sobre `gemini.google.com`:

| Flujo | Descripción |
|-------|-------------|
| **Control de inicio** | Toggle en el sidepanel para iniciar en un chat nuevo o continuar el existente |
| **Extracción automática** | Detecta el fin de la generación de Gemini, extrae la respuesta, la convierte a Markdown y la descarga automáticamente como `.md` |

---

## 2. Stack Tecnológico

| Tecnología | Versión | Rol |
|------------|---------|-----|
| WXT | 0.20.26 | Framework de extensiones Chrome (build, hot-reload, manifest) |
| React | 19.2.4 | UI del sidepanel |
| TypeScript | 5.9.3 | Tipado estático |
| Vite | 8.0.16 | Bundler (incluido en WXT) |
| Chrome MV3 | — | Manifest Version 3 (background service worker) |

---

## 3. Estructura de Archivos

```
chrome_extencion/
├── wxt.config.ts                   # Configuración del manifest y permisos
├── package.json
├── especificaciones.md             # Este documento
├── entrypoints/
│   ├── background.ts               # Service Worker — escucha mensajes y descarga archivos
│   ├── content.ts                  # Content Script — inyectado en gemini.google.com
│   └── sidepanel/
│       ├── App.tsx                 # UI principal del panel lateral
│       ├── App.css                 # Estilos del sidepanel (toggle switch, botones)
│       ├── main.tsx
│       ├── index.html
│       └── style.css
└── .output/
    └── chrome-mv3/                 # Carpeta de extensión compilada (cargar en Chrome)
        ├── manifest.json
        ├── background.js
        ├── content-scripts/content.js
        └── ...
```

---

## 4. Permisos del Manifest (`wxt.config.ts`)

```typescript
permissions: ['sidePanel', 'activeTab', 'scripting', 'clipboardWrite', 'downloads'],
host_permissions: ['https://gemini.google.com/*'],
```

| Permiso | Uso |
|---------|-----|
| `sidePanel` | Abrir el panel lateral al hacer clic en el ícono de la extensión |
| `activeTab` | Obtener la pestaña activa para inyectar scripts |
| `scripting` | Ejecutar `injectDataIntoGemini()` en la página de Gemini |
| `clipboardWrite` | Escritura en portapapeles (preparado, no activo actualmente) |
| `downloads` | Descargar archivos `.md` automáticamente desde `background.ts` |

---

## 5. Selectores DOM de Gemini (Validados)

> IMPORTANTE: Gemini usa Angular con elementos custom. Estos selectores fueron identificados
> mediante inspección directa del DOM en vivo de `gemini.google.com`.

### 5.1 Detectar si Gemini está generando

El botón **"Stop response"** SOLO existe en el DOM mientras Gemini está generando una respuesta.
Su aparición = inicio de generación. Su desaparición = respuesta completa.

```css
/* Inglés */
button[aria-label="Stop response"]

/* Español (si la UI está en español) */
button[aria-label="Detener respuesta"]
button[aria-label="Parar respuesta"]

/* Fallback insensible a mayúsculas y localización parcial */
button[aria-label*="Stop" i][aria-label*="response" i]
```

### 5.2 Contenedor de respuesta del modelo

Elemento custom de Angular que envuelve cada turno de respuesta del modelo:

```css
model-response
```

- Selector: `document.querySelectorAll('model-response')`
- El **último** elemento de la colección es la respuesta más reciente
- Contiene internamente el HTML renderizado de la respuesta (con Markdown convertido a HTML)

### 5.3 Contenido Markdown interno (dentro de `model-response`)

Selectores en orden de prioridad para extraer el HTML con el contenido real:

```css
.markdown.markdown-main-panel   /* Más específico */
.markdown-main-panel
.markdown
message-content                 /* Elemento custom alternativo */
.message-content
.model-response-text
[class*="markdown"]             /* Fallback por atributo parcial */
[class*="response-text"]
```

### 5.4 Botón de enviar (Send button)

```css
/* Selector principal (gem-icon-button es el wrapper de Angular Material) */
gem-icon-button.send-button

/* Por contenedor de datos de test */
[data-test-id="send-button-container"] gem-icon-button
[data-test-id="send-button-container"] button

/* Fallback */
button.send-button
button[aria-label="Send message"]
button[aria-label="Enviar mensaje"]
button[aria-label*="Send" i]
button[aria-label*="Enviar" i]
```

**Estado deshabilitado** (mientras Gemini genera):
- Atributo `disabled` en `<button>` interno
- Atributo `aria-disabled="true"` en `gem-icon-button` padre

### 5.5 Botón de nuevo chat

```css
gem-nav-list-item[data-test-id="new-chat-button"] a
[data-test-id="new-chat-button"] a
a[aria-label="Nuevo chat"]
a[href="/app"][aria-label*="chat" i]
gem-nav-list-item[data-test-id="new-chat-button"]
[data-test-id="new-chat-button"]
```

### 5.6 Input de texto de Gemini

```css
div[contenteditable="true"]   /* Editor rich-text principal */
rich-textarea                  /* Elemento custom alternativo */
textarea                       /* Fallback para versiones antiguas */
```

---

## 6. Flujo de Detección de Respuesta Completa

```
mainObserver (siempre activo)
Observa: body, atributos [aria-label]
    |
    | ¿Aparece "Stop response"?
    v SÍ
startMonitoringForCompletion()
Crea generationObserver sobre document.body
Observa: childList, subtree, attributes
atributos: aria-label, hidden, style, class
    |
    | ¿Desaparece "Stop response"?
    v SÍ
onGenerationComplete()
  1. Espera 500ms (DOM flush final)
  2. getLatestModelResponse() -> <model-response>
  3. getMarkdownSource() -> contenedor de texto
  4. convertHtmlToMarkdown() -> string Markdown
  5. cleanMarkdown() -> normalizar saltos de línea
  6. generateFilename() -> nombre con timestamp
  7. browser.runtime.sendMessage(DOWNLOAD_MARKDOWN)
    |
    v
background.ts (Service Worker)
Recibe: { type, content, filename }
btoa(unescape(encodeURIComponent(content)))
-> data:text/markdown;base64,...
browser.downloads.download({ url, filename })
-> Archivo descargado en sistema de archivos
```

---

## 7. Descripción de Archivos Principales

### 7.1 `entrypoints/content.ts`

Inyectado automáticamente en todas las páginas de `gemini.google.com`.

**Funciones clave:**

| Función | Descripción |
|---------|-------------|
| `getStopButton()` | Busca el botón "Stop response" en el DOM |
| `isGenerating()` | Retorna `true` si el botón de stop está presente |
| `getLatestModelResponse()` | Retorna el último `<model-response>` del DOM |
| `getMarkdownSource()` | Busca el contenedor de markdown dentro de la respuesta |
| `startMonitoringForCompletion()` | Crea el MutationObserver secundario cuando detecta generación |
| `onGenerationComplete()` | Extrae, convierte y envía la respuesta al background |
| `convertHtmlToMarkdown()` | Convierte recursivamente HTML a Markdown |
| `convertList()` | Convierte listas ul/ol con indentación anidada |
| `convertTable()` | Convierte tablas HTML a sintaxis Markdown |
| `cleanMarkdown()` | Normaliza saltos de línea excesivos |
| `generateFilename()` | Genera nombre de archivo con primeras 5 palabras + timestamp |

**Protecciones implementadas:**
- `lastProcessedText`: evita descargas duplicadas de la misma respuesta
- Reset de estado al cambiar de URL (nueva conversación detectada cada 500ms)
- Al cargar la página, marca respuestas preexistentes como ya procesadas (no las descarga)

### 7.2 `entrypoints/background.ts`

Service Worker MV3. Solo escucha mensajes.

**Mensaje manejado:** `{ type: 'DOWNLOAD_MARKDOWN', content: string, filename: string }`

**Proceso de descarga:**
1. Codifica el contenido en Base64: `btoa(unescape(encodeURIComponent(content)))`
2. Genera un Data URL: `data:text/markdown;base64,<base64>`
3. Llama a `browser.downloads.download({ url, filename, saveAs: false })`

### 7.3 `entrypoints/sidepanel/App.tsx`

UI del panel lateral. Funciones implementadas:

**Estado:**
- `promptText`: texto del prompt a enviar
- `startNewChat`: booleano persistido en `localStorage`
- `isLoading`: estado de carga durante el envío
- `fileInputRef`: referencia al input de imagen

**`injectDataIntoGemini(text, base64Image, startNewChat)`:**
Función ejecutada via `browser.scripting.executeScript` directamente en la página de Gemini.

Pasos que realiza:
1. Si `startNewChat=true`: busca y clica el botón "Nuevo chat", espera 1000ms
2. Busca el input de texto (hasta 10 reintentos cada 200ms)
3. Inyecta el texto usando `document.execCommand('insertText')` + eventos `input`/`change`
4. Si hay imagen: crea un `ClipboardEvent` con `DataTransfer` para simular paste
5. Llama a `clickSendButton()` (30 reintentos, delay 500ms)

**`clickSendButton()`:**
Busca el botón de enviar con múltiples selectores y fallback por posición en el DOM.
Verifica que no esté deshabilitado antes de clicar.

---

## 8. Conversión HTML a Markdown

### Elementos soportados

| HTML | Markdown generado |
|------|-------------------|
| `h1` – `h6` | `#` – `######` |
| `p` | Párrafo separado por líneas en blanco |
| `strong`, `b` | `**texto**` |
| `em`, `i` | `*texto*` |
| `code` (inline) | `` `texto` `` |
| `pre > code` | Bloque de código con lenguaje detectado por clase `language-*` |
| `ul` | `- item` con indentación anidada de 2 espacios por nivel |
| `ol` | `1. item` con indentación anidada |
| `a` | `[texto](href)` |
| `br` | Salto de línea |
| `hr` | `---` |
| `blockquote` | `> texto` |
| `table` | Tabla Markdown con separador de encabezado `\|---\|` |

### Elementos ignorados (UI de Gemini, no contenido)

- `button`
- `svg`
- `mat-icon`
- `img`

### Formato de nombre de archivo

```
gemini_<primeras5palabras>_<YYYYMMDD_HHMMSS>.md

Ejemplo: gemini_hola_como_estas_hoy_20260624_013500.md
```

---

## 9. Problemas Encontrados y Soluciones

### Problema 1: Selectores frágiles / no encontraban el elemento

**Causa:** Se usaban selectores como `.model-response-text`, `structured-content-container`,
`response-container` que no existen en la versión actual del DOM de Gemini.

**Solución:** Se validó el DOM en vivo y se confirmó que el elemento correcto es
el custom element `<model-response>` de Angular.

---

### Problema 2: Detección basada en temporizador (no confiable)

**Causa:** La primera implementación esperaba 2500ms sin cambios en el texto para declarar
la respuesta "completa". Esto fallaba cuando la respuesta era larga o cuando la red era lenta.

**Solución:** Se reemplazó el temporizador por la detección del botón `button[aria-label="Stop response"]`
como indicador de control DOM. Este botón es añadido y eliminado por la propia aplicación
de Gemini de forma sincronizada con el estado de generación.

---

### Problema 3: Race condition en el estado "generating"

**Causa:** Un intento de máquina de estados fallaba porque en la ventana entre el clic
del usuario y la deshabilitación del botón de enviar, el script evaluaba `isGenerating === false`
y marcaba como procesado prematuramente.

**Solución:** Cambio de estrategia: en vez de detectar el botón de enviar (que cambia de estado
gradualmente), se detecta la aparición del botón de stop, que es la señal definitiva de que
el servidor comenzó a generar.

---

### Problema 4: Descarga de respuestas preexistentes al recargar

**Causa:** Al recargar la página, el DOM ya tenía respuestas del historial. El script
las detectaba como "nuevas" y las descargaba.

**Solución:** Al inicializar el script, se captura el `textContent` del último
`<model-response>` existente y se guarda como `lastProcessedText`. Cualquier respuesta
con ese mismo texto es ignorada.

---

### Problema 5: Descarga doble por la misma respuesta

**Causa:** El `MutationObserver` puede dispararse múltiples veces durante la eliminación
del botón de stop.

**Solución:** La variable `isMonitoringGeneration` actúa como mutex: solo permite iniciar
un ciclo de monitoreo a la vez. Además, `lastProcessedText` compara el texto completo para
rechazar duplicados.

---

## 10. Pipeline de Comunicación

```
[content.ts]
    |
    | browser.runtime.sendMessage({ type, content, filename })
    v
[background.ts - Service Worker]
    |
    | browser.downloads.download({ url: data:text/markdown;base64,..., filename })
    v
[Sistema de archivos del usuario]
```

---

## 11. Comandos de Desarrollo

```bash
# Compilar para producción
npm run build

# Modo desarrollo con hot-reload
npm run dev

# Verificar tipos TypeScript sin compilar
npm run compile

# Generar ZIP para publicar en Chrome Web Store
npm run zip
```

**Carpeta de extensión compilada:**
```
.output/chrome-mv3/
```
Esta carpeta se carga en Chrome desde `chrome://extensions/` haciendo clic en "Cargar descomprimida".

---

## 12. Flujo de Inyección de Texto e Imagen (Sidepanel a Gemini)

```
[Usuario en Sidepanel]
  Escribe prompt, selecciona imagen, configura toggle, clic "Cargar en Gemini"
    |
    v
[App.tsx handleSend()]
  - Lee la imagen como DataURL (FileReader)
  - Obtiene la pestaña activa (browser.tabs.query)
  - Verifica que sea gemini.google.com
  - Ejecuta injectDataIntoGemini() via browser.scripting.executeScript
    |
    v
[injectDataIntoGemini() — ejecutada EN la página de Gemini]
  Si startNewChat=true:
    Busca botón "Nuevo chat" -> clica -> espera 1000ms

  Busca input (10 reintentos x 200ms):
    div[contenteditable="true"] | rich-textarea | textarea

  Inyecta texto:
    execCommand('insertText') en <p> interno
    Dispara eventos input/change en p y en contenedor

  Si hay imagen:
    fetch(dataURL) -> blob -> File
    DataTransfer.items.add(file)
    ClipboardEvent('paste') -> espera 2000ms -> clickSendButton()

  Si solo texto:
    espera 500ms -> clickSendButton()

[clickSendButton() — 30 reintentos x 500ms]
  Busca con múltiples selectores
  Verifica que no esté deshabilitado (disabled / aria-disabled)
  Clica el botón + clic extra en gem-icon-button padre
```

---

## 13. Verificación en DevTools

Si el script deja de funcionar, ejecutar en la consola de DevTools de Gemini:

```javascript
// Verificar si el botón de stop existe (durante generación)
document.querySelector('button[aria-label="Stop response"]')

// Verificar si existen elementos de respuesta
document.querySelectorAll('model-response').length

// Ver todos los aria-labels de botones (para encontrar el botón de stop en otro idioma)
[...document.querySelectorAll('button')]
  .map(b => b.getAttribute('aria-label'))
  .filter(Boolean)

// Ver estructura del último model-response
document.querySelectorAll('model-response')[document.querySelectorAll('model-response').length - 1]?.outerHTML
```

---

## 14. Notas para Futuras Iteraciones

1. **Selectores CSS de Gemini son frágiles:** Google puede cambiarlos en cualquier actualización.
   Usar el procedimiento de DevTools de la sección 13 para re-validarlos.

2. **Idioma de Gemini:** Si la UI está en español, el aria-label del botón de stop puede ser
   "Detener respuesta" en vez de "Stop response". El selector actual incluye fallbacks para ambos.

3. **SPA Navigation:** Gemini es una Single Page Application. Los cambios de URL no recargan
   el content script. El monitoreo de URL cada 500ms garantiza el reset del estado.

4. **Manifest V3 limitaciones:** No se pueden hacer XMLHttpRequest desde el background service
   worker a dominios externos sin permiso explícito. El método de Data URL para descargas
   evita esta limitación.

5. **Encoding UTF-8 en Base64:** Para respuestas con caracteres Unicode (acentos, emojis),
   el encoding correcto es: `btoa(unescape(encodeURIComponent(content)))`.
   NO usar simplemente `btoa(content)` ya que falla con caracteres fuera del ASCII.

6. **Tamaño máximo de Data URL:** Los navegadores tienen límites en el tamaño de Data URLs
   (generalmente ~2MB). Para respuestas muy largas considerar usar `URL.createObjectURL(blob)`
   como alternativa en background.ts.
