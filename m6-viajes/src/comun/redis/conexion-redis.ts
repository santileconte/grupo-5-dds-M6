import { Logger, OnApplicationShutdown } from '@nestjs/common';
import Redis from 'ioredis';

export const CONEXION_REDIS = Symbol('ConexionRedis');

/**
 * Conexión única a Redis, compartida por la idempotencia y el límite de pedidos (RNF-11).
 *
 * Los comandos tienen timeout y no se encolan si Redis no está conectado: fallan rápido y quien
 * los usa decide qué hacer (RNF-13). Se reconecta sola, cada vez más espaciado.
 */
export class ConexionRedis implements OnApplicationShutdown {
  readonly cliente: Redis;
  private readonly logger = new Logger('Redis');
  private desconectado = false;
  private esperando?: Promise<void>;
  private cerrando = false;

  constructor(
    url: string,
    private readonly timeoutMs = 1000,
  ) {
    this.cliente = new Redis(url, {
      commandTimeout: timeoutMs,
      connectTimeout: timeoutMs * 2,
      disconnectTimeout: timeoutMs,
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
      // Reintenta conectar cada vez más espaciado, hasta cada 5 segundos (salvo que se esté cerrando).
      retryStrategy: (intento) => (this.cerrando ? null : Math.min(intento * 500, 5000)),
    });
    // Sin este manejador, un error de conexión tiraría abajo el proceso. Se avisa una vez por caída.
    this.cliente.on('error', (error) => {
      if (!this.desconectado) this.logger.warn(`Sin conexión con Redis: ${String(error)}`);
      this.desconectado = true;
    });
    this.cliente.on('ready', () => {
      if (this.desconectado) this.logger.log('Conexión con Redis restablecida');
      this.desconectado = false;
    });
  }

  /**
   * Si la conexión todavía se está estableciendo (al arrancar o tras una caída), espera hasta
   * `timeoutMs` a que esté lista. Si no lo logra, falla en vez de quedarse esperando.
   */
  esperarConexion(): Promise<void> {
    if (this.cliente.status === 'ready') return Promise.resolve();
    // Todos los pedidos que llegan mientras se conecta comparten la misma espera.
    this.esperando ??= new Promise<void>((resolver, rechazar) => {
      const listo = () => {
        clearTimeout(limite);
        resolver();
      };
      const limite = setTimeout(() => {
        this.cliente.off('ready', listo);
        rechazar(new Error('Redis no está disponible'));
      }, this.timeoutMs);
      this.cliente.once('ready', listo);
    }).finally(() => (this.esperando = undefined));
    return this.esperando;
  }

  /** Para /salud/detalle: falla si Redis no responde a tiempo. */
  async verificarConexion(): Promise<void> {
    await this.esperarConexion();
    await this.cliente.ping();
  }

  async onApplicationShutdown(): Promise<void> {
    this.cerrando = true;
    if (this.cliente.status === 'ready') {
      await this.cliente.quit().catch(() => this.cliente.disconnect());
    } else {
      this.cliente.disconnect(); // corta también los reintentos de conexión pendientes
    }
  }
}
