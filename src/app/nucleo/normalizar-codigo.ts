import { normalizar } from './escuta.service';

/** Aceita também códigos numéricos ditados dígito por dígito. */
export function normalizarCodigo(texto: string): string {
  const digitos: Record<string, string> = {
    zero: '0', um: '1', uma: '1', dois: '2', duas: '2', tres: '3',
    quatro: '4', cinco: '5', seis: '6', sete: '7', oito: '8', nove: '9',
  };
  return normalizar(texto)
    .split(/[^a-z0-9]+/)
    .map((parte) => digitos[parte] ?? parte)
    .join('');
}
