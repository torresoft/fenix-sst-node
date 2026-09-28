// M11: autoevaluacion de estandares minimos (Res. 0312 de 2019) y plan de mejoramiento (CAPA).
// El puntaje no se declara: se calcula del estado real del expediente documental.
const crypto = require('crypto');
const { consultarCatalogo } = require('../db/global');
const cuentas = require('../db/cuentas');
const { normalizar, hoyBogota } = require('../fechas/calendario');
const plazos = require('../plazos/servicio');
const motor = require('./motor');

function error(status, mensaje) {
  const e = new Error(mensaje);
  e.status = status;
  return e;
}

const parse = (v) => (typeof v === 'string' ? JSON.parse(v) : v);

async function catalogo() {
  const [conjuntos, tabla, requisitos, requisitoNumerales, ponderacion, valoraciones] = await Promise.all([
    consultarCatalogo("SELECT * FROM estandar_conjunto WHERE estado = 'activo'"),
    consultarCatalogo("SELECT * FROM estandar_minimo WHERE estado = 'activo'"),
    consultarCatalogo("SELECT * FROM estandar_requisito WHERE estado = 'activo' ORDER BY conjunto_codigo, orden"),
    consultarCatalogo("SELECT * FROM estandar_requisito_numeral WHERE estado = 'activo'"),
    consultarCatalogo("SELECT * FROM estandar_ponderacion WHERE estado = 'activo' ORDER BY FIELD(ciclo, 'PLANEAR', 'HACER', 'VERIFICAR', 'ACTUAR'), componente"),
    consultarCatalogo("SELECT * FROM estandar_valoracion WHERE estado = 'activo' ORDER BY minimo"),
  ]);
  const orden = (n) => n.split('.').map((x) => x.padStart(3, '0')).join('.');
  tabla.sort((a, b) => orden(a.numeral).localeCompare(orden(b.numeral)));
  return { conjuntos, tabla, requisitos, requisitoNumerales, ponderacion, valoraciones };
}

// ---------- Clasificacion (datos minimos de M01 que el M11 necesita)

async function datosEmpresa(repo, empresaId) {
  const empresa = await repo.obtener('empresa', empresaId);
  if (!empresa) throw error(404, 'Empresa no encontrada');
  const centros = await repo.consultar(
    `SELECT c.id, c.nombre, c.clase_riesgo, c.numero_trabajadores, r.nivel
       FROM centro_trabajo c JOIN clase_riesgo r ON r.clase = c.clase_riesgo
      WHERE c.tenant_id = {tenant} AND c.empresa_id = ? AND c.estado = 'activo' ORDER BY c.nombre`,
    [empresaId],
  );
  const [vinc] = await repo.consultar(
    "SELECT COUNT(*) AS n FROM vinculacion WHERE tenant_id = {tenant} AND empresa_id = ? AND estado = 'activa'",
    [empresaId],
  );
  const nivelRiesgo = centros.length ? Math.max(...centros.map((c) => Number(c.nivel))) : null;
  return { empresa, centros, nivelRiesgo, vinculacionesActivas: Number(vinc.n) };
}

async function clasificacion(repo, empresaId, cat = null) {
  const datos = await datosEmpresa(repo, empresaId);
  const { conjuntos, requisitos } = cat || await catalogo();
  try {
    const conjunto = motor.resolverConjunto(conjuntos, {
      trabajadores: Number(datos.empresa.numero_trabajadores),
      nivelRiesgo: datos.nivelRiesgo,
      agropecuaria: Boolean(Number(datos.empresa.es_agropecuaria)),
    });
    return { ...datos, conjunto, requisitos: requisitos.filter((r) => r.conjunto_codigo === conjunto.codigo), error: null };
  } catch (e) {
    return { ...datos, conjunto: null, requisitos: [], error: e.message };
  }
}

