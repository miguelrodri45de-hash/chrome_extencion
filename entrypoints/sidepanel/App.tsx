import { useState, useRef } from 'react';
import './App.css';

// Función que se inyectará en la ventana de Gemini
async function injectDataIntoGemini(text: string, base64Image: string | null, startNewChat: boolean) {
  // Función auxiliar para buscar y clickear el botón de envío de Gemini
  function clickSendButton(retries = 30, delay = 500) {
    const attempt = () => {
      // Múltiples selectores para encontrar el botón de envío de Gemini, incluyendo el nuevo selector del contenedor
      const sendButton = document.querySelector(
        'gem-icon-button.send-button, [data-test-id="send-button-container"] button, [data-test-id="send-button-container"] gem-icon-button, button.send-button, button[aria-label="Send message"], button[aria-label="Enviar mensaje"], button[aria-label*="Send" i], button[aria-label*="Enviar" i], button[data-mat-icon-name="send"], .send-button-container button, button.send-button-icon'
      ) as HTMLElement | null;

      console.log('Intento de buscar botón de envío. Encontrado:', sendButton);

      // Función para comprobar si el elemento o sus padres están deshabilitados (nativamente o por aria-disabled)
      const isElementDisabled = (el: HTMLElement) => {
        if ((el as HTMLButtonElement).disabled) return true;
        if (el.getAttribute('aria-disabled') === 'true') return true;
        if (el.hasAttribute('disabled')) return true;
        
        // Buscar si el componente contenedor gem-icon-button está deshabilitado
        const parentGem = el.closest('gem-icon-button');
        if (parentGem && (parentGem.getAttribute('aria-disabled') === 'true' || parentGem.hasAttribute('disabled'))) {
          return true;
        }
        return false;
      };

      // Fallback: buscar el botón por el ícono SVG de envío (flecha)
      if (!sendButton) {
        const allButtons = document.querySelectorAll('button');
        for (const btn of allButtons) {
          // El botón de enviar suele ser circular con un ícono de flecha, y está habilitado
          const isSendLike =
            btn.querySelector('mat-icon, svg, img') &&
            !isElementDisabled(btn) &&
            (btn.closest('.input-area-container') ||
             btn.closest('.input-buttons-wrapper') ||
             btn.closest('.bottom-container') ||
             btn.closest('.chat-input'));
          if (isSendLike) {
            btn.click();
            console.log('Botón de envío clickeado (fallback).');
            return;
          }
        }
      }

      if (sendButton) {
        const isDisabled = isElementDisabled(sendButton);
        console.log('Estado del botón de envío encontrado:', { isDisabled });

        if (!isDisabled) {
          // Hacer click en el elemento encontrado
          sendButton.click();
          console.log('Botón de envío clickeado.');

          // Si es un botón dentro de gem-icon-button, o viceversa, clickear el otro también para asegurar la propagación
          if (sendButton.tagName.toLowerCase() === 'button') {
            const gemParent = sendButton.closest('gem-icon-button') as HTMLElement | null;
            if (gemParent) {
              console.log('Click extra en gem-icon-button para asegurar.');
              gemParent.click();
            }
          } else if (sendButton.tagName.toLowerCase() === 'gem-icon-button') {
            const innerBtn = sendButton.querySelector('button') as HTMLElement | null;
            if (innerBtn) {
              console.log('Click extra en botón interno de gem-icon-button para asegurar.');
              innerBtn.click();
            }
          }
          return;
        }
      }

      // Reintentar si el botón aún no está habilitado o no se encuentra
      if (retries > 0) {
        setTimeout(() => attempt(), delay);
      } else {
        console.warn('No se pudo encontrar/clickear el botón de envío después de todos los reintentos.');
      }
    };

    attempt();
  }

  // 1. Si está activo "Nuevo Chat", buscar el botón correspondiente y hacer click
  if (startNewChat) {
    console.log('Intentando iniciar nuevo chat antes de enviar...');
    const newChatButton = document.querySelector('gem-nav-list-item[data-test-id="new-chat-button"] a') 
      || document.querySelector('[data-test-id="new-chat-button"] a') 
      || document.querySelector('a[aria-label="Nuevo chat"]') 
      || document.querySelector('a[href="/app"][aria-label*="chat" i]')
      || document.querySelector('gem-nav-list-item[data-test-id="new-chat-button"]')
      || document.querySelector('[data-test-id="new-chat-button"]');

    if (newChatButton) {
      console.log('Botón de nuevo chat encontrado, clickeando...', newChatButton);
      (newChatButton as HTMLElement).click();
      // Esperar 1 segundo para la transición de la SPA de Gemini
      await new Promise(resolve => setTimeout(resolve, 1000));
    } else {
      console.warn('No se encontró el botón de nuevo chat, se continuará en la pestaña actual.');
    }
  }

  // 2. Buscar el input de texto (Rich editor de Gemini), con hasta 10 reintentos si tarda en re-renderizar
  let textInput: HTMLElement | null = null;
  for (let i = 0; i < 10; i++) {
    textInput = document.querySelector(
      'div[contenteditable="true"], rich-textarea, textarea'
    ) as HTMLElement | null;
    if (textInput) break;
    await new Promise(resolve => setTimeout(resolve, 200));
  }

  if (!textInput) {
    console.error('No se encontró el input de texto de Gemini.');
    return;
  }

  // Enfocar el input
  textInput.focus();

  // Inyectar el texto si existe
  if (text) {
    if (textInput.tagName.toLowerCase() === 'textarea' || (textInput as HTMLInputElement).value !== undefined) {
      (textInput as HTMLInputElement).value = text;
    } else {
      try {
        // Encontrar el párrafo interno del editor enriquecido (<p>) o usar el input mismo.
        const pElement = textInput.querySelector('p') || textInput;
        pElement.focus();

        const selection = window.getSelection();
        const range = document.createRange();
        range.selectNodeContents(pElement);
        selection?.removeAllRanges();
        selection?.addRange(range);
        
        document.execCommand('insertText', false, text);
      } catch (e) {
        console.warn('execCommand falló, usando fallback de innerText:', e);
        const pElement = textInput.querySelector('p') || textInput;
        pElement.innerText = text;
      }
    }
    // Disparar eventos nativos tanto en el párrafo como en el contenedor para que el framework detecte el cambio de estado
    const pElement = textInput.querySelector('p') || textInput;
    pElement.dispatchEvent(new Event('input', { bubbles: true }));
    pElement.dispatchEvent(new Event('change', { bubbles: true }));
    textInput.dispatchEvent(new Event('input', { bubbles: true }));
    textInput.dispatchEvent(new Event('change', { bubbles: true }));
  }

  // Inyectar la imagen simulando un evento 'paste' nativo mediante DataTransfer
  if (base64Image) {
    fetch(base64Image)
      .then((res) => res.blob())
      .then((blob) => {
        const file = new File([blob], 'image_upload.png', { type: blob.type });

        // Crear un objeto DataTransfer simulando un portapapeles
        const dataTransfer = new DataTransfer();
        dataTransfer.items.add(file);

        // Crear y despachar el evento de pegado en el elemento de entrada activo
        const pasteEvent = new ClipboardEvent('paste', {
          bubbles: true,
          cancelable: true,
          clipboardData: dataTransfer,
        });

        const targetElement = document.activeElement || textInput;
        targetElement.dispatchEvent(pasteEvent);
        console.log('Evento de imagen despachado satisfactoriamente.');

        // Esperar a que Gemini procese la imagen y luego clickear enviar (aumentamos el delay inicial a 2000ms por si tarda en precargar)
        setTimeout(() => clickSendButton(), 2000);
      })
      .catch((err) => console.error('Error al procesar la imagen:', err));
  } else {
    // Sin imagen, clickear enviar después de un breve delay
    setTimeout(() => clickSendButton(), 500);
  }
}

