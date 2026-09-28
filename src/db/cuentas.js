// Acceso a datos de autenticacion. Es transversal a tenants por naturaleza (un usuario, varias
// empresas), por eso vive aqui y no en RepositorioTenant. Solo lo usa el modulo auth.
const pool = require('./pool');
const { registrarAuditoria } = require('./auditoria');

const MAX_INTENTOS = 5;
const MINUTOS_BLOQUEO = 15;

async function buscarUsuarioPorEmail(email) {
  const [filas] = await pool.execute(
    `SELECT id, email, nombres, apellidos, tipo_documento, numero_documento, password_hash,
            es_superadmin, intentos_fallidos, bloqueado_hasta > NOW() AS bloqueado,
            debe_cambiar_password, estado
       FROM usuario WHERE email = ?`,
    [String(email).trim().toLowerCase()],
  );
  return filas[0] || null;
}

// MariaDB evalua los SET en orden con valores ya actualizados: bloqueado_hasta va primero.
// Al bloquear se reinicia el contador para que tras el desbloqueo haya MAX_INTENTOS de nuevo.
async function registrarFalloLogin(usuarioId) {
  await pool.execute(
    `UPDATE usuario
        SET bloqueado_hasta = IF(intentos_fallidos + 1 >= ?, NOW() + INTERVAL ? MINUTE, bloqueado_hasta),
            intentos_fallidos = IF(intentos_fallidos + 1 >= ?, 0, intentos_fallidos + 1)
      WHERE id = ?`,
    [MAX_INTENTOS, MINUTOS_BLOQUEO, MAX_INTENTOS, usuarioId],
  );
}

async function registrarLoginExitoso(usuarioId) {
  await pool.execute(
    'UPDATE usuario SET intentos_fallidos = 0, bloqueado_hasta = NULL, ultimo_acceso = NOW() WHERE id = ?',
    [usuarioId],
  );
}

async function obtenerPasswordHash(usuarioId) {
  const [filas] = await pool.execute("SELECT password_hash FROM usuario WHERE id = ? AND estado = 'activo'", [usuarioId]);
  return filas[0] ? filas[0].password_hash : null;
}

async function cambiarPassword(usuarioId, passwordHash, actor) {
  await pool.execute('UPDATE usuario SET password_hash = ?, debe_cambiar_password = 0 WHERE id = ?', [passwordHash, usuarioId]);
  await registrarAuditoria({ tenantId: null, actor, accion: 'cambiar_password', entidad: 'usuario', entidadId: usuarioId });
}

/** Estado vigente del usuario para revalidar sesiones (null = inexistente). */
async function estadoUsuario(usuarioId) {
  const [filas] = await pool.execute(
    `SELECT estado, es_superadmin, debe_cambiar_password, password_hash, bloqueado_hasta > NOW() AS bloqueado
       FROM usuario WHERE id = ?`, [usuarioId],
  );
  return filas[0] || null;
}

/** Empresas activas a las que el usuario tiene acceso, con sus roles (del tenant o de esa empresa). */
async function accesosDeUsuario(usuarioId) {
  const [filas] = await pool.execute(
    `SELECT e.tenant_id, t.nombre AS tenant_nombre, e.id AS empresa_id, e.razon_social, e.nit,
            GROUP_CONCAT(DISTINCT ut.rol_codigo ORDER BY ut.rol_codigo) AS roles
       FROM usuario_tenant ut
       JOIN tenant t  ON t.id = ut.tenant_id AND t.estado = 'activo'
       JOIN empresa e ON e.tenant_id = ut.tenant_id AND e.estado = 'activa' AND (ut.empresa_id IS NULL OR ut.empresa_id = e.id)
      WHERE ut.usuario_id = ? AND ut.estado = 'activo'
      GROUP BY e.tenant_id, t.nombre, e.id, e.razon_social, e.nit
      ORDER BY e.razon_social`,
    [usuarioId],
  );
  return filas.map((f) => ({ ...f, roles: f.roles ? f.roles.split(',') : [] }));
}

const enLista = (n) => Array(n).fill('?').join(', ');

