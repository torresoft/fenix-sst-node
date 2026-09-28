const test = require('node:test');
const assert = require('node:assert/strict');
const r = require('../src/empresa/reglas');
const { modulos } = require('../data/modulos.json');

test('digito de verificacion del NIT (DIAN)', () => {
  // NIT de la DIAN: 800197268-4
  assert.equal(r.dvNit('800197268'), '4');
  // Ecopetrol: 899999068-1
  assert.equal(r.dvNit('899999068'), '1');
  assert.deepEqual(r.validarNit('800.197.268', ''), { nit: '800197268', dv: '4' });
  assert.throws(() => r.validarNit('800197268', '5'), /deberia ser 4/);
  assert.throws(() => r.validarNit('123', ''), /entre 6 y 15/);
});

test('documentos, correo y DIVIPOLA', () => {
  assert.deepEqual(r.validarDocumento('cc', ' 1088123456 '), { tipo: 'CC', numero: '1088123456' });
  assert.deepEqual(r.validarDocumento('PA', 'ab12345'), { tipo: 'PA', numero: 'AB12345' });
  assert.throws(() => r.validarDocumento('CC', '12A45'), /invalido/);
  assert.throws(() => r.validarDocumento('XX', '123'), /Tipo/);
  assert.equal(r.validarEmail(' Ana@Empresa.CO '), 'ana@empresa.co');
  assert.equal(r.validarEmail(''), null);
  assert.throws(() => r.validarEmail('', { obligatorio: true }), /obligatorio/);
  assert.throws(() => r.validarEmail('ana@empresa'), /invalido/);
  assert.equal(r.validarDivipola('66001'), '66001');
  assert.throws(() => r.validarDivipola('6601'), /5 digitos/);
});

test('modulos activos segun perfil', () => {
  const base = r.modulosActivos(modulos, { contrata_terceros: 0 }, new Set(['general']));
  const por = (lista, c) => lista.find((m) => m.codigo === c);
  assert.equal(por(base, 'M13').activo, true);
  assert.equal(por(base, 'M15').activo, false);
  assert.equal(por(base, 'M16').activo, false);
  const alto = r.modulosActivos(modulos, { contrata_terceros: 1 }, new Set(['general', 'alturas', 'pesv']));
  assert.equal(por(alto, 'M15').activo, true);
  assert.match(por(alto, 'M15').motivo, /alturas/);
  assert.equal(por(alto, 'M16').activo, true);
  assert.equal(por(alto, 'M18').activo, true);
});

test('retiro: no antes del ingreso ni futuro', () => {
  const v = { fecha_ingreso: '2026-01-10' };
  assert.equal(r.validarRetiro(v, '2026-09-26', '2026-09-26'), '2026-09-26');
  assert.throws(() => r.validarRetiro(v, '2025-12-31', '2026-09-26'), /anterior/);
  assert.throws(() => r.validarRetiro(v, '2026-09-27', '2026-09-26'), /futura/);
});
