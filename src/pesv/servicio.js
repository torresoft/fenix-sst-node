// M18 PESV: 24 pasos con evidencia, vehiculos (SOAT y revision), conductores (licencia) e inspeccion
// preoperacional. Un vehiculo o conductor con documentos vencidos no queda apto en el preoperacional.
const especificos = require('../../data/especificos.json');
const { consultarCatalogo } = require('../db/global');
const { hoyBogota } = require('../fechas/calendario');
const plazos = require('../plazos/servicio');
const { error } = require('../comun/rutas');

const TIPOS = ['automovil', 'camioneta', 'camion', 'bus', 'motocicleta', 'maquinaria', 'otro'];
const PROPIEDAD = ['propio', 'leasing', 'tercero', 'colaborador'];
const ESTADOS_PASO = ['no_iniciado', 'en_proceso', 'implementado', 'no_aplica'];
const ITEMS = especificos.preoperacional;
const fecha = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) ? String(v) : null);
const texto = (v, max) => { const s = String(v ?? '').trim(); return s ? s.slice(0, max) : null; };
const lista = (v) => (Array.isArray(v) ? v : v == null ? [] : [v]);

const pasos = () => consultarCatalogo("SELECT codigo, fase, nombre FROM pesv_paso WHERE estado = 'activo' ORDER BY codigo");

/** Obligatoriedad: mas de N vehiculos o N o mas conductores (umbrales de catalogo). */
function obligatorio(vehiculos, conductores) {
  return vehiculos > especificos.pesv.umbral_vehiculos || conductores >= especificos.pesv.umbral_conductores;
}

/** Porcentaje de implementacion sobre los pasos que aplican; texto con 2 decimales. */
function avancePorcentaje(estados) {
  const aplican = estados.filter((e) => e !== 'no_aplica');
  if (!aplican.length) return '0.00';
  return (Math.round((aplican.filter((e) => e === 'implementado').length * 10000) / aplican.length) / 100).toFixed(2);
}

/** Motivos por los que un vehiculo o conductor no puede operar en la fecha. */
function bloqueos(vehiculo, conductor, f) {
  const b = [];
  if (vehiculo.soat_vence < f) b.push(`SOAT vencido el ${vehiculo.soat_vence}`);
  if (vehiculo.rtm_vence && vehiculo.rtm_vence < f) b.push(`Revision tecnico-mecanica vencida el ${vehiculo.rtm_vence}`);
  if (conductor.licencia_vence < f) b.push(`Licencia del conductor vencida el ${conductor.licencia_vence}`);
  return b;
}

async function avance(repo, empresaId) {
  const [cat, filas] = await Promise.all([
    pasos(),
    repo.consultar(
      `SELECT a.* FROM pesv_avance a
        WHERE a.tenant_id = {tenant} AND a.empresa_id = ?
          AND a.id = (SELECT MAX(b.id) FROM pesv_avance b WHERE b.tenant_id = {tenant} AND b.empresa_id = a.empresa_id AND b.paso_codigo = a.paso_codigo)`, [empresaId],
    ),
  ]);
  const ultimo = new Map(filas.map((f) => [f.paso_codigo, f]));
  const lista2 = cat.map((p) => ({ ...p, avance: ultimo.get(p.codigo) || null, estado: ultimo.has(p.codigo) ? ultimo.get(p.codigo).estado : 'no_iniciado' }));
  return { pasos: lista2, porcentaje: avancePorcentaje(lista2.map((p) => p.estado)) };
}

