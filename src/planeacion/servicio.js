// M06: plan de trabajo anual (objetivos, cronograma, presupuesto) y gestion del cambio.
const { consultarCatalogo } = require('../db/global');
const cuentas = require('../db/cuentas');
const { hoyBogota } = require('../fechas/calendario');
const autoevaluacion = require('../autoevaluacion/servicio');
const { error } = require('../comun/rutas');
const r = require('./reglas');

const texto = (v, max) => { const s = String(v ?? '').trim(); return s ? s.slice(0, max) : null; };
const fecha = (v, nombre) => {
  const f = String(v || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(f)) throw error(422, `${nombre} invalida`);
  return f;
};
const dinero = (v, nombre) => {
  if (String(v ?? '').includes('-')) throw error(422, `${nombre} invalido`);
  const n = Number(String(v ?? '0').replace(/[^\d.]/g, ''));
  if (!Number.isFinite(n) || n < 0 || n > 999999999999) throw error(422, `${nombre} invalido`);
  return r.pesos(r.cent(n));
};
const CICLOS = ['PLANEAR', 'HACER', 'VERIFICAR', 'ACTUAR'];

async function planes(repo, empresaId) {
  return repo.listar('plan_anual', { empresa_id: empresaId }, { orden: 'vigencia_anio DESC' });
}

async function obtener(repo, empresaId, id) {
  const p = await repo.obtener('plan_anual', id);
  if (!p || p.empresa_id !== empresaId) throw error(404, 'Plan no encontrado');
  return p;
}

const abierto = (p) => {
  if (p.estado === 'cerrado') throw error(409, 'El plan esta cerrado');
  return p;
};

async function crear(repo, empresaId, d) {
  const vigencia = Number.parseInt(d.vigencia_anio, 10);
  if (!(vigencia >= 2019 && vigencia <= 2100)) throw error(422, 'Vigencia invalida');
  const [previo] = await repo.listar('plan_anual', { empresa_id: empresaId, vigencia_anio: vigencia });
  if (previo) throw error(409, 'Ya existe el plan de esa vigencia');
  return repo.insertar('plan_anual', { empresa_id: empresaId, vigencia_anio: vigencia, presupuesto_total: dinero(d.presupuesto_total, 'Presupuesto') });
}

async function detalle(repo, empresaId, id, hoy = hoyBogota()) {
  const p = await obtener(repo, empresaId, id);
  const [objetivos, actividades, indicadores, capaPendientes] = await Promise.all([
    repo.listar('plan_objetivo', { plan_id: id, estado: 'activo' }, { orden: 'id' }),
    repo.listar('plan_actividad', { plan_id: id }, { orden: 'fecha_fin' }),
    consultarCatalogo("SELECT codigo, nombre, tipo FROM indicador_catalogo WHERE estado = 'activo' ORDER BY tipo, nombre"),
    repo.consultar(
      `SELECT a.id, a.referencia, a.descripcion, a.fecha_limite, a.origen FROM accion_mejora a
        WHERE a.tenant_id = {tenant} AND a.empresa_id = ? AND a.estado = 'abierta'
          AND a.id NOT IN (SELECT pa.accion_mejora_id FROM plan_actividad pa WHERE pa.tenant_id = {tenant} AND pa.accion_mejora_id IS NOT NULL)
        ORDER BY a.fecha_limite`, [empresaId],
    ),
  ]);
  const documento = p.documento_id ? await repo.obtener('documento_sst', p.documento_id) : null;
  const nombres = await cuentas.nombresUsuarios(actividades.map((a) => a.responsable_id));
  const presupuestoActividades = r.pesos(actividades.filter((a) => a.estado !== 'cancelada').reduce((s, a) => s + r.cent(a.presupuesto), 0));
  return {
    p, objetivos, indicadores, capaPendientes, documento,
    actividades: actividades.map((a) => ({ ...a, responsable: a.responsable_id ? nombres.get(a.responsable_id) : a.responsable_texto, vencida: a.estado === 'programada' && a.fecha_fin < hoy })),
    avance: r.avance(actividades, hoy),
    impedimentos: r.impedimentosAprobar(p, objetivos, actividades, documento && documento.estado === 'vigente' ? documento : null, presupuestoActividades),
  };
}

