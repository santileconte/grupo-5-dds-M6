import { AccionViaje, EstadoViaje, MotivoCancelacion, Rol } from './tipos';

/**
 * Errores de dominio. Cada uno tiene un `codigo` estable que la capa HTTP traduce
 * a la respuesta problem+json definida en el contrato OpenAPI.
 */
export abstract class ErrorDominio extends Error {
  abstract readonly code: string;
}

/** 409: la acción no es válida en el estado actual (RF-6.1). */
export class TransicionInvalidaError extends ErrorDominio {
  readonly code = 'INVALID_STATE_TRANSITION';
  constructor(
    readonly currentState: EstadoViaje,
    readonly action: AccionViaje,
  ) {
    super(`No se puede ejecutar ${action} sobre un viaje en estado ${currentState}`);
  }
}

/** 403: el actor no tiene permitido ejecutar la acción sobre este viaje. */
export class AccionNoPermitidaError extends ErrorDominio {
  readonly code = 'FORBIDDEN';
  constructor(
    readonly role: Rol,
    readonly action: AccionViaje,
    razon: string,
  ) {
    super(`${role} no puede ejecutar ${action}: ${razon}`);
  }
}

/** 422: el motivo de cancelación no corresponde al rol o todavía no aplica. */
export class MotivoNoPermitidoError extends ErrorDominio {
  readonly code = 'REASON_NOT_ALLOWED';
  constructor(
    readonly reason: MotivoCancelacion,
    razon: string,
  ) {
    super(`Motivo ${reason} no permitido: ${razon}`);
  }
}

/** 400: datos de entrada inválidos para la acción. */
export class DatosInvalidosError extends ErrorDominio {
  readonly code = 'VALIDATION';
}
