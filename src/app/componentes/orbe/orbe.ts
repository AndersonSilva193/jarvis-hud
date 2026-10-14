import { AfterViewInit, Component, ElementRef, OnDestroy, effect, input, viewChild } from '@angular/core';

export type EstadoOrbe = 'ocioso' | 'ouvindo' | 'gerando' | 'pensando' | 'falando';

/** Filamentos orgânicos; uma única animação, suspensa fora da tela. */
@Component({selector:'app-orbe',templateUrl:'./orbe.html',styleUrl:'./orbe.scss',host:{'[attr.data-estado]':'estado()'}})
export class OrbeComponent implements AfterViewInit, OnDestroy {
  readonly estado = input<EstadoOrbe>('ocioso');
  readonly intensidade = input(0);
  private readonly tela = viewChild.required<ElementRef<HTMLCanvasElement>>('tela');
  private contexto: CanvasRenderingContext2D | null = null;
  private observador: ResizeObserver | null = null;
  private quadro: number | null = null;
  private largura=0; private altura=0; private tempo=0; private anterior=0;
  private movimento: MediaQueryList | null = null;
  constructor() { effect(() => { this.estado();this.intensidade();if(this.movimento?.matches)this.desenhar(); }); }
  ngAfterViewInit(): void {
    this.contexto=this.tela().nativeElement.getContext('2d');if(!this.contexto)return;
    this.movimento=typeof matchMedia==='function'?matchMedia('(prefers-reduced-motion: reduce)'):null;
    this.movimento?.addEventListener('change',this.atualizar);
    document.addEventListener('visibilitychange',this.atualizar);
    this.observador=new ResizeObserver(()=>this.ajustar());this.observador.observe(this.tela().nativeElement);
    this.ajustar();this.atualizar();
  }
  ngOnDestroy(): void { this.suspender();this.observador?.disconnect();document.removeEventListener('visibilitychange',this.atualizar);this.movimento?.removeEventListener('change',this.atualizar); }
  private suspender():void {if(this.quadro!==null)cancelAnimationFrame(this.quadro);this.quadro=null;this.anterior=0;}
  private readonly atualizar=()=>{this.suspender();if(document.hidden)return;this.desenhar();if(!this.movimento?.matches)this.quadro=requestAnimationFrame(this.animar);};
  private readonly animar=(agora:number)=>{this.quadro=null;if(document.hidden)return;const delta=this.anterior?Math.min((agora-this.anterior)/1000,.05):0;this.anterior=agora;this.tempo+=delta;this.desenhar();this.quadro=requestAnimationFrame(this.animar);};
  private ajustar():void {const c=this.tela().nativeElement;const d=Math.min(devicePixelRatio||1,2);this.largura=c.clientWidth;this.altura=c.clientHeight;c.width=this.largura*d;c.height=this.altura*d;this.contexto?.setTransform(d,0,0,d,0,0);this.desenhar();}
  private desenhar():void {
    const ctx=this.contexto;if(!ctx||!this.largura||!this.altura)return;
    const estado=this.estado(), trabalhando=estado==='pensando'||estado==='gerando', ouvindo=estado==='ouvindo';
    const forca=estado==='falando'?Math.max(0,Math.min(1,this.intensidade())):0;
    const tempo=this.movimento?.matches?0:this.tempo;
    const t=tempo*(trabalhando?1.1:ouvindo?.65:.28);
    const x=this.largura/2,y=this.altura/2,r=Math.min(this.largura,this.altura)*.34;
    ctx.clearRect(0,0,this.largura,this.altura);
    const halo=ctx.createRadialGradient(x,y,r*.4,x,y,r*1.6);halo.addColorStop(0,'#07357708');halo.addColorStop(.55,`rgba(18,95,255,${.09+forca*.08})`);halo.addColorStop(1,'#07182e00');
    ctx.fillStyle=halo;ctx.fillRect(0,0,this.largura,this.altura);ctx.globalCompositeOperation='lighter';
    for(let linha=0;linha<9;linha++){
      ctx.beginPath();
      for(let i=0;i<=200;i++){
        const a=i/200*Math.PI*2;
        const onda=Math.sin(a*3+t+linha*.72)*.055+Math.sin(a*5-t*.7+linha)*.023;
        const raio=r*(1+onda+forca*.09+Math.sin(t+linha)*.025);
        const px=x+Math.cos(a+t*.07+linha*.12)*raio;
        const py=y+Math.sin(a+t*.07+linha*.12)*raio*(.89+Math.sin(linha+t*.12)*.08);
        if(i===0)ctx.moveTo(px,py);else ctx.lineTo(px,py);
      }
      ctx.closePath();ctx.lineWidth=linha%3===0?1.5: .75;
      ctx.strokeStyle=linha%3===0?`rgba(60,210,255,${.4+forca*.25})`:`rgba(34,107,255,${.3+forca*.2})`;
      ctx.shadowBlur=linha%3===0?12:4;ctx.shadowColor='#178fff';ctx.stroke();
    }
    ctx.shadowBlur=0;
    if(trabalhando||ouvindo){ctx.beginPath();ctx.arc(x,y,r*1.16,t,t+(trabalhando?.8:1.8));ctx.lineWidth=2;ctx.strokeStyle=ouvindo?'#92f9ff99':'#4eacff99';ctx.stroke();}
    ctx.globalCompositeOperation='source-over';
  }
}