async function guardarPresupuesto(repo, empresaId, id, d) {
  const p = abierto(await obtener(repo, empresaId, id));
  if (p.estado !== 'borrador') throw error(409, 'El presupuesto se ajusta antes de aprobar el plan');
  await repo.actualizar('plan_anual', id, { presupuesto_total: dinero(d.presupuesto_total, 'Presupuesto') }, { accion: 'presupuesto' });
}

async function agregarObjetivo(repo, empresaId, id, d) {
  const p = abierto(await obtener(repo, empresaId, id));
  if (p.estado !== 'borrador') throw error(409, 'Los objetivos se definen antes de aprobar el plan');
  const desc = texto(d.descripcion, 500);
  const meta = texto(d.meta, 255);
  if (!desc || !meta) throw error(422, 'Objetivo y meta son obligatorios');
  if (d.indicador_codigo) {
    const [ind] = await consultarCatalogo('SELECT codigo FROM indicador_catalogo WHERE codigo = ?', [String(d.indicador_codigo)]);
    if (!ind) throw error(422, 'Indicador invalido');
  }
  await repo.insertar('plan_objetivo', { plan_id: id, descripcion: desc, meta, indicador_codigo: d.indicador_codigo || null });
}

async function responsable(repo, d) {
  const uid = d.responsable_id ? Number.parseInt(d.responsable_id, 10) : null;
  if (uid && !(await cuentas.usuarioEnTenant(repo.tenantId, uid))) throw error(422, 'Responsable invalido');
  const txt = texto(d.responsable_texto, 150);
  if (!uid && !txt) throw error(422, 'Indique el responsable');
  return { responsable_id: uid, responsable_texto: uid ? null : txt };
}

async function agregarActividad(repo, empresaId, id, d) {
  const p = abierto(await obtener(repo, empresaId, id));
  const desc = texto(d.descripcion, 500);
  if (!desc || desc.length < 5) throw error(422, 'Describa la actividad');
  if (!CICLOS.includes(d.ciclo)) throw error(422, 'Ciclo PHVA invalido');
  const inicio = fecha(d.fecha_inicio, 'Fecha de inicio');
  const fin = fecha(d.fecha_fin, 'Fecha de fin');
  if (fin < inicio) throw error(422, 'La fecha de fin es anterior al inicio');
  if (Number(inicio.slice(0, 4)) !== Number(p.vigencia_anio) && Number(fin.slice(0, 4)) !== Number(p.vigencia_anio)) throw error(422, 'La actividad debe estar dentro de la vigencia del plan');
  const objetivoId = d.objetivo_id ? Number.parseInt(d.objetivo_id, 10) : null;
  if (objetivoId) {
    const o = await repo.obtener('plan_objetivo', objetivoId);
    if (!o || o.plan_id !== id) throw error(422, 'Objetivo invalido');
  }
  await repo.insertar('plan_actividad', {
    plan_id: id, objetivo_id: objetivoId, descripcion: desc, ciclo: d.ciclo, ...(await responsable(repo, d)),
    fecha_inicio: inicio, fecha_fin: fin, recursos: texto(d.recursos, 500), presupuesto: dinero(d.presupuesto, 'Presupuesto'),
  });
}

