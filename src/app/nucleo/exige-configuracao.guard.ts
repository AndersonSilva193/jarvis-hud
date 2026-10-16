import { inject } from '@angular/core';
import { Router, type CanActivateFn } from '@angular/router';

import { ConfigStore } from './config.store';

/** Sem URL e token não há HUD nenhum para mostrar: manda para a tela de configuração. */
export const exigeConfiguracao: CanActivateFn = (rota) => {
  const config = inject(ConfigStore);
  return config.configurado() ? true : inject(Router).createUrlTree(['/configuracao'], {
    queryParams: rota.queryParamMap.get('inicio') === '1' ? { inicio: '1' } : {},
  });
};
