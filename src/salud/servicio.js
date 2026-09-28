// M09: salud ocupacional SIN historia clinica. Ordenes, conceptos de aptitud, restricciones con reloj de
// adaptacion (20 dias habiles), examen de egreso, periodicos, incapacidades sin diagnostico y agregados.
const cuentas = require('../db/cuentas');
const { hoyBogota } = require('../fechas/calendario');
const plazos = require('../plazos/servicio');
const { error } = require('../comun/rutas');
const r = require('./reglas');

const texto = (v, max) => { const s = String(v ?? '').trim(); return s ? s.slice(0, max) : null; };

async function obligacionesAbiertas(tx, entidad, id, plazo) {
  return tx.consultar(
    `SELECT id FROM obligacion_pendiente WHERE tenant_id = {tenant} AND entidad_origen_tipo = ? AND entidad_origen_id = ?
        AND plazo_codigo = ? AND estado IN ('en_termino','por_vencer','vencido')`, [entidad, id, plazo],
  );
}

async function personaDeEmpresa(repo, empresaId, personaId) {
  const [v] = await repo.listar('vinculacion', { empresa_id: empresaId, persona_id: personaId });
  if (!v) throw error(422, 'La persona no tiene vinculacion con la empresa');
  return v;
}

/** Enfasis sugerido: perfil de riesgo del cargo + peligros de la matriz vigente para ese cargo. */
async function enfasisSugerido(repo, empresaId, personaId) {
  const [fila] = await repo.consultar(
    `SELECT c.id, c.perfil_riesgo FROM vinculacion v JOIN cargo c ON c.tenant_id = {tenant} AND c.id = v.cargo_id
      WHERE v.tenant_id = {tenant} AND v.persona_id = ? AND v.empresa_id = ? ORDER BY v.id DESC LIMIT 1`, [personaId, empresaId],
  );
  if (!fila) return null;
  const peligros = await repo.consultar(
    `SELECT DISTINCT i.peligro FROM riesgo_item_cargo ric
       JOIN riesgo_item i ON i.tenant_id = {tenant} AND i.id = ric.item_id AND i.estado = 'activo'
       JOIN matriz_riesgo m ON m.tenant_id = {tenant} AND m.id = i.matriz_id AND m.estado = 'vigente'
      WHERE ric.tenant_id = {tenant} AND ric.cargo_id = ? AND ric.estado = 'activo'`, [fila.id],
  );
  return [fila.perfil_riesgo, peligros.length ? `Peligros: ${peligros.map((p) => p.peligro).join(', ')}` : null].filter(Boolean).join('. ') || null;
}

async function ordenar(repo, empresaId, d) {
  const personaId = Number.parseInt(d.persona_id, 10);
  if (!personaId) throw error(422, 'Seleccione la persona');
  await personaDeEmpresa(repo, empresaId, personaId);
  if (!r.TIPOS.includes(d.tipo)) throw error(422, 'Tipo de evaluacion invalido');
  const ips = texto(d.ips, 150);
  if (!ips) throw error(422, 'Indique la IPS');
  const f = String(d.fecha_orden || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(f)) throw error(422, 'Fecha de la orden invalida');
  const enfasis = texto(d.enfasis, 1000) || await enfasisSugerido(repo, empresaId, personaId);
  return repo.insertar('evaluacion_medica', { empresa_id: empresaId, persona_id: personaId, tipo: d.tipo, ips, fecha_orden: f, enfasis });
}

async function evaluacion(repo, empresaId, id) {
  const e = await repo.obtener('evaluacion_medica', id);
  if (!e || e.empresa_id !== empresaId) throw error(404, 'Evaluacion no encontrada');
  return e;
}

/**
 * Registra el concepto (con el documento firmado por el medico). Restricciones -> reloj de adaptacion
 * en 20 dias habiles; egreso -> cumple el examen de egreso; proximo examen -> obligacion del periodico.
 */
