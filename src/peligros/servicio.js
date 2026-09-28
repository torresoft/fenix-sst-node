// M05: matriz de identificacion de peligros y valoracion de riesgos, versionada, con jerarquia de controles.
const { consultarCatalogo } = require('../db/global');
const { hoyBogota } = require('../fechas/calendario');
const plazos = require('../plazos/servicio');
const { error } = require('../comun/rutas');
const motor = require('./motor');
const { celda } = require('../integraciones/csv');

const texto = (v, max) => { const s = String(v ?? '').trim(); return s ? s.slice(0, max) : null; };
const parse = (v) => (typeof v === 'string' ? JSON.parse(v) : v);

const catalogo = {
  metodologias: () => consultarCatalogo("SELECT * FROM metodologia_riesgo WHERE estado = 'activo' ORDER BY codigo"),
  clases: () => consultarCatalogo("SELECT * FROM peligro_clase WHERE estado = 'activo' ORDER BY nombre"),
  jerarquia: () => consultarCatalogo("SELECT * FROM control_jerarquia WHERE estado = 'activo' ORDER BY nivel"),
  peligrosTipo: async () => (await consultarCatalogo("SELECT * FROM peligro_tipo WHERE estado = 'activo' ORDER BY clase_codigo, nombre"))
    .map((p) => ({ ...p, controles: parse(p.controles) || [] })),
  cargosTipo: async () => (await consultarCatalogo("SELECT * FROM cargo_tipo WHERE estado = 'activo' ORDER BY nombre"))
    .map((c) => ({ ...c, peligros: parse(c.peligros) || [], competencias: parse(c.competencias) || [] })),
};

async function metodologia(codigo) {
  const m = (await catalogo.metodologias()).find((x) => x.codigo === codigo);
  if (!m) throw motor.errorValidacion('Metodologia invalida');
  return { ...m, escalas: parse(m.escalas) };
}

async function obtener(repo, empresaId, id) {
  const m = await repo.obtener('matriz_riesgo', id);
  if (!m || m.empresa_id !== empresaId) throw error(404, 'Matriz no encontrada');
  return m;
}

const enBorrador = (m) => {
  if (m.estado !== 'borrador') throw error(409, 'La matriz no esta en borrador: cree una version nueva');
  return m;
};

async function listar(repo, empresaId) {
  return repo.consultar(
    `SELECT m.*, (SELECT COUNT(*) FROM riesgo_item i WHERE i.tenant_id = {tenant} AND i.matriz_id = m.id AND i.estado = 'activo') AS items
       FROM matriz_riesgo m WHERE m.tenant_id = {tenant} AND m.empresa_id = ? ORDER BY m.version DESC`, [empresaId],
  );
}

/** Nueva version en borrador; si hay vigente, copia sus peligros y cargos expuestos. */
async function crearVersion(repo, empresaId, d, hoy = hoyBogota()) {
  const motivos = ['inicial', 'anual', 'at_mortal', 'cambio'];
  if (!motivos.includes(d.motivo)) throw motor.errorValidacion('Motivo invalido');
  const met = await metodologia(d.metodologia_codigo || 'GTC45');
  const versiones = await repo.listar('matriz_riesgo', { empresa_id: empresaId });
  if (versiones.some((v) => v.estado === 'borrador')) throw error(409, 'Ya hay una version en borrador');
  const base = versiones.find((v) => v.estado === 'vigente') || null;
  return repo.transaccion(async (tx) => {
    const id = await tx.insertar('matriz_riesgo', {
      empresa_id: empresaId, version: versiones.length ? Math.max(...versiones.map((v) => v.version)) + 1 : 1,
      metodologia_codigo: met.codigo, motivo: d.motivo, fecha_elaboracion: hoy, matriz_padre_id: base ? base.id : null,
    });
    if (base) {
      for (const i of await tx.listar('riesgo_item', { matriz_id: base.id, estado: 'activo' })) {
        const { id: viejo, tenant_id: _t, matriz_id: _m, creado_por: _c, creado_en: _e, actualizado_en: _a, ...resto } = i;
        const nuevo = await tx.insertar('riesgo_item', { ...resto, matriz_id: id }, { auditar: false });
        for (const c of await tx.listar('riesgo_item_cargo', { item_id: viejo, estado: 'activo' })) {
          await tx.insertar('riesgo_item_cargo', { item_id: nuevo, cargo_id: c.cargo_id }, { auditar: false });
        }
      }
    }
    return id;
  });
}

