// M17: quejas de convivencia con reserva, medidas de proteccion (5 dias habiles), tramite (65 dias),
// consolidado de la bateria psicosocial y estado de la politica antiacoso y del programa de salud mental.
const config = require('../config');
const { hoyBogota } = require('../fechas/calendario');
const plazos = require('../plazos/servicio');
const { error } = require('../comun/rutas');
const r = require('./reglas');

const ENTIDAD = 'queja_convivencia';

async function queja(repo, empresaId, id) {
  const q = await repo.obtener(ENTIDAD, id);
  if (!q || q.empresa_id !== empresaId) throw error(404, 'Queja no encontrada');
  return q;
}

/** Lista sin hechos ni partes: es lo que ve quien no pertenece al comite. */
async function quejas(repo, empresaId) {
  return repo.consultar(
    `SELECT q.id, q.radicado, q.canal, q.fecha_radicacion, q.solicita_proteccion, q.fecha_solicitud_proteccion, q.estado, q.resultado, q.fecha_cierre,
            (SELECT MIN(o.fecha_limite) FROM obligacion_pendiente o WHERE o.tenant_id = {tenant} AND o.entidad_origen_tipo = 'queja_convivencia'
                AND o.entidad_origen_id = q.id AND o.plazo_codigo = 'PROTECCION_ACOSO' AND o.estado IN ('en_termino','por_vencer','vencido')) AS limite_proteccion,
            (SELECT MIN(o.fecha_limite) FROM obligacion_pendiente o WHERE o.tenant_id = {tenant} AND o.entidad_origen_tipo = 'queja_convivencia'
                AND o.entidad_origen_id = q.id AND o.plazo_codigo = 'QUEJA_CONVIVENCIA' AND o.estado IN ('en_termino','por_vencer','vencido')) AS limite_tramite
       FROM queja_convivencia q WHERE q.tenant_id = {tenant} AND q.empresa_id = ? ORDER BY q.fecha_radicacion DESC, q.id DESC`, [empresaId],
  );
}

async function radicar(repo, empresaId, d, hoy = hoyBogota()) {
  const q = r.validarQueja(d, hoy);
  if (q.quejoso_persona_id) {
    const [v] = await repo.listar('vinculacion', { empresa_id: empresaId, persona_id: q.quejoso_persona_id });
    if (!v) throw error(422, 'La persona no tiene vinculacion con la empresa');
  }
  return repo.transaccion(async (tx) => {
    // Serializa las radicaciones de la empresa: el consecutivo no se repite.
    await tx.listar('empresa', { id: empresaId }, { bloquear: true });
    const anio = q.fecha_radicacion.slice(0, 4);
    const [{ n }] = await tx.consultar(
      "SELECT COUNT(*) AS n FROM queja_convivencia WHERE tenant_id = {tenant} AND empresa_id = ? AND radicado LIKE ?", [empresaId, `QC-${anio}-%`],
    );
    const id = await tx.insertar(ENTIDAD, { empresa_id: empresaId, radicado: r.radicado(anio, Number(n) + 1), ...q });
    await plazos.dispararEvento(tx, { evento: 'queja.radicada', fecha: q.fecha_radicacion, empresaId, entidadTipo: ENTIDAD, entidadId: id }, hoy);
    if (q.solicita_proteccion) {
      await plazos.dispararEvento(tx, { evento: 'denuncia.solicitud_proteccion', fecha: q.fecha_radicacion, empresaId, entidadTipo: ENTIDAD, entidadId: id }, hoy);
    }
    return id;
  });
}

/** La victima puede pedir proteccion despues de radicar: arranca el reloj de 5 dias habiles. */
async function solicitarProteccion(repo, empresaId, id, d, hoy = hoyBogota()) {
  const q = await queja(repo, empresaId, id);
  if (q.solicita_proteccion) throw error(409, 'La queja ya tiene solicitud de proteccion');
  if (['cerrada', 'anulada'].includes(q.estado)) throw error(409, 'La queja esta cerrada');
  const f = r.fecha(d.fecha) || hoy;
  if (f > hoy || f < q.fecha_radicacion) throw error(422, 'Fecha de solicitud invalida');
  await repo.transaccion(async (tx) => {
    await tx.actualizar(ENTIDAD, id, { solicita_proteccion: 1, fecha_solicitud_proteccion: f }, { accion: 'solicitar_proteccion' });
    await plazos.dispararEvento(tx, { evento: 'denuncia.solicitud_proteccion', fecha: f, empresaId, entidadTipo: ENTIDAD, entidadId: id }, hoy);
  });
}

