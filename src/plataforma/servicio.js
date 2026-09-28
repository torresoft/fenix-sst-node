// Consola de plataforma (superadmin): alta y suspension de clientes, soporte de cuentas.
const crypto = require('crypto');
const config = require('../config');
const cuentas = require('../db/cuentas');
const db = require('../db/plataforma');
const password = require('../auth/password');
const correo = require('../correo');
const r = require('../empresa/reglas');
const { error } = require('../comun/rutas');
const { RepositorioTenant } = require('../db/repositorio');
const empresa = require('../empresa/servicio');
const planes = require('../planes/servicio');

const ROL_ADMIN = 'admin_tenant';
// Los cambios de roles quedan en la auditoria del tenant a nombre del superadmin.
const repoDe = (tenantId, actor) => new RepositorioTenant(tenantId, actor);

const texto = (v, max) => { const s = String(v ?? '').trim(); return s ? s.slice(0, max) : null; };
const temporalNueva = () => crypto.randomBytes(9).toString('base64url');

async function avisarPorCorreo(usuarioId, temporal) {
  const u = await cuentas.obtenerUsuario(usuarioId);
  if (!u) return false;
  const html = await correo.renderizar('invitacion', { nombre: u.nombres, email: u.email, temporal });
  return (await correo.enviar({ para: u.email, asunto: 'Acceso a Fenix SST', html })).estado === 'enviado';
}

/** Cliente nuevo: tenant + primera empresa + administrador (nuevo o cuenta existente). */
// Solo planes activos para asignar; el actual se conserva aunque se haya inactivado.
async function validarPlan(codigo, actual = null) {
  const c = texto(codigo, 30);
  if (!c) return null;
  const p = await planes.porCodigo(c);
  if (!p || (p.estado !== 'activo' && c !== actual)) throw error(422, 'Plan invalido');
  return c;
}

async function crearCliente(d) {
  const plan = await validarPlan(d.plan);
  const nombre = texto(d.tenant, 200);
  const razonSocial = texto(d.razon_social, 200) || nombre;
  if (!nombre) throw error(422, 'Nombre del cliente obligatorio');
  const { nit, dv } = r.validarNit(d.nit, d.dv);
  const email = r.validarEmail(d.email, { obligatorio: true });
  const existente = await cuentas.buscarUsuarioPorEmail(email);
  let usuario = { email };
  if (!existente) {
    const doc = r.validarDocumento(d.tipo_documento, d.numero_documento);
    const nombres = texto(d.nombres, 100);
    const apellidos = texto(d.apellidos, 100);
    if (!nombres || !apellidos) throw error(422, 'Nombres y apellidos del administrador son obligatorios');
    const otros = await cuentas.buscarIdPorEmailODocumento(email, doc.tipo, doc.numero);
    if (otros.length) throw error(409, 'Ya existe una cuenta con ese documento y otro correo');
    usuario = { email, nombres, apellidos, tipoDocumento: doc.tipo, numeroDocumento: doc.numero };
  }
  const temporal = existente ? null : temporalNueva();
  const res = await cuentas.crearTenantConAdmin({
    tenant: { nombre, plan }, empresa: { nit, dv, razonSocial, numeroTrabajadores: 0 }, usuario,
    passwordHash: await password.hashear(temporal || temporalNueva()), regionDatos: config.regionDatos,
  });
  return { ...res, temporal, correoEnviado: await avisarPorCorreo(res.usuarioId, temporal) };
}

async function cliente(id) {
  const t = await db.obtenerTenant(id);
  if (!t) throw error(404, 'Cliente no encontrado');
  return t;
}

/** Ficha del cliente: empresas y usuarios con sus roles. */
async function fichaCliente(id, actor) {
  const t = await cliente(id);
  const repo = repoDe(id, actor);
  const [empresas, usuarios, plan, catalogoPlanes] = await Promise.all([
    repo.listar('empresa', {}, { orden: 'razon_social' }), cuentas.usuariosDelTenant(id), planes.estado(repo), planes.catalogo(),
  ]);
  return { t, empresas, usuarios, plan, planes: catalogoPlanes, admins: usuarios.filter((u) => u.roles.includes(ROL_ADMIN)).length };
}