async function detalle(repo, empresaId, id) {
  const m = await obtener(repo, empresaId, id);
  const met = await metodologia(m.metodologia_codigo);
  const [items, cargos, controles, clases, jerarquia] = await Promise.all([
    repo.consultar(
      `SELECT i.*, ct.nombre AS centro FROM riesgo_item i
         LEFT JOIN centro_trabajo ct ON ct.tenant_id = {tenant} AND ct.id = i.centro_trabajo_id
        WHERE i.tenant_id = {tenant} AND i.matriz_id = ? AND i.estado = 'activo' ORDER BY i.proceso, i.actividad, i.id`, [id],
    ),
    repo.consultar(
      `SELECT ric.item_id, c.id, c.nombre FROM riesgo_item_cargo ric
         JOIN cargo c ON c.tenant_id = {tenant} AND c.id = ric.cargo_id
         JOIN riesgo_item i ON i.tenant_id = {tenant} AND i.id = ric.item_id
        WHERE ric.tenant_id = {tenant} AND ric.estado = 'activo' AND i.matriz_id = ?`, [id],
    ),
    repo.consultar(
      `SELECT rc.* FROM riesgo_control rc JOIN riesgo_item i ON i.tenant_id = {tenant} AND i.id = rc.item_id
        WHERE rc.tenant_id = {tenant} AND i.matriz_id = ? ORDER BY rc.item_id, rc.id`, [id],
    ),
    catalogo.clases(),
    catalogo.jerarquia(),
  ]);
  const documento = m.documento_id ? await repo.obtener('documento_sst', m.documento_id) : null;
  const criticos = new Set(met.escalas.nr.filter((x) => x.critico).map((x) => x.codigo));
  const conteo = Object.fromEntries(met.escalas.nr.map((x) => [x.codigo, items.filter((i) => i.nivel_riesgo === x.codigo).length]));
  return {
    m, met, clases, jerarquia, documento, conteo,
    items: items.map((i) => ({
      ...i, cargos: cargos.filter((c) => c.item_id === i.id), controles: controles.filter((c) => c.item_id === i.id),
    })),
    avisos: motor.advertenciasJerarquia(items, controles, criticos),
    impedimentos: motor.impedimentosPublicar(m, items, documento && documento.estado === 'vigente' ? documento : null),
  };
}

