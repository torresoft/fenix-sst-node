const test = require('node:test');
const assert = require('node:assert/strict');
const r = require('../src/convivencia/reglas');
const { estado } = require('../src/consentimientos/servicio');

const base = { canal: 'fisico', tipo_conducta: 'acoso_laboral', quejoso_nombre: 'Ana', implicados: 'Jefe de bodega', hechos: 'Gritos y humillaciones reiteradas frente al equipo' };

test('queja: validaciones y proteccion desde la radicacion', () => {
  const q = r.validarQueja({ ...base, fecha_radicacion: '2026-09-21', solicita_proteccion: '1' }, '2026-09-26');
  assert.equal(q.fecha_solicitud_proteccion, '2026-09-21');
  assert.throws(() => r.validarQueja({ ...base, hechos: 'corto' }, '2026-09-26'), /hechos/);
  assert.throws(() => r.validarQueja({ ...base, quejoso_nombre: '' }, '2026-09-26'), /quien/);
  assert.throws(() => r.validarQueja({ ...base, fecha_radicacion: '2026-10-01' }, '2026-09-26'), /futura/);
  assert.equal(r.radicado('2026', 7), 'QC-2026-0007');
});

test('psicosocial: grupos minimos, suma y periodicidad', () => {
  const g = (grupo, evaluados) => ({ grupo, evaluados, intralaboral: 'medio', extralaboral: 'bajo', estres: 'alto' });
  assert.doesNotThrow(() => r.validarGrupos([g('Bodega', 6), g('Oficina', 5)], 11, 5));
  assert.throws(() => r.validarGrupos([g('Bodega', 6), g('Gerencia', 2)], 8, 5), /menos de 5/);
  assert.throws(() => r.validarGrupos([g('Bodega', 6)], 9, 5), /suman 6/);
  assert.throws(() => r.validarGrupos([g('Bodega', 6), g('bodega', 6)], 12, 5), /repetido/);
  assert.equal(r.vencimientoPsicosocial('muy_alto'), 'PSICOSOCIAL_ALTO');
  assert.equal(r.vencimientoPsicosocial('medio'), 'PSICOSOCIAL_MEDIO');
});

test('consentimiento: estado segun ultimo registro y version', () => {
  const f = { version: '2.0' };
  assert.equal(estado(null, f), 'sin_registro');
  assert.equal(estado({ estado: 'vigente', otorgado: 1, politica_version: '2.0' }, f), 'vigente');
  assert.equal(estado({ estado: 'vigente', otorgado: 1, politica_version: '1.0' }, f), 'desactualizado');
  assert.equal(estado({ estado: 'vigente', otorgado: 0, politica_version: '2.0' }, f), 'negado');
  assert.equal(estado({ estado: 'revocado', otorgado: 1, politica_version: '2.0' }, f), 'revocado');
});
