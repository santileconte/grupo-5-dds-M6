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

const M5: Actor = { rol: Rol.SERVICIO, id: 'm5-despacho' };
const CLIENTE: Actor = { rol: Rol.CLIENTE, id: 'cliente-1' };
const OTRO_CLIENTE: Actor = { rol: Rol.CLIENTE, id: 'cliente-2' };
const CONDUCTOR: Actor = { rol: Rol.CONDUCTOR, id: 'conductor-1' };
const OTRO_CONDUCTOR: Actor = { rol: Rol.CONDUCTOR, id: 'conductor-2' };
const OPERADOR: Actor = { rol: Rol.OPERADOR, id: 'operador-1' };

const DATOS: DatosNuevoViaje = {
  id: 'viaje-1',
  solicitudId: 'solicitud-1',
  asignacionId: 'asignacion-1',
  clienteId: CLIENTE.id,
  conductorId: CONDUCTOR.id,
  vehiculoId: 'vehiculo-1',
  tipoVehiculo: TipoVehiculo.AUTO,
  origen: { latitud: -34.6037, longitud: -58.3816, direccion: 'Av. Corrientes 1000' },
  destino: { latitud: -34.5889, longitud: -58.3974, direccion: 'Av. Santa Fe 3000' },
};

const T0 = new Date('2026-10-08T12:00:00Z');
const minutos = (n: number) => new Date(T0.getTime() + n * 60_000);

const nuevoViaje = () => Viaje.crear(DATOS, M5, T0);

const viajeArribado = () => {
  const v = nuevoViaje();
  v.registrarArribo(CONDUCTOR, minutos(5));
  return v;
};

const viajeEnCurso = () => {
  const v = viajeArribado();
  v.iniciar(CONDUCTOR, minutos(7));
  return v;
};

