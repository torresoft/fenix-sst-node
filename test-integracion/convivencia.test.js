// Integracion M17 y consentimientos contra MariaDB real.
const test = require('node:test');
const assert = require('node:assert/strict');
const u = require('./_util');
const conv = require('../src/convivencia/servicio');
const cons = require('../src/consentimientos/servicio');
const salud = require('../src/salud/servicio');

const s = {};
const rechaza = (p, re) => u.rechaza(assert, p, re);
const obligaciones = async (id) => (await s.db.query(
  "SELECT plazo_codigo, fecha_limite, estado FROM obligacion_pendiente WHERE tenant_id = ? AND entidad_origen_tipo = 'queja_convivencia' AND entidad_origen_id = ? ORDER BY plazo_codigo",
  [s.T.tenantId, id],
))[0];
const HOY = '2026-09-26';

test.before(async () => {
  Object.assign(s, await u.preparar('M17', { personasN: 12 }));
});
test.after(() => u.cerrar(s));

test('queja con proteccion: 5 dias habiles y 65 calendario; reserva e inmutabilidad', async () => {
  const id = await conv.radicar(s.repo, s.E, {
    canal: 'verbal', tipo_conducta: 'acoso_laboral', fecha_radicacion: '2026-09-21', quejoso_persona_id: String(s.personas[0]),
    implicados: 'Supervisor de turno', hechos: 'Insultos reiterados y amenazas de despido frente a los companeros', solicita_proteccion: '1',
  }, HOY);
  s.queja = id;
  const [q] = (await s.db.query('SELECT radicado FROM queja_convivencia WHERE id = ?', [id]))[0];
  assert.equal(q.radicado, 'QC-2026-0001');
  assert.deepEqual((await obligaciones(id)).map((o) => [o.plazo_codigo, o.fecha_limite]), [['PROTECCION_ACOSO', '2026-09-28'], ['QUEJA_CONVIVENCIA', '2026-11-25']]);

  const sin = await conv.detalle(s.repo, s.E, id, { reserva: false });
  assert.equal(sin.queja.hechos, undefined);
  assert.equal(sin.queja.implicados, undefined);
  const con = await conv.detalle(s.repo, s.E, id, { reserva: true });
  assert.match(con.queja.hechos, /Insultos/);
  await rechaza(s.db.query("UPDATE queja_convivencia SET hechos = 'otro' WHERE id = ?", [id]), /registre una actuacion/);
});

test('tramite: no cierra sin medida de proteccion; la medida y el cierre cumplen los relojes', async () => {
  await conv.actuar(s.repo, s.E, s.queja, { tipo: 'citacion', fecha: '2026-09-22', descripcion: 'Citacion a las partes para el 25 de septiembre' }, HOY);
  await rechaza(conv.cerrar(s.repo, s.E, s.queja, { resultado: 'acuerdo_conciliatorio', fecha: '2026-09-25', descripcion: 'Acuerdo firmado por las partes' }, HOY), /medida de proteccion/);
  await conv.registrarMedida(s.repo, s.E, s.queja, { fecha: '2026-09-24', descripcion: 'Cambio de turno del presunto acosador' }, HOY);
  await conv.cerrar(s.repo, s.E, s.queja, { resultado: 'acuerdo_conciliatorio', fecha: '2026-09-25', descripcion: 'Acuerdo firmado por las partes' }, HOY);
  assert.deepEqual((await obligaciones(s.queja)).map((o) => o.estado), ['cumplido', 'cumplido']);
  await rechaza(s.db.query('UPDATE queja_actuacion SET descripcion = ? WHERE queja_id = ?', ['x', s.queja]), /inmutable/);
  await rechaza(conv.actuar(s.repo, s.E, s.queja, { tipo: 'seguimiento', descripcion: 'Seguimiento posterior' }, HOY), /cerrada/);
});

