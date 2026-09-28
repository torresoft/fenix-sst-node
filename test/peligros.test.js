const test = require('node:test');
const assert = require('node:assert/strict');
const m = require('../src/peligros/motor');
const { metodologias } = require('../data/peligros.json');

const gtc = metodologias[0].escalas;

test('GTC 45: NP = ND x NE, NR = NP x NC, nivel y aceptabilidad', () => {
  const r = m.evaluar(gtc, { nd: 'MA', ne: 'EC', nc: 'M' });
  assert.deepEqual([r.np, r.nr, r.nivel_riesgo, r.critico], [40, 4000, 'I', true]);
  assert.equal(r.aceptabilidad, 'No aceptable');
  const medio = m.evaluar(gtc, { nd: 'M', ne: 'EO', nc: 'G' });
  assert.deepEqual([medio.np, medio.nr, medio.nivel_riesgo, medio.nivel_probabilidad], [4, 100, 'III', 'Bajo']);
  assert.equal(m.evaluar(gtc, { nd: 'A', ne: 'EF', nc: 'L' }).nivel_riesgo, 'II');
  assert.equal(m.evaluar(gtc, { nd: 'B', ne: 'EC', nc: 'M' }).nivel_riesgo, 'IV');
  assert.throws(() => m.evaluar(gtc, { nd: 'X', ne: 'EC', nc: 'M' }), /deficiencia/);
});

test('todas las combinaciones caen en algun rango de NP y NR', () => {
  for (const nd of gtc.nd) for (const ne of gtc.ne) for (const nc of gtc.nc) {
    assert.doesNotThrow(() => m.evaluar(gtc, { nd: nd.codigo, ne: ne.codigo, nc: nc.codigo }));
  }
});

test('jerarquia obligatoria en riesgos criticos', () => {
  const items = [{ id: 1, peligro: 'Caida de altura', nivel_riesgo: 'I', estado: 'activo' }, { id: 2, peligro: 'Ruido', nivel_riesgo: 'III', estado: 'activo' }];
  const criticos = new Set(['I', 'II']);
  assert.match(m.advertenciasJerarquia(items, [], criticos)[0].texto, /sin medidas/);
  assert.match(m.advertenciasJerarquia(items, [{ item_id: 1, jerarquia_codigo: 'epp', estado: 'propuesto' }], criticos)[0].texto, /ingenieria/);
  assert.deepEqual(m.advertenciasJerarquia(items, [{ item_id: 1, jerarquia_codigo: 'ingenieria', estado: 'propuesto' }], criticos), []);
});

test('impedimentos para publicar', () => {
  assert.deepEqual(m.impedimentosPublicar({ estado: 'borrador', participantes: 'COPASST' }, [{ estado: 'activo' }], { id: 1 }), []);
  assert.equal(m.impedimentosPublicar({ estado: 'borrador' }, [], null).length, 3);
});

test('catalogo: cargos tipo solo referencian peligros tipo existentes', () => {
  const { peligros_tipo: pt, cargos_tipo: ct, clases_peligro: cl } = require('../data/peligros.json');
  const codigos = new Set(pt.map((p) => p.codigo));
  const clases = new Set(cl.map((c) => c.codigo));
  for (const p of pt) assert.ok(clases.has(p.clase), p.codigo);
  for (const c of ct) for (const x of c.peligros) assert.ok(codigos.has(x.peligro), `${c.codigo}: ${x.peligro}`);
});

test('propuestas desde cargos: agrupa por proceso/actividad/peligro y vincula a filas existentes', () => {
  const peligros = new Map([
    ['RUIDO', { codigo: 'RUIDO', clase_codigo: 'FISICO', nombre: 'Ruido', nc_sugerido: 'MG' }],
    ['POSTURA', { codigo: 'POSTURA', clase_codigo: 'BIOMECANICO', nombre: 'Postura', nc_sugerido: 'G' }],
  ]);
  const tipos = new Map([['OP', { descripcion: 'Operar maquinas', peligros: [{ peligro: 'RUIDO', ne: 'EC' }, { peligro: 'POSTURA', ne: 'EF' }] }]]);
  const cargos = [
    { id: 1, cargo_tipo_codigo: 'OP', proceso: 'Produccion', expuestos: 3 },
    { id: 2, cargo_tipo_codigo: 'OP', proceso: 'Produccion', expuestos: 2 },
    { id: 3, cargo_tipo_codigo: null, proceso: 'X', expuestos: 1 },
  ];
  const existentes = [{ id: 9, proceso: 'produccion ', actividad: 'Operar maquinas', peligro_tipo_codigo: 'POSTURA', cargos: [1] }];
  const r = m.propuestasDesdeCargos(cargos, tipos, peligros, existentes);
  assert.equal(r.nuevos.length, 1);
  assert.deepEqual([r.nuevos[0].peligro, r.nuevos[0].ne, r.nuevos[0].nc, r.nuevos[0].nd], ['Ruido', 'EC', 'MG', 'M']);
  assert.deepEqual([r.nuevos[0].cargos, r.nuevos[0].expuestos], [[1, 2], 5]);
  assert.deepEqual(r.vincular, [{ item_id: 9, cargo_id: 2 }]);
});

test('peligros sugeridos sin revisar impiden publicar', () => {
  const imp = m.impedimentosPublicar({ estado: 'borrador', participantes: 'COPASST' }, [{ estado: 'activo', sugerido: 1 }], { id: 1 });
  assert.match(imp.join(), /sugerido/);
});
