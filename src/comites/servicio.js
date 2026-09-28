// M10: COPASST / Vigia y Comite de Convivencia: periodo de 2 anios, miembros, sesiones con
// quorum y acta (8 dias), compromisos, y reunion extraordinaria por AT grave o mortal.
const { consultarCatalogo } = require('../db/global');
const { hoyBogota } = require('../fechas/calendario');
const plazos = require('../plazos/servicio');
const r = require('./reglas');

const texto = (v, max) => { const s = String(v ?? '').trim(); return s ? s.slice(0, max) : null; };
const fecha = (v, nombre) => {
  const f = String(v || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(f)) throw r.errorValidacion(`${nombre} invalida`);
  return f;
};

function error(status, mensaje) {
  const e = new Error(mensaje);
  e.status = status;
  return e;
}

async function tipos() {
  return consultarCatalogo("SELECT * FROM comite_tipo WHERE estado = 'activo' ORDER BY codigo");
}

async function tipo(codigo) {
  const t = (await tipos()).find((x) => x.codigo === codigo);
  if (!t) throw r.errorValidacion('Tipo de comite invalido');
  return t;
}

async function obtener(repo, empresaId, id) {
  const c = await repo.obtener('comite', id);
  if (!c || c.empresa_id !== empresaId) throw error(404, 'Comite no encontrado');
  return c;
}

const vigente = (c) => {
  if (c.estado !== 'vigente') throw error(409, 'Ese periodo del comite ya esta cerrado');
  return c;
};

async function obligacionesAbiertas(tx, entidad, id, plazoCodigo = null) {
  let sql = `SELECT id FROM obligacion_pendiente WHERE tenant_id = {tenant} AND entidad_origen_tipo = ? AND entidad_origen_id = ?
                AND estado IN ('en_termino','por_vencer','vencido')`;
  const params = [entidad, id];
  if (plazoCodigo) { sql += ' AND plazo_codigo = ?'; params.push(plazoCodigo); }
  return tx.consultar(sql, params);
}

async function validarActa(repo, empresaId, documentoId, tipoDoc) {
  if (!documentoId) return null;
  const d = await repo.obtener('documento_sst', Number.parseInt(documentoId, 10));
  if (!d || d.empresa_id !== empresaId || d.tipo_documental !== tipoDoc) throw r.errorValidacion(`El acta debe ser un documento ${tipoDoc} de la empresa`);
  if (d.estado !== 'vigente') throw r.errorValidacion('El acta debe estar vigente (firmada y publicada en el gestor documental)');
  return d;
}

// ---------- Panel

async function miembros(repo, comiteId) {
  return repo.consultar(
    `SELECT m.*, p.nombres, p.apellidos, p.numero_documento FROM comite_miembro m
       JOIN persona p ON p.tenant_id = {tenant} AND p.id = m.persona_id
      WHERE m.tenant_id = {tenant} AND m.comite_id = ? ORDER BY m.estado, m.representacion, m.calidad, p.apellidos`, [comiteId],
  );
}

async function panel(repo, empresaId, hoy = hoyBogota()) {
  const empresa = await repo.obtener('empresa', empresaId);
  const todos = await tipos();
  const aplicables = r.tiposAplicables(todos, empresa.numero_trabajadores);
  const comites = await repo.listar('comite', { empresa_id: empresaId, estado: 'vigente' });
  const tarjetas = [];
  for (const t of todos) {
    const c = comites.find((x) => x.tipo === t.codigo) || null;
    if (!c && !aplicables.includes(t)) continue;
    let resumen = null;
    if (c) {
      const [ms, sesiones, [abiertos]] = await Promise.all([
        miembros(repo, c.id),
        repo.listar('comite_sesion', { comite_id: c.id }),
        repo.consultar("SELECT COUNT(*) AS n FROM comite_compromiso WHERE tenant_id = {tenant} AND comite_id = ? AND estado = 'abierto'", [c.id]),
      ]);
      const conf = r.validarConformacion(t, c.trabajadores_base, ms);
      resumen = {
        miembros: ms.filter((m) => m.estado === 'activo').length, ...conf,
        sinReunion: r.mesesSinReunion(sesiones, c.periodo_inicio, hoy),
        sinActa: sesiones.filter((s) => s.estado === 'realizada').length,
        compromisos: Number(abiertos.n), vencePeriodo: c.periodo_fin < hoy,
      };
    }
    tarjetas.push({ tipo: t, comite: c, resumen, aplica: aplicables.includes(t) });
  }
  return { empresa, tarjetas };
}

