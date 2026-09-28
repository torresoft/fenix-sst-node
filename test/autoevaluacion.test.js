const test = require('node:test');
const assert = require('node:assert/strict');
const m = require('../src/autoevaluacion/motor');
const est = require('../data/estandares_minimos.json');

// Mismo mapeo que el seed
const conjuntos = est.aplicabilidad.map((a) => ({ ...a, codigo: a.conjunto }));
const tabla = est.tabla_valores;
const requisitoNumerales = Object.entries(est.requisitos).flatMap(([c, l]) => l.flatMap((r) => r.numerales.map((n) => ({ conjunto_codigo: c, orden: r.orden, numeral: n }))));
const ponderacion = est.ponderacion_phva.flatMap((p) => [{ ciclo: p.ciclo, componente: '', peso: p.peso }, ...p.componentes.map((c) => ({ ciclo: p.ciclo, componente: c.nombre, peso: c.peso }))]);
const valoraciones = est.valoracion.map((v) => ({ codigo: v.codigo, minimo: v.min, maximo: v.max }));
const conj = (codigo) => conjuntos.find((c) => c.codigo === codigo);

test('aplicabilidad: 7, 21, 60 y agropecuario segun trabajadores y riesgo', () => {
  const r = (t, n, agro = false) => m.resolverConjunto(conjuntos, { trabajadores: t, nivelRiesgo: n, agropecuaria: agro }).codigo;
  assert.equal(r(8, 1), 'MIN_7');
  assert.equal(r(10, 3), 'MIN_7');
  assert.equal(r(11, 2), 'MED_21');
  assert.equal(r(50, 3), 'MED_21');
  assert.equal(r(51, 1), 'FULL_60');
  assert.equal(r(5, 4), 'FULL_60', 'riesgo IV con pocos trabajadores: 60 (art. 8 y 15)');
  assert.equal(r(30, 5), 'FULL_60');
  assert.equal(r(6, 2, true), 'AGRO_3');
  assert.equal(r(6, 4, true), 'FULL_60', 'UPA con riesgo IV-V va a 60 (art. 8)');
  assert.equal(r(20, 2, true), 'MED_21');
  assert.throws(() => r(0, 1), /trabajadores/);
  assert.throws(() => m.resolverConjunto(conjuntos, { trabajadores: 5, nivelRiesgo: null }), /centro de trabajo/);
});

test('numerales por conjunto: 60 completos, 7 y 21 por mapeo, agro sin numerales', () => {
  assert.equal(m.numeralesDelConjunto(conj('FULL_60'), tabla, requisitoNumerales).size, 60);
  assert.equal(m.numeralesDelConjunto(conj('MIN_7'), tabla, requisitoNumerales).size, 7);
  const n21 = m.numeralesDelConjunto(conj('MED_21'), tabla, requisitoNumerales);
  assert.equal(n21.size, 23);
  assert.deepEqual(n21.get('1.2.3'), [1], 'el requisito 1 de los 21 cubre dos numerales');
  assert.equal(m.numeralesDelConjunto(conj('AGRO_3'), tabla, requisitoNumerales).size, 0);
});

test('evidencia: vigente, al corte, no vencida y firmada', () => {
  const corte = '2026-12-15';
  const doc = { id: 1, estado: 'vigente', fecha_documento: '2026-02-01', fecha_vence: '2027-02-01', requiere_firma: 1, firmado: true };
  assert.deepEqual(m.evaluarEvidencia([doc], corte), { cumple: true, motivo: 'cumple', validos: [1] });
  assert.equal(m.evaluarEvidencia([], corte).motivo, 'sin_evidencia');
  assert.equal(m.evaluarEvidencia([{ ...doc, firmado: false }], corte).motivo, 'sin_firma');
  assert.equal(m.evaluarEvidencia([{ ...doc, fecha_vence: '2026-11-30' }], corte).motivo, 'vencido');
  assert.equal(m.evaluarEvidencia([{ ...doc, fecha_documento: '2026-12-20' }], corte).motivo, 'posterior_al_corte');
  assert.equal(m.evaluarEvidencia([{ ...doc, estado: 'reemplazado' }], corte).motivo, 'no_vigente');
  assert.equal(m.evaluarEvidencia([{ ...doc, requiere_firma: 0, firmado: false }], corte).cumple, true);
  assert.equal(m.evaluarEvidencia([{ ...doc, firmado: false }, { ...doc, id: 2 }], corte).validos[0], 2);
});

