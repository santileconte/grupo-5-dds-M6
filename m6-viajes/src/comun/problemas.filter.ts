import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { Response } from 'express';
import { DependenciaNoDisponibleError } from '../viajes/aplicacion/errores';
import { ErrorDominio, TransicionInvalidaError } from '../viajes/dominio/errores';
import { PedidoConContexto } from './contexto';
import { DemasiadosPedidosError, ValidacionError } from './errores-http';

/** Estado HTTP y título de cada código de error del contrato. */
export const CODIGOS: Record<string, { status: number; titulo: string }> = {
  VALIDATION: { status: 400, titulo: 'Datos inválidos' },
  UNAUTHENTICATED: { status: 401, titulo: 'No autenticado' },
  PAYLOAD_TOO_LARGE: { status: 413, titulo: 'El cuerpo del pedido es demasiado grande' },
  FORBIDDEN: { status: 403, titulo: 'Acción no permitida' },
  TRIP_NOT_FOUND: { status: 404, titulo: 'Viaje no encontrado' },
  ROUTE_NOT_FOUND: { status: 404, titulo: 'Ruta no encontrada' },
  INVALID_STATE_TRANSITION: { status: 409, titulo: 'Transición inválida' },
  CONCURRENCY_CONFLICT: { status: 409, titulo: 'Conflicto de concurrencia' },
  REQUEST_ID_CONFLICT: { status: 409, titulo: 'El requestId ya tiene un viaje con otros datos' },
  REQUEST_IN_PROGRESS: { status: 409, titulo: 'Pedido en curso' },
  PRECONDITION_FAILED: { status: 412, titulo: 'La versión no coincide' },
  INVALID_VERIFICATION_CODE: { status: 422, titulo: 'Código de verificación inválido' },
  REASON_NOT_ALLOWED: { status: 422, titulo: 'Motivo de cancelación no permitido' },
  IDEMPOTENCY_KEY_REUSED: { status: 422, titulo: 'Idempotency-Key reutilizada' },
  TOO_MANY_REQUESTS: { status: 429, titulo: 'Demasiados pedidos' },
  INTERNAL_ERROR: { status: 500, titulo: 'Error interno' },
  DEPENDENCY_UNAVAILABLE: { status: 503, titulo: 'Dependencia no disponible' },
};

/**
 * Convierte cualquier error en una respuesta application/problem+json (RFC 9457)
 * con el `codigo` definido en el contrato OpenAPI.
 */
@Catch()
export class ProblemasFilter implements ExceptionFilter {
  private readonly logger = new Logger(ProblemasFilter.name);

  catch(error: unknown, host: ArgumentsHost): void {
    const pedido = host.switchToHttp().getRequest<PedidoConContexto>();
    const respuesta = host.switchToHttp().getResponse<Response>();

    const { code, detail, extra } = this.clasificar(error, pedido);
    const { status, titulo } = CODIGOS[code];

    if (error instanceof DependenciaNoDisponibleError || error instanceof DemasiadosPedidosError) {
      respuesta.setHeader('Retry-After', String(error.reintentarEnSegundos));
    }

    respuesta
      .status(status)
      .type('application/problem+json')
      .json({
        type: `https://movilidad.example/errors/${code.toLowerCase().replace(/_/g, '-')}`,
        title: titulo,
        status,
        code,
        detail: detail,
        // `message` y `timestamp` son el formato de error del Grupo 12: sus clientes también nos entienden.
        message: detail,
        timestamp: new Date().toISOString(),
        instance: pedido.originalUrl,
        correlationId: pedido.correlationId,
        ...extra,
      });
  }

  private clasificar(
    error: unknown,
    pedido: PedidoConContexto,
  ): { code: string; detail: string; extra?: Record<string, unknown> } {
    if (error instanceof ValidacionError) {
      return { code: error.code, detail: error.message, extra: { errors: error.errors } };
    }
    if (error instanceof TransicionInvalidaError) {
      return { code: error.code, detail: error.message, extra: { currentState: error.currentState } };
    }
    if (error instanceof ErrorDominio && error.code in CODIGOS) {
      return { code: error.code, detail: error.message };
    }
    // Errores del lector de JSON (body-parser), que no son HttpException.
    const tipo = (error as { type?: unknown })?.type;
    if (tipo === 'entity.too.large') {
      return { code: 'PAYLOAD_TOO_LARGE', detail: 'El cuerpo del pedido supera el tamaño máximo permitido' };
    }
    if (typeof tipo === 'string' && tipo.startsWith('entity.')) {
      return { code: 'VALIDATION', detail: 'El cuerpo del pedido no es un JSON válido' };
    }
    if (error instanceof HttpException) {
      const status = error.getStatus();
      if (status === HttpStatus.NOT_FOUND) {
        return { code: 'ROUTE_NOT_FOUND', detail: `No existe ${pedido.method} ${pedido.path}` };
      }
      if (status < 500) {
        // Por ejemplo, un JSON mal formado en el cuerpo.
        return { code: 'VALIDATION', detail: error.message };
      }
    }
    this.logger.error(`Error no controlado [${pedido.correlationId}]`, error instanceof Error ? error.stack : error);
    return { code: 'INTERNAL_ERROR', detail: 'Ocurrió un error inesperado' };
  }
}
