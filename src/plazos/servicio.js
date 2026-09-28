// Motor de obligaciones: lo llaman los modulos (eventos, vigencias) y el job diario.
// Toda operacion recibe el RepositorioTenant del contexto: el aislamiento lo pone la capa de datos.
const { consultarCatalogo } = require('../db/global');
const cuentas = require('../db/cuentas');
const fechas = require('../fechas');
const { normalizar } = require('../fechas/calendario');
const reglas = require('./reglas');

const ABIERTOS_SQL = "('en_termino','por_vencer','vencido')";

async function plazosActivos() {
  return consultarCatalogo("SELECT * FROM plazo_legal WHERE estado = 'activo'");
}

async function vencimientoActivo(codigo) {
  const [v] = await consultarCatalogo("SELECT * FROM vencimiento_recurrente WHERE codigo = ? AND estado = 'activo'", [codigo]);
  if (!v) throw new Error(`Vencimiento recurrente inexistente o inactivo: ${codigo}`);
  return v;
}

function error(status, mensaje) {
  const e = new Error(mensaje);
  e.status = status;
  return e;
}

// Inserta si no existe (idempotente por uq_origen). Devuelve { id, creada }.
async function asegurar(tx, ob, hoy) {
  const [previa] = await tx.listar('obligacion_pendiente', {
    plazo_codigo: ob.plazo_codigo,
    entidad_origen_tipo: ob.entidad_origen_tipo,
    entidad_origen_id: ob.entidad_origen_id,
    fecha_disparo: ob.fecha_disparo,
  });
  if (previa) return { id: previa.id, creada: false };
  const estado = reglas.estadoObligacion({ ...ob, estado: 'en_termino' }, hoy, fechas.calendario());
  return { id: await tx.insertar('obligacion_pendiente', { ...ob, estado }), creada: true };
}

/**
 * Un modulo informa un evento disparador; se crean las obligaciones que el catalogo asocia.
 * ev: { evento, variante?, fecha, empresaId, entidadTipo, entidadId, responsableId? }
 */
async function dispararEvento(repo, ev, hoy = fechas.hoyBogota()) {
  const nuevas = reglas.obligacionesDeEvento(await plazosActivos(), ev, fechas.calendario());
  return repo.transaccion(async (tx) => {
    const resultado = [];
    for (const ob of nuevas) resultado.push({ plazo: ob.plazo_codigo, fecha_limite: ob.fecha_limite, ...(await asegurar(tx, ob, hoy)) });
    return resultado;
  });
}

/**
 * Registra un elemento con vigencia (comite, licencia, certificacion, documento...).
 * Las obligaciones abiertas anteriores del mismo elemento quedan cumplidas por la renovacion.
 * datos: { vencimientoCodigo, empresaId, entidadTipo, entidadId, fechaInicio, fechaLimite?, responsableId?, evidenciaDocumentoId? }
 */
async function registrarVigencia(repo, datos, hoy = fechas.hoyBogota()) {
  const venc = await vencimientoActivo(datos.vencimientoCodigo);
  const ob = reglas.obligacionDeVigencia(venc, datos, fechas.calendario());
  return repo.transaccion(async (tx) => {
    const previas = await tx.consultar(
      `SELECT id FROM obligacion_pendiente
        WHERE tenant_id = {tenant} AND plazo_codigo = ? AND entidad_origen_tipo = ? AND entidad_origen_id = ?
          AND fecha_disparo < ? AND estado IN ${ABIERTOS_SQL}`,
      [ob.plazo_codigo, ob.entidad_origen_tipo, ob.entidad_origen_id, ob.fecha_disparo],
    );
    for (const p of previas) {
      await tx.actualizar('obligacion_pendiente', p.id, {
        estado: 'cumplido', fecha_cumplimiento: ob.fecha_disparo,
        evidencia_documento_id: datos.evidenciaDocumentoId ?? null,
        observacion: `Renovada con vigencia desde ${ob.fecha_disparo}`,
      }, { accion: 'cumplir' });
    }
    return { ...(await asegurar(tx, ob, hoy)), fecha_limite: ob.fecha_limite, renovadas: previas.length };
  });
}

async function obligacionAbierta(tx, id) {
  const ob = await tx.obtener('obligacion_pendiente', id);
  if (!ob) throw error(404, 'Obligacion no encontrada');
  if (!reglas.ESTADOS_ABIERTOS.includes(ob.estado)) throw error(409, 'La obligacion ya esta cerrada');
  return ob;
}

/** Cierre por cumplimiento, con fecha real, observacion y evidencia opcional. */
async function cumplirObligacion(repo, id, { fecha, observacion, evidenciaDocumentoId = null }, hoy = fechas.hoyBogota()) {
  const f = normalizar(fecha);
  if (f > hoy) throw error(422, 'La fecha de cumplimiento no puede ser futura');
  const obs = String(observacion || '').trim();
  if (obs.length < 5) throw error(422, 'La observacion de cumplimiento es obligatoria');
  return repo.transaccion(async (tx) => {
    const ob = await obligacionAbierta(tx, id);
    if (f < ob.fecha_disparo) throw error(422, 'La fecha de cumplimiento es anterior al disparo de la obligacion');
    if (evidenciaDocumentoId != null) {
      const doc = Number.isSafeInteger(Number(evidenciaDocumentoId)) ? await tx.obtener('documento_sst', Number(evidenciaDocumentoId)) : null;
      // La evidencia debe ser de la misma empresa que la obligacion.
      if (!doc || (ob.empresa_id && doc.empresa_id !== ob.empresa_id)) throw error(422, 'Documento de evidencia inexistente');
    }
    await tx.actualizar('obligacion_pendiente', id, {
      estado: 'cumplido', fecha_cumplimiento: f, observacion: obs.slice(0, 500), evidencia_documento_id: evidenciaDocumentoId,
    }, { accion: 'cumplir' });
    return { id, cumplidaTarde: f > ob.fecha_limite };
  });
}

