/**
 * O bip curto do caminho rápido do holograma: "explode", "mais", "vista de cima" mexem na cena sem
 * passar pelo modelo, e a cena mexendo já é a resposta — falar "Explodido." por cima seria ruído.
 *
 * Um oscilador do WebAudio, sem arquivo: dois tons subindo em 120 ms, baixo. O contexto é criado na
 * primeira vez e reaproveitado; navegador sem WebAudio, ou sem permissão de tocar, fica calado.
 */
let contexto: AudioContext | null = null;

export function tocarConfirmacao(): void {
  try {
    contexto ??= new AudioContext();
    if (contexto.state === 'suspended') void contexto.resume();
    const agora = contexto.currentTime;
    const ganho = contexto.createGain();
    ganho.gain.setValueAtTime(0.0001, agora);
    ganho.gain.exponentialRampToValueAtTime(0.08, agora + 0.01);
    ganho.gain.exponentialRampToValueAtTime(0.0001, agora + 0.14);
    ganho.connect(contexto.destination);
    const tom = contexto.createOscillator();
    tom.type = 'sine';
    tom.frequency.setValueAtTime(880, agora);
    tom.frequency.setValueAtTime(1320, agora + 0.06);
    tom.connect(ganho);
    tom.start(agora);
    tom.stop(agora + 0.15);
  } catch {
    /* Sem áudio: a cena mexendo basta. */
  }
}
