// Reglas puras de suscripciones: vigencia, situacion y decisiones del job diario. Fechas 'YYYY-MM-DD'.
const { sumarDias, sumarMeses } = require('../fechas/calendario');

const MESES = { mensual: 1, trimestral: 3, semestral: 6, anual: 12 };
const DIA_MS = 86400000;

const diasEntre = (desde, hasta) => Math.round((Date.parse(`${hasta}T00:00:00Z`) - Date.parse(`${desde}T00:00:00Z`)) / DIA_MS);

function errorValidacion(mensaje) {
  const e = new Error(mensaje);
  e.status = 422;
  return e;
}

/** Ultimo dia cubierto: un periodo completo desde el inicio (mensual 2026-01-15 -> 2026-02-14). */
function calcularFin(inicio, periodicidad) {
  if (!MESES[periodicidad]) throw errorValidacion('Periodicidad invalida');
  return sumarDias(sumarMeses(inicio, MESES[periodicidad]), -1);
}

/** La renovacion arranca el dia siguiente al fin de la vigente, o hoy si ya vencio. */
function inicioRenovacion(actual, hoy) {
  return actual && actual.fecha_fin >= hoy ? sumarDias(actual.fecha_fin, 1) : hoy;
}

/** Dinero como texto DECIMAL(14,2); nunca Number. */
function valorDinero(v, { positivo = false } = {}) {
  const s = String(v ?? '').trim().replace(/\s/g, '').replace(/\.(?=\d{3}(\D|$))/g, '').replace(',', '.');
  if (!/^\d{1,12}(\.\d{1,2})?$/.test(s)) throw errorValidacion('Valor invalido (use numeros, maximo 2 decimales)');
  if (positivo && /^0+(\.0+)?$/.test(s)) throw errorValidacion('El valor debe ser mayor que cero');
  return s;
}

/** Situacion de la suscripcion actual de un cliente para tableros y avisos. */
function situacion(s, hoy, ventana = 30) {
  if (!s) return { nivel: 'sin', dias: null, texto: 'Sin suscripción' };
  const dias = diasEntre(hoy, s.fecha_fin);
  if (s.estado === 'cancelada') return { nivel: 'cancelada', dias, texto: `Cancelada; cubre hasta ${s.fecha_fin}` };
  if (dias < 0 || s.estado === 'vencida') return { nivel: 'vencida', dias, texto: `Vencida hace ${-dias} día(s)` };
  if (dias <= ventana) return { nivel: 'por_vencer', dias, texto: dias ? `Vence en ${dias} día(s)` : 'Vence hoy' };
  return { nivel: 'al_dia', dias, texto: `Hasta ${s.fecha_fin}` };
}

/**
 * Que hacer hoy con las suscripciones actuales (una por cliente: vigente o vencida sin renovar).
 * diasGracia null = nunca suspender automaticamente. avisos: dias antes del fin en que se avisa.
 */
function decisionesJob(actuales, hoy, { diasGracia = null, avisos = [] } = {}) {
  const vencer = [];
  const suspender = [];
  const avisar = [];
  for (const s of actuales) {
    const dias = diasEntre(hoy, s.fecha_fin);
    if (s.estado === 'vigente' && dias < 0) vencer.push(s);
    if (s.estado === 'vigente' && avisos.includes(dias)) avisar.push({ s, dias });
    // Solo por falta de renovacion (una cancelada la maneja el superadmin) y una sola vez.
    if (diasGracia !== null && dias < -diasGracia && ['vigente', 'vencida'].includes(s.estado) && !s.suspendido_en && s.tenant_estado === 'activo') suspender.push(s);
  }
  return { vencer, suspender, avisar };
}

module.exports = { MESES, diasEntre, calcularFin, inicioRenovacion, valorDinero, situacion, decisionesJob, errorValidacion };