/** Registra la clasificacion vigente; si cambio de conjunto queda pendiente de revision (reclasifica el SG-SST). */
async function verificarClasificacion(repo, empresaId) {
  const c = await clasificacion(repo, empresaId);
  if (!c.conjunto) return { ...c, historial: [], pendiente: null };
  const historial = await repo.consultar(
    'SELECT * FROM empresa_clasificacion WHERE tenant_id = {tenant} AND empresa_id = ? ORDER BY id DESC LIMIT 10',
    [empresaId],
  );
  const ultima = historial[0];
  if (!ultima || ultima.conjunto_codigo !== c.conjunto.codigo) {
    await repo.insertar('empresa_clasificacion', {
      empresa_id: empresaId, conjunto_codigo: c.conjunto.codigo, conjunto_anterior: ultima ? ultima.conjunto_codigo : null,
      trabajadores: Number(c.empresa.numero_trabajadores), nivel_riesgo: c.nivelRiesgo,
      es_agropecuaria: Number(c.empresa.es_agropecuaria) ? 1 : 0, estado: ultima ? 'pendiente' : 'revisada',
    });
    return verificarClasificacion(repo, empresaId);
  }
  return { ...c, historial, pendiente: historial.find((h) => h.estado === 'pendiente') || null };
}

async function revisarClasificacion(repo, empresaId, id) {
  const h = await repo.obtener('empresa_clasificacion', id);
  if (!h || h.empresa_id !== empresaId || h.estado !== 'pendiente') throw error(404, 'Reclasificacion no encontrada');
  await repo.actualizar('empresa_clasificacion', id, { estado: 'revisada', revisado_por: repo.actor.id ?? null, revisado_en: new Date() }, { accion: 'revisar' });
}

// ---------- Evidencia

/** Documentos vinculados a numerales de la empresa, con lo necesario para existeEvidenciaVigente. */
async function evidenciasEmpresa(repo, empresaId) {
  const filas = await repo.consultar(
    `SELECT ee.numeral, d.id, d.codigo, d.titulo, d.version, d.estado, d.fecha_documento, d.fecha_vence,
            d.modalidad_firma, t.requiere_firma,
            (SELECT COUNT(*) FROM firma f WHERE f.tenant_id = {tenant} AND f.entidad = 'documento_sst' AND f.entidad_id = d.id) AS firmas
       FROM evidencia_estandar ee
       JOIN documento_sst d ON d.tenant_id = {tenant} AND d.id = ee.documento_id
       JOIN tipo_documental t ON t.codigo = d.tipo_documental
      WHERE ee.tenant_id = {tenant} AND ee.empresa_id = ? AND ee.estado = 'activo'`,
    [empresaId],
  );
  const porNumeral = new Map();
  for (const f of filas) {
    if (!porNumeral.has(f.numeral)) porNumeral.set(f.numeral, []);
    // Manuscrita escaneada o digital del emisor: la firma viene en el propio archivo.
    const firmado = Number(f.firmas) > 0 || ['manuscrita', 'digital_externa'].includes(f.modalidad_firma);
    porNumeral.get(f.numeral).push({ ...f, firmado });
  }
  return porNumeral;
}

/** existeEvidenciaVigente para todos los numerales, al corte de la autoevaluacion. */
function evaluarEvidencias(porNumeral, fechaCorte) {
  const r = new Map();
  for (const [numeral, docs] of porNumeral) r.set(numeral, motor.evaluarEvidencia(docs, fechaCorte));
  return r;
}

async function vincularEvidencia(repo, empresaId, numeral, documentos) {
  const [n] = await consultarCatalogo("SELECT numeral FROM estandar_minimo WHERE numeral = ? AND estado = 'activo'", [String(numeral || '')]);
  if (!n) throw error(422, 'Numeral inexistente');
  const ids = [...new Set([].concat(documentos || []).map((d) => Number.parseInt(d, 10)).filter((d) => d > 0))];
  const vigentes = new Set((await repo.consultar(
    "SELECT id FROM documento_sst WHERE tenant_id = {tenant} AND empresa_id = ? AND estado = 'vigente'", [empresaId],
  )).map((d) => d.id));
  for (const d of ids) if (!vigentes.has(d)) throw error(422, 'Solo se vinculan documentos vigentes de la empresa');

  return repo.transaccion(async (tx) => {
    const actuales = await tx.listar('evidencia_estandar', { empresa_id: empresaId, numeral: n.numeral });
    const porDoc = new Map(actuales.map((e) => [e.documento_id, e]));
    for (const d of ids) {
      const e = porDoc.get(d);
      if (!e) await tx.insertar('evidencia_estandar', { empresa_id: empresaId, numeral: n.numeral, documento_id: d });
      else if (e.estado !== 'activo') await tx.actualizar('evidencia_estandar', e.id, { estado: 'activo' });
    }
    for (const e of actuales) {
      if (e.estado === 'activo' && !ids.includes(e.documento_id)) await tx.actualizar('evidencia_estandar', e.id, { estado: 'retirado' }, { accion: 'retirar' });
    }
  });
}

