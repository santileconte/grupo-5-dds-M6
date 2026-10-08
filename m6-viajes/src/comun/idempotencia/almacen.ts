/** Respuesta exitosa guardada para devolverla igual si se repite el pedido. */
export interface RespuestaGuardada {
  /** Huella (hash) del cuerpo del pedido original, para detectar una clave reutilizada con otro cuerpo. */
  huella: string;
  status: number;
  etag?: string;
  cuerpo: unknown;
}

/** Resultado de intentar reservar una clave de idempotencia. */
export type EstadoClave =
  | { estado: 'RESERVADA' } // nadie la usó: este pedido se procesa
  | { estado: 'EN_CURSO'; huella: string } // otro pedido con la misma clave se está procesando ahora
  | { estado: 'COMPLETA'; respuesta: RespuestaGuardada }; // ya se procesó: devolver la misma respuesta

/**
 * Dónde se guardan las claves de `Idempotency-Key` (RNF-09, RNF-11).
 * Hay dos implementaciones: en memoria (una sola instancia, se pierde al reiniciar) y Redis.
 */
export interface AlmacenIdempotencia {
  /** Reserva la clave de forma atómica: sólo un pedido puede obtener RESERVADA. */
  reservar(clave: string, huella: string, vigenciaMs: number): Promise<EstadoClave>;
  /** Guarda la respuesta exitosa de un pedido que tenía la clave reservada. */
  completar(clave: string, respuesta: RespuestaGuardada, vigenciaMs: number): Promise<void>;
  /** Libera la clave si el pedido falló, para que el cliente pueda reintentar. */
  liberar(clave: string): Promise<void>;
}

export const ALMACEN_IDEMPOTENCIA = Symbol('AlmacenIdempotencia');
