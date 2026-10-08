// Valida un documento AsyncAPI e imprime los errores y advertencias.
// Uso: node scripts/validar-asyncapi.js <ruta-al-yaml>
const fs = require('node:fs');
const path = require('node:path');
const { Parser, fromFile } = require('@asyncapi/parser');

async function main() {
  const archivo = process.argv[2];
  if (!archivo || !fs.existsSync(archivo)) {
    console.error('Uso: node scripts/validar-asyncapi.js <ruta-al-yaml>');
    process.exit(2);
  }

  const { document, diagnostics } = await fromFile(new Parser(), path.resolve(archivo)).parse();

  // severity: 0 = error, 1 = warning, 2 = info, 3 = hint
  const errores = diagnostics.filter((d) => d.severity === 0);
  const advertencias = diagnostics.filter((d) => d.severity === 1);
  for (const d of [...errores, ...advertencias]) {
    const tipo = d.severity === 0 ? 'ERROR' : 'WARN ';
    console.log(`${tipo} ${d.path.join('.') || '(raíz)'}: ${d.message}`);
  }

  if (!document || errores.length > 0) {
    console.error(`\n${archivo}: inválido (${errores.length} errores).`);
    process.exit(1);
  }
  console.log(`\n${archivo}: válido (${advertencias.length} advertencias).`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