// ---------- Autoevaluacion

async function obtener(repo, empresaId, id) {
  const a = await repo.obtener('autoevaluacion', id);
  if (!a || a.empresa_id !== empresaId) throw error(404, 'Autoevaluacion no encontrada');
  return a;
}

async function listar(repo, empresaId) {
  return repo.consultar(
    `SELECT id, vigencia_anio, version, conjunto_codigo, fecha_corte, puntaje, valoracion, estado, cerrada_en
       FROM autoevaluacion WHERE tenant_id = {tenant} AND empresa_id = ? ORDER BY vigencia_anio DESC, version DESC`,
    [empresaId],
  );
}

async function crearConItems(tx, empresaId, c, cat, { vigencia, fechaCorte, version = 1, padreId = null, justificaciones = new Map() }) {
  const aplican = motor.numeralesDelConjunto(c.conjunto, cat.tabla, cat.requisitoNumerales);
  const id = await tx.insertar('autoevaluacion', {
    empresa_id: empresaId, vigencia_anio: vigencia, version, autoevaluacion_padre_id: padreId,
    conjunto_codigo: c.conjunto.codigo, trabajadores: Number(c.empresa.numero_trabajadores),
    nivel_riesgo: c.nivelRiesgo, fecha_corte: fechaCorte,
  });
  for (const t of cat.tabla) {
    const j = aplican.has(t.numeral) ? justificaciones.get(t.numeral) : null;
    await tx.insertar('autoevaluacion_item', {
      autoevaluacion_id: id, numeral: t.numeral, aplica_conjunto: aplican.has(t.numeral) ? 1 : 0,
      no_aplica_justificado: j ? 1 : 0, justificacion: j || null, peso: t.peso,
    }, { auditar: false });
  }
  return id;
}

async function iniciar(repo, empresaId, { vigencia, fechaCorte }) {
  const v = Number.parseInt(vigencia, 10);
  if (!Number.isInteger(v) || v < 2019 || v > 2100) throw error(422, 'Vigencia invalida');
  let corte;
  try { corte = normalizar(fechaCorte); } catch { throw error(422, 'Fecha de corte invalida'); }
  if (!corte.startsWith(String(v)) && !corte.startsWith(String(v + 1))) throw error(422, 'La fecha de corte debe corresponder a la vigencia evaluada');

  const cat = await catalogo();
  const c = await clasificacion(repo, empresaId, cat);
  if (!c.conjunto) throw error(422, c.error);
  if (motor.numeralesDelConjunto(c.conjunto, cat.tabla, cat.requisitoNumerales).size === 0) {
    throw error(422, 'La Res. 0312 no asigna puntaje a los estandares de unidades agropecuarias (art. 7): se verifican sin calificacion');
  }
  const existentes = await repo.listar('autoevaluacion', { empresa_id: empresaId, vigencia_anio: v });
  if (existentes.some((a) => a.estado !== 'anulada')) throw error(409, 'Ya existe una autoevaluacion para esa vigencia: abra la existente o cree una version nueva');
  return repo.transaccion((tx) => crearConItems(tx, empresaId, c, cat, { vigencia: v, fechaCorte: corte }));
}