// ---------- Conformacion por periodo

/** Registra el periodo de 2 anios; si habia uno vigente del mismo tipo lo reemplaza y cumple su renovacion. */
async function conformar(repo, empresaId, d, hoy = hoyBogota()) {
  const t = await tipo(d.tipo);
  const inicio = fecha(d.periodo_inicio, 'Fecha de inicio del periodo');
  if (inicio > hoy) throw r.errorValidacion('El periodo no puede iniciar en el futuro');
  const acta = await validarActa(repo, empresaId, d.acta_documento_id, t.documento_tipo);
  const empresa = await repo.obtener('empresa', empresaId);
  const [anterior] = await repo.listar('comite', { empresa_id: empresaId, tipo: t.codigo, estado: 'vigente' });
  if (anterior && inicio <= anterior.periodo_inicio) throw r.errorValidacion('El nuevo periodo debe iniciar despues del vigente');

  return repo.transaccion(async (tx) => {
    if (anterior) {
      await tx.actualizar('comite', anterior.id, { estado: 'reemplazado', observacion: `Reemplazado por el periodo desde ${inicio}` }, { accion: 'reemplazar' });
      for (const o of await obligacionesAbiertas(tx, 'comite', anterior.id)) {
        await plazos.cumplirObligacion(tx, o.id, { fecha: inicio, observacion: `Comite renovado: periodo desde ${inicio}` }, hoy);
      }
    }
    const id = await tx.insertar('comite', {
      empresa_id: empresaId, tipo: t.codigo, periodo_inicio: inicio, periodo_fin: r.periodoFin(inicio),
      trabajadores_base: Number(empresa.numero_trabajadores), acta_documento_id: acta ? acta.id : null,
    });
    await plazos.registrarVigencia(tx, {
      vencimientoCodigo: t.vencimiento_codigo, empresaId, entidadTipo: 'comite', entidadId: id,
      fechaInicio: inicio, fechaLimite: r.periodoFin(inicio), evidenciaDocumentoId: acta ? acta.id : null,
    }, hoy);
    return id;
  });
}

async function asociarActaConformacion(repo, empresaId, id, documentoId) {
  const c = vigente(await obtener(repo, empresaId, id));
  const t = await tipo(c.tipo);
  const acta = await validarActa(repo, empresaId, documentoId, t.documento_tipo);
  if (!acta) throw r.errorValidacion('Seleccione el acta');
  await repo.actualizar('comite', id, { acta_documento_id: acta.id }, { accion: 'asociar_acta' });
}

// ---------- Miembros

async function agregarMiembro(repo, empresaId, comiteId, d, hoy = hoyBogota()) {
  const c = vigente(await obtener(repo, empresaId, comiteId));
  const personaId = Number.parseInt(d.persona_id, 10);
  if (!personaId) throw r.errorValidacion('Seleccione la persona');
  const [vinc] = await repo.listar('vinculacion', { empresa_id: empresaId, persona_id: personaId, estado: 'activa' });
  if (!vinc) throw r.errorValidacion('Solo pueden ser miembros personas con vinculacion activa en la empresa');
  if (!['empleador', 'trabajadores'].includes(d.representacion)) throw r.errorValidacion('Representacion invalida');
  if (!['principal', 'suplente'].includes(d.calidad)) throw r.errorValidacion('Calidad invalida');
  const cargo = ['presidente', 'secretario', 'miembro'].includes(d.cargo_comite) ? d.cargo_comite : 'miembro';
  const activos = await repo.listar('comite_miembro', { comite_id: comiteId, estado: 'activo' });
  if (activos.some((m) => m.persona_id === personaId)) throw error(409, 'La persona ya es miembro activo de este comite');
  if (cargo !== 'miembro' && activos.some((m) => m.cargo_comite === cargo)) throw error(409, `Ya hay un ${cargo} activo`);
  const ingreso = d.fecha_ingreso ? fecha(d.fecha_ingreso, 'Fecha de ingreso') : hoy;
  if (ingreso < c.periodo_inicio || ingreso > hoy) throw r.errorValidacion('La fecha de ingreso debe estar dentro del periodo y no ser futura');
  await repo.insertar('comite_miembro', {
    comite_id: comiteId, persona_id: personaId, representacion: d.representacion, calidad: d.calidad, cargo_comite: cargo, fecha_ingreso: ingreso,
  });
}

