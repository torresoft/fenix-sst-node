const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const g = require('../src/db/guardia-sql');

const T = 7;

test('SELECT de tenant con marca: se reemplaza por el id', () => {
  const sql = g.prepararConsultaTenant('SELECT * FROM persona p WHERE p.tenant_id = {tenant} AND p.id = ?', T);
  assert.equal(sql, 'SELECT * FROM persona p WHERE p.tenant_id = 7 AND p.id = ?');
});

test('JOIN de dos tablas de tenant exige dos marcas o join por tenant_id', () => {
  assert.throws(() => g.prepararConsultaTenant(
    'SELECT * FROM vinculacion v JOIN persona p ON p.id = v.persona_id WHERE v.tenant_id = {tenant}', T,
  ), /Faltan filtros de tenant/);
  assert.doesNotThrow(() => g.prepararConsultaTenant(
    'SELECT * FROM vinculacion v JOIN persona p ON p.tenant_id = {tenant} AND p.id = v.persona_id WHERE v.tenant_id = {tenant}', T,
  ));
});

test('sin filtro de tenant se rechaza', () => {
  assert.throws(() => g.prepararConsultaTenant('SELECT * FROM documento_sst', T), /Faltan filtros/);
});

test('tenant_id contra parametro externo o desigualdad se rechaza', () => {
  assert.throws(() => g.prepararConsultaTenant('SELECT * FROM persona WHERE tenant_id = ? AND tenant_id = {tenant}', T));
  assert.throws(() => g.prepararConsultaTenant('SELECT * FROM persona WHERE tenant_id = {tenant} OR tenant_id <> {tenant}', T));
  assert.throws(() => g.prepararConsultaTenant('SELECT * FROM auditoria_log WHERE tenant_id = {tenant} OR tenant_id IS NULL', T));
  assert.throws(() => g.prepararConsultaTenant('SELECT * FROM persona WHERE tenant_id IN (1, 2) AND tenant_id = {tenant}', T));
});

test('evasiones del filtro de tenant se rechazan', () => {
  const malas = [
    'SELECT * FROM evento e, persona p WHERE e.tenant_id = {tenant}',
    'SELECT * FROM evento e STRAIGHT_JOIN persona p WHERE e.tenant_id = {tenant}',
    'SELECT * FROM evento e WHERE e.tenant_id = {tenant} /*! UNION SELECT * FROM persona */',
    "SELECT * FROM evento e WHERE e.nombre = '#' AND e.tenant_id = {tenant} UNION SELECT * FROM persona",
    "SELECT * FROM evento e WHERE e.nombre = '--' AND e.tenant_id = {tenant} UNION SELECT * FROM persona p",
    'SELECT * FROM persona WHERE tenant_id IN ({tenant}, ?)',
    'SELECT {tenant} AS t, p.* FROM persona p',
    'SELECT * FROM evento e JOIN persona p ON p.id = e.persona_id WHERE e.tenant_id = {tenant} AND p.tenant_id = p.tenant_id',
    'SELECT * FROM persona p WHERE ? = p.tenant_id AND p.tenant_id = {tenant}',
    'SELECT SLEEP(5) FROM persona p WHERE p.tenant_id = {tenant}',
  ];
  for (const sql of malas) assert.throws(() => g.prepararConsultaTenant(sql, T), Error, sql);
  assert.doesNotThrow(() => g.prepararConsultaTenant(
    "SELECT e.id FROM evento e JOIN persona p ON p.tenant_id = e.tenant_id AND p.id = e.persona_id WHERE e.tenant_id = {tenant} AND e.nombre = 'a#b'", T,
  ));
});

test('solo lectura y una sentencia', () => {
  assert.throws(() => g.prepararConsultaTenant('DELETE FROM persona WHERE tenant_id = {tenant}', T), /solo admite SELECT/);
  assert.throws(() => g.prepararConsultaTenant('UPDATE persona SET nombres = 1 WHERE tenant_id = {tenant}', T));
  assert.throws(() => g.prepararConsultaTenant('SELECT 1 FROM persona WHERE tenant_id = {tenant}; DROP TABLE persona', T));
});

test('tablas no registradas se rechazan', () => {
  assert.throws(() => g.prepararConsultaTenant('SELECT * FROM tabla_nueva WHERE tenant_id = {tenant}', T), /no registrada/);
});

test('catalogos globales no requieren marca', () => {
  assert.doesNotThrow(() => g.prepararConsultaTenant(
    'SELECT d.*, t.nombre FROM documento_sst d JOIN tipo_documental t ON t.codigo = d.tipo_documental WHERE d.tenant_id = {tenant}', T,
  ));
  assert.throws(() => g.prepararConsultaGlobal('SELECT * FROM persona'), /global/);
});

test('tenant_id invalido', () => {
  for (const malo of [undefined, null, 0, -1, '7', 1.5, NaN]) {
    assert.throws(() => g.prepararConsultaTenant('SELECT * FROM persona WHERE tenant_id = {tenant}', malo), /tenant_id/);
  }
});

test('ningun archivo fuera de src/db importa el pool ni mysql2', () => {
  const raiz = path.join(__dirname, '..', 'src');
  const infractores = [];
  (function recorrer(dir) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { if (p !== path.join(raiz, 'db')) recorrer(p); continue; }
      if (!p.endsWith('.js')) continue;
      const src = fs.readFileSync(p, 'utf8');
      if (/require\(['"](mysql2[^'"]*|[^'"]*db\/pool)['"]\)/.test(src)) infractores.push(path.relative(raiz, p));
    }
  }(raiz));
  assert.deepEqual(infractores, []);
});
