const pool = require('./pool');

/**
 * Inserta un evento en auditoria_log (append-only).
 * @param {object} e { tenantId|null, actor:{id,nombre,ip,userAgent}, accion, entidad, entidadId, antes, despues }
 * @param {object} [ejecutor] conexion de una transaccion en curso
 */
async function registrarAuditoria(e, ejecutor = pool) {
  if (!e || !e.accion || !e.entidad) throw new Error('registrarAuditoria: accion y entidad son obligatorias');
  const actor = e.actor || {};
  await ejecutor.execute(
    `INSERT INTO auditoria_log
       (tenant_id, actor_id, actor_nombre, accion, entidad, entidad_id, antes, despues, ip, user_agent, ocurrido_en)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, INET6_ATON(?), ?, NOW(3))`,
    [
      e.tenantId ?? null,
      actor.id ?? null,
      String(actor.nombre || 'sistema').slice(0, 150),
      e.accion,
      e.entidad,
      e.entidadId ?? null,
      e.antes == null ? null : JSON.stringify(e.antes),
      e.despues == null ? null : JSON.stringify(e.despues),
      actor.ip || null,
      actor.userAgent ? String(actor.userAgent).slice(0, 255) : null,
    ],
  );
}

module.exports = { registrarAuditoria };
