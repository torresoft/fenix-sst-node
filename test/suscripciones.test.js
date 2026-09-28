const test = require('node:test');
const assert = require('node:assert/strict');
const r = require('../src/plataforma/suscripcion-reglas');
const { pesos } = require('../src/comun/html');

test('vigencia: un periodo completo, fin de mes y renovacion continua', () => {
  assert.equal(r.calcularFin('2026-01-15', 'mensual'), '2026-02-14');
  assert.equal(r.calcularFin('2026-01-31', 'mensual'), '2026-02-27');
  assert.equal(r.calcularFin('2026-10-01', 'anual'), '2027-09-30');
  assert.equal(r.calcularFin('2026-01-01', 'trimestral'), '2026-03-31');
  assert.throws(() => r.calcularFin('2026-01-01', 'bienal'), /Periodicidad/);
  assert.equal(r.inicioRenovacion({ fecha_fin: '2026-10-10' }, '2026-09-27'), '2026-10-11');
  assert.equal(r.inicioRenovacion({ fecha_fin: '2026-09-01' }, '2026-09-27'), '2026-09-27', 'si ya vencio arranca hoy');
});

test('dinero: formato colombiano a DECIMAL en texto, sin Number', () => {
  assert.equal(r.valorDinero('1.200.000'), '1200000');
  assert.equal(r.valorDinero('1.200.000,50'), '1200000.50');
  assert.equal(r.valorDinero('350000.00'), '350000.00');
  assert.throws(() => r.valorDinero('abc'), /Valor invalido/);
  assert.throws(() => r.valorDinero('0', { positivo: true }), /mayor que cero/);
  assert.equal(pesos('1200000.50'), '$1.200.000,50');
  assert.equal(pesos('150000.00'), '$150.000');
});

test('situacion y decisiones del job: vencer, avisar y suspender una sola vez tras la gracia', () => {
  const hoy = '2026-09-27';
  assert.equal(r.situacion({ estado: 'vigente', fecha_fin: '2026-10-10' }, hoy).nivel, 'por_vencer');
  assert.equal(r.situacion({ estado: 'vigente', fecha_fin: '2027-01-10' }, hoy).nivel, 'al_dia');
  assert.equal(r.situacion({ estado: 'vigente', fecha_fin: '2026-09-20' }, hoy).nivel, 'vencida');
  assert.equal(r.situacion(null, hoy).nivel, 'sin');

  const subs = [
    { id: 1, estado: 'vigente', fecha_fin: '2026-09-26', tenant_estado: 'activo' },
    { id: 2, estado: 'vigente', fecha_fin: '2026-10-12', tenant_estado: 'activo' },
    { id: 3, estado: 'vencida', fecha_fin: '2026-09-10', tenant_estado: 'activo' },
    { id: 4, estado: 'vencida', fecha_fin: '2026-09-10', tenant_estado: 'activo', suspendido_en: '2026-09-21' },
    { id: 5, estado: 'cancelada', fecha_fin: '2026-09-01', tenant_estado: 'activo' },
  ];
  const sin = r.decisionesJob(subs, hoy, { diasGracia: null, avisos: [15] });
  assert.deepEqual(sin.vencer.map((s) => s.id), [1]);
  assert.deepEqual(sin.avisar.map((a) => [a.s.id, a.dias]), [[2, 15]]);
  assert.equal(sin.suspender.length, 0, 'sin gracia configurada nunca suspende');
  const con = r.decisionesJob(subs, hoy, { diasGracia: 10, avisos: [] });
  assert.deepEqual(con.suspender.map((s) => s.id), [3], 'no repite la 4 (ya suspendida) ni toca la cancelada');
});
