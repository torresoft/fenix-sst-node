// Upsert idempotente de catalogos globales desde los JSON semilla.
// - Filas con modificado_manual = 1 no se tocan (editadas o creadas desde la administracion).
// - Filas que ya no estan en el JSON se inactivan, no se borran.
const pool = require('./pool');
const g = require('./guardia-sql');
const { registrarAuditoria } = require('./auditoria');
const { diffNormas } = require('../matriz/boletin');

const serializar = (v) => (v !== null && typeof v === 'object' ? JSON.stringify(v) : v ?? null);
const llave = (fila, claves) => JSON.stringify(claves.map((c) => String(fila[c])));

async function upsert(conn, tabla, claves, filas) {
  g.tablaGlobal(tabla);
  claves.forEach(g.identificador);
  const resumen = { tabla, insertadas: 0, actualizadas: 0, sin_cambio: 0, protegidas: 0, inactivadas: 0 };

  const [existentes] = await conn.query(`SELECT ${claves.join(', ')}, modificado_manual, estado FROM ${tabla}`);
  const previas = new Map(existentes.map((f) => [llave(f, claves), f]));

  if (filas.length) {
    const cols = Object.keys({ ...filas[0], estado: 'activo' }).map(g.identificador);
    const noClave = cols.filter((c) => !claves.includes(c));
    const sql = `INSERT INTO ${tabla} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})
      ON DUPLICATE KEY UPDATE ${noClave.map((c) => `${c} = IF(modificado_manual = 1, ${c}, VALUES(${c}))`).join(', ')}`;

    for (const f of filas) {
      const fila = { ...f, estado: 'activo' };
      const previa = previas.get(llave(fila, claves));
      if (previa && previa.modificado_manual === 1) { resumen.protegidas++; continue; }
      const [res] = await conn.execute(sql, cols.map((c) => serializar(fila[c])));
      // mysql2 usa CLIENT_FOUND_ROWS: una fila existente sin cambios devuelve 1, cambiada devuelve 2.
      if (!previa) resumen.insertadas++;
      else if (res.affectedRows === 2) resumen.actualizadas++;
      else resumen.sin_cambio++;
    }
  }

  const presentes = new Set(filas.map((f) => llave(f, claves)));
  const where = claves.map((c) => `${c} = ?`).join(' AND ');
  for (const [k, previa] of previas) {
    if (presentes.has(k) || previa.modificado_manual === 1 || previa.estado === 'inactivo') continue;
    await conn.execute(`UPDATE ${tabla} SET estado = 'inactivo' WHERE ${where}`, claves.map((c) => previa[c]));
    resumen.inactivadas++;
  }
  return resumen;
}

async function estadosNormas(conn) {
  const [filas] = await conn.query('SELECT codigo, estado_vigencia FROM norma');
  return new Map(filas.map((f) => [f.codigo, f.estado_vigencia]));
}

// Normas nuevas o con cambio de estado -> boletin_normativo (se propaga a tenants en el job diario).
async function publicarBoletines(conn, antes) {
  const [despues] = await conn.query("SELECT codigo, estado_vigencia, objeto, derogada_por FROM norma WHERE estado = 'activo'");
  const boletines = diffNormas(antes, despues);
  for (const b of boletines) {
    await conn.execute(
      'INSERT INTO boletin_normativo (norma_codigo, tipo_cambio, estado_anterior, estado_nuevo, detalle) VALUES (?, ?, ?, ?, ?)',
      [b.norma_codigo, b.tipo_cambio, b.estado_anterior, b.estado_nuevo, b.detalle],
    );
  }
  return boletines;
}

/**
 * @param {Array<{tabla, claves, filas}>} lotes en orden de dependencia
 * @param {string} origen descripcion para la auditoria
 */
async function cargarCatalogos(lotes, origen) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const resumenes = [];
    let boletines = [];
    for (const l of lotes) {
      const antes = l.tabla === 'norma' ? await estadosNormas(conn) : null;
      resumenes.push(await upsert(conn, l.tabla, l.claves, l.filas));
      if (antes) boletines = await publicarBoletines(conn, antes);
    }
    resumenes.push({ tabla: 'boletin_normativo', insertadas: boletines.length });
    await registrarAuditoria({
      tenantId: null, actor: { nombre: 'seed-catalogos' }, accion: 'cargar_catalogo', entidad: 'catalogo',
      despues: { origen, resumenes },
    }, conn);
    await conn.commit();
    return resumenes;
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

async function cerrar() {
  await pool.end();
}

module.exports = { cargarCatalogos, cerrar, estadosNormas, publicarBoletines };
