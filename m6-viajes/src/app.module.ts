import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_FILTER, APP_GUARD, APP_PIPE } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { AutenticacionGuard } from './comun/autenticacion.guard';
import { CorrelacionMiddleware } from './comun/correlacion.middleware';
import { IdempotenciaModule } from './comun/idempotencia/idempotencia.module';
import { ProblemasFilter } from './comun/problemas.filter';
import { crearValidacionPipe } from './comun/validacion.pipe';
import { validarConfiguracion } from './configuracion';
import { RaizController, SaludController } from './salud/salud.controller';
import { ViajesModule } from './viajes/viajes.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validarConfiguracion }),
    JwtModule.registerAsync({
      global: true,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({ secret: config.getOrThrow<string>('JWT_SECRETO') }),
    }),
    IdempotenciaModule,
    ViajesModule,
  ],
  controllers: [RaizController, SaludController],
  providers: [
    // Se aplican a todas las rutas: todo pedido requiere token salvo las marcadas con @Publico().
    { provide: APP_GUARD, useClass: AutenticacionGuard },
    { provide: APP_FILTER, useClass: ProblemasFilter },
    { provide: APP_PIPE, useFactory: crearValidacionPipe },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(CorrelacionMiddleware).forRoutes('{*ruta}');
  }
}
