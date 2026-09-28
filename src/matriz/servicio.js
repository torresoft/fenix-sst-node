// Matriz legal por empresa (M04): perfil de aplicabilidad, cumplimiento con evidencia,
// auditor de matrices declaradas y propagacion del boletin normativo.
const { consultarCatalogo } = require('../db/global');
const cuentas = require('../db/cuentas');
const auditor = require('./auditor');
const boletin = require('./boletin');

const ESTADOS_CUMPLIMIENTO = ['sin_evaluar', 'cumple', 'cumple_parcial', 'no_cumple'];
const MAX_TEXTO = 512 * 1024;
const MAX_LINEAS = 5000;
const DIAS_BOLETIN = 365;

function error(status, mensaje) {
  const e = new Error(mensaje);
  e.status = status;
  return e;
}

const catalogo = {
  normas: () => consultarCatalogo("SELECT * FROM norma WHERE estado = 'activo' ORDER BY ambito, anio DESC, codigo"),
  ambitos: () => consultarCatalogo("SELECT * FROM ambito_normativo WHERE estado = 'activo' ORDER BY es_general DESC, nombre"),
  desinformacion: () => consultarCatalogo("SELECT * FROM norma_desinformacion WHERE estado = 'activo'"),
};

async function empresaDelTenant(repo, empresaId) {
  const empresa = await repo.obtener('empresa', empresaId);
  if (!empresa) throw error(404, 'Empresa no encontrada');
  return empresa;
}

/** Perfil de aplicabilidad vigente de la empresa. */
async function perfil(repo, empresaId) {
  const empresa = await empresaDelTenant(repo, empresaId);
  const [ambitos, declarados] = await Promise.all([
    catalogo.ambitos(),
    repo.listar('empresa_ambito', { empresa_id: empresaId, estado: 'activo' }),
  ]);
  const activos = auditor.ambitosActivos(ambitos, empresa, declarados.map((d) => d.ambito));
  return { empresa, ambitos, activos, declarados: declarados.map((d) => d.ambito) };
}

async function guardarPerfil(repo, empresaId, seleccion) {
  const { ambitos } = await perfil(repo, empresaId);
  const marcados = new Set([].concat(seleccion || []));
  const declarables = ambitos.filter((a) => a.declarable);
  for (const m of marcados) if (!declarables.some((a) => a.codigo === m)) throw error(422, `Ambito no declarable: ${m}`);

  return repo.transaccion(async (tx) => {
    const existentes = new Map((await tx.listar('empresa_ambito', { empresa_id: empresaId })).map((e) => [e.ambito, e]));
    for (const a of declarables) {
      const quiere = marcados.has(a.codigo) ? 'activo' : 'inactivo';
      const actual = existentes.get(a.codigo);
      if (!actual && quiere === 'activo') await tx.insertar('empresa_ambito', { empresa_id: empresaId, ambito: a.codigo });
      else if (actual && actual.estado !== quiere) await tx.actualizar('empresa_ambito', actual.id, { estado: quiere });
    }
  });
}

