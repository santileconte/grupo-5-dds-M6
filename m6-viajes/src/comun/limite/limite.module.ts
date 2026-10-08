import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CONEXION_REDIS, ConexionRedis } from '../redis/conexion-redis';
import { CONTADOR_PEDIDOS, ContadorPedidosEnMemoria, ContadorPedidosRedis } from './contador';
import { CONFIGURACION_LIMITE, ConfiguracionLimite, LimitePedidosGuard } from './limite-pedidos.guard';

@Global()
@Module({
  providers: [
    {
      provide: CONTADOR_PEDIDOS,
      inject: [CONEXION_REDIS],
      useFactory: (redis: ConexionRedis | null) => (redis ? new ContadorPedidosRedis(redis) : new ContadorPedidosEnMemoria()),
    },
    {
      provide: CONFIGURACION_LIMITE,
      inject: [ConfigService],
      useFactory: (config: ConfigService): ConfiguracionLimite => ({
        porMinuto: Number(config.get('LIMITE_PEDIDOS_POR_MINUTO', 120)),
        porMinutoServicio: Number(config.get('LIMITE_PEDIDOS_SERVICIO_POR_MINUTO', 1200)),
      }),
    },
    LimitePedidosGuard,
  ],
  exports: [LimitePedidosGuard, CONFIGURACION_LIMITE],
})
export class LimiteModule {}
