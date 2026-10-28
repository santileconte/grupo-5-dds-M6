import { TransicionViaje } from '../dominio/tipos';
import { Viaje } from '../dominio/viaje';

// Convierte las entidades del dominio al JSON que define el contrato OpenAPI.

const iso = (fecha: Date | null) => (fecha ? fecha.toISOString() : null);

export function viajeAJson(viaje: Viaje) {
  const v = viaje.toProps();
  return {
    id: v.id,
    requestId: v.requestId,
    reservationId: v.reservationId ?? null,
    clientId: v.clientId,
    driverId: v.driverId,
    vehicleId: v.vehicleId,
    vehicleType: v.vehicleType,
    originLatitude: v.originLatitude,
    originLongitude: v.originLongitude,
    destinationLatitude: v.destinationLatitude,
    destinationLongitude: v.destinationLongitude,
    ...(v.originAddress !== undefined && { originAddress: v.originAddress }),
    ...(v.destinationAddress !== undefined && { destinationAddress: v.destinationAddress }),
    state: v.state,
    version: v.version,
    createdAt: iso(v.createdAt),
    // Momento de la última transición (el Trip del Grupo 12 también expone updatedAt).
    updatedAt: iso(v.history[v.history.length - 1].occurredAt),
    arrivedAt: iso(v.arrivedAt),
    startedAt: iso(v.startedAt),
    completedAt: iso(v.completedAt),
    cancelledAt: iso(v.cancelledAt),
    // Mismos campos que el Trip del Grupo 12; `closure` conserva el detalle (segundos y ubicación final).
    distanceKm: v.closure?.distanceKm ?? null,
    durationMinutes: v.closure ? Math.round(v.closure.durationSeconds / 60) : null,
    closure: v.closure && {
      distanceKm: v.closure.distanceKm,
      durationSeconds: v.closure.durationSeconds,
      ...(v.closure.finalLatitude !== undefined && { finalLatitude: v.closure.finalLatitude }),
      ...(v.closure.finalLongitude !== undefined && { finalLongitude: v.closure.finalLongitude }),
    },
    cancellation: v.cancellation && {
      cancelledBy: v.cancellation.cancelledBy,
      reason: v.cancellation.reason,
      ...(v.cancellation.detail !== undefined && { detail: v.cancellation.detail }),
      previousState: v.cancellation.previousState,
      requiresRedispatch: v.cancellation.requiresRedispatch,
    },
  };
}

export function resumenAJson(viaje: Viaje) {
  const v = viaje.toProps();
  return {
    id: v.id,
    state: v.state,
    vehicleType: v.vehicleType,
    clientId: v.clientId,
    driverId: v.driverId,
    ...(v.originAddress !== undefined && { originAddress: v.originAddress }),
    ...(v.destinationAddress !== undefined && { destinationAddress: v.destinationAddress }),
    createdAt: iso(v.createdAt),
    completedAt: iso(v.completedAt),
    distanceKm: v.closure?.distanceKm ?? null,
    durationMinutes: v.closure ? Math.round(v.closure.durationSeconds / 60) : null,
  };
}

export function transicionAJson(t: TransicionViaje) {
  return {
    sequence: t.sequence,
    from: t.from,
    to: t.to,
    action: t.action,
    actor: { role: t.actor.role, id: t.actor.id },
    occurredAt: t.occurredAt.toISOString(),
    ...(t.reason !== undefined && { reason: t.reason }),
    ...(t.detail !== undefined && { detail: t.detail }),
  };
}