/** Normas aplicables + items evaluados (incluidos los de normas que ya no aplican o fueron derogadas). */
async function matriz(repo, empresaId) {
  const { empresa, ambitos, activos, declarados } = await perfil(repo, empresaId);
  const normas = await catalogo.normas();
  const porCodigo = new Map(normas.map((n) => [n.codigo, n]));
  const items = await repo.listar('matriz_legal_item', { empresa_id: empresaId, estado: 'activo' });
  const itemPorNorma = new Map(items.map((i) => [i.norma_codigo, i]));

  const evidencias = await repo.consultar(
    `SELECT ev.item_id, d.id, d.codigo, d.titulo, d.version, d.estado
       FROM matriz_legal_evidencia ev
       JOIN documento_sst d ON d.tenant_id = {tenant} AND d.id = ev.documento_id
      WHERE ev.tenant_id = {tenant} AND ev.estado = 'activo'
        AND ev.item_id IN (SELECT i.id FROM matriz_legal_item i WHERE i.tenant_id = {tenant} AND i.empresa_id = ?)`,
    [empresaId],
  );
  const evPorItem = new Map();
  for (const e of evidencias) {
    if (!evPorItem.has(e.item_id)) evPorItem.set(e.item_id, []);
    evPorItem.get(e.item_id).push(e);
  }

  const fila = (n) => {
    const item = itemPorNorma.get(n.codigo) || null;
    return { norma: n, item, evidencias: item ? evPorItem.get(item.id) || [] : [] };
  };
  const aplicables = auditor.normasAplicables(normas, activos).map(fila);
  const codigosAplicables = new Set(aplicables.map((f) => f.norma.codigo));
  const fueraDePerfil = items
    .filter((i) => !codigosAplicables.has(i.norma_codigo) && porCodigo.has(i.norma_codigo))
    .map((i) => fila(porCodigo.get(i.norma_codigo)));

  const conteo = { total: aplicables.length };
  for (const e of ESTADOS_CUMPLIMIENTO) conteo[e] = aplicables.filter((f) => (f.item ? f.item.estado_cumplimiento : 'sin_evaluar') === e).length;
  conteo.porcentaje = aplicables.length
    ? Math.round(((conteo.cumple + conteo.cumple_parcial * 0.5) / aplicables.length) * 10000) / 100
    : 0;

  return { empresa, ambitos, activos, declarados, aplicables, fueraDePerfil, conteo };
}

async function documentosVigentes(repo, empresaId) {
  return repo.consultar(
    `SELECT id, codigo, titulo, version, tipo_documental FROM documento_sst
      WHERE tenant_id = {tenant} AND empresa_id = ? AND estado = 'vigente' ORDER BY codigo, version DESC`,
    [empresaId],
  );
}

/**
 * Guarda la evaluacion de una norma. 'cumple' exige al menos un documento vigente como evidencia:
 * el cumplimiento se demuestra, no se declara.
 */
async function guardarItem(repo, empresaId, datos) {
  await empresaDelTenant(repo, empresaId);
  const codigo = String(datos.normaCodigo || '');
  const [norma] = await consultarCatalogo("SELECT codigo FROM norma WHERE codigo = ? AND estado = 'activo'", [codigo]);
  if (!norma) throw error(422, 'Norma inexistente en el catalogo');
  const estado = String(datos.estadoCumplimiento || 'sin_evaluar');
  if (!ESTADOS_CUMPLIMIENTO.includes(estado)) throw error(422, 'Estado de cumplimiento invalido');
  const responsableId = datos.responsableId ? Number.parseInt(datos.responsableId, 10) : null;
  if (responsableId && !(await cuentas.usuarioEnTenant(repo.tenantId, responsableId))) throw error(422, 'El responsable no pertenece a esta empresa');

  const docsIds = [...new Set([].concat(datos.documentos || []).map((d) => Number.parseInt(d, 10)).filter((d) => d > 0))];
  const vigentes = new Set((await documentosVigentes(repo, empresaId)).map((d) => d.id));
  for (const d of docsIds) if (!vigentes.has(d)) throw error(422, 'Solo se admiten documentos vigentes de la empresa como evidencia');
  if (estado === 'cumple' && docsIds.length === 0) throw error(422, 'Para marcar Cumple debe asociar al menos un documento vigente como evidencia');

  const observacion = String(datos.observacion || '').trim().slice(0, 1000) || null;

  return repo.transaccion(async (tx) => {
    let [item] = await tx.listar('matriz_legal_item', { empresa_id: empresaId, norma_codigo: codigo });
    const evaluacion = { evaluado_por: tx.actor.id ?? null, evaluado_en: new Date() };
    if (!item) {
      const id = await tx.insertar('matriz_legal_item', {
        empresa_id: empresaId, norma_codigo: codigo, estado_cumplimiento: estado, responsable_id: responsableId,
        observacion, ...(estado !== 'sin_evaluar' ? evaluacion : {}),
      });
      item = { id };
    } else {
      const cambios = { estado_cumplimiento: estado, responsable_id: responsableId, observacion, estado: 'activo' };
      if (item.estado_cumplimiento !== estado) Object.assign(cambios, evaluacion);
      await tx.actualizar('matriz_legal_item', item.id, cambios, { accion: 'evaluar' });
    }

    const actuales = await tx.listar('matriz_legal_evidencia', { item_id: item.id });
    const porDoc = new Map(actuales.map((e) => [e.documento_id, e]));
    for (const d of docsIds) {
      const e = porDoc.get(d);
      if (!e) await tx.insertar('matriz_legal_evidencia', { item_id: item.id, documento_id: d });
      else if (e.estado !== 'activo') await tx.actualizar('matriz_legal_evidencia', e.id, { estado: 'activo' });
    }
    for (const e of actuales) {
      if (e.estado === 'activo' && !docsIds.includes(e.documento_id)) await tx.actualizar('matriz_legal_evidencia', e.id, { estado: 'retirado' }, { accion: 'retirar' });
    }
    return item.id;
  });
}

