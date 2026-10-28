import { Injectable } from '@nestjs/common';
import { Viaje, ViajeProps } from '../dominio/viaje';
import { ConflictoConcurrenciaError, ViajeNoEncontradoError } from '../aplicacion/errores';
import { SobreEvento } from '../aplicacion/eventos';
import {
  BandejaDeSalida,
  FiltrosViajes,
  PaginaDeViajes,
  RepositorioViajes,
  ResultadoLote,
  ResumenPendientes,
} from '../aplicacion/puertos';

/**
 * Repositorio en memoria (PERSISTENCIA=memoria). Sirve para desarrollar y probar sin base de datos;
 * los datos se pierden al reiniciar. También hace de bandeja de salida de eventos.
 *
 * Guarda copias (no los objetos vivos) para comportarse como una base de datos real:
 * los cambios sólo existen después de `actualizar`.
 */
@Injectable()
export class RepositorioViajesEnMemoria implements RepositorioViajes, BandejaDeSalida {
  private readonly viajes = new Map<string, ViajeProps>();
  private readonly pendientes: SobreEvento[] = [];

  async buscarPorId(id: string): Promise<Viaje | null> {
    const props = this.viajes.get(id);
    return props ? Viaje.reconstituir(props) : null;
  }

  async buscarPorSolicitud(requestId: string): Promise<Viaje | null> {
    const props = [...this.viajes.values()].find((v) => v.requestId === requestId);
    return props ? Viaje.reconstituir(props) : null;
  }

  async listar(f: FiltrosViajes): Promise<PaginaDeViajes> {
    const filtrados = [...this.viajes.values()]
      .filter((v) => !f.clientId || v.clientId === f.clientId)
      .filter((v) => !f.driverId || v.driverId === f.driverId)
      .filter((v) => !f.states?.length || f.states.includes(v.state))
      .filter((v) => !f.from || v.createdAt >= f.from)
      .filter((v) => !f.to || v.createdAt < f.to)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || a.id.localeCompare(b.id));

    const inicio = (f.page - 1) * f.pageSize;
    return {
      items: filtrados.slice(inicio, inicio + f.pageSize).map((p) => Viaje.reconstituir(p)),
      total: filtrados.length,
    };
  }

  async insertar(viaje: Viaje, eventos: SobreEvento[]): Promise<Viaje> {
    const props = viaje.toProps();
    // En PostgreSQL esto lo garantiza un índice único sobre solicitud_id.
    const existente = await this.buscarPorSolicitud(props.requestId);
    if (existente) {
      return existente;
    }
    this.viajes.set(props.id, props);
    this.pendientes.push(...eventos);
    return viaje;
  }

  async actualizar(viaje: Viaje, versionLeida: number, eventos: SobreEvento[]): Promise<void> {
    const guardado = this.viajes.get(viaje.id);
    if (!guardado) {
      throw new ViajeNoEncontradoError(viaje.id);
    }
    // Equivale a: UPDATE viajes SET ... WHERE id = ? AND version = ?
    if (guardado.version !== versionLeida) {
      throw new ConflictoConcurrenciaError(viaje.id);
    }
    this.viajes.set(viaje.id, viaje.toProps());
    this.pendientes.push(...eventos);
  }

  async procesarPendientes(limite: number, publicar: (evento: SobreEvento) => Promise<void>): Promise<ResultadoLote> {
    const resultado: ResultadoLote = { publicados: 0 };
    while (resultado.publicados < limite && this.pendientes.length > 0) {
      try {
        await publicar(this.pendientes[0]);
      } catch (error) {
        resultado.error = error;
        break;
      }
      this.pendientes.shift();
      resultado.publicados += 1;
    }
    return resultado;
  }

  async resumenPendientes(): Promise<ResumenPendientes> {
    const primero = this.pendientes[0];
    return { cantidad: this.pendientes.length, masAntiguo: primero ? new Date(primero.occurredAt) : null };
  }
}