async function registrarAvance(repo, empresaId, d, hoy = hoyBogota()) {
  const paso = (await pasos()).find((p) => p.codigo === d.paso_codigo);
  if (!paso) throw error(422, 'Paso invalido');
  if (!ESTADOS_PASO.includes(d.estado)) throw error(422, 'Estado invalido');
  const f = fecha(d.fecha) || hoy;
  if (f > hoy) throw error(422, 'La fecha no puede ser futura');
  let docId = null;
  if (d.documento_id) {
    const doc = await repo.obtener('documento_sst', Number.parseInt(d.documento_id, 10));
    if (!doc || doc.empresa_id !== empresaId || !['PESV', 'EVIDENCIA_PESV'].includes(doc.tipo_documental) || doc.estado !== 'vigente') throw error(422, 'Evidencia invalida');
    docId = doc.id;
  }
  if (d.estado === 'implementado' && !docId) throw error(422, 'Un paso implementado requiere evidencia en el gestor documental');
  const obs = texto(d.observacion, 1000);
  if (d.estado === 'no_aplica' && (!obs || obs.length < 10)) throw error(422, 'Justifique por que el paso no aplica');
  return repo.insertar('pesv_avance', { empresa_id: empresaId, paso_codigo: paso.codigo, estado: d.estado, fecha: f, documento_id: docId, observacion: obs });
}

// ---- Vehiculos ----

async function vehiculo(repo, empresaId, id) {
  const v = await repo.obtener('vehiculo', Number.parseInt(id, 10));
  if (!v || v.empresa_id !== empresaId) throw error(404, 'Vehiculo no encontrado');
  return v;
}

// Un documento ya vencido al registrarlo queda con la obligacion vencida desde su fecha.
const inicio = (limite, hoy) => (limite < hoy ? limite : hoy);

async function vigenciasVehiculo(tx, empresaId, id, v, hoy) {
  await plazos.registrarVigencia(tx, { vencimientoCodigo: 'VEH_SOAT', empresaId, entidadTipo: 'vehiculo', entidadId: id, fechaInicio: inicio(v.soat_vence, hoy), fechaLimite: v.soat_vence }, hoy);
  if (v.rtm_vence) await plazos.registrarVigencia(tx, { vencimientoCodigo: 'VEH_RTM', empresaId, entidadTipo: 'vehiculo', entidadId: id, fechaInicio: inicio(v.rtm_vence, hoy), fechaLimite: v.rtm_vence }, hoy);
}

async function registrarVehiculo(repo, empresaId, d, hoy = hoyBogota()) {
  const v = {
    placa: texto(d.placa, 10) ? texto(d.placa, 10).toUpperCase().replace(/[\s-]/g, '') : null, tipo: TIPOS.includes(d.tipo) ? d.tipo : null,
    propiedad: PROPIEDAD.includes(d.propiedad) ? d.propiedad : null, marca_modelo: texto(d.marca_modelo, 100),
    soat_vence: fecha(d.soat_vence), rtm_vence: fecha(d.rtm_vence),
  };
  if (!v.placa || !/^[A-Z0-9]{5,7}$/.test(v.placa)) throw error(422, 'Placa invalida');
  if (!v.tipo || !v.propiedad) throw error(422, 'Tipo y propiedad son obligatorios');
  if (!v.soat_vence) throw error(422, 'Registre el vencimiento del SOAT');
  const [dup] = await repo.listar('vehiculo', { empresa_id: empresaId, placa: v.placa });
  if (dup) throw error(409, `Ya existe el vehiculo ${v.placa}`);
  return repo.transaccion(async (tx) => {
    const id = await tx.insertar('vehiculo', { empresa_id: empresaId, ...v });
    await vigenciasVehiculo(tx, empresaId, id, v, hoy);
    return id;
  });
}

/** Renovacion de SOAT o revision: nuevas fechas y nuevas obligaciones. */
async function renovarVehiculo(repo, empresaId, id, d, hoy = hoyBogota()) {
  const actual = await vehiculo(repo, empresaId, id);
  if (actual.estado !== 'activo') throw error(409, 'El vehiculo esta inactivo');
  const cambios = {};
  if (fecha(d.soat_vence)) cambios.soat_vence = fecha(d.soat_vence);
  if (fecha(d.rtm_vence)) cambios.rtm_vence = fecha(d.rtm_vence);
  if (!Object.keys(cambios).length) throw error(422, 'Indique la nueva fecha de SOAT o de revision');
  // Renovar es extender: la nueva fecha es futura y posterior a la vigente.
  for (const [campo, nueva] of Object.entries(cambios)) {
    if (nueva <= hoy || (actual[campo] && nueva <= actual[campo])) throw error(422, 'La nueva fecha de vencimiento debe ser futura y posterior a la actual');
  }
  await repo.transaccion(async (tx) => {
    await tx.actualizar('vehiculo', actual.id, cambios, { accion: 'renovar' });
    for (const [codigo, campo] of [['VEH_SOAT', 'soat_vence'], ['VEH_RTM', 'rtm_vence']]) {
      if (!cambios[campo]) continue;
      for (const o of await plazos.abiertasDe(tx, 'vehiculo', actual.id, codigo)) {
        await plazos.cumplirObligacion(tx, o.id, { fecha: hoy, observacion: `Renovado hasta ${cambios[campo]}` }, hoy);
      }
      await plazos.registrarVigencia(tx, { vencimientoCodigo: codigo, empresaId, entidadTipo: 'vehiculo', entidadId: actual.id, fechaInicio: hoy, fechaLimite: cambios[campo] }, hoy);
    }
  });
}