// ---------- Boletin

async function boletinesPendientes(repo, empresaId) {
  return repo.consultar(
    `SELECT be.id, be.motivo, be.creado_en, b.norma_codigo, b.tipo_cambio, b.estado_anterior, b.estado_nuevo,
            b.detalle, b.publicado_en, n.objeto, n.derogada_por
       FROM boletin_empresa be
       JOIN boletin_normativo b ON b.id = be.boletin_id
       LEFT JOIN norma n ON n.codigo = b.norma_codigo
      WHERE be.tenant_id = {tenant} AND be.empresa_id = ? AND be.estado = 'pendiente'
      ORDER BY b.publicado_en DESC`,
    [empresaId],
  );
}

async function revisarBoletin(repo, empresaId, id, observacion) {
  const obs = String(observacion || '').trim();
  if (obs.length < 5) throw error(422, 'Describa que se reviso o ajusto');
  return repo.transaccion(async (tx) => {
    const be = await tx.obtener('boletin_empresa', id);
    if (!be || be.empresa_id !== empresaId) throw error(404, 'Boletin no encontrado');
    if (be.estado !== 'pendiente') throw error(409, 'El boletin ya fue revisado');
    await tx.actualizar('boletin_empresa', id, {
      estado: 'revisado', observacion: obs.slice(0, 500), revisado_por: tx.actor.id ?? null, revisado_en: new Date(),
    }, { accion: 'revisar' });
  });
}

/** Job diario: crea boletin_empresa para cada empresa del tenant afectada por un cambio normativo. */
async function propagarBoletines(repo) {
  const boletines = await consultarCatalogo(
    `SELECT id, norma_codigo, tipo_cambio, publicado_en FROM boletin_normativo
      WHERE publicado_en >= NOW() - INTERVAL ${DIAS_BOLETIN} DAY ORDER BY id`,
  );
  if (!boletines.length) return 0;
  const normas = new Map((await catalogo.normas()).map((n) => [n.codigo, n]));
  const empresas = await repo.listar('empresa', { estado: 'activa' });
  let creados = 0;

  for (const empresa of empresas) {
    const { activos } = await perfil(repo, empresa.id);
    const yaPropagados = new Set((await repo.listar('boletin_empresa', { empresa_id: empresa.id })).map((b) => b.boletin_id));
    const enMatriz = new Set((await repo.listar('matriz_legal_item', { empresa_id: empresa.id, estado: 'activo' })).map((i) => i.norma_codigo));
    const citas = await repo.consultar(
      `SELECT dn.norma_codigo, dn.documento_id FROM documento_norma dn
         JOIN documento_sst d ON d.tenant_id = {tenant} AND d.id = dn.documento_id
        WHERE dn.tenant_id = {tenant} AND dn.estado = 'activo' AND d.empresa_id = ? AND d.estado IN ('borrador','vigente')
       UNION
       SELECT i.norma_codigo, ev.documento_id FROM matriz_legal_evidencia ev
         JOIN matriz_legal_item i ON i.tenant_id = {tenant} AND i.id = ev.item_id
        WHERE ev.tenant_id = {tenant} AND ev.estado = 'activo' AND i.empresa_id = ?`,
      [empresa.id, empresa.id],
    );
    const docsPorNorma = new Map();
    for (const c of citas) {
      if (!docsPorNorma.has(c.norma_codigo)) docsPorNorma.set(c.norma_codigo, new Set());
      docsPorNorma.get(c.norma_codigo).add(c.documento_id);
    }

    for (const b of boletines) {
      if (yaPropagados.has(b.id) || new Date(b.publicado_en) < new Date(empresa.creado_en)) continue;
      const norma = normas.get(b.norma_codigo);
      const motivo = boletin.motivoAfectacion(b, {
        aplicaPerfil: Boolean(norma && activos.has(norma.ambito)),
        enMatriz: enMatriz.has(b.norma_codigo),
        documentos: [...(docsPorNorma.get(b.norma_codigo) || [])],
      });
      if (!motivo) continue;
      await repo.insertar('boletin_empresa', { empresa_id: empresa.id, boletin_id: b.id, motivo });
      creados++;
    }
  }
  return creados;
}