async function retirarMiembro(repo, empresaId, miembroId, d, hoy = hoyBogota()) {
  const m = await repo.obtener('comite_miembro', miembroId);
  if (!m) throw error(404, 'Miembro no encontrado');
  vigente(await obtener(repo, empresaId, m.comite_id));
  if (m.estado !== 'activo') throw error(409, 'El miembro ya fue retirado');
  const f = d.fecha ? fecha(d.fecha, 'Fecha de retiro') : hoy;
  if (f < m.fecha_ingreso || f > hoy) throw r.errorValidacion('Fecha de retiro invalida');
  const motivo = texto(d.motivo, 255);
  if (!motivo) throw r.errorValidacion('Indique el motivo del retiro');
  await repo.actualizar('comite_miembro', miembroId, { estado: 'retirado', fecha_retiro: f, motivo_retiro: motivo }, { accion: 'retirar' });
  return m.comite_id;
}

// ---------- Sesiones

/** Eventos grave/mortal con la reunion extraordinaria del COPASST aun pendiente. */
async function eventosPendientesExtra(repo, empresaId) {
  return repo.consultar(
    `SELECT e.id, e.codigo, e.gravedad, e.fecha_base, o.fecha_limite FROM evento e
       JOIN obligacion_pendiente o ON o.tenant_id = {tenant} AND o.entidad_origen_tipo = 'evento' AND o.entidad_origen_id = e.id
            AND o.plazo_codigo = 'COPASST_EXTRA' AND o.estado IN ('en_termino','por_vencer','vencido')
      WHERE e.tenant_id = {tenant} AND e.empresa_id = ? ORDER BY e.fecha_base`, [empresaId],
  );
}

async function registrarSesion(repo, empresaId, comiteId, d, hoy = hoyBogota()) {
  const c = vigente(await obtener(repo, empresaId, comiteId));
  const t = await tipo(c.tipo);
  const tipoSesion = d.tipo === 'extraordinaria' ? 'extraordinaria' : 'ordinaria';
  const f = fecha(d.fecha, 'Fecha de la sesion');
  if (f > hoy) throw r.errorValidacion('Registre la sesion cuando se haya realizado');
  if (f < c.periodo_inicio) throw r.errorValidacion('La sesion es anterior al periodo del comite');
  const temas = texto(d.temas, 10000);
  if (!temas || temas.length < 10) throw r.errorValidacion('Registre los temas tratados');
  const activos = await repo.listar('comite_miembro', { comite_id: comiteId, estado: 'activo' });
  const ids = [...new Set([].concat(d.asistentes || []).map((x) => Number.parseInt(x, 10)).filter(Boolean))];
  for (const x of ids) if (!activos.some((m) => m.id === x)) throw r.errorValidacion('Hay asistentes que no son miembros activos');
  if (!ids.length) throw r.errorValidacion('Marque los asistentes');
  const principales = activos.filter((m) => m.calidad === 'principal').length;
  const quorum = r.hayQuorum(t.quorum, principales, ids.length);

  let evento = null;
  if (d.evento_id) {
    if (tipoSesion !== 'extraordinaria' || c.tipo === 'convivencia') throw r.errorValidacion('Solo una sesion extraordinaria del COPASST atiende un accidente');
    evento = (await eventosPendientesExtra(repo, empresaId)).find((e) => e.id === Number.parseInt(d.evento_id, 10));
    if (!evento) throw r.errorValidacion('El evento no tiene reunion extraordinaria pendiente');
    if (f < evento.fecha_base) throw r.errorValidacion('La sesion no puede ser anterior al evento');
  }

  return repo.transaccion(async (tx) => {
    const id = await tx.insertar('comite_sesion', {
      comite_id: comiteId, tipo: tipoSesion, fecha: f, evento_id: evento ? evento.id : null, temas,
      asistentes: ids.length, principales, quorum: quorum == null ? null : (quorum ? 1 : 0),
    });
    for (const m of ids) await tx.insertar('comite_asistencia', { sesion_id: id, miembro_id: m }, { auditar: false });
    await plazos.dispararEvento(tx, {
      evento: 'sesion.realizada', variante: c.tipo, fecha: f, empresaId, entidadTipo: 'comite_sesion', entidadId: id,
    }, hoy);
    if (evento) {
      for (const o of await obligacionesAbiertas(tx, 'evento', evento.id, 'COPASST_EXTRA')) {
        await plazos.cumplirObligacion(tx, o.id, { fecha: f, observacion: `Sesion extraordinaria del COPASST #${id}` }, hoy);
      }
    }
    return { id, quorum };
  });
}