/** Detalle con el calculo: en vivo si es borrador, congelado si esta cerrada. */
async function detalle(repo, empresaId, id) {
  const a = await obtener(repo, empresaId, id);
  const cat = await catalogo();
  const items = await repo.listar('autoevaluacion_item', { autoevaluacion_id: id });
  const docs = await evidenciasEmpresa(repo, empresaId);
  const conjunto = cat.conjuntos.find((c) => c.codigo === a.conjunto_codigo);
  const requisitos = cat.requisitos.filter((r) => r.conjunto_codigo === a.conjunto_codigo);
  const itemPorNumeral = new Map(items.map((i) => [i.numeral, i]));
  const aplican = new Map(items.filter((i) => Number(i.aplica_conjunto)).map((i) => [i.numeral, []]));
  for (const rn of cat.requisitoNumerales.filter((x) => x.conjunto_codigo === a.conjunto_codigo)) {
    if (aplican.has(rn.numeral)) aplican.get(rn.numeral).push(Number(rn.orden));
  }

  let resultado;
  if (a.estado === 'borrador') {
    const noAplica = new Map(items.filter((i) => Number(i.no_aplica_justificado)).map((i) => [i.numeral, i.justificacion]));
    resultado = motor.calcular({
      tabla: cat.tabla, aplican, evidencia: evaluarEvidencias(docs, a.fecha_corte), noAplica,
      ponderacion: cat.ponderacion, valoraciones: cat.valoraciones,
    });
  } else {
    const resumen = parse(a.resumen) || {};
    const porNumeral = new Map(cat.tabla.map((t) => [t.numeral, t]));
    const congelados = items.map((i) => {
      const t = porNumeral.get(i.numeral) || {};
      return {
        numeral: i.numeral, nombre: t.nombre, ciclo: t.ciclo, componente: t.componente, estandar: t.estandar,
        peso: i.peso, requisitos: aplican.get(i.numeral) || [], aplica_conjunto: Boolean(Number(i.aplica_conjunto)),
        resultado: i.resultado, motivo: i.motivo, justificacion: i.justificacion, puntaje: i.puntaje,
        puntajeCent: motor.aCent(i.puntaje), evidencias: parse(i.evidencias) || [],
      };
    }).sort((x, y) => cat.tabla.indexOf(porNumeral.get(x.numeral)) - cat.tabla.indexOf(porNumeral.get(y.numeral)));
    resultado = {
      items: congelados, totalCent: motor.aCent(a.puntaje), puntaje: a.puntaje, valoracion: a.valoracion,
      desglose: resumen.desglose || [], conteo: resumen.conteo || {},
    };
  }

  for (const i of resultado.items) {
    i.documentos = docs.get(i.numeral) || [];
    const item = itemPorNumeral.get(i.numeral);
    if (item) i.itemId = item.id;
  }
  const valoracion = cat.valoraciones.find((v) => v.codigo === resultado.valoracion);
  return {
    autoevaluacion: a, conjunto, requisitos, resultado,
    acciones_valoracion: valoracion ? parse(valoracion.acciones) : [],
    brechas: motor.brechas(resultado, cat.tabla, cat.valoraciones),
  };
}

async function marcarNoAplica(repo, empresaId, id, numeral, justificacion) {
  const a = await obtener(repo, empresaId, id);
  if (a.estado !== 'borrador') throw error(409, 'Solo se modifica una autoevaluacion en borrador');
  const [item] = await repo.listar('autoevaluacion_item', { autoevaluacion_id: id, numeral: String(numeral || '') });
  if (!item || !Number(item.aplica_conjunto)) throw error(422, 'El numeral no hace parte del conjunto evaluado');
  const j = String(justificacion || '').trim();
  if (j && j.length < 10) throw error(422, 'La justificacion de no aplica debe explicar por que (minimo 10 caracteres)');
  await repo.actualizar('autoevaluacion_item', item.id, {
    no_aplica_justificado: j ? 1 : 0, justificacion: j ? j.slice(0, 1000) : null,
  }, { accion: j ? 'marcar_no_aplica' : 'quitar_no_aplica' });
}