const evidenciaCon = (numerales) => new Map(numerales.map((n) => [n, { cumple: true, motivo: 'cumple', validos: [9] }]));

test('puntaje: 60 estandares sin evidencia = 0 CRITICO; todos = 100 ACEPTABLE', () => {
  const aplican = m.numeralesDelConjunto(conj('FULL_60'), tabla, requisitoNumerales);
  const cero = m.calcular({ tabla, aplican, evidencia: new Map(), noAplica: new Map(), ponderacion, valoraciones });
  assert.equal(cero.puntaje, '0.00');
  assert.equal(cero.valoracion, 'CRITICO');
  const todo = m.calcular({ tabla, aplican, evidencia: evidenciaCon(tabla.map((t) => t.numeral)), noAplica: new Map(), ponderacion, valoraciones });
  assert.equal(todo.puntaje, '100.00');
  assert.equal(todo.valoracion, 'ACEPTABLE');
  assert.deepEqual(todo.desglose.map((d) => [d.ciclo, d.obtenido]), [['PLANEAR', '25.00'], ['HACER', '60.00'], ['VERIFICAR', '5.00'], ['ACTUAR', '10.00']]);
});

test('art. 27: en 7 estandares los 53 numerales fuera del conjunto suman su maximo', () => {
  const aplican = m.numeralesDelConjunto(conj('MIN_7'), tabla, requisitoNumerales);
  const r = m.calcular({ tabla, aplican, evidencia: new Map(), noAplica: new Map(), ponderacion, valoraciones });
  // Suma de los 7 = 12.5 (verificado contra la tabla oficial) -> sin evidencia queda 87.5
  assert.equal(r.puntaje, '87.50');
  assert.equal(r.conteo.evaluados, 7);
  const lleno = m.calcular({ tabla, aplican, evidencia: evidenciaCon([...aplican.keys()]), noAplica: new Map(), ponderacion, valoraciones });
  assert.equal(lleno.puntaje, '100.00');
});

test('no aplica justificado suma el maximo del item y umbrales de valoracion', () => {
  const aplican = m.numeralesDelConjunto(conj('FULL_60'), tabla, requisitoNumerales);
  const r = m.calcular({ tabla, aplican, evidencia: new Map(), noAplica: new Map([['1.1.2', 'Sin trabajadores independientes']]), ponderacion, valoraciones });
  const item = r.items.find((i) => i.numeral === '1.1.2');
  assert.equal(item.resultado, 'no_aplica');
  assert.equal(r.puntaje, item.puntaje);
  assert.equal(m.valoracionDe(5999, valoraciones), 'CRITICO');
  assert.equal(m.valoracionDe(6000, valoraciones), 'MODERADAMENTE_ACEPTABLE');
  assert.equal(m.valoracionDe(8500, valoraciones), 'MODERADAMENTE_ACEPTABLE');
  assert.equal(m.valoracionDe(8501, valoraciones), 'ACEPTABLE');
});

test('brechas ordenadas por peso con puntaje y valoracion proyectados', () => {
  const aplican = m.numeralesDelConjunto(conj('MED_21'), tabla, requisitoNumerales);
  const r = m.calcular({ tabla, aplican, evidencia: new Map(), noAplica: new Map(), ponderacion, valoraciones });
  const b = m.brechas(r, tabla, valoraciones);
  assert.equal(b.length, 23);
  assert.ok(m.aCent(b[0].peso) >= m.aCent(b[b.length - 1].peso));
  assert.equal(b[b.length - 1].puntaje_proyectado, '100.00');
  assert.equal(b[b.length - 1].valoracion_proyectada, 'ACEPTABLE');
  assert.ok(b[0].modo_verificacion);
});
