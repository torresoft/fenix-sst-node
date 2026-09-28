const test = require('node:test');
const assert = require('node:assert/strict');
const r = require('../src/planes/reglas');
const { planes } = require('../data/planes.json');

const basico = { ...planes.find((p) => p.codigo === 'BASICO') };
const uso = (x = {}) => ({ empresas: 1, usuarios: 2, clasificaciones: [{ razon_social: 'A', conjunto_codigo: 'MIN_7' }], ...x });

test('sin plan no hay limites ni alertas', () => {
  const e = r.evaluar(null, uso({ empresas: 99 }));
  assert.deepEqual([e.puedeEmpresa, e.puedeUsuario, e.alertas.length], [true, true, 0]);
});

test('limites: bloquea solo altas cuando se llega al tope', () => {
  const e = r.evaluar(basico, uso());
  assert.deepEqual([e.puedeEmpresa, e.puedeUsuario, e.alertas.length], [false, true, 0]);
  assert.equal(r.evaluar(basico, uso({ usuarios: 3 })).puedeUsuario, false);
  assert.equal(r.evaluar({ ...basico, max_usuarios: null }, uso({ usuarios: 300 })).puedeUsuario, true);
});

test('cobertura: una reclasificacion a 21 estandares avisa, no bloquea', () => {
  const e = r.evaluar(basico, uso({ clasificaciones: [{ razon_social: 'Creciente SAS', conjunto_codigo: 'MED_21' }], usuarios: 4 }));
  assert.equal(e.fueraCobertura.length, 1);
  assert.match(e.alertas[0], /Creciente SAS.*MED_21/);
  assert.match(e.alertas[1], /4 usuarios/);
});

test('planes semilla: todos cubren conjuntos validos y el completo cubre FULL_60', () => {
  const conjuntos = new Set(require('../data/estandares_minimos.json').aplicabilidad.map((a) => a.conjunto));
  for (const p of planes) for (const c of p.conjuntos) assert.ok(conjuntos.has(c), `${p.codigo}: ${c}`);
  assert.ok(planes.find((p) => p.codigo === 'COMPLETO').conjuntos.includes('FULL_60'));
});
