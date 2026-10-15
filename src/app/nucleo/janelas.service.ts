import { Service, computed, signal } from '@angular/core';
import type { ConteudoJanela, Geometria, Janela, TipoJanela } from './tela.modelos';
import { objeto } from './tela.modelos';

@Service()
export class JanelasService {
  private readonly lista = signal<Janela[]>([]);
  readonly janelas = this.lista.asReadonly();
  readonly foco = signal<string | null>(null);
  readonly aviso = signal('');
  readonly visiveis = computed(() => this.lista().filter(j => j.estado !== 'minimizada'));
  readonly minimizadas = computed(() => this.lista().filter(j => j.estado === 'minimizada'));
  readonly area = signal({ largura: 960, altura: 540 });
  readonly bandejaArea = signal<Geometria>({ x: 0, y: 0, largura: 360, altura: 300 });
  readonly origemArea = signal({ x: 0, y: 0 });
  private readonly normais = new Map<string, Geometria>();
  private z = 0;
  private sequencia = 0;
  private readonly prefixo = Math.random().toString(36).slice(2, 10);
  aoFechar: ((janela: Janela) => void) | null = null;

  novoId(): string { return `h_${this.prefixo}_${++this.sequencia}`; }
  abrir(conteudo: ConteudoJanela, opcoes: { id?: string; titulo: string; origem: string; selo?: string }): string {
    const id = opcoes.id ?? this.novoId();
    if (this.lista().some(j => j.id === id)) return id;
    const geometria = this.conter(this.ler(conteudo.tipo) ?? this.padrao(conteudo.tipo));
    const estado = this.abrirEspaco() ? 'normal' : 'minimizada';
    this.lista.update(lista => [...lista, { ...geometria, ...opcoes, id, tipo: conteudo.tipo, conteudo, estado, fixada: false, z: ++this.z, selo: opcoes.selo ?? conteudo.tipo.toUpperCase() }]);
    this.normais.set(id, geometria);
    if (estado === 'normal') this.foco.set(id);
    else this.aviso.set('As seis janelas estão fixadas. O novo card está na bandeja.');
    return id;
  }
  fechar(id: string): void {
    const janela = this.obter(id);
    if (!janela) return;
    this.remover(id);
    this.aoFechar?.(janela);
  }
  /** Retirada de um card transitório pela apresentação, sem simular fechamento pelo usuário. */
  retirar(id: string): void { if (!this.obter(id)?.fixada) this.remover(id); }
  obter(id: string): Janela | undefined { return this.lista().find(j => j.id === id); }
  focar(id: string, restaurar = true): void {
    if (!this.obter(id)) return;
    if (restaurar && this.obter(id)?.estado === 'minimizada') { this.restaurar(id); return; }
    if (this.foco() === id) return;
    this.alterar(id, j => ({ ...j, z: ++this.z })); this.foco.set(id);
  }
  mover(id: string, x: number, y: number): void { this.geometria(id, { x, y }); }
  redimensionar(id: string, largura: number, altura: number): void { this.geometria(id, { largura, altura }); }
  minimizar(id: string): void {
    if (!this.obter(id)) return;
    this.alterar(id, j => ({ ...j, estado: 'minimizada' })); this.repararFoco();
  }
  maximizar(id: string): void {
    const janela = this.obter(id);
    if (!janela || janela.estado === 'minimizada' && !this.abrirEspaco(id)) return;
    this.alterar(id, j => ({ ...j, x: 0, y: 0, ...this.area(), estado: 'maximizada', z: ++this.z })); this.foco.set(id);
  }
  restaurar(id: string): void {
    const janela = this.obter(id);
    if (!janela || janela.estado === 'minimizada' && !this.abrirEspaco(id)) return;
    this.alterar(id, j => ({ ...j, ...this.conter(this.normais.get(id) ?? j), estado: 'normal', z: ++this.z })); this.foco.set(id);
  }
  fixar(id: string, fixada = true): void { this.alterar(id, j => ({ ...j, fixada })); }
  atualizarMidia(id: string, conteudo: ConteudoJanela, titulo: string): void { this.alterar(id, j => ({ ...j, conteudo, titulo })); }
  limpar(): void { this.lista().filter(j => !j.fixada).forEach(j => this.fechar(j.id)); }
  fecharTudo(): void { this.lista().forEach(j => this.fechar(j.id)); }
  definirArea(largura: number, altura: number): void {
    if (!Number.isFinite(largura) || !Number.isFinite(altura) || largura <= 0 || altura <= 0) return;
    if (this.area().largura === largura && this.area().altura === altura) return;
    this.area.set({ largura, altura });
    this.lista.update(lista => lista.map(j => ({ ...j, ...(j.estado === 'maximizada' ? { x: 0, y: 0, largura, altura } : this.conter(j)) })));
  }
  private alterar(id: string, transformar: (j: Janela) => Janela): void { this.lista.update(lista => lista.map(j => j.id === id ? transformar(j) : j)); }
  private remover(id: string): void { this.lista.update(lista => lista.filter(j => j.id !== id)); this.normais.delete(id); this.repararFoco(); }
  private repararFoco(): void {
    if (!this.visiveis().some(j => j.id === this.foco())) this.foco.set([...this.visiveis()].sort((a,b) => b.z - a.z)[0]?.id ?? null);
  }
  private abrirEspaco(exceto?: string): boolean {
    const visiveis = this.visiveis().filter(j => j.id !== exceto);
    if (visiveis.length < 6) return true;
    const antiga = visiveis.find(j => !j.fixada);
    if (!antiga) { this.aviso.set('Minimize uma janela fixada para abrir espaço.'); return false; }
    this.minimizar(antiga.id); return true;
  }
  private geometria(id: string, parte: Partial<Geometria>): void {
    const j = this.obter(id);
    if (!j || j.estado !== 'normal' || !Object.values(parte).every(Number.isFinite)) return;
    const geometria = this.conter({ ...j, ...parte });
    this.normais.set(id, geometria); this.alterar(id, atual => ({ ...atual, ...geometria }));
    try { localStorage.setItem(`jarvis-hud.janela.v1:${j.tipo}`, JSON.stringify(geometria)); } catch { /* Sem persistência. */ }
  }
  private conter(g: Geometria): Geometria {
    const area = this.area();
    const largura = Math.min(area.largura, Math.max(280, g.largura));
    const altura = Math.min(area.altura, Math.max(260, g.altura));
    return { largura, altura, x: Math.max(0, Math.min(g.x, area.largura - largura)), y: Math.max(0, Math.min(g.y, area.altura - altura)) };
  }
  private padrao(tipo: TipoJanela): Geometria {
    const largura = tipo === 'musica' ? 360 : 640, altura = tipo === 'musica' ? 390 : 440;
    const deslocamento = this.visiveis().length * 24;
    return { largura, altura, x: Math.max(0, (this.area().largura - largura) / 2) + deslocamento, y: deslocamento };
  }
  private ler(tipo: TipoJanela): Geometria | null {
    try {
      const g: unknown = JSON.parse(localStorage.getItem(`jarvis-hud.janela.v1:${tipo}`) ?? 'null');
      if (objeto(g) && ['x','y','largura','altura'].every(c => typeof g[c] === 'number' && Number.isFinite(g[c])) && Number(g['largura']) > 0 && Number(g['altura']) > 0) return g as unknown as Geometria;
    } catch { /* Geometria inválida ou armazenamento bloqueado. */ }
    return null;
  }
}
