const test = require('node:test');
const assert = require('node:assert/strict');
const { evaluar } = require('../src/permisos/servicio');
const { calificar, claseCorrecta } = require('../src/contratistas/servicio');
const { estadoRequisito } = require('../src/epp/servicio');
const { estadoVencimiento } = require('../src/emergencias/servicio');

const alturas = { competencia_codigo: 'ALTURAS', competencia: 'Trabajo en alturas' };
const apto = { concepto: 'apto', fecha_examen: '2026-02-01', proximo_examen: '2027-02-01' };
const induccion = { fecha_obtencion: '2025-01-10' };

test('permiso: verificacion de certificacion, aptitud e induccion', () => {
  const ok = evaluar({ tipoPermiso: alturas, competencia: { fecha_obtencion: '2026-01-01', fecha_vence: null }, concepto: apto, induccion }, '2026-09-28');
  assert.equal(ok.ok, true);
  const sinCert = evaluar({ tipoPermiso: alturas, competencia: null, concepto: apto, induccion }, '2026-09-28');
  assert.equal(sinCert.ok, false);
  assert.match(sinCert.certificacion.detalle, /Sin Trabajo en alturas vigente/);
  const vencida = evaluar({ tipoPermiso: alturas, competencia: { fecha_obtencion: '2023-01-01', fecha_vence: '2026-09-01' }, concepto: apto, induccion }, '2026-09-28');
  assert.match(vencida.certificacion.detalle, /vencida/);
  const noApto = evaluar({ tipoPermiso: alturas, competencia: { fecha_obtencion: '2026-01-01' }, concepto: { ...apto, concepto: 'no_apto' }, induccion }, '2026-09-28');
  assert.equal(noApto.aptitud.ok, false);
  const examenVencido = evaluar({ tipoPermiso: alturas, competencia: { fecha_obtencion: '2026-01-01' }, concepto: { ...apto, proximo_examen: '2026-09-01' }, induccion }, '2026-09-28');
  assert.match(examenVencido.aptitud.detalle, /periodico vencido/);
  const restr = evaluar({ tipoPermiso: { competencia_codigo: null }, concepto: { ...apto, concepto: 'apto_con_restricciones', restricciones: 'No levantar 12 kg' }, induccion }, '2026-09-28');
  assert.equal(restr.ok, true);
  assert.match(restr.advertencias[0], /12 kg/);
  assert.equal(evaluar({ tipoPermiso: { competencia_codigo: null }, concepto: apto, induccion: null }, '2026-09-28').ok, false);
});

test('contratista: puntaje decimal, umbrales y clase de riesgo', () => {
  assert.deepEqual(calificar(9, 9), { puntaje: '100.00', resultado: 'aprobado' });
  assert.deepEqual(calificar(6, 9), { puntaje: '66.67', resultado: 'condicionado' });
  assert.deepEqual(calificar(5, 9), { puntaje: '55.56', resultado: 'rechazado' });
  assert.equal(claseCorrecta('IV', 'IV'), true);
  assert.equal(claseCorrecta('V', 'IV'), true);
  assert.equal(claseCorrecta('I', 'IV'), false);
});

test('epp y equipos: estados de reposicion y vencimiento', () => {
  assert.equal(estadoRequisito(null, '2026-09-28'), 'sin_entrega');
  assert.equal(estadoRequisito({ estado: 'pendiente_firma' }, '2026-09-28'), 'pendiente_firma');
  assert.equal(estadoRequisito({ estado: 'entregada', fecha_reposicion: '2026-09-28' }, '2026-09-28'), 'reponer');
  assert.equal(estadoRequisito({ estado: 'entregada', fecha_reposicion: '2026-10-10' }, '2026-09-28'), 'por_reponer');
  assert.equal(estadoRequisito({ estado: 'entregada', fecha_reposicion: null }, '2026-09-28'), 'al_dia');
  assert.equal(estadoVencimiento('2026-09-27', '2026-09-28'), 'vencido');
  assert.equal(estadoVencimiento('2026-10-20', '2026-09-28'), 'por_vencer');
  assert.equal(estadoVencimiento('2027-01-01', '2026-09-28'), 'vigente');
});
