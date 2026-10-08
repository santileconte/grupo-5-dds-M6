import { AccionViaje, EstadoViaje, MotivoCancelacion, Rol } from './tipos';

/**
 * Errores de dominio. Cada uno tiene un `codigo` estable que la capa HTTP traduce
 * a la respuesta problem+json definida en el contrato OpenAPI.
 */
export abstract class ErrorDominio extends Error {
  abstract readonly codigo: string;
}

/** 409: la acción no es válida en el estado actual (RF-6.1). */
export class TransicionInvalidaError extends ErrorDominio {
  readonly codigo = 'TRANSICION_INVALIDA';
  constructor(
    readonly estadoActual: EstadoViaje,
    readonly accion: AccionViaje,
  ) {
    super(`No se puede ejecutar ${accion} sobre un viaje en estado ${estadoActual}`);
  }
}

/** 403: el actor no tiene permitido ejecutar la acción sobre este viaje. */
export class AccionNoPermitidaError extends ErrorDominio {
  readonly codigo = 'PROHIBIDO';
  constructor(
    readonly rol: Rol,
    readonly accion: AccionViaje,
    razon: string,
  ) {
    super(`${rol} no puede ejecutar ${accion}: ${razon}`);
  }
}

/** 422: el motivo de cancelación no corresponde al rol o todavía no aplica. */
export class MotivoNoPermitidoError extends ErrorDominio {
  readonly codigo = 'MOTIVO_NO_PERMITIDO';
  constructor(
    readonly motivo: MotivoCancelacion,
    razon: string,
  ) {
    super(`Motivo ${motivo} no permitido: ${razon}`);
  }
}

/** 400: datos de entrada inválidos para la acción. */
export class DatosInvalidosError extends ErrorDominio {
  readonly codigo = 'VALIDACION';
}
