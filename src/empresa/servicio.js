// M01: datos del empleador, centros de trabajo, perfil de aplicabilidad y usuarios del tenant.
// De aqui sale la aplicabilidad del resto: estandares minimos, matriz legal y modulos activos.
const crypto = require('crypto');
const { consultarCatalogo } = require('../db/global');
const cuentas = require('../db/cuentas');
const password = require('../auth/password');
const correo = require('../correo');
const autoevaluacion = require('../autoevaluacion/servicio');
const matriz = require('../matriz/servicio');
const r = require('./reglas');
const planes = require('../planes/servicio');
const { modulos } = require('../../data/modulos.json');

const texto = (v, max) => { const s = String(v ?? '').trim(); return s ? s.slice(0, max) : null; };

function error(status, mensaje) {
  const e = new Error(mensaje);
  e.status = status;
  return e;
}

async function empresaDelTenant(repo, empresaId) {
  const e = await repo.obtener('empresa', empresaId);
  if (!e) throw error(404, 'Empresa no encontrada');
  return e;
}

async function resumen(repo, empresaId) {
  const [clasificacion, perfil, centros, clases, [vinc]] = await Promise.all([
    autoevaluacion.verificarClasificacion(repo, empresaId),
    matriz.perfil(repo, empresaId),
    repo.consultar(
      `SELECT c.*, cr.nivel FROM centro_trabajo c JOIN clase_riesgo cr ON cr.clase = c.clase_riesgo
        WHERE c.tenant_id = {tenant} AND c.empresa_id = ? ORDER BY c.estado, c.nombre`, [empresaId],
    ),
    consultarCatalogo("SELECT clase, nivel, descripcion, ejemplos FROM clase_riesgo WHERE estado = 'activo' ORDER BY nivel"),
    repo.consultar(
      `SELECT COUNT(*) AS total, SUM(tipo = 'dependiente') AS dependientes FROM vinculacion
        WHERE tenant_id = {tenant} AND empresa_id = ? AND estado = 'activa'`, [empresaId],
    ),
  ]);
  return {
    empresa: perfil.empresa, clasificacion, perfil, centros, clases,
    modulos: r.modulosActivos(modulos, perfil.empresa, perfil.activos),
    vinculaciones: { total: Number(vinc.total), dependientes: Number(vinc.dependientes || 0) },
  };
}

function datosEmpresa(d) {
  const { nit, dv } = r.validarNit(d.nit, d.digito_verificacion);
  const razon = texto(d.razon_social, 200);
  if (!razon || razon.length < 3) throw r.errorValidacion('La razon social es obligatoria');
  const ciiu = texto(d.ciiu_codigo, 10);
  if (ciiu && !/^\d{4}$/.test(ciiu)) throw r.errorValidacion('El codigo CIIU tiene 4 digitos');
  const repDoc = texto(d.representante_legal_documento, 30);
  return {
    nit, digito_verificacion: dv, razon_social: razon, ciiu_codigo: ciiu, actividad_economica: texto(d.actividad_economica, 255),
    arl: texto(d.arl, 100), direccion: texto(d.direccion, 200), municipio_divipola: r.validarDivipola(d.municipio_divipola),
    telefono: texto(d.telefono, 30), email: r.validarEmail(d.email),
    representante_legal_nombre: texto(d.representante_legal_nombre, 150), representante_legal_documento: repDoc,
    representante_legal_email: r.validarEmail(d.representante_legal_email),
    numero_trabajadores: r.entero(d.numero_trabajadores, { min: 1, max: 1000000, nombre: 'Numero de trabajadores' }),
    es_agropecuaria: d.es_agropecuaria === '1' || d.es_agropecuaria === true ? 1 : 0,
    numero_vehiculos: r.entero(d.numero_vehiculos || 0, { max: 100000, nombre: 'Numero de vehiculos' }),
    numero_conductores: r.entero(d.numero_conductores || 0, { max: 100000, nombre: 'Numero de conductores' }),
    contrata_terceros: d.contrata_terceros === '1' || d.contrata_terceros === true ? 1 : 0,
  };
}

