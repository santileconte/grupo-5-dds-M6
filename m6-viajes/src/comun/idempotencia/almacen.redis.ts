import { ConexionRedis } from '../redis/conexion-redis';
import { AlmacenIdempotencia, EstadoClave, RespuestaGuardada } from './almacen';

/**
 * Almacén en Redis (IDEMPOTENCIA=redis, RNF-11). Lo comparten todas las instancias del servicio y
 * sobrevive a reinicios. Las claves vencen solas (TTL), así Redis no crece indefinidamente.
 *
 * La reserva usa `SET ... NX`, que es atómico: aunque lleguen dos pedidos iguales a la vez, a
 * instancias distintas, sólo uno la obtiene.
 */
export class AlmacenIdempotenciaRedis implements AlmacenIdempotencia {
  constructor(private readonly redis: ConexionRedis) {}

  async reservar(clave: string, huella: string, vigenciaMs: number): Promise<EstadoClave> {
    await this.redis.esperarConexion();
    // Dos intentos por si la clave vence justo entre el SET y el GET.
    for (let intento = 0; intento < 2; intento++) {
      const enCurso = JSON.stringify({ estado: 'EN_CURSO', huella });
      if ((await this.redis.cliente.set(clave, enCurso, 'PX', vigenciaMs, 'NX')) === 'OK') {
        return { estado: 'RESERVADA' };
      }
      const guardado = await this.redis.cliente.get(clave);
      if (guardado) {
        const valor = JSON.parse(guardado) as
          | { estado: 'EN_CURSO'; huella: string }
          | { estado: 'COMPLETA'; respuesta: RespuestaGuardada };
        return valor.estado === 'COMPLETA'
          ? { estado: 'COMPLETA', respuesta: valor.respuesta }
          : { estado: 'EN_CURSO', huella: valor.huella };
      }
    }
    throw new Error(`No se pudo reservar la clave de idempotencia ${clave}`);
  }

  async completar(clave: string, respuesta: RespuestaGuardada, vigenciaMs: number): Promise<void> {
    await this.redis.esperarConexion();
    await this.redis.cliente.set(clave, JSON.stringify({ estado: 'COMPLETA', respuesta }), 'PX', vigenciaMs);
  }

  async liberar(clave: string): Promise<void> {
    await this.redis.esperarConexion();
    await this.redis.cliente.del(clave);
  }
}
