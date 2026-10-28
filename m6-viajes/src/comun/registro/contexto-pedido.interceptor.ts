import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable, tap } from 'rxjs';
import { PedidoConContexto } from '../contexto';
import { contextoPedido } from './contexto-pedido';

/**
 * Completa el contexto del pedido con el viaje (y la reserva, si hay) para que los logs se puedan
 * buscar por tripId o reservationId: los toma de la ruta (/trips/:tripId) o de la respuesta.
 */
@Injectable()
export class ContextoPedidoInterceptor implements NestInterceptor {
  intercept(ejecucion: ExecutionContext, siguiente: CallHandler): Observable<unknown> {
    const contexto = contextoPedido.actual();
    const pedido = ejecucion.switchToHttp().getRequest<PedidoConContexto>();
    const tripId = pedido.params?.tripId;
    if (contexto && typeof tripId === 'string') {
      contexto.tripId = tripId;
    }
    return siguiente.handle().pipe(
      tap((cuerpo) => {
        if (!contexto || typeof cuerpo !== 'object' || cuerpo === null) return;
        const { id, reservationId, state } = cuerpo as { id?: unknown; reservationId?: unknown; state?: unknown };
        // Sólo las respuestas que son un viaje (tienen id y estado).
        if (typeof id === 'string' && typeof state === 'string') contexto.tripId ??= id;
        if (typeof reservationId === 'string') contexto.reservationId = reservationId;
      }),
    );
  }
}
