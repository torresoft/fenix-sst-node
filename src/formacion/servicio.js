// M07: induccion previa al inicio de labores, competencias con vencimiento y capacitaciones con asistencia.
const { consultarCatalogo } = require('../db/global');
const { hoyBogota } = require('../fechas/calendario');
const fechas = require('../fechas');
const plazos = require('../plazos/servicio');
const reglasPlazos = require('../plazos/reglas');
const peligros = require('../peligros/servicio');
const { error } = require('../comun/rutas');
const r = require('./reglas');

const texto = (v, max) => { const s = String(v ?? '').trim(); return s ? s.slice(0, max) : null; };
const fechaValida = (v, nombre) => {
  const f = String(v || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(f)) throw error(422, `${nombre} invalida`);
  return f;
};

async function tipos() {
  return consultarCatalogo("SELECT * FROM competencia_tipo WHERE estado = 'activo' ORDER BY requerida_todos DESC, nombre");
}

async function tipo(codigo) {
  const t = (await tipos()).find((x) => x.codigo === codigo);
  if (!t) throw error(422, 'Tipo de competencia invalido');
  return t;
}

async function obligacionesAbiertas(tx, entidad, id, plazo = null) {
  let sql = `SELECT id FROM obligacion_pendiente WHERE tenant_id = {tenant} AND entidad_origen_tipo = ? AND entidad_origen_id = ?
                AND estado IN ('en_termino','por_vencer','vencido')`;
  const params = [entidad, id];
  if (plazo) { sql += ' AND plazo_codigo = ?'; params.push(plazo); }
  return tx.consultar(sql, params);
}

/**
 * Registra una competencia. Reemplaza la vigente del mismo tipo (y cumple su renovacion), crea la
 * obligacion de renovarla si el tipo vence, y si es induccion cumple la induccion pendiente del ingreso.
 */
/** interno: { capacitacionId, tx } solo desde realizar(); nunca llega del formulario. */
async function registrarCompetencia(repo, empresaId, personaId, d, hoy = hoyBogota(), interno = {}) {
  const t = await tipo(d.tipo);
  if (!personaId || !(await repo.listar('vinculacion', { empresa_id: empresaId, persona_id: personaId })).length) throw error(422, 'Persona invalida');
  const horas = d.horas ? Number(d.horas) : null;
  if (horas !== null && !(horas > 0 && horas <= 2000)) throw error(422, 'Horas invalidas');
  const obtencion = fechaValida(d.fecha_obtencion, 'Fecha de obtencion');
  if (obtencion > hoy) throw error(422, 'La fecha de obtencion no puede ser futura');
  let vence = d.fecha_vence ? fechaValida(d.fecha_vence, 'Fecha de vencimiento') : null;
  let venc = null;
  if (t.vencimiento_codigo) {
    [venc] = await consultarCatalogo('SELECT * FROM vencimiento_recurrente WHERE codigo = ?', [t.vencimiento_codigo]);
    if (!vence) vence = reglasPlazos.fechaVencimiento(venc, obtencion, fechas.calendario());
  }
  if (vence && vence <= obtencion) throw error(422, 'El vencimiento debe ser posterior a la obtencion');
  const docId = d.documento_id ? Number.parseInt(d.documento_id, 10) : null;
  if (docId) {
    const doc = await repo.obtener('documento_sst', docId);
    if (!doc || doc.empresa_id !== empresaId || doc.estado !== 'vigente') throw error(422, 'El certificado debe ser un documento vigente de la empresa');
  } else if (Number(t.requiere_certificado) && !interno.capacitacionId) throw error(422, `${t.nombre} exige el certificado en el gestor documental`);

  const ejecutar = async (tx) => {
    const [previa] = await tx.listar('competencia', { persona_id: personaId, tipo: t.codigo, estado: 'vigente' });
    if (previa) {
      await tx.actualizar('competencia', previa.id, { estado: 'reemplazada', observacion: `Renovada el ${obtencion}` }, { accion: 'reemplazar' });
      for (const o of await obligacionesAbiertas(tx, 'competencia', previa.id)) {
        await plazos.cumplirObligacion(tx, o.id, { fecha: obtencion, observacion: `Renovada: ${t.nombre}`, evidenciaDocumentoId: docId }, hoy);
      }
    }
    const id = await tx.insertar('competencia', {
      empresa_id: empresaId, persona_id: personaId, tipo: t.codigo, fecha_obtencion: obtencion, fecha_vence: vence,
      entidad: texto(d.entidad, 150), horas: horas !== null ? horas.toFixed(2) : null,
      capacitacion_id: interno.capacitacionId || null, documento_id: docId,
    });
    if (venc) {
      await plazos.registrarVigencia(tx, {
        vencimientoCodigo: venc.codigo, empresaId, entidadTipo: 'competencia', entidadId: id,
        fechaInicio: obtencion, fechaLimite: vence, evidenciaDocumentoId: docId,
      }, hoy);
    }
    if (t.codigo === 'INDUCCION') {
      const vincs = await tx.listar('vinculacion', { empresa_id: empresaId, persona_id: personaId, estado: 'activa' });
      for (const v of vincs) {
        for (const o of await obligacionesAbiertas(tx, 'vinculacion', v.id, 'INDUCCION_INGRESO')) {
          await plazos.cumplirObligacion(tx, o.id, { fecha: obtencion, observacion: 'Induccion en SST registrada' }, hoy);
        }
      }
    }
    return id;
  };
  return interno.tx ? ejecutar(interno.tx) : repo.transaccion(ejecutar);
}

