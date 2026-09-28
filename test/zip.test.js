const test = require('node:test');
const assert = require('node:assert/strict');
const z = require('../src/expediente/zip');

test('crc32 conocido', () => {
  assert.equal(z.crc32(Buffer.from('hello')).toString(16), '3610a686');
  assert.equal(z.crc32(Buffer.alloc(0)), 0);
});

test('zip store: ida y vuelta con nombres UTF-8', () => {
  const zip = z.crearZip([
    { nombre: 'documentos/POLITICA_SST/POL-01-v1.pdf', datos: Buffer.from('%PDF politica') },
    { nombre: 'índice.html', datos: '<h1>Expediente</h1>' },
  ]);
  assert.equal(zip.readUInt32LE(0), 0x04034b50);
  const e = z.leerZip(zip);
  assert.deepEqual(e.map((x) => x.nombre), ['documentos/POLITICA_SST/POL-01-v1.pdf', 'índice.html']);
  assert.equal(e[0].datos.toString(), '%PDF politica');
  assert.ok(e.every((x) => x.crcOk));
});
