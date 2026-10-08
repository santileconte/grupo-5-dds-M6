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
  ViajeActivoExistenteError,
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
  idCorrelacion: string;
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

  /** Crea el viaje de una asignación. Idempotente por asignacionId: `creado` indica si es nuevo. */
  async crear(datos: Omit<DatosNuevoViaje, 'id'>, ctx: Contexto): Promise<{ viaje: Viaje; creado: boolean }> {
    const existente = await this.repositorio.buscarPorAsignacion(datos.asignacionId);
    if (existente) {
      return { viaje: existente, creado: false };
    }
    if (await this.repositorio.buscarActivoPorSolicitud(datos.solicitudId)) {
      throw new ViajeActivoExistenteError(datos.solicitudId);
    }

    const nuevo = Viaje.crear({ ...datos, id: randomUUID() }, ctx.actor, this.reloj.ahora());
    const guardado = await this.repositorio.insertar(nuevo, [eventoDeUltimaTransicion(nuevo, ctx.idCorrelacion)]);
    // Si otro pedido con la misma asignación lo guardó primero, se devuelve ese (y no hay evento nuevo).
    return { viaje: guardado, creado: guardado === nuevo };
  }

  async obtener(viajeId: string, ctx: Contexto): Promise<Viaje> {
    const viaje = await this.repositorio.buscarPorId(viajeId);
    if (!viaje || !this.puedeVer(viaje, ctx.actor)) {
      throw new ViajeNoEncontradoError(viajeId);
    }
    return viaje;
  }

  async historial(viajeId: string, ctx: Contexto): Promise<readonly TransicionViaje[]> {
    if (ctx.actor.rol === Rol.SERVICIO) {
      throw new ConsultaNoPermitidaError('El historial sólo lo consultan el cliente, el conductor o un operador');
    }
    return (await this.obtener(viajeId, ctx)).historial;
  }

  async listar(filtros: FiltrosViajes, ctx: Contexto): Promise<PaginaDeViajes> {
    const { actor } = ctx;
    const efectivos: FiltrosViajes = { ...filtros };
    if (actor.rol === Rol.CLIENTE) {
      efectivos.clienteId = actor.id;
    } else if (actor.rol === Rol.CONDUCTOR) {
      efectivos.conductorId = actor.id;
    } else if (actor.rol === Rol.SERVICIO && !filtros.clienteId && !filtros.conductorId) {
      throw new DatosInvalidosError('Un servicio debe indicar clienteId o conductorId');
    }
    return this.repositorio.listar(efectivos);
  }

  registrarArribo(viajeId: string, versionEsperada: VersionEsperada, ctx: Contexto): Promise<Viaje> {
    return this.ejecutar(viajeId, versionEsperada, ctx, (viaje, ahora) => viaje.registrarArribo(ctx.actor, ahora));
  }

  iniciar(viajeId: string, codigo: string, versionEsperada: VersionEsperada, ctx: Contexto): Promise<Viaje> {
    return this.ejecutar(viajeId, versionEsperada, ctx, async (viaje, ahora) => {
      // Primero se prueba la transición sobre una copia: si no es válida, no se gasta el QR.
      Viaje.reconstituir(viaje.toProps()).iniciar(ctx.actor, ahora);

      const resultado = await this.validadorCodigo.validarYConsumir(viaje.id, codigo, ctx.idCorrelacion);
      if (resultado !== 'VALIDO') {
        throw new CodigoVerificacionInvalidoError();
      }
      viaje.iniciar(ctx.actor, ahora);
    });
  }

  finalizar(viajeId: string, datos: DatosFinalizacion, versionEsperada: VersionEsperada, ctx: Contexto): Promise<Viaje> {
    return this.ejecutar(viajeId, versionEsperada, ctx, (viaje, ahora) => viaje.finalizar(ctx.actor, datos, ahora));
  }

  cancelar(
    viajeId: string,
    solicitud: SolicitudCancelacion,
    versionEsperada: VersionEsperada,
    ctx: Contexto,
  ): Promise<Viaje> {
    return this.ejecutar(viajeId, versionEsperada, ctx, (viaje, ahora) =>
      viaje.cancelar(ctx.actor, solicitud, ahora, this.config),
    );
  }

  /**
   * Esqueleto común de todas las transiciones:
   * leer → verificar If-Match → aplicar la acción → guardar viaje y evento juntos, con control de versión.
   */
  private async ejecutar(
    viajeId: string,
    versionEsperada: VersionEsperada,
    ctx: Contexto,
    accion: (viaje: Viaje, ahora: Date) => void | Promise<void>,
  ): Promise<Viaje> {
    const viaje = await this.repositorio.buscarPorId(viajeId);
    if (!viaje) {
      throw new ViajeNoEncontradoError(viajeId);
    }
    const versionLeida = viaje.version;
    if (versionEsperada !== undefined && versionEsperada !== versionLeida) {
      throw new PrecondicionFallidaError(versionEsperada, versionLeida);
    }

    await accion(viaje, this.reloj.ahora());
    await this.repositorio.actualizar(viaje, versionLeida, [eventoDeUltimaTransicion(viaje, ctx.idCorrelacion)]);
    return viaje;
  }

  private puedeVer(viaje: Viaje, actor: Actor): boolean {
    const { clienteId, conductorId } = viaje.toProps();
    switch (actor.rol) {
      case Rol.CLIENTE:
        return actor.id === clienteId;
      case Rol.CONDUCTOR:
        return actor.id === conductorId;
      default:
        return true;
    }
  }
}
