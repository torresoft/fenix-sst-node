// M08: registro, reporte (FURAT/FUREL), investigacion y plan de accion de incidentes, AT y EL.
// Los plazos los calcula el motor de obligaciones al registrar (evento.creado[variante]).
const { consultarCatalogo } = require('../db/global');
const cuentas = require('../db/cuentas');
const { hoyBogota, textoBogota } = require('../fechas/calendario');
const plazos = require('../plazos/servicio');
const r = require('./reglas');
const { sinDatosClinicos } = require('../salud/reglas');

const texto = (v, max) => { const s = String(v ?? '').trim(); return s ? s.slice(0, max) : null; };
const parse = (v) => (typeof v === 'string' ? JSON.parse(v) : v);
const ENTIDADES_FURAT = ['ARL', 'EPS', 'MINTRABAJO'];

function error(status, mensaje) {
  const e = new Error(mensaje);
  e.status = status;
  return e;
}

function ahoraBogota() {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Bogota', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date()).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}


const catalogo = {
  criterios: () => consultarCatalogo("SELECT codigo, descripcion FROM evento_criterio_grave WHERE estado = 'activo' ORDER BY codigo"),
  roles: () => consultarCatalogo("SELECT codigo, nombre, requerido_en FROM investigacion_rol WHERE estado = 'activo' ORDER BY codigo"),
  plazo: async (codigo) => (await consultarCatalogo('SELECT * FROM plazo_legal WHERE codigo = ?', [codigo]))[0],
};

async function obtener(repo, empresaId, id) {
  const e = await repo.obtener('evento', id);
  if (!e || e.empresa_id !== empresaId) throw error(404, 'Evento no encontrado');
  return e;
}

function abierto(e) {
  if (['cerrado', 'anulado'].includes(e.estado)) throw error(409, 'El evento ya esta cerrado');
}

// ---------- Registro

async function registrar(repo, empresaId, d, ahora = ahoraBogota()) {
  const v = r.validarRegistro(d, ahora, await catalogo.criterios());
  if (v.persona_id && !(await repo.listar('vinculacion', { empresa_id: empresaId, persona_id: v.persona_id })).length) throw error(422, 'Persona invalida');
  const centroId = d.centro_trabajo_id ? Number.parseInt(d.centro_trabajo_id, 10) : null;
  if (centroId) {
    const c = await repo.obtener('centro_trabajo', centroId);
    if (!c || c.empresa_id !== empresaId) throw error(422, 'Centro de trabajo invalido');
  }
  const anio = Number(v.fecha_base.slice(0, 4));
  return repo.transaccion(async (tx) => {
    const [n] = await tx.consultar(
      "SELECT COUNT(*) AS n FROM evento WHERE tenant_id = {tenant} AND empresa_id = ? AND codigo LIKE ? FOR UPDATE", [empresaId, `EV-${anio}-%`],
    );
    const id = await tx.insertar('evento', {
      empresa_id: empresaId, codigo: r.codigoEvento(anio, Number(n.n) + 1), ...v, centro_trabajo_id: centroId,
      lugar: texto(d.lugar, 255), tipo_lesion: texto(d.tipo_lesion, 150), parte_cuerpo: texto(d.parte_cuerpo, 150),
      agente_lesion: texto(d.agente_lesion, 150), entidad_calificadora: texto(d.entidad_calificadora, 150),
      agente_riesgo: texto(d.agente_riesgo, 255),
    });
    await plazos.dispararEvento(tx, {
      evento: 'evento.creado', variante: r.variante(v.tipo, v.gravedad), fecha: v.fecha_base, empresaId,
      entidadTipo: 'evento', entidadId: id, responsableId: tx.actor.id ?? null,
    }, ahora.slice(0, 10));
    return id;
  });
}

// ---------- Consulta

async function listar(repo, empresaId, { anio, tipo } = {}) {
  let sql = `SELECT e.id, e.codigo, e.tipo, e.gravedad, e.fecha_base, e.estado, e.dias_incapacidad,
                    p.nombres, p.apellidos, ct.nombre AS centro,
                    (SELECT MIN(o.fecha_limite) FROM obligacion_pendiente o WHERE o.tenant_id = {tenant} AND o.entidad_origen_tipo = 'evento'
                      AND o.entidad_origen_id = e.id AND o.estado IN ('en_termino','por_vencer','vencido')) AS proximo_plazo,
                    (SELECT COUNT(*) FROM obligacion_pendiente o2 WHERE o2.tenant_id = {tenant} AND o2.entidad_origen_tipo = 'evento'
                      AND o2.entidad_origen_id = e.id AND o2.estado = 'vencido') AS vencidas
               FROM evento e
               LEFT JOIN persona p ON p.tenant_id = {tenant} AND p.id = e.persona_id
               LEFT JOIN centro_trabajo ct ON ct.tenant_id = {tenant} AND ct.id = e.centro_trabajo_id
              WHERE e.tenant_id = {tenant} AND e.empresa_id = ?`;
  const params = [empresaId];
  if (anio) { sql += ' AND YEAR(e.fecha_base) = ?'; params.push(Number(anio)); }
  if (tipo) { sql += ' AND e.tipo = ?'; params.push(String(tipo)); }
  sql += ' ORDER BY e.fecha_base DESC, e.id DESC';
  return repo.consultar(sql, params);
}

function estadistica(eventos) {
  const vivos = eventos.filter((e) => e.estado !== 'anulado');
  const cuenta = (f) => vivos.filter(f).length;
  return {
    incidentes: cuenta((e) => e.tipo === 'incidente'),
    at: cuenta((e) => e.tipo === 'accidente'),
    at_grave: cuenta((e) => e.tipo === 'accidente' && e.gravedad === 'grave'),
    at_mortal: cuenta((e) => e.tipo === 'accidente' && e.gravedad === 'mortal'),
    el: cuenta((e) => e.tipo === 'enfermedad'),
    dias_incapacidad: vivos.reduce((s, e) => s + Number(e.dias_incapacidad || 0), 0),
  };
}

async function detalle(repo, empresaId, id) {
  const e = await obtener(repo, empresaId, id);
  const [persona, centro, reportes, equipo, causas, obligaciones, acciones, roles, criterios, plazoRep] = await Promise.all([
    e.persona_id ? repo.obtener('persona', e.persona_id) : null,
    e.centro_trabajo_id ? repo.obtener('centro_trabajo', e.centro_trabajo_id) : null,
    repo.listar('evento_reporte', { evento_id: id }, { orden: 'id' }),
    repo.listar('evento_investigador', { evento_id: id, estado: 'activo' }, { orden: 'id' }),
    repo.listar('evento_causa', { evento_id: id, estado: 'activo' }, { orden: 'id' }),
    repo.consultar(
      `SELECT id, plazo_codigo, descripcion, norma_codigo, severidad, tipo_plazo, fecha_limite, fecha_cumplimiento, estado
         FROM obligacion_pendiente WHERE tenant_id = {tenant} AND entidad_origen_tipo = 'evento' AND entidad_origen_id = ?
        ORDER BY fecha_limite`, [id],
    ),
    repo.consultar(
      "SELECT * FROM accion_mejora WHERE tenant_id = {tenant} AND origen = 'evento' AND origen_id = ? ORDER BY estado, fecha_limite", [id],
    ),
    catalogo.roles(),
    catalogo.criterios(),
    catalogo.plazo('REP_AT_ARL'),
  ]);
  const informe = e.informe_documento_id ? await repo.obtener('documento_sst', e.informe_documento_id) : null;
  const v = r.variante(e.tipo, e.gravedad);
  const furat = reportes.filter((x) => ENTIDADES_FURAT.includes(x.entidad));
  const faltanReportes = e.tipo === 'incidente' ? [] : r.reportesFaltantes(plazoRep ? plazoRep.entidad_destino : '', furat);
  const informeArl = reportes.find((x) => x.entidad === 'ARL_INFORME') || null;
  const nombres = await cuentas.nombresUsuarios(acciones.map((a) => a.responsable_id));
  return {
    e: { ...e, criterios_grave: parse(e.criterios_grave) || [], ocurrencia_texto: textoBogota(e.fecha_ocurrencia) },
    persona, centro, reportes, furat, informeArl, equipo, causas, obligaciones, informe, criterios,
    acciones: acciones.map((a) => ({ ...a, responsable: nombres.get(a.responsable_id) || '' })),
    roles, variante: v,
    faltanRoles: e.tipo === 'enfermedad' ? [] : r.rolesFaltantes(roles, v, equipo),
    faltaAnalisis: r.analisisFaltante(causas),
    faltanReportes,
    requiereInformeArl: r.requiereInformeArl(e),
    impedimentosCerrar: r.impedimentosCerrar(e, { faltanReportes, informeArl }),
  };
}

// ---------- Reporte (FURAT / FUREL)

async function cumplirObligacion(tx, eventoId, plazoCodigo, { fecha, observacion, documentoId = null }) {
  const [o] = await tx.consultar(
    `SELECT id FROM obligacion_pendiente WHERE tenant_id = {tenant} AND entidad_origen_tipo = 'evento' AND entidad_origen_id = ?
        AND plazo_codigo = ? AND estado IN ('en_termino','por_vencer','vencido')`, [eventoId, plazoCodigo],
  );
  if (o) await plazos.cumplirObligacion(tx, o.id, { fecha, observacion, evidenciaDocumentoId: documentoId });
}

async function validarDocumento(repo, empresaId, documentoId, tipos, estados = ['vigente', 'en_firma']) {
  if (!documentoId) return null;
  const doc = await repo.obtener('documento_sst', Number.parseInt(documentoId, 10));
  if (!doc || doc.empresa_id !== empresaId) throw error(422, 'Documento soporte invalido');
  if (tipos && !tipos.includes(doc.tipo_documental)) throw error(422, `El soporte debe ser de tipo ${tipos.join(' o ')}`);
  if (!estados.includes(doc.estado)) {
    throw error(422, estados.length === 1 && estados[0] === 'vigente'
      ? 'El informe debe estar vigente (firmado y publicado en el gestor documental)'
      : `El soporte debe estar ${estados.join(' o ')}`);
  }
  return doc;
}

/**
 * Radica el reporte ante una entidad. Con todas las entidades del catalogo radicadas se cumple
 * la obligacion de reporte en 2 dias habiles (con la ultima fecha de radicacion).
 */
async function reportar(repo, empresaId, id, d, hoy = hoyBogota()) {
  const e = await obtener(repo, empresaId, id);
  abierto(e);
  if (e.tipo === 'incidente') throw error(422, 'Los incidentes no se reportan con FURAT');
  const entidad = String(d.entidad || '');
  if (!ENTIDADES_FURAT.includes(entidad)) throw error(422, 'Entidad invalida');
  const radicado = texto(d.radicado, 100);
  if (!radicado) throw error(422, 'Indique el numero de radicado');
  const fecha = String(d.fecha_radicacion || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha) || fecha > hoy || fecha < e.fecha_base) throw error(422, 'Fecha de radicacion invalida');
  const soporte = await validarDocumento(repo, empresaId, d.documento_id, [e.tipo === 'enfermedad' ? 'FUREL' : 'FURAT']);
  const documentoId = soporte ? soporte.id : null;
  const previos = await repo.listar('evento_reporte', { evento_id: id });
  if (previos.some((x) => x.entidad === entidad)) throw error(409, `Ya se radico ante ${entidad}`);

  const plazoRep = await catalogo.plazo('REP_AT_ARL');
  await repo.transaccion(async (tx) => {
    await tx.insertar('evento_reporte', { evento_id: id, entidad, radicado, fecha_radicacion: fecha, documento_id: documentoId });
    const todos = [...previos, { entidad, radicado, fecha_radicacion: fecha }];
    const faltan = r.reportesFaltantes(plazoRep.entidad_destino, todos.filter((x) => ENTIDADES_FURAT.includes(x.entidad)));
    if (!faltan.length) {
      const ultima = todos.map((x) => x.fecha_radicacion).sort().pop();
      await cumplirObligacion(tx, id, 'REP_AT_ARL', {
        fecha: ultima, documentoId,
        observacion: `Radicado: ${todos.filter((x) => ENTIDADES_FURAT.includes(x.entidad)).map((x) => `${x.entidad} ${x.radicado}`).join(', ')}`,
      });
      if (e.estado === 'registrado') await tx.actualizar('evento', id, { estado: 'reportado' }, { accion: 'reportar' });
    }
  });
}

