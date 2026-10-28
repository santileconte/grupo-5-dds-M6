import { randomUUID } from 'node:crypto';
import { AccionViaje } from '../dominio/tipos';
import { Viaje } from '../dominio/viaje';

/** Sobre común de eventos. Debe coincidir con contratos/eventos/m6-viajes.asyncapi.yaml. */
export interface SobreEvento {
  eventId: string;
  eventType: string;
  eventVersion: number;
  occurredAt: string;
  producer: string;
  correlationId: string;
  payload: Record<string, unknown>;
}

const PRODUCER = 'm6-viajes';

/** Routing key de cada evento en el exchange `movilidad.eventos` (ver contrato AsyncAPI). */
export const ROUTING_KEYS: Readonly<Record<string, string>> = {
  TripCreated: 'trips.trip.created',
  DriverArrived: 'trips.driver.arrived',
  TripStarted: 'trips.trip.started',
  TripCompleted: 'trips.trip.completed',
  TripCancelled: 'trips.trip.cancelled',
};

export function routingKeyDe(evento: SobreEvento): string {
  const routingKey = ROUTING_KEYS[evento.eventType];
  if (!routingKey) throw new Error(`No hay routing key para el evento ${evento.eventType}`);
  return routingKey;
}

const iso = (fecha: Date | null) => (fecha ? fecha.toISOString() : null);

/** Arma el evento correspondiente a la última transición del viaje. */
export function eventoDeUltimaTransicion(viaje: Viaje, correlationId: string): SobreEvento {
  const v = viaje.toProps();
  const ultima = v.history[v.history.length - 1];
  const base = {
    tripId: v.id,
    tripVersion: v.version,
    requestId: v.requestId,
    reservationId: v.reservationId ?? null,
    clientId: v.clientId,
    driverId: v.driverId,
  };

  let eventType: string;
  let payload: Record<string, unknown>;
  switch (ultima.action) {
    case AccionViaje.CREATE:
      eventType = 'TripCreated';
      payload = { ...base, vehicleId: v.vehicleId, vehicleType: v.vehicleType, createdAt: iso(v.createdAt) };
      break;
    case AccionViaje.REGISTER_ARRIVAL:
      eventType = 'DriverArrived';
      payload = { ...base, arrivedAt: iso(v.arrivedAt) };
      break;
    case AccionViaje.START:
      eventType = 'TripStarted';
      payload = { ...base, vehicleType: v.vehicleType, startedAt: iso(v.startedAt) };
      break;
    case AccionViaje.COMPLETE:
      eventType = 'TripCompleted';
      payload = {
        ...base,
        vehicleType: v.vehicleType,
        startedAt: iso(v.startedAt),
        completedAt: iso(v.completedAt),
        distanceKm: v.closure?.distanceKm,
        durationSeconds: v.closure?.durationSeconds,
      };
      break;
    case AccionViaje.CANCEL:
      eventType = 'TripCancelled';
      payload = {
        ...base,
        vehicleType: v.vehicleType,
        cancelledBy: v.cancellation?.cancelledBy,
        reason: v.cancellation?.reason,
        previousState: v.cancellation?.previousState,
        requiresRedispatch: v.cancellation?.requiresRedispatch,
        createdAt: iso(v.createdAt),
        arrivedAt: iso(v.arrivedAt),
        startedAt: iso(v.startedAt),
        cancelledAt: iso(v.cancelledAt),
      };
      break;
  }

  return {
    eventId: randomUUID(),
    eventType,
    eventVersion: 1,
    occurredAt: ultima.occurredAt.toISOString(),
    producer: PRODUCER,
    correlationId,
    payload,
  };
}
