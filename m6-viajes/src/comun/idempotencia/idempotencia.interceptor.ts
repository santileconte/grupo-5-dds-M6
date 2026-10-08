import { createHash } from 'node:crypto';
import { CallHandler, ExecutionContext, Inject, Injectable, Logger, NestInterceptor } from '@nestjs/common';
import { Response } from 'express';
import { catchError, from, mergeMap, Observable, of, throwError } from 'rxjs';
import { PedidoConContexto } from '../contexto';
import { ClaveIdempotenciaReutilizadaError, PedidoEnCursoError, ValidacionError } from '../errores-http';
import { ALMACEN_IDEMPOTENCIA, AlmacenIdempotencia, EstadoClave } from './almacen';

/** Cuánto se recuerda una respuesta exitosa. */
const VIGENCIA_RESPUESTA_MS = 24 * 60 * 60 * 1000;
/** Si el proceso se cae a mitad de un pedido, la clave se libera sola después de este tiempo. */
const VIGENCIA_EN_CURSO_MS = 30 * 1000;
const LARGO_MAXIMO_CLAVE = 200;

/**
 * Soporta el header `Idempotency-Key` (RNF-09):
 * - Si se repite un pedido exitoso con la misma clave, devuelve la respuesta original sin volver a
 *   ejecutar la acción (con el header `Idempotent-Replayed: true`).
 * - Si llega un pedido con la misma clave mientras el primero todavía se procesa, responde
 *   `409 PEDIDO_EN_CURSO`.
 * - Si la misma clave se usa con otro cuerpo, responde `422 CLAVE_IDEMPOTENCIA_REUTILIZADA`.
 * - Los errores no se guardan: el cliente puede reintentar con la misma clave.
 *
 * Si el almacén (Redis) no está disponible, el pedido se procesa igual y se registra un aviso.
 * Las reglas del dominio (versión y estados) siguen impidiendo efectos duplicados (RNF-08, RNF-13).
 */
@Injectable()
export class IdempotenciaInterceptor implements NestInterceptor {
  private readonly logger = new Logger('Idempotencia');

  constructor(@Inject(ALMACEN_IDEMPOTENCIA) private readonly almacen: AlmacenIdempotencia) {}

  intercept(ejecucion: ExecutionContext, siguiente: CallHandler): Observable<unknown> {
    const pedido = ejecucion.switchToHttp().getRequest<PedidoConContexto>();
    const respuesta = ejecucion.switchToHttp().getResponse<Response>();
    const clave = pedido.header('idempotency-key');
    if (clave === undefined) {
      return siguiente.handle();
    }
    if (clave.length === 0 || clave.length > LARGO_MAXIMO_CLAVE) {
      throw new ValidacionError([
        { campo: 'Idempotency-Key', mensaje: `debe tener entre 1 y ${LARGO_MAXIMO_CLAVE} caracteres` },
      ]);
    }

    // La clave vale para el mismo usuario y la misma operación.
    const id = `m6:idempotencia:${pedido.actor?.id}:${pedido.method}:${pedido.originalUrl}:${clave}`;
    const huella = createHash('sha256').update(JSON.stringify(pedido.body ?? null)).digest('hex');

    return from(this.reservar(id, huella)).pipe(
      mergeMap((resultado) => {
        if (resultado === null) {
          return siguiente.handle(); // almacén no disponible: se procesa sin idempotencia
        }
        if (resultado.estado === 'COMPLETA') {
          if (resultado.respuesta.huella !== huella) throw new ClaveIdempotenciaReutilizadaError();
          respuesta.status(resultado.respuesta.status);
          if (resultado.respuesta.etag) respuesta.setHeader('ETag', resultado.respuesta.etag);
          respuesta.setHeader('Idempotent-Replayed', 'true');
          return of(resultado.respuesta.cuerpo);
        }
        if (resultado.estado === 'EN_CURSO') {
          throw resultado.huella === huella ? new PedidoEnCursoError() : new ClaveIdempotenciaReutilizadaError();
        }
        return siguiente.handle().pipe(
          mergeMap(async (cuerpo) => {
            await this.sinFallar(() =>
              this.almacen.completar(
                id,
                {
                  huella,
                  status: respuesta.statusCode,
                  etag: respuesta.getHeader('ETag') as string | undefined,
                  cuerpo,
                },
                VIGENCIA_RESPUESTA_MS,
              ),
            );
            return cuerpo;
          }),
          catchError((error) =>
            from(this.sinFallar(() => this.almacen.liberar(id))).pipe(mergeMap(() => throwError(() => error))),
          ),
        );
      }),
    );
  }

  /** Devuelve null si el almacén no responde, para seguir sin idempotencia en lugar de fallar. */
  private async reservar(id: string, huella: string): Promise<EstadoClave | null> {
    try {
      return await this.almacen.reservar(id, huella, VIGENCIA_EN_CURSO_MS);
    } catch (error) {
      this.logger.warn(`Almacén de idempotencia no disponible; se procesa sin Idempotency-Key: ${String(error)}`);
      return null;
    }
  }

  private async sinFallar(operacion: () => Promise<void>): Promise<void> {
    try {
      await operacion();
    } catch (error) {
      this.logger.warn(`No se pudo actualizar el almacén de idempotencia: ${String(error)}`);
    }
  }
}
