// Tablero consolidado de la cartera: una fila por empresa a la que el usuario tiene acceso con rol SST.
// Cada tenant se consulta con su propio RepositorioTenant; nada cruza datos entre tenants.
const cuentas = require('../db/cuentas');
const { consultarCatalogo } = require('../db/global');
const { RepositorioTenant } = require('../db/repositorio');
const { hoyBogota, sumarDias } = require('../fechas/calendario');
const { ROLES_VER } = require('../comun/rutas');
const reglas = require('./reglas');
const { celda } = require('../integraciones/csv');

// Ventana de aviso de documentos por vencer: configuracion del producto, no plazo legal.
const DIAS_DOCUMENTOS = 30;

async function accesos(usuarioId) {
  return (await cuentas.accesosDeUsuario(usuarioId)).filter((a) => a.roles.some((r) => ROLES_VER.includes(r)));
}

const porEmpresa = (filas) => new Map(filas.map((f) => [f.empresa_id, f]));
// Primera fila por empresa (las consultas vienen ordenadas por prioridad).
const primeraPorEmpresa = (filas) => {
  const m = new Map();
  for (const f of filas) if (!m.has(f.empresa_id)) m.set(f.empresa_id, f);
  return m;
};

async function datosTenant(repo, ids, hoy) {
  const en = `(${ids.map(() => '?').join(', ')})`;
  const [empresas, obligaciones, acciones, eventos, documentos, autoevals, matrices, clasif, planes] = await Promise.all([
    repo.consultar(`SELECT id, razon_social, nit, digito_verificacion, numero_trabajadores FROM empresa WHERE tenant_id = {tenant} AND id IN ${en}`, ids),
    repo.consultar(
      `SELECT empresa_id, SUM(estado = 'vencido') AS vencidas, SUM(estado = 'por_vencer') AS por_vencer FROM obligacion_pendiente
        WHERE tenant_id = {tenant} AND empresa_id IN ${en} AND estado IN ('vencido','por_vencer') GROUP BY empresa_id`, ids,
    ),
    repo.consultar(
      `SELECT empresa_id, COUNT(*) AS abiertas, SUM(fecha_limite < ?) AS vencidas FROM accion_mejora
        WHERE tenant_id = {tenant} AND empresa_id IN ${en} AND estado = 'abierta' GROUP BY empresa_id`, [hoy, ...ids],
    ),
    repo.consultar(
      `SELECT empresa_id, COUNT(*) AS abiertos, SUM(gravedad IN ('grave','mortal')) AS graves FROM evento
        WHERE tenant_id = {tenant} AND empresa_id IN ${en} AND estado IN ('registrado','reportado') GROUP BY empresa_id`, ids,
    ),
    repo.consultar(
      `SELECT empresa_id, SUM(fecha_vence < ?) AS vencidos, SUM(fecha_vence >= ? AND fecha_vence <= ?) AS por_vencer FROM documento_sst
        WHERE tenant_id = {tenant} AND empresa_id IN ${en} AND estado = 'vigente' AND fecha_vence IS NOT NULL GROUP BY empresa_id`,
      [hoy, hoy, sumarDias(hoy, DIAS_DOCUMENTOS), ...ids],
    ),
    repo.consultar(
      `SELECT empresa_id, id, vigencia_anio, puntaje, valoracion, estado FROM autoevaluacion
        WHERE tenant_id = {tenant} AND empresa_id IN ${en} AND estado IN ('cerrada','borrador')
        ORDER BY empresa_id, estado = 'cerrada' DESC, vigencia_anio DESC, id DESC`, ids,
    ),
    repo.consultar(
      `SELECT empresa_id, id, version, estado, publicada_en FROM matriz_riesgo
        WHERE tenant_id = {tenant} AND empresa_id IN ${en} AND estado IN ('vigente','borrador')
        ORDER BY empresa_id, estado = 'vigente' DESC, version DESC`, ids,
    ),
    repo.consultar(
      `SELECT empresa_id, conjunto_codigo, estado FROM empresa_clasificacion
        WHERE tenant_id = {tenant} AND empresa_id IN ${en} ORDER BY empresa_id, id DESC`, ids,
    ),
    repo.consultar(
      `SELECT empresa_id, estado FROM plan_anual WHERE tenant_id = {tenant} AND empresa_id IN ${en} AND vigencia_anio = ?`,
      [...ids, Number(hoy.slice(0, 4))],
    ),
  ]);
  return {
    empresas, obligaciones: porEmpresa(obligaciones), acciones: porEmpresa(acciones), eventos: porEmpresa(eventos),
    documentos: porEmpresa(documentos), autoevals: primeraPorEmpresa(autoevals), matrices: primeraPorEmpresa(matrices),
    clasif: primeraPorEmpresa(clasif), planes: porEmpresa(planes),
  };
}