async function inactivarVehiculo(repo, empresaId, id, motivo) {
  const v = await vehiculo(repo, empresaId, id);
  if (v.estado !== 'activo') throw error(409, 'Ya esta inactivo');
  const m = texto(motivo, 500);
  if (!m || m.length < 10) throw error(422, 'Indique el motivo');
  await repo.transaccion(async (tx) => {
    await tx.actualizar('vehiculo', v.id, { estado: 'inactivo', motivo_estado: m }, { accion: 'inactivar' });
    for (const o of await plazos.abiertasDe(tx, 'vehiculo', v.id)) await plazos.anularObligacion(tx, o.id, `Vehiculo inactivo: ${m}`);
  });
}

// ---- Conductores ----

async function registrarConductor(repo, empresaId, d, hoy = hoyBogota()) {
  const personaId = Number.parseInt(d.persona_id, 10);
  const [v] = await repo.listar('vinculacion', { empresa_id: empresaId, persona_id: personaId, estado: 'activa' });
  if (!v) throw error(422, 'La persona no tiene vinculacion activa con la empresa');
  const c = { licencia_numero: texto(d.licencia_numero, 30), licencia_categoria: texto(d.licencia_categoria, 10), licencia_vence: fecha(d.licencia_vence) };
  if (!c.licencia_numero || !c.licencia_categoria || !c.licencia_vence) throw error(422, 'Numero, categoria y vencimiento de la licencia son obligatorios');
  if (c.licencia_vence < hoy) throw error(422, 'La licencia esta vencida');
  const [ya] = await repo.listar('conductor', { empresa_id: empresaId, persona_id: personaId, estado: 'activo' });
  return repo.transaccion(async (tx) => {
    if (ya) {
      await tx.actualizar('conductor', ya.id, { estado: 'inactivo' }, { accion: 'reemplazar' });
      for (const o of await plazos.abiertasDe(tx, 'conductor', ya.id)) await plazos.cumplirObligacion(tx, o.id, { fecha: hoy, observacion: 'Licencia renovada' }, hoy);
    }
    const id = await tx.insertar('conductor', { empresa_id: empresaId, persona_id: personaId, ...c, licencia_categoria: c.licencia_categoria.toUpperCase() });
    await plazos.registrarVigencia(tx, { vencimientoCodigo: 'LICENCIA_CONDUCCION', empresaId, entidadTipo: 'conductor', entidadId: id, fechaInicio: hoy, fechaLimite: c.licencia_vence }, hoy);
    return id;
  });
}

async function inactivarConductor(repo, empresaId, id) {
  const c = await repo.obtener('conductor', id);
  if (!c || c.empresa_id !== empresaId) throw error(404, 'Conductor no encontrado');
  if (c.estado !== 'activo') throw error(409, 'Ya esta inactivo');
  await repo.transaccion(async (tx) => {
    await tx.actualizar('conductor', id, { estado: 'inactivo' }, { accion: 'inactivar' });
    for (const o of await plazos.abiertasDe(tx, 'conductor', id)) await plazos.anularObligacion(tx, o.id, 'Conductor inactivado por la empresa');
  });
}

// ---- Preoperacional ----

