import { LoggerService, LogLevel } from '@nestjs/common';
import { contextoPedido } from './contexto-pedido';

/**
 * Logger que escribe una línea JSON por evento (logs estructurados, RNF-14), por ejemplo:
 *   {"momento":"2026-10-08T15:00:00.000Z","nivel":"info","contexto":"Pedidos","mensaje":"POST /trips 201",
 *    "idCorrelacion":"...","viajeId":"..."}
 * Las herramientas de logs (Grafana Loki, CloudWatch, etc.) pueden filtrar por cualquier campo.
 *
 * Nunca se escriben tokens, cuerpos de pedidos ni coordenadas (RNF-19).
 */
export class RegistroJson implements LoggerService {
  constructor(private readonly escribir: (linea: string) => void = (linea) => process.stdout.write(linea + '\n')) {}

  log(message: unknown, ...resto: unknown[]): void {
    this.emitir('info', message, resto);
  }

  warn(message: unknown, ...resto: unknown[]): void {
    this.emitir('warn', message, resto);
  }

  error(message: unknown, ...resto: unknown[]): void {
    // Nest llama a error(mensaje, stack, contexto).
    const [stack, ...demas] = resto;
    const conStack = typeof stack === 'string' && stack.includes('\n') ? { stack } : undefined;
    this.emitir('error', message, conStack ? demas : resto, conStack);
  }

  debug(message: unknown, ...resto: unknown[]): void {
    this.emitir('debug', message, resto);
  }

  verbose(message: unknown, ...resto: unknown[]): void {
    this.emitir('verbose', message, resto);
  }

  fatal(message: unknown, ...resto: unknown[]): void {
    this.emitir('fatal', message, resto);
  }

  setLogLevels?(_niveles: LogLevel[]): void {}

  private emitir(nivel: string, message: unknown, resto: unknown[], extra?: Record<string, unknown>): void {
    // El último argumento de Nest es el contexto (nombre del Logger): "ViajesService", "RabbitMQ", etc.
    const contexto = typeof resto[resto.length - 1] === 'string' ? (resto[resto.length - 1] as string) : undefined;
    // Se puede loguear un texto o un objeto con campos: logger.log({ mensaje: '...', estado: 201 }).
    const esObjeto = typeof message === 'object' && message !== null && !(message instanceof Error);
    const { message: texto, ...campos } = esObjeto ? (message as Record<string, unknown>) : { message };
    this.escribir(
      JSON.stringify({
        momento: new Date().toISOString(),
        nivel,
        ...(contexto && { contexto }),
        message: String(texto ?? ''),
        ...contextoPedido.actual(),
        ...campos,
        ...extra,
      }),
    );
  }
}
