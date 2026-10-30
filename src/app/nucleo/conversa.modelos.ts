export interface AnexoConversa {
  id: string;
  tipo: 'imagem' | 'arquivo' | 'link';
  nome: string;
  mime: string;
  url: string;
  expiraEm: string | null;
}
export interface ConfirmacaoConversa {
  codigo: string;
  descricao: string;
  expiraEm: string;
}
export interface RespostaConversa {
  id: string;
  canal: 'hud' | 'telegram';
  texto: string;
  anexos: AnexoConversa[];
  confirmacao: ConfirmacaoConversa | null;
  concluidoEm: string;
  erro: string | null;
  /** O que se ouve, quando difere do texto (o aviso "Anotei" fica só na tela). */
  fala?: string | null;
  /** O comando curto do holograma: a cena mexendo é a resposta, e a HUD só toca um som. */
  silenciosa?: boolean;
  escuta?: {
    tempoSegundos: number;
    opcoes?: string[];
    motivo?: string;
  };
}
export interface PedidoConversa {
  id: string;
  canal: 'hud';
  texto: string;
  estado: 'aguardando' | 'processando';
  iniciadoEm: string;
}
export interface ProgressoConversa {
  id: string;
  canal: string;
  nome: string;
  descricao: string;
  passo: number | null;
  total: number | null;
}
export interface TrocaConversa {
  id: string;
  canal: string;
  pedido: string;
  resposta: RespostaConversa;
}
export interface HistoricoConversa {
  sessao: string;
  revisao: number;
  trocas: TrocaConversa[];
  emAndamento: PedidoConversa | null;
  ultima: RespostaConversa | null;
}
