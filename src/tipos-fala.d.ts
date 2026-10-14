/**
 * O que falta da Web Speech API nos tipos do TypeScript.
 *
 * A `lib.dom` já traz `SpeechRecognitionEvent`, `SpeechRecognitionErrorEvent` e os
 * `SpeechRecognitionResult*`, mas não a interface do controlador nem o seu construtor — e muito
 * menos o `webkitSpeechRecognition`, que é o nome pelo qual o Chrome expõe tudo isso. Só o que
 * falta é declarado aqui; os tipos de evento continuam vindo do DOM.
 */

interface SpeechRecognition extends EventTarget {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;

  start(): void;
  stop(): void;
  abort(): void;

  onstart: ((this: SpeechRecognition, evento: Event) => void) | null;
  onresult: ((this: SpeechRecognition, evento: SpeechRecognitionEvent) => void) | null;
  onerror: ((this: SpeechRecognition, evento: SpeechRecognitionErrorEvent) => void) | null;
  onend: ((this: SpeechRecognition, evento: Event) => void) | null;
}

declare const SpeechRecognition: {
  prototype: SpeechRecognition;
  new (): SpeechRecognition;
};

interface Window {
  SpeechRecognition?: typeof SpeechRecognition;
  webkitSpeechRecognition?: typeof SpeechRecognition;
}
