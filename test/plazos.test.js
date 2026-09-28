const test = require('node:test');
const assert = require('node:assert/strict');
const { desdeJson } = require('../src/fechas');
const r = require('../src/plazos/reglas');
const catalogo = require('../data/plazos_legales.json');

const cal = desdeJson();
const plazos = catalogo.plazos_por_evento.map((p) => ({ ...p, correr_si_inhabil: p.correr_si_inhabil ? 1 : 0 }));
const venc = Object.fromEntries(catalogo.vencimientos_recurrentes.map((v) => [v.codigo, v]));
const porCodigo = (lista) => Object.fromEntries(lista.map((o) => [o.plazo_codigo, o]));

const at = (fecha, variante) => ({
  evento: 'evento.creado', variante, fecha, empresaId: 1, entidadTipo: 'evento', entidadId: 99,
});

test('AT mortal el viernes festivo 7-ago-2026: reporte a la ARL en 2 dias habiles cae el martes 11', () => {
  const o = porCodigo(r.obligacionesDeEvento(plazos, at('2026-08-07', 'at_mortal'), cal));
  assert.deepEqual(Object.keys(o).sort(), ['COPASST_EXTRA', 'INV_AT', 'INV_AT_ARL', 'MATRIZ_AT_MORTAL', 'REP_AT_ARL']);
  assert.equal(o.MATRIZ_AT_MORTAL.fecha_limite, '2026-09-06');
  assert.equal(o.REP_AT_ARL.fecha_limite, '2026-08-11');
  assert.equal(o.REP_AT_ARL.severidad, 'critica');
  assert.equal(o.INV_AT.fecha_limite, '2026-08-22');
  assert.equal(o.INV_AT_ARL.fecha_limite, '2026-08-22');
  assert.equal(o.COPASST_EXTRA.fecha_limite, '2026-08-12');
});

test('AT el Viernes Santo 3-abr-2026: reporte vence el martes 7 (salta viernes, fin de semana)', () => {
  const o = porCodigo(r.obligacionesDeEvento(plazos, at('2026-04-03', 'at_leve'), cal));
  assert.equal(o.REP_AT_ARL.fecha_limite, '2026-04-07');
});

test('AT leve solo genera reporte e investigacion, no los plazos de grave o mortal', () => {
  const o = porCodigo(r.obligacionesDeEvento(plazos, at('2026-09-25', 'at_leve'), cal));
  assert.deepEqual(Object.keys(o).sort(), ['INV_AT', 'REP_AT_ARL']);
});

test('coincidencia de disparadores con variante', () => {
  assert.equal(r.coincideDisparador('evento.creado', 'evento.creado', null), true);
  assert.equal(r.coincideDisparador('evento.creado[grave|mortal]', 'evento.creado', 'grave'), true);
  assert.equal(r.coincideDisparador('evento.creado[grave|mortal]', 'evento.creado', null), false);
  assert.equal(r.coincideDisparador('solicitud_habeas_data[consulta]', 'solicitud_habeas_data', 'reclamo'), false);
  assert.equal(r.coincideDisparador('evento.creado', 'evento.creadoX', null), false);
});

test('restricciones medicas: 20 dias habiles saltando festivos', () => {
  const ev = { evento: 'concepto_aptitud.con_restricciones', fecha: '2026-08-07', empresaId: 1, entidadTipo: 'concepto_aptitud', entidadId: 5 };
  const [o] = r.obligacionesDeEvento(plazos, ev, cal);
  assert.equal(o.plazo_codigo, 'ADAPTA_RESTRICCION');
  assert.equal(o.fecha_limite, '2026-09-07');
});

test('evento incompleto se rechaza', () => {
  assert.throws(() => r.obligacionesDeEvento(plazos, { evento: 'evento.creado', fecha: '2026-01-02' }, cal), /incompleto/);
});