/** Solo para los modulos (p. ej. evento anulado). No se expone en la UI: ocultar plazos es agravante. */
async function anularObligacion(repo, id, motivo) {
  const m = String(motivo || '').trim();
  if (m.length < 10) throw error(422, 'El motivo de anulacion es obligatorio');
  return repo.transaccion(async (tx) => {
    await obligacionAbierta(tx, id);
    await tx.actualizar('obligacion_pendiente', id, { estado: 'anulado', observacion: m.slice(0, 500) }, { accion: 'anular' });
  });
}

async function asignarResponsable(repo, id, usuarioId) {
  const uid = usuarioId ? Number.parseInt(usuarioId, 10) : null;
  if (uid && !(await cuentas.usuarioEnTenant(repo.tenantId, uid))) throw error(422, 'El responsable no pertenece a esta empresa');
  return repo.transaccion(async (tx) => {
    await obligacionAbierta(tx, id);
    await tx.actualizar('obligacion_pendiente', id, { responsable_id: uid }, { accion: 'asignar_responsable' });
  });
}

/** Persiste el estado vigente de las obligaciones abiertas; cada transicion queda auditada. */
async function recalcularEstados(repo, hoy = fechas.hoyBogota()) {
  const abiertas = await repo.consultar(
    `SELECT * FROM obligacion_pendiente WHERE tenant_id = {tenant} AND estado IN ${ABIERTOS_SQL}`,
  );
  const transiciones = [];
  for (const ob of abiertas) {
    const nuevo = reglas.estadoObligacion(ob, hoy, fechas.calendario());
    if (nuevo === ob.estado) continue;
    await repo.actualizar('obligacion_pendiente', ob.id, { estado: nuevo }, { accion: 'transicion_estado' });
    transiciones.push({ id: ob.id, de: ob.estado, a: nuevo });
  }
  return transiciones;
}

/**
 * Documentos vigentes con fecha_vence cuyo tipo tiene vencimiento_codigo generan la obligacion
 * de renovarlos. Si el documento se reemplaza, la obligacion se cumple con la version nueva;
 * si se anula, la obligacion se anula.
 */
async function sincronizarDocumentos(repo, hoy = fechas.hoyBogota()) {
  const r = { creadas: 0, cumplidas: 0, anuladas: 0 };
  const docs = await repo.consultar(
    `SELECT d.id, d.empresa_id, d.fecha_documento, d.fecha_vence, t.vencimiento_codigo
       FROM documento_sst d JOIN tipo_documental t ON t.codigo = d.tipo_documental
      WHERE d.tenant_id = {tenant} AND d.estado = 'vigente' AND d.fecha_vence IS NOT NULL
        AND t.vencimiento_codigo IS NOT NULL`,
  );
  for (const d of docs) {
    const res = await registrarVigencia(repo, {
      vencimientoCodigo: d.vencimiento_codigo, empresaId: d.empresa_id, entidadTipo: 'documento_sst',
      entidadId: d.id, fechaInicio: d.fecha_documento, fechaLimite: d.fecha_vence,
    }, hoy);
    if (res.creada) r.creadas++;
  }

  const huerfanas = await repo.consultar(
    `SELECT o.id, d.id AS documento_id, d.estado AS estado_documento
       FROM obligacion_pendiente o
       JOIN documento_sst d ON d.tenant_id = {tenant} AND d.id = o.entidad_origen_id
      WHERE o.tenant_id = {tenant} AND o.entidad_origen_tipo = 'documento_sst'
        AND o.estado IN ${ABIERTOS_SQL} AND d.estado IN ('reemplazado','anulado')`,
  );
  for (const h of huerfanas) {
    if (h.estado_documento === 'anulado') {
      await anularObligacion(repo, h.id, `Documento ${h.documento_id} anulado`);
      r.anuladas++;
      continue;
    }
    const [nueva] = await repo.consultar(
      `SELECT id, fecha_documento FROM documento_sst
        WHERE tenant_id = {tenant} AND documento_padre_id = ? AND estado = 'vigente' ORDER BY version DESC LIMIT 1`,
      [h.documento_id],
    );
    if (!nueva) continue;
    await repo.transaccion((tx) => tx.actualizar('obligacion_pendiente', h.id, {
      estado: 'cumplido',
      fecha_cumplimiento: nueva.fecha_documento < hoy ? nueva.fecha_documento : hoy,
      evidencia_documento_id: nueva.id,
      observacion: `Documento reemplazado por la version ${nueva.id}`,
    }, { accion: 'cumplir' }));
    r.cumplidas++;
  }
  return r;
}

/** Obligaciones abiertas de una entidad (opcionalmente de un plazo). */
async function abiertasDe(tx, entidad, id, plazoCodigo = null) {
  let sql = `SELECT id, plazo_codigo FROM obligacion_pendiente WHERE tenant_id = {tenant} AND entidad_origen_tipo = ? AND entidad_origen_id = ?
                AND estado IN ${ABIERTOS_SQL}`;
  const params = [entidad, id];
  if (plazoCodigo) { sql += ' AND plazo_codigo = ?'; params.push(plazoCodigo); }
  return tx.consultar(sql, params);
}

module.exports = {
  abiertasDe, dispararEvento, registrarVigencia, cumplirObligacion, anularObligacion, asignarResponsable,
  recalcularEstados, sincronizarDocumentos,
};