// ---------- Auditor

async function ejecutarAuditoria(repo, empresaId, { texto, fuente, nombreArchivo }) {
  const t = String(texto || '');
  if (!t.trim()) throw error(422, 'Pegue o cargue el listado de normas de la matriz');
  if (Buffer.byteLength(t) > MAX_TEXTO) throw error(422, 'El listado supera 512 KB');
  if (t.split(/\r?\n/).length > MAX_LINEAS) throw error(422, `El listado supera ${MAX_LINEAS} lineas`);

  const { activos } = await perfil(repo, empresaId);
  const [normas, desinformacion] = await Promise.all([catalogo.normas(), catalogo.desinformacion()]);
  const r = auditor.auditar({ texto: t, normas, desinformacion, activos });

  // El registro es inmutable y trae la entrada completa; el log solo guarda los totales.
  const id = await repo.insertar('auditoria_matriz', {
    empresa_id: empresaId,
    fuente: fuente === 'csv' ? 'csv' : 'manual',
    nombre_archivo: nombreArchivo ? String(nombreArchivo).slice(0, 255) : null,
    texto_original: t,
    ambitos_evaluados: Object.fromEntries(activos),
    total_declaradas: r.totales.declaradas,
    total_derogadas: r.totales.derogadas,
    total_desinformacion: r.totales.desinformacion,
    total_no_reconocidas: r.totales.no_reconocidas,
    total_faltantes: r.totales.faltantes,
    total_no_aplican: r.totales.no_aplican,
    total_correctas: r.totales.correctas,
    cobertura: r.totales.cobertura.toFixed(2),
    resultado: r,
  }, { auditar: false });
  await repo.auditar('crear', 'auditoria_matriz', id, null, { empresa_id: empresaId, fuente, totales: r.totales });
  return id;
}

async function obtenerAuditoria(repo, empresaId, id) {
  const a = await repo.obtener('auditoria_matriz', id);
  if (!a || a.empresa_id !== empresaId) throw error(404, 'Auditoria no encontrada');
  return { ...a, resultado: typeof a.resultado === 'string' ? JSON.parse(a.resultado) : a.resultado };
}

async function listarAuditorias(repo, empresaId) {
  return repo.consultar(
    `SELECT id, fuente, nombre_archivo, total_declaradas, total_derogadas, total_desinformacion, total_faltantes,
            total_no_aplican, total_correctas, cobertura, creado_en, creado_por
       FROM auditoria_matriz WHERE tenant_id = {tenant} AND empresa_id = ? ORDER BY id DESC LIMIT 50`,
    [empresaId],
  );
}

module.exports = {
  ESTADOS_CUMPLIMIENTO, perfil, guardarPerfil, matriz, documentosVigentes, guardarItem,
  boletinesPendientes, revisarBoletin, propagarBoletines, ejecutarAuditoria, obtenerAuditoria, listarAuditorias,
};