test('vencimientos recurrentes por anio y por fecha fija', () => {
  assert.equal(r.fechaVencimiento(venc.PERIODO_COPASST, '2026-03-15', cal), '2028-03-15');
  assert.equal(r.fechaVencimiento(venc.LICENCIA_SST, '2028-02-29', cal), '2038-02-28');
  assert.equal(r.fechaVencimiento(venc.RNBD, '2026-05-10', cal), '2027-03-31');
  assert.equal(r.fechaVencimiento(venc.RNBD, '2027-01-15', cal), '2027-03-31');
  const o = r.obligacionDeVigencia(venc.RNBD, { empresaId: 1, entidadTipo: 'empresa', entidadId: 1, fechaInicio: '2026-03-31' }, cal);
  assert.equal(o.tipo_plazo, 'fecha_fija');
  assert.equal(o.fecha_limite, '2027-03-31');
});

test('estados: en termino, por vencer segun alerta del catalogo, vencido, cumplido', () => {
  const o = { fecha_limite: '2026-10-30', dias_alerta_previa: 5, estado: 'en_termino', fecha_cumplimiento: null };
  assert.equal(r.estadoObligacion(o, '2026-10-01', cal), 'en_termino');
  assert.equal(r.estadoObligacion(o, '2026-10-25', cal), 'por_vencer');
  assert.equal(r.estadoObligacion(o, '2026-10-31', cal), 'vencido');
  assert.equal(r.estadoObligacion({ ...o, fecha_cumplimiento: '2026-10-20' }, '2026-11-15', cal), 'cumplido');
  assert.equal(r.estadoObligacion({ ...o, estado: 'anulado' }, '2026-11-15', cal), 'anulado');
});

test('dias restantes habiles para plazos habiles', () => {
  const o = { fecha_limite: '2026-08-11', tipo_plazo: 'habil' };
  assert.deepEqual(r.diasRestantes(o, '2026-08-07', cal), { dias: 2, habiles: true });
  assert.deepEqual(r.diasRestantes({ ...o, tipo_plazo: 'calendario' }, '2026-08-07', cal), { dias: 4, habiles: false });
});

test('orden de urgencia: vencidas primero, luego severidad y fecha', () => {
  const l = [
    { estado: 'en_termino', severidad: 'critica', fecha_limite: '2026-01-01' },
    { estado: 'vencido', severidad: 'media', fecha_limite: '2026-01-05' },
    { estado: 'por_vencer', severidad: 'media', fecha_limite: '2026-01-02' },
    { estado: 'por_vencer', severidad: 'critica', fecha_limite: '2026-01-03' },
  ].sort(r.compararUrgencia);
  assert.deepEqual(l.map((x) => `${x.estado}/${x.severidad}`), ['vencido/media', 'por_vencer/critica', 'por_vencer/media', 'en_termino/critica']);
});

test('alerta en habiles: reporte AT de viernes (vence martes) nace por vencer', () => {
  const o = { fecha_limite: '2026-08-11', dias_alerta_previa: 2, estado: 'en_termino', fecha_cumplimiento: null, tipo_plazo: 'habil' };
  assert.equal(r.estadoObligacion(o, '2026-08-07', cal), 'por_vencer');
  assert.equal(r.estadoObligacion({ ...o, tipo_plazo: 'calendario' }, '2026-08-07', cal), 'en_termino');
  const largo = { ...o, fecha_limite: '2026-09-07', dias_alerta_previa: 5 };
  assert.equal(r.estadoObligacion(largo, '2026-08-07', cal), 'en_termino');
  assert.equal(r.estadoObligacion(largo, '2026-08-31', cal), 'por_vencer');
});

test('un incidente se investiga pero no genera reporte FURAT; la EL si se reporta', () => {
  const inc = porCodigo(r.obligacionesDeEvento(plazos, at('2026-09-25', 'incidente'), cal));
  assert.deepEqual(Object.keys(inc), ['INV_AT']);
  const el = porCodigo(r.obligacionesDeEvento(plazos, at('2026-09-25', 'el'), cal));
  assert.deepEqual(Object.keys(el), ['REP_AT_ARL']);
});
