import { Body, Controller, Get, Headers, HttpCode, Param, Post, Query, Res, UseInterceptors } from '@nestjs/common';
import { Response } from 'express';
import { Ctx } from '../../comun/contexto';
import { ValidacionError } from '../../comun/errores-http';
import { IdempotenciaInterceptor } from '../../comun/idempotencia/idempotencia.interceptor';
import { Viaje } from '../dominio/viaje';
import { Contexto, ViajesService } from '../aplicacion/viajes.service';
import { CancelarViajeDto, CrearViajeDto, FinalizarViajeDto, IniciarViajeDto, ListarViajesQuery } from './dtos';
import { resumenAJson, transicionAJson, viajeAJson } from './presentacion';

/**
 * Endpoints de contratos/m6-viajes.openapi.yaml.
 * El controlador sólo traduce HTTP ⇄ casos de uso; las reglas viven en el dominio y el servicio.
 */
@Controller('viajes')
export class ViajesController {
  constructor(private readonly viajes: ViajesService) {}

  @Post()
  async crear(@Body() cuerpo: CrearViajeDto, @Ctx() ctx: Contexto, @Res({ passthrough: true }) res: Response) {
    const { viaje, creado } = await this.viajes.crear(cuerpo, ctx);
    res.status(creado ? 201 : 200);
    if (creado) res.setHeader('Location', `/viajes/${viaje.id}`);
    return this.responder(viaje, res);
  }

  @Get()
  async listar(@Query() q: ListarViajesQuery, @Ctx() ctx: Contexto) {
    const filtros = {
      clienteId: q.clienteId,
      conductorId: q.conductorId,
      estados: q.estado,
      desde: q.desde ? new Date(q.desde) : undefined,
      hasta: q.hasta ? new Date(q.hasta) : undefined,
      pagina: q.pagina,
      tamanio: q.tamanio,
    };
    const { items, total } = await this.viajes.listar(filtros, ctx);
    return { items: items.map(resumenAJson), pagina: q.pagina, tamanio: q.tamanio, total };
  }

  @Get(':viajeId')
  async obtener(@Param('viajeId') viajeId: string, @Ctx() ctx: Contexto, @Res({ passthrough: true }) res: Response) {
    return this.responder(await this.viajes.obtener(viajeId, ctx), res);
  }

  @Get(':viajeId/historial')
  async historial(@Param('viajeId') viajeId: string, @Ctx() ctx: Contexto) {
    const transiciones = await this.viajes.historial(viajeId, ctx);
    return { viajeId, transiciones: transiciones.map(transicionAJson) };
  }

  @Post(':viajeId/arribo')
  @HttpCode(200)
  @UseInterceptors(IdempotenciaInterceptor)
  async registrarArribo(
    @Param('viajeId') viajeId: string,
    @Headers('if-match') ifMatch: string | undefined,
    @Ctx() ctx: Contexto,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.responder(await this.viajes.registrarArribo(viajeId, versionDeIfMatch(ifMatch), ctx), res);
  }

  @Post(':viajeId/inicio')
  @HttpCode(200)
  @UseInterceptors(IdempotenciaInterceptor)
  async iniciar(
    @Param('viajeId') viajeId: string,
    @Body() cuerpo: IniciarViajeDto,
    @Headers('if-match') ifMatch: string | undefined,
    @Ctx() ctx: Contexto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const viaje = await this.viajes.iniciar(viajeId, cuerpo.codigoVerificacion, versionDeIfMatch(ifMatch), ctx);
    return this.responder(viaje, res);
  }

  @Post(':viajeId/finalizacion')
  @HttpCode(200)
  @UseInterceptors(IdempotenciaInterceptor)
  async finalizar(
    @Param('viajeId') viajeId: string,
    @Body() cuerpo: FinalizarViajeDto,
    @Headers('if-match') ifMatch: string | undefined,
    @Ctx() ctx: Contexto,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.responder(await this.viajes.finalizar(viajeId, cuerpo, versionDeIfMatch(ifMatch), ctx), res);
  }

  @Post(':viajeId/cancelacion')
  @HttpCode(200)
  @UseInterceptors(IdempotenciaInterceptor)
  async cancelar(
    @Param('viajeId') viajeId: string,
    @Body() cuerpo: CancelarViajeDto,
    @Headers('if-match') ifMatch: string | undefined,
    @Ctx() ctx: Contexto,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.responder(await this.viajes.cancelar(viajeId, cuerpo, versionDeIfMatch(ifMatch), ctx), res);
  }

  /** Devuelve el viaje con su versión en el header ETag. */
  private responder(viaje: Viaje, res: Response) {
    res.setHeader('ETag', `"${viaje.version}"`);
    return viajeAJson(viaje);
  }
}

/** Convierte `"3"`, `W/"3"` o `3` en 3. `*` o ausente significa "cualquier versión". */
export function versionDeIfMatch(ifMatch: string | undefined): number | undefined {
  if (ifMatch === undefined || ifMatch.trim() === '*') {
    return undefined;
  }
  const version = Number(ifMatch.trim().replace(/^W\//, '').replace(/"/g, ''));
  if (!Number.isInteger(version) || version < 1) {
    throw new ValidacionError([{ campo: 'If-Match', mensaje: 'debe ser la versión del viaje, por ejemplo "3"' }]);
  }
  return version;
}
