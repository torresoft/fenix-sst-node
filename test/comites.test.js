const test = require('node:test');
const assert = require('node:assert/strict');
const r = require('../src/comites/reglas');
const { tipos } = require('../data/comites.json');

const tipo = (c) => tipos.find((t) => t.codigo === c);
const m = (representacion, calidad, cargo = 'miembro') => ({ representacion, calidad, cargo_comite: cargo, estado: 'activo' });

test('aplicabilidad: vigia bajo 10 trabajadores, COPASST desde 10; convivencia siempre', () => {
  assert.deepEqual(r.tiposAplicables(tipos, 8).map((t) => t.codigo).sort(), ['convivencia', 'vigia']);
  assert.deepEqual(r.tiposAplicables(tipos, 10).map((t) => t.codigo).sort(), ['convivencia', 'copasst']);
});

test('conformacion del COPASST por tamano (Res. 2013 art. 2)', () => {
  assert.equal(r.conformacionRequerida(tipo('copasst'), 30).por_parte, 1);
  assert.equal(r.conformacionRequerida(tipo('copasst'), 120).por_parte, 2);
  assert.equal(r.conformacionRequerida(tipo('copasst'), 700).por_parte, 3);
  assert.equal(r.conformacionRequerida(tipo('copasst'), 5000).por_parte, 4);
  const completo = [m('empleador', 'principal', 'presidente'), m('empleador', 'suplente'), m('trabajadores', 'principal', 'secretario'), m('trabajadores', 'suplente')];
  assert.deepEqual(r.validarConformacion(tipo('copasst'), 30, completo).faltas, []);
  const faltas = r.validarConformacion(tipo('copasst'), 120, completo).faltas;
  assert.ok(faltas.some((f) => /principal.*empleador/.test(f)) && faltas.length === 4);
  assert.ok(r.validarConformacion(tipo('copasst'), 30, [m('empleador', 'principal')]).faltas.includes('Elija el secretario'));
});

test('vigia: un principal; convivencia sin regla cargada avisa en vez de validar', () => {
  assert.deepEqual(r.validarConformacion(tipo('vigia'), 6, [m('trabajadores', 'principal')]).faltas, []);
  assert.deepEqual(r.validarConformacion(tipo('vigia'), 6, []).faltas, ['Designe 1 principal(es)']);
  const c = r.validarConformacion(tipo('convivencia'), 30, []);
  assert.deepEqual(c.faltas, []);
  assert.match(c.aviso, /no cargada.*RES-3461-2025/);
});

test('quorum de mitad mas uno; sin regla no se afirma nada', () => {
  assert.equal(r.hayQuorum('mitad_mas_uno', 4, 3), true);
  assert.equal(r.hayQuorum('mitad_mas_uno', 4, 2), false);
  assert.equal(r.hayQuorum('mitad_mas_uno', 2, 2), true);
  assert.equal(r.hayQuorum(null, 4, 1), null);
});

test('periodo de 2 anios y meses sin reunion', () => {
  assert.equal(r.periodoFin('2026-03-01'), '2028-02-29');
  assert.equal(r.periodoFin('2025-01-15'), '2027-01-14');
  const sesiones = [{ fecha: '2026-06-10', estado: 'realizada' }, { fecha: '2026-08-05', estado: 'con_acta' }, { fecha: '2026-07-01', estado: 'anulada' }];
  assert.deepEqual(r.mesesSinReunion(sesiones, '2026-05-15', '2026-09-26'), ['2026-05', '2026-07']);
  assert.equal(r.mesesSinReunion([], '2020-01-01', '2026-09-26').length, 12, 'maximo 12 meses atras');
});
