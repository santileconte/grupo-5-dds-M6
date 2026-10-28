import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { DatosInvalidosError } from '../dominio/errores';
import { Actor, Rol, TransicionViaje } from '../dominio/tipos';
import {
  ConfiguracionViaje,
  DatosFinalizacion,
  DatosNuevoViaje,
  SolicitudCancelacion,
  Viaje,
} from '../dominio/viaje';
import {
  CodigoVerificacionInvalidoError,
  ConsultaNoPermitidaError,
  PrecondicionFallidaError,
  SolicitudConDatosDistintosError,
  ViajeNoEncontradoError,
} from './errores';
import { eventoDeUltimaTransicion } from './eventos';
import {
  CONFIGURACION_VIAJES,
  FiltrosViajes,
  PaginaDeViajes,
  RELOJ,
  Reloj,
  REPOSITORIO_VIAJES,
  RepositorioViajes,
  VALIDADOR_CODIGO,
  ValidadorCodigoVerificacion,
} from './puertos';

/** Datos comunes a cada pedido: quién lo hace y con qué id de correlación. */
export interface Contexto {
  actor: Actor;
  correlationId: string;
}

/** Versión del If-Match, si el cliente la envió. */
type VersionEsperada = number | undefined;

/**
 * Casos de uso de M6. Coordina el dominio (Viaje) con los puertos: repositorio y validador del QR.
 * Los eventos no se publican acá: se guardan con el viaje en la bandeja de salida y el
 * RelevadorDeEventos los publica después (patrón outbox). No sabe nada de HTTP.
 */
@Injectable()
export class ViajesService {
  constructor(
    @Inject(REPOSITORIO_VIAJES) private readonly repositorio: RepositorioViajes,
    @Inject(VALIDADOR_CODIGO) private readonly validadorCodigo: ValidadorCodigoVerificacion,
    @Inject(RELOJ) private readonly reloj: Reloj,
    @Inject(CONFIGURACION_VIAJES) private readonly config: ConfiguracionViaje,
  ) {}

  /**
   * Crea el viaje de una solicitud. Idempotente por requestId, como en el Grupo 12: si ya existe un viaje
   * con esos mismos datos se devuelve (`creado: false`); si el requestId existe con datos distintos, 409.
   */
  async crear(datos: Omit<DatosNuevoViaje, 'id'>, ctx: Contexto): Promise<{ viaje: Viaje; creado: boolean }> {
    const existente = await this.repositorio.buscarPorSolicitud(datos.requestId);
    if (existente) {
      return { viaje: this.mismosDatos(existente, datos), creado: false };
    }

    const nuevo = Viaje.crear({ ...datos, id: randomUUID() }, ctx.actor, this.reloj.ahora());
    const guardado = await this.repositorio.insertar(nuevo, [eventoDeUltimaTransicion(nuevo, ctx.correlationId)]);
    // Si otro pedido con el mismo requestId lo guardó primero, se devuelve ese (y no hay evento nuevo).
    return guardado === nuevo
      ? { viaje: guardado, creado: true }
      : { viaje: this.mismosDatos(guardado, datos), creado: false };
  }

  private mismosDatos(viaje: Viaje, datos: Omit<DatosNuevoViaje, 'id'>): Viaje {
    if (!viaje.coincideCon(datos)) {
      throw new SolicitudConDatosDistintosError(datos.requestId);
    }
    return viaje;
  }

  async obtener(tripId: string, ctx: Contexto): Promise<Viaje> {
    const viaje = await this.repositorio.buscarPorId(tripId);
    if (!viaje || !this.puedeVer(viaje, ctx.actor)) {
      throw new ViajeNoEncontradoError(tripId);
    }
    return viaje;
  }

  async history(tripId: string, ctx: Contexto): Promise<readonly TransicionViaje[]> {
    if (ctx.actor.role === Rol.SYSTEM) {
      throw new ConsultaNoPermitidaError('El historial sólo lo consultan el cliente, el conductor o un operador');
    }
    return (await this.obtener(tripId, ctx)).history;
  }

  async listar(filtros: FiltrosViajes, ctx: Contexto): Promise<PaginaDeViajes> {
    const { actor } = ctx;
    const efectivos: FiltrosViajes = { ...filtros };
    if (actor.role === Rol.CLIENT) {
      efectivos.clientId = actor.id;
    } else if (actor.role === Rol.DRIVER) {
      efectivos.driverId = actor.id;
    } else if (actor.role === Rol.SYSTEM && !filtros.clientId && !filtros.driverId) {
      throw new DatosInvalidosError('Un servicio debe indicar clientId o driverId');
    }
    return this.repositorio.listar(efectivos);
  }

  registrarArribo(tripId: string, versionEsperada: VersionEsperada, ctx: Contexto): Promise<Viaje> {
    return this.ejecutar(tripId, versionEsperada, ctx, (viaje, ahora) => viaje.registrarArribo(ctx.actor, ahora));
  }

  iniciar(tripId: string, code: string, versionEsperada: VersionEsperada, ctx: Contexto): Promise<Viaje> {
    return this.ejecutar(tripId, versionEsperada, ctx, async (viaje, ahora) => {
      // Primero se prueba la transición sobre una copia: si no es válida, no se gasta el QR.
      Viaje.reconstituir(viaje.toProps()).iniciar(ctx.actor, ahora);

      const resultado = await this.validadorCodigo.validarYConsumir(viaje.id, code, ctx.correlationId);
      if (resultado !== 'VALIDO') {
        throw new CodigoVerificacionInvalidoError();
      }
      viaje.iniciar(ctx.actor, ahora);
    });
  }

  finalizar(tripId: string, datos: DatosFinalizacion, versionEsperada: VersionEsperada, ctx: Contexto): Promise<Viaje> {
    return this.ejecutar(tripId, versionEsperada, ctx, (viaje, ahora) => viaje.finalizar(ctx.actor, datos, ahora));
  }

  cancelar(
    tripId: string,
    solicitud: SolicitudCancelacion,
    versionEsperada: VersionEsperada,
    ctx: Contexto,
  ): Promise<Viaje> {
    return this.ejecutar(tripId, versionEsperada, ctx, (viaje, ahora) =>
      viaje.cancelar(ctx.actor, solicitud, ahora, this.config),
    );
  }

  /**
   * Esqueleto común de todas las transiciones:
   * leer → verificar If-Match → aplicar la acción → guardar viaje y evento juntos, con control de versión.
   */
  private async ejecutar(
    tripId: string,
    versionEsperada: VersionEsperada,
    ctx: Contexto,
    action: (viaje: Viaje, ahora: Date) => void | Promise<void>,
  ): Promise<Viaje> {
    const viaje = await this.repositorio.buscarPorId(tripId);
    if (!viaje) {
      throw new ViajeNoEncontradoError(tripId);
    }
    const versionLeida = viaje.version;
    if (versionEsperada !== undefined && versionEsperada !== versionLeida) {
      throw new PrecondicionFallidaError(versionEsperada, versionLeida);
    }

    await action(viaje, this.reloj.ahora());
    await this.repositorio.actualizar(viaje, versionLeida, [eventoDeUltimaTransicion(viaje, ctx.correlationId)]);
    return viaje;
  }

  private puedeVer(viaje: Viaje, actor: Actor): boolean {
    const { clientId, driverId } = viaje.toProps();
    switch (actor.role) {
      case Rol.CLIENT:
        return actor.id === clientId;
      case Rol.DRIVER:
        return actor.id === driverId;
      default:
        return true;
    }
  }
}
