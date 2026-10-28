import { randomUUID } from 'node:crypto';
import { Injectable, Logger, NestMiddleware } from '@nestjs/common';
import { NextFunction, Response } from 'express';
import { PedidoConContexto } from './contexto';
import { contextoPedido } from './registro/contexto-pedido';

const HEADER = 'x-correlation-id';
/** Sólo letras, números y . _ : - (hasta 100): un valor con saltos de línea podría falsificar logs. */
const FORMATO_VALIDO = /^[A-Za-z0-9._:-]{1,100}$/;

/**
 * Correlación y registro de pedidos (RNF-14):
 * - Toma el X-Correlation-Id del pedido (o genera uno) y lo devuelve en la respuesta.
 * - Activa el contexto del pedido, para que todos sus logs lleven el idCorrelacion.
 * - Al terminar, registra una línea por pedido: método, ruta, estado, duración, rol y viaje.
 */
@Injectable()
export class CorrelacionMiddleware implements NestMiddleware {
  private readonly logger = new Logger('Pedidos');

  use(pedido: PedidoConContexto, respuesta: Response, siguiente: NextFunction): void {
    const recibido = pedido.header(HEADER);
    pedido.correlationId = recibido && FORMATO_VALIDO.test(recibido) ? recibido : randomUUID();
    respuesta.setHeader('X-Correlation-Id', pedido.correlationId);

    const contexto = { correlationId: pedido.correlationId };
    const inicio = process.hrtime.bigint();
    respuesta.on('finish', () => {
      // Los health checks se consultan cada pocos segundos: no se registran para no llenar el log.
      if (pedido.path.startsWith('/health')) return;
      contextoPedido.ejecutar(contexto, () =>
        this.logger.log({
          message: `${pedido.method} ${pedido.path} ${respuesta.statusCode}`,
          metodo: pedido.method,
          ruta: pedido.path,
          status: respuesta.statusCode,
          duracionMs: Number((process.hrtime.bigint() - inicio) / 1_000_000n),
          role: pedido.actor?.role,
        }),
      );
    });
    contextoPedido.ejecutar(contexto, () => siguiente());
  }
}