async function guardarItem(repo, empresaId, matrizId, itemId, d) {
  const m = enBorrador(await obtener(repo, empresaId, matrizId));
  const met = await metodologia(m.metodologia_codigo);
  const clases = (await catalogo.clases()).map((c) => c.codigo);
  if (!clases.includes(d.clase_peligro)) throw motor.errorValidacion('Clasificacion de peligro invalida');
  const tipo = d.peligro_tipo_codigo ? (await catalogo.peligrosTipo()).find((p) => p.codigo === d.peligro_tipo_codigo) : null;
  if (d.peligro_tipo_codigo && !tipo) throw motor.errorValidacion('Peligro del catalogo invalido');
  // Medidas del catalogo marcadas en el formulario: se agregan como propuestas.
  const medidas = tipo ? [...new Set([].concat(d.medidas_sugeridas || []).map(Number))].map((i) => tipo.controles[i]).filter(Boolean) : [];
  const proceso = texto(d.proceso, 150);
  const actividad = texto(d.actividad, 255);
  const peligro = texto(d.peligro, 255);
  if (!proceso || !actividad || !peligro) throw motor.errorValidacion('Proceso, actividad y descripcion del peligro son obligatorios');
  const v = motor.evaluar(met.escalas, { nd: d.nd, ne: d.ne, nc: d.nc });
  const centroId = d.centro_trabajo_id ? Number.parseInt(d.centro_trabajo_id, 10) : null;
  if (centroId) {
    const c = await repo.obtener('centro_trabajo', centroId);
    if (!c || c.empresa_id !== empresaId) throw motor.errorValidacion('Centro de trabajo invalido');
  }
  const cargos = [...new Set([].concat(d.cargos || []).map((x) => Number.parseInt(x, 10)).filter(Boolean))];
  for (const c of cargos) {
    const cargo = await repo.obtener('cargo', c);
    if (!cargo || cargo.empresa_id !== empresaId) throw motor.errorValidacion('Cargo invalido');
  }
  const fila = {
    proceso, actividad, peligro, centro_trabajo_id: centroId, tarea: texto(d.tarea, 255),
    rutinaria: d.rutinaria === '0' ? 0 : 1, clase_peligro: d.clase_peligro, efectos: texto(d.efectos, 500),
    peligro_tipo_codigo: tipo && tipo.clase_codigo === d.clase_peligro ? tipo.codigo : null, sugerido: 0,
    control_fuente: texto(d.control_fuente, 500), control_medio: texto(d.control_medio, 500), control_individuo: texto(d.control_individuo, 500),
    nd: d.nd, ne: d.ne, nc: d.nc, np: v.np, nr: v.nr, nivel_riesgo: v.nivel_riesgo, aceptabilidad: v.aceptabilidad,
    expuestos: Math.max(0, Number.parseInt(d.expuestos, 10) || 0), peor_consecuencia: texto(d.peor_consecuencia, 255),
    norma_codigo: texto(d.norma_codigo, 40),
  };
  return repo.transaccion(async (tx) => {
    let id = itemId;
    if (id) {
      const i = await tx.obtener('riesgo_item', id);
      if (!i || i.matriz_id !== matrizId) throw error(404, 'Peligro no encontrado');
      await tx.actualizar('riesgo_item', id, fila, { accion: 'valorar' });
    } else {
      id = await tx.insertar('riesgo_item', { matriz_id: matrizId, ...fila });
    }
    const actuales = await tx.listar('riesgo_item_cargo', { item_id: id });
    for (const c of cargos) {
      const a = actuales.find((x) => x.cargo_id === c);
      if (!a) await tx.insertar('riesgo_item_cargo', { item_id: id, cargo_id: c }, { auditar: false });
      else if (a.estado !== 'activo') await tx.actualizar('riesgo_item_cargo', a.id, { estado: 'activo' }, { auditar: false });
    }
    for (const a of actuales) {
      if (a.estado === 'activo' && !cargos.includes(a.cargo_id)) await tx.actualizar('riesgo_item_cargo', a.id, { estado: 'retirado' }, { auditar: false });
    }
    const previas = new Set((await tx.listar('riesgo_control', { item_id: id })).filter((c) => c.estado !== 'descartado').map((c) => c.descripcion));
    for (const c of medidas) {
      if (!previas.has(c.descripcion)) await tx.insertar('riesgo_control', { item_id: id, jerarquia_codigo: c.jerarquia, descripcion: c.descripcion });
    }
    return { id, ...v };
  });
}

async function retirarItem(repo, empresaId, matrizId, itemId) {
  enBorrador(await obtener(repo, empresaId, matrizId));
  const i = await repo.obtener('riesgo_item', itemId);
  if (!i || i.matriz_id !== matrizId) throw error(404, 'Peligro no encontrado');
  await repo.actualizar('riesgo_item', itemId, { estado: 'retirado' }, { accion: 'retirar' });
}

