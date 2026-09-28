const test = require('node:test');
const assert = require('node:assert/strict');
const { desdeJson } = require('../src/fechas');
const { ErrorCobertura, hoyBogota } = require('../src/fechas/calendario');

const cal = desdeJson();

test('cruce de fin de semana: viernes + 2 habiles = martes', () => {
  assert.equal(cal.sumarPlazo('2026-09-25', 2, 'habil'), '2026-09-29');
});

test('festivo trasladado por Ley Emiliani (Reyes 6 ene -> lunes 12 ene 2026)', () => {
  assert.equal(cal.esHabil('2026-01-06'), true);
  assert.equal(cal.esHabil('2026-01-12'), false);
  assert.equal(cal.sumarPlazo('2026-01-09', 2, 'habil'), '2026-01-14');
});

test('Semana Santa 2026: jueves y viernes santo no cuentan', () => {
  assert.equal(cal.sumarPlazo('2026-04-01', 2, 'habil'), '2026-04-07');
  assert.equal(cal.diasHabiles('2026-04-01', '2026-04-07'), 2);
});

test('accidente un viernes festivo (Viernes Santo): reporte a la ARL vence el martes', () => {
  assert.equal(cal.sumarPlazo('2026-04-03', 2, 'habil'), '2026-04-07');
});

test('accidente viernes festivo 7 ago 2026: 2 y 20 habiles saltando el lunes 17 (Asuncion trasladada)', () => {
  assert.equal(cal.sumarPlazo('2026-08-07', 2, 'habil'), '2026-08-11');
  assert.equal(cal.sumarPlazo('2026-08-07', 20, 'habil'), '2026-09-07');
});

test('cambio de anio con festivos 1 y 11 de enero 2027', () => {
  assert.equal(cal.sumarPlazo('2026-12-31', 2, 'habil'), '2027-01-05');
});

test('diasHabiles negativo cuando hasta < desde', () => {
  assert.equal(cal.diasHabiles('2026-04-07', '2026-04-01'), -2);
});

test('plazo en dias calendario', () => {
  assert.equal(cal.sumarPlazo('2026-01-01', 15, 'calendario'), '2026-01-16');
  assert.equal(cal.sumarPlazo('2026-09-26', 1, 'calendario'), '2026-09-27');
  assert.equal(cal.sumarPlazo('2026-09-26', 1, 'calendario', { correrSiInhabil: true }), '2026-09-28');
});

test('plazo en meses con recorte a fin de mes', () => {
  assert.equal(cal.sumarPlazo('2026-01-31', 1, 'mes'), '2026-02-28');
  assert.equal(cal.sumarPlazo('2026-11-30', 3, 'mes'), '2027-02-28');
  assert.equal(cal.sumarPlazo('2027-11-30', 3, 'mes'), '2028-02-29');
});

test('fuera de la cobertura de festivos lanza error en vez de calcular mal', () => {
  assert.throws(() => cal.sumarPlazo('2031-12-30', 5, 'habil'), ErrorCobertura);
  assert.throws(() => cal.sumarPlazo('2025-12-30', 1, 'habil'), ErrorCobertura);
});

test('entradas invalidas', () => {
  assert.throws(() => cal.sumarPlazo('2026-02-30', 1, 'habil'));
  assert.throws(() => cal.sumarPlazo('2026-02-10', -1, 'habil'));
  assert.throws(() => cal.sumarPlazo('2026-02-10', 1, 'semanas'));
});

test('estadoPlazo', () => {
  assert.equal(cal.estadoPlazo('2026-04-07', '2026-04-08'), 'vencido');
  assert.equal(cal.estadoPlazo('2026-04-07', '2026-04-07'), 'por_vencer');
  assert.equal(cal.estadoPlazo('2026-04-07', '2026-04-04'), 'por_vencer');
  assert.equal(cal.estadoPlazo('2026-04-07', '2026-04-01'), 'en_termino');
  assert.equal(cal.estadoPlazo('2026-04-07', '2026-04-08', 3, '2026-04-06'), 'cumplido');
});

test('hoyBogota usa la zona de Colombia y no la del servidor', () => {
  assert.equal(hoyBogota(new Date('2026-09-27T03:30:00Z')), '2026-09-26');
});