async function nitLibre(repo, nit, excepto = null) {
  const [otra] = await repo.listar('empresa', { nit });
  if (otra && otra.id !== excepto) throw error(409, 'Ya existe una empresa con ese NIT en esta cuenta');
}

/** Actualiza datos del empleador y reevalua la clasificacion 0312 (avisa si cambia el conjunto). */
async function actualizarEmpresa(repo, empresaId, d) {
  await empresaDelTenant(repo, empresaId);
  const fila = datosEmpresa(d);
  await nitLibre(repo, fila.nit, empresaId);
  await repo.actualizar('empresa', empresaId, fila);
  return autoevaluacion.verificarClasificacion(repo, empresaId);
}

async function crearEmpresa(repo, d) {
  await planes.verificarNuevaEmpresa(repo);
  const fila = datosEmpresa(d);
  await nitLibre(repo, fila.nit);
  return repo.insertar('empresa', fila);
}

/** Toma como numero de trabajadores las vinculaciones activas registradas. */
async function sincronizarTrabajadores(repo, empresaId) {
  const [v] = await repo.consultar(
    "SELECT COUNT(*) AS n FROM vinculacion WHERE tenant_id = {tenant} AND empresa_id = ? AND estado = 'activa'", [empresaId],
  );
  const n = Number(v.n);
  if (n < 1) throw error(422, 'No hay vinculaciones activas registradas');
  await repo.actualizar('empresa', empresaId, { numero_trabajadores: n }, { accion: 'sincronizar_trabajadores' });
  return autoevaluacion.verificarClasificacion(repo, empresaId);
}

// ---------- Centros de trabajo

async function datosCentro(d) {
  const nombre = texto(d.nombre, 150);
  if (!nombre || nombre.length < 3) throw r.errorValidacion('Nombre del centro de trabajo obligatorio');
  const [clase] = await consultarCatalogo("SELECT clase FROM clase_riesgo WHERE clase = ? AND estado = 'activo'", [String(d.clase_riesgo || '')]);
  if (!clase) throw r.errorValidacion('Clase de riesgo invalida');
  return {
    nombre, clase_riesgo: clase.clase, direccion: texto(d.direccion, 200), municipio_divipola: r.validarDivipola(d.municipio_divipola),
    numero_trabajadores: r.entero(d.numero_trabajadores || 0, { max: 1000000, nombre: 'Trabajadores del centro' }),
  };
}

async function agregarCentro(repo, empresaId, d) {
  await empresaDelTenant(repo, empresaId);
  await repo.insertar('centro_trabajo', { empresa_id: empresaId, ...(await datosCentro(d)) });
  return autoevaluacion.verificarClasificacion(repo, empresaId);
}

async function centroDeEmpresa(repo, empresaId, id) {
  const c = await repo.obtener('centro_trabajo', id);
  if (!c || c.empresa_id !== empresaId) throw error(404, 'Centro de trabajo no encontrado');
  return c;
}

async function editarCentro(repo, empresaId, id, d) {
  await centroDeEmpresa(repo, empresaId, id);
  await repo.actualizar('centro_trabajo', id, await datosCentro(d));
  return autoevaluacion.verificarClasificacion(repo, empresaId);
}