// ---------- Investigacion

async function guardarDatos(repo, empresaId, id, d) {
  const e = await obtener(repo, empresaId, id);
  abierto(e);
  if (e.investigacion_cerrada_en) throw error(409, 'La investigacion ya esta cerrada');
  const dias = Number.parseInt(d.dias_incapacidad ?? e.dias_incapacidad, 10);
  const cargados = Number.parseInt(d.dias_cargados ?? e.dias_cargados, 10);
  if (!Number.isInteger(dias) || dias < 0 || dias > 3650 || !Number.isInteger(cargados) || cargados < 0 || cargados > 6000) throw error(422, 'Dias invalidos');
  if (e.tipo === 'enfermedad') sinDatosClinicos(d.conclusiones, 'Conclusiones');
  await repo.actualizar('evento', id, {
    metodologia: texto(d.metodologia, 100), conclusiones: texto(d.conclusiones, 10000),
    dias_incapacidad: dias, dias_cargados: cargados, lugar: texto(d.lugar, 255) ?? e.lugar,
  }, { accion: 'investigar' });
}

async function agregarInvestigador(repo, empresaId, id, d) {
  const e = await obtener(repo, empresaId, id);
  abierto(e);
  if (e.investigacion_cerrada_en) throw error(409, 'La investigacion ya esta cerrada');
  const roles = await catalogo.roles();
  if (!roles.some((x) => x.codigo === d.rol_codigo)) throw error(422, 'Rol invalido');
  const usuarioId = d.usuario_id ? Number.parseInt(d.usuario_id, 10) : null;
  let nombre = texto(d.nombre, 150);
  if (usuarioId) {
    if (!(await cuentas.usuarioEnTenant(repo.tenantId, usuarioId))) throw error(422, 'Usuario invalido');
    nombre = nombre || (await cuentas.nombresUsuarios([usuarioId])).get(usuarioId);
  }
  if (!nombre) throw error(422, 'Indique el nombre del investigador');
  await repo.insertar('evento_investigador', { evento_id: id, rol_codigo: d.rol_codigo, usuario_id: usuarioId, nombre, cargo: texto(d.cargo, 150) });
}

