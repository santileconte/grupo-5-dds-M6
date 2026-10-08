import { Injectable } from '@nestjs/common';
import { ESTADOS_TERMINALES } from '../dominio/tipos';
import { Viaje, ViajeProps } from '../dominio/viaje';
import { ConflictoConcurrenciaError, ViajeNoEncontradoError } from '../aplicacion/errores';
import { FiltrosViajes, PaginaDeViajes, RepositorioViajes } from '../aplicacion/puertos';

/**
 * Repositorio en memoria. Sirve para desarrollar y probar sin base de datos; los datos se
 * pierden al reiniciar. Se reemplazará por PostgreSQL implementando la misma interfaz.
 *
 * Guarda copias (no los objetos vivos) para comportarse como una base de datos real:
 * los cambios sólo existen después de `actualizar`.
 */
@Injectable()
export class RepositorioViajesEnMemoria implements RepositorioViajes {
  private readonly viajes = new Map<string, ViajeProps>();

  async buscarPorId(id: string): Promise<Viaje | null> {
    const props = this.viajes.get(id);
    return props ? Viaje.reconstituir(props) : null;
  }

  async buscarPorAsignacion(asignacionId: string): Promise<Viaje | null> {
    const props = [...this.viajes.values()].find((v) => v.asignacionId === asignacionId);
    return props ? Viaje.reconstituir(props) : null;
  }

  async buscarActivoPorSolicitud(solicitudId: string): Promise<Viaje | null> {
    const props = [...this.viajes.values()].find(
      (v) => v.solicitudId === solicitudId && !ESTADOS_TERMINALES.includes(v.estado),
    );
    return props ? Viaje.reconstituir(props) : null;
  }

  async listar(f: FiltrosViajes): Promise<PaginaDeViajes> {
    const filtrados = [...this.viajes.values()]
      .filter((v) => !f.clienteId || v.clienteId === f.clienteId)
      .filter((v) => !f.conductorId || v.conductorId === f.conductorId)
      .filter((v) => !f.estados?.length || f.estados.includes(v.estado))
      .filter((v) => !f.desde || v.creadoEn >= f.desde)
      .filter((v) => !f.hasta || v.creadoEn < f.hasta)
      .sort((a, b) => b.creadoEn.getTime() - a.creadoEn.getTime() || a.id.localeCompare(b.id));

    const inicio = (f.pagina - 1) * f.tamanio;
    return {
      items: filtrados.slice(inicio, inicio + f.tamanio).map((p) => Viaje.reconstituir(p)),
      total: filtrados.length,
    };
  }

  async insertar(viaje: Viaje): Promise<Viaje> {
    const props = viaje.toProps();
    // En PostgreSQL esto lo garantiza un índice único sobre asignacion_id.
    const existente = await this.buscarPorAsignacion(props.asignacionId);
    if (existente) {
      return existente;
    }
    this.viajes.set(props.id, props);
    return viaje;
  }

  async actualizar(viaje: Viaje, versionLeida: number): Promise<void> {
    const guardado = this.viajes.get(viaje.id);
    if (!guardado) {
      throw new ViajeNoEncontradoError(viaje.id);
    }
    // Equivale a: UPDATE viajes SET ... WHERE id = ? AND version = ?
    if (guardado.version !== versionLeida) {
      throw new ConflictoConcurrenciaError(viaje.id);
    }
    this.viajes.set(viaje.id, viaje.toProps());
  }
}
