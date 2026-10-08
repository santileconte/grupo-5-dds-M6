import { randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import { bearer, crearApp, cuerpoCrearViaje } from './app-de-prueba';
import { SECRETO_TESTS } from './entorno';

const M5 = bearer('SERVICIO', 'm5-despacho');

describe('Seguridad web (RNF-12)', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;

  beforeAll(async () => {
    ({ app } = await crearApp());
    http = request(app.getHttpServer());
  });

  afterAll(() => app.close());

  it('agrega headers de seguridad y no revela la tecnología', async () => {
    const res = await http.get('/salud').expect(200);
    expect(res.headers['x-powered-by']).toBeUndefined();
    expect(res.headers['content-security-policy']).toContain("default-src 'self'");
    expect(res.headers['strict-transport-security']).toContain('max-age=');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-frame-options']).toBe('SAMEORIGIN');
  });

  it('rechaza un cuerpo demasiado grande con 413 (antes respondía 500)', async () => {
    const res = await http
      .post('/viajes')
      .set('Authorization', M5)
      .send({ ...cuerpoCrearViaje(), relleno: 'x'.repeat(20_000) })
      .expect(413);
    expect(res.body.codigo).toBe('CUERPO_DEMASIADO_GRANDE');
  });

  it('un JSON mal formado responde 400 VALIDACION', async () => {
    const res = await http
      .post('/viajes')
      .set('Authorization', M5)
      .set('Content-Type', 'application/json')
      .send('{"solicitudId":')
      .expect(400);
    expect(res.body.codigo).toBe('VALIDACION');
  });

  it('rechaza un token sin vencimiento', async () => {
    const sinVencimiento = new JwtService({ secret: SECRETO_TESTS }).sign({ sub: 'm5', rol: 'SERVICIO' });
    const res = await http.get('/viajes').set('Authorization', `Bearer ${sinVencimiento}`).expect(401);
    expect(res.body.detail).toContain('vencimiento');
  });

  it('rechaza un token vencido', async () => {
    const vencido = new JwtService({ secret: SECRETO_TESTS }).sign(
      { sub: 'm5', rol: 'SERVICIO', exp: Math.floor(Date.now() / 1000) - 3600 },
    );
    await http.get('/viajes').set('Authorization', `Bearer ${vencido}`).expect(401);
  });

  it('descarta un X-Correlation-Id con caracteres peligrosos para los logs', async () => {
    const res = await http.get('/salud').set('X-Correlation-Id', 'abc\tFALSO nivel=error').expect(200);
    expect(res.headers['x-correlation-id']).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('CORS: sólo responde a los orígenes configurados', async () => {
    const permitido = await http.get('/salud').set('Origin', 'https://front.example');
    expect(permitido.headers['access-control-allow-origin']).toBe('https://front.example');
    const otro = await http.get('/salud').set('Origin', 'https://malicioso.example');
    expect(otro.headers['access-control-allow-origin']).toBeUndefined();
  });
});

describe('Límite de pedidos por usuario (RNF-12)', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;

  beforeAll(async () => {
    ({ app } = await crearApp({ limite: { porMinuto: 3, porMinutoServicio: 0 } }));
    http = request(app.getHttpServer());
  });

  afterAll(() => app.close());

  it('informa los pedidos restantes y responde 429 al superar el límite', async () => {
    const cliente = bearer('CLIENTE', randomUUID());
    const restantes: string[] = [];
    for (let i = 0; i < 3; i++) {
      const res = await http.get('/viajes').set('Authorization', cliente).expect(200);
      restantes.push(res.headers['ratelimit-remaining']);
    }
    expect(restantes).toEqual(['2', '1', '0']);

    const bloqueado = await http.get('/viajes').set('Authorization', cliente).expect(429);
    expect(bloqueado.body.codigo).toBe('DEMASIADOS_PEDIDOS');
    expect(Number(bloqueado.headers['retry-after'])).toBeGreaterThan(0);
  });

  it('el límite es por usuario: otro usuario no se ve afectado', async () => {
    const a = bearer('CLIENTE', randomUUID());
    for (let i = 0; i < 4; i++) await http.get('/viajes').set('Authorization', a);
    await http.get('/viajes').set('Authorization', bearer('CLIENTE', randomUUID())).expect(200);
  });

  it('con límite 0, los servicios no tienen límite', async () => {
    for (let i = 0; i < 5; i++) {
      await http.get('/viajes').query({ clienteId: randomUUID() }).set('Authorization', M5).expect(200);
    }
  });

  it('las rutas públicas (health checks) no cuentan', async () => {
    for (let i = 0; i < 5; i++) await http.get('/salud').expect(200);
  });
});
