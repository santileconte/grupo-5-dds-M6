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

/** 409: otro pedido con la misma Idempotency-Key todavía se está procesando. */
export class PedidoEnCursoError extends ErrorDominio {
  readonly codigo = 'PEDIDO_EN_CURSO';
  constructor() {
    super('Ya hay un pedido con esta Idempotency-Key en proceso; reintentá en unos segundos');
  }
}

/** 422: la Idempotency-Key ya se usó con un cuerpo distinto. */
export class ClaveIdempotenciaReutilizadaError extends ErrorDominio {
  readonly codigo = 'CLAVE_IDEMPOTENCIA_REUTILIZADA';
  constructor() {
    super('Esta Idempotency-Key ya se usó con otros datos; usá una clave nueva para un pedido distinto');
  }
}