async function agregarCausa(repo, empresaId, id, d) {
  const e = await obtener(repo, empresaId, id);
  abierto(e);
  if (e.investigacion_cerrada_en) throw error(409, 'La investigacion ya esta cerrada');
  if (![...r.CAUSAS_INMEDIATAS, ...r.CAUSAS_BASICAS].includes(d.tipo)) throw error(422, 'Tipo de causa invalido');
  const desc = texto(d.descripcion, 1000);
  if (!desc || desc.length < 5) throw error(422, 'Describa la causa');
  await repo.insertar('evento_causa', { evento_id: id, tipo: d.tipo, descripcion: desc });
}

async function retirarElemento(repo, empresaId, id, tabla, elementoId) {
  const e = await obtener(repo, empresaId, id);
  abierto(e);
  if (e.investigacion_cerrada_en) throw error(409, 'La investigacion ya esta cerrada');
  const x = await repo.obtener(tabla, elementoId);
  if (!x || x.evento_id !== id) throw error(404, 'Elemento no encontrado');
  await repo.actualizar(tabla, elementoId, { estado: 'retirado' }, { accion: 'retirar' });
}

/** Cierra la investigacion: equipo completo, analisis causal y el informe firmado en el gestor documental. */
async function cerrarInvestigacion(repo, empresaId, id, d, hoy = hoyBogota()) {
  const det = await detalle(repo, empresaId, id);
  const e = det.e;
  abierto(e);
  if (e.investigacion_cerrada_en) throw error(409, 'La investigacion ya esta cerrada');
  const faltas = [];
  if (det.faltanRoles.length) faltas.push(`Faltan en el equipo: ${det.faltanRoles.join('; ')}`);
  if (det.faltaAnalisis.length) faltas.push(`Falta ${det.faltaAnalisis.join(' y ')}`);
  if (!e.conclusiones) faltas.push('Registre las conclusiones');
  if (!d.documento_id) faltas.push('Seleccione el informe de investigacion');
  if (faltas.length) throw error(422, faltas.join('. '));
  const doc = await validarDocumento(repo, empresaId, d.documento_id, ['INV_ACCIDENTE'], ['vigente']);
  const docId = doc.id;

  await repo.transaccion(async (tx) => {
    await tx.actualizar('evento', id, { informe_documento_id: docId, investigacion_cerrada_en: hoy, estado: 'investigado' }, { accion: 'cerrar_investigacion' });
    await cumplirObligacion(tx, id, 'INV_AT', { fecha: hoy, documentoId: docId, observacion: `Informe ${doc.codigo} v${doc.version}` });
  });
}