async function anularCompetencia(repo, empresaId, id, motivo) {
  const c = await repo.obtener('competencia', id);
  if (!c || c.empresa_id !== empresaId) throw error(404, 'Competencia no encontrada');
  if (c.estado !== 'vigente') throw error(409, 'La competencia ya esta cerrada');
  const m = texto(motivo, 500);
  if (!m || m.length < 10) throw error(422, 'Explique por que se anula (minimo 10 caracteres)');
  await repo.transaccion(async (tx) => {
    for (const o of await obligacionesAbiertas(tx, 'competencia', id)) await plazos.anularObligacion(tx, o.id, `Competencia anulada: ${m}`.slice(0, 500));
    await tx.actualizar('competencia', id, { estado: 'anulada', observacion: m }, { accion: 'anular' });
  });
  return c.persona_id;
}

// ---------- Requisitos por cargo

async function requisitos(repo, empresaId) {
  const [cargos, filas, porPeligro] = await Promise.all([
    repo.listar('cargo', { empresa_id: empresaId, estado: 'activo' }, { orden: 'nombre' }),
    repo.consultar(
      `SELECT cc.cargo_id, cc.competencia FROM cargo_competencia cc JOIN cargo c ON c.tenant_id = {tenant} AND c.id = cc.cargo_id
        WHERE cc.tenant_id = {tenant} AND cc.estado = 'activo' AND c.empresa_id = ?`, [empresaId],
    ),
    peligros.peligrosPorCargo(repo, empresaId),
  ]);
  const porCargo = new Map();
  for (const f of filas) porCargo.set(f.cargo_id, [...(porCargo.get(f.cargo_id) || []), f.competencia]);
  return { cargos, porCargo, sugeridas: r.sugerencias(porPeligro) };
}

async function guardarRequisitos(repo, empresaId, cargoId, competencias) {
  const cargo = await repo.obtener('cargo', cargoId);
  if (!cargo || cargo.empresa_id !== empresaId) throw error(404, 'Cargo no encontrado');
  const validos = new Set((await tipos()).filter((t) => !Number(t.requerida_todos)).map((t) => t.codigo));
  const deseadas = [...new Set([].concat(competencias || []).map(String))];
  for (const c of deseadas) if (!validos.has(c)) throw error(422, 'Competencia invalida');
  await repo.transaccion(async (tx) => {
    const actuales = await tx.listar('cargo_competencia', { cargo_id: cargoId });
    for (const c of deseadas) {
      const a = actuales.find((x) => x.competencia === c);
      if (!a) await tx.insertar('cargo_competencia', { cargo_id: cargoId, competencia: c });
      else if (a.estado !== 'activo') await tx.actualizar('cargo_competencia', a.id, { estado: 'activo' });
    }
    for (const a of actuales) if (a.estado === 'activo' && !deseadas.includes(a.competencia)) await tx.actualizar('cargo_competencia', a.id, { estado: 'retirado' });
  });
}

// ---------- Matriz de competencias

async function matrizCompetencias(repo, empresaId, hoy = hoyBogota()) {
  const [personas, vigentes, t, req] = await Promise.all([
    repo.consultar(
      `SELECT p.id, p.nombres, p.apellidos, v.cargo_id, c.nombre AS cargo, v.fecha_ingreso FROM persona p
         JOIN vinculacion v ON v.tenant_id = {tenant} AND v.persona_id = p.id AND v.empresa_id = ? AND v.estado = 'activa'
         LEFT JOIN cargo c ON c.tenant_id = {tenant} AND c.id = v.cargo_id
        WHERE p.tenant_id = {tenant} ORDER BY p.apellidos, p.nombres`, [empresaId],
    ),
    repo.listar('competencia', { empresa_id: empresaId, estado: 'vigente' }),
    tipos(),
    requisitos(repo, empresaId),
  ]);
  return { ...r.matriz(personas, t, req.porCargo, vigentes, hoy), tipos: t };
}

async function competenciasDePersona(repo, personaId) {
  return repo.consultar(
    `SELECT c.*, d.codigo AS doc_codigo FROM competencia c LEFT JOIN documento_sst d ON d.tenant_id = {tenant} AND d.id = c.documento_id
      WHERE c.tenant_id = {tenant} AND c.persona_id = ? ORDER BY c.estado, c.fecha_obtencion DESC`, [personaId],
  );
}

