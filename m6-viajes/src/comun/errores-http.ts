import { ErrorDominio, DatosInvalidosError } from '../viajes/dominio/errores';

/** 401: falta el token o no es válido. */
export class NoAutenticadoError extends ErrorDominio {
  readonly codigo = 'NO_AUTENTICADO';
}

export interface ErrorDeCampo {
  campo: string;
  mensaje: string;
}

/** 400 con el detalle de cada campo inválido. */
export class ValidacionError extends DatosInvalidosError {
  constructor(readonly errores: ErrorDeCampo[]) {
    super('Hay datos inválidos en el pedido');
  }
}
