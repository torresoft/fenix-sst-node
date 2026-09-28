// Integracion de planes comerciales: limites de altas y cobertura 0312 como aviso.
const test = require('node:test');
const assert = require('node:assert/strict');
const u = require('./_util');
const empresa = require('../src/empresa/servicio');
const plataforma = require('../src/plataforma/servicio');
const planes = require('../src/planes/servicio');

const s = {};
const rechaza = (p, re) => u.rechaza(assert, p, re);
const sa = () => ({ id: s.T.usuarioId, nombre: 'Superadmin' });
const nuevo = (n) => ({ email: `u${n}@plan.co`, nombres: 'Usuario', apellidos: `N${n}`, tipo_documento: 'CC', numero_documento: `7700${n}`, roles: ['auditor'] });

test.before(async () => { Object.assign(s, await u.preparar('PLAN')); });
test.after(() => u.cerrar(s));

test('asignar plan: solo codigos del catalogo', async () => {
  await rechaza(plataforma.editarCliente(s.T.tenantId, { nombre: 'Tenant PLAN', region_datos: 'co-bogota', plan: 'ORO' }, sa()), /Plan invalido/);
  await plataforma.editarCliente(s.T.tenantId, { nombre: 'Tenant PLAN', region_datos: 'co-bogota', plan: 'BASICO' }, sa());
  const e = await planes.estado(s.repo);
  assert.equal(e.plan.codigo, 'BASICO');
  assert.deepEqual([e.uso.empresas, e.uso.usuarios], [1, 1]);
});

test('limites: bloquea nuevas empresas y usuarios sin dejar cuentas huerfanas', async () => {
  await rechaza(empresa.crearEmpresa(s.repo, { razon_social: 'Segunda SAS', nit: '900555111' }), /permite 1 empresa/);
  await empresa.invitar(s.repo, nuevo(1), s.T.usuarioId);
  const r2 = await empresa.invitar(s.repo, nuevo(2), s.T.usuarioId);
  await rechaza(empresa.invitar(s.repo, nuevo(3), s.T.usuarioId), /permite 3 usuario/);
  const [[huerfana]] = await s.db.query("SELECT COUNT(*) AS n FROM usuario WHERE email = 'u3@plan.co'");
  assert.equal(huerfana.n, 0);
  await empresa.invitar(s.repo, { email: 'u2@plan.co', roles: ['gerente'] }, s.T.usuarioId);
  // Quitar todos los roles libera cupo; volver a darlos exige cupo.
  await empresa.guardarRoles(s.repo, r2.usuarioId, [], s.T.usuarioId);
  await empresa.invitar(s.repo, nuevo(3), s.T.usuarioId);
  await rechaza(empresa.guardarRoles(s.repo, r2.usuarioId, ['auditor'], s.T.usuarioId), /permite 3 usuario/);
  // El superadmin puede reasignar el administrador aunque el plan este lleno.
  await plataforma.asignarAdmin(s.T.tenantId, { email: 'u2@plan.co' }, sa());
  assert.equal((await planes.estado(s.repo)).uso.usuarios, 4);
});

test('cobertura: la empresa de 30 trabajadores (21 estandares) queda fuera del BASICO y se avisa', async () => {
  const e = await planes.estado(s.repo);
  assert.equal(e.fueraCobertura[0].conjunto_codigo, 'MED_21');
  assert.ok(e.alertas.some((x) => /4 usuarios/.test(x)));
  const f = await plataforma.fichaCliente(s.T.tenantId, sa());
  assert.equal(f.plan.alertas.length, 2);
});

test('http: el administrador ve el uso del plan y el aviso', async () => {
  const ir = await u.clienteHttp(s);
  let r = await ir('/');
  assert.match(r.texto, /ya no se ajusta/);
  r = await ir('/empresa/usuarios');
  assert.match(r.texto, /sin cupo para nuevos usuarios/);
  r = await ir('/empresa');
  assert.match(r.texto, /permite 1 empresa/);
});
