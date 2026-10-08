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
const token = new JwtService({ secret: process.env.JWT_SECRETO }).sign({ sub: id, rol }, { expiresIn: '8h' });

console.log(`Rol: ${rol}\nId:  ${id}\n\nToken (vale 8 horas):\n${token}`);