async function guardarDatos(repo, empresaId, id, d) {
  enBorrador(await obtener(repo, empresaId, id));
  let documentoId = null;
  if (d.documento_id) {
    const doc = await repo.obtener('documento_sst', Number.parseInt(d.documento_id, 10));
    if (!doc || doc.empresa_id !== empresaId || doc.tipo_documental !== 'MATRIZ_PELIGROS') throw motor.errorValidacion('El documento debe ser de tipo MATRIZ_PELIGROS');
    documentoId = doc.id;
  }
  await repo.actualizar('matriz_riesgo', id, { participantes: texto(d.participantes, 1000), documento_id: documentoId }, { accion: 'editar' });
}

/** Publica la version: reemplaza la vigente y cumple las actualizaciones pendientes por AT mortal. */
async function publicar(repo, empresaId, id, hoy = hoyBogota()) {
  const det = await detalle(repo, empresaId, id);
  if (det.impedimentos.length) throw motor.errorValidacion(det.impedimentos.join('. '));
  const pendientes = await repo.consultar(
    `SELECT o.id FROM obligacion_pendiente o JOIN evento e ON e.tenant_id = {tenant} AND e.id = o.entidad_origen_id
      WHERE o.tenant_id = {tenant} AND o.entidad_origen_tipo = 'evento' AND o.plazo_codigo = 'MATRIZ_AT_MORTAL'
        AND o.estado IN ('en_termino','por_vencer','vencido') AND e.empresa_id = ?`, [empresaId],
  );
  await repo.transaccion(async (tx) => {
    const [vigente] = await tx.listar('matriz_riesgo', { empresa_id: empresaId, estado: 'vigente' });
    if (vigente) await tx.actualizar('matriz_riesgo', vigente.id, { estado: 'reemplazada' }, { accion: 'reemplazar' });
    await tx.actualizar('matriz_riesgo', id, { estado: 'vigente', publicada_en: hoy }, { accion: 'publicar' });
    for (const o of pendientes) {
      await plazos.cumplirObligacion(tx, o.id, { fecha: hoy, observacion: `Matriz de peligros version ${det.m.version} publicada`, evidenciaDocumentoId: det.m.documento_id }, hoy);
    }
  });
  return pendientes.length;
}

async function anular(repo, empresaId, id) {
  enBorrador(await obtener(repo, empresaId, id));
  await repo.actualizar('matriz_riesgo', id, { estado: 'anulada', observacion: 'Borrador descartado' }, { accion: 'anular' });
}

// ---------- Controles (plan de intervencion: se gestionan tambien sobre la matriz vigente)

async function itemDeEmpresa(repo, empresaId, itemId) {
  const i = await repo.obtener('riesgo_item', itemId);
  if (!i) throw error(404, 'Peligro no encontrado');
  const m = await obtener(repo, empresaId, i.matriz_id);
  if (!['borrador', 'vigente'].includes(m.estado)) throw error(409, 'La matriz esta cerrada');
  return { i, m };
}

async function agregarControl(repo, empresaId, itemId, d) {
  const { m } = await itemDeEmpresa(repo, empresaId, itemId);
  const jer = (await catalogo.jerarquia()).map((x) => x.codigo);
  if (!jer.includes(d.jerarquia_codigo)) throw motor.errorValidacion('Nivel de la jerarquia de controles invalido');
  const desc = texto(d.descripcion, 1000);
  if (!desc || desc.length < 5) throw motor.errorValidacion('Describa la medida');
  const limite = d.fecha_limite ? String(d.fecha_limite) : null;
  if (limite && !/^\d{4}-\d{2}-\d{2}$/.test(limite)) throw motor.errorValidacion('Fecha limite invalida');
  await repo.insertar('riesgo_control', { item_id: itemId, jerarquia_codigo: d.jerarquia_codigo, descripcion: desc, responsable: texto(d.responsable, 150), fecha_limite: limite });
  return m.id;
}

