// M18 quimicos: inventario clasificado SGA con FDS de 16 secciones y etiquetado (D. 1496/2018, Res. 0773/2021).
const especificos = require('../../data/especificos.json');
const { hoyBogota } = require('../fechas/calendario');
const plazos = require('../plazos/servicio');
const { error } = require('../comun/rutas');

const PICTOGRAMAS = especificos.pictogramas_sga;
const texto = (v, max) => { const s = String(v ?? '').trim(); return s ? s.slice(0, max) : null; };
const lista = (v) => (Array.isArray(v) ? v : v == null ? [] : [v]);

async function producto(repo, empresaId, id) {
  const p = await repo.obtener('producto_quimico', Number.parseInt(id, 10));
  if (!p || p.empresa_id !== empresaId) throw error(404, 'Producto no encontrado');
  return p;
}

async function fdsValida(repo, empresaId, documentoId) {
  if (!documentoId) return null;
  const doc = await repo.obtener('documento_sst', Number.parseInt(documentoId, 10));
  if (!doc || doc.empresa_id !== empresaId || doc.tipo_documental !== 'FDS' || doc.estado !== 'vigente') throw error(422, 'La FDS debe ser un documento FDS vigente');
  return doc;
}

async function vigenciaFds(tx, empresaId, id, doc, hoy) {
  await plazos.registrarVigencia(tx, {
    vencimientoCodigo: 'FDS_SGA', empresaId, entidadTipo: 'producto_quimico', entidadId: id, fechaInicio: doc.fecha_documento, evidenciaDocumentoId: doc.id,
  }, hoy);
}

async function registrar(repo, empresaId, d, hoy = hoyBogota()) {
  const codigos = new Set(PICTOGRAMAS.map((p) => p.codigo));
  const p = {
    nombre: texto(d.nombre, 150), fabricante: texto(d.fabricante, 150), uso: texto(d.uso, 300), ubicacion: texto(d.ubicacion, 150),
    cantidad: texto(d.cantidad, 60), pictogramas: [...new Set(lista(d.pictograma).filter((x) => codigos.has(x)))], etiquetado_sga: d.etiquetado_sga === '1' ? 1 : 0,
  };
  if (!p.nombre || !p.uso || !p.ubicacion) throw error(422, 'Nombre, uso y ubicacion son obligatorios');
  const doc = await fdsValida(repo, empresaId, d.fds_documento_id);
  let centro = null;
  if (d.centro_trabajo_id) {
    const c = await repo.obtener('centro_trabajo', Number.parseInt(d.centro_trabajo_id, 10));
    if (!c || c.empresa_id !== empresaId) throw error(422, 'Centro de trabajo invalido');
    centro = c.id;
  }
  return repo.transaccion(async (tx) => {
    const id = await tx.insertar('producto_quimico', {
      empresa_id: empresaId, centro_trabajo_id: centro, ...p, fds_documento_id: doc ? doc.id : null, fds_fecha: doc ? doc.fecha_documento : null,
    });
    if (doc) await vigenciaFds(tx, empresaId, id, doc, hoy);
    return id;
  });
}

async function actualizarFds(repo, empresaId, id, d, hoy = hoyBogota()) {
  const p = await producto(repo, empresaId, id);
  if (p.estado !== 'activo') throw error(409, 'El producto esta inactivo');
  const doc = await fdsValida(repo, empresaId, d.fds_documento_id);
  if (!doc) throw error(422, 'Seleccione la FDS');
  await repo.transaccion(async (tx) => {
    await tx.actualizar('producto_quimico', p.id, { fds_documento_id: doc.id, fds_fecha: doc.fecha_documento, etiquetado_sga: d.etiquetado_sga === '1' ? 1 : p.etiquetado_sga }, { accion: 'actualizar_fds' });
    await vigenciaFds(tx, empresaId, p.id, doc, hoy);
  });
}

async function inactivar(repo, empresaId, id, motivo) {
  const p = await producto(repo, empresaId, id);
  if (p.estado !== 'activo') throw error(409, 'Ya esta inactivo');
  const m = texto(motivo, 500);
  if (!m || m.length < 10) throw error(422, 'Indique el motivo');
  await repo.transaccion(async (tx) => {
    await tx.actualizar('producto_quimico', p.id, { estado: 'inactivo', motivo_estado: m }, { accion: 'inactivar' });
    for (const o of await plazos.abiertasDe(tx, 'producto_quimico', p.id)) await plazos.anularObligacion(tx, o.id, `Producto retirado: ${m}`);
  });
}

/** Inventario con alertas: sin FDS, FDS por actualizar (segun la obligacion del motor de plazos) y sin etiqueta. */
async function inventario(repo, empresaId) {
  const filas = await repo.consultar(
    `SELECT q.*, c.nombre AS centro, d.codigo AS fds_codigo,
            (SELECT o.fecha_limite FROM obligacion_pendiente o WHERE o.tenant_id = {tenant} AND o.entidad_origen_tipo = 'producto_quimico'
                AND o.entidad_origen_id = q.id AND o.plazo_codigo = 'FDS_SGA' AND o.estado IN ('en_termino','por_vencer','vencido') ORDER BY o.fecha_limite LIMIT 1) AS fds_limite,
            (SELECT o.estado FROM obligacion_pendiente o WHERE o.tenant_id = {tenant} AND o.entidad_origen_tipo = 'producto_quimico'
                AND o.entidad_origen_id = q.id AND o.plazo_codigo = 'FDS_SGA' AND o.estado IN ('en_termino','por_vencer','vencido') ORDER BY o.fecha_limite LIMIT 1) AS fds_estado
       FROM producto_quimico q
       LEFT JOIN centro_trabajo c ON c.tenant_id = {tenant} AND c.id = q.centro_trabajo_id
       LEFT JOIN documento_sst d ON d.tenant_id = {tenant} AND d.id = q.fds_documento_id
      WHERE q.tenant_id = {tenant} AND q.empresa_id = ? ORDER BY q.estado, q.nombre`, [empresaId],
  );
  const productos = filas.map((q) => ({ ...q, pictogramas: typeof q.pictogramas === 'string' ? JSON.parse(q.pictogramas) : q.pictogramas }));
  const activos = productos.filter((q) => q.estado === 'activo');
  return {
    productos,
    resumen: {
      activos: activos.length,
      sinFds: activos.filter((q) => !q.fds_documento_id).length,
      fdsVencida: activos.filter((q) => q.fds_estado === 'vencido').length,
      sinEtiqueta: activos.filter((q) => !q.etiquetado_sga).length,
    },
  };
}

module.exports = { PICTOGRAMAS, registrar, actualizarFds, inactivar, inventario };
