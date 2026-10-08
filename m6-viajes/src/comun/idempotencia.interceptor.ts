import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Response } from 'express';
import { Observable, of, tap } from 'rxjs';
import { PedidoConContexto } from './contexto';

interface RespuestaGuardada {
  status: number;
  etag?: string;
  cuerpo: unknown;
  guardadaEn: number;
}

const VIGENCIA_MS = 24 * 60 * 60 * 1000;

/**
 * Soporta el header `Idempotency-Key`: si se repite un pedido exitoso con la misma clave,
 * se devuelve la respuesta original sin volver a ejecutar la acción (RNF-09).
 *
 * Las respuestas se guardan en memoria; en TP2 se moverán a Redis (RNF-11) para que funcione
 * con varias instancias del servicio. Los errores no se guardan: el cliente puede reintentar.
 */
@Injectable()
export class IdempotenciaInterceptor implements NestInterceptor {
  private readonly guardadas = new Map<string, RespuestaGuardada>();

  intercept(ejecucion: ExecutionContext, siguiente: CallHandler): Observable<unknown> {
    const pedido = ejecucion.switchToHttp().getRequest<PedidoConContexto>();
    const respuesta = ejecucion.switchToHttp().getResponse<Response>();
    const clave = pedido.header('idempotency-key');
    if (!clave) {
      return siguiente.handle();
    }

    // La clave vale para el mismo usuario y la misma operación.
    const id = `${pedido.actor?.id}|${pedido.method}|${pedido.originalUrl}|${clave}`;
    this.limpiarVencidas();
    const guardada = this.guardadas.get(id);
    if (guardada) {
      respuesta.status(guardada.status);
      if (guardada.etag) respuesta.setHeader('ETag', guardada.etag);
      respuesta.setHeader('Idempotent-Replayed', 'true');
      return of(guardada.cuerpo);
    }

    return siguiente.handle().pipe(
      tap((cuerpo) => {
        this.guardadas.set(id, {
          status: respuesta.statusCode,
          etag: respuesta.getHeader('ETag') as string | undefined,
          cuerpo,
          guardadaEn: Date.now(),
        });
      }),
    );
  }

  private limpiarVencidas(): void {
    const limite = Date.now() - VIGENCIA_MS;
    for (const [id, guardada] of this.guardadas) {
      if (guardada.guardadaEn < limite) this.guardadas.delete(id);
    }
  }
}
