// Lectura de catalogos globales (sin tenant). La escritura va por scripts/cargar-catalogos.js
// y, mas adelante, por la administracion de superadmin.
const pool = require('./pool');
const g = require('./guardia-sql');

async function consultarCatalogo(sql, params = []) {
  const [filas] = await pool.execute(g.prepararConsultaGlobal(sql), params);
  return filas;
}

async function festivosActivos() {
  const filas = await consultarCatalogo("SELECT fecha FROM festivo WHERE estado = 'activo' ORDER BY fecha");
  return filas.map((f) => f.fecha);
}

module.exports = { consultarCatalogo, festivosActivos };
