import { ErrorDominio } from '../dominio/errores';

/** 404: el viaje no existe o el usuario no puede verlo. */
export class ViajeNoEncontradoError extends ErrorDominio {
  readonly codigo = 'VIAJE_NO_ENCONTRADO';
  constructor(readonly viajeId: string) {
    super(`No existe el viaje ${viajeId}`);
  }
}

/** 409: otro pedido modificó el viaje entre que lo leímos y lo guardamos. */
export class ConflictoConcurrenciaError extends ErrorDominio {
  readonly codigo = 'CONFLICTO_CONCURRENCIA';
  constructor(readonly viajeId: string) {
    super(`El viaje ${viajeId} fue modificado por otro pedido; volvé a consultarlo`);
  }
}

/** 409: la solicitud ya tiene un viaje activo con otra asignación. */
export class ViajeActivoExistenteError extends ErrorDominio {
  readonly codigo = 'VIAJE_ACTIVO_EXISTENTE';
  constructor(readonly solicitudId: string) {
    super(`La solicitud ${solicitudId} ya tiene un viaje activo`);
  }
}

/** 412: el If-Match no coincide con la versión actual. */
export class PrecondicionFallidaError extends ErrorDominio {
  readonly codigo = 'PRECONDICION_FALLIDA';
  constructor(versionEsperada: number, versionActual: number) {
    super(`Se esperaba la versión ${versionEsperada} pero el viaje está en la versión ${versionActual}`);
  }
}

/** 422: el código QR es incorrecto, venció o ya se usó. */
export class CodigoVerificacionInvalidoError extends ErrorDominio {
  readonly codigo = 'CODIGO_VERIFICACION_INVALIDO';
  constructor() {
    super('El código de verificación es incorrecto, venció o ya fue usado');
  }
}

/** 503: un módulo externo no respondió a tiempo (RNF-13). */
export class DependenciaNoDisponibleError extends ErrorDominio {
  readonly codigo = 'DEPENDENCIA_NO_DISPONIBLE';
  constructor(
    readonly dependencia: string,
    readonly reintentarEnSegundos = 5,
  ) {
    super(`${dependencia} no está disponible en este momento; reintentá en unos segundos`);
  }
}

/** 403: el rol no puede usar esta consulta. */
export class ConsultaNoPermitidaError extends ErrorDominio {
  readonly codigo = 'PROHIBIDO';
}
