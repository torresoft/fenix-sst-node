const test = require('node:test');
const assert = require('node:assert/strict');
const r = require('../src/plataforma/catalogo-reglas');

const col = (COLUMN_NAME, COLUMN_TYPE, extra = {}) => ({
  COLUMN_NAME, COLUMN_TYPE, DATA_TYPE: COLUMN_TYPE.replace(/\(.*/, ''), IS_NULLABLE: 'NO', CHARACTER_MAXIMUM_LENGTH: (/varchar\((\d+)\)/.exec(COLUMN_TYPE) || [])[1] || null,
  COLUMN_KEY: '', COLUMN_DEFAULT: null, EXTRA: '', ...extra,
});
const cols = [
  col('codigo', 'varchar(20)', { COLUMN_KEY: 'PRI' }),
  col('nombre', 'varchar(100)'),
  col('tipo', "enum('habil','calendario')"),
  col('cantidad', 'smallint(5) unsigned'),
  col('requiere', 'tinyint(1)', { COLUMN_DEFAULT: '0' }),
  col('controles', 'longtext'),
  col('nota', 'varchar(500)', { IS_NULLABLE: 'YES' }),
  col('estado', "enum('activo','inactivo')"),
  col('modificado_manual', 'tinyint(1)'),
];

test('campos: tipos por columna y sin columnas de sistema', () => {
  const c = r.campos(cols);
  assert.deepEqual(c.map((x) => [x.nombre, x.tipo]), [['codigo', 'texto'], ['nombre', 'texto'], ['tipo', 'enum'], ['cantidad', 'entero'], ['requiere', 'bool'], ['controles', 'json'], ['nota', 'largo']]);
  assert.deepEqual(c[2].opciones, ['habil', 'calendario']);
});

test('normalizar: coerciona, valida y respeta la clave al editar', () => {
  const c = r.campos(cols);
  const base = { codigo: 'X', nombre: 'Uno', tipo: 'habil', cantidad: '5', controles: '[ {"a":1} ]', nota: '' };
  assert.deepEqual(r.normalizar(c, base, { nuevo: true }), { codigo: 'X', nombre: 'Uno', tipo: 'habil', cantidad: 5, requiere: 0, controles: '[{"a":1}]', nota: null });
  assert.equal(r.normalizar(c, { ...base, requiere: '1' }, { nuevo: false }).codigo, undefined);
  assert.throws(() => r.normalizar(c, { ...base, tipo: 'mes' }, { nuevo: true }), /no permitido/);
  assert.throws(() => r.normalizar(c, { ...base, cantidad: '2.5' }, { nuevo: true }), /entero/);
  assert.throws(() => r.normalizar(c, { ...base, controles: '{mal' }, { nuevo: true }), /JSON/);
  assert.throws(() => r.normalizar(c, { ...base, nombre: '' }, { nuevo: true }), /obligatorio/);
});

test('diferencias: solo lo que cambio', () => {
  assert.deepEqual(r.diferencias({ nombre: 'A', cantidad: 5 }, { nombre: 'B', cantidad: 5 }), { antes: { nombre: 'A' }, despues: { nombre: 'B' } });
});