test('psicosocial: consolidado por grupos, vigencia segun nivel y reemplazo', async () => {
  const doc = await u.documentoVigente(s.repo, s.E, 'INFORME_PSICOSOCIAL', 'PSI-1');
  const d = {
    fecha_aplicacion: '2026-03-10', psicologo_nombre: 'Laura Gomez', psicologo_licencia: 'LSST-1234', poblacion: '12', evaluados: '11', nivel_general: 'alto',
    documento_id: String(doc), grupo: ['Bodega', 'Oficina'], grupo_evaluados: ['6', '5'], intralaboral: ['alto', 'medio'], extralaboral: ['bajo', 'bajo'], estres: ['alto', 'medio'],
  };
  await rechaza(conv.registrarPsicosocial(s.repo, s.E, { ...d, grupo_evaluados: ['9', '2'] }, HOY), /menos de 5/);
  await conv.registrarPsicosocial(s.repo, s.E, d, HOY);
  let p = await conv.psicosocial(s.repo, s.E);
  assert.equal(p.vigente.proxima, '2027-03-10');
  assert.equal(p.grupos.length, 2);
  await conv.registrarPsicosocial(s.repo, s.E, { ...d, fecha_aplicacion: '2026-09-01', nivel_general: 'medio' }, HOY);
  p = await conv.psicosocial(s.repo, s.E);
  assert.equal(p.vigente.proxima, '2028-09-01');
  assert.deepEqual(p.evaluaciones.map((e) => e.estado), ['vigente', 'reemplazada']);
  const [obs] = await s.db.query(
    "SELECT plazo_codigo, estado FROM obligacion_pendiente WHERE tenant_id = ? AND plazo_codigo LIKE 'PSICOSOCIAL%' ORDER BY id", [s.T.tenantId],
  );
  assert.deepEqual(obs.map((o) => [o.plazo_codigo, o.estado]), [['PSICOSOCIAL_ALTO', 'cumplido'], ['PSICOSOCIAL_MEDIO', 'en_termino']]);
});

test('consentimientos: web, verbal no sirve para sensibles, revocacion y append-only', async () => {
  const P = s.personas[1];
  const id = await cons.registrar(s.repo, P, { finalidad: 'salud_ocupacional', otorgado: '1', medio: 'web' });
  await rechaza(cons.registrar(s.repo, P, { finalidad: 'evaluacion_psicosocial', otorgado: '1', medio: 'verbal_registrado' }), /sensibles/);
  let m = await cons.matriz(s.repo, s.E);
  assert.equal(m.filas.find((f) => f.id === P).estados.salud_ocupacional.estado, 'vigente');
  await cons.revocar(s.repo, P, id);
  await rechaza(cons.revocar(s.repo, P, id), /ya fue revocada/);
  m = await cons.matriz(s.repo, s.E);
  assert.equal(m.filas.find((f) => f.id === P).estados.salud_ocupacional.estado, 'revocado');
  await rechaza(s.db.query('UPDATE consentimiento SET otorgado = 0 WHERE id = ?', [id]), /revocacion/);
});

test('http: reserva por rol, canal del trabajador y autorizaciones', async () => {
  await require('./_util').mismoDocumento(s, s.personas[2], s.T.usuarioId);
  await salud.vincularUsuario(s.repo, s.personas[2], s.T.usuarioId);
  const ir = await u.clienteHttp(s);
  let r = await ir('/convivencia');
  assert.equal(r.status, 200);
  assert.match(r.texto, /QC-2026-0001/);
  r = await ir(`/convivencia/quejas/${s.queja}`);
  assert.equal(r.status, 200);
  assert.doesNotMatch(r.texto, /Insultos/);

  r = await ir('/mis-registros?tab=denuncia');
  r = await ir('/mis-registros/queja', { _csrf: ir.token(r.texto), tipo_conducta: 'acoso_sexual', implicados: 'Companero de area', hechos: 'Comentarios de contenido sexual no deseados en reuniones' });
  assert.equal(r.status, 302);
  const [[q]] = await s.db.query("SELECT canal, quejoso_persona_id FROM queja_convivencia WHERE tenant_id = ? AND radicado = 'QC-2026-0002'", [s.T.tenantId]);
  assert.deepEqual([q.canal, Number(q.quejoso_persona_id)], ['electronico', s.personas[2]]);

  r = await ir('/mis-registros?tab=autorizaciones');
  assert.match(r.texto, /Gestion del SG-SST/);
  r = await ir('/mis-registros/autorizacion', { _csrf: ir.token(r.texto), finalidad: 'gestion_sst', otorgado: '1' });
  assert.equal(r.status, 302);
  r = await ir('/consentimientos');
  assert.equal(r.status, 200);
  assert.match(r.texto, /Autorizada/);
});
