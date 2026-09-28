const test = require('node:test');
const assert = require('node:assert/strict');
const r = require('../src/eventos/reglas');
const cat = require('../data/eventos.json');

const AHORA = '2026-09-26T10:00';
const at = (x = {}) => ({ tipo: 'accidente', gravedad: 'leve', persona_id: '5', fecha_ocurrencia: '2026-09-25T15:30', descripcion: 'Se golpeo la mano con la prensa al retirar la pieza', ...x });

test('variantes para el motor de plazos', () => {
  assert.equal(r.variante('incidente', null), 'incidente');
  assert.equal(r.variante('accidente', 'mortal'), 'at_mortal');
  assert.equal(r.variante('enfermedad', null), 'el');
  assert.equal(r.codigoEvento(2026, 7), 'EV-2026-007');
});

test('registro de accidente: fecha base, hora y validaciones', () => {
  const v = r.validarRegistro(at(), AHORA, cat.criterios_grave);
  assert.equal(v.fecha_base, '2026-09-25');
  assert.equal(v.fecha_ocurrencia, '2026-09-25 15:30:00');
  assert.throws(() => r.validarRegistro(at({ fecha_ocurrencia: '2026-09-26T11:00' }), AHORA, cat.criterios_grave), /futura/);
  assert.throws(() => r.validarRegistro(at({ persona_id: '' }), AHORA, cat.criterios_grave), /persona/);
  assert.throws(() => r.validarRegistro(at({ gravedad: '' }), AHORA, cat.criterios_grave), /gravedad/);
  assert.throws(() => r.validarRegistro(at({ descripcion: 'corta' }), AHORA, cat.criterios_grave), /minimo 20/);
});

test('gravedad coherente con los criterios del art. 3 de la Res. 1401', () => {
  assert.throws(() => r.validarRegistro(at({ criterios_grave: ['AMPUTACION'] }), AHORA, cat.criterios_grave), /es grave/);
  assert.throws(() => r.validarRegistro(at({ gravedad: 'grave' }), AHORA, cat.criterios_grave), /Marque la lesion/);
  const g = r.validarRegistro(at({ gravedad: 'grave', criterios_grave: ['AMPUTACION', 'AMPUTACION'] }), AHORA, cat.criterios_grave);
  assert.deepEqual(g.criterios_grave, ['AMPUTACION']);
  assert.throws(() => r.validarRegistro(at({ gravedad: 'grave', criterios_grave: ['INVENTADO'] }), AHORA, cat.criterios_grave), /invalido/);
  assert.equal(r.validarRegistro(at({ gravedad: 'mortal' }), AHORA, cat.criterios_grave).gravedad, 'mortal');
});

test('incidente sin persona; enfermedad laboral con fecha de calificacion como base', () => {
  const inc = r.validarRegistro({ tipo: 'incidente', fecha_ocurrencia: '2026-09-20T08:00', descripcion: 'Caida de material desde estanteria sin lesionados' }, AHORA, cat.criterios_grave);
  assert.equal(inc.persona_id, null);
  assert.equal(inc.gravedad, null);
  const el = r.validarRegistro({ tipo: 'enfermedad', persona_id: '3', fecha_diagnostico: '2026-09-10', descripcion: 'Calificada de origen laboral por la junta regional' }, AHORA, cat.criterios_grave);
  assert.equal(el.fecha_base, '2026-09-10');
  assert.throws(() => r.validarRegistro({ tipo: 'enfermedad', persona_id: '3', descripcion: 'Calificada de origen laboral por la junta regional' }, AHORA, cat.criterios_grave), /calificacion/);
});

test('equipo investigador por gravedad y analisis causal', () => {
  const equipo = [{ rol_codigo: 'jefe_inmediato', estado: 'activo' }, { rol_codigo: 'copasst', estado: 'activo' }, { rol_codigo: 'responsable_sst', estado: 'retirado' }];
  assert.equal(r.rolesFaltantes(cat.roles_investigacion, 'at_leve', equipo).length, 1);
  assert.equal(r.rolesFaltantes(cat.roles_investigacion, 'at_mortal', equipo).length, 2, 'grave o mortal exige profesional con licencia');
  assert.equal(r.analisisFaltante([{ tipo: 'acto_inseguro', estado: 'activo' }]).length, 1);
  assert.deepEqual(r.analisisFaltante([{ tipo: 'condicion_insegura', estado: 'activo' }, { tipo: 'factor_trabajo', estado: 'activo' }]), []);
});

test('reportes faltantes e impedimentos para cerrar', () => {
  assert.deepEqual(r.reportesFaltantes('ARL,EPS,MINTRABAJO', [{ entidad: 'ARL' }]), ['EPS', 'MINTRABAJO']);
  const e = { tipo: 'accidente', gravedad: 'grave', investigacion_cerrada_en: '2026-09-30' };
  assert.deepEqual(r.impedimentosCerrar(e, { faltanReportes: [], informeArl: false }), ['Radique el informe de investigacion ante la ARL']);
  assert.deepEqual(r.impedimentosCerrar({ ...e, gravedad: 'leve' }, { faltanReportes: [], informeArl: false }), []);
});