async function radicarInformeArl(repo, empresaId, id, d, hoy = hoyBogota()) {
  const e = await obtener(repo, empresaId, id);
  abierto(e);
  if (!r.requiereInformeArl(e)) throw error(422, 'Solo los accidentes graves o mortales remiten el informe a la ARL');
  if (!e.investigacion_cerrada_en) throw error(422, 'Cierre primero la investigacion');
  const radicado = texto(d.radicado, 100);
  const fecha = String(d.fecha_radicacion || '');
  if (!radicado || !/^\d{4}-\d{2}-\d{2}$/.test(fecha) || fecha > hoy || fecha < e.fecha_base) throw error(422, 'Radicado y fecha validos son obligatorios');
  const previos = await repo.listar('evento_reporte', { evento_id: id, entidad: 'ARL_INFORME' });
  if (previos.length) throw error(409, 'El informe ya fue radicado ante la ARL');
  await repo.transaccion(async (tx) => {
    await tx.insertar('evento_reporte', { evento_id: id, entidad: 'ARL_INFORME', radicado, fecha_radicacion: fecha, documento_id: e.informe_documento_id });
    await cumplirObligacion(tx, id, 'INV_AT_ARL', { fecha, documentoId: e.informe_documento_id, observacion: `Radicado ARL ${radicado}` });
  });
}

