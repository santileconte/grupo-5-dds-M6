import { ConexionRedis } from '../redis/conexion-redis';

export interface ResultadoConteo {
  /** Pedidos hechos en la ventana actual, contando éste. */
  cantidad: number;
  /** Milisegundos hasta que la ventana se reinicia. */
  reiniciaEnMs: number;
}

/** Cuenta pedidos por clave en ventanas de tiempo fijas. */
export interface ContadorPedidos {
  incrementar(clave: string, ventanaMs: number): Promise<ResultadoConteo>;
}

export const CONTADOR_PEDIDOS = Symbol('ContadorPedidos');

/** En memoria: sirve con una sola instancia del servicio. */
export class ContadorPedidosEnMemoria implements ContadorPedidos {
  private readonly ventanas = new Map<string, { cantidad: number; vence: number }>();

  async incrementar(clave: string, ventanaMs: number): Promise<ResultadoConteo> {
    const ahora = Date.now();
    let ventana = this.ventanas.get(clave);
    if (!ventana || ventana.vence <= ahora) {
      if (this.ventanas.size > 10_000) this.limpiar(ahora);
      ventana = { cantidad: 0, vence: ahora + ventanaMs };
      this.ventanas.set(clave, ventana);
    }
    ventana.cantidad += 1;
    return { cantidad: ventana.cantidad, reiniciaEnMs: ventana.vence - ahora };
  }

  private limpiar(ahora: number): void {
    for (const [clave, ventana] of this.ventanas) if (ventana.vence <= ahora) this.ventanas.delete(clave);
  }
}

/** En Redis: el límite se respeta aunque haya varias instancias del servicio. */
export class ContadorPedidosRedis implements ContadorPedidos {
  constructor(private readonly redis: ConexionRedis) {}

  async incrementar(clave: string, ventanaMs: number): Promise<ResultadoConteo> {
    await this.redis.esperarConexion();
    // INCR suma 1 de forma atómica; PEXPIRE NX pone el vencimiento sólo la primera vez.
    const resultados = await this.redis.cliente.multi().incr(clave).pexpire(clave, ventanaMs, 'NX').pttl(clave).exec();
    if (!resultados) throw new Error('Redis no ejecutó el contador');
    const [[errorIncr, cantidad], , [errorTtl, ttl]] = resultados;
    if (errorIncr || errorTtl) throw errorIncr ?? errorTtl;
    return { cantidad: Number(cantidad), reiniciaEnMs: Math.max(0, Number(ttl)) };
  }
}
