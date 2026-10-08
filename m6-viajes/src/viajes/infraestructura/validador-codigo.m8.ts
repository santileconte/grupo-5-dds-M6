import { Logger } from '@nestjs/common';
import { DependenciaNoDisponibleError } from '../aplicacion/errores';
import { ResultadoValidacionCodigo, ValidadorCodigoVerificacion } from '../aplicacion/puertos';

/**
 * Valida el QR contra M8 por HTTP.
 * Endpoint PROPUESTO (a acordar con M8): POST {M8_URL}/qr/validaciones
 *   body: { viajeId, codigo }  →  200 { valido: boolean }
 *
 * Si M8 no responde dentro del timeout o responde 5xx, se lanza DependenciaNoDisponibleError
 * (503 al cliente) en lugar de esperar indefinidamente (RNF-13).
 */
export class ValidadorCodigoM8 implements ValidadorCodigoVerificacion {
  private readonly logger = new Logger(ValidadorCodigoM8.name);

  constructor(
    private readonly urlBase: string,
    private readonly timeoutMs: number,
  ) {}

  async validarYConsumir(viajeId: string, codigo: string, idCorrelacion: string): Promise<ResultadoValidacionCodigo> {
    let respuesta: Response;
    try {
      respuesta = await fetch(`${this.urlBase}/qr/validaciones`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Correlation-Id': idCorrelacion },
        body: JSON.stringify({ viajeId, codigo }),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      this.logger.warn(`M8 no respondió al validar el QR del viaje ${viajeId}: ${String(error)}`);
      throw new DependenciaNoDisponibleError('M8 (Notificaciones)');
    }

    if (respuesta.status >= 500) {
      throw new DependenciaNoDisponibleError('M8 (Notificaciones)');
    }
    if (!respuesta.ok) {
      return 'INVALIDO';
    }
    const cuerpo = (await respuesta.json().catch(() => ({}))) as { valido?: unknown };
    return cuerpo.valido === true ? 'VALIDO' : 'INVALIDO';
  }
}
