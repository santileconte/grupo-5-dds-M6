import { Injectable } from '@nestjs/common';
import { ResultadoValidacionCodigo, ValidadorCodigoVerificacion } from '../aplicacion/puertos';

/**
 * Simula a M8 mientras no esté disponible. El código válido de cada viaje es
 * `QR-<viajeId>` y, como el QR real, se puede usar una sola vez.
 */
@Injectable()
export class ValidadorCodigoSimulado implements ValidadorCodigoVerificacion {
  private readonly consumidos = new Set<string>();

  static codigoPara(viajeId: string): string {
    return `QR-${viajeId}`;
  }

  async validarYConsumir(viajeId: string, codigo: string): Promise<ResultadoValidacionCodigo> {
    if (codigo !== ValidadorCodigoSimulado.codigoPara(viajeId) || this.consumidos.has(viajeId)) {
      return 'INVALIDO';
    }
    this.consumidos.add(viajeId);
    return 'VALIDO';
  }
}
