// Integracion: controles de seguridad (roles por empresa, revocacion de sesiones, firma, CSV).
const test = require('node:test');
const assert = require('node:assert/strict');
const cuentas = require('../src/db/cuentas');
const empresa = require('../src/empresa/servicio');
const { revalidar, huellaClave } = require('../src/middleware/auth');
const { preparar, cerrar, rechaza: rechazaCon } = require('./_util');

const s = {};
const rechaza = (p, re) => rechazaCon(assert, p, re);

test.before(async () => {
  Object.assign(s, await preparar('SEG'));
  s.E2 = await empresa.crearEmpresa(s.repo, { razon_social: 'Filial Seguridad SAS', nit: '900777123', numero_trabajadores: 5 });
  s.comite = await empresa.invitar(s.repo, {
    email: 'comite.seg@prueba.co', nombres: 'Carla', apellidos: 'Comite', tipo_documento: 'CC', numero_documento: '7001', roles: ['convivencia'],
  }, s.T.usuarioId, { empresaId: s.E });
});

test.after(() => cerrar(s));

test('convivencia: el rol vale solo en la empresa donde se asigno', async () => {
  const accesos = await cuentas.accesosDeUsuario(s.comite.usuarioId);
  assert.deepEqual(accesos.map((a) => a.empresa_id), [s.E], 'no ve la otra empresa del tenant');
  const enE2 = (await empresa.usuarios(s.repo, s.E2)).find((u) => u.id === s.comite.usuarioId);
  assert.deepEqual(enE2.roles, [], 'desde la otra empresa no aparece con el rol');
  // Guardar roles desde la otra empresa no toca la asignacion de la primera.
  await empresa.guardarRoles(s.repo, s.comite.usuarioId, ['copasst'], s.T.usuarioId, { empresaId: s.E2 });
  const porEmpresa = Object.fromEntries((await cuentas.accesosDeUsuario(s.comite.usuarioId)).map((a) => [a.empresa_id, a.roles]));
  assert.deepEqual(porEmpresa[s.E], ['convivencia', 'copasst']);
  assert.deepEqual(porEmpresa[s.E2], ['copasst']);
});

test('roles: sin autoasignar convivencia, sin vincular ajenos ni superadmin', async () => {
  await rechaza(empresa.guardarRoles(s.repo, s.T.usuarioId, ['admin_tenant', 'convivencia'], s.T.usuarioId, { empresaId: s.E }), /a si mismo/);
  await rechaza(empresa.guardarRoles(s.repo, s.T.usuarioId, ['admin_tenant', 'convivencia'], s.T.usuarioId), /desde la empresa/);
  const [r] = await s.db.query(
    "INSERT INTO usuario (email, nombres, apellidos, tipo_documento, numero_documento, password_hash) VALUES ('ajeno.seg@prueba.co', 'A', 'B', 'CC', '7002', 'x')",
  );
  await rechaza(empresa.guardarRoles(s.repo, r.insertId, ['gerente'], s.T.usuarioId, { empresaId: s.E }), /no pertenece/);
  await s.db.query('UPDATE usuario SET es_superadmin = 1 WHERE id = ?', [r.insertId]);
  await rechaza(empresa.invitar(s.repo, { email: 'ajeno.seg@prueba.co', roles: ['gerente'] }, s.T.usuarioId, { empresaId: s.E }), /superadministrador/);
});

test('personas: vinculo usuario-persona exige el mismo documento; certificado no se salta', async () => {
  const salud = require('../src/salud/servicio');
  const formacion = require('../src/formacion/servicio');
  await rechaza(salud.vincularUsuario(s.repo, s.personas[0], s.T.usuarioId), /no coincide/);
  await rechaza(formacion.registrarCompetencia(s.repo, s.E, s.personas[0], {
    tipo: 'CURSO_50H', fecha_obtencion: '2026-01-10', capacitacion_id: '1',
  }), /certificado/);
  await rechaza(formacion.registrarCompetencia(s.repo, s.E2, s.personas[0], { tipo: 'CURSO_50H', fecha_obtencion: '2026-01-10' }), /Persona invalida/);
});

// Sesion falsa con revalidacion vencida: revalidar() consulta la BD y decide.
function sesion(usuarioId, huella, empresaSesion) {
  const ses = { usuario: { id: usuarioId, huella }, empresa: empresaSesion, revalidadoEn: 0, destruida: false };
  ses.destroy = (cb) => { ses.destruida = true; cb(); };
  const req = { session: ses, xhr: true, get: () => '' };
  return { req, ses };
}
// Termina por next() (sesion vigente) o por la respuesta 401 (sesion cerrada).
const correr = ({ req }) => new Promise((ok, ko) => {
  const res = { clearCookie() {}, status() { return this; }, json: () => ok() };
  revalidar(req, res, (e) => (e ? ko(e) : ok()));
});

test('sesion: roles quitados, clave cambiada o usuario inactivo cierran o recortan la sesion', async () => {
  const [[u]] = await s.db.query('SELECT password_hash FROM usuario WHERE id = ?', [s.comite.usuarioId]);
  const vigente = huellaClave(u.password_hash);

  const a = sesion(s.comite.usuarioId, vigente, { tenantId: s.T.tenantId, id: s.E, roles: ['convivencia', 'copasst', 'admin_tenant'] });
  await correr(a);
  assert.equal(a.ses.destruida, false);
  assert.deepEqual(a.ses.empresa.roles, ['convivencia', 'copasst'], 'los roles salen de la BD, no de la sesion');

  await empresa.guardarRoles(s.repo, s.comite.usuarioId, [], s.T.usuarioId, { empresaId: s.E });
  const b = sesion(s.comite.usuarioId, vigente, { tenantId: s.T.tenantId, id: s.E, roles: ['convivencia'] });
  await correr(b);
  assert.equal(b.ses.empresa, undefined, 'sin roles pierde la empresa activa');

  const c = sesion(s.comite.usuarioId, 'huella-anterior', null);
  await correr(c);
  assert.equal(c.ses.destruida, true, 'clave cambiada: sesion cerrada');

  await s.db.query("UPDATE usuario SET estado = 'inactivo' WHERE id = ?", [s.comite.usuarioId]);
  const d = sesion(s.comite.usuarioId, vigente, null);
  await correr(d);
  assert.equal(d.ses.destruida, true, 'usuario inactivo: sesion cerrada');
});