// ---------- Capacitaciones

async function capacitaciones(repo, empresaId, anio) {
  return repo.consultar(
    `SELECT k.*, (SELECT COUNT(*) FROM capacitacion_asistente a WHERE a.tenant_id = {tenant} AND a.capacitacion_id = k.id) AS asistentes
       FROM capacitacion k WHERE k.tenant_id = {tenant} AND k.empresa_id = ? AND YEAR(k.fecha) = ? ORDER BY k.fecha DESC`, [empresaId, anio],
  );
}

async function programar(repo, empresaId, d) {
  const tema = texto(d.tema, 255);
  if (!tema || tema.length < 5) throw error(422, 'Indique el tema');
  const fecha = fechaValida(d.fecha, 'Fecha');
  const horas = Number(d.horas);
  if (!(horas > 0 && horas <= 200)) throw error(422, 'Horas invalidas');
  if (d.competencia) await tipo(d.competencia);
  return repo.insertar('capacitacion', {
    empresa_id: empresaId, tema, fecha, horas: horas.toFixed(2), instructor: texto(d.instructor, 150), competencia: d.competencia || null,
  });
}

async function capacitacionDeEmpresa(repo, empresaId, id) {
  const k = await repo.obtener('capacitacion', id);
  if (!k || k.empresa_id !== empresaId) throw error(404, 'Capacitacion no encontrada');
  return k;
}

/** Registra la realizacion con asistentes; si otorga competencia, la acredita a quienes aprobaron. */
async function realizar(repo, empresaId, id, d, hoy = hoyBogota()) {
  const k = await capacitacionDeEmpresa(repo, empresaId, id);
  if (k.estado !== 'programada') throw error(409, 'La capacitacion ya fue registrada o anulada');
  if (k.fecha > hoy) throw error(422, 'Registre la capacitacion cuando se haya realizado');
  const asistentes = [...new Set([].concat(d.asistentes || []).map((x) => Number.parseInt(x, 10)).filter(Boolean))];
  if (!asistentes.length) throw error(422, 'Marque los asistentes');
  const reprobados = new Set([].concat(d.reprobados || []).map((x) => Number.parseInt(x, 10)));
  let docId = null;
  if (d.registro_documento_id) {
    const doc = await repo.obtener('documento_sst', Number.parseInt(d.registro_documento_id, 10));
    if (!doc || doc.empresa_id !== empresaId || !['vigente', 'en_firma'].includes(doc.estado)) throw error(422, 'Registro de asistencia invalido');
    docId = doc.id;
  }
  for (const p of asistentes) {
    if (!(await repo.listar('vinculacion', { empresa_id: empresaId, persona_id: p })).length) throw error(422, 'Asistente invalido');
  }
  let acreditadas = 0;
  await repo.transaccion(async (tx) => {
    const [actual] = await tx.listar('capacitacion', { id }, { bloquear: true });
    if (actual.estado !== 'programada') throw error(409, 'La capacitacion ya fue registrada o anulada');
    for (const p of asistentes) await tx.insertar('capacitacion_asistente', { capacitacion_id: id, persona_id: p, aprobo: reprobados.has(p) ? 0 : 1 }, { auditar: false });
    await tx.actualizar('capacitacion', id, { estado: 'realizada', registro_documento_id: docId, eficacia: texto(d.eficacia, 1000) }, { accion: 'realizar' });
    if (k.competencia) {
      for (const p of asistentes.filter((x) => !reprobados.has(x))) {
        await registrarCompetencia(tx, empresaId, p, { tipo: k.competencia, fecha_obtencion: k.fecha, horas: k.horas, documento_id: docId }, hoy, { capacitacionId: id, tx });
        acreditadas += 1;
      }
    }
  });
  return acreditadas;
}

async function anularCapacitacion(repo, empresaId, id, motivo) {
  const k = await capacitacionDeEmpresa(repo, empresaId, id);
  if (k.estado !== 'programada') throw error(409, 'Solo se anula una capacitacion programada');
  await repo.actualizar('capacitacion', id, { estado: 'anulada', observacion: texto(motivo, 500) || 'Anulada' }, { accion: 'anular' });
}

async function detalleCapacitacion(repo, empresaId, id) {
  const k = await capacitacionDeEmpresa(repo, empresaId, id);
  const asistentes = await repo.consultar(
    `SELECT a.persona_id, a.aprobo, p.nombres, p.apellidos FROM capacitacion_asistente a
       JOIN persona p ON p.tenant_id = {tenant} AND p.id = a.persona_id
      WHERE a.tenant_id = {tenant} AND a.capacitacion_id = ? ORDER BY p.apellidos`, [id],
  );
  return { k, asistentes };
}

module.exports = {
  tipos, registrarCompetencia, anularCompetencia, requisitos, guardarRequisitos, matrizCompetencias, competenciasDePersona,
  capacitaciones, programar, realizar, anularCapacitacion, detalleCapacitacion,
};