/** Usuarios activos de un tenant con alguno de los roles dados. */
async function usuariosConRol(tenantId, roles) {
  if (!roles.length) return [];
  const [filas] = await pool.execute(
    `SELECT u.id, u.email, CONCAT(u.nombres, ' ', u.apellidos) AS nombre
       FROM usuario_tenant ut JOIN usuario u ON u.id = ut.usuario_id
      WHERE ut.tenant_id = ? AND ut.estado = 'activo' AND u.estado = 'activo' AND ut.rol_codigo IN (${enLista(roles.length)})
      GROUP BY u.id, u.email, u.nombres, u.apellidos ORDER BY u.nombres`,
    [tenantId, ...roles],
  );
  return filas;
}

/** Usuarios activos de varios tenants (para asignar responsables). */
async function usuariosDeTenants(tenantIds) {
  if (!tenantIds.length) return [];
  const [filas] = await pool.execute(
    `SELECT ut.tenant_id, u.id, CONCAT(u.nombres, ' ', u.apellidos) AS nombre
       FROM usuario_tenant ut JOIN usuario u ON u.id = ut.usuario_id
      WHERE ut.tenant_id IN (${enLista(tenantIds.length)}) AND ut.estado = 'activo' AND u.estado = 'activo'
      GROUP BY ut.tenant_id, u.id, u.nombres, u.apellidos ORDER BY u.nombres`,
    tenantIds,
  );
  return filas;
}

async function usuarioEnTenant(tenantId, usuarioId) {
  const [filas] = await pool.execute(
    `SELECT 1 FROM usuario_tenant ut JOIN usuario u ON u.id = ut.usuario_id
      WHERE ut.tenant_id = ? AND ut.usuario_id = ? AND ut.estado = 'activo' AND u.estado = 'activo' LIMIT 1`,
    [tenantId, usuarioId],
  );
  return filas.length > 0;
}

async function nombresUsuarios(ids) {
  const unicos = [...new Set(ids.filter(Boolean))];
  if (!unicos.length) return new Map();
  const [filas] = await pool.execute(
    `SELECT id, CONCAT(nombres, ' ', apellidos) AS nombre FROM usuario WHERE id IN (${enLista(unicos.length)})`, unicos,
  );
  return new Map(filas.map((f) => [f.id, f.nombre]));
}

async function obtenerUsuario(id) {
  const [filas] = await pool.execute(
    "SELECT id, email, nombres, apellidos, tipo_documento, numero_documento FROM usuario WHERE id = ? AND estado = 'activo'", [id],
  );
  return filas[0] || null;
}

async function buscarIdPorEmailODocumento(email, tipoDocumento, numeroDocumento) {
  const [filas] = await pool.execute(
    'SELECT id, email, tipo_documento, numero_documento FROM usuario WHERE email = ? OR (tipo_documento = ? AND numero_documento = ?)',
    [email, tipoDocumento, numeroDocumento],
  );
  return filas;
}

/** Crea el usuario global con clave temporal (debe cambiarla al ingresar). */
async function crearUsuario({ email, nombres, apellidos, tipoDocumento, numeroDocumento }, passwordHash) {
  const [r] = await pool.execute(
    `INSERT INTO usuario (email, nombres, apellidos, tipo_documento, numero_documento, password_hash, debe_cambiar_password)
     VALUES (?, ?, ?, ?, ?, ?, 1)`,
    [email, nombres, apellidos, tipoDocumento, numeroDocumento, passwordHash],
  );
  return r.insertId;
}

