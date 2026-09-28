// M14: inspecciones planeadas con hallazgos; los de nivel medio o alto generan accion CAPA.
const { hoyBogota } = require('../fechas/calendario');
const capa = require('../capa/servicio');
const { error } = require('../comun/rutas');

const TIPOS = ['locativa', 'equipos', 'herramientas', 'epp', 'emergencias', 'orden_aseo', 'otra'];
const NIVELES = ['bajo', 'medio', 'alto'];
const fecha = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) ? String(v) : null);
const texto = (v, max) => { const s = String(v ?? '').trim(); return s ? s.slice(0, max) : null; };
const lista = (v) => (Array.isArray(v) ? v : v == null ? [] : [v]);

async function inspeccion(repo, empresaId, id) {
  const i = await repo.obtener('inspeccion', id);
  if (!i || i.empresa_id !== empresaId) throw error(404, 'Inspeccion no encontrada');
  return i;
}

async function programar(repo, empresaId, d) {
  if (!TIPOS.includes(d.tipo)) throw error(422, 'Tipo de inspeccion invalido');
  const area = texto(d.area, 150);
  const f = fecha(d.fecha_programada);
  if (!area || !f) throw error(422, 'Area y fecha programada son obligatorias');
  let centro = null;
  if (d.centro_trabajo_id) {
    const c = await repo.obtener('centro_trabajo', Number.parseInt(d.centro_trabajo_id, 10));
    if (!c || c.empresa_id !== empresaId) throw error(422, 'Centro de trabajo invalido');
    centro = c.id;
  }
  return repo.insertar('inspeccion', {
    empresa_id: empresaId, centro_trabajo_id: centro, tipo: d.tipo, area, fecha_programada: f, con_copasst: d.con_copasst === '1' ? 1 : 0,
  });
}

/** Hallazgos desde el formulario (arreglos paralelos). */
function hallazgos(d) {
  const desc = lista(d.hallazgo_descripcion);
  const nivel = lista(d.hallazgo_nivel);
  const h = desc.map((x, i) => ({ descripcion: texto(x, 1000), nivel: nivel[i] })).filter((x) => x.descripcion);
  if (h.length > 200) throw error(422, 'Maximo 200 hallazgos por inspeccion');
  return h;
}

async function realizar(repo, empresaId, id, d, hoy = hoyBogota()) {
  const i = await inspeccion(repo, empresaId, id);
  if (i.estado !== 'programada') throw error(409, 'La inspeccion ya fue realizada o anulada');
  const f = fecha(d.fecha_realizada) || hoy;
  if (f > hoy) throw error(422, 'La fecha de realizacion no puede ser futura');
  const inspector = texto(d.inspector, 150);
  if (!inspector) throw error(422, 'Indique quien realizo la inspeccion');
  const hs = hallazgos(d);
  if (hs.some((h) => !NIVELES.includes(h.nivel))) throw error(422, 'Nivel de hallazgo invalido');
  const conAccion = hs.filter((h) => h.nivel !== 'bajo');
  const asignacion = conAccion.length ? await capa.validarAsignacion(repo, d, hoy) : null;
  let doc = null;
  if (d.documento_id) {
    doc = await repo.obtener('documento_sst', Number.parseInt(d.documento_id, 10));
    if (!doc || doc.empresa_id !== empresaId || doc.tipo_documental !== 'REG_INSPECCION' || doc.estado !== 'vigente') throw error(422, 'Registro de inspeccion invalido');
  }
  await repo.transaccion(async (tx) => {
    let n = 0;
    for (const h of hs) {
      n += 1;
      const hid = await tx.insertar('inspeccion_hallazgo', { inspeccion_id: id, numero: n, descripcion: h.descripcion, nivel: h.nivel });
      if (h.nivel !== 'bajo') {
        const accionId = await capa.crear(tx, empresaId, {
          origen: 'inspeccion', origenId: id, referencia: `H${n}`, descripcion: `${i.area}: ${h.descripcion}`,
          tipo: 'correctiva', responsableId: asignacion.responsable_id, fechaLimite: asignacion.fecha_limite,
        });
        await tx.actualizar('inspeccion_hallazgo', hid, { accion_mejora_id: accionId }, { auditar: false });
      }
    }
    await tx.actualizar('inspeccion', id, {
      estado: 'realizada', fecha_realizada: f, inspector, resumen: texto(d.resumen, 5000), documento_id: doc ? doc.id : null,
    }, { accion: 'realizar' });
  });
  return { hallazgos: hs.length, acciones: conAccion.length };
}

async function anular(repo, empresaId, id, motivo) {
  const i = await inspeccion(repo, empresaId, id);
  if (i.estado !== 'programada') throw error(409, 'Solo se anula una inspeccion programada');
  const m = texto(motivo, 500);
  if (!m || m.length < 10) throw error(422, 'Indique el motivo de la anulacion');
  await repo.actualizar('inspeccion', id, { estado: 'anulada', motivo_estado: m }, { accion: 'anular' });
}

async function listar(repo, empresaId, anio) {
  return repo.consultar(
    `SELECT i.*, c.nombre AS centro,
            (SELECT COUNT(*) FROM inspeccion_hallazgo h WHERE h.tenant_id = {tenant} AND h.inspeccion_id = i.id) AS hallazgos,
            (SELECT COUNT(*) FROM accion_mejora a WHERE a.tenant_id = {tenant} AND a.origen = 'inspeccion' AND a.origen_id = i.id AND a.estado = 'abierta') AS acciones_abiertas
       FROM inspeccion i LEFT JOIN centro_trabajo c ON c.tenant_id = {tenant} AND c.id = i.centro_trabajo_id
      WHERE i.tenant_id = {tenant} AND i.empresa_id = ? AND YEAR(i.fecha_programada) = ?
      ORDER BY i.fecha_programada DESC, i.id DESC`, [empresaId, anio],
  );
}

async function detalle(repo, empresaId, id) {
  const i = await inspeccion(repo, empresaId, id);
  const hallazgosInsp = await repo.consultar(
    `SELECT h.*, a.estado AS accion_estado, a.fecha_limite, a.fecha_cierre FROM inspeccion_hallazgo h
       LEFT JOIN accion_mejora a ON a.tenant_id = {tenant} AND a.id = h.accion_mejora_id
      WHERE h.tenant_id = {tenant} AND h.inspeccion_id = ? ORDER BY h.numero`, [id],
  );
  return { inspeccion: i, hallazgos: hallazgosInsp };
}

module.exports = { TIPOS, NIVELES, programar, realizar, anular, listar, detalle, hallazgos };
