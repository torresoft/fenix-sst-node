const test = require('node:test');
const assert = require('node:assert/strict');
const c = require('../src/indicadores/calculo');

const vinc = [
  { fecha_ingreso: '2025-01-01', fecha_retiro: null, estado: 'activa' },
  { fecha_ingreso: '2025-01-01', fecha_retiro: '2026-03-15', estado: 'retirada' },
  { fecha_ingreso: '2026-02-10', fecha_retiro: null, estado: 'activa' },
  { fecha_ingreso: '2026-01-01', fecha_retiro: null, estado: 'anulada' },
];

test('trabajadores al cierre y promedio anual', () => {
  assert.equal(c.trabajadoresAl(vinc, '2026-01-31'), 2);
  assert.equal(c.trabajadoresAl(vinc, '2026-02-28'), 3);
  assert.equal(c.trabajadoresAl(vinc, '2026-03-31'), 2);
  assert.equal(c.promedioAnual(vinc, 2026, 3), 2.3333);
});

test('dias de incapacidad dentro del mes aunque crucen meses', () => {
  const inc = [{ fecha_inicio: '2026-01-29', dias: 5, estado: 'registrada' }, { fecha_inicio: '2026-02-10', dias: 2, estado: 'anulada' }];
  assert.equal(c.diasIncapacidadEnMes(inc, 2026, 1), 3);
  assert.equal(c.diasIncapacidadEnMes(inc, 2026, 2), 2);
});

test('indicadores de resultado del art. 30', () => {
  const eventos = [
    { tipo: 'accidente', gravedad: 'leve', fecha_base: '2026-02-05', dias_incapacidad: 4, dias_cargados: 0, estado: 'cerrado' },
    { tipo: 'accidente', gravedad: 'mortal', fecha_base: '2026-01-20', dias_incapacidad: 0, dias_cargados: 6000, estado: 'cerrado' },
    { tipo: 'enfermedad', fecha_base: '2025-06-01', estado: 'cerrado' },
    { tipo: 'enfermedad', fecha_base: '2026-02-01', estado: 'registrado' },
    { tipo: 'accidente', gravedad: 'leve', fecha_base: '2026-02-06', estado: 'anulado' },
  ];
  const r = Object.fromEntries(c.resultado({ eventos, vinculaciones: vinc, incapacidades: [], anio: 2026, mes: 2, diasProgramados: 20 }).map((x) => [x.codigo, x]));
  assert.deepEqual([r.FREC_AT.numerador, r.FREC_AT.denominador, r.FREC_AT.valor], [1, 3, 33.3333]);
  assert.equal(r.SEV_AT.valor, 133.3333);
  assert.deepEqual([r.PROP_AT_MORTAL.numerador, r.PROP_AT_MORTAL.denominador, r.PROP_AT_MORTAL.valor], [1, 2, 50]);
  assert.equal(r.PREV_EL.numerador, 2);
  assert.equal(r.INC_EL.numerador, 1);
  assert.equal(r.INC_EL.valor, 40000, '1 / promedio 2.5 x 100000');
  assert.equal(r.AUS_MEDICO.denominador, 60);
  assert.equal(r.FREC_AT.periodo, '2026-02');
});

test('cumplimiento de meta segun sentido', () => {
  assert.equal(c.cumpleMeta(1.5, 2, 'menor'), true);
  assert.equal(c.cumpleMeta(85, 90, 'mayor'), false);
  assert.equal(c.cumpleMeta(null, 90), null);
  assert.equal(c.valor(1, 0), null);
});