/** Medida de proteccion adoptada por el empleador: cumple el reloj de 5 dias habiles. */
async function registrarMedida(repo, empresaId, id, d, hoy = hoyBogota()) {
  const q = await queja(repo, empresaId, id);
  if (!q.solicita_proteccion) throw error(409, 'La queja no tiene solicitud de proteccion');
  if (['cerrada', 'anulada'].includes(q.estado)) throw error(409, 'La queja esta cerrada');
  const f = r.fecha(d.fecha) || hoy;
  const desc = r.texto(d.descripcion, 2000);
  if (f > hoy || f < q.fecha_solicitud_proteccion) throw error(422, 'Fecha de la medida invalida');
  if (!desc || desc.length < 10) throw error(422, 'Describa la medida de proteccion adoptada');
  await repo.transaccion(async (tx) => {
    await tx.insertar('queja_actuacion', { queja_id: id, tipo: 'medida_proteccion', fecha: f, descripcion: desc });
    for (const o of await plazos.abiertasDe(tx, ENTIDAD, id, 'PROTECCION_ACOSO')) {
      await plazos.cumplirObligacion(tx, o.id, { fecha: f, observacion: 'Medida de proteccion adoptada' }, hoy);
    }
  });
}

async function actuar(repo, empresaId, id, d, hoy = hoyBogota()) {
  const q = await queja(repo, empresaId, id);
  if (['cerrada', 'anulada'].includes(q.estado)) throw error(409, 'La queja esta cerrada');
  if (!r.ACTUACIONES.includes(d.tipo)) throw error(422, 'Tipo de actuacion invalido');
  const f = r.fecha(d.fecha) || hoy;
  const desc = r.texto(d.descripcion, 20000);
  if (f > hoy || f < q.fecha_radicacion) throw error(422, 'Fecha de la actuacion invalida');
  if (!desc || desc.length < 10) throw error(422, 'Describa la actuacion');
  await repo.transaccion(async (tx) => {
    await tx.insertar('queja_actuacion', { queja_id: id, tipo: d.tipo, fecha: f, descripcion: desc });
    if (q.estado === 'radicada') await tx.actualizar(ENTIDAD, id, { estado: 'en_tramite' }, { accion: 'tramitar' });
  });
}

async function cerrar(repo, empresaId, id, d, hoy = hoyBogota()) {
  const q = await queja(repo, empresaId, id);
  if (['cerrada', 'anulada'].includes(q.estado)) throw error(409, 'La queja ya esta cerrada');
  if (!r.RESULTADOS.includes(d.resultado)) throw error(422, 'Resultado invalido');
  const f = r.fecha(d.fecha) || hoy;
  const desc = r.texto(d.descripcion, 20000);
  if (f > hoy || f < q.fecha_radicacion) throw error(422, 'Fecha de cierre invalida');
  if (!desc || desc.length < 10) throw error(422, 'Describa el cierre');
  await repo.transaccion(async (tx) => {
    if (q.solicita_proteccion && (await plazos.abiertasDe(tx, ENTIDAD, id, 'PROTECCION_ACOSO')).length) {
      throw error(409, 'Registre primero la medida de proteccion solicitada');
    }
    await tx.insertar('queja_actuacion', { queja_id: id, tipo: 'cierre', fecha: f, descripcion: desc });
    await tx.actualizar(ENTIDAD, id, { estado: 'cerrada', resultado: d.resultado, fecha_cierre: f }, { accion: 'cerrar' });
    for (const o of await plazos.abiertasDe(tx, ENTIDAD, id, 'QUEJA_CONVIVENCIA')) {
      await plazos.cumplirObligacion(tx, o.id, { fecha: f, observacion: `Procedimiento cerrado: ${d.resultado}` }, hoy);
    }
  });
}

