// Suscripciones y pagos de los clientes (plataforma). Saldos calculados en SQL sobre DECIMAL.
const pool = require('./pool');
const { registrarAuditoria } = require('./auditoria');

const PAGADO = `(SELECT COALESCE(SUM(p.valor), 0) FROM suscripcion_pago p WHERE p.suscripcion_id = s.id AND p.estado = 'registrado')`;
const COLUMNAS = `s.*, ${PAGADO} AS pagado, GREATEST(s.valor - ${PAGADO}, 0) AS saldo`;
// Actual de cada cliente: la mas reciente que no fue reemplazada por una renovacion.
const ACTUAL = "s.id = (SELECT MAX(x.id) FROM suscripcion x WHERE x.tenant_id = s.tenant_id AND x.estado <> 'renovada')";

async function actual(tenantId) {
  const [f] = await pool.execute(`SELECT ${COLUMNAS} FROM suscripcion s WHERE s.tenant_id = ? AND ${ACTUAL}`, [tenantId]);
  return f[0] || null;
}

async function historial(tenantId) {
  const [f] = await pool.execute(`SELECT ${COLUMNAS} FROM suscripcion s WHERE s.tenant_id = ? ORDER BY s.id DESC`, [tenantId]);
  return f;
}

async function pagos(tenantId) {
  const [f] = await pool.execute(
    `SELECT p.*, s.plan_codigo, s.fecha_inicio, s.fecha_fin FROM suscripcion_pago p JOIN suscripcion s ON s.id = p.suscripcion_id
      WHERE s.tenant_id = ? ORDER BY p.fecha DESC, p.id DESC`, [tenantId],
  );
  return f;
}

async function obtener(id) {
  const [f] = await pool.execute(`SELECT ${COLUMNAS} FROM suscripcion s WHERE s.id = ?`, [id]);
  return f[0] || null;
}

async function obtenerPago(id) {
  const [f] = await pool.execute('SELECT p.*, s.tenant_id FROM suscripcion_pago p JOIN suscripcion s ON s.id = p.suscripcion_id WHERE p.id = ?', [id]);
  return f[0] || null;
}

async function enTransaccion(fn) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const r = await fn(conn);
    await conn.commit();
    return r;
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

/** Nueva suscripcion (alta o renovacion). La anterior queda 'renovada' y el plan del cliente se sincroniza. */
async function crear(tenantId, d, actor, anteriorId = null) {
  return enTransaccion(async (conn) => {
    if (anteriorId) await conn.execute("UPDATE suscripcion SET estado = 'renovada' WHERE id = ?", [anteriorId]);
    const [r] = await conn.execute(
      `INSERT INTO suscripcion (tenant_id, plan_codigo, periodicidad, fecha_inicio, fecha_fin, valor, es_prueba, observacion, creado_por)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [tenantId, d.plan_codigo, d.periodicidad, d.fecha_inicio, d.fecha_fin, d.valor, d.es_prueba, d.observacion, actor.id],
    );
    await conn.execute('UPDATE tenant SET plan = ? WHERE id = ?', [d.plan_codigo, tenantId]);
    await registrarAuditoria({
      tenantId, actor, accion: anteriorId ? 'renovar' : 'crear', entidad: 'suscripcion', entidadId: r.insertId, despues: { ...d, anterior: anteriorId },
    }, conn);
    return r.insertId;
  });
}

async function cambiarEstado(id, estado, motivo, actor) {
  const s = await obtener(id);
  await pool.execute('UPDATE suscripcion SET estado = ?, motivo_estado = ? WHERE id = ?', [estado, motivo, id]);
  await registrarAuditoria({ tenantId: s.tenant_id, actor, accion: estado === 'cancelada' ? 'cancelar' : estado, entidad: 'suscripcion', entidadId: id, antes: { estado: s.estado }, despues: { estado, motivo } });
}

async function marcarSuspendida(id, hoy) {
  await pool.execute('UPDATE suscripcion SET suspendido_en = ? WHERE id = ?', [hoy, id]);
}

async function registrarPago(suscripcionId, d, actor) {
  const s = await obtener(suscripcionId);
  const [r] = await pool.execute(
    'INSERT INTO suscripcion_pago (suscripcion_id, fecha, valor, medio, referencia, observacion, creado_por) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [suscripcionId, d.fecha, d.valor, d.medio, d.referencia, d.observacion, actor.id],
  );
  await registrarAuditoria({ tenantId: s.tenant_id, actor, accion: 'registrar_pago', entidad: 'suscripcion_pago', entidadId: r.insertId, despues: { suscripcion_id: suscripcionId, ...d } });
  return r.insertId;
}

async function anularPago(id, motivo, actor) {
  const p = await obtenerPago(id);
  await pool.execute("UPDATE suscripcion_pago SET estado = 'anulado', motivo_anulacion = ? WHERE id = ?", [motivo, id]);
  await registrarAuditoria({ tenantId: p.tenant_id, actor, accion: 'anular', entidad: 'suscripcion_pago', entidadId: id, antes: { valor: p.valor, fecha: p.fecha }, despues: { motivo } });
}

/** Tablero: suscripcion actual de cada cliente (o ninguna) y cifras de la cartera. */
async function tablero(desdeMes, hastaMes) {
  const [filas] = await pool.execute(
    `SELECT t.id AS tenant_id, t.nombre, t.estado AS tenant_estado, s.id, s.plan_codigo, s.periodicidad, s.fecha_inicio, s.fecha_fin,
            s.valor, s.es_prueba, s.estado, s.suspendido_en, ${PAGADO} AS pagado, GREATEST(s.valor - ${PAGADO}, 0) AS saldo
       FROM tenant t LEFT JOIN suscripcion s ON s.tenant_id = t.id AND ${ACTUAL}
      WHERE t.estado <> 'retirado' ORDER BY t.nombre`,
  );
  const [[cifras]] = await pool.execute(
    `SELECT (SELECT COALESCE(SUM(valor), 0) FROM suscripcion_pago WHERE estado = 'registrado' AND fecha BETWEEN ? AND ?) AS recaudo_mes,
            (SELECT COALESCE(SUM(GREATEST(s.valor - ${PAGADO}, 0)), 0) FROM suscripcion s) AS cartera`,
    [desdeMes, hastaMes],
  );
  return { filas, cifras };
}

/** Suscripciones actuales de clientes no retirados, para el job diario. */
async function paraJob() {
  const [f] = await pool.execute(
    `SELECT s.*, t.nombre AS tenant_nombre, t.estado AS tenant_estado FROM suscripcion s JOIN tenant t ON t.id = s.tenant_id
      WHERE t.estado <> 'retirado' AND s.estado IN ('vigente','vencida','cancelada') AND ${ACTUAL}`,
  );
  return f;
}

module.exports = { actual, historial, pagos, obtener, obtenerPago, crear, cambiarEstado, marcarSuspendida, registrarPago, anularPago, tablero, paraJob };
