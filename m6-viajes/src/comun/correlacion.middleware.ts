import { randomUUID } from 'node:crypto';
import { Injectable, NestMiddleware } from '@nestjs/common';
import { NextFunction, Response } from 'express';
import { PedidoConContexto } from './contexto';

const HEADER = 'x-correlation-id';

/** Toma el X-Correlation-Id del pedido (o genera uno) y lo devuelve en la respuesta (RNF-14). */
@Injectable()
export class CorrelacionMiddleware implements NestMiddleware {
  use(pedido: PedidoConContexto, respuesta: Response, siguiente: NextFunction): void {
    const recibido = pedido.header(HEADER);
    pedido.idCorrelacion = recibido && recibido.length <= 100 ? recibido : randomUUID();
    respuesta.setHeader('X-Correlation-Id', pedido.idCorrelacion);
    siguiente();
  }
}
