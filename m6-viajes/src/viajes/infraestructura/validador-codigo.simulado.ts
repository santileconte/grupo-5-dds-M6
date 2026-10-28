import { Injectable } from '@nestjs/common';
import { ResultadoValidacionCodigo, ValidadorCodigoVerificacion } from '../aplicacion/puertos';

/**
 * Simula a M8 mientras no esté disponible. El código válido de cada viaje es
 * `QR-<viajeId>` y, como el QR real, se puede usar una sola vez.
 */
@Injectable()
export class ValidadorCodigoSimulado implements ValidadorCodigoVerificacion {
  private readonly consumidos = new Set<string>();

  static codigoPara(tripId: string): string {
    return `QR-${tripId}`;
  }

  async validarYConsumir(tripId: string, code: string): Promise<ResultadoValidacionCodigo> {
    if (code !== ValidadorCodigoSimulado.codigoPara(tripId) || this.consumidos.has(tripId)) {
      return 'INVALIDO';
    }
    this.consumidos.add(tripId);
    return 'VALIDO';
  }
}