async function cambiarEstadoCentro(repo, empresaId, id, activo) {
  const c = await centroDeEmpresa(repo, empresaId, id);
  if (!activo) {
    const activos = await repo.listar('centro_trabajo', { empresa_id: empresaId, estado: 'activo' });
    if (activos.length === 1 && activos[0].id === id) throw error(409, 'Debe quedar al menos un centro de trabajo activo');
    const [enUso] = await repo.consultar(
      "SELECT COUNT(*) AS n FROM vinculacion WHERE tenant_id = {tenant} AND centro_trabajo_id = ? AND estado = 'activa'", [id],
    );
    if (Number(enUso.n)) throw error(409, `El centro tiene ${enUso.n} vinculacion(es) activa(s): reasignelas antes de inactivarlo`);
  }
  if (c.estado !== (activo ? 'activo' : 'inactivo')) {
    await repo.actualizar('centro_trabajo', id, { estado: activo ? 'activo' : 'inactivo' }, { accion: activo ? 'activar' : 'inactivar' });
  }
  return autoevaluacion.verificarClasificacion(repo, empresaId);
}

// ---------- Usuarios del tenant

const ROL_ADMIN = 'admin_tenant';
// Roles amarrados a una empresa (no al tenant): el comite de convivencia es de cada empleador.
const ROLES_POR_EMPRESA = new Set(['convivencia']);
const alcance = (rol, empresaId) => (ROLES_POR_EMPRESA.has(rol) ? empresaId : null);
// Filas de rol que se ven y gestionan desde una empresa: las del tenant y las de esa empresa.
const enAlcance = (f, empresaId) => f.empresa_id == null || f.empresa_id === empresaId;

async function rolesValidos() {
  return consultarCatalogo("SELECT codigo, nombre, descripcion FROM rol WHERE estado = 'activo' ORDER BY nombre");
}

async function usuarios(repo, empresaId) {
  return cuentas.usuariosDelTenant(repo.tenantId, empresaId);
}

/** Deja al usuario exactamente con esos roles en el tenant (activa, reactiva o inactiva filas). */
/** opciones.omitirLimite: el superadmin puede reasignar administradores aunque el plan este lleno. */
/** opciones.alta: solo invitar() vincula un usuario que aun no pertenece al tenant. */
/** opciones.empresaId: empresa activa, a la que quedan amarrados los ROLES_POR_EMPRESA. */
async function guardarRoles(repo, usuarioId, roles, actorId, opciones = {}) {
  const validos = new Set((await rolesValidos()).map((x) => x.codigo));
  const deseados = [...new Set([].concat(roles || []).map(String))];
  for (const x of deseados) if (!validos.has(x)) throw error(422, `Rol invalido: ${x}`);
  if (usuarioId === actorId && !deseados.includes(ROL_ADMIN)) throw error(409, 'No puede quitarse a si mismo el rol de administrador');
  const u = await cuentas.estadoUsuario(usuarioId);
  if (!u) throw error(404, 'Usuario no pertenece a esta empresa');
  // Separacion de funciones: la consola de plataforma no da acceso a datos SST de los clientes.
  if (deseados.length && Number(u.es_superadmin) === 1) throw error(409, 'Una cuenta de superadministrador no puede tener roles en un cliente');
  if (deseados.length && !opciones.omitirLimite) await planes.verificarNuevoUsuario(repo, usuarioId);
  const empresaId = opciones.empresaId || null;
  if (!empresaId && deseados.some((x) => ROLES_POR_EMPRESA.has(x))) throw error(422, 'El rol de convivencia se asigna desde la empresa');

  await repo.transaccion(async (tx) => {
    // Bloquea los administradores activos: dos quitas simultaneas no dejan el tenant sin admin.
    await tx.listar('usuario_tenant', { rol_codigo: ROL_ADMIN, estado: 'activo' }, { bloquear: true });
    const actuales = await tx.listar('usuario_tenant', { usuario_id: usuarioId }, { bloquear: true });
    if (!actuales.length && !opciones.alta) throw error(404, 'Usuario no pertenece a esta empresa');
    // Los roles por empresa de otras empresas no se tocan desde esta.
    const propias = actuales.filter((f) => (f.empresa_id ?? null) === alcance(f.rol_codigo, empresaId));
    const porRol = new Map(propias.map((f) => [f.rol_codigo, f]));
    const nuevos = deseados.filter((rol) => !porRol.has(rol) || porRol.get(rol).estado !== 'activo');
    // Separacion de funciones: nadie se da a si mismo acceso a las quejas con reserva.
    if (usuarioId === actorId && nuevos.some((x) => ROLES_POR_EMPRESA.has(x))) throw error(409, 'No puede asignarse a si mismo el rol del comite de convivencia');
    for (const rol of nuevos) {
      const f = porRol.get(rol);
      if (!f) await tx.insertar('usuario_tenant', { usuario_id: usuarioId, empresa_id: alcance(rol, empresaId), rol_codigo: rol });
      else await tx.actualizar('usuario_tenant', f.id, { estado: 'activo' }, { accion: 'asignar_rol' });
    }
    for (const f of propias) {
      if (f.estado === 'activo' && !deseados.includes(f.rol_codigo)) await tx.actualizar('usuario_tenant', f.id, { estado: 'inactivo' }, { accion: 'quitar_rol' });
    }
    const admins = await tx.listar('usuario_tenant', { rol_codigo: ROL_ADMIN, estado: 'activo' }, { bloquear: true });
    if (admins.length < 1) throw error(409, 'La empresa debe conservar al menos un administrador');
  });
}

