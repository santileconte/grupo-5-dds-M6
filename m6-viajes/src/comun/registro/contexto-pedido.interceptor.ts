import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable, tap } from 'rxjs';
import { PedidoConContexto } from '../contexto';
import { contextoPedido } from './contexto-pedido';

/**
 * Completa el contexto del pedido con el viaje (y la reserva, si hay) para que los logs se puedan
 * buscar por viajeId o reservaId: los toma de la ruta (/viajes/:viajeId) o de la respuesta.
 */
@Injectable()
export class ContextoPedidoInterceptor implements NestInterceptor {
  intercept(ejecucion: ExecutionContext, siguiente: CallHandler): Observable<unknown> {
    const contexto = contextoPedido.actual();
    const pedido = ejecucion.switchToHttp().getRequest<PedidoConContexto>();
    const viajeId = pedido.params?.viajeId;
    if (contexto && typeof viajeId === 'string') {
      contexto.viajeId = viajeId;
    }
    return siguiente.handle().pipe(
      tap((cuerpo) => {
        if (!contexto || typeof cuerpo !== 'object' || cuerpo === null) return;
        const { id, reservaId, estado } = cuerpo as { id?: unknown; reservaId?: unknown; estado?: unknown };
        // Sólo las respuestas que son un viaje (tienen id y estado).
        if (typeof id === 'string' && typeof estado === 'string') contexto.viajeId ??= id;
        if (typeof reservaId === 'string') contexto.reservaId = reservaId;
      }),
    );
  }
}
