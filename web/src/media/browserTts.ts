import { useEffect, useState } from 'react';

// Voz del navegador (Web Speech API) como respaldo del texto libre (ADR-018).
//
// Se usa solo cuando el servidor no puede dar el audio modelo: sin conexión,
// en el demo o si la síntesis falla. Elige una voz francesa instalada en el
// sistema; si no hay ninguna, el respaldo no está disponible.

function synth(): SpeechSynthesis | null {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
    return null;
  }
  return window.speechSynthesis;
}

export function frenchBrowserVoice(): SpeechSynthesisVoice | null {
  const engine = synth();
  if (engine === null) return null;
  const voices = engine.getVoices();
  return (
    voices.find((voice) => voice.lang.toLowerCase() === 'fr-fr') ??
    voices.find((voice) => voice.lang.toLowerCase().startsWith('fr')) ??
    null
  );
}

export function browserTtsAvailable(): boolean {
  return (
    typeof SpeechSynthesisUtterance !== 'undefined' &&
    frenchBrowserVoice() !== null
  );
}

/** Lee `text` en francés; resuelve al terminar o al cancelarse. */
export function speakWithBrowser(
  text: string,
  options: { rate?: number } = {},
): Promise<void> {
  const engine = synth();
  const voice = frenchBrowserVoice();
  if (
    engine === null ||
    voice === null ||
    typeof SpeechSynthesisUtterance === 'undefined'
  ) {
    return Promise.reject(new Error('sin voz francesa en el navegador'));
  }
  engine.cancel();
  return new Promise<void>((resolve) => {
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.voice = voice;
    utterance.lang = voice.lang;
    utterance.rate = options.rate ?? 1;
    utterance.onend = () => resolve();
    utterance.onerror = () => resolve();
    engine.speak(utterance);
  });
}

// Chrome carga las voces tarde: `getVoices()` puede volver vacío al montar y
// llenarse después con el evento `voiceschanged`.
export function useBrowserFrenchVoice(): boolean {
  const [available, setAvailable] = useState(() => browserTtsAvailable());
  useEffect(() => {
    const engine = synth();
    if (engine === null || typeof engine.addEventListener !== 'function') {
      return undefined;
    }
    const update = () => setAvailable(browserTtsAvailable());
    update();
    engine.addEventListener('voiceschanged', update);
    return () => engine.removeEventListener('voiceschanged', update);
  }, []);
  return available;
}

export function cancelBrowserSpeech(): void {
  synth()?.cancel();
}
