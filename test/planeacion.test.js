const test = require('node:test');
const assert = require('node:assert/strict');
const r = require('../src/planeacion/reglas');

const HOY = '2026-06-30';
const act = (fecha_fin, estado, presupuesto = '0') => ({ fecha_fin, estado, presupuesto, responsable_texto: 'X' });

test('avance al corte y total; canceladas no cuentan; presupuesto sin flotantes', () => {
  const a = r.avance([
    act('2026-03-31', 'ejecutada', '1500000.10'), act('2026-05-31', 'programada', '200000.20'),
    act('2026-06-30', 'ejecutada', '0.30'), act('2026-11-30', 'programada', '1000000'), act('2026-04-30', 'cancelada', '999'),
  ], HOY);
  assert.deepEqual([a.total, a.ejecutadas, a.vencidas, a.programadas_al_corte, a.ejecutadas_al_corte], [4, 2, 1, 3, 2]);
  assert.equal(a.cumplimiento_corte, 66.67);
  assert.equal(a.avance_total, 50);
  assert.equal(a.presupuesto_programado, '2700000.60');
  assert.equal(a.presupuesto_ejecutado, '1500000.40');
  assert.equal(r.avance([], HOY).cumplimiento_corte, null);
});

test('impedimentos para aprobar el plan', () => {
  const plan = { estado: 'borrador', presupuesto_total: '1000.00' };
  const ok = r.impedimentosAprobar(plan, [{ estado: 'activo' }], [act('2026-05-01', 'programada', '500')], { id: 1 }, '500');
  assert.deepEqual(ok, []);
  const mal = r.impedimentosAprobar(plan, [], [{ ...act('2026-05-01', 'programada'), responsable_texto: null }], null, '1000.01');
  assert.equal(mal.length, 4);
});