async function editarCliente(id, d, actor) {
  const t = await cliente(id);
  const plan = await validarPlan(d.plan, t.plan);
  const nombre = texto(d.nombre, 200);
  if (!nombre) throw error(422, 'Nombre del cliente obligatorio');
  const region = String(d.region_datos || '').trim().toLowerCase();
  if (!/^[a-z0-9-]{2,40}$/.test(region)) throw error(422, 'Region de datos invalida (minusculas, numeros y guiones)');
  await db.actualizarTenant(id, { nombre, plan, region_datos: region }, actor);
}

const ESTADOS = ['activo', 'suspendido', 'retirado'];

/** Suspender es temporal; retirar (fin del contrato) exige motivo. Los datos se conservan: aplican retenciones legales. */
async function cambiarEstadoCliente(id, estado, actor, motivo = null) {
  if (!ESTADOS.includes(estado)) throw error(422, 'Estado invalido');
  const t = await cliente(id);
  if (t.estado === estado) throw error(409, `El cliente ya esta ${estado}`);
  const m = texto(motivo, 500);
  if (estado === 'retirado' && (!m || m.length < 10)) throw error(422, 'Explique el motivo del retiro (minimo 10 caracteres)');
  return db.cambiarEstadoTenant(id, estado, actor, m);
}

/** Da el rol de administrador: cuenta existente por correo, o nueva con clave temporal. */
async function asignarAdmin(tenantId, d, actor) {
  await cliente(tenantId);
  return empresa.invitar(repoDe(tenantId, actor), { ...d, roles: [ROL_ADMIN] }, actor.id, { omitirLimite: true });
}

/** Quita solo el rol de administrador; conserva los demas. guardarRoles impide dejar el cliente sin admin. */
async function quitarAdmin(tenantId, usuarioId, actor) {
  await cliente(tenantId);
  const repo = repoDe(tenantId, actor);
  const actuales = (await repo.listar('usuario_tenant', { usuario_id: usuarioId, estado: 'activo', empresa_id: null })).map((x) => x.rol_codigo);
  if (!actuales.includes(ROL_ADMIN)) throw error(409, 'El usuario no es administrador de este cliente');
  await empresa.guardarRoles(repo, usuarioId, actuales.filter((x) => x !== ROL_ADMIN), actor.id, { omitirLimite: true });
}

async function usuario(id) {
  const u = await db.obtenerUsuario(id);
  if (!u) throw error(404, 'Usuario no encontrado');
  return { u, accesos: await db.accesosDe(id) };
}

async function restablecerClave(id, actor) {
  const { u } = await usuario(id);
  if (u.estado !== 'activo') throw error(409, 'La cuenta esta inactiva');
  const temporal = temporalNueva();
  await db.restablecerClave(id, await password.hashear(temporal), actor);
  return { temporal, correoEnviado: await avisarPorCorreo(id, temporal) };
}

/** Lista de clientes con el estado de su plan (uso y alertas de cobertura). */
async function clientes(actor) {
  const lista = await db.tenants();
  const catalogoPlanes = await planes.catalogo();
  for (const t of lista) t.planEstado = await planes.estado(repoDe(t.id, actor));
  return { lista, planes: catalogoPlanes };
}

async function cambiarEstadoUsuario(id, activo, actor) {
  const { u } = await usuario(id);
  if (u.id === actor.id) throw error(409, 'No puede inactivar su propia cuenta');
  if (Number(u.es_superadmin) && !activo) throw error(409, 'Retire primero el perfil de superadministrador');
  await db.cambiarEstadoUsuario(id, activo ? 'activo' : 'inactivo', actor);
}

/** Se consulta en BD en cada peticion: retirar el perfil surte efecto sin esperar a que expire la sesion. */
async function esSuperadmin(id) {
  const u = await db.obtenerUsuario(id);
  return Boolean(u && u.estado === 'activo' && Number(u.es_superadmin) === 1);
}

module.exports = {
  crearCliente, cambiarEstadoCliente, fichaCliente, editarCliente, asignarAdmin, quitarAdmin, usuario, restablecerClave, cambiarEstadoUsuario, esSuperadmin,
  clientes, usuarios: db.usuarios, desbloquear: db.desbloquear,
};
