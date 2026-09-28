// Integracion M09 contra MariaDB real.
const test = require('node:test');
const assert = require('node:assert/strict');
const u = require('./_util');
const personas = require('../src/personas/servicio');
const salud = require('../src/salud/servicio');

const s = {};
const rechaza = (p, re) => u.rechaza(assert, p, re);
const HOY = '2026-09-26';
const obl = async (tipo, id, plazo) => (await s.db.query(
  'SELECT estado, fecha_limite FROM obligacion_pendiente WHERE entidad_origen_tipo = ? AND entidad_origen_id = ? AND plazo_codigo = ? ORDER BY id', [tipo, id, plazo],
))[0];
const concepto = (persona, codigo) => u.documentoVigente(s.repo, s.E, 'CONCEPTO_APTITUD', codigo, { persona_id: String(persona), modalidad_firma: 'digital_externa', firmantes_externos: 'Medico IPS' });

test.before(async () => {
  Object.assign(s, await u.preparar('M09', { personasN: 2 }));
  s.cargo = await personas.guardarCargo(s.repo, s.E, null, { nombre: 'Operario de bodega', perfil_riesgo: 'Manipulacion manual de cargas' });
  const [v] = await s.repo.listar('vinculacion', { persona_id: s.personas[0] });
  await personas.reasignar(s.repo, s.E, v.id, { cargo_id: String(s.cargo) });
});
test.after(() => u.cerrar(s));

test('orden con enfasis del perfil del cargo; concepto con restricciones abre 20 dias habiles', async () => {
  const id = await salud.ordenar(s.repo, s.E, { persona_id: String(s.personas[0]), tipo: 'periodico', ips: 'IPS Salud Pereira', fecha_orden: '2026-08-01' });
  const [[e]] = await s.db.query('SELECT enfasis FROM evaluacion_medica WHERE id = ?', [id]);
  assert.match(e.enfasis, /Manipulacion manual de cargas/);
  await rechaza(salud.registrarConcepto(s.repo, s.E, id, { concepto: 'apto', fecha_examen: '2026-08-05' }, HOY), /CONCEPTO_APTITUD/);
  const doc = await concepto(s.personas[0], 'CA-001');
  await rechaza(salud.registrarConcepto(s.repo, s.E, id, {
    concepto: 'apto_con_restricciones', fecha_examen: '2026-08-05', restricciones: 'Lumbalgia M54.5: evitar cargas', documento_id: String(doc),
  }, HOY), /CIE-10/);
  await salud.registrarConcepto(s.repo, s.E, id, {
    concepto: 'apto_con_restricciones', fecha_examen: '2026-08-05', restricciones: 'No levantar mas de 12 kg', proximo_examen: '2027-08-05', documento_id: String(doc),
  }, HOY);
  // 20 habiles desde el 5-ago saltando los festivos del 7 y del 17 de agosto
  assert.deepEqual((await obl('evaluacion_medica', id, 'ADAPTA_RESTRICCION')).map((o) => o.fecha_limite), ['2026-09-04']);
  assert.deepEqual((await obl('persona', s.personas[0], 'EXAMEN_PERIODICO')).map((o) => o.fecha_limite), ['2027-08-05']);
  await rechaza(s.db.query("UPDATE evaluacion_medica SET concepto = 'apto' WHERE id = ?", [id]), /no se modifica/);
  await salud.registrarAdaptacion(s.repo, s.E, id, { fecha: '2026-08-20', observacion: 'Reubicado en despacho de pedidos livianos' }, HOY);
  assert.equal((await obl('evaluacion_medica', id, 'ADAPTA_RESTRICCION'))[0].estado, 'cumplido');
  s.evalId = id;
});

test('egreso: el concepto cumple el examen de egreso del retiro', async () => {
  const [v] = await s.repo.listar('vinculacion', { persona_id: s.personas[1] });
  await personas.retirar(s.repo, s.E, v.id, { fecha: '2026-09-20', motivo: 'Terminacion de contrato' }, HOY);
  const id = await salud.ordenar(s.repo, s.E, { persona_id: String(s.personas[1]), tipo: 'egreso', ips: 'IPS Salud', fecha_orden: '2026-09-21' });
  const doc = await concepto(s.personas[1], 'CA-002');
  await salud.registrarConcepto(s.repo, s.E, id, { concepto: 'apto', fecha_examen: '2026-09-23', documento_id: String(doc), proximo_examen: '2027-01-01' }, HOY);
  const [o] = await obl('vinculacion', v.id, 'EXAMEN_EGRESO');
  assert.equal(o.estado, 'cumplido');
  const [[e]] = await s.db.query('SELECT proximo_examen FROM evaluacion_medica WHERE id = ?', [id]);
  assert.equal(e.proximo_examen, null, 'el egreso no programa periodicos');
});

test('incapacidades sin diagnostico y perfil agregado', async () => {
  await rechaza(salud.registrarIncapacidad(s.repo, s.E, { persona_id: String(s.personas[0]), origen: 'comun', fecha_inicio: '2026-09-01', dias: '3', observacion: 'J45 asma' }, HOY), /CIE-10/);
  await salud.registrarIncapacidad(s.repo, s.E, { persona_id: String(s.personas[0]), origen: 'comun', fecha_inicio: '2026-09-01', dias: '3' }, HOY);
  const p = await salud.panel(s.repo, s.E, 2026, HOY);
  assert.equal(p.ausentismo.dias_comun, 3);
  assert.equal(p.perfil.total, 1, 'solo vinculaciones activas');
  const cols = (await s.db.query('SHOW COLUMNS FROM evaluacion_medica'))[0].map((c) => c.Field).concat((await s.db.query('SHOW COLUMNS FROM incapacidad'))[0].map((c) => c.Field));
  assert.ok(!cols.some((c) => /diagnost|cie|paraclin/i.test(c)), 'no existen columnas clinicas');
});

test('canal del trabajador: ve solo sus propios registros', async () => {
  await require('./_util').mismoDocumento(s, s.personas[0], s.T.usuarioId);
  await salud.vincularUsuario(s.repo, s.personas[0], String(s.T.usuarioId));
  const m = await salud.misRegistros(s.repo, s.T.usuarioId);
  assert.equal(m.persona.id, s.personas[0]);
  assert.equal(m.evaluaciones[0].concepto, 'apto_con_restricciones');
  assert.equal(await salud.misRegistros(s.repo, 999999), null);
});

test('http: pestanas de salud y mis registros', async () => {
  const ir = await u.clienteHttp(s);
  for (const tab of ['evaluaciones', 'ausentismo', 'perfil']) assert.equal((await ir(`/salud?tab=${tab}`)).status, 200, tab);
  const r = await ir('/mis-registros');
  assert.match(r.texto, /No levantar mas de 12 kg/);
});