async function registrarConcepto(repo, empresaId, id, d, hoy = hoyBogota()) {
  const e = await evaluacion(repo, empresaId, id);
  if (e.estado !== 'ordenada') throw error(409, 'La evaluacion ya tiene concepto o fue anulada');
  const v = r.validarConcepto({ ...d, tipo: e.tipo }, hoy);
  if (v.fecha_examen < e.fecha_orden) throw error(422, 'El examen no puede ser anterior a la orden');
  const doc = d.documento_id ? await repo.obtener('documento_sst', Number.parseInt(d.documento_id, 10)) : null;
  if (!doc || doc.empresa_id !== empresaId || doc.tipo_documental !== 'CONCEPTO_APTITUD' || doc.estado !== 'vigente') {
    throw error(422, 'Asocie el concepto firmado por el medico (documento CONCEPTO_APTITUD vigente)');
  }
  if (doc.persona_id && doc.persona_id !== e.persona_id) throw error(422, 'El documento del concepto es de otra persona');

  await repo.transaccion(async (tx) => {
    await tx.actualizar('evaluacion_medica', id, { ...v, documento_id: doc.id, estado: 'con_concepto' }, { accion: 'registrar_concepto' });
    if (v.concepto === 'apto_con_restricciones') {
      await plazos.dispararEvento(tx, {
        evento: 'concepto_aptitud.con_restricciones', fecha: v.fecha_examen, empresaId, entidadTipo: 'evaluacion_medica', entidadId: id,
      }, hoy);
    }
    if (e.tipo === 'egreso') {
      for (const vinc of await tx.listar('vinculacion', { empresa_id: empresaId, persona_id: e.persona_id })) {
        for (const o of await obligacionesAbiertas(tx, 'vinculacion', vinc.id, 'EXAMEN_EGRESO')) {
          await plazos.cumplirObligacion(tx, o.id, { fecha: v.fecha_examen, observacion: `Examen de egreso en ${e.ips}`, evidenciaDocumentoId: doc.id }, hoy);
        }
      }
    }
    if (v.proximo_examen) {
      await plazos.registrarVigencia(tx, {
        vencimientoCodigo: 'EXAMEN_PERIODICO', empresaId, entidadTipo: 'persona', entidadId: e.persona_id,
        fechaInicio: v.fecha_examen, fechaLimite: v.proximo_examen, evidenciaDocumentoId: doc.id,
      }, hoy);
    }
  });
  return v.concepto;
}

/** Cumple la adaptacion del puesto derivada de las restricciones. */
async function registrarAdaptacion(repo, empresaId, id, d, hoy = hoyBogota()) {
  const e = await evaluacion(repo, empresaId, id);
  if (e.concepto !== 'apto_con_restricciones') throw error(409, 'El concepto no tiene restricciones');
  const obs = texto(d.observacion, 500);
  if (!obs || obs.length < 10) throw error(422, 'Describa la adaptacion realizada');
  const f = String(d.fecha || hoy);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(f) || f > hoy || f < e.fecha_examen) throw error(422, 'Fecha de adaptacion invalida');
  let n = 0;
  await repo.transaccion(async (tx) => {
    for (const o of await obligacionesAbiertas(tx, 'evaluacion_medica', id, 'ADAPTA_RESTRICCION')) {
      await plazos.cumplirObligacion(tx, o.id, { fecha: f, observacion: obs, evidenciaDocumentoId: d.documento_id ? Number.parseInt(d.documento_id, 10) : null }, hoy);
      n += 1;
    }
  });
  if (!n) throw error(409, 'No hay adaptacion pendiente');
}

async function anularEvaluacion(repo, empresaId, id, motivo) {
  const e = await evaluacion(repo, empresaId, id);
  if (e.estado !== 'ordenada') throw error(409, 'Solo se anula una orden sin concepto');
  await repo.actualizar('evaluacion_medica', id, { estado: 'anulada', observacion: texto(motivo, 500) || 'Anulada' }, { accion: 'anular' });
}

