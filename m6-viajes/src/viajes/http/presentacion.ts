import { TransicionViaje, Ubicacion } from '../dominio/tipos';
import { Viaje } from '../dominio/viaje';

// Convierte las entidades del dominio al JSON que define el contrato OpenAPI.

const iso = (fecha: Date | null) => (fecha ? fecha.toISOString() : null);

const ubicacion = (u: Ubicacion) => ({
  latitud: u.latitud,
  longitud: u.longitud,
  ...(u.direccion !== undefined && { direccion: u.direccion }),
});

export function viajeAJson(viaje: Viaje) {
  const v = viaje.toProps();
  return {
    id: v.id,
    solicitudId: v.solicitudId,
    asignacionId: v.asignacionId,
    reservaId: v.reservaId ?? null,
    clienteId: v.clienteId,
    conductorId: v.conductorId,
    vehiculoId: v.vehiculoId,
    tipoVehiculo: v.tipoVehiculo,
    origen: ubicacion(v.origen),
    destino: ubicacion(v.destino),
    estado: v.estado,
    version: v.version,
    creadoEn: iso(v.creadoEn),
    arriboEn: iso(v.arriboEn),
    iniciadoEn: iso(v.iniciadoEn),
    finalizadoEn: iso(v.finalizadoEn),
    canceladoEn: iso(v.canceladoEn),
    cierre: v.cierre && {
      distanciaRecorridaMetros: v.cierre.distanciaRecorridaMetros,
      duracionSegundos: v.cierre.duracionSegundos,
      ...(v.cierre.ubicacionFinal && { ubicacionFinal: ubicacion(v.cierre.ubicacionFinal) }),
    },
    cancelacion: v.cancelacion && {
      canceladoPor: v.cancelacion.canceladoPor,
      motivo: v.cancelacion.motivo,
      ...(v.cancelacion.detalle !== undefined && { detalle: v.cancelacion.detalle }),
      estadoAlCancelar: v.cancelacion.estadoAlCancelar,
      requiereRedespacho: v.cancelacion.requiereRedespacho,
    },
  };
}

export function resumenAJson(viaje: Viaje) {
  const v = viaje.toProps();
  return {
    id: v.id,
    estado: v.estado,
    tipoVehiculo: v.tipoVehiculo,
    clienteId: v.clienteId,
    conductorId: v.conductorId,
    ...(v.origen.direccion !== undefined && { direccionOrigen: v.origen.direccion }),
    ...(v.destino.direccion !== undefined && { direccionDestino: v.destino.direccion }),
    creadoEn: iso(v.creadoEn),
    finalizadoEn: iso(v.finalizadoEn),
    distanciaRecorridaMetros: v.cierre?.distanciaRecorridaMetros ?? null,
  };
}

export function transicionAJson(t: TransicionViaje) {
  return {
    secuencia: t.secuencia,
    desde: t.desde,
    hacia: t.hacia,
    accion: t.accion,
    actor: { rol: t.actor.rol, id: t.actor.id },
    ocurridoEn: t.ocurridoEn.toISOString(),
    ...(t.motivo !== undefined && { motivo: t.motivo }),
    ...(t.detalle !== undefined && { detalle: t.detalle }),
  };
}
