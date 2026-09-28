// M15: permisos de trabajo de alto riesgo. La emision se bloquea si un ejecutor no tiene certificacion
// vigente, concepto de aptitud vigente o induccion; la verificacion queda congelada en cada ejecutor.
const { consultarCatalogo } = require('../db/global');
const { hoyBogota } = require('../fechas/calendario');
const { error } = require('../comun/rutas');

const APTOS = ['apto', 'apto_con_restricciones'];
const fecha = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) ? String(v) : null);
const hora = (v) => (/^\d{2}:\d{2}$/.test(String(v || '')) ? String(v) : null);
const texto = (v, max) => { const s = String(v ?? '').trim(); return s ? s.slice(0, max) : null; };
const lista = (v) => (Array.isArray(v) ? v : v == null ? [] : [v]);

async function tipos() {
  const filas = await consultarCatalogo(
    `SELECT p.*, c.nombre AS competencia FROM permiso_tipo p LEFT JOIN competencia_tipo c ON c.codigo = p.competencia_codigo
      WHERE p.estado = 'activo' ORDER BY p.nombre`,
  );
  return filas.map((t) => ({ ...t, verificaciones: typeof t.verificaciones === 'string' ? JSON.parse(t.verificaciones) : t.verificaciones }));
}

async function tipo(codigo) {
  const t = (await tipos()).find((x) => x.codigo === codigo);
  if (!t) throw error(422, 'Tipo de permiso invalido');
  return t;
}

/** Evalua certificacion, aptitud e induccion de una persona para la fecha del trabajo. */
function evaluar({ tipoPermiso, competencia, concepto, induccion }, f) {
  const r = { certificacion: { ok: true, detalle: 'No exige certificacion' }, aptitud: {}, induccion: {}, advertencias: [] };
  if (tipoPermiso.competencia_codigo) {
    if (!competencia) r.certificacion = { ok: false, detalle: `Sin ${tipoPermiso.competencia || tipoPermiso.competencia_codigo} vigente` };
    else if (competencia.fecha_vence && competencia.fecha_vence < f) r.certificacion = { ok: false, detalle: `${tipoPermiso.competencia} vencida el ${competencia.fecha_vence}` };
    else r.certificacion = { ok: true, detalle: `${tipoPermiso.competencia} desde ${competencia.fecha_obtencion}${competencia.fecha_vence ? `, vence ${competencia.fecha_vence}` : ''}` };
  }
  if (!concepto) r.aptitud = { ok: false, detalle: 'Sin concepto de aptitud medica' };
  else if (!APTOS.includes(concepto.concepto)) r.aptitud = { ok: false, detalle: `Concepto ${concepto.concepto} del ${concepto.fecha_examen}` };
  else if (concepto.proximo_examen && concepto.proximo_examen < f) r.aptitud = { ok: false, detalle: `Examen periodico vencido desde ${concepto.proximo_examen}` };
  else {
    r.aptitud = { ok: true, detalle: `${concepto.concepto} del ${concepto.fecha_examen}` };
    if (concepto.concepto === 'apto_con_restricciones') r.advertencias.push(`Restricciones: ${concepto.restricciones || 'ver concepto'}`);
  }
  r.induccion = induccion ? { ok: true, detalle: `Induccion del ${induccion.fecha_obtencion}` } : { ok: false, detalle: 'Sin induccion registrada' };
  r.ok = r.certificacion.ok && r.aptitud.ok && r.induccion.ok;
  return r;
}

async function verificarPersona(repo, empresaId, personaId, tipoPermiso, f) {
  const [v] = await repo.listar('vinculacion', { empresa_id: empresaId, persona_id: personaId, estado: 'activa' });
  if (!v) throw error(422, 'La persona no tiene vinculacion activa con la empresa');
  const comp = (t) => repo.consultar(
    `SELECT fecha_obtencion, fecha_vence FROM competencia WHERE tenant_id = {tenant} AND empresa_id = ? AND persona_id = ? AND tipo = ? AND estado = 'vigente'
      ORDER BY fecha_obtencion DESC LIMIT 1`, [empresaId, personaId, t],
  );
  const [[competencia], [concepto], [induccion]] = await Promise.all([
    tipoPermiso.competencia_codigo ? comp(tipoPermiso.competencia_codigo) : [],
    repo.consultar(
      `SELECT concepto, fecha_examen, proximo_examen, restricciones FROM evaluacion_medica
        WHERE tenant_id = {tenant} AND empresa_id = ? AND persona_id = ? AND estado = 'con_concepto' AND fecha_examen <= ?
        ORDER BY fecha_examen DESC, id DESC LIMIT 1`, [empresaId, personaId, f],
    ),
    comp('INDUCCION'),
  ]);
  return evaluar({ tipoPermiso, competencia, concepto, induccion }, f);
}

