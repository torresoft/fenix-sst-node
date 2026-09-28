const test = require('node:test');
const assert = require('node:assert/strict');
const pesv = require('../src/pesv/servicio');
const csv = require('../src/integraciones/csv');
const { accionNomina } = require('../src/integraciones/servicio');

test('pesv: obligatoriedad, avance y bloqueos del preoperacional', () => {
  assert.equal(pesv.obligatorio(11, 0), true);
  assert.equal(pesv.obligatorio(10, 1), false);
  assert.equal(pesv.obligatorio(1, 2), true);
  assert.equal(pesv.avancePorcentaje(['implementado', 'en_proceso', 'no_aplica']), '50.00');
  assert.equal(pesv.avancePorcentaje(['no_aplica']), '0.00');
  const b = pesv.bloqueos({ soat_vence: '2026-09-01', rtm_vence: null }, { licencia_vence: '2027-01-01' }, '2026-09-28');
  assert.deepEqual(b, ['SOAT vencido el 2026-09-01']);
});

test('csv: separador, comillas, BOM, tildes en cabecera e inyeccion de formulas', () => {
  const f = csv.parsear('﻿Número Documento;Nombres\r\n123;"Pérez; Ana"\r\n\r\n456;"Dijo ""hola"""\n');
  assert.deepEqual(f, [{ _fila: 2, numero_documento: '123', nombres: 'Pérez; Ana' }, { _fila: 3, numero_documento: '456', nombres: 'Dijo "hola"' }]);
  assert.equal(csv.celda('=HYPERLINK("x")'), '"\'=HYPERLINK(""x"")"');
  assert.equal(csv.generar([['a', 'b;c']]), '﻿a;"b;c"\r\n');
});

test('nomina: accion por fila segun el estado actual', () => {
  assert.equal(accionNomina({ fecha_ingreso: '2026-09-01' }, null, null).accion, 'crear');
  assert.equal(accionNomina({ fecha_ingreso: '2026-09-01' }, { id: 1 }, null).accion, 'vincular');
  assert.equal(accionNomina({ fecha_ingreso: '2026-09-01' }, { id: 1 }, { id: 2 }).accion, 'omitir');
  assert.equal(accionNomina({ fecha_retiro: '2026-09-20' }, { id: 1 }, { id: 2 }).accion, 'retirar');
  assert.equal(accionNomina({ fecha_retiro: '2026-09-20' }, null, null).accion, 'omitir');
});