async function sesionDelComite(repo, empresaId, sesionId) {
  const s = await repo.obtener('comite_sesion', sesionId);
  if (!s) throw error(404, 'Sesion no encontrada');
  const c = await obtener(repo, empresaId, s.comite_id);
  return { s, c };
}

/** El acta firmada cumple la obligacion de acta (8 dias) de la sesion. */
async function adjuntarActa(repo, empresaId, sesionId, documentoId, hoy = hoyBogota()) {
  const { s, c } = await sesionDelComite(repo, empresaId, sesionId);
  if (s.estado !== 'realizada') throw error(409, 'La sesion ya tiene acta o fue anulada');
  const t = await tipo(c.tipo);
  const acta = await validarActa(repo, empresaId, documentoId, t.documento_tipo);
  if (!acta) throw r.errorValidacion('Seleccione el acta');
  await repo.transaccion(async (tx) => {
    await tx.actualizar('comite_sesion', sesionId, { acta_documento_id: acta.id, estado: 'con_acta' }, { accion: 'adjuntar_acta' });
    for (const o of await obligacionesAbiertas(tx, 'comite_sesion', sesionId, 'ACTA_COMITE')) {
      await plazos.cumplirObligacion(tx, o.id, { fecha: hoy, observacion: `Acta ${acta.codigo} v${acta.version}`, evidenciaDocumentoId: acta.id }, hoy);
    }
  });
  return c.id;
}

async function anularSesion(repo, empresaId, sesionId, motivo) {
  const { s, c } = await sesionDelComite(repo, empresaId, sesionId);
  if (s.estado === 'anulada') throw error(409, 'La sesion ya esta anulada');
  const m = texto(motivo, 500);
  if (!m || m.length < 10) throw r.errorValidacion('Explique por que se anula (minimo 10 caracteres)');
  await repo.transaccion(async (tx) => {
    for (const o of await obligacionesAbiertas(tx, 'comite_sesion', sesionId)) await plazos.anularObligacion(tx, o.id, `Sesion anulada: ${m}`.slice(0, 500));
    await tx.actualizar('comite_sesion', sesionId, { estado: 'anulada', observacion: m }, { accion: 'anular' });
  });
  return c.id;
}

// ---------- Compromisos

async function crearCompromiso(repo, empresaId, sesionId, d) {
  const { s, c } = await sesionDelComite(repo, empresaId, sesionId);
  vigente(c);
  if (s.estado === 'anulada') throw error(409, 'La sesion esta anulada');
  const desc = texto(d.descripcion, 1000);
  const resp = texto(d.responsable, 150);
  if (!desc || desc.length < 5 || !resp) throw r.errorValidacion('Compromiso y responsable son obligatorios');
  const limite = fecha(d.fecha_limite, 'Fecha limite');
  if (limite <= s.fecha) throw r.errorValidacion('La fecha limite debe ser posterior a la sesion');
  await repo.insertar('comite_compromiso', { comite_id: c.id, sesion_id: sesionId, descripcion: desc, responsable: resp, fecha_limite: limite });
  return c.id;
}

async function cerrarCompromiso(repo, empresaId, id, { accion, fecha: f, observacion }, hoy = hoyBogota()) {
  const x = await repo.obtener('comite_compromiso', id);
  if (!x) throw error(404, 'Compromiso no encontrado');
  await obtener(repo, empresaId, x.comite_id);
  if (x.estado !== 'abierto') throw error(409, 'El compromiso ya esta cerrado');
  const obs = texto(observacion, 1000);
  if (!obs || obs.length < 5) throw r.errorValidacion('Describa el cierre');
  if (accion === 'anular') {
    await repo.actualizar('comite_compromiso', id, { estado: 'anulado', observacion: obs }, { accion: 'anular' });
  } else {
    const ff = fecha(f, 'Fecha de cumplimiento');
    if (ff > hoy) throw r.errorValidacion('La fecha de cumplimiento no puede ser futura');
    await repo.actualizar('comite_compromiso', id, { estado: 'cumplido', fecha_cumplimiento: ff, observacion: obs }, { accion: 'cumplir' });
  }
  return x.comite_id;
}