describe('Viaje', () => {
  describe('creación', () => {
    it('nace ASIGNADO, con versión 1 y la creación registrada en el historial', () => {
      const v = nuevoViaje();
      expect(v.estado).toBe(EstadoViaje.ASIGNADO);
      expect(v.version).toBe(1);
      expect(v.historial).toEqual([
        expect.objectContaining({ secuencia: 1, desde: null, hacia: EstadoViaje.ASIGNADO, accion: AccionViaje.CREAR }),
      ]);
    });

    it('sólo un servicio (M5) puede crear viajes', () => {
      expect(() => Viaje.crear(DATOS, CLIENTE, T0)).toThrow(AccionNoPermitidaError);
    });
  });

  describe('camino feliz', () => {
    it('recorre ASIGNADO → CONDUCTOR_ARRIBADO → EN_CURSO → FINALIZADO', () => {
      const v = viajeEnCurso();
      v.finalizar(CONDUCTOR, { distanciaRecorridaMetros: 4200 }, minutos(22));

      expect(v.estado).toBe(EstadoViaje.FINALIZADO);
      expect(v.version).toBe(4);
      expect(v.historial.map((t) => t.hacia)).toEqual([
        EstadoViaje.ASIGNADO,
        EstadoViaje.CONDUCTOR_ARRIBADO,
        EstadoViaje.EN_CURSO,
        EstadoViaje.FINALIZADO,
      ]);
      expect(v.toProps().cierre).toEqual({ distanciaRecorridaMetros: 4200, duracionSegundos: 15 * 60 });
    });
  });

  describe('transiciones inválidas (RF-6.1)', () => {
    it('no se puede iniciar sin haber registrado el arribo', () => {
      expect(() => nuevoViaje().iniciar(CONDUCTOR, minutos(1))).toThrow(TransicionInvalidaError);
    });

    it('no se puede finalizar un viaje que no está en curso', () => {
      expect(() => viajeArribado().finalizar(CONDUCTOR, { distanciaRecorridaMetros: 1 }, minutos(6))).toThrow(
        TransicionInvalidaError,
      );
    });

    it('no se puede finalizar dos veces (RNF-08)', () => {
      const v = viajeEnCurso();
      v.finalizar(CONDUCTOR, { distanciaRecorridaMetros: 100 }, minutos(10));
      expect(() => v.finalizar(CONDUCTOR, { distanciaRecorridaMetros: 100 }, minutos(11))).toThrow(
        TransicionInvalidaError,
      );
      expect(v.version).toBe(4);
    });

    it.each(ESTADOS_TERMINALES)('el estado terminal %s no admite ninguna transición', (terminal) => {
      const v = viajeEnCurso();
      if (terminal === EstadoViaje.FINALIZADO) {
        v.finalizar(CONDUCTOR, { distanciaRecorridaMetros: 100 }, minutos(10));
      } else {
        v.cancelar(OPERADOR, { motivo: MotivoCancelacion.INCIDENTE_DE_SEGURIDAD }, minutos(10));
      }
      expect(TRANSICIONES.some((r) => r.desde.includes(terminal))).toBe(false);
      expect(() => v.cancelar(OPERADOR, { motivo: MotivoCancelacion.OTRO }, minutos(11))).toThrow(
        TransicionInvalidaError,
      );
    });

    it('un intento fallido no modifica el viaje', () => {
      const v = nuevoViaje();
      const antes = v.toProps();
      expect(() => v.finalizar(CONDUCTOR, { distanciaRecorridaMetros: 1 }, minutos(1))).toThrow();
      expect(v.toProps()).toEqual(antes);
    });
  });

  describe('permisos (R6-01)', () => {
    it('otro conductor no puede operar el viaje', () => {
      expect(() => nuevoViaje().registrarArribo(OTRO_CONDUCTOR, minutos(1))).toThrow(AccionNoPermitidaError);
    });

    it('otro cliente no puede cancelar el viaje', () => {
      expect(() =>
        nuevoViaje().cancelar(OTRO_CLIENTE, { motivo: MotivoCancelacion.CAMBIO_DE_PLANES }, minutos(1)),
      ).toThrow(AccionNoPermitidaError);
    });

    it('el cliente no puede registrar el arribo', () => {
      expect(() => nuevoViaje().registrarArribo(CLIENTE, minutos(1))).toThrow(AccionNoPermitidaError);
    });
  });

  describe('cancelación (RF-6.6, RF-6.7)', () => {
    it('el cliente cancela antes del inicio y no hay redespacho', () => {
      const v = nuevoViaje();
      v.cancelar(CLIENTE, { motivo: MotivoCancelacion.CAMBIO_DE_PLANES, detalle: 'Ya no lo necesito' }, minutos(2));

      expect(v.estado).toBe(EstadoViaje.CANCELADO);
      expect(v.toProps().cancelacion).toEqual(
        expect.objectContaining({
          canceladoPor: Rol.CLIENTE,
          estadoAlCancelar: EstadoViaje.ASIGNADO,
          requiereRedespacho: false,
        }),
      );
      expect(v.historial.at(-1)).toEqual(
        expect.objectContaining({ motivo: MotivoCancelacion.CAMBIO_DE_PLANES, detalle: 'Ya no lo necesito' }),
      );
    });

    it('el cliente no puede cancelar un viaje en curso', () => {
      expect(() =>
        viajeEnCurso().cancelar(CLIENTE, { motivo: MotivoCancelacion.CAMBIO_DE_PLANES }, minutos(10)),
      ).toThrow(TransicionInvalidaError);
    });

    it('el conductor cancela antes del arribo y la solicitud vuelve al despacho', () => {
      const v = nuevoViaje();
      v.cancelar(CONDUCTOR, { motivo: MotivoCancelacion.PROBLEMA_CON_VEHICULO }, minutos(2));
      expect(v.toProps().cancelacion?.requiereRedespacho).toBe(true);
    });

    it('el operador puede cancelar un viaje en curso', () => {
      const v = viajeEnCurso();
      v.cancelar(OPERADOR, { motivo: MotivoCancelacion.INCIDENTE_DE_SEGURIDAD }, minutos(10));
      expect(v.estado).toBe(EstadoViaje.CANCELADO);
      expect(v.toProps().cancelacion?.requiereRedespacho).toBe(false);
    });

    it('rechaza un motivo que no corresponde al rol', () => {
      expect(() =>
        nuevoViaje().cancelar(CLIENTE, { motivo: MotivoCancelacion.CLIENTE_NO_SE_PRESENTO }, minutos(1)),
      ).toThrow(MotivoNoPermitidoError);
    });

    it('rechaza un detalle demasiado largo', () => {
      expect(() =>
        nuevoViaje().cancelar(CLIENTE, { motivo: MotivoCancelacion.OTRO, detalle: 'x'.repeat(501) }, minutos(1)),
      ).toThrow(DatosInvalidosError);
    });
  });

  describe('cliente no se presentó (R6-04)', () => {
    it('no se permite antes del arribo', () => {
      expect(() =>
        nuevoViaje().cancelar(CONDUCTOR, { motivo: MotivoCancelacion.CLIENTE_NO_SE_PRESENTO }, minutos(20)),
      ).toThrow(MotivoNoPermitidoError);
    });

    it('no se permite antes de la espera mínima', () => {
      // arribo en el minuto 5, espera mínima de 5 minutos
      expect(() =>
        viajeArribado().cancelar(CONDUCTOR, { motivo: MotivoCancelacion.CLIENTE_NO_SE_PRESENTO }, minutos(9)),
      ).toThrow(MotivoNoPermitidoError);
    });

    it('se permite cumplida la espera y no hay redespacho', () => {
      const v = viajeArribado();
      v.cancelar(CONDUCTOR, { motivo: MotivoCancelacion.CLIENTE_NO_SE_PRESENTO }, minutos(10));
      expect(v.estado).toBe(EstadoViaje.CANCELADO);
      expect(v.toProps().cancelacion?.requiereRedespacho).toBe(false);
    });

    it('respeta una espera mínima configurada', () => {
      const v = viajeArribado();
      v.cancelar(CONDUCTOR, { motivo: MotivoCancelacion.CLIENTE_NO_SE_PRESENTO }, minutos(6), {
        esperaMinimaArriboMinutos: 1,
      });
      expect(v.estado).toBe(EstadoViaje.CANCELADO);
    });
  });

  describe('finalización (RF-6.5)', () => {
    it.each([-1, Number.NaN, Number.POSITIVE_INFINITY])('rechaza la distancia %p', (distancia) => {
      expect(() => viajeEnCurso().finalizar(CONDUCTOR, { distanciaRecorridaMetros: distancia }, minutos(10))).toThrow(
        DatosInvalidosError,
      );
    });
  });

  describe('historial no destructivo (RF-6.8)', () => {
    it('las transiciones registradas no se pueden modificar', () => {
      const v = viajeArribado();
      const primera = v.historial[0];
      expect(Object.isFrozen(primera)).toBe(true);
      expect(() => {
        (primera as { hacia: EstadoViaje }).hacia = EstadoViaje.CANCELADO;
      }).toThrow(TypeError);
    });

    it('las copias del historial no afectan al viaje', () => {
      const v = nuevoViaje();
      v.toProps().historial.pop();
      expect(v.historial).toHaveLength(1);
    });

    it('reconstituir conserva estado, versión e historial', () => {
      const v = viajeEnCurso();
      const copia = Viaje.reconstituir(v.toProps());
      expect(copia.toProps()).toEqual(v.toProps());
      copia.finalizar(CONDUCTOR, { distanciaRecorridaMetros: 10 }, minutos(12));
      expect(v.estado).toBe(EstadoViaje.EN_CURSO);
    });
  });
});
