import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { Request } from 'express';
import { Actor } from '../viajes/dominio/tipos';
import { Contexto } from '../viajes/aplicacion/viajes.service';

/** Pedido HTTP con los datos que agregan el middleware de correlación y el guard de autenticación. */
export interface PedidoConContexto extends Request {
  idCorrelacion: string;
  actor?: Actor;
}

/** Inyecta en el controlador el actor autenticado y el id de correlación del pedido. */
export const Ctx = createParamDecorator((_: unknown, ejecucion: ExecutionContext): Contexto => {
  const pedido = ejecucion.switchToHttp().getRequest<PedidoConContexto>();
  return { actor: pedido.actor as Actor, idCorrelacion: pedido.idCorrelacion };
});