/** Trae al cronograma las acciones abiertas de la CAPA (autoevaluacion, investigaciones...). */
async function importarCapa(repo, empresaId, id) {
  const det = await detalle(repo, empresaId, id);
  abierto(det.p);
  const hoy = hoyBogota();
  let n = 0;
  await repo.transaccion(async (tx) => {
    for (const a of det.capaPendientes) {
      const x = await tx.obtener('accion_mejora', a.id);
      await tx.insertar('plan_actividad', {
        plan_id: id, descripcion: `[${a.referencia || a.origen}] ${a.descripcion}`.slice(0, 500), ciclo: 'ACTUAR',
        responsable_id: x.responsable_id, responsable_texto: x.responsable_id ? null : 'Por asignar',
        fecha_inicio: hoy < a.fecha_limite ? hoy : a.fecha_limite, fecha_fin: a.fecha_limite, origen: 'capa', accion_mejora_id: a.id,
      });
      n += 1;
    }
  });
  return n;
}

/** Ejecuta o cancela una actividad; si viene de la CAPA, la accion se cierra con la misma evidencia. */
async function cerrarActividad(repo, empresaId, actividadId, d, hoy = hoyBogota()) {
  const a = await repo.obtener('plan_actividad', actividadId);
  if (!a) throw error(404, 'Actividad no encontrada');
  abierto(await obtener(repo, empresaId, a.plan_id));
  if (a.estado !== 'programada') throw error(409, 'La actividad ya esta cerrada');
  const obs = texto(d.observacion, 1000);
  if (!obs || obs.length < 5) throw error(422, 'Registre la observacion');
  if (d.accion === 'cancelar') {
    await repo.actualizar('plan_actividad', actividadId, { estado: 'cancelada', observacion: obs }, { accion: 'cancelar' });
    return a.plan_id;
  }
  const f = fecha(d.fecha || hoy, 'Fecha de ejecucion');
  if (f > hoy) throw error(422, 'La fecha de ejecucion no puede ser futura');
  const docId = d.evidencia_documento_id ? Number.parseInt(d.evidencia_documento_id, 10) : null;
  if (docId) {
    const doc = await repo.obtener('documento_sst', docId);
    if (!doc || doc.empresa_id !== empresaId) throw error(422, 'Evidencia invalida');
  }
  await repo.transaccion(async (tx) => {
    await tx.actualizar('plan_actividad', actividadId, { estado: 'ejecutada', fecha_ejecucion: f, observacion: obs, evidencia_documento_id: docId }, { accion: 'ejecutar' });
    if (a.accion_mejora_id) {
      const x = await tx.obtener('accion_mejora', a.accion_mejora_id);
      if (x && x.estado === 'abierta') await autoevaluacion.cerrarAccion(tx, empresaId, x.id, { fecha: f, observacion: `Plan de trabajo: ${obs}` }, hoy);
    }
  });
  return a.plan_id;
}

async function reprogramar(repo, empresaId, actividadId, d) {
  const a = await repo.obtener('plan_actividad', actividadId);
  if (!a) throw error(404, 'Actividad no encontrada');
  abierto(await obtener(repo, empresaId, a.plan_id));
  if (a.estado !== 'programada') throw error(409, 'La actividad ya esta cerrada');
  const fin = fecha(d.fecha_fin, 'Nueva fecha de fin');
  const motivo = texto(d.motivo, 500);
  if (!motivo) throw error(422, 'Explique la reprogramacion');
  if (fin < a.fecha_inicio) throw error(422, 'La nueva fecha es anterior al inicio');
  await repo.actualizar('plan_actividad', actividadId, { fecha_fin: fin, observacion: `Reprogramada: ${motivo}` }, { accion: 'reprogramar' });
  return a.plan_id;
}

