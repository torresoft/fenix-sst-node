// M13: brigada, equipos de emergencia con vencimiento, simulacros con evaluacion y documentos del plan.
const { consultarCatalogo } = require('../db/global');
const { hoyBogota, sumarMeses, sumarDias } = require('../fechas/calendario');
const plazos = require('../plazos/servicio');
const capa = require('../capa/servicio');
const { error } = require('../comun/rutas');

const ROLES_BRIGADA = ['jefe', 'primeros_auxilios', 'evacuacion', 'contra_incendio', 'comunicaciones'];
const DIAS_POR_VENCER = 30;
const fecha = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) ? String(v) : null);
const texto = (v, max) => { const s = String(v ?? '').trim(); return s ? s.slice(0, max) : null; };
const entero = (v) => { const n = Number.parseInt(v, 10); return Number.isSafeInteger(n) && n >= 0 ? n : null; };

const tiposEquipo = () => consultarCatalogo("SELECT codigo, nombre, meses_vigencia FROM equipo_tipo WHERE estado = 'activo' ORDER BY nombre");

function estadoVencimiento(vence, hoy) {
  if (vence < hoy) return 'vencido';
  return vence <= sumarDias(hoy, DIAS_POR_VENCER) ? 'por_vencer' : 'vigente';
}

async function vinculada(repo, empresaId, personaId) {
  const [v] = await repo.listar('vinculacion', { empresa_id: empresaId, persona_id: personaId, estado: 'activa' });
  if (!v) throw error(422, 'La persona no tiene vinculacion activa con la empresa');
}

async function centroDeEmpresa(repo, empresaId, centroId) {
  if (!centroId) return null;
  const c = await repo.obtener('centro_trabajo', Number.parseInt(centroId, 10));
  if (!c || c.empresa_id !== empresaId) throw error(422, 'Centro de trabajo invalido');
  return c.id;
}

// ---- Brigada ----

async function designar(repo, empresaId, d, hoy = hoyBogota()) {
  const personaId = Number.parseInt(d.persona_id, 10);
  if (!ROLES_BRIGADA.includes(d.rol)) throw error(422, 'Rol de brigada invalido');
  const f = fecha(d.fecha_designacion) || hoy;
  if (f > hoy) throw error(422, 'La designacion no puede ser futura');
  await vinculada(repo, empresaId, personaId);
  const [ya] = await repo.listar('brigada_miembro', { empresa_id: empresaId, persona_id: personaId, rol: d.rol, estado: 'activo' });
  if (ya) throw error(409, 'La persona ya tiene ese rol en la brigada');
  return repo.insertar('brigada_miembro', { empresa_id: empresaId, persona_id: personaId, rol: d.rol, fecha_designacion: f });
}

async function retirar(repo, empresaId, id, hoy = hoyBogota()) {
  const m = await repo.obtener('brigada_miembro', id);
  if (!m || m.empresa_id !== empresaId) throw error(404, 'Brigadista no encontrado');
  if (m.estado !== 'activo') throw error(409, 'Ya fue retirado');
  await repo.actualizar('brigada_miembro', id, { estado: 'retirado', fecha_retiro: hoy }, { accion: 'retirar' });
}

// ---- Equipos ----

async function registrarEquipo(repo, empresaId, d, hoy = hoyBogota()) {
  const tipo = (await tiposEquipo()).find((t) => t.codigo === d.tipo_codigo);
  if (!tipo) throw error(422, 'Tipo de equipo invalido');
  const codigo = texto(d.codigo, 40);
  const ubicacion = texto(d.ubicacion, 150);
  if (!codigo || !ubicacion) throw error(422, 'Codigo y ubicacion son obligatorios');
  const ultima = fecha(d.fecha_ultima) || hoy;
  if (ultima > hoy) throw error(422, 'La ultima recarga o revision no puede ser futura');
  const vence = fecha(d.fecha_vence) || sumarMeses(ultima, tipo.meses_vigencia);
  if (vence <= ultima) throw error(422, 'El vencimiento debe ser posterior a la ultima revision');
  const [dup] = await repo.listar('equipo_emergencia', { empresa_id: empresaId, codigo });
  if (dup) throw error(409, `Ya existe el equipo ${codigo}`);
  const centro = await centroDeEmpresa(repo, empresaId, d.centro_trabajo_id);
  return repo.transaccion(async (tx) => {
    const id = await tx.insertar('equipo_emergencia', {
      empresa_id: empresaId, centro_trabajo_id: centro, tipo_codigo: tipo.codigo, codigo, ubicacion, capacidad: texto(d.capacidad, 60), fecha_vence: vence,
    });
    await plazos.registrarVigencia(tx, {
      vencimientoCodigo: 'EQUIPO_EMERGENCIA', empresaId, entidadTipo: 'equipo_emergencia', entidadId: id, fechaInicio: ultima, fechaLimite: vence,
    }, hoy);
    return id;
  });
}