function App() {
  const [promptText, setPromptText] = useState('');
  const [status, setStatus] = useState<{ text: string; type: 'success' | 'error' | 'processing' | '' }>({
    text: '',
    type: '',
  });
  const [isLoading, setIsLoading] = useState(false);
  const [startNewChat, setStartNewChat] = useState(() => {
    return localStorage.getItem('startNewChat') === 'true';
  });
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleToggleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const checked = e.target.checked;
    setStartNewChat(checked);
    localStorage.setItem('startNewChat', String(checked));
  };

  const handleSend = async () => {
    setIsLoading(true);
    setStatus({ text: 'Procesando...', type: 'processing' });

    try {
      // Leer la imagen como DataURL si fue seleccionada
      let imageDataUrl: string | null = null;
      const fileInput = fileInputRef.current;

      if (fileInput && fileInput.files && fileInput.files.length > 0) {
        const file = fileInput.files[0];
        imageDataUrl = await new Promise<string>((resolve) => {
          const reader = new FileReader();
          reader.onloadend = () => resolve(reader.result as string);
          reader.readAsDataURL(file);
        });
      }

      // Obtener la pestaña activa actual
      const [tab] = await browser.tabs.query({ active: true, currentWindow: true });

      if (!tab || !tab.url?.includes('gemini.google.com')) {
        setStatus({ text: 'Error: Por favor, sitúate en la pestaña de Gemini.', type: 'error' });
        setIsLoading(false);
        return;
      }

      // Ejecutar el script directamente en la página de Gemini
      await browser.scripting.executeScript({
        target: { tabId: tab.id! },
        func: injectDataIntoGemini,
        args: [promptText, imageDataUrl, startNewChat],
      });

      setStatus({ text: '¡Enviado con éxito al navegador!', type: 'success' });
    } catch (err) {
      console.error('Error al enviar:', err);
      setStatus({ text: `Error: ${(err as Error).message}`, type: 'error' });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <>
      <h3>Control Manual</h3>

      {/* Interruptor para Iniciar en un nuevo chat */}
      <div className="toggle-field">
        <label className="toggle-label" htmlFor="startNewChat">
          ¿Iniciar en un nuevo chat?
        </label>
        <label className="switch">
          <input
            type="checkbox"
            id="startNewChat"
            checked={startNewChat}
            onChange={handleToggleChange}
          />
          <span className="slider"></span>
        </label>
      </div>

      <div className="field">
        <label htmlFor="promptText">Texto / Prompt:</label>
        <textarea
          id="promptText"
          placeholder="Escribe el prompt aquí..."
          value={promptText}
          onChange={(e) => setPromptText(e.target.value)}
        />
      </div>

      <div className="field">
        <label htmlFor="imageFile">Seleccionar Imagen:</label>
        <input
          type="file"
          id="imageFile"
          accept="image/png, image/jpeg"
          ref={fileInputRef}
        />
      </div>

      <button className="send-btn" onClick={handleSend} disabled={isLoading}>
        {isLoading ? 'Enviando...' : 'Cargar en Gemini'}
      </button>

      {status.text && (
        <div className={`status ${status.type}`}>{status.text}</div>
      )}
    </>
  );
}

export default App;
