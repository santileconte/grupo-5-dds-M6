import { Controller, Get, Redirect } from '@nestjs/common';
import { Publico } from '../comun/publico.decorator';

@Controller('salud')
export class SaludController {
  @Get()
  @Publico()
  verificar(): { estado: string } {
    return { estado: 'OK' };
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
