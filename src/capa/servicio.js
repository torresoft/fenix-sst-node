// CAPA: una sola tabla de acciones correctivas y preventivas para todos los origenes.
const cuentas = require('../db/cuentas');
const { hoyBogota } = require('../fechas/calendario');
const { cerrarAccion } = require('../autoevaluacion/servicio');
const { error } = require('../comun/rutas');

const ORIGENES = {
  autoevaluacion: 'Autoevaluación', auditoria: 'Auditoría', evento: 'Evento', inspeccion: 'Inspección',
  revision_direccion: 'Revisión por la dirección', simulacro: 'Simulacro', contratista: 'Contratista', permiso: 'Permiso de trabajo',
};

/** Valida responsable y fecha limite de acciones nuevas. */
async function validarAsignacion(repo, { responsable_id: responsable, fecha_limite: limite }, hoy = hoyBogota()) {
  const uid = Number.parseInt(responsable, 10);
  if (!uid || !(await cuentas.usuarioEnTenant(repo.tenantId, uid))) throw error(422, 'Seleccione el responsable de la accion');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(limite || '')) || limite <= hoy) throw error(422, 'La fecha limite de la accion debe ser futura');
  return { responsable_id: uid, fecha_limite: limite };
}

async function crear(tx, empresaId, { origen, origenId, referencia, descripcion, tipo = 'correctiva', responsableId, fechaLimite }) {
  return tx.insertar('accion_mejora', {
    empresa_id: empresaId, origen, origen_id: origenId, referencia, descripcion: String(descripcion).slice(0, 1000), tipo,
    responsable_id: responsableId, fecha_limite: fechaLimite,
  });
}

/** Todas las acciones de la empresa, con nombre del responsable. */
async function listar(repo, empresaId, { estado = null } = {}) {
  const filas = await repo.consultar(
    `SELECT * FROM accion_mejora WHERE tenant_id = {tenant} AND empresa_id = ? ${estado ? 'AND estado = ?' : ''}
      ORDER BY FIELD(estado, 'abierta', 'cerrada', 'anulada'), fecha_limite, id`, estado ? [empresaId, estado] : [empresaId],
  );
  const nombres = await cuentas.nombresUsuarios([...new Set(filas.map((f) => f.responsable_id).filter(Boolean))]);
  return filas.map((f) => ({ ...f, responsable: nombres.get(f.responsable_id) || null }));
}

module.exports = { ORIGENES, validarAsignacion, crear, listar, cerrar: cerrarAccion };