async function cerrarControl(repo, empresaId, controlId, d, hoy = hoyBogota()) {
  const c = await repo.obtener('riesgo_control', controlId);
  if (!c) throw error(404, 'Medida no encontrada');
  const { m } = await itemDeEmpresa(repo, empresaId, c.item_id);
  if (c.estado !== 'propuesto') throw error(409, 'La medida ya esta cerrada');
  const estado = d.estado === 'descartado' ? 'descartado' : 'implementado';
  const f = String(d.fecha || hoy);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(f) || f > hoy) throw motor.errorValidacion('Fecha invalida');
  const obs = texto(d.observacion, 1000);
  if (!obs) throw motor.errorValidacion('Registre la observacion');
  await repo.actualizar('riesgo_control', controlId, { estado, fecha_implementacion: estado === 'implementado' ? f : null, observacion: obs }, { accion: estado });
  return m.id;
}

/** Procesos, actividades y tareas ya usados por la empresa (autocompletar). */
async function valoresPrevios(repo, empresaId) {
  const filas = await repo.consultar(
    `SELECT DISTINCT i.proceso, i.actividad, i.tarea FROM riesgo_item i
       JOIN matriz_riesgo m ON m.tenant_id = {tenant} AND m.id = i.matriz_id AND m.empresa_id = ?
      WHERE i.tenant_id = {tenant} AND i.estado = 'activo' LIMIT 1000`, [empresaId],
  );
  const unicos = (k) => [...new Set(filas.map((f) => f[k]).filter(Boolean))].sort();
  return { procesos: unicos('proceso'), actividades: unicos('actividad'), tareas: unicos('tarea') };
}

/** Cargos activos con su cargo tipo y trabajadores vinculados (para sugerir peligros). */
async function cargosParaSugerir(repo, empresaId) {
  return repo.consultar(
    `SELECT c.id, c.nombre, c.cargo_tipo_codigo,
            (SELECT COUNT(*) FROM vinculacion v WHERE v.tenant_id = {tenant} AND v.cargo_id = c.id AND v.estado = 'activa') AS expuestos
       FROM cargo c WHERE c.tenant_id = {tenant} AND c.empresa_id = ? AND c.estado = 'activo' ORDER BY c.nombre`, [empresaId],
  );
}

/**
 * Agrega a la matriz en borrador los peligros tipicos de los cargos elegidos, marcados como sugeridos
 * (ND medio por defecto): la matriz no se publica hasta revisarlos. d: { cargos: [ids], proceso_<id> }.
 */
async function generarDesdeCargos(repo, empresaId, matrizId, d) {
  const m = enBorrador(await obtener(repo, empresaId, matrizId));
  const met = await metodologia(m.metodologia_codigo);
  const elegidos = new Set([].concat(d.cargos || []).map(Number));
  const tipos = await catalogo.cargosTipo();
  const tipoValido = (x) => (tipos.some((t) => t.codigo === x) ? x : null);
  const cargos = (await cargosParaSugerir(repo, empresaId)).filter((c) => elegidos.has(c.id))
    .map((c) => ({
      ...c, tipo_previo: c.cargo_tipo_codigo, cargo_tipo_codigo: tipoValido(d[`tipo_${c.id}`]) || c.cargo_tipo_codigo,
      expuestos: Number(c.expuestos), proceso: texto(d[`proceso_${c.id}`], 150) || c.nombre,
    }))
    .filter((c) => c.cargo_tipo_codigo);
  if (!cargos.length) throw motor.errorValidacion('Elija al menos un cargo y su cargo tipo');
  // El cargo tipo elegido aqui queda asignado al cargo (alimenta su perfil de riesgo).
  for (const c of cargos.filter((x) => x.cargo_tipo_codigo !== x.tipo_previo)) {
    await repo.actualizar('cargo', c.id, { cargo_tipo_codigo: c.cargo_tipo_codigo }, { accion: 'asignar_tipo' });
  }
  const [peligros, det] = await Promise.all([catalogo.peligrosTipo(), detalle(repo, empresaId, matrizId)]);
  const existentes = det.items.map((i) => ({ ...i, cargos: i.cargos.map((c) => c.id) }));
  const p = motor.propuestasDesdeCargos(cargos, new Map(tipos.map((t) => [t.codigo, t])), new Map(peligros.map((x) => [x.codigo, x])), existentes);
  await repo.transaccion(async (tx) => {
    for (const n of p.nuevos) {
      const v = motor.evaluar(met.escalas, n);
      const { cargos: ids, ...fila } = n;
      const id = await tx.insertar('riesgo_item', {
        ...fila, matriz_id: matrizId, rutinaria: 1, np: v.np, nr: v.nr, nivel_riesgo: v.nivel_riesgo, aceptabilidad: v.aceptabilidad, sugerido: 1,
      });
      for (const c of ids) await tx.insertar('riesgo_item_cargo', { item_id: id, cargo_id: c }, { auditar: false });
    }
    for (const x of p.vincular) {
      const [previo] = await tx.listar('riesgo_item_cargo', { item_id: x.item_id, cargo_id: x.cargo_id });
      if (!previo) await tx.insertar('riesgo_item_cargo', x, { auditar: false });
      else await tx.actualizar('riesgo_item_cargo', previo.id, { estado: 'activo' }, { auditar: false });
    }
  });
  return { nuevos: p.nuevos.length, vinculados: p.vincular.length };
}

