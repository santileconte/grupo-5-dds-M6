import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR, APP_PIPE } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { AutenticacionGuard, CONFIGURACION_JWT, ConfiguracionJwt } from './comun/autenticacion.guard';
import { CorrelacionMiddleware } from './comun/correlacion.middleware';
import { IdempotenciaModule } from './comun/idempotencia/idempotencia.module';
import { LimitePedidosGuard } from './comun/limite/limite-pedidos.guard';
import { LimiteModule } from './comun/limite/limite.module';
import { RedisModule } from './comun/redis/redis.module';
import { ProblemasFilter } from './comun/problemas.filter';
import { ContextoPedidoInterceptor } from './comun/registro/contexto-pedido.interceptor';
import { crearValidacionPipe } from './comun/validacion.pipe';
import { validarConfiguracion } from './configuracion';
import { RaizController, SaludController } from './salud/salud.controller';
import { SaludService } from './salud/salud.service';
import { ViajesModule } from './viajes/viajes.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validarConfiguracion }),
    JwtModule.registerAsync({
      global: true,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({ secret: config.getOrThrow<string>('JWT_SECRETO') }),
    }),
    RedisModule,
    IdempotenciaModule,
    LimiteModule,
    ViajesModule,
  ],
  controllers: [RaizController, SaludController],
  providers: [
    {
      provide: CONFIGURACION_JWT,
      inject: [ConfigService],
      useFactory: (config: ConfigService): ConfiguracionJwt => ({
        emisor: config.get<string>('JWT_EMISOR') || undefined,
        audiencia: config.get<string>('JWT_AUDIENCIA') || undefined,
      }),
    },
    // Se aplican a todas las rutas, en este orden: primero se identifica al usuario (todo pedido
    // requiere token salvo las rutas @Publico()) y después se controla su límite de pedidos.
    { provide: APP_GUARD, useClass: AutenticacionGuard },
    { provide: APP_GUARD, useExisting: LimitePedidosGuard },
    { provide: APP_FILTER, useClass: ProblemasFilter },
    { provide: APP_PIPE, useFactory: crearValidacionPipe },
    { provide: APP_INTERCEPTOR, useClass: ContextoPedidoInterceptor },
    SaludService,
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(CorrelacionMiddleware).forRoutes('{*ruta}');
  }
}