// ---------- Detalle

async function detalle(repo, empresaId, id, hoy = hoyBogota()) {
  const c = await obtener(repo, empresaId, id);
  const t = await tipo(c.tipo);
  const [ms, sesiones, compromisos, obligaciones, historial, actas, eventos] = await Promise.all([
    miembros(repo, id),
    repo.consultar(
      `SELECT s.*, e.codigo AS evento_codigo, d.codigo AS acta_codigo, d.version AS acta_version FROM comite_sesion s
         LEFT JOIN evento e ON e.tenant_id = {tenant} AND e.id = s.evento_id
         LEFT JOIN documento_sst d ON d.tenant_id = {tenant} AND d.id = s.acta_documento_id
        WHERE s.tenant_id = {tenant} AND s.comite_id = ? ORDER BY s.fecha DESC, s.id DESC`, [id],
    ),
    repo.listar('comite_compromiso', { comite_id: id }, { orden: 'fecha_limite' }),
    repo.consultar(
      `SELECT o.plazo_codigo, o.descripcion, o.fecha_limite, o.estado, o.entidad_origen_tipo, o.entidad_origen_id
         FROM obligacion_pendiente o
        WHERE o.tenant_id = {tenant} AND o.estado IN ('en_termino','por_vencer','vencido')
          AND ((o.entidad_origen_tipo = 'comite' AND o.entidad_origen_id = ?)
            OR (o.entidad_origen_tipo = 'comite_sesion' AND o.entidad_origen_id IN
                 (SELECT s2.id FROM comite_sesion s2 WHERE s2.tenant_id = {tenant} AND s2.comite_id = ?)))
        ORDER BY o.fecha_limite`, [id, id],
    ),
    repo.listar('comite', { empresa_id: empresaId, tipo: c.tipo }, { orden: 'periodo_inicio DESC' }),
    repo.consultar(
      "SELECT id, codigo, version, titulo FROM documento_sst WHERE tenant_id = {tenant} AND empresa_id = ? AND tipo_documental = ? AND estado = 'vigente' ORDER BY codigo, version DESC",
      [empresaId, t.documento_tipo],
    ),
    c.tipo === 'convivencia' ? [] : eventosPendientesExtra(repo, empresaId),
  ]);
  const personas = await repo.consultar(
    `SELECT p.id, p.nombres, p.apellidos, p.numero_documento FROM persona p
       JOIN vinculacion v ON v.tenant_id = {tenant} AND v.persona_id = p.id AND v.empresa_id = ? AND v.estado = 'activa'
      WHERE p.tenant_id = {tenant} ORDER BY p.apellidos, p.nombres`, [empresaId],
  );
  const acta = c.acta_documento_id ? await repo.obtener('documento_sst', c.acta_documento_id) : null;
  return {
    c, t, miembros: ms, sesiones, compromisos, obligaciones, historial, actas, eventos, personas, acta,
    conformacion: r.validarConformacion(t, c.trabajadores_base, ms),
    regla: r.conformacionRequerida(t, c.trabajadores_base),
    sinReunion: c.estado === 'vigente' ? r.mesesSinReunion(sesiones, c.periodo_inicio, hoy) : [],
  };
}

/** Tipo del comite al que pertenece un comite, sesion o compromiso de la empresa activa. */
async function tipoComite(repo, empresaId, { comiteId, sesionId, compromisoId }) {
  let id = comiteId;
  if (sesionId) {
    const s = await repo.obtener('comite_sesion', sesionId);
    if (!s) throw error(404, 'Sesion no encontrada');
    id = s.comite_id;
  }
  if (compromisoId) {
    const x = await repo.obtener('comite_compromiso', compromisoId);
    if (!x) throw error(404, 'Compromiso no encontrado');
    id = x.comite_id;
  }
  return (await obtener(repo, empresaId, id)).tipo;
}

module.exports = {
  tipoComite, tipos, panel, conformar, asociarActaConformacion, agregarMiembro, retirarMiembro, registrarSesion, adjuntarActa,
  anularSesion, crearCompromiso, cerrarCompromiso, detalle, eventosPendientesExtra,
};