async function equipo(repo, empresaId, id) {
  const e = await repo.obtener('equipo_emergencia', id);
  if (!e || e.empresa_id !== empresaId) throw error(404, 'Equipo no encontrado');
  return e;
}

/** Revision o recarga. Si deja el equipo conforme con nuevo vencimiento, renueva la obligacion. */
async function revisarEquipo(repo, empresaId, id, d, hoy = hoyBogota()) {
  const e = await equipo(repo, empresaId, id);
  if (e.estado !== 'activo') throw error(409, 'El equipo esta dado de baja');
  if (!['inspeccion', 'recarga', 'mantenimiento', 'reposicion'].includes(d.tipo)) throw error(422, 'Tipo de revision invalido');
  if (!['conforme', 'no_conforme'].includes(d.resultado)) throw error(422, 'Resultado invalido');
  const f = fecha(d.fecha) || hoy;
  if (f > hoy) throw error(422, 'La fecha no puede ser futura');
  let nueva = fecha(d.nueva_fecha_vence);
  if (!nueva && d.tipo !== 'inspeccion' && d.resultado === 'conforme') {
    const tipo = (await tiposEquipo()).find((t) => t.codigo === e.tipo_codigo);
    nueva = sumarMeses(f, tipo.meses_vigencia);
  }
  if (nueva && nueva <= f) throw error(422, 'El nuevo vencimiento debe ser posterior a la revision');
  if (d.resultado === 'no_conforme' && !texto(d.observacion, 1000)) throw error(422, 'Describa la no conformidad');
  await repo.transaccion(async (tx) => {
    await tx.insertar('equipo_revision', { equipo_id: id, fecha: f, tipo: d.tipo, resultado: d.resultado, nueva_fecha_vence: nueva, observacion: texto(d.observacion, 1000) });
    if (nueva) {
      await tx.actualizar('equipo_emergencia', id, { fecha_vence: nueva }, { accion: 'renovar' });
      await plazos.registrarVigencia(tx, {
        vencimientoCodigo: 'EQUIPO_EMERGENCIA', empresaId, entidadTipo: 'equipo_emergencia', entidadId: id, fechaInicio: f, fechaLimite: nueva,
      }, hoy);
    }
  });
}

async function darDeBaja(repo, empresaId, id, motivo) {
  const e = await equipo(repo, empresaId, id);
  if (e.estado !== 'activo') throw error(409, 'El equipo ya esta dado de baja');
  const m = texto(motivo, 500);
  if (!m || m.length < 10) throw error(422, 'Indique el motivo de la baja');
  await repo.transaccion(async (tx) => {
    await tx.actualizar('equipo_emergencia', id, { estado: 'baja', motivo_estado: m }, { accion: 'dar_de_baja' });
    for (const o of await plazos.abiertasDe(tx, 'equipo_emergencia', id)) await plazos.anularObligacion(tx, o.id, `Equipo dado de baja: ${m}`);
  });
}

// ---- Simulacros ----

async function registrarSimulacro(repo, empresaId, d, hoy = hoyBogota()) {
  const s = {
    fecha: fecha(d.fecha), amenaza: texto(d.amenaza, 150), alcance: ['parcial', 'total'].includes(d.alcance) ? d.alcance : null,
    anunciado: d.anunciado === '0' ? 0 : 1, participantes: entero(d.participantes),
    tiempo_respuesta_seg: entero(d.tiempo_respuesta_seg), tiempo_evacuacion_seg: entero(d.tiempo_evacuacion_seg),
    fortalezas: texto(d.fortalezas, 5000), oportunidades: texto(d.oportunidades, 5000),
  };
  if (!s.fecha || s.fecha > hoy) throw error(422, 'Fecha del simulacro invalida');
  if (!s.amenaza || !s.alcance) throw error(422, 'Indique la amenaza simulada y el alcance');
  if (s.participantes > 1000000 || s.tiempo_respuesta_seg > 86400 || s.tiempo_evacuacion_seg > 86400) throw error(422, 'Participantes o tiempos fuera de rango');
  if (!s.participantes) throw error(422, 'Indique el numero de participantes');
  if (!s.fortalezas && !s.oportunidades) throw error(422, 'Registre la evaluacion: fortalezas u oportunidades de mejora');
  let doc = null;
  if (d.documento_id) {
    doc = await repo.obtener('documento_sst', Number.parseInt(d.documento_id, 10));
    if (!doc || doc.empresa_id !== empresaId || doc.tipo_documental !== 'INFORME_SIMULACRO' || doc.estado !== 'vigente') throw error(422, 'Informe de simulacro invalido');
  }
  const accion = d.accion_descripcion ? { descripcion: texto(d.accion_descripcion, 1000), ...(await capa.validarAsignacion(repo, d, hoy)) } : null;
  const centro = await centroDeEmpresa(repo, empresaId, d.centro_trabajo_id);
  return repo.transaccion(async (tx) => {
    const id = await tx.insertar('simulacro', { empresa_id: empresaId, centro_trabajo_id: centro, ...s, documento_id: doc ? doc.id : null });
    await plazos.registrarVigencia(tx, {
      vencimientoCodigo: 'SIMULACRO', empresaId, entidadTipo: 'empresa', entidadId: empresaId, fechaInicio: s.fecha, evidenciaDocumentoId: doc ? doc.id : null,
    }, hoy);
    if (accion) {
      await capa.crear(tx, empresaId, {
        origen: 'simulacro', origenId: id, referencia: 'S1', descripcion: accion.descripcion, tipo: 'mejora',
        responsableId: accion.responsable_id, fechaLimite: accion.fecha_limite,
      });
    }
    return id;
  });
}

