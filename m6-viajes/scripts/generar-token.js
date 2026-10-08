// Genera un JWT de desarrollo firmado con JWT_SECRETO, mientras M1 no emite los tokens reales.
// Uso: npm run token -- <ROL> [id]
//   npm run token -- CLIENTE
//   npm run token -- CONDUCTOR <conductorId>
//   npm run token -- SERVICIO m5-despacho
const { randomUUID } = require('node:crypto');
const fs = require('node:fs');
const { JwtService } = require('@nestjs/jwt');

const ROLES = ['CLIENTE', 'CONDUCTOR', 'OPERADOR', 'SERVICIO'];
const [rol, idRecibido] = process.argv.slice(2);

if (!ROLES.includes(rol)) {
  console.error(`Uso: npm run token -- <${ROLES.join('|')}> [id]`);
  process.exit(2);
}
if (fs.existsSync('.env')) {
  process.loadEnvFile('.env');
}
if (!process.env.JWT_SECRETO) {
  console.error('Falta JWT_SECRETO. Copiá .env.example a .env.');
  process.exit(2);
}

const id = idRecibido ?? (rol === 'SERVICIO' ? 'm5-despacho' : randomUUID());
// Si se configuran JWT_EMISOR y JWT_AUDIENCIA, el token los incluye (el servicio los exige).
const opciones = {
  expiresIn: '8h',
  ...(process.env.JWT_EMISOR && { issuer: process.env.JWT_EMISOR }),
  ...(process.env.JWT_AUDIENCIA && { audience: process.env.JWT_AUDIENCIA }),
};
const token = new JwtService({ secret: process.env.JWT_SECRETO }).sign({ sub: id, rol }, opciones);

console.log(`Rol: ${rol}\nId:  ${id}\n\nToken (vale 8 horas):\n${token}`);
