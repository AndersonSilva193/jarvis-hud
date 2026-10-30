import { Routes } from '@angular/router';

import { exigeConfiguracao } from './nucleo/exige-configuracao.guard';

export const routes: Routes = [
  {
    path: 'configuracao',
    loadComponent: () =>
      import('./paginas/configuracao/configuracao.page').then((m) => m.ConfiguracaoPage),
  },
  // O celular como controle do holograma: abre pelo QR, sem HUD_TOKEN, então sem o guard.
  {
    path: 'controle',
    loadComponent: () => import('./paginas/controle/controle.page').then((m) => m.ControlePage),
  },
  {
    path: '',
    canActivate: [exigeConfiguracao],
    loadComponent: () => import('./paginas/hud/hud.page').then((m) => m.HudPage),
  },
  { path: '**', redirectTo: '' },
];
