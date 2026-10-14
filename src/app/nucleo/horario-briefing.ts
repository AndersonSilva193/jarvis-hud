import type { Briefing } from './briefing.modelos';

/** Usa o fuso do servidor; em APIs antigas preserva o relógio contido no offset ISO. */
export function contextoBriefing(briefing: Briefing): { abertura: string; geracao: string } {
  let data = new Date(briefing.geradoEm);
  let fuso = briefing.fusoHorario;
  if (!Number.isFinite(data.getTime())) return { abertura: briefing.abertura?.trim() || 'Olá, senhor. Seu briefing está disponível.', geracao: 'Horário de geração indisponível' };
  try { if (fuso) new Intl.DateTimeFormat('pt-BR', { timeZone: fuso }).format(data); }
  catch { fuso = undefined; }
  if (!fuso) {
    const local = briefing.geradoEm.match(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?)(Z|[+-]\d{2}:\d{2})$/);
    if (local) data = new Date(local[1] + 'Z');
    fuso = 'UTC';
  }
  const hora = Number(new Intl.DateTimeFormat('en-GB', { timeZone: fuso, hour:'2-digit', hourCycle:'h23' }).format(data));
  const saudacao = hora >= 5 && hora < 12 ? 'Bom dia' : hora >= 12 && hora < 18 ? 'Boa tarde' : 'Boa noite';
  const abertura = briefing.abertura?.trim() || `${saudacao}, ${briefing.nomeUsuario || 'senhor'}!`;
  const geracao = new Intl.DateTimeFormat('pt-BR', {timeZone:fuso, day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'}).format(data);
  return { abertura, geracao };
}
