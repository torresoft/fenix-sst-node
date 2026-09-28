// Escritura de catalogos globales desde la consola de plataforma (superadmin).
// Toda fila editada o creada queda con modificado_manual = 1: la carga del seed ya no la pisa.
// No hay borrado: se inactiva. "Restaurar" devuelve la fila al control del seed.
const pool = require('./pool');
const g = require('./guardia-sql');
const { registrarAuditoria } = require('./auditoria');
const { estadosNormas, publicarBoletines } = require('./carga-catalogos');

async function columnas(tabla) {
  g.tablaGlobal(tabla);
  const [filas] = await pool.execute(
    `SELECT COLUMN_NAME, DATA_TYPE, COLUMN_TYPE, IS_NULLABLE, CHARACTER_MAXIMUM_LENGTH, COLUMN_KEY, COLUMN_DEFAULT, EXTRA
       FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? ORDER BY ORDINAL_POSITION`, [tabla],
  );
  return filas;
}

async function resumen(tablas) {
  const salida = [];
  for (const t of tablas) {
    g.tablaGlobal(t);
    const [[f]] = await pool.query(
      `SELECT COUNT(*) AS total, SUM(estado = 'activo') AS activos, SUM(modificado_manual = 1) AS manuales FROM ${t}`,
    );
    salida.push({ tabla: t, total: Number(f.total), activos: Number(f.activos || 0), manuales: Number(f.manuales || 0) });
  }
  return salida;
}

async function listar(tabla, clave, cols, q) {
  g.tablaGlobal(tabla);
  [clave, ...cols].forEach(g.identificador);
  const filtro = String(q || '').trim();
  const donde = filtro ? `WHERE ${[clave, ...cols].map((c) => `CAST(${c} AS CHAR) LIKE ?`).join(' OR ')}` : '';
  const [filas] = await pool.execute(
    `SELECT ${[...new Set([clave, ...cols])].join(', ')}, estado, modificado_manual FROM ${tabla} ${donde} ORDER BY ${clave} LIMIT 1000`,
    filtro ? Array(cols.length + 1).fill(`%${filtro}%`) : [],
  );
  return filas;
}

async function obtener(tabla, clave, valor, conn = pool) {
  g.tablaGlobal(tabla);
  g.identificador(clave);
  const [filas] = await conn.execute(`SELECT * FROM ${tabla} WHERE ${clave} = ?`, [valor]);
  return filas[0] || null;
}

// Cambios en norma generan boletin para los tenants (igual que la carga del seed).
async function enTransaccion(tabla, fn) {
  g.tablaGlobal(tabla);
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const antes = tabla === 'norma' ? await estadosNormas(conn) : null;
    const r = await fn(conn);
    const boletines = antes ? await publicarBoletines(conn, antes) : [];
    await conn.commit();
    return { ...r, boletines: boletines.length };
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

const conActor = (cols, actor) => (cols.some((c) => c.COLUMN_NAME === 'actualizado_por') ? { actualizado_por: actor.id } : {});

async function insertar(tabla, clave, fila, cols, actor) {
  return enTransaccion(tabla, async (conn) => {
    if (await obtener(tabla, clave, fila[clave], conn)) {
      const e = new Error(`Ya existe ${fila[clave]}`);
      e.status = 409;
      throw e;
    }
    const datos = { ...fila, estado: 'activo', modificado_manual: 1, ...conActor(cols, actor) };
    const nombres = Object.keys(datos).map(g.identificador);
    await conn.execute(`INSERT INTO ${tabla} (${nombres.join(', ')}) VALUES (${nombres.map(() => '?').join(', ')})`, Object.values(datos));
    await registrarAuditoria({ tenantId: null, actor, accion: 'crear', entidad: tabla, despues: fila }, conn);
    return {};
  });
}

async function actualizar(tabla, clave, valor, cambios, cols, actor) {
  return enTransaccion(tabla, async (conn) => {
    const datos = { ...cambios.despues, modificado_manual: 1, ...conActor(cols, actor) };
    const nombres = Object.keys(datos).map(g.identificador);
    await conn.execute(`UPDATE ${tabla} SET ${nombres.map((c) => `${c} = ?`).join(', ')} WHERE ${g.identificador(clave)} = ?`, [...Object.values(datos), valor]);
    await registrarAuditoria({ tenantId: null, actor, accion: 'editar', entidad: tabla, antes: { [clave]: valor, ...cambios.antes }, despues: cambios.despues }, conn);
    return {};
  });
}

async function cambiarEstado(tabla, clave, valor, estado, cols, actor) {
  return enTransaccion(tabla, async (conn) => {
    await conn.execute(`UPDATE ${tabla} SET estado = ?, modificado_manual = 1 WHERE ${g.identificador(clave)} = ?`, [estado, valor]);
    await registrarAuditoria({ tenantId: null, actor, accion: estado === 'activo' ? 'activar' : 'inactivar', entidad: tabla, despues: { [clave]: valor, estado } }, conn);
    return {};
  });
}

/** Devuelve la fila al seed: la proxima carga de catalogos la sobrescribe con el JSON. */
async function restaurar(tabla, clave, valor, actor) {
  await pool.execute(`UPDATE ${g.tablaGlobal(tabla)} SET modificado_manual = 0 WHERE ${g.identificador(clave)} = ?`, [valor]);
  await registrarAuditoria({ tenantId: null, actor, accion: 'restaurar_seed', entidad: tabla, despues: { [clave]: valor } });
}

module.exports = { columnas, resumen, listar, obtener, insertar, actualizar, cambiarEstado, restaurar };
