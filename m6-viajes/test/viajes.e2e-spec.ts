import { randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { DependenciaNoDisponibleError } from '../src/viajes/aplicacion/errores';
import { ResultadoValidacionCodigo, ValidadorCodigoVerificacion } from '../src/viajes/aplicacion/puertos';
import { RelevadorDeEventos } from '../src/viajes/aplicacion/relevador-de-eventos';
import { PublicadorEventosEnLog } from '../src/viajes/infraestructura/publicador-eventos.log';
import { bearer, crearApp, cuerpoCrearViaje, nuevosIds } from './app-de-prueba';

const M5 = bearer('SERVICIO', 'm5-despacho');
const OPERADOR = bearer('OPERADOR', randomUUID());

describe('API de viajes (integración)', () => {
  let app: INestApplication;
  let eventos: PublicadorEventosEnLog;
  let relevador: RelevadorDeEventos;
  let http: ReturnType<typeof request>;

  beforeAll(async () => {
    ({ app, eventos, relevador } = await crearApp());
    http = request(app.getHttpServer());
  });

  afterAll(() => app.close());

  /** Crea un viaje y devuelve su id y los tokens de su cliente y conductor. */
  async function crearViaje() {
    const ids = nuevosIds();
    const res = await http.post('/viajes').set('Authorization', M5).send(cuerpoCrearViaje(ids)).expect(201);
    return {
      id: res.body.id as string,
      ids,
      cliente: bearer('CLIENTE', ids.clienteId),
      conductor: bearer('CONDUCTOR', ids.conductorId),
    };
  }

  async function viajeEnCurso() {
    const v = await crearViaje();
    await http.post(`/viajes/${v.id}/arribo`).set('Authorization', v.conductor).expect(200);
    await http
      .post(`/viajes/${v.id}/inicio`)
      .set('Authorization', v.conductor)
      .send({ codigoVerificacion: `QR-${v.id}` })
      .expect(200);
    return v;
  }

  /** Hace correr al relevador (en los tests no corre solo) y devuelve lo publicado para ese viaje. */
  const eventosDe = async (viajeId: string) => {
    await relevador.procesar();
    return eventos.publicados.filter((e) => e.datos.viajeId === viajeId);
  };

  describe('infraestructura común', () => {
    it('GET /salud no requiere token', async () => {
      await http.get('/salud').expect(200, { estado: 'OK' });
    });

    it('sin token responde 401 en formato problem+json', async () => {
      const res = await http.get('/viajes').expect(401);
      expect(res.headers['content-type']).toContain('application/problem+json');
      expect(res.body).toMatchObject({ status: 401, codigo: 'NO_AUTENTICADO' });
    });

    it('rechaza un token firmado con otro secreto', async () => {
      const { JwtService } = await import('@nestjs/jwt');
      const falso = new JwtService({ secret: 'otro-secreto-cualquiera-1234' }).sign({ sub: 'x', rol: 'OPERADOR' });
      await http.get('/viajes').set('Authorization', `Bearer ${falso}`).expect(401);
    });

    it('una ruta inexistente responde 404 RUTA_NO_ENCONTRADA', async () => {
      const res = await http.get('/no-existe').set('Authorization', OPERADOR).expect(404);
      expect(res.body.codigo).toBe('RUTA_NO_ENCONTRADA');
    });

    it('propaga el X-Correlation-Id a la respuesta y a los eventos', async () => {
      const res = await http
        .post('/viajes')
        .set('Authorization', M5)
        .set('X-Correlation-Id', 'mi-correlacion-123')
        .send(cuerpoCrearViaje())
        .expect(201);
      expect(res.headers['x-correlation-id']).toBe('mi-correlacion-123');
      expect((await eventosDe(res.body.id))[0].idCorrelacion).toBe('mi-correlacion-123');
    });
  });

  describe('POST /viajes', () => {
    it('crea el viaje en ASIGNADO, con Location, ETag y evento ViajeCreado', async () => {
      const cuerpo = cuerpoCrearViaje();
      const res = await http.post('/viajes').set('Authorization', M5).send(cuerpo).expect(201);

      expect(res.body).toMatchObject({ estado: 'ASIGNADO', version: 1, reservaId: null, cierre: null });
      expect(res.headers.location).toBe(`/viajes/${res.body.id}`);
      expect(res.headers.etag).toBe('"1"');
      expect((await eventosDe(res.body.id))).toEqual([
        expect.objectContaining({
          tipo: 'ViajeCreado',
          productor: 'm6-viajes',
          datos: expect.objectContaining({ solicitudId: cuerpo.solicitudId, tipoVehiculo: 'AUTO', versionViaje: 1 }),
        }),
      ]);
    });

    it('es idempotente por asignacionId: repetir devuelve el mismo viaje con 200', async () => {
      const cuerpo = cuerpoCrearViaje();
      const primero = await http.post('/viajes').set('Authorization', M5).send(cuerpo).expect(201);
      const segundo = await http.post('/viajes').set('Authorization', M5).send(cuerpo).expect(200);
      expect(segundo.body.id).toBe(primero.body.id);
      expect((await eventosDe(primero.body.id))).toHaveLength(1);
    });

    it('rechaza otra asignación para una solicitud con viaje activo', async () => {
      const cuerpo = cuerpoCrearViaje();
      await http.post('/viajes').set('Authorization', M5).send(cuerpo).expect(201);
      const res = await http
        .post('/viajes')
        .set('Authorization', M5)
        .send({ ...cuerpo, asignacionId: randomUUID() })
        .expect(409);
      expect(res.body.codigo).toBe('VIAJE_ACTIVO_EXISTENTE');
    });

    it('sólo un servicio puede crear viajes', async () => {
      const res = await http
        .post('/viajes')
        .set('Authorization', bearer('CLIENTE', randomUUID()))
        .send(cuerpoCrearViaje())
        .expect(403);
      expect(res.body.codigo).toBe('PROHIBIDO');
    });

    it('valida el cuerpo e informa cada campo inválido', async () => {
      const cuerpo = { ...cuerpoCrearViaje(), tipoVehiculo: 'CAMION', origen: { latitud: 200, longitud: 0 } };
      const res = await http.post('/viajes').set('Authorization', M5).send(cuerpo).expect(400);
      expect(res.body.codigo).toBe('VALIDACION');
      const campos = res.body.errores.map((e: { campo: string }) => e.campo);
      expect(campos).toEqual(expect.arrayContaining(['tipoVehiculo', 'origen.latitud']));
    });

    it('rechaza campos que no están en el contrato', async () => {
      await http
        .post('/viajes')
        .set('Authorization', M5)
        .send({ ...cuerpoCrearViaje(), tarifa: 1000 })
        .expect(400);
    });
  });

  describe('ciclo de vida completo', () => {
    it('ASIGNADO → CONDUCTOR_ARRIBADO → EN_CURSO → FINALIZADO, con historial y eventos', async () => {
      const v = await crearViaje();

      const arribo = await http.post(`/viajes/${v.id}/arribo`).set('Authorization', v.conductor).expect(200);
      expect(arribo.body.estado).toBe('CONDUCTOR_ARRIBADO');
      expect(arribo.headers.etag).toBe('"2"');

      const inicio = await http
        .post(`/viajes/${v.id}/inicio`)
        .set('Authorization', v.conductor)
        .send({ codigoVerificacion: `QR-${v.id}` })
        .expect(200);
      expect(inicio.body.estado).toBe('EN_CURSO');

      const fin = await http
        .post(`/viajes/${v.id}/finalizacion`)
        .set('Authorization', v.conductor)
        .send({ distanciaRecorridaMetros: 4200 })
        .expect(200);
      expect(fin.body).toMatchObject({
        estado: 'FINALIZADO',
        version: 4,
        cierre: { distanciaRecorridaMetros: 4200, duracionSegundos: expect.any(Number) },
      });

      const historial = await http.get(`/viajes/${v.id}/historial`).set('Authorization', v.cliente).expect(200);
      expect(historial.body.transiciones.map((t: { hacia: string }) => t.hacia)).toEqual([
        'ASIGNADO',
        'CONDUCTOR_ARRIBADO',
        'EN_CURSO',
        'FINALIZADO',
      ]);
      expect(historial.body.transiciones[0]).toMatchObject({ secuencia: 1, desde: null, accion: 'CREAR' });

      expect((await eventosDe(v.id)).map((e) => e.tipo)).toEqual([
        'ViajeCreado',
        'ConductorArribado',
        'ViajeIniciado',
        'ViajeFinalizado',
      ]);
      expect((await eventosDe(v.id))[3].datos).toMatchObject({ distanciaRecorridaMetros: 4200, versionViaje: 4 });
    });

    it('una transición inválida responde 409 con el estado actual', async () => {
      const v = await crearViaje();
      const res = await http
        .post(`/viajes/${v.id}/finalizacion`)
        .set('Authorization', v.conductor)
        .send({ distanciaRecorridaMetros: 10 })
        .expect(409);
      expect(res.body).toMatchObject({ codigo: 'TRANSICION_INVALIDA', estadoActual: 'ASIGNADO' });
    });

    it('otro conductor no puede operar el viaje', async () => {
      const v = await crearViaje();
      const res = await http
        .post(`/viajes/${v.id}/arribo`)
        .set('Authorization', bearer('CONDUCTOR', randomUUID()))
        .expect(403);
      expect(res.body.codigo).toBe('PROHIBIDO');
    });

    it('un viaje inexistente responde 404', async () => {
      const res = await http.post(`/viajes/${randomUUID()}/arribo`).set('Authorization', OPERADOR).expect(404);
      expect(res.body.codigo).toBe('VIAJE_NO_ENCONTRADO');
    });
  });

  describe('inicio con QR (RF-6.4)', () => {
    it('un código incorrecto responde 422 y el viaje no cambia', async () => {
      const v = await crearViaje();
      await http.post(`/viajes/${v.id}/arribo`).set('Authorization', v.conductor).expect(200);

      const res = await http
        .post(`/viajes/${v.id}/inicio`)
        .set('Authorization', v.conductor)
        .send({ codigoVerificacion: 'cualquier-cosa' })
        .expect(422);
      expect(res.body.codigo).toBe('CODIGO_VERIFICACION_INVALIDO');

      const viaje = await http.get(`/viajes/${v.id}`).set('Authorization', v.conductor).expect(200);
      expect(viaje.body.estado).toBe('CONDUCTOR_ARRIBADO');
    });

    it('el QR es de un solo uso', async () => {
      const v = await viajeEnCurso();
      const otro = await http
        .post(`/viajes/${v.id}/inicio`)
        .set('Authorization', v.conductor)
        .send({ codigoVerificacion: `QR-${v.id}` })
        .expect(409);
      expect(otro.body.codigo).toBe('TRANSICION_INVALIDA');
    });

    it('si la transición no es válida, no gasta el QR', async () => {
      const v = await crearViaje();
      // Intento de inicio sin arribo: debe fallar sin consumir el código.
      await http
        .post(`/viajes/${v.id}/inicio`)
        .set('Authorization', v.conductor)
        .send({ codigoVerificacion: `QR-${v.id}` })
        .expect(409);
      await http.post(`/viajes/${v.id}/arribo`).set('Authorization', v.conductor).expect(200);
      await http
        .post(`/viajes/${v.id}/inicio`)
        .set('Authorization', v.conductor)
        .send({ codigoVerificacion: `QR-${v.id}` })
        .expect(200);
    });
  });

  describe('cancelación', () => {
    it('el conductor cancela antes del arribo y la solicitud vuelve a despacho', async () => {
      const v = await crearViaje();
      const res = await http
        .post(`/viajes/${v.id}/cancelacion`)
        .set('Authorization', v.conductor)
        .send({ motivo: 'PROBLEMA_CON_VEHICULO', detalle: 'Pinché una goma' })
        .expect(200);
      expect(res.body).toMatchObject({
        estado: 'CANCELADO',
        cancelacion: { canceladoPor: 'CONDUCTOR', estadoAlCancelar: 'ASIGNADO', requiereRedespacho: true },
      });
      const evento = (await eventosDe(v.id)).at(-1);
      expect(evento).toMatchObject({
        tipo: 'ViajeCancelado',
        datos: expect.objectContaining({ requiereRedespacho: true, motivo: 'PROBLEMA_CON_VEHICULO' }),
      });
      // El detalle libre no viaja en el evento (RNF-19).
      expect(evento?.datos).not.toHaveProperty('detalle');
    });

    it('un motivo que no corresponde al rol responde 422', async () => {
      const v = await crearViaje();
      const res = await http
        .post(`/viajes/${v.id}/cancelacion`)
        .set('Authorization', v.cliente)
        .send({ motivo: 'INCIDENTE_DE_SEGURIDAD' })
        .expect(422);
      expect(res.body.codigo).toBe('MOTIVO_NO_PERMITIDO');
    });

    it('un motivo inexistente responde 400', async () => {
      const v = await crearViaje();
      await http.post(`/viajes/${v.id}/cancelacion`).set('Authorization', v.cliente).send({ motivo: 'NO_SE' }).expect(400);
    });
  });

  describe('consultas y visibilidad', () => {
    it('el cliente del viaje y el operador lo ven; otro cliente recibe 404', async () => {
      const v = await crearViaje();
      await http.get(`/viajes/${v.id}`).set('Authorization', v.cliente).expect(200);
      await http.get(`/viajes/${v.id}`).set('Authorization', OPERADOR).expect(200);
      await http.get(`/viajes/${v.id}`).set('Authorization', bearer('CLIENTE', randomUUID())).expect(404);
    });

    it('un servicio no puede ver el historial', async () => {
      const v = await crearViaje();
      await http.get(`/viajes/${v.id}/historial`).set('Authorization', M5).expect(403);
    });

    it('el cliente sólo lista sus viajes aunque pida los de otro', async () => {
      const a = await crearViaje();
      const b = await crearViaje();
      const res = await http
        .get('/viajes')
        .query({ clienteId: b.ids.clienteId })
        .set('Authorization', a.cliente)
        .expect(200);
      expect(res.body).toMatchObject({ total: 1, pagina: 1, tamanio: 20 });
      expect(res.body.items[0]).toMatchObject({ id: a.id, direccionOrigen: 'Av. Corrientes 1000' });
    });

    it('un servicio debe indicar clienteId o conductorId', async () => {
      await http.get('/viajes').set('Authorization', M5).expect(400);
    });

    it('filtra por estado y pagina', async () => {
      const v = await viajeEnCurso();
      const otro = await crearViaje();
      const enCurso = await http
        .get('/viajes')
        .query({ estado: 'EN_CURSO,FINALIZADO', tamanio: 100 })
        .set('Authorization', OPERADOR)
        .expect(200);
      const ids = enCurso.body.items.map((i: { id: string }) => i.id);
      expect(ids).toContain(v.id);
      expect(ids).not.toContain(otro.id);

      const pagina = await http.get('/viajes').query({ tamanio: 1, pagina: 2 }).set('Authorization', OPERADOR).expect(200);
      expect(pagina.body.items).toHaveLength(1);
      expect(pagina.body.total).toBeGreaterThan(1);
    });

    it('valida los parámetros de la consulta', async () => {
      await http.get('/viajes').query({ tamanio: 500 }).set('Authorization', OPERADOR).expect(400);
      await http.get('/viajes').query({ estado: 'VOLANDO' }).set('Authorization', OPERADOR).expect(400);
    });
  });

  describe('concurrencia e idempotencia (RNF-08, RNF-09)', () => {
    it('If-Match con una versión vieja responde 412; con la actual, 200', async () => {
      const v = await crearViaje();
      const res = await http
        .post(`/viajes/${v.id}/arribo`)
        .set('Authorization', v.conductor)
        .set('If-Match', '"7"')
        .expect(412);
      expect(res.body.codigo).toBe('PRECONDICION_FALLIDA');
      await http.post(`/viajes/${v.id}/arribo`).set('Authorization', v.conductor).set('If-Match', '"1"').expect(200);
    });

    it('un If-Match mal formado responde 400', async () => {
      const v = await crearViaje();
      await http.post(`/viajes/${v.id}/arribo`).set('Authorization', v.conductor).set('If-Match', 'abc').expect(400);
    });

    it('repetir un pedido con la misma Idempotency-Key devuelve la respuesta original', async () => {
      const v = await crearViaje();
      const clave = randomUUID();
      const enviar = () =>
        http
          .post(`/viajes/${v.id}/cancelacion`)
          .set('Authorization', v.cliente)
          .set('Idempotency-Key', clave)
          .send({ motivo: 'CAMBIO_DE_PLANES' });

      const primero = await enviar().expect(200);
      const repetido = await enviar().expect(200);
      expect(repetido.body).toEqual(primero.body);
      expect(repetido.headers['idempotent-replayed']).toBe('true');
      expect((await eventosDe(v.id)).filter((e) => e.tipo === 'ViajeCancelado')).toHaveLength(1);
    });

    it('dos finalizaciones simultáneas: sólo una gana', async () => {
      const v = await viajeEnCurso();
      const finalizar = () =>
        http
          .post(`/viajes/${v.id}/finalizacion`)
          .set('Authorization', v.conductor)
          .send({ distanciaRecorridaMetros: 1000 });

      const respuestas = await Promise.all([finalizar(), finalizar(), finalizar()]);
      expect(respuestas.map((r) => r.status).sort()).toEqual([200, 409, 409]);
      expect((await eventosDe(v.id)).filter((e) => e.tipo === 'ViajeFinalizado')).toHaveLength(1);
    });
  });
});

describe('API de viajes con M8 lento o caído (RNF-13)', () => {
  /** Validador controlable: espera `demoraMs` y luego responde o falla. */
  class ValidadorDePrueba implements ValidadorCodigoVerificacion {
    demoraMs = 0;
    caido = false;
    async validarYConsumir(): Promise<ResultadoValidacionCodigo> {
      await new Promise((r) => setTimeout(r, this.demoraMs));
      if (this.caido) throw new DependenciaNoDisponibleError('M8 (Notificaciones)');
      return 'VALIDO';
    }
  }

  const validador = new ValidadorDePrueba();
  let app: INestApplication;
  let http: ReturnType<typeof request>;

  beforeAll(async () => {
    ({ app } = await crearApp(validador));
    http = request(app.getHttpServer());
  });

  afterAll(() => app.close());

  beforeEach(() => {
    validador.demoraMs = 0;
    validador.caido = false;
  });

  async function viajeArribado() {
    const ids = nuevosIds();
    const res = await http.post('/viajes').set('Authorization', M5).send(cuerpoCrearViaje(ids)).expect(201);
    const conductor = bearer('CONDUCTOR', ids.conductorId);
    await http.post(`/viajes/${res.body.id}/arribo`).set('Authorization', conductor).expect(200);
    return { id: res.body.id as string, conductor };
  }

  it('si M8 no responde, devuelve 503 con Retry-After y el viaje no cambia', async () => {
    const v = await viajeArribado();
    validador.caido = true;

    const res = await http
      .post(`/viajes/${v.id}/inicio`)
      .set('Authorization', v.conductor)
      .send({ codigoVerificacion: 'x' })
      .expect(503);
    expect(res.body.codigo).toBe('DEPENDENCIA_NO_DISPONIBLE');
    expect(res.headers['retry-after']).toBe('5');

    const viaje = await http.get(`/viajes/${v.id}`).set('Authorization', v.conductor).expect(200);
    expect(viaje.body.estado).toBe('CONDUCTOR_ARRIBADO');
  });

  it('dos inicios simultáneos mientras M8 demora: uno gana y el otro recibe CONFLICTO_CONCURRENCIA', async () => {
    const v = await viajeArribado();
    validador.demoraMs = 50;
    const iniciar = () =>
      http.post(`/viajes/${v.id}/inicio`).set('Authorization', v.conductor).send({ codigoVerificacion: 'x' });

    const [a, b] = await Promise.all([iniciar(), iniciar()]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    expect([a.body.codigo, b.body.codigo]).toContain('CONFLICTO_CONCURRENCIA');
  });
});
