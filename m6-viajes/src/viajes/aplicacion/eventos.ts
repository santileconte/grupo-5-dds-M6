import { randomUUID } from 'node:crypto';
import { AccionViaje } from '../dominio/tipos';
import { Viaje } from '../dominio/viaje';

/** Sobre común de eventos. Debe coincidir con contratos/eventos/m6-viajes.asyncapi.yaml. */
export interface SobreEvento {
  idEvento: string;
  tipo: string;
  version: number;
  ocurridoEn: string;
  productor: string;
  idCorrelacion: string;
  datos: Record<string, unknown>;
}

const PRODUCTOR = 'm6-viajes';

const iso = (fecha: Date | null) => (fecha ? fecha.toISOString() : null);

/** Arma el evento correspondiente a la última transición del viaje. */
export function eventoDeUltimaTransicion(viaje: Viaje, idCorrelacion: string): SobreEvento {
  const v = viaje.toProps();
  const ultima = v.historial[v.historial.length - 1];
  const base = {
    viajeId: v.id,
    versionViaje: v.version,
    solicitudId: v.solicitudId,
    reservaId: v.reservaId ?? null,
    clienteId: v.clienteId,
    conductorId: v.conductorId,
  };

  let tipo: string;
  let datos: Record<string, unknown>;
  switch (ultima.accion) {
    case AccionViaje.CREAR:
      tipo = 'ViajeCreado';
      datos = { ...base, vehiculoId: v.vehiculoId, tipoVehiculo: v.tipoVehiculo, creadoEn: iso(v.creadoEn) };
      break;
    case AccionViaje.REGISTRAR_ARRIBO:
      tipo = 'ConductorArribado';
      datos = { ...base, arriboEn: iso(v.arriboEn) };
      break;
    case AccionViaje.INICIAR:
      tipo = 'ViajeIniciado';
      datos = { ...base, tipoVehiculo: v.tipoVehiculo, iniciadoEn: iso(v.iniciadoEn) };
      break;
    case AccionViaje.FINALIZAR:
      tipo = 'ViajeFinalizado';
      datos = {
        ...base,
        tipoVehiculo: v.tipoVehiculo,
        iniciadoEn: iso(v.iniciadoEn),
        finalizadoEn: iso(v.finalizadoEn),
        distanciaRecorridaMetros: v.cierre?.distanciaRecorridaMetros,
        duracionSegundos: v.cierre?.duracionSegundos,
      };
      break;
    case AccionViaje.CANCELAR:
      tipo = 'ViajeCancelado';
      datos = {
        ...base,
        tipoVehiculo: v.tipoVehiculo,
        canceladoPor: v.cancelacion?.canceladoPor,
        motivo: v.cancelacion?.motivo,
        estadoAlCancelar: v.cancelacion?.estadoAlCancelar,
        requiereRedespacho: v.cancelacion?.requiereRedespacho,
        creadoEn: iso(v.creadoEn),
        arriboEn: iso(v.arriboEn),
        iniciadoEn: iso(v.iniciadoEn),
        canceladoEn: iso(v.canceladoEn),
      };
      break;
  }

  return {
    idEvento: randomUUID(),
    tipo,
    version: 1,
    ocurridoEn: ultima.ocurridoEn.toISOString(),
    productor: PRODUCTOR,
    idCorrelacion,
    datos,
  };
}
