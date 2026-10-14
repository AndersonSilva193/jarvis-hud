/** O que a API responde quando a HUD pergunta como falar uma frase. */
export interface RespostaVoz {
  /** 'elevenlabs' quando há MP3 para tocar, 'navegador' quando a HUD fala sozinha. */
  provedor: 'elevenlabs' | 'navegador';
  /** Rota relativa do MP3 (ex.: /api/voz/audio/abc...), só com provedor 'elevenlabs'. */
  url?: string | null;
  /** Por que a HUD vai falar sozinha: 'reserva', 'cota', 'chave', 'desligado', 'indisponivel'. */
  motivo?: string | null;
}

/** O estado da cota, como o rodapé mostra. */
export interface StatusVoz {
  provedor: 'elevenlabs' | 'navegador';
  caracteresUsados: number;
  limite: number;
  percentual: number;
  /** Data ISO-8601 da renovação, ou null quando a API não informa. */
  renovaEm: string | null;
  /** Motivo em uma palavra, ou null quando a voz está na ElevenLabs. */
  motivo: string | null;
  explicacao: string | null;
}