async function preoperacional(repo, empresaId, d, hoy = hoyBogota()) {
  const v = await vehiculo(repo, empresaId, d.vehiculo_id);
  if (v.estado !== 'activo') throw error(409, 'El vehiculo esta inactivo');
  const c = await repo.obtener('conductor', Number.parseInt(d.conductor_id, 10));
  if (!c || c.empresa_id !== empresaId || c.estado !== 'activo') throw error(422, 'Conductor invalido');
  const f = fecha(d.fecha) || hoy;
  if (f > hoy) throw error(422, 'La fecha no puede ser futura');
  const marcados = new Set(lista(d.ok).map(String));
  const items = ITEMS.map((item, i) => ({ item, ok: marcados.has(String(i)) }));
  const fallas = items.filter((x) => !x.ok).map((x) => x.item);
  const docs = bloqueos(v, c, f);
  const apto = fallas.length === 0 && docs.length === 0;
  const obs = [texto(d.observacion, 600), ...docs].filter(Boolean).join('. ') || null;
  if (!apto && !texto(d.observacion, 600) && !docs.length) throw error(422, 'Describa las fallas encontradas');
  await repo.insertar('preoperacional', { vehiculo_id: v.id, conductor_id: c.id, fecha: f, items, apto: apto ? 1 : 0, observacion: obs ? obs.slice(0, 1000) : null });
  return { apto, fallas, bloqueos: docs, tipoAviso: apto ? 'success' : 'warning' };
}

async function panel(repo, empresaId, hoy = hoyBogota()) {
  const [vehiculos, conductores, recientes, av] = await Promise.all([
    repo.consultar(
      `SELECT v.*, (SELECT p.apto FROM preoperacional p WHERE p.tenant_id = {tenant} AND p.vehiculo_id = v.id ORDER BY p.fecha DESC, p.id DESC LIMIT 1) AS ultimo_apto,
              (SELECT MAX(p.fecha) FROM preoperacional p WHERE p.tenant_id = {tenant} AND p.vehiculo_id = v.id) AS ultimo_preoperacional
         FROM vehiculo v WHERE v.tenant_id = {tenant} AND v.empresa_id = ? ORDER BY v.estado, v.placa`, [empresaId],
    ),
    repo.consultar(
      `SELECT c.*, p.nombres, p.apellidos, p.numero_documento FROM conductor c JOIN persona p ON p.tenant_id = {tenant} AND p.id = c.persona_id
        WHERE c.tenant_id = {tenant} AND c.empresa_id = ? AND c.estado = 'activo' ORDER BY p.apellidos`, [empresaId],
    ),
    repo.consultar(
      `SELECT p.*, v.placa, x.nombres, x.apellidos FROM preoperacional p
         JOIN vehiculo v ON v.tenant_id = {tenant} AND v.id = p.vehiculo_id
         JOIN conductor c ON c.tenant_id = {tenant} AND c.id = p.conductor_id
         JOIN persona x ON x.tenant_id = {tenant} AND x.id = c.persona_id
        WHERE p.tenant_id = {tenant} AND v.empresa_id = ? ORDER BY p.fecha DESC, p.id DESC LIMIT 100`, [empresaId],
    ),
    avance(repo, empresaId),
  ]);
  const activos = vehiculos.filter((v) => v.estado === 'activo');
  return {
    vehiculos: vehiculos.map((v) => ({ ...v, documentosVencidos: v.estado === 'activo' && (v.soat_vence < hoy || (v.rtm_vence && v.rtm_vence < hoy)) })),
    conductores: conductores.map((c) => ({ ...c, licenciaVencida: c.licencia_vence < hoy })),
    preoperacionales: recientes.map((p) => ({ ...p, items: typeof p.items === 'string' ? JSON.parse(p.items) : p.items })),
    avance: av,
    obligatorio: obligatorio(activos.length, conductores.length),
    umbrales: especificos.pesv,
  };
}

module.exports = {
  TIPOS, PROPIEDAD, ESTADOS_PASO, ITEMS, obligatorio, avancePorcentaje, bloqueos, pasos, avance, registrarAvance,
  registrarVehiculo, renovarVehiculo, inactivarVehiculo, registrarConductor, inactivarConductor, preoperacional, panel,
};
