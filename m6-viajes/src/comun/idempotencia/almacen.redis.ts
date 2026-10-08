import { Logger, OnApplicationShutdown } from '@nestjs/common';
import Redis from 'ioredis';
import { AlmacenIdempotencia, EstadoClave, RespuestaGuardada } from './almacen';

/**
 * Almacén en Redis (IDEMPOTENCIA=redis, RNF-11). Lo comparten todas las instancias del servicio y
 * sobrevive a reinicios. Las claves vencen solas (TTL), así Redis no crece indefinidamente.
 *
 * La reserva usa `SET ... NX`, que es atómico: aunque lleguen dos pedidos iguales a la vez, a
 * instancias distintas, sólo uno la obtiene.
 *
 * Los comandos tienen timeout y no se encolan si Redis no está conectado: fallan rápido y el
 * interceptor decide qué hacer (RNF-13).
 */
export class AlmacenIdempotenciaRedis implements AlmacenIdempotencia, OnApplicationShutdown {
  private readonly logger = new Logger('Redis');
  private readonly redis: Redis;
  private desconectado = false;
  private esperando?: Promise<void>;
  private cerrando = false;

  constructor(
    url: string,
    private readonly timeoutMs = 1000,
  ) {
    this.redis = new Redis(url, {
      commandTimeout: timeoutMs,
      connectTimeout: timeoutMs * 2,
      disconnectTimeout: timeoutMs,
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
      // Reintenta conectar cada vez más espaciado, hasta cada 5 segundos (salvo que se esté cerrando).
      retryStrategy: (intento) => (this.cerrando ? null : Math.min(intento * 500, 5000)),
    });
    // Sin este manejador, un error de conexión tiraría abajo el proceso. Se avisa una vez por caída.
    this.redis.on('error', (error) => {
      if (!this.desconectado) this.logger.warn(`Sin conexión con Redis: ${String(error)}`);
      this.desconectado = true;
    });
    this.redis.on('ready', () => {
      if (this.desconectado) this.logger.log('Conexión con Redis restablecida');
      this.desconectado = false;
    });
  }

  async reservar(clave: string, huella: string, vigenciaMs: number): Promise<EstadoClave> {
    await this.esperarConexion();
    // Dos intentos por si la clave vence justo entre el SET y el GET.
    for (let intento = 0; intento < 2; intento++) {
      const enCurso = JSON.stringify({ estado: 'EN_CURSO', huella });
      if ((await this.redis.set(clave, enCurso, 'PX', vigenciaMs, 'NX')) === 'OK') {
        return { estado: 'RESERVADA' };
      }
      const guardado = await this.redis.get(clave);
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
    await this.esperarConexion();
    await this.redis.set(clave, JSON.stringify({ estado: 'COMPLETA', respuesta }), 'PX', vigenciaMs);
  }

  async liberar(clave: string): Promise<void> {
    await this.esperarConexion();
    await this.redis.del(clave);
  }

  /** Para /salud/detalle: falla si Redis no responde a tiempo. */
  async verificarConexion(): Promise<void> {
    await this.esperarConexion();
    await this.redis.ping();
  }

  /**
   * Si la conexión todavía se está estableciendo (al arrancar o tras una caída), espera hasta
   * `timeoutMs` a que esté lista. Si no lo logra, falla en vez de quedarse esperando.
   */
  private esperarConexion(): Promise<void> {
    if (this.redis.status === 'ready') return Promise.resolve();
    // Todos los pedidos que llegan mientras se conecta comparten la misma espera.
    this.esperando ??= new Promise<void>((resolver, rechazar) => {
      const listo = () => {
        clearTimeout(limite);
        resolver();
      };
      const limite = setTimeout(() => {
        this.redis.off('ready', listo);
        rechazar(new Error('Redis no está disponible'));
      }, this.timeoutMs);
      this.redis.once('ready', listo);
    }).finally(() => (this.esperando = undefined));
    return this.esperando;
  }

  async onApplicationShutdown(): Promise<void> {
    this.cerrando = true;
    if (this.redis.status === 'ready') {
      await this.redis.quit().catch(() => this.redis.disconnect());
    } else {
      this.redis.disconnect(); // corta también los reintentos de conexión pendientes
    }
  }
}
