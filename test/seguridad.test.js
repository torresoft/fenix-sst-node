const test = require('node:test');
const assert = require('node:assert/strict');
const csv = require('../src/integraciones/csv');
const { sinDatosClinicos } = require('../src/salud/reglas');

test('csv: limites de filas y columnas antes de construir objetos', () => {
  assert.deepEqual(csv.parsear('a;b\n1;"x;y"\n\n2;3\n'), [{ _fila: 2, a: '1', b: 'x;y' }, { _fila: 3, a: '2', b: '3' }]);
  assert.throws(() => csv.parsear(`${';'.repeat(150)}\n1`), (e) => e.status === 422 && /columnas/.test(e.message));
  assert.throws(() => csv.parsear(`a\n${'1\n'.repeat(6)}`, 5), (e) => e.status === 422 && /filas/.test(e.message));
  assert.equal(csv.parsear(`a\n${'1\n'.repeat(5)}`, 5).length, 5);
});

test('csv: celdas exportadas neutralizan formulas', () => {
  assert.equal(csv.celda('=HYPERLINK("http://x")'), '"\'=HYPERLINK(""http://x"")"');
  assert.equal(csv.celda('+1'), "'+1");
  assert.equal(csv.celda('@SUM(A1)'), "'@SUM(A1)");
  assert.equal(csv.celda('texto normal'), 'texto normal');
});

test('regla dura 1: textos con diagnostico se rechazan', () => {
  assert.throws(() => sinDatosClinicos('Dx: lumbalgia mecanica', 'X'), /diagnostic/);
  assert.throws(() => sinDatosClinicos('Codigo M54.5', 'X'), /CIE-10/);
  assert.equal(sinDatosClinicos('No levantar mas de 12 kg', 'X'), 'No levantar mas de 12 kg');
});