async function anular(repo, empresaId, id, motivo) {
  const q = await queja(repo, empresaId, id);
  if (['cerrada', 'anulada'].includes(q.estado)) throw error(409, 'La queja ya esta cerrada');
  const m = r.texto(motivo, 500);
  if (!m || m.length < 10) throw error(422, 'Indique el motivo de la anulacion');
  await repo.transaccion(async (tx) => {
    await tx.actualizar(ENTIDAD, id, { estado: 'anulada', motivo_estado: m }, { accion: 'anular' });
    for (const o of await plazos.abiertasDe(tx, ENTIDAD, id)) await plazos.anularObligacion(tx, o.id, `Queja anulada: ${m}`);
  });
}

/** Detalle con reserva: el comite ve todo; los demas solo radicado, estado y medidas de proteccion. */
async function detalle(repo, empresaId, id, { reserva }) {
  const q = await queja(repo, empresaId, id);
  let actuaciones = await repo.consultar(
    'SELECT tipo, fecha, descripcion, creado_en FROM queja_actuacion WHERE tenant_id = {tenant} AND queja_id = ? ORDER BY fecha, id', [id],
  );
  if (!reserva) {
    for (const k of ['quejoso_persona_id', 'quejoso_nombre', 'implicados', 'hechos', 'tipo_conducta']) delete q[k];
    actuaciones = actuaciones.filter((a) => a.tipo === 'medida_proteccion');
  } else if (q.quejoso_persona_id) {
    const p = await repo.obtener('persona', q.quejoso_persona_id);
    q.quejoso = `${p.nombres} ${p.apellidos}`;
  }
  await repo.auditar('consultar', ENTIDAD, id, null, { reserva });
  return { queja: q, actuaciones };
}

// ---- Bateria psicosocial ----

function grupos(d) {
  const lista = (v) => (Array.isArray(v) ? v : v == null ? [] : [v]);
  const g = lista(d.grupo);
  return g.map((nombre, i) => ({
    grupo: r.texto(nombre, 120), evaluados: Number.parseInt(lista(d.grupo_evaluados)[i], 10),
    intralaboral: lista(d.intralaboral)[i], extralaboral: lista(d.extralaboral)[i], estres: lista(d.estres)[i],
  })).filter((x) => x.grupo || Number.isFinite(x.evaluados));
}

