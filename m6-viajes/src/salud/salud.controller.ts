import { Controller, Get } from '@nestjs/common';

@Controller('salud')
export class SaludController {
  @Get()
  verificar(): { estado: string } {
    return { estado: 'OK' };
  }
}
