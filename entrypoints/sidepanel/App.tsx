import { useState, useRef } from 'react';
import './App.css';

// Función auxiliar para buscar y clickear el botón de envío de Gemini
function clickSendButton(retries = 10, delay = 500) {
  const attempt = () => {
    // Múltiples selectores para encontrar el botón de envío de Gemini
    const sendButton = document.querySelector(
      'button.send-button, button[aria-label="Send message"], button[aria-label="Enviar mensaje"], button[data-mat-icon-name="send"], .send-button-container button, button.send-button-icon'
    ) as HTMLButtonElement | null;

    // Fallback: buscar el botón por el ícono SVG de envío (flecha)
    if (!sendButton) {
      const allButtons = document.querySelectorAll('button');
      for (const btn of allButtons) {
        // El botón de enviar suele ser circular con un ícono de flecha, y está habilitado
        const isSendLike =
          btn.querySelector('mat-icon, svg, img') &&
          !btn.disabled &&
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

    if (sendButton && !sendButton.disabled) {
      sendButton.click();
      console.log('Botón de envío clickeado.');
      return;
    }

    // Reintentar si el botón aún no está habilitado
    if (retries > 0) {
      setTimeout(() => clickSendButton(retries - 1, delay), delay);
    } else {
      console.warn('No se pudo encontrar/clickear el botón de envío después de todos los reintentos.');
    }
  };

  attempt();
}

// Función que se inyectará en la ventana de Gemini
function injectDataIntoGemini(text: string, base64Image: string | null) {
  // 1. Selector del editor de texto enriquecido de Gemini (contenteditable)
  const textInput = document.querySelector(
    'div[contenteditable="true"], rich-textarea, textarea'
  ) as HTMLElement | null;

  if (!textInput) {
    console.error('No se encontró el input de texto de Gemini.');
    return;
  }

  // Enfocar el input
  textInput.focus();

  // Inyectar el texto si existe
  if (text) {
    // Para elementos contenteditable de Angular, cambiar innerText/textContent
    textInput.innerText = text;
    // Disparar eventos nativos para que el framework detecte el cambio de estado
    textInput.dispatchEvent(new Event('input', { bubbles: true }));
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

        // Crear y despachar el evento de pegado en el elemento de entrada
        const pasteEvent = new ClipboardEvent('paste', {
          bubbles: true,
          cancelable: true,
          clipboardData: dataTransfer,
        });

        textInput.dispatchEvent(pasteEvent);
        console.log('Evento de imagen despachado satisfactoriamente.');

        // Esperar a que Gemini procese la imagen y luego clickear enviar
        setTimeout(() => clickSendButton(), 1500);
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
  const fileInputRef = useRef<HTMLInputElement>(null);

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
        args: [promptText, imageDataUrl],
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