/** Peligros de la matriz vigente por cargo (para M07 y el perfil del cargo). */
async function peligrosPorCargo(repo, empresaId) {
  return repo.consultar(
    `SELECT c.id AS cargo_id, c.nombre AS cargo, i.clase_peligro, i.peligro, i.nivel_riesgo
       FROM riesgo_item_cargo ric
       JOIN riesgo_item i ON i.tenant_id = {tenant} AND i.id = ric.item_id AND i.estado = 'activo'
       JOIN matriz_riesgo m ON m.tenant_id = {tenant} AND m.id = i.matriz_id AND m.estado = 'vigente' AND m.empresa_id = ?
       JOIN cargo c ON c.tenant_id = {tenant} AND c.id = ric.cargo_id
      WHERE ric.tenant_id = {tenant} AND ric.estado = 'activo' ORDER BY c.nombre, i.nivel_riesgo`, [empresaId],
  );
}

function aCsv(det) {
  const filas = [['Proceso', 'Centro', 'Actividad', 'Tarea', 'Rutinaria', 'Clasificacion', 'Peligro', 'Efectos', 'Control fuente', 'Control medio', 'Control individuo',
    'ND', 'NE', 'NP', 'NC', 'NR', 'Nivel', 'Aceptabilidad', 'Expuestos', 'Peor consecuencia', 'Requisito legal', 'Cargos', 'Medidas de intervencion']];
  for (const i of det.items) {
    filas.push([i.proceso, i.centro, i.actividad, i.tarea, i.rutinaria ? 'Si' : 'No', i.clase_peligro, i.peligro, i.efectos, i.control_fuente, i.control_medio,
      i.control_individuo, i.nd, i.ne, i.np, i.nc, i.nr, i.nivel_riesgo, i.aceptabilidad, i.expuestos, i.peor_consecuencia, i.norma_codigo,
      i.cargos.map((c) => c.nombre).join(', '), i.controles.filter((c) => c.estado !== 'descartado').map((c) => `[${c.jerarquia_codigo}] ${c.descripcion}`).join(' | ')]);
  }
  return `﻿${filas.map((f) => f.map(celda).join(';')).join('\r\n')}\r\n`;
}

module.exports = {
  catalogo, listar, crearVersion, detalle, guardarItem, retirarItem, guardarDatos, publicar, anular,
  agregarControl, cerrarControl, peligrosPorCargo, aCsv, valoresPrevios, cargosParaSugerir, generarDesdeCargos,
};