/**
 * Invita a un usuario: si el correo ya existe (p. ej. un consultor) solo se le asignan los roles;
 * si no, se crea con clave temporal que debe cambiar al ingresar.
 */
async function invitar(repo, d, actorId, opciones = {}) {
  const email = r.validarEmail(d.email, { obligatorio: true });
  const roles = [].concat(d.roles || []).filter(Boolean);
  if (!roles.length) throw error(422, 'Asigne al menos un rol');
  const existentes = await cuentas.buscarIdPorEmailODocumento(email, String(d.tipo_documento || '').toUpperCase(), String(d.numero_documento || '').trim());
  const porEmail = existentes.find((u) => u.email === email);
  // Antes de crear la cuenta global: si el plan esta lleno no queda una cuenta huerfana.
  if (!opciones.omitirLimite) await planes.verificarNuevoUsuario(repo, porEmail ? porEmail.id : null);
  let usuarioId;
  let temporal = null;
  if (porEmail) {
    usuarioId = porEmail.id;
  } else {
    const doc = r.validarDocumento(d.tipo_documento, d.numero_documento);
    if (existentes.length) throw error(409, 'Ya existe un usuario con ese documento y otro correo');
    const nombres = texto(d.nombres, 100);
    const apellidos = texto(d.apellidos, 100);
    if (!nombres || !apellidos) throw error(422, 'Nombres y apellidos son obligatorios para un usuario nuevo');
    temporal = crypto.randomBytes(9).toString('base64url');
    usuarioId = await cuentas.crearUsuario({ email, nombres, apellidos, tipoDocumento: doc.tipo, numeroDocumento: doc.numero }, await password.hashear(temporal));
    await repo.auditar('crear', 'usuario', usuarioId, null, { email, nombres, apellidos });
  }
  const yaEsta = (await repo.listar('usuario_tenant', { usuario_id: usuarioId, estado: 'activo' })).filter((f) => enAlcance(f, opciones.empresaId || null));
  await guardarRoles(repo, usuarioId, [...new Set([...yaEsta.map((f) => f.rol_codigo), ...roles])], actorId, { ...opciones, alta: true });

  const u = await cuentas.obtenerUsuario(usuarioId);
  const html = await correo.renderizar('invitacion', { nombre: u.nombres, email, temporal });
  const envio = await correo.enviar({ para: email, asunto: 'Acceso a Fenix SST', html });
  return { usuarioId, existente: Boolean(porEmail), temporal, correoEnviado: envio.estado === 'enviado' };
}

module.exports = {
  resumen, actualizarEmpresa, crearEmpresa, sincronizarTrabajadores, agregarCentro, editarCentro, cambiarEstadoCentro,
  rolesValidos, usuarios, guardarRoles, invitar,
};