const n = (v) => Number(v || 0);

async function cartera(usuarioId, actor, hoy = hoyBogota()) {
  const lista = await accesos(usuarioId);
  const conjuntos = new Map((await consultarCatalogo('SELECT codigo, cantidad_estandares FROM estandar_conjunto')).map((c) => [c.codigo, c.cantidad_estandares]));
  const filas = [];
  for (const tenantId of [...new Set(lista.map((a) => a.tenant_id))]) {
    const propias = lista.filter((a) => a.tenant_id === tenantId);
    const d = await datosTenant(new RepositorioTenant(tenantId, actor), propias.map((a) => a.empresa_id), hoy);
    for (const e of d.empresas) {
      const o = d.obligaciones.get(e.id) || {};
      const ac = d.acciones.get(e.id) || {};
      const ev = d.eventos.get(e.id) || {};
      const doc = d.documentos.get(e.id) || {};
      const c = d.clasif.get(e.id);
      const fila = {
        empresa_id: e.id, tenant_id: tenantId, razon_social: e.razon_social, nit: e.nit, dv: e.digito_verificacion, trabajadores: n(e.numero_trabajadores),
        roles: propias.find((a) => a.empresa_id === e.id).roles,
        estandares: c ? conjuntos.get(c.conjunto_codigo) || null : null, reclasificacion: Boolean(c && c.estado === 'pendiente'),
        obligaciones: { vencidas: n(o.vencidas), porVencer: n(o.por_vencer) },
        acciones: { abiertas: n(ac.abiertas), vencidas: n(ac.vencidas) },
        eventos: { abiertos: n(ev.abiertos), graves: n(ev.graves) },
        documentos: { vencidos: n(doc.vencidos), porVencer: n(doc.por_vencer) },
        autoevaluacion: d.autoevals.get(e.id) || null,
        matriz: d.matrices.get(e.id) || null,
        plan: d.planes.get(e.id) || null,
      };
      filas.push({ ...fila, semaforo: reglas.semaforo(fila) });
    }
  }
  const ordenadas = reglas.ordenar(filas);
  return { filas: ordenadas, totales: reglas.totales(ordenadas), diasDocumentos: DIAS_DOCUMENTOS, anio: Number(hoy.slice(0, 4)) };
}

function aCsv(filas) {
  const salida = [['Empresa', 'NIT', 'Trabajadores', 'Estandares', 'Semaforo', 'Autoevaluacion', 'Puntaje', 'Valoracion', 'Obligaciones vencidas',
    'Obligaciones por vencer', 'Acciones vencidas', 'Eventos sin investigar', 'Documentos vencidos', 'Matriz de peligros', 'Plan anual', 'Motivos']];
  for (const f of filas) {
    const a = f.autoevaluacion;
    salida.push([f.razon_social, f.nit, f.trabajadores, f.estandares, f.semaforo.nivel, a ? `${a.vigencia_anio} ${a.estado}` : '', a ? a.puntaje : '',
      a ? a.valoracion : '', f.obligaciones.vencidas, f.obligaciones.porVencer, f.acciones.vencidas, f.eventos.abiertos, f.documentos.vencidos,
      f.matriz ? `v${f.matriz.version} ${f.matriz.estado}` : '', f.plan ? f.plan.estado : '', f.semaforo.motivos.join(' | ')]);
  }
  return `﻿${salida.map((r) => r.map(celda).join(';')).join('\r\n')}\r\n`;
}

module.exports = { cartera, accesos, aCsv, DIAS_DOCUMENTOS };
