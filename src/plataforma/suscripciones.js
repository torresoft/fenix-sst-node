// Gestion de suscripciones (superadmin): alta, renovacion, cancelacion, pagos manuales y vencimientos.
// Sin pasarela de pagos: los pagos se registran a mano.
const config = require('../config');
const cuentas = require('../db/cuentas');
const db = require('../db/suscripciones');
const plataforma = require('../db/plataforma');
const correo = require('../correo');
const { hoyBogota, sumarDias, sumarMeses } = require('../fechas/calendario');
const { error } = require('../comun/rutas');
const planes = require('../planes/servicio');
const r = require('./suscripcion-reglas');

const MEDIOS = ['transferencia', 'consignacion', 'pse', 'tarjeta', 'efectivo', 'otro'];
const texto = (v, max) => { const s = String(v ?? '').trim(); return s ? s.slice(0, max) : null; };
const fecha = (v, nombre) => {
  const f = String(v || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(f) || Number.isNaN(Date.parse(`${f}T00:00:00Z`))) throw r.errorValidacion(`${nombre} invalida`);
  return f;
};
// Comparacion de dinero en centavos enteros (BigInt), nunca en coma flotante.
const centavos = (s) => { const [e, d = ''] = String(s).split('.'); return BigInt(e) * 100n + BigInt((d + '00').slice(0, 2)); };

async function cliente(tenantId) {
  const t = await plataforma.obtenerTenant(tenantId);
  if (!t) throw error(404, 'Cliente no encontrado');
  return t;
}

async function detalle(tenantId, hoy = hoyBogota()) {
  const t = await cliente(tenantId);
  const [actual, historial, pagos, catalogo] = await Promise.all([db.actual(tenantId), db.historial(tenantId), db.pagos(tenantId), planes.catalogo()]);
  const renovable = actual && ['vigente', 'vencida'].includes(actual.estado) ? actual : null;
  return {
    t, actual, historial, pagos, planes: catalogo, medios: MEDIOS,
    situacion: r.situacion(actual, hoy, config.suscripciones.ventana),
    // Valores por defecto del formulario de renovacion.
    sugerida: {
      plan_codigo: (renovable && renovable.plan_codigo) || t.plan || '', periodicidad: (renovable && renovable.periodicidad) || 'anual',
      fecha_inicio: r.inicioRenovacion(renovable, hoy), valor: renovable ? renovable.valor : '',
    },
  };
}

/** Alta o renovacion. La actual (vigente o vencida) queda 'renovada'. */
async function guardar(tenantId, d, actor, hoy = hoyBogota()) {
  const t = await cliente(tenantId);
  if (t.estado === 'retirado') throw error(409, 'El cliente esta retirado: reactivelo antes de suscribirlo');
  const plan = await planes.porCodigo(texto(d.plan_codigo, 30));
  if (!plan || plan.estado !== 'activo') throw r.errorValidacion('Plan invalido');
  const inicio = fecha(d.fecha_inicio, 'Fecha de inicio');
  const fila = {
    plan_codigo: plan.codigo, periodicidad: d.periodicidad, fecha_inicio: inicio, fecha_fin: r.calcularFin(inicio, d.periodicidad),
    valor: r.valorDinero(d.valor), es_prueba: d.es_prueba === '1' ? 1 : 0, observacion: texto(d.observacion, 500),
  };
  if (!fila.es_prueba && centavos(fila.valor) === 0n) throw r.errorValidacion('Registre el valor pactado (o marque periodo de prueba)');
  const actual = await db.actual(tenantId);
  const anterior = actual && ['vigente', 'vencida'].includes(actual.estado) ? actual.id : null;
  const id = await db.crear(tenantId, fila, actor, anterior);
  let reactivado = false;
  if (d.reactivar === '1' && t.estado === 'suspendido') {
    await plataforma.cambiarEstadoTenant(tenantId, 'activo', actor, 'Suscripcion renovada');
    reactivado = true;
  }
  return { id, fin: fila.fecha_fin, reactivado };
}

async function suscripcionDe(tenantId, id) {
  const s = await db.obtener(id);
  if (!s || s.tenant_id !== tenantId) throw error(404, 'Suscripcion no encontrada');
  return s;
}

/** No renueva: cubre hasta su fecha fin y queda registrada la razon. */
async function cancelar(tenantId, id, motivo, actor) {
  const s = await suscripcionDe(tenantId, id);
  if (!['vigente', 'vencida'].includes(s.estado)) throw error(409, 'La suscripcion ya esta cerrada');
  const m = texto(motivo, 500);
  if (!m || m.length < 10) throw r.errorValidacion('Explique el motivo de la cancelacion (minimo 10 caracteres)');
  await db.cambiarEstado(id, 'cancelada', m, actor);
}

