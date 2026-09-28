// Administracion de la plataforma (solo superadmin): clientes (tenants) y cuentas de usuario globales.
// No expone datos de SST de ningun tenant: solo nombres, conteos, roles y estado de las cuentas.
const pool = require('./pool');
const { registrarAuditoria } = require('./auditoria');

async function tenants() {
  const [filas] = await pool.execute(
    `SELECT t.id, t.nombre, t.region_datos, t.plan, t.estado, t.creado_en,
            (SELECT COUNT(*) FROM empresa e WHERE e.tenant_id = t.id AND e.estado = 'activa') AS empresas,
            (SELECT COUNT(DISTINCT ut.usuario_id) FROM usuario_tenant ut WHERE ut.tenant_id = t.id AND ut.estado = 'activo') AS usuarios,
            (SELECT GROUP_CONCAT(e.razon_social ORDER BY e.razon_social SEPARATOR ', ') FROM empresa e WHERE e.tenant_id = t.id) AS razones
       FROM tenant t ORDER BY t.nombre`,
  );
  return filas;
}

async function obtenerTenant(id) {
  const [filas] = await pool.execute('SELECT id, nombre, region_datos, plan, estado, creado_en, actualizado_en FROM tenant WHERE id = ?', [id]);
  return filas[0] || null;
}

async function actualizarTenant(id, datos, actor) {
  const t = await obtenerTenant(id);
  if (!t) return null;
  await pool.execute('UPDATE tenant SET nombre = ?, plan = ?, region_datos = ? WHERE id = ?', [datos.nombre, datos.plan, datos.region_datos, id]);
  await registrarAuditoria({
    tenantId: id, actor, accion: 'editar', entidad: 'tenant', entidadId: id,
    antes: { nombre: t.nombre, plan: t.plan, region_datos: t.region_datos }, despues: datos,
  });
  return t;
}

// Borra las sesiones abiertas que cumplan la condicion sobre el JSON de la sesion.
async function cerrarSesiones(ruta, valor) {
  await pool.execute(`DELETE FROM sesion WHERE JSON_VALUE(data, '${ruta}') = ?`, [String(valor)]);
}

const ACCION_ESTADO = { activo: 'activar', suspendido: 'suspender', retirado: 'retirar' };

async function cambiarEstadoTenant(id, estado, actor, motivo = null) {
  const t = await obtenerTenant(id);
  if (!t) return null;
  await pool.execute('UPDATE tenant SET estado = ? WHERE id = ?', [estado, id]);
  await registrarAuditoria({
    tenantId: id, actor, accion: ACCION_ESTADO[estado], entidad: 'tenant', entidadId: id, antes: { estado: t.estado }, despues: { estado, motivo },
  });
  if (estado !== 'activo') await cerrarSesiones('$.empresa.tenantId', id);
  return t;
}

async function usuarios(q) {
  const filtro = String(q || '').trim();
  const like = `%${filtro}%`;
  const [filas] = await pool.execute(
    `SELECT u.id, u.email, u.nombres, u.apellidos, u.tipo_documento, u.numero_documento, u.es_superadmin, u.estado,
            u.ultimo_acceso, u.debe_cambiar_password, u.bloqueado_hasta > NOW() AS bloqueado, u.creado_en,
            (SELECT COUNT(DISTINCT ut.tenant_id) FROM usuario_tenant ut WHERE ut.usuario_id = u.id AND ut.estado = 'activo') AS tenants
       FROM usuario u
      WHERE (? = '' OR u.email LIKE ? OR CONCAT(u.nombres, ' ', u.apellidos) LIKE ? OR u.numero_documento LIKE ?)
      ORDER BY u.nombres, u.apellidos LIMIT 500`,
    [filtro, like, like, like],
  );
  return filas;
}

async function obtenerUsuario(id) {
  const [filas] = await pool.execute(
    `SELECT id, email, nombres, apellidos, tipo_documento, numero_documento, es_superadmin, estado, ultimo_acceso,
            debe_cambiar_password, intentos_fallidos, bloqueado_hasta > NOW() AS bloqueado, creado_en
       FROM usuario WHERE id = ?`, [id],
  );
  return filas[0] || null;
}

/** Tenants y roles del usuario (activos e inactivos). */
async function accesosDe(usuarioId) {
  const [filas] = await pool.execute(
    `SELECT t.id AS tenant_id, t.nombre, t.estado AS estado_tenant,
            GROUP_CONCAT(CASE WHEN ut.estado = 'activo' THEN ut.rol_codigo END ORDER BY ut.rol_codigo) AS roles
       FROM usuario_tenant ut JOIN tenant t ON t.id = ut.tenant_id
      WHERE ut.usuario_id = ? GROUP BY t.id, t.nombre, t.estado ORDER BY t.nombre`, [usuarioId],
  );
  return filas.map((f) => ({ ...f, roles: f.roles ? f.roles.split(',') : [] }));
}

async function desbloquear(id, actor) {
  await pool.execute('UPDATE usuario SET intentos_fallidos = 0, bloqueado_hasta = NULL WHERE id = ?', [id]);
  await registrarAuditoria({ tenantId: null, actor, accion: 'desbloquear', entidad: 'usuario', entidadId: id });
}

/** Clave temporal: obliga a cambiarla y cierra las sesiones abiertas del usuario. */
async function restablecerClave(id, passwordHash, actor) {
  await pool.execute(
    'UPDATE usuario SET password_hash = ?, debe_cambiar_password = 1, intentos_fallidos = 0, bloqueado_hasta = NULL WHERE id = ?',
    [passwordHash, id],
  );
  await registrarAuditoria({ tenantId: null, actor, accion: 'restablecer_password', entidad: 'usuario', entidadId: id });
  await cerrarSesiones('$.usuario.id', id);
}

async function cambiarEstadoUsuario(id, estado, actor) {
  await pool.execute('UPDATE usuario SET estado = ? WHERE id = ?', [estado, id]);
  await registrarAuditoria({ tenantId: null, actor, accion: estado === 'activo' ? 'activar' : 'inactivar', entidad: 'usuario', entidadId: id, despues: { estado } });
  if (estado !== 'activo') await cerrarSesiones('$.usuario.id', id);
}

module.exports = {
  tenants, obtenerTenant, actualizarTenant, cambiarEstadoTenant, usuarios, obtenerUsuario, accesosDe, desbloquear, restablecerClave, cambiarEstadoUsuario,
};