const hashResultado = (a, r) => crypto.createHash('sha256').update(JSON.stringify({
  tenant: a.tenant_id, empresa: a.empresa_id, vigencia: a.vigencia_anio, version: a.version, conjunto: a.conjunto_codigo,
  fecha_corte: a.fecha_corte, puntaje: r.puntaje, valoracion: r.valoracion,
  items: r.items.map((i) => [i.numeral, i.resultado, i.motivo, i.puntaje, i.evidencias]),
})).digest('hex');

/**
 * Congela el resultado (hash SHA-256), reemplaza la version anterior y dispara las obligaciones:
 * reporte a la ARL segun valoracion, proxima autoevaluacion y cargue en el aplicativo del Ministerio.
 */
async function cerrar(repo, empresaId, id, hoy = hoyBogota()) {
  const d = await detalle(repo, empresaId, id);
  const a = d.autoevaluacion;
  if (a.estado !== 'borrador') throw error(409, 'La autoevaluacion ya esta cerrada');
  if (a.fecha_corte > hoy) throw error(422, 'No se puede cerrar antes de la fecha de corte');
  const r = d.resultado;
  const hash = hashResultado(a, r);
  const [cargue] = await consultarCatalogo("SELECT * FROM estandar_cargue WHERE vigencia_anio = ? AND estado = 'activo'", [a.vigencia_anio]);

  await repo.transaccion(async (tx) => {
    for (const i of r.items) {
      await tx.actualizar('autoevaluacion_item', i.itemId, {
        resultado: i.resultado, motivo: i.motivo, puntaje: i.puntaje, evidencias: i.evidencias,
      }, { auditar: false });
    }
    await tx.actualizar('autoevaluacion', id, {
      puntaje: r.puntaje, valoracion: r.valoracion, resumen: { desglose: r.desglose, conteo: r.conteo },
      hash_resultado: hash, cerrada_por: tx.actor.id ?? null, cerrada_en: new Date(), estado: 'cerrada',
    }, { accion: 'cerrar' }); // los 60 items congelados quedan cubiertos por el hash de este registro

    if (a.autoevaluacion_padre_id) {
      await tx.actualizar('autoevaluacion', a.autoevaluacion_padre_id, { estado: 'reemplazada' }, { accion: 'reemplazar' });
      const abiertas = await tx.consultar(
        `SELECT id FROM obligacion_pendiente WHERE tenant_id = {tenant} AND entidad_origen_tipo = 'autoevaluacion'
            AND entidad_origen_id = ? AND estado IN ('en_termino','por_vencer','vencido')`,
        [a.autoevaluacion_padre_id],
      );
      for (const o of abiertas) await plazos.anularObligacion(tx, o.id, `Autoevaluacion reemplazada por la version ${a.version}`);
    }

    await plazos.dispararEvento(tx, {
      evento: 'autoevaluacion.cerrada', variante: r.valoracion, fecha: hoy, empresaId,
      entidadTipo: 'autoevaluacion', entidadId: id,
    }, hoy);
    await plazos.registrarVigencia(tx, {
      vencimientoCodigo: 'AUTOEVALUACION', empresaId, entidadTipo: 'autoevaluacion', entidadId: id, fechaInicio: a.fecha_corte,
    }, hoy);
    if (cargue && cargue.fecha_limite >= hoy) {
      await plazos.registrarVigencia(tx, {
        vencimientoCodigo: 'CARGUE_SGRL', empresaId, entidadTipo: 'autoevaluacion', entidadId: id,
        fechaInicio: hoy, fechaLimite: cargue.fecha_limite,
      }, hoy);
    }
  });
  return {
    puntaje: r.puntaje, valoracion: r.valoracion, hash,
    aviso: cargue ? null : `El Ministerio aun no ha fijado (en el catalogo) la fecha de cargue de la vigencia ${a.vigencia_anio}`,
  };
}