// ---------- Incapacidades (sin diagnostico)

async function registrarIncapacidad(repo, empresaId, d, hoy = hoyBogota()) {
  const personaId = Number.parseInt(d.persona_id, 10);
  if (!personaId) throw error(422, 'Seleccione la persona');
  await personaDeEmpresa(repo, empresaId, personaId);
  if (!['comun', 'laboral'].includes(d.origen)) throw error(422, 'Origen invalido');
  const f = String(d.fecha_inicio || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(f) || f > hoy) throw error(422, 'Fecha de inicio invalida');
  const dias = Number.parseInt(d.dias, 10);
  if (!(dias >= 1 && dias <= 540)) throw error(422, 'Dias de incapacidad invalidos');
  let eventoId = null;
  if (d.evento_id) {
    const ev = await repo.obtener('evento', Number.parseInt(d.evento_id, 10));
    if (!ev || ev.empresa_id !== empresaId || ev.persona_id !== personaId || ev.tipo === 'incidente') throw error(422, 'El evento no corresponde a esta persona');
    eventoId = ev.id;
  }
  if (d.origen === 'comun' && eventoId) throw error(422, 'Una incapacidad de origen comun no se asocia a un evento laboral');
  return repo.insertar('incapacidad', {
    empresa_id: empresaId, persona_id: personaId, origen: d.origen, fecha_inicio: f, dias,
    prorroga: d.prorroga === '1' ? 1 : 0, evento_id: eventoId, observacion: r.sinDatosClinicos(d.observacion, 'Observacion'),
  });
}

async function anularIncapacidad(repo, empresaId, id, motivo) {
  const i = await repo.obtener('incapacidad', id);
  if (!i || i.empresa_id !== empresaId) throw error(404, 'Incapacidad no encontrada');
  if (i.estado !== 'registrada') throw error(409, 'Ya esta anulada');
  await repo.actualizar('incapacidad', id, { estado: 'anulada', observacion: texto(motivo, 500) || 'Anulada' }, { accion: 'anular' });
}

// ---------- Consulta

/** detalle=false (roles que solo consultan): sin registros individuales, solo agregados. */
async function panel(repo, empresaId, anio, hoy = hoyBogota(), detalle = true) {
  const [evaluaciones, incapacidades, pendientes, personasVinc] = await Promise.all([
    repo.consultar(
      `SELECT e.*, p.nombres, p.apellidos FROM evaluacion_medica e JOIN persona p ON p.tenant_id = {tenant} AND p.id = e.persona_id
        WHERE e.tenant_id = {tenant} AND e.empresa_id = ? AND (e.estado = 'ordenada' OR YEAR(e.fecha_orden) = ?)
        ORDER BY e.estado = 'ordenada' DESC, e.fecha_orden DESC`, [empresaId, anio],
    ),
    repo.consultar(
      `SELECT i.*, p.nombres, p.apellidos FROM incapacidad i JOIN persona p ON p.tenant_id = {tenant} AND p.id = i.persona_id
        WHERE i.tenant_id = {tenant} AND i.empresa_id = ? AND YEAR(i.fecha_inicio) = ? ORDER BY i.fecha_inicio DESC`, [empresaId, anio],
    ),
    repo.consultar(
      `SELECT o.plazo_codigo, o.descripcion, o.fecha_limite, o.estado, o.entidad_origen_tipo, o.entidad_origen_id
         FROM obligacion_pendiente o
        WHERE o.tenant_id = {tenant} AND o.empresa_id = ? AND o.estado IN ('en_termino','por_vencer','vencido')
          AND o.plazo_codigo IN ('ADAPTA_RESTRICCION','EXAMEN_EGRESO','EXAMEN_PERIODICO') ORDER BY o.fecha_limite`, [empresaId],
    ),
    repo.consultar(
      `SELECT p.sexo, p.fecha_nacimiento, c.nombre AS cargo FROM persona p
         JOIN vinculacion v ON v.tenant_id = {tenant} AND v.persona_id = p.id AND v.empresa_id = ? AND v.estado = 'activa'
         LEFT JOIN cargo c ON c.tenant_id = {tenant} AND c.id = v.cargo_id
        WHERE p.tenant_id = {tenant}`, [empresaId],
    ),
  ]);
  const vivas = incapacidades.filter((i) => i.estado === 'registrada');
  return {
    detalle,
    evaluaciones: detalle ? evaluaciones : [],
    incapacidades: detalle ? incapacidades : [],
    pendientes: detalle ? pendientes : [],
    perfil: r.perfilSociodemografico(personasVinc, hoy),
    ausentismo: {
      dias_comun: vivas.filter((i) => i.origen === 'comun').reduce((s, i) => s + Number(i.dias), 0),
      dias_laboral: vivas.filter((i) => i.origen === 'laboral').reduce((s, i) => s + Number(i.dias), 0),
    },
  };
}

