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
@Controller('trips')
export class ViajesController {
  constructor(private readonly viajes: ViajesService) {}

  @Post()
  async crear(@Body() cuerpo: CrearViajeDto, @Ctx() ctx: Contexto, @Res({ passthrough: true }) res: Response) {
    const { viaje, creado } = await this.viajes.crear(cuerpo, ctx);
    res.status(creado ? 201 : 200);
    if (creado) res.setHeader('Location', `/trips/${viaje.id}`);
    return this.responder(viaje, res);
  }

  @Get()
  async listar(@Query() q: ListarViajesQuery, @Ctx() ctx: Contexto) {
    const filtros = {
      clientId: q.clientId,
      driverId: q.driverId,
      states: q.state,
      from: q.from ? new Date(q.from) : undefined,
      to: q.to ? new Date(q.to) : undefined,
      page: q.page,
      pageSize: q.pageSize,
    };
    const { items, total } = await this.viajes.listar(filtros, ctx);
    return { items: items.map(resumenAJson), page: q.page, pageSize: q.pageSize, total };
  }

  @Get(':tripId')
  async obtener(@Param('tripId') tripId: string, @Ctx() ctx: Contexto, @Res({ passthrough: true }) res: Response) {
    return this.responder(await this.viajes.obtener(tripId, ctx), res);
  }

  @Get(':tripId/history')
  async history(@Param('tripId') tripId: string, @Ctx() ctx: Contexto) {
    const transitions = await this.viajes.history(tripId, ctx);
    return { tripId, transitions: transitions.map(transicionAJson) };
  }

  @Post(':tripId/arrived')
  @HttpCode(200)
  @UseInterceptors(IdempotenciaInterceptor)
  async registrarArribo(
    @Param('tripId') tripId: string,
    @Headers('if-match') ifMatch: string | undefined,
    @Ctx() ctx: Contexto,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.responder(await this.viajes.registrarArribo(tripId, versionDeIfMatch(ifMatch), ctx), res);
  }

  @Post(':tripId/start')
  @HttpCode(200)
  @UseInterceptors(IdempotenciaInterceptor)
  async iniciar(
    @Param('tripId') tripId: string,
    @Body() cuerpo: IniciarViajeDto,
    @Headers('if-match') ifMatch: string | undefined,
    @Ctx() ctx: Contexto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const viaje = await this.viajes.iniciar(tripId, cuerpo.verificationToken, versionDeIfMatch(ifMatch), ctx);
    return this.responder(viaje, res);
  }

  @Post(':tripId/complete')
  @HttpCode(200)
  @UseInterceptors(IdempotenciaInterceptor)
  async finalizar(
    @Param('tripId') tripId: string,
    @Body() cuerpo: FinalizarViajeDto,
    @Headers('if-match') ifMatch: string | undefined,
    @Ctx() ctx: Contexto,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.responder(await this.viajes.finalizar(tripId, cuerpo, versionDeIfMatch(ifMatch), ctx), res);
  }

  @Post(':tripId/cancel')
  @HttpCode(200)
  @UseInterceptors(IdempotenciaInterceptor)
  async cancelar(
    @Param('tripId') tripId: string,
    @Body() cuerpo: CancelarViajeDto,
    @Headers('if-match') ifMatch: string | undefined,
    @Ctx() ctx: Contexto,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.responder(await this.viajes.cancelar(tripId, cuerpo, versionDeIfMatch(ifMatch), ctx), res);
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
    throw new ValidacionError([{ field: 'If-Match', message: 'debe ser la versión del viaje, por ejemplo "3"' }]);
  }
  return version;
}
