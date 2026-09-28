// Integracion M07 contra MariaDB real.
const test = require('node:test');
const assert = require('node:assert/strict');
const u = require('./_util');
const personas = require('../src/personas/servicio');
const pel = require('../src/peligros/servicio');
const f = require('../src/formacion/servicio');

const s = {};
const rechaza = (p, re) => u.rechaza(assert, p, re);
const HOY = '2026-09-26';
const obl = async (tipo, id, plazo) => (await s.db.query(
  'SELECT estado, fecha_limite FROM obligacion_pendiente WHERE entidad_origen_tipo = ? AND entidad_origen_id = ? AND plazo_codigo = ?', [tipo, id, plazo],
))[0];

test.before(async () => {
  Object.assign(s, await u.preparar('M07', { personasN: 2 }));
  s.cargo = await personas.guardarCargo(s.repo, s.E, null, { nombre: 'Electricista' });
  [s.v1] = await s.repo.listar('vinculacion', { persona_id: s.personas[0] });
  await personas.reasignar(s.repo, s.E, s.v1.id, { cargo_id: String(s.cargo) });
});
test.after(() => u.cerrar(s));

test('el ingreso genera la induccion previa a labores y registrarla la cumple', async () => {
  const [o] = await obl('vinculacion', s.v1.id, 'INDUCCION_INGRESO');
  assert.equal(o.fecha_limite, '2024-01-10', 'mismo dia del ingreso');
  await f.registrarCompetencia(s.repo, s.E, s.personas[0], { tipo: 'INDUCCION', fecha_obtencion: '2024-01-10' }, HOY);
  const [o2] = await obl('vinculacion', s.v1.id, 'INDUCCION_INGRESO');
  assert.equal(o2.estado, 'cumplido');
});

test('competencias con vencimiento por norma, certificado obligatorio y renovacion', async () => {
  await rechaza(f.registrarCompetencia(s.repo, s.E, s.personas[0], { tipo: 'ELECTRICO', fecha_obtencion: '2026-01-15' }, HOY), /certificado/);
  const cert = await u.documentoVigente(s.repo, s.E, 'REG_CAPACITACION', 'CERT-ELEC-1', { persona_id: String(s.personas[0]) });
  const c1 = await f.registrarCompetencia(s.repo, s.E, s.personas[0], { tipo: 'ELECTRICO', fecha_obtencion: '2026-01-15', documento_id: String(cert) }, HOY);
  const [[comp]] = await s.db.query('SELECT fecha_vence FROM competencia WHERE id = ?', [c1]);
  assert.equal(comp.fecha_vence, '2027-01-15', 'habilitacion electrica: 1 anio');
  assert.equal((await obl('competencia', c1, 'HABILITACION_ELECTRICO'))[0].fecha_limite, '2027-01-15');
  const cert2 = await u.documentoVigente(s.repo, s.E, 'REG_CAPACITACION', 'CERT-ELEC-2', { persona_id: String(s.personas[0]) });
  await f.registrarCompetencia(s.repo, s.E, s.personas[0], { tipo: 'ELECTRICO', fecha_obtencion: '2026-09-01', documento_id: String(cert2) }, HOY);
  const [[vieja]] = await s.db.query('SELECT estado FROM competencia WHERE id = ?', [c1]);
  assert.equal(vieja.estado, 'reemplazada');
  assert.equal((await obl('competencia', c1, 'HABILITACION_ELECTRICO'))[0].estado, 'cumplido');
  await rechaza(s.db.query('UPDATE competencia SET fecha_vence = NULL WHERE id = ?', [c1]), /cerrada/);
});

test('requisitos por cargo y matriz de competencias', async () => {
  await f.guardarRequisitos(s.repo, s.E, s.cargo, ['ELECTRICO', 'ALTURAS']);
  await rechaza(f.guardarRequisitos(s.repo, s.E, s.cargo, ['INDUCCION']), /invalida/);
  const m = await f.matrizCompetencias(s.repo, s.E, HOY);
  const fila = m.filas.find((x) => x.persona.id === s.personas[0]);
  assert.equal(fila.celdas.INDUCCION.estado, 'vigente');
  assert.equal(fila.celdas.ELECTRICO.estado, 'vigente');
  assert.equal(fila.celdas.ALTURAS.estado, 'falta');
  const otra = m.filas.find((x) => x.persona.id === s.personas[1]);
  assert.equal(otra.celdas.ELECTRICO, null, 'otro cargo no lo exige');
  assert.equal(otra.celdas.INDUCCION.estado, 'falta');
});

test('capacitacion realizada acredita la competencia a quienes aprobaron', async () => {
  const k = await f.programar(s.repo, s.E, { tema: 'Reinduccion anual SST 2026', fecha: '2026-09-20', horas: '2', competencia: 'REINDUCCION' });
  await rechaza(f.realizar(s.repo, s.E, k, { asistentes: [] }, HOY), /asistentes/);
  const n = await f.realizar(s.repo, s.E, k, { asistentes: s.personas.map(String), reprobados: [String(s.personas[1])], eficacia: 'Evaluacion escrita' }, HOY);
  assert.equal(n, 1);
  const [[c]] = await s.db.query("SELECT fecha_vence, capacitacion_id FROM competencia WHERE persona_id = ? AND tipo = 'REINDUCCION'", [s.personas[0]]);
  assert.deepEqual(c, { fecha_vence: '2027-09-20', capacitacion_id: k });
  await rechaza(f.realizar(s.repo, s.E, k, { asistentes: s.personas.map(String) }, HOY), /ya fue registrada/);
  await rechaza(s.db.query('UPDATE capacitacion SET horas = 9 WHERE id = ?', [k]), /realizada/);
});

test('http: pestanas de formacion y detalle de capacitacion', async () => {
  const ir = await u.clienteHttp(s);
  for (const tab of ['matriz', 'capacitaciones', 'requisitos']) {
    const r = await ir(`/formacion?tab=${tab}`);
    assert.equal(r.status, 200, tab);
  }
  const [[k]] = await s.db.query('SELECT id FROM capacitacion WHERE empresa_id = ?', [s.E]);
  const r = await ir(`/formacion/capacitaciones/${k.id}`);
  assert.equal(r.status, 200);
  assert.match(r.texto, /Reinduccion anual/);
});