/** Canal del propio trabajador (par. 3 art. 2.2.4.6.12): sus conceptos, competencias y registros. */
async function misRegistros(repo, usuarioId) {
  const [persona] = await repo.listar('persona', { usuario_id: usuarioId });
  if (!persona) return null;
  const [evaluaciones, competencias, documentos] = await Promise.all([
    repo.consultar(
      `SELECT tipo, ips, fecha_examen, concepto, restricciones, recomendaciones, proximo_examen FROM evaluacion_medica
        WHERE tenant_id = {tenant} AND persona_id = ? AND estado = 'con_concepto' ORDER BY fecha_examen DESC`, [persona.id],
    ),
    repo.consultar(
      "SELECT tipo, fecha_obtencion, fecha_vence, estado FROM competencia WHERE tenant_id = {tenant} AND persona_id = ? AND estado = 'vigente' ORDER BY tipo", [persona.id],
    ),
    repo.consultar(
      `SELECT d.id, d.codigo, d.titulo, d.version, d.fecha_documento, t.nombre AS tipo FROM documento_sst d JOIN tipo_documental t ON t.codigo = d.tipo_documental
        WHERE d.tenant_id = {tenant} AND d.persona_id = ? AND d.estado = 'vigente' ORDER BY d.fecha_documento DESC`, [persona.id],
    ),
  ]);
  await repo.auditar('consultar_propios', 'persona', persona.id);
  return { persona, evaluaciones, competencias, documentos };
}

async function vincularUsuario(repo, personaId, usuarioId) {
  const p = await repo.obtener('persona', personaId);
  if (!p) throw error(404, 'Persona no encontrada');
  const uid = usuarioId ? Number.parseInt(usuarioId, 10) : null;
  if (uid && !(await cuentas.usuarioEnTenant(repo.tenantId, uid))) throw error(422, 'El usuario no pertenece a la empresa');
  if (uid) {
    // El usuario debe ser la misma persona: vera sus conceptos y firmara sus entregas.
    const u = await cuentas.obtenerUsuario(uid);
    const igual = (a, b) => String(a || '').trim().toUpperCase() === String(b || '').trim().toUpperCase();
    if (!u || !igual(u.tipo_documento, p.tipo_documento) || !igual(u.numero_documento, p.numero_documento)) {
      throw error(422, 'El documento del usuario no coincide con el de la persona');
    }
    const [otra] = await repo.listar('persona', { usuario_id: uid });
    if (otra && otra.id !== personaId) throw error(409, 'Ese usuario ya esta vinculado a otra persona');
  }
  await repo.actualizar('persona', personaId, { usuario_id: uid }, { accion: 'vincular_usuario' });
}

module.exports = {
  enfasisSugerido, ordenar, registrarConcepto, registrarAdaptacion, anularEvaluacion, registrarIncapacidad,
  anularIncapacidad, panel, misRegistros, vincularUsuario,
};