/** Correccion de una autoevaluacion cerrada: version nueva en borrador con las mismas justificaciones. */
async function nuevaVersion(repo, empresaId, id) {
  const a = await obtener(repo, empresaId, id);
  if (a.estado !== 'cerrada') throw error(409, 'Solo se versiona una autoevaluacion cerrada');
  const hermanas = await repo.listar('autoevaluacion', { empresa_id: empresaId, vigencia_anio: a.vigencia_anio });
  if (hermanas.some((h) => h.estado === 'borrador')) throw error(409, 'Ya hay una version en borrador para esa vigencia');
  const cat = await catalogo();
  const c = await clasificacion(repo, empresaId, cat);
  if (!c.conjunto) throw error(422, c.error);
  const items = await repo.listar('autoevaluacion_item', { autoevaluacion_id: id });
  const justificaciones = new Map(items.filter((i) => Number(i.no_aplica_justificado)).map((i) => [i.numeral, i.justificacion]));
  const version = Math.max(...hermanas.map((h) => h.version)) + 1;
  return repo.transaccion((tx) => crearConItems(tx, empresaId, c, cat, {
    vigencia: a.vigencia_anio, fechaCorte: a.fecha_corte, version, padreId: id, justificaciones,
  }));
}

// ---------- Plan de mejoramiento (CAPA)

async function acciones(repo, empresaId, autoevaluacionId) {
  return repo.consultar(
    `SELECT * FROM accion_mejora WHERE tenant_id = {tenant} AND empresa_id = ? AND origen = 'autoevaluacion' AND origen_id = ?
      ORDER BY estado, fecha_limite, referencia`,
    [empresaId, autoevaluacionId],
  );
}

/** Una accion por brecha, con responsable y fecha. Idempotente por numeral. */
async function generarPlan(repo, empresaId, id, { responsableId, fechaLimite }, hoy = hoyBogota()) {
  const d = await detalle(repo, empresaId, id);
  if (d.autoevaluacion.estado !== 'cerrada') throw error(409, 'El plan se genera sobre una autoevaluacion cerrada');
  let limite;
  try { limite = normalizar(fechaLimite); } catch { throw error(422, 'Fecha limite invalida'); }
  if (limite <= hoy) throw error(422, 'La fecha limite debe ser futura');
  const uid = responsableId ? Number.parseInt(responsableId, 10) : null;
  if (!uid || !(await cuentas.usuarioEnTenant(repo.tenantId, uid))) throw error(422, 'Seleccione un responsable de la empresa');

  const existentes = new Set((await acciones(repo, empresaId, id)).map((x) => x.referencia));
  let creadas = 0;
  await repo.transaccion(async (tx) => {
    for (const b of d.brechas) {
      if (existentes.has(b.numeral)) continue;
      await tx.insertar('accion_mejora', {
        empresa_id: empresaId, origen: 'autoevaluacion', origen_id: id, referencia: b.numeral,
        descripcion: `${b.numeral} ${b.nombre}. Requerido: ${b.modo_verificacion || 'soporte documental'}`.slice(0, 1000),
        tipo: 'correctiva', responsable_id: uid, fecha_limite: limite,
      });
      creadas++;
    }
  });
  return creadas;
}

async function cerrarAccion(repo, empresaId, accionId, { fecha, observacion }, hoy = hoyBogota()) {
  const x = await repo.obtener('accion_mejora', accionId);
  if (!x || x.empresa_id !== empresaId) throw error(404, 'Accion no encontrada');
  if (x.estado !== 'abierta') throw error(409, 'La accion ya esta cerrada');
  let f;
  try { f = normalizar(fecha); } catch { throw error(422, 'Fecha de cierre invalida'); }
  if (f > hoy) throw error(422, 'La fecha de cierre no puede ser futura');
  const obs = String(observacion || '').trim();
  if (obs.length < 5) throw error(422, 'Describa como se cerro la accion');
  await repo.actualizar('accion_mejora', accionId, { estado: 'cerrada', fecha_cierre: f, observacion_cierre: obs.slice(0, 1000) }, { accion: 'cerrar' });
}

module.exports = {
  catalogo, clasificacion, verificarClasificacion, revisarClasificacion,
  vincularEvidencia, listar, iniciar, detalle, marcarNoAplica, cerrar, nuevaVersion, acciones, generarPlan, cerrarAccion,
};
