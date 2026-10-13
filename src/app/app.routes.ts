import { Routes } from '@angular/router';

import { exigeConfiguracao } from './nucleo/exige-configuracao.guard';

export const routes: Routes = [
  {
    path: 'configuracao',
    loadComponent: () =>
      import('./paginas/configuracao/configuracao.page').then((m) => m.ConfiguracaoPage),
  },
  {
    path: '',
    canActivate: [exigeConfiguracao],
    loadComponent: () => import('./paginas/hud/hud.page').then((m) => m.HudPage),
  },
  { path: '**', redirectTo: '' },
];