async function registrarPago(tenantId, d, actor, hoy = hoyBogota()) {
  const s = await suscripcionDe(tenantId, Number.parseInt(d.suscripcion_id, 10));
  const f = fecha(d.fecha, 'Fecha del pago');
  if (f > hoy) throw r.errorValidacion('La fecha del pago no puede ser futura');
  const valor = r.valorDinero(d.valor, { positivo: true });
  if (centavos(valor) > centavos(s.saldo)) throw r.errorValidacion(`El pago supera el saldo pendiente (${s.saldo})`);
  if (!MEDIOS.includes(d.medio)) throw r.errorValidacion('Medio de pago invalido');
  return db.registrarPago(s.id, { fecha: f, valor, medio: d.medio, referencia: texto(d.referencia, 100), observacion: texto(d.observacion, 500) }, actor);
}

async function anularPago(tenantId, id, motivo, actor) {
  const p = await db.obtenerPago(id);
  if (!p || p.tenant_id !== tenantId) throw error(404, 'Pago no encontrado');
  if (p.estado === 'anulado') throw error(409, 'El pago ya esta anulado');
  const m = texto(motivo, 500);
  if (!m || m.length < 10) throw r.errorValidacion('Explique por que se anula (minimo 10 caracteres)');
  await db.anularPago(id, m, actor);
}

/** Tablero de suscripciones de todos los clientes. */
async function tablero(hoy = hoyBogota()) {
  const mes = hoy.slice(0, 8);
  const { filas, cifras } = await db.tablero(`${mes}01`, sumarDias(sumarMeses(`${mes}01`, 1), -1));
  const conSituacion = filas.map((f) => ({ ...f, situacion: r.situacion(f.id ? f : null, hoy, config.suscripciones.ventana) }));
  const cuenta = (n) => conSituacion.filter((f) => f.situacion.nivel === n).length;
  return {
    filas: conSituacion,
    cifras: {
      ...cifras, alDia: cuenta('al_dia'), porVencer: cuenta('por_vencer'), vencidas: cuenta('vencida'), sin: cuenta('sin'),
      conSaldo: conSituacion.filter((f) => f.saldo && centavos(f.saldo) > 0n).length,
    },
  };
}

/** Situacion para el administrador del cliente (aviso en el inicio). */
async function resumenCliente(tenantId, hoy = hoyBogota()) {
  const s = await db.actual(tenantId);
  return s ? { s, situacion: r.situacion(s, hoy, config.suscripciones.ventana) } : null;
}

async function avisarAdmins(tenantId, asunto, html) {
  const admins = await cuentas.usuariosConRol(tenantId, ['admin_tenant']);
  let enviados = 0;
  for (const a of admins) if ((await correo.enviar({ para: a.email, asunto, html })).estado === 'enviado') enviados += 1;
  return enviados;
}

/** Job diario: marca vencidas, avisa antes del fin y suspende tras la gracia (si esta configurada). */
async function procesarVencimientos(hoy = hoyBogota(), { notificar = true } = {}) {
  const actor = { id: null, nombre: 'job-suscripciones' };
  const d = r.decisionesJob(await db.paraJob(), hoy, config.suscripciones);
  for (const s of d.vencer) await db.cambiarEstado(s.id, 'vencida', `Vencio el ${s.fecha_fin}`, actor);
  for (const s of d.suspender) {
    await plataforma.cambiarEstadoTenant(s.tenant_id, 'suspendido', actor, `Suscripcion vencida el ${s.fecha_fin} sin renovar`);
    await db.marcarSuspendida(s.id, hoy);
  }
  let correos = 0;
  if (notificar) {
    for (const { s, dias } of d.avisar) {
      const html = await correo.renderizar('suscripcion', { cliente: s.tenant_nombre, fin: s.fecha_fin, dias });
      correos += await avisarAdmins(s.tenant_id, `Su suscripcion a Fenix SST vence ${dias ? `en ${dias} dia(s)` : 'hoy'}`, html);
    }
  }
  return { vencidas: d.vencer.length, suspendidos: d.suspender.length, avisos: d.avisar.length, correos };
}

module.exports = { MEDIOS, detalle, guardar, cancelar, registrarPago, anularPago, tablero, resumenCliente, procesarVencimientos };
