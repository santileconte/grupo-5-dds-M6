import {
  AccionNoPermitidaError,
  DatosInvalidosError,
  MotivoNoPermitidoError,
  TransicionInvalidaError,
} from './errores';
import { TRANSICIONES } from './maquina-estados';
import {
  AccionViaje,
  Actor,
  ESTADOS_TERMINALES,
  EstadoViaje,
  MotivoCancelacion,
  Rol,
  TipoVehiculo,
} from './tipos';
import { DatosNuevoViaje, Viaje } from './viaje';

const M5: Actor = { role: Rol.SYSTEM, id: 'm5-despacho' };
const CLIENT: Actor = { role: Rol.CLIENT, id: 'cliente-1' };
const OTRO_CLIENTE: Actor = { role: Rol.CLIENT, id: 'cliente-2' };
const DRIVER: Actor = { role: Rol.DRIVER, id: 'conductor-1' };
const OTRO_CONDUCTOR: Actor = { role: Rol.DRIVER, id: 'conductor-2' };
const OPERATOR: Actor = { role: Rol.OPERATOR, id: 'operador-1' };

const DATOS: DatosNuevoViaje = {
  id: 'viaje-1',
  requestId: 'solicitud-1',
  clientId: CLIENT.id,
  driverId: DRIVER.id,
  vehicleId: 'vehiculo-1',
  vehicleType: TipoVehiculo.CAR,
  originLatitude: -34.6037,
  originLongitude: -58.3816,
  originAddress: 'Av. Corrientes 1000',
  destinationLatitude: -34.5889,
  destinationLongitude: -58.3974,
  destinationAddress: 'Av. Santa Fe 3000',
};

const T0 = new Date('2026-10-08T12:00:00Z');
const minutos = (n: number) => new Date(T0.getTime() + n * 60_000);

const nuevoViaje = () => Viaje.crear(DATOS, M5, T0);

const viajeArribado = () => {
  const v = nuevoViaje();
  v.registrarArribo(DRIVER, minutos(5));
  return v;
};

const viajeEnCurso = () => {
  const v = viajeArribado();
  v.iniciar(DRIVER, minutos(7));
  return v;
};