async function emitir(repo, empresaId, d, hoy = hoyBogota()) {
  const t = await tipo(d.tipo_codigo);
  const p = {
    fecha: fecha(d.fecha), hora_inicio: hora(d.hora_inicio), hora_fin: hora(d.hora_fin), lugar: texto(d.lugar, 200),
    tarea: texto(d.tarea, 5000), ats: texto(d.ats, 10000), supervisor: texto(d.supervisor, 150),
  };
  if (!p.fecha || p.fecha < hoy) throw error(422, 'El permiso se emite para hoy o una fecha futura');
  if (!p.hora_inicio || !p.hora_fin || p.hora_fin <= p.hora_inicio) throw error(422, 'Horario invalido');
  if (!p.lugar || !p.tarea || !p.supervisor) throw error(422, 'Lugar, tarea y supervisor son obligatorios');
  if (!p.ats || p.ats.length < 30) throw error(422, 'El analisis de trabajo seguro (peligros y controles) es obligatorio');
  const marcadas = new Set(lista(d.verificacion).map(String));
  const faltan = t.verificaciones.filter((_, i) => !marcadas.has(String(i)));
  if (faltan.length) throw error(422, `Verificacion previa incompleta: ${faltan.join('; ')}`);
  const ejecutores = [...new Set(lista(d.ejecutor).map((x) => Number.parseInt(x, 10)).filter(Boolean))];
  if (!ejecutores.length) throw error(422, 'Seleccione al menos un ejecutor');

  const verificaciones = [];
  for (const personaId of ejecutores) {
    const v = await verificarPersona(repo, empresaId, personaId, t, p.fecha);
    verificaciones.push({ personaId, v });
  }
  const bloqueados = verificaciones.filter((x) => !x.v.ok);
  if (bloqueados.length) {
    const nombres = await Promise.all(bloqueados.map(async (b) => {
      const per = await repo.obtener('persona', b.personaId);
      const motivos = ['certificacion', 'aptitud', 'induccion'].filter((k) => !b.v[k].ok).map((k) => b.v[k].detalle);
      return `${per.nombres} ${per.apellidos}: ${motivos.join(', ')}`;
    }));
    throw error(422, `No se puede emitir el permiso. ${nombres.join(' | ')}`);
  }
  let doc = null;
  if (d.documento_id) {
    doc = await repo.obtener('documento_sst', Number.parseInt(d.documento_id, 10));
    if (!doc || doc.empresa_id !== empresaId || doc.tipo_documental !== t.documento_tipo || doc.estado !== 'vigente') throw error(422, 'Formato de permiso invalido');
  }
  let centro = null;
  if (d.centro_trabajo_id) {
    const c = await repo.obtener('centro_trabajo', Number.parseInt(d.centro_trabajo_id, 10));
    if (!c || c.empresa_id !== empresaId) throw error(422, 'Centro de trabajo invalido');
    centro = c.id;
  }
  return repo.transaccion(async (tx) => {
    const anio = p.fecha.slice(0, 4);
    const [{ n }] = await tx.consultar("SELECT COUNT(*) AS n FROM permiso_trabajo WHERE tenant_id = {tenant} AND empresa_id = ? AND numero LIKE ?", [empresaId, `PT-${anio}-%`]);
    const id = await tx.insertar('permiso_trabajo', {
      empresa_id: empresaId, centro_trabajo_id: centro, tipo_codigo: t.codigo, numero: `PT-${anio}-${String(Number(n) + 1).padStart(4, '0')}`, ...p,
      verificaciones: t.verificaciones.map((item) => ({ item, verificado: true })), documento_id: doc ? doc.id : null,
    });
    for (const x of verificaciones) await tx.insertar('permiso_ejecutor', { permiso_id: id, persona_id: x.personaId, verificacion: x.v });
    return id;
  });
}

async function permiso(repo, empresaId, id) {
  const p = await repo.obtener('permiso_trabajo', id);
  if (!p || p.empresa_id !== empresaId) throw error(404, 'Permiso no encontrado');
  return p;
}

async function cambiarEstado(repo, empresaId, id, estado, observacion) {
  const p = await permiso(repo, empresaId, id);
  const permitido = { cerrado: ['emitido', 'suspendido'], suspendido: ['emitido'], anulado: ['emitido', 'suspendido'] };
  if (!permitido[estado] || !permitido[estado].includes(p.estado)) throw error(409, `No se puede pasar de ${p.estado} a ${estado}`);
  const obs = texto(observacion, 1000);
  if (!obs || obs.length < 5) throw error(422, 'Registre la observacion');
  await repo.actualizar('permiso_trabajo', id, {
    estado, cierre_observacion: obs, ...(estado === 'cerrado' ? { cerrado_en: new Date() } : {}),
  }, { accion: estado });
}

async function listar(repo, empresaId, desde) {
  return repo.consultar(
    `SELECT p.id, p.numero, p.tipo_codigo, p.fecha, p.hora_inicio, p.hora_fin, p.lugar, p.supervisor, p.estado,
            (SELECT COUNT(*) FROM permiso_ejecutor e WHERE e.tenant_id = {tenant} AND e.permiso_id = p.id) AS ejecutores
       FROM permiso_trabajo p WHERE p.tenant_id = {tenant} AND p.empresa_id = ? AND p.fecha >= ? ORDER BY p.fecha DESC, p.id DESC`, [empresaId, desde],
  );
}

async function detalle(repo, empresaId, id) {
  const p = await permiso(repo, empresaId, id);
  const ejecutores = await repo.consultar(
    `SELECT e.persona_id, e.verificacion, x.nombres, x.apellidos, x.numero_documento FROM permiso_ejecutor e
       JOIN persona x ON x.tenant_id = {tenant} AND x.id = e.persona_id
      WHERE e.tenant_id = {tenant} AND e.permiso_id = ? ORDER BY x.apellidos`, [id],
  );
  const parse = (v) => (typeof v === 'string' ? JSON.parse(v) : v);
  return {
    permiso: { ...p, verificaciones: parse(p.verificaciones) },
    ejecutores: ejecutores.map((e) => ({ ...e, verificacion: parse(e.verificacion) })),
    tipo: await tipo(p.tipo_codigo),
  };
}

module.exports = { tipos, evaluar, verificarPersona, emitir, cambiarEstado, listar, detalle };
