// Integracion de suscripciones. La gracia se fija antes de cargar la config (cada archivo corre en su proceso).
process.env.SUSCRIPCION_DIAS_GRACIA = '10';
const test = require('node:test');
const assert = require('node:assert/strict');
const u = require('./_util');
const sus = require('../src/plataforma/suscripciones');
const plataforma = require('../src/plataforma/servicio');

const s = {};
const rechaza = (p, re) => u.rechaza(assert, p, re);
const sa = () => ({ id: s.T.usuarioId, nombre: 'Superadmin' });
const HOY = '2026-09-27';

test.before(async () => { Object.assign(s, await u.preparar('SUSC')); });
test.after(() => u.cerrar(s));

test('alta: vigencia calculada, plan sincronizado y validaciones', async () => {
  await rechaza(sus.guardar(s.T.tenantId, { plan_codigo: 'ORO', periodicidad: 'anual', fecha_inicio: '2025-09-01', valor: '1' }, sa(), HOY), /Plan invalido/);
  await rechaza(sus.guardar(s.T.tenantId, { plan_codigo: 'COMPLETO', periodicidad: 'anual', fecha_inicio: '2025-09-01', valor: '0' }, sa(), HOY), /valor pactado/);
  const r = await sus.guardar(s.T.tenantId, { plan_codigo: 'COMPLETO', periodicidad: 'anual', fecha_inicio: '2025-09-01', valor: '1.200.000' }, sa(), HOY);
  assert.equal(r.fin, '2026-08-31');
  const [[t]] = await s.db.query('SELECT plan FROM tenant WHERE id = ?', [s.T.tenantId]);
  assert.equal(t.plan, 'COMPLETO');
  s.s1 = r.id;
});

test('pagos: saldo en DECIMAL, no supera el saldo, no futuros, se anulan sin borrarse', async () => {
  const p1 = await sus.registrarPago(s.T.tenantId, { suscripcion_id: String(s.s1), fecha: '2025-09-05', valor: '700.000', medio: 'transferencia', referencia: 'TR-1' }, sa(), HOY);
  await rechaza(sus.registrarPago(s.T.tenantId, { suscripcion_id: String(s.s1), fecha: '2025-10-05', valor: '600000', medio: 'pse' }, sa(), HOY), /supera el saldo/);
  await rechaza(sus.registrarPago(s.T.tenantId, { suscripcion_id: String(s.s1), fecha: '2026-12-01', valor: '1000', medio: 'pse' }, sa(), HOY), /futura/);
  let d = await sus.detalle(s.T.tenantId, HOY);
  assert.equal(d.actual.saldo, '500000.00');
  await rechaza(sus.anularPago(s.T.tenantId, p1, 'corto', sa()), /motivo|minimo/i);
  await sus.anularPago(s.T.tenantId, p1, 'Transferencia devuelta por el banco', sa());
  d = await sus.detalle(s.T.tenantId, HOY);
  assert.equal(d.actual.saldo, '1200000.00');
  await rechaza(s.db.query('DELETE FROM suscripcion_pago WHERE id = ?', [p1]), /anule/);
  await sus.registrarPago(s.T.tenantId, { suscripcion_id: String(s.s1), fecha: '2025-09-06', valor: '1200000', medio: 'consignacion' }, sa(), HOY);
});

test('job: vence, suspende una sola vez tras la gracia y respeta la reactivacion manual', async () => {
  let r = await sus.procesarVencimientos(HOY, { notificar: false });
  assert.deepEqual([r.vencidas, r.suspendidos], [1, 1]);
  const estado = async () => (await s.db.query('SELECT estado FROM tenant WHERE id = ?', [s.T.tenantId]))[0][0].estado;
  assert.equal(await estado(), 'suspendido');
  await plataforma.cambiarEstadoCliente(s.T.tenantId, 'activo', sa());
  r = await sus.procesarVencimientos(HOY, { notificar: false });
  assert.deepEqual([r.vencidas, r.suspendidos], [0, 0]);
  assert.equal(await estado(), 'activo');
  const res = await sus.resumenCliente(s.T.tenantId, HOY);
  assert.equal(res.situacion.nivel, 'vencida');
});

test('renovacion: arranca hoy si ya vencio, cierra la anterior y la cancelada no se reescribe', async () => {
  const d = await sus.detalle(s.T.tenantId, HOY);
  assert.equal(d.sugerida.fecha_inicio, HOY);
  const r = await sus.guardar(s.T.tenantId, { ...d.sugerida, valor: '1.300.000', periodicidad: 'semestral' }, sa(), HOY);
  assert.equal(r.fin, '2027-03-26');
  const [[vieja]] = await s.db.query('SELECT estado FROM suscripcion WHERE id = ?', [s.s1]);
  assert.equal(vieja.estado, 'renovada');
  await rechaza(s.db.query("UPDATE suscripcion SET valor = 1 WHERE id = ?", [s.s1]), /cerrada/);
  await rechaza(sus.cancelar(s.T.tenantId, r.id, 'no', sa()), /motivo/);
  await sus.cancelar(s.T.tenantId, r.id, 'El cliente no continuara el proximo periodo', sa());
  const t = await sus.tablero(HOY);
  const fila = t.filas.find((f) => f.tenant_id === s.T.tenantId);
  assert.equal(fila.situacion.nivel, 'cancelada');
  assert.equal(fila.saldo, '1300000.00');
  assert.ok(Number(t.cifras.cartera) >= 1300000);
});

test('http: tablero y ficha de suscripciones', async () => {
  await s.db.query('UPDATE usuario SET es_superadmin = 1 WHERE id = ?', [s.T.usuarioId]);
  const ir = await u.clienteHttp(s);
  let r = await ir('/plataforma/suscripciones');
  assert.equal(r.status, 200);
  assert.match(r.texto, /Tenant SUSC/);
  assert.match(r.texto, /\$1\.300\.000/);
  r = await ir(`/plataforma/clientes/${s.T.tenantId}`);
  assert.equal(r.status, 200);
  assert.match(r.texto, /Historial/);
  assert.match(r.texto, /Transferencia devuelta/);
});
