import { ErrorDominio, DatosInvalidosError } from '../viajes/dominio/errores';

/** 401: falta el token o no es válido. */
export class NoAutenticadoError extends ErrorDominio {
  readonly code = 'UNAUTHENTICATED';
}

export interface ErrorDeCampo {
  field: string;
  message: string;
}

/** 400 con el detalle de cada campo inválido. */
export class ValidacionError extends DatosInvalidosError {
  constructor(readonly errors: ErrorDeCampo[]) {
    super('Hay datos inválidos en el pedido');
  }
}

/** 409: otro pedido con la misma Idempotency-Key todavía se está procesando. */
export class PedidoEnCursoError extends ErrorDominio {
  readonly code = 'REQUEST_IN_PROGRESS';
  constructor() {
    super('Ya hay un pedido con esta Idempotency-Key en proceso; reintentá en unos segundos');
  }
}

/** 422: la Idempotency-Key ya se usó con un cuerpo distinto. */
export class ClaveIdempotenciaReutilizadaError extends ErrorDominio {
  readonly code = 'IDEMPOTENCY_KEY_REUSED';
  constructor() {
    super('Esta Idempotency-Key ya se usó con otros datos; usá una clave nueva para un pedido distinto');
  }
}

/** 429: se superó el límite de pedidos por minuto. */
export class DemasiadosPedidosError extends ErrorDominio {
  readonly code = 'TOO_MANY_REQUESTS';
  constructor(readonly reintentarEnSegundos: number) {
    super(`Superaste el límite de pedidos por minuto; reintentá en ${reintentarEnSegundos} s`);
  }
}