async function anularSimulacro(repo, empresaId, id, motivo) {
  const s = await repo.obtener('simulacro', id);
  if (!s || s.empresa_id !== empresaId) throw error(404, 'Simulacro no encontrado');
  if (s.estado !== 'registrado') throw error(409, 'El simulacro ya esta anulado');
  const m = texto(motivo, 500);
  if (!m || m.length < 10) throw error(422, 'Indique el motivo de la anulacion');
  await repo.actualizar('simulacro', id, { estado: 'anulado', motivo_estado: m }, { accion: 'anular' });
}

async function panel(repo, empresaId, hoy = hoyBogota()) {
  const [brigada, equipos, simulacros, documentos, tipos, [proximo]] = await Promise.all([
    repo.consultar(
      `SELECT b.id, b.rol, b.fecha_designacion, b.persona_id, p.nombres, p.apellidos FROM brigada_miembro b
         JOIN persona p ON p.tenant_id = {tenant} AND p.id = b.persona_id
        WHERE b.tenant_id = {tenant} AND b.empresa_id = ? AND b.estado = 'activo' ORDER BY FIELD(b.rol, 'jefe') DESC, b.rol, p.apellidos`, [empresaId],
    ),
    repo.consultar(
      `SELECT e.*, c.nombre AS centro FROM equipo_emergencia e LEFT JOIN centro_trabajo c ON c.tenant_id = {tenant} AND c.id = e.centro_trabajo_id
        WHERE e.tenant_id = {tenant} AND e.empresa_id = ? AND e.estado = 'activo' ORDER BY e.fecha_vence, e.codigo`, [empresaId],
    ),
    repo.consultar("SELECT * FROM simulacro WHERE tenant_id = {tenant} AND empresa_id = ? ORDER BY fecha DESC, id DESC", [empresaId]),
    repo.consultar(
      `SELECT t.codigo AS tipo, t.nombre, t.origen_articulo, d.id, d.codigo, d.version, d.fecha_documento, d.fecha_vence
         FROM tipo_documental t
         LEFT JOIN documento_sst d ON d.tenant_id = {tenant} AND d.empresa_id = ? AND d.tipo_documental = t.codigo AND d.estado = 'vigente'
        WHERE t.codigo IN ('AMENAZAS_VULNERAB','PLAN_EMERGENCIAS') ORDER BY t.codigo`, [empresaId],
    ),
    tiposEquipo(),
    repo.consultar(
      `SELECT fecha_limite, estado FROM obligacion_pendiente WHERE tenant_id = {tenant} AND empresa_id = ? AND plazo_codigo = 'SIMULACRO'
          AND estado IN ('en_termino','por_vencer','vencido') ORDER BY fecha_limite LIMIT 1`, [empresaId],
    ),
  ]);
  const nombreTipo = new Map(tipos.map((t) => [t.codigo, t.nombre]));
  const conEstado = equipos.map((e) => ({ ...e, tipo: nombreTipo.get(e.tipo_codigo) || e.tipo_codigo, vencimiento: estadoVencimiento(e.fecha_vence, hoy) }));
  const ultimo = simulacros.find((s) => s.estado === 'registrado');
  return {
    brigada, equipos: conEstado, simulacros, documentos, tipos,
    resumen: {
      brigadistas: brigada.length,
      equiposVencidos: conEstado.filter((e) => e.vencimiento === 'vencido').length,
      equiposPorVencer: conEstado.filter((e) => e.vencimiento === 'por_vencer').length,
      ultimoSimulacro: ultimo ? ultimo.fecha : null,
      proximoSimulacro: proximo || null,
    },
  };
}

async function revisiones(repo, empresaId, id) {
  await equipo(repo, empresaId, id);
  return repo.consultar('SELECT * FROM equipo_revision WHERE tenant_id = {tenant} AND equipo_id = ? ORDER BY fecha DESC, id DESC', [id]);
}

module.exports = {
  ROLES_BRIGADA, estadoVencimiento, tiposEquipo, designar, retirar, registrarEquipo, revisarEquipo, darDeBaja,
  registrarSimulacro, anularSimulacro, panel, revisiones,
};