async function registrarPsicosocial(repo, empresaId, d, hoy = hoyBogota()) {
  const e = {
    fecha_aplicacion: r.fecha(d.fecha_aplicacion), psicologo_nombre: r.texto(d.psicologo_nombre, 150), psicologo_licencia: r.texto(d.psicologo_licencia, 60),
    poblacion: Number.parseInt(d.poblacion, 10), evaluados: Number.parseInt(d.evaluados, 10), nivel_general: d.nivel_general,
  };
  if (!e.fecha_aplicacion || e.fecha_aplicacion > hoy) throw error(422, 'Fecha de aplicacion invalida');
  if (!e.psicologo_nombre || !e.psicologo_licencia) throw error(422, 'La bateria la aplica un psicologo con licencia en SST: registre nombre y licencia');
  if (!(e.poblacion > 0) || !(e.evaluados > 0) || e.evaluados > e.poblacion) throw error(422, 'Poblacion y evaluados invalidos');
  if (!r.NIVELES.includes(e.nivel_general)) throw error(422, 'Nivel de riesgo general invalido');
  const gs = grupos(d);
  r.validarGrupos(gs, e.evaluados, config.psicosocialMinGrupo);
  const doc = d.documento_id ? await repo.obtener('documento_sst', Number.parseInt(d.documento_id, 10)) : null;
  if (!doc || doc.empresa_id !== empresaId || doc.tipo_documental !== 'INFORME_PSICOSOCIAL' || doc.estado !== 'vigente') {
    throw error(422, 'Asocie el informe consolidado firmado por el psicologo (documento INFORME_PSICOSOCIAL vigente)');
  }
  const codigo = r.vencimientoPsicosocial(e.nivel_general);
  return repo.transaccion(async (tx) => {
    for (const previa of await tx.listar('evaluacion_psicosocial', { empresa_id: empresaId, estado: 'vigente' })) {
      await tx.actualizar('evaluacion_psicosocial', previa.id, { estado: 'reemplazada' }, { accion: 'reemplazar' });
    }
    // Si cambio el nivel, la obligacion de la periodicidad anterior queda cumplida por esta aplicacion.
    for (const o of await plazos.abiertasDe(tx, 'empresa', empresaId)) {
      if (['PSICOSOCIAL_ALTO', 'PSICOSOCIAL_MEDIO'].includes(o.plazo_codigo) && o.plazo_codigo !== codigo) {
        await plazos.cumplirObligacion(tx, o.id, { fecha: e.fecha_aplicacion, observacion: 'Nueva aplicacion de la bateria', evidenciaDocumentoId: doc.id }, hoy);
      }
    }
    const v = await plazos.registrarVigencia(tx, {
      vencimientoCodigo: codigo, empresaId, entidadTipo: 'empresa', entidadId: empresaId, fechaInicio: e.fecha_aplicacion, evidenciaDocumentoId: doc.id,
    }, hoy);
    const id = await tx.insertar('evaluacion_psicosocial', { empresa_id: empresaId, ...e, documento_id: doc.id, proxima: v.fecha_limite });
    for (const g of gs) await tx.insertar('evaluacion_psicosocial_grupo', { evaluacion_id: id, ...g });
    return id;
  });
}

async function anularPsicosocial(repo, empresaId, id, motivo) {
  const e = await repo.obtener('evaluacion_psicosocial', id);
  if (!e || e.empresa_id !== empresaId) throw error(404, 'Evaluacion no encontrada');
  if (e.estado !== 'vigente') throw error(409, 'Solo se anula la evaluacion vigente');
  const m = r.texto(motivo, 500);
  if (!m || m.length < 10) throw error(422, 'Indique el motivo de la anulacion');
  await repo.actualizar('evaluacion_psicosocial', id, { estado: 'anulada', motivo_estado: m }, { accion: 'anular' });
}

async function psicosocial(repo, empresaId) {
  const evaluaciones = await repo.consultar(
    `SELECT e.*, d.codigo AS documento_codigo FROM evaluacion_psicosocial e JOIN documento_sst d ON d.tenant_id = {tenant} AND d.id = e.documento_id
      WHERE e.tenant_id = {tenant} AND e.empresa_id = ? ORDER BY e.fecha_aplicacion DESC, e.id DESC`, [empresaId],
  );
  const vigente = evaluaciones.find((e) => e.estado === 'vigente') || null;
  const gruposVigente = vigente ? await repo.listar('evaluacion_psicosocial_grupo', { evaluacion_id: vigente.id }) : [];
  return { evaluaciones, vigente, grupos: gruposVigente, minimo: config.psicosocialMinGrupo };
}

/** Politica antiacoso (D. 1040/2026) y programa de salud mental (D. 0728/2025): documento vigente y vencimiento. */
async function documentosBase(repo, empresaId) {
  const filas = await repo.consultar(
    `SELECT t.codigo AS tipo, t.nombre, t.origen_articulo, d.id, d.codigo, d.version, d.fecha_documento, d.fecha_vence
       FROM tipo_documental t
       LEFT JOIN documento_sst d ON d.tenant_id = {tenant} AND d.empresa_id = ? AND d.tipo_documental = t.codigo AND d.estado = 'vigente'
      WHERE t.codigo IN ('PROTOCOLO_ACOSO','PROG_SALUD_MENTAL') ORDER BY t.codigo`, [empresaId],
  );
  return filas;
}

module.exports = {
  quejas, radicar, solicitarProteccion, registrarMedida, actuar, cerrar, anular, detalle,
  registrarPsicosocial, anularPsicosocial, psicosocial, documentosBase,
};
