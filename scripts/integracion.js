// Prueba de integracion contra MariaDB real: crea <DB_NAME>_it, ejecuta sql/*.sql, carga
// catalogos, corre test-integracion/ y borra la BD (los datos append-only no se pueden limpiar).
// Uso: node scripts/integracion.js [--conservar]
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const os = require('os');
const mysql = require('mysql2/promise');

const RAIZ = path.join(__dirname, '..');
const BD = `${process.env.DB_NAME}_it`;
const ALMACEN = path.join(os.tmpdir(), 'fenix_sst_it_almacen');

// Archivos puntuales: node scripts/integracion.js test-integracion/convivencia.test.js
const archivos = process.argv.slice(2).filter((a) => !a.startsWith('--'));

// Divide un script respetando DELIMITER (triggers).
function sentencias(sql) {
  const salida = [];
  let delim = ';';
  let actual = '';
  for (const linea of sql.split(/\r?\n/)) {
    const m = /^\s*DELIMITER\s+(\S+)\s*$/i.exec(linea);
    if (m) { delim = m[1]; continue; }
    actual += `${linea}\n`;
    if (actual.trimEnd().endsWith(delim)) {
      const s = actual.trimEnd().slice(0, -delim.length).trim();
      if (s && !/^(--[^\n]*\n?\s*)+$/.test(`${s}\n`)) salida.push(s);
      actual = '';
    }
  }
  if (actual.trim() && !/^(\s*--[^\n]*\n?)+$/.test(actual)) salida.push(actual.trim());
  return salida;
}

function correr(cmd, args) {
  const r = spawnSync(cmd, args, { cwd: RAIZ, stdio: 'inherit', env: { ...process.env, DB_NAME: BD, ALMACEN_DIR: ALMACEN } });
  return r.status === 0;
}

(async () => {
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST, port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER, password: process.env.DB_PASSWORD, charset: 'utf8mb4_unicode_ci',
  });
  let ok = false;
  try {
    await conn.query(`DROP DATABASE IF EXISTS \`${BD}\``);
    await conn.query(`CREATE DATABASE \`${BD}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
    await conn.query(`USE \`${BD}\``);
    for (const f of fs.readdirSync(path.join(RAIZ, 'sql')).filter((x) => /^\d+_.*\.sql$/.test(x)).sort()) {
      for (const s of sentencias(fs.readFileSync(path.join(RAIZ, 'sql', f), 'utf8'))) await conn.query(s);
      console.info(`sql ${f} ok`);
    }
    ok = correr(process.execPath, ['scripts/cargar-catalogos.js'])
      && correr(process.execPath, ['--test', '--test-concurrency=1', '--test-timeout=120000', ...(archivos.length ? archivos : ['test-integracion/'])]);
  } finally {
    if (!process.argv.includes('--conservar')) {
      await conn.query(`DROP DATABASE IF EXISTS \`${BD}\``);
      fs.rmSync(ALMACEN, { recursive: true, force: true });
    }
    await conn.end();
  }
  process.exitCode = ok ? 0 : 1;
})().catch((err) => {
  console.error(`integracion: ${err.message}`);
  process.exit(1);
});
