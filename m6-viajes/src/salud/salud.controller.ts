import { Controller, Get, Redirect, Res } from '@nestjs/common';
import { Response } from 'express';
import { Publico } from '../comun/publico.decorator';
import { InformeSalud, SaludService } from './salud.service';

@Controller('salud')
export class SaludController {
  constructor(private readonly salud: SaludService) {}

  /**
   * Liveness: responde si el proceso está vivo. No consulta dependencias, así Docker no reinicia
   * el contenedor sólo porque se cayó, por ejemplo, RabbitMQ.
   */
  @Get()
  @Publico()
  verificar(): { estado: string } {
    return { estado: 'OK' };
  }

  /** Readiness y diagnóstico: estado de PostgreSQL, RabbitMQ, Redis y de la bandeja de eventos. */
  @Get('detalle')
  @Publico()
  async detalle(@Res({ passthrough: true }) res: Response): Promise<InformeSalud> {
    const informe = await this.salud.informe();
    res.status(informe.estado === 'ERROR' ? 503 : 200);
    return informe;
  }
}

/** La raíz redirige a la documentación interactiva de la API. */
@Controller()
export class RaizController {
  @Get()
  @Publico()
  @Redirect('/docs')
  raiz(): void {}
}
