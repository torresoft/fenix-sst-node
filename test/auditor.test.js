const test = require('node:test');
const assert = require('node:assert/strict');
const a = require('../src/matriz/auditor');
const datos = require('../data/normas.json');
const { ambitos } = require('../data/ambitos.json');

// Mismo mapeo que hace el seed: estado -> estado_vigencia
const normas = datos.normas.map((n) => ({ ...n, estado_vigencia: n.estado, numero: String(n.numero) }));
const desinformacion = datos.desinformacion;
const porCodigo = new Map(normas.map((n) => [n.codigo, n]));
const soloGeneral = a.ambitosActivos(ambitos, {}, []);

test('parser: formatos reales de matrices legales', () => {
  const casos = {
    'Resolución 2346 de 2007': [['resolucion', '2346', 2007]],
    'Res. 1409/2012 trabajo en alturas': [['resolucion', '1409', 2012]],
    'Decreto No. 1443 del 2014': [['decreto', '1443', 2014]],
    'Res. 652 y 1356 de 2012': [['resolucion', '652', 2012], ['resolucion', '1356', 2012]],
    'Ley 1562 de 2012': [['ley', '1562', 2012]],
    'Decreto Ley 1295 de 1994': [['decreto_ley', '1295', 1994]],
    'RES-0312-2019': [['resolucion', '312', 2019]],
    'Circular 027 de 2026': [['circular', '27', 2026]],
  };
  for (const [texto, esperado] of Object.entries(casos)) {
    assert.deepEqual(a.parsearReferencias(texto).map((r) => [r.tipo, r.numero, r.anio]), esperado, texto);
  }
  assert.deepEqual(a.parsearReferencias('Politica de SST firmada'), []);
});

test('cadena de reemplazo sigue derogatorias encadenadas hasta la vigente', () => {
  assert.deepEqual(a.cadenaReemplazo('RES-4502-2012', porCodigo), ['RES-754-2021', 'RES-908-2025']);
  assert.deepEqual(a.cadenaReemplazo('RES-2346-2007', porCodigo), ['RES-1843-2025']);
  assert.deepEqual(a.cadenaReemplazo('RES-0312-2019', porCodigo), []);
});

test('ambitos: generales siempre, declarados y automaticos por regla', () => {
  const act = a.ambitosActivos(ambitos, { numero_vehiculos: 3, numero_conductores: 2 }, ['alturas']);
  assert.equal(act.get('general'), 'general');
  assert.equal(act.get('alturas'), 'declarado');
  assert.equal(act.get('pesv'), 'automatico');
  assert.equal(act.has('quimicos'), false);
  assert.equal(a.ambitosActivos(ambitos, { numero_vehiculos: 10, numero_conductores: 1 }, []).has('pesv'), false);
});

test('auditor: derogadas con reemplazo e impacto', () => {
  const r = a.auditar({ texto: 'Resolucion 2346 de 2007\nRes. 4502 de 2012', normas, desinformacion, activos: soloGeneral });
  const d = Object.fromEntries(r.derogadas.map((x) => [x.codigo, x]));
  assert.equal(d['RES-2346-2007'].reemplazo, 'RES-1843-2025');
  assert.match(d['RES-2346-2007'].impacto, /20 dias habiles/);
  assert.equal(d['RES-4502-2012'].reemplazo, 'RES-908-2025');
  assert.ok(r.faltantes.some((f) => f.codigo === 'RES-1843-2025' && /derogada/.test(f.motivo)));
});

test('auditor: desinformacion y no reconocidas', () => {
  const r = a.auditar({ texto: 'Decreto 0312 de 2026\nResolucion 9999 de 2020\nPrograma de salud ocupacional', normas, desinformacion, activos: soloGeneral });
  assert.equal(r.desinformacion[0].norma_correcta, 'RES-0312-2019');
  assert.equal(r.noReconocidas.length, 2);
});

test('auditor: norma de alturas en empresa sin alturas no aplica; con alturas es correcta', () => {
  const texto = 'Res. 4272 de 2021';
  const sin = a.auditar({ texto, normas, desinformacion, activos: soloGeneral });
  assert.equal(sin.noAplican[0].codigo, 'RES-4272-2021');
  const con = a.auditar({ texto, normas, desinformacion, activos: a.ambitosActivos(ambitos, {}, ['alturas']) });
  assert.equal(con.correctas[0].codigo, 'RES-4272-2021');
});

test('auditor: faltantes, cobertura y CSV con columnas y BOM', () => {
  const csv = '﻿norma;descripcion\n"Ley 1562 de 2012";SG-SST\nDecreto 1072 de 2015;DUR\nLey 1562 de 2012;repetida';
  const r = a.auditar({ texto: csv, normas, desinformacion, activos: soloGeneral });
  assert.deepEqual(r.correctas.map((x) => x.codigo).sort(), ['DEC-1072-2015', 'LEY-1562-2012']);
  assert.equal(r.noReconocidas.length, 1);
  const aplicables = a.normasAplicables(normas, soloGeneral).length;
  assert.equal(r.faltantes.length, aplicables - 2);
  assert.equal(r.totales.cobertura, Math.round((2 / aplicables) * 10000) / 100);
  assert.ok(!r.faltantes.some((f) => f.codigo === 'DEC-052-2017'), 'efecto agotado no se exige');
});

const b = require('../src/matriz/boletin');

test('boletin: primera carga no genera ruido; cambios de estado y normas nuevas si', () => {
  const despues = [
    { codigo: 'RES-1-2026', estado_vigencia: 'vigente', objeto: 'Nueva' },
    { codigo: 'RES-0312-2019', estado_vigencia: 'derogada', derogada_por: 'RES-2-2026' },
    { codigo: 'LEY-9-1979', estado_vigencia: 'vigente' },
  ];
  assert.deepEqual(b.diffNormas(new Map(), despues), []);
  const antes = new Map([['RES-0312-2019', 'vigente'], ['LEY-9-1979', 'vigente']]);
  const r = b.diffNormas(antes, despues);
  assert.deepEqual(r.map((x) => [x.norma_codigo, x.tipo_cambio]), [['RES-1-2026', 'nueva'], ['RES-0312-2019', 'cambio_estado']]);
  assert.match(r[1].detalle, /RES-2-2026/);
});

test('boletin: afectacion por perfil, matriz o documentos', () => {
  const bol = { tipo_cambio: 'cambio_estado' };
  assert.equal(b.motivoAfectacion(bol, { aplicaPerfil: false, enMatriz: false, documentos: [] }), null);
  assert.deepEqual(b.motivoAfectacion(bol, { aplicaPerfil: false, enMatriz: true, documentos: [7] }).motivos, ['en_matriz', 'citada_en_documentos']);
});