// ---------- Plan de accion (CAPA) y cierre

async function crearAccion(repo, empresaId, id, d, hoy = hoyBogota()) {
  const e = await obtener(repo, empresaId, id);
  abierto(e);
  const desc = texto(d.descripcion, 1000);
  if (!desc || desc.length < 10) throw error(422, 'Describa la accion (minimo 10 caracteres)');
  const tipo = ['correctiva', 'preventiva', 'mejora'].includes(d.tipo) ? d.tipo : 'correctiva';
  const limite = String(d.fecha_limite || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(limite) || limite <= hoy) throw error(422, 'La fecha limite debe ser futura');
  const uid = Number.parseInt(d.responsable_id, 10);
  if (!uid || !(await cuentas.usuarioEnTenant(repo.tenantId, uid))) throw error(422, 'Seleccione un responsable de la empresa');
  const previas = await repo.listar('accion_mejora', { origen: 'evento', origen_id: id });
  await repo.insertar('accion_mejora', {
    empresa_id: empresaId, origen: 'evento', origen_id: id, referencia: `${e.codigo}-A${previas.length + 1}`,
    descripcion: desc, tipo, responsable_id: uid, fecha_limite: limite,
  });
}

async function cerrar(repo, empresaId, id) {
  const det = await detalle(repo, empresaId, id);
  abierto(det.e);
  if (det.impedimentosCerrar.length) throw error(422, det.impedimentosCerrar.join('. '));
  await repo.actualizar('evento', id, { estado: 'cerrado' }, { accion: 'cerrar' });
}

/** Solo para registros hechos por error: se anulan tambien sus obligaciones abiertas. */
async function anular(repo, empresaId, id, motivo) {
  const e = await obtener(repo, empresaId, id);
  abierto(e);
  const m = texto(motivo, 500);
  if (!m || m.length < 10) throw error(422, 'Explique por que se anula (minimo 10 caracteres)');
  await repo.transaccion(async (tx) => {
    const abiertas = await tx.consultar(
      `SELECT id FROM obligacion_pendiente WHERE tenant_id = {tenant} AND entidad_origen_tipo = 'evento' AND entidad_origen_id = ?
          AND estado IN ('en_termino','por_vencer','vencido')`, [id],
    );
    for (const o of abiertas) await plazos.anularObligacion(tx, o.id, `Evento ${e.codigo} anulado: ${m}`.slice(0, 500));
    await tx.actualizar('evento', id, { estado: 'anulado', observacion: m }, { accion: 'anular' });
  });
}

module.exports = {
  ENTIDADES_FURAT, catalogo, textoBogota, registrar, listar, estadistica, detalle, reportar, guardarDatos, agregarInvestigador,
  agregarCausa, retirarElemento, cerrarInvestigacion, radicarInformeArl, crearAccion, cerrar, anular,
};
