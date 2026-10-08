import { LoggerService, LogLevel } from '@nestjs/common';
import { contextoPedido } from './contexto-pedido';

/**
 * Logger que escribe una línea JSON por evento (logs estructurados, RNF-14), por ejemplo:
 *   {"momento":"2026-10-08T15:00:00.000Z","nivel":"info","contexto":"Pedidos","mensaje":"POST /viajes 201",
 *    "idCorrelacion":"...","viajeId":"..."}
 * Las herramientas de logs (Grafana Loki, CloudWatch, etc.) pueden filtrar por cualquier campo.
 *
 * Nunca se escriben tokens, cuerpos de pedidos ni coordenadas (RNF-19).
 */
export class RegistroJson implements LoggerService {
  constructor(private readonly escribir: (linea: string) => void = (linea) => process.stdout.write(linea + '\n')) {}

  log(mensaje: unknown, ...resto: unknown[]): void {
    this.emitir('info', mensaje, resto);
  }

  warn(mensaje: unknown, ...resto: unknown[]): void {
    this.emitir('warn', mensaje, resto);
  }

  error(mensaje: unknown, ...resto: unknown[]): void {
    // Nest llama a error(mensaje, stack, contexto).
    const [stack, ...demas] = resto;
    const conStack = typeof stack === 'string' && stack.includes('\n') ? { stack } : undefined;
    this.emitir('error', mensaje, conStack ? demas : resto, conStack);
  }

  debug(mensaje: unknown, ...resto: unknown[]): void {
    this.emitir('debug', mensaje, resto);
  }

  verbose(mensaje: unknown, ...resto: unknown[]): void {
    this.emitir('verbose', mensaje, resto);
  }

  fatal(mensaje: unknown, ...resto: unknown[]): void {
    this.emitir('fatal', mensaje, resto);
  }

  setLogLevels?(_niveles: LogLevel[]): void {}

  private emitir(nivel: string, mensaje: unknown, resto: unknown[], extra?: Record<string, unknown>): void {
    // El último argumento de Nest es el contexto (nombre del Logger): "ViajesService", "RabbitMQ", etc.
    const contexto = typeof resto[resto.length - 1] === 'string' ? (resto[resto.length - 1] as string) : undefined;
    // Se puede loguear un texto o un objeto con campos: logger.log({ mensaje: '...', estado: 201 }).
    const esObjeto = typeof mensaje === 'object' && mensaje !== null && !(mensaje instanceof Error);
    const { mensaje: texto, ...campos } = esObjeto ? (mensaje as Record<string, unknown>) : { mensaje };
    this.escribir(
      JSON.stringify({
        momento: new Date().toISOString(),
        nivel,
        ...(contexto && { contexto }),
        mensaje: String(texto ?? ''),
        ...contextoPedido.actual(),
        ...campos,
        ...extra,
      }),
    );
  }
}