/** Usuarios de un tenant con sus roles (activos e inactivos). Con empresaId, los roles por empresa solo de esa. */
async function usuariosDelTenant(tenantId, empresaId = null) {
  const [filas] = await pool.execute(
    `SELECT u.id, u.email, u.nombres, u.apellidos, u.tipo_documento, u.numero_documento, u.ultimo_acceso, u.estado AS estado_usuario,
            GROUP_CONCAT(DISTINCT CASE WHEN ut.estado = 'activo' AND (ut.empresa_id IS NULL OR ? IS NULL OR ut.empresa_id = ?) THEN ut.rol_codigo END
                         ORDER BY ut.rol_codigo) AS roles
       FROM usuario_tenant ut JOIN usuario u ON u.id = ut.usuario_id
      WHERE ut.tenant_id = ?
      GROUP BY u.id, u.email, u.nombres, u.apellidos, u.tipo_documento, u.numero_documento, u.ultimo_acceso, u.estado
      ORDER BY u.nombres, u.apellidos`,
    [empresaId, empresaId, tenantId],
  );
  return filas.map((f) => ({ ...f, roles: f.roles ? f.roles.split(',') : [] }));
}

/** Codigo del plan comercial del tenant (null = sin plan). */
async function planDeTenant(tenantId) {
  const [filas] = await pool.execute('SELECT plan FROM tenant WHERE id = ?', [tenantId]);
  return filas[0] ? filas[0].plan : null;
}

/** Tenants activos (job diario). */
async function tenantsActivos() {
  const [filas] = await pool.execute("SELECT id, nombre FROM tenant WHERE estado = 'activo' ORDER BY id");
  return filas;
}

/** Alta de tenant + empresa + usuario administrador (script de aprovisionamiento). */
async function crearTenantConAdmin({ tenant, empresa, usuario, passwordHash, regionDatos }) {
  const conn = await pool.getConnection();
  const actor = { id: null, nombre: 'aprovisionamiento' };
  try {
    await conn.beginTransaction();
    const [t] = await conn.execute('INSERT INTO tenant (nombre, region_datos, plan) VALUES (?, ?, ?)', [tenant.nombre, regionDatos, tenant.plan || null]);
    const tenantId = t.insertId;

    const [e] = await conn.execute(
      `INSERT INTO empresa (tenant_id, nit, digito_verificacion, razon_social, numero_trabajadores)
       VALUES (?, ?, ?, ?, ?)`,
      [tenantId, empresa.nit, empresa.dv || null, empresa.razonSocial, empresa.numeroTrabajadores || 0],
    );

    const email = usuario.email.trim().toLowerCase();
    const [existe] = await conn.execute('SELECT id FROM usuario WHERE email = ?', [email]);
    let usuarioId;
    if (existe.length) {
      usuarioId = existe[0].id;
    } else {
      const [u] = await conn.execute(
        `INSERT INTO usuario (email, nombres, apellidos, tipo_documento, numero_documento, password_hash, debe_cambiar_password)
         VALUES (?, ?, ?, ?, ?, ?, 1)`,
        [email, usuario.nombres, usuario.apellidos, usuario.tipoDocumento, usuario.numeroDocumento, passwordHash],
      );
      usuarioId = u.insertId;
    }
    await conn.execute(
      "INSERT INTO usuario_tenant (tenant_id, usuario_id, rol_codigo) VALUES (?, ?, 'admin_tenant')",
      [tenantId, usuarioId],
    );

    await registrarAuditoria({ tenantId, actor, accion: 'crear', entidad: 'tenant', entidadId: tenantId, despues: tenant }, conn);
    await registrarAuditoria({ tenantId, actor, accion: 'crear', entidad: 'empresa', entidadId: e.insertId, despues: empresa }, conn);
    await registrarAuditoria({
      tenantId, actor, accion: 'asignar_rol', entidad: 'usuario', entidadId: usuarioId,
      despues: { email, rol: 'admin_tenant', usuario_existente: existe.length > 0 },
    }, conn);

    await conn.commit();
    return { tenantId, empresaId: e.insertId, usuarioId, usuarioExistente: existe.length > 0 };
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

module.exports = {
  MAX_INTENTOS, buscarUsuarioPorEmail, registrarFalloLogin, registrarLoginExitoso,
  obtenerPasswordHash, cambiarPassword, accesosDeUsuario, estadoUsuario, crearTenantConAdmin, registrarAuditoria,
  usuariosConRol, usuariosDeTenants, usuarioEnTenant, nombresUsuarios, tenantsActivos, obtenerUsuario,
  buscarIdPorEmailODocumento, crearUsuario, usuariosDelTenant, planDeTenant,
};