async function aprobar(repo, empresaId, id, d, hoy = hoyBogota()) {
  const det = await detalle(repo, empresaId, id);
  let doc = det.documento;
  if (d.documento_id) {
    doc = await repo.obtener('documento_sst', Number.parseInt(d.documento_id, 10));
    if (!doc || doc.empresa_id !== empresaId || doc.tipo_documental !== 'PLAN_ANUAL') throw error(422, 'El documento debe ser de tipo PLAN_ANUAL');
  }
  const imp = r.impedimentosAprobar(det.p, det.objetivos, det.actividades, doc && doc.estado === 'vigente' ? doc : null,
    r.pesos(det.actividades.filter((a) => a.estado !== 'cancelada').reduce((s, a) => s + r.cent(a.presupuesto), 0)));
  if (imp.length) throw error(422, imp.join('. '));
  await repo.actualizar('plan_anual', id, { estado: 'aprobado', documento_id: doc.id, aprobado_en: hoy, aprobado_por: repo.actor.id ?? null }, { accion: 'aprobar' });
}

async function cerrarPlan(repo, empresaId, id) {
  const p = await obtener(repo, empresaId, id);
  if (p.estado !== 'aprobado') throw error(409, 'Solo se cierra un plan aprobado');
  await repo.actualizar('plan_anual', id, { estado: 'cerrado' }, { accion: 'cerrar' });
}

// ---------- Gestion del cambio

async function cambios(repo, empresaId) {
  return repo.listar('gestion_cambio', { empresa_id: empresaId }, { orden: 'fecha_prevista DESC' });
}

async function registrarCambio(repo, empresaId, d) {
  const tipos = ['proceso', 'instalacion', 'maquinaria', 'organizacional', 'legal', 'otro'];
  if (!tipos.includes(d.tipo)) throw error(422, 'Tipo de cambio invalido');
  const desc = texto(d.descripcion, 1000);
  if (!desc || desc.length < 10) throw error(422, 'Describa el cambio');
  return repo.insertar('gestion_cambio', {
    empresa_id: empresaId, tipo: d.tipo, descripcion: desc, fecha_prevista: fecha(d.fecha_prevista, 'Fecha prevista'),
    responsable_texto: texto(d.responsable_texto, 150),
  });
}

/** Evaluar (impacto SST obligatorio antes de aprobar), aprobar, implementar o rechazar. */
async function avanzarCambio(repo, empresaId, id, d, hoy = hoyBogota()) {
  const c = await repo.obtener('gestion_cambio', id);
  if (!c || c.empresa_id !== empresaId) throw error(404, 'Cambio no encontrado');
  const accion = String(d.accion || '');
  if (accion === 'evaluar' || accion === 'aprobar') {
    if (c.estado !== 'en_evaluacion') throw error(409, 'El cambio ya fue evaluado');
    const impacto = texto(d.impacto_sst, 2000) || c.impacto_sst;
    if (!impacto || impacto.length < 20) throw error(422, 'Registre la evaluacion del impacto en SST antes de aprobar');
    await repo.actualizar('gestion_cambio', id, {
      impacto_sst: impacto, actualiza_peligros: d.actualiza_peligros === '1' ? 1 : 0, requiere_capacitacion: d.requiere_capacitacion === '1' ? 1 : 0,
      estado: accion === 'aprobar' ? 'aprobado' : 'en_evaluacion',
    }, { accion });
  } else if (accion === 'implementar') {
    if (c.estado !== 'aprobado') throw error(409, 'Solo se implementa un cambio aprobado');
    await repo.actualizar('gestion_cambio', id, { estado: 'implementado', fecha_implementacion: hoy, observacion: texto(d.observacion, 1000) }, { accion: 'implementar' });
  } else if (accion === 'rechazar') {
    if (!['en_evaluacion', 'aprobado'].includes(c.estado)) throw error(409, 'El cambio ya esta cerrado');
    await repo.actualizar('gestion_cambio', id, { estado: 'rechazado', observacion: texto(d.observacion, 1000) || 'Rechazado' }, { accion: 'rechazar' });
  } else throw error(422, 'Accion invalida');
}

module.exports = {
  planes, crear, detalle, guardarPresupuesto, agregarObjetivo, agregarActividad, importarCapa, cerrarActividad,
  reprogramar, aprobar, cerrarPlan, cambios, registrarCambio, avanzarCambio,
};
