import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { Response } from 'express';
import { DependenciaNoDisponibleError } from '../viajes/aplicacion/errores';
import { ErrorDominio, TransicionInvalidaError } from '../viajes/dominio/errores';
import { PedidoConContexto } from './contexto';
import { ValidacionError } from './errores-http';

/** Estado HTTP y título de cada código de error del contrato. */
export const CODIGOS: Record<string, { status: number; titulo: string }> = {
  VALIDACION: { status: 400, titulo: 'Datos inválidos' },
  NO_AUTENTICADO: { status: 401, titulo: 'No autenticado' },
  PROHIBIDO: { status: 403, titulo: 'Acción no permitida' },
  VIAJE_NO_ENCONTRADO: { status: 404, titulo: 'Viaje no encontrado' },
  RUTA_NO_ENCONTRADA: { status: 404, titulo: 'Ruta no encontrada' },
  TRANSICION_INVALIDA: { status: 409, titulo: 'Transición inválida' },
  CONFLICTO_CONCURRENCIA: { status: 409, titulo: 'Conflicto de concurrencia' },
  VIAJE_ACTIVO_EXISTENTE: { status: 409, titulo: 'La solicitud ya tiene un viaje activo' },
  PEDIDO_EN_CURSO: { status: 409, titulo: 'Pedido en curso' },
  PRECONDICION_FALLIDA: { status: 412, titulo: 'La versión no coincide' },
  CODIGO_VERIFICACION_INVALIDO: { status: 422, titulo: 'Código de verificación inválido' },
  MOTIVO_NO_PERMITIDO: { status: 422, titulo: 'Motivo de cancelación no permitido' },
  CLAVE_IDEMPOTENCIA_REUTILIZADA: { status: 422, titulo: 'Idempotency-Key reutilizada' },
  ERROR_INTERNO: { status: 500, titulo: 'Error interno' },
  DEPENDENCIA_NO_DISPONIBLE: { status: 503, titulo: 'Dependencia no disponible' },
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

    const { codigo, detalle, extra } = this.clasificar(error, pedido);
    const { status, titulo } = CODIGOS[codigo];

    if (error instanceof DependenciaNoDisponibleError) {
      respuesta.setHeader('Retry-After', String(error.reintentarEnSegundos));
    }

    respuesta
      .status(status)
      .type('application/problem+json')
      .json({
        type: `https://movilidad.example/errores/${codigo.toLowerCase().replace(/_/g, '-')}`,
        title: titulo,
        status,
        codigo,
        detail: detalle,
        instance: pedido.originalUrl,
        idCorrelacion: pedido.idCorrelacion,
        ...extra,
      });
  }

  private clasificar(
    error: unknown,
    pedido: PedidoConContexto,
  ): { codigo: string; detalle: string; extra?: Record<string, unknown> } {
    if (error instanceof ValidacionError) {
      return { codigo: error.codigo, detalle: error.message, extra: { errores: error.errores } };
    }
    if (error instanceof TransicionInvalidaError) {
      return { codigo: error.codigo, detalle: error.message, extra: { estadoActual: error.estadoActual } };
    }
    if (error instanceof ErrorDominio && error.codigo in CODIGOS) {
      return { codigo: error.codigo, detalle: error.message };
    }
    if (error instanceof HttpException) {
      const status = error.getStatus();
      if (status === HttpStatus.NOT_FOUND) {
        return { codigo: 'RUTA_NO_ENCONTRADA', detalle: `No existe ${pedido.method} ${pedido.path}` };
      }
      if (status < 500) {
        // Por ejemplo, un JSON mal formado en el cuerpo.
        return { codigo: 'VALIDACION', detalle: error.message };
      }
    }
    this.logger.error(`Error no controlado [${pedido.idCorrelacion}]`, error instanceof Error ? error.stack : error);
    return { codigo: 'ERROR_INTERNO', detalle: 'Ocurrió un error inesperado' };
  }
}
