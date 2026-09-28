// Integracion: exportacion del expediente con verificacion de huellas.
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const u = require('./_util');
const expediente = require('../src/expediente/servicio');
const { leerZip } = require('../src/expediente/zip');

const s = {};
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');

test.before(async () => {
  Object.assign(s, await u.preparar('EXP'));
  await u.documentoVigente(s.repo, s.E, 'POLITICA_SST', 'POL-EXP');
});
test.after(() => u.cerrar(s));

test('zip con indice, verificador, manifiesto y archivos con huella correcta', async () => {
  const r = await expediente.generar(s.repo, s.E);
  const e = leerZip(r.zip);
  const nombres = e.map((x) => x.nombre);
  for (const n of ['index.html', 'verificar.html', 'verificar.js', 'manifiesto.js', 'manifiesto.json']) assert.ok(nombres.includes(n), n);
  assert.ok(e.every((x) => x.crcOk));
  const m = JSON.parse(e.find((x) => x.nombre === 'manifiesto.json').datos.toString());
  const doc = m.documentos.find((d) => d.codigo === 'POL-EXP');
  assert.equal(doc.integridad, 'integro');
  assert.equal(sha(e.find((x) => x.nombre === doc.ruta).datos), doc.sha256_registrado);
  assert.match(e.find((x) => x.nombre === 'index.html').datos.toString(), /POL-EXP/);
  const [aud] = await s.db.query("SELECT COUNT(*) n FROM auditoria_log WHERE tenant_id = ? AND accion = 'exportar' AND entidad = 'expediente'", [s.T.tenantId]);
  assert.equal(aud[0].n, 1);
});

test('http: descarga del zip', async () => {
  const ir = await u.clienteHttp(s);
  let r = await ir('/expediente');
  assert.equal(r.status, 200);
  r = await ir('/expediente', { _csrf: ir.token(r.texto) });
  assert.equal(r.status, 200);
  assert.equal(r.tipo, 'application/zip');
});
