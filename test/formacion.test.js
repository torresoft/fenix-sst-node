const test = require('node:test');
const assert = require('node:assert/strict');
const r = require('../src/formacion/reglas');
const { tipos } = require('../data/formacion.json');

const HOY = '2026-09-26';

test('estado de una competencia: falta, vigente sin vencimiento, por vencer, vencida', () => {
  assert.equal(r.estadoCompetencia(null, HOY), 'falta');
  assert.equal(r.estadoCompetencia({ fecha_vence: null }, HOY), 'vigente');
  assert.equal(r.estadoCompetencia({ fecha_vence: '2026-10-20' }, HOY), 'por_vencer');
  assert.equal(r.estadoCompetencia({ fecha_vence: '2027-01-01' }, HOY), 'vigente');
  assert.equal(r.estadoCompetencia({ fecha_vence: '2026-09-25' }, HOY), 'vencida');
});

test('matriz: requeridas a todos + las del cargo; celdas no requeridas en null', () => {
  const personas = [{ id: 1, cargo_id: 10 }, { id: 2, cargo_id: 20 }];
  const porCargo = new Map([[10, ['ALTURAS']]]);
  const vigentes = [{ persona_id: 1, tipo: 'INDUCCION', fecha_vence: null }, { persona_id: 1, tipo: 'ALTURAS', fecha_vence: null }];
  const m = r.matriz(personas, tipos, porCargo, vigentes, HOY);
  assert.deepEqual(m.columnas, ['INDUCCION', 'REINDUCCION', 'ALTURAS']);
  assert.equal(m.filas[0].celdas.ALTURAS.estado, 'vigente');
  assert.equal(m.filas[1].celdas.ALTURAS, null);
  assert.equal(m.filas[1].celdas.INDUCCION.estado, 'falta');
  assert.deepEqual(m.resumen, { vigente: 2, por_vencer: 0, vencida: 0, falta: 3 });
});

test('sugerencias por peligros del cargo', () => {
  const s = r.sugerencias([
    { cargo_id: 1, peligro: 'Trabajo en alturas sobre cubierta', clase_peligro: 'SEGURIDAD' },
    { cargo_id: 1, peligro: 'Manipulacion de solventes', clase_peligro: 'QUIMICO' },
    { cargo_id: 2, peligro: 'Ruido', clase_peligro: 'FISICO' },
  ]);
  assert.deepEqual(s.get(1).sort(), ['ALTURAS', 'SGA']);
  assert.deepEqual(s.get(2), []);
});