describe('Viaje', () => {
  describe('creación', () => {
    it('nace ASIGNADO, con versión 1 y la creación registrada en el historial', () => {
      const v = nuevoViaje();
      expect(v.state).toBe(EstadoViaje.PENDING_ARRIVAL);
      expect(v.version).toBe(1);
      expect(v.history).toEqual([
        expect.objectContaining({ sequence: 1, from: null, to: EstadoViaje.PENDING_ARRIVAL, action: AccionViaje.CREATE }),
      ]);
    });

    it('sólo un servicio (M5) puede crear viajes', () => {
      expect(() => Viaje.crear(DATOS, CLIENT, T0)).toThrow(AccionNoPermitidaError);
    });
  });

  describe('camino feliz', () => {
    it('recorre ASIGNADO → CONDUCTOR_ARRIBADO → EN_CURSO → FINALIZADO', () => {
      const v = viajeEnCurso();
      v.finalizar(DRIVER, { distanceKm: 4.2 }, minutos(22));

      expect(v.state).toBe(EstadoViaje.COMPLETED);
      expect(v.version).toBe(4);
      expect(v.history.map((t) => t.to)).toEqual([
        EstadoViaje.PENDING_ARRIVAL,
        EstadoViaje.DRIVER_ARRIVED,
        EstadoViaje.IN_PROGRESS,
        EstadoViaje.COMPLETED,
      ]);
      expect(v.toProps().closure).toEqual({ distanceKm: 4.2, durationSeconds: 15 * 60 });
    });
  });

  describe('transiciones inválidas (RF-6.1)', () => {
    it('no se puede iniciar sin haber registrado el arribo', () => {
      expect(() => nuevoViaje().iniciar(DRIVER, minutos(1))).toThrow(TransicionInvalidaError);
    });

    it('no se puede finalizar un viaje que no está en curso', () => {
      expect(() => viajeArribado().finalizar(DRIVER, { distanceKm: 0.1 }, minutos(6))).toThrow(
        TransicionInvalidaError,
      );
    });

    it('no se puede finalizar dos veces (RNF-08)', () => {
      const v = viajeEnCurso();
      v.finalizar(DRIVER, { distanceKm: 0.1 }, minutos(10));
      expect(() => v.finalizar(DRIVER, { distanceKm: 0.1 }, minutos(11))).toThrow(
        TransicionInvalidaError,
      );
      expect(v.version).toBe(4);
    });

    it.each(ESTADOS_TERMINALES)('el estado terminal %s no admite ninguna transición', (terminal) => {
      const v = viajeEnCurso();
      if (terminal === EstadoViaje.COMPLETED) {
        v.finalizar(DRIVER, { distanceKm: 0.1 }, minutos(10));
      } else {
        v.cancelar(OPERATOR, { reason: MotivoCancelacion.SECURITY_INCIDENT }, minutos(10));
      }
      expect(TRANSICIONES.some((r) => r.from.includes(terminal))).toBe(false);
      expect(() => v.cancelar(OPERATOR, { reason: MotivoCancelacion.OTHER }, minutos(11))).toThrow(
        TransicionInvalidaError,
      );
    });

    it('un intento fallido no modifica el viaje', () => {
      const v = nuevoViaje();
      const antes = v.toProps();
      expect(() => v.finalizar(DRIVER, { distanceKm: 0.1 }, minutos(1))).toThrow();
      expect(v.toProps()).toEqual(antes);
    });
  });

  describe('permisos (R6-01)', () => {
    it('otro conductor no puede operar el viaje', () => {
      expect(() => nuevoViaje().registrarArribo(OTRO_CONDUCTOR, minutos(1))).toThrow(AccionNoPermitidaError);
    });

    it('otro cliente no puede cancelar el viaje', () => {
      expect(() =>
        nuevoViaje().cancelar(OTRO_CLIENTE, { reason: MotivoCancelacion.CHANGE_OF_PLANS }, minutos(1)),
      ).toThrow(AccionNoPermitidaError);
    });

    it('el cliente no puede registrar el arribo', () => {
      expect(() => nuevoViaje().registrarArribo(CLIENT, minutos(1))).toThrow(AccionNoPermitidaError);
    });
  });

  describe('cancelación (RF-6.6, RF-6.7)', () => {
    it('el cliente cancela antes del inicio y no hay redespacho', () => {
      const v = nuevoViaje();
      v.cancelar(CLIENT, { reason: MotivoCancelacion.CHANGE_OF_PLANS, detail: 'Ya no lo necesito' }, minutos(2));

      expect(v.state).toBe(EstadoViaje.CANCELLED);
      expect(v.toProps().cancellation).toEqual(
        expect.objectContaining({
          cancelledBy: Rol.CLIENT,
          previousState: EstadoViaje.PENDING_ARRIVAL,
          requiresRedispatch: false,
        }),
      );
      expect(v.history.at(-1)).toEqual(
        expect.objectContaining({ reason: MotivoCancelacion.CHANGE_OF_PLANS, detail: 'Ya no lo necesito' }),
      );
    });

    it('el cliente no puede cancelar un viaje en curso', () => {
      expect(() =>
        viajeEnCurso().cancelar(CLIENT, { reason: MotivoCancelacion.CHANGE_OF_PLANS }, minutos(10)),
      ).toThrow(TransicionInvalidaError);
    });

    it('el conductor cancela antes del arribo y la solicitud vuelve al despacho', () => {
      const v = nuevoViaje();
      v.cancelar(DRIVER, { reason: MotivoCancelacion.VEHICLE_PROBLEM }, minutos(2));
      expect(v.toProps().cancellation?.requiresRedispatch).toBe(true);
    });

    it('el operador puede cancelar un viaje en curso', () => {
      const v = viajeEnCurso();
      v.cancelar(OPERATOR, { reason: MotivoCancelacion.SECURITY_INCIDENT }, minutos(10));
      expect(v.state).toBe(EstadoViaje.CANCELLED);
      expect(v.toProps().cancellation?.requiresRedispatch).toBe(false);
    });

    it('rechaza un motivo que no corresponde al rol', () => {
      expect(() =>
        nuevoViaje().cancelar(CLIENT, { reason: MotivoCancelacion.CLIENT_NO_SHOW }, minutos(1)),
      ).toThrow(MotivoNoPermitidoError);
    });

    it('rechaza un detalle demasiado largo', () => {
      expect(() =>
        nuevoViaje().cancelar(CLIENT, { reason: MotivoCancelacion.OTHER, detail: 'x'.repeat(501) }, minutos(1)),
      ).toThrow(DatosInvalidosError);
    });
  });

  describe('cliente no se presentó (R6-04)', () => {
    it('no se permite antes del arribo', () => {
      expect(() =>
        nuevoViaje().cancelar(DRIVER, { reason: MotivoCancelacion.CLIENT_NO_SHOW }, minutos(20)),
      ).toThrow(MotivoNoPermitidoError);
    });

    it('no se permite antes de la espera mínima', () => {
      // arribo en el minuto 5, espera mínima de 5 minutos
      expect(() =>
        viajeArribado().cancelar(DRIVER, { reason: MotivoCancelacion.CLIENT_NO_SHOW }, minutos(9)),
      ).toThrow(MotivoNoPermitidoError);
    });

    it('se permite cumplida la espera y no hay redespacho', () => {
      const v = viajeArribado();
      v.cancelar(DRIVER, { reason: MotivoCancelacion.CLIENT_NO_SHOW }, minutos(10));
      expect(v.state).toBe(EstadoViaje.CANCELLED);
      expect(v.toProps().cancellation?.requiresRedispatch).toBe(false);
    });

    it('respeta una espera mínima configurada', () => {
      const v = viajeArribado();
      v.cancelar(DRIVER, { reason: MotivoCancelacion.CLIENT_NO_SHOW }, minutos(6), {
        esperaMinimaArriboMinutos: 1,
      });
      expect(v.state).toBe(EstadoViaje.CANCELLED);
    });
  });

  describe('finalización (RF-6.5)', () => {
    it.each([-1, 0, 0.09, Number.NaN, Number.POSITIVE_INFINITY])('rechaza la distancia %p', (distancia) => {
      expect(() => viajeEnCurso().finalizar(DRIVER, { distanceKm: distancia }, minutos(10))).toThrow(
        DatosInvalidosError,
      );
    });
  });

  describe('historial no destructivo (RF-6.8)', () => {
    it('las transiciones registradas no se pueden modificar', () => {
      const v = viajeArribado();
      const primera = v.history[0];
      expect(Object.isFrozen(primera)).toBe(true);
      expect(() => {
        (primera as { to: EstadoViaje }).to = EstadoViaje.CANCELLED;
      }).toThrow(TypeError);
    });

    it('las copias del historial no afectan al viaje', () => {
      const v = nuevoViaje();
      v.toProps().history.pop();
      expect(v.history).toHaveLength(1);
    });

    it('reconstituir conserva estado, versión e historial', () => {
      const v = viajeEnCurso();
      const copia = Viaje.reconstituir(v.toProps());
      expect(copia.toProps()).toEqual(v.toProps());
      copia.finalizar(DRIVER, { distanceKm: 0.1 }, minutos(12));
      expect(v.state).toBe(EstadoViaje.IN_PROGRESS);
    });
  });
});
