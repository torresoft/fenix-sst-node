// Reglas puras del plan de trabajo anual: avance del cronograma y presupuesto (en centavos enteros).

const cent = (v) => Math.round(Number(v || 0) * 100);
const pesos = (c) => (c / 100).toFixed(2);
const pct = (a, b) => (b ? Math.round((a / b) * 10000) / 100 : null);

/**
 * Avance: al corte (actividades con fecha_fin <= hoy) y total del plan. Las canceladas no cuentan.
 * vencidas: programadas con fecha_fin anterior a hoy.
 */
function avance(actividades, hoy) {
  const vivas = actividades.filter((a) => a.estado !== 'cancelada');
  const alCorte = vivas.filter((a) => a.fecha_fin <= hoy);
  const ejecutadas = vivas.filter((a) => a.estado === 'ejecutada');
  return {
    total: vivas.length,
    ejecutadas: ejecutadas.length,
    vencidas: vivas.filter((a) => a.estado === 'programada' && a.fecha_fin < hoy).length,
    programadas_al_corte: alCorte.length,
    ejecutadas_al_corte: alCorte.filter((a) => a.estado === 'ejecutada').length,
    cumplimiento_corte: pct(alCorte.filter((a) => a.estado === 'ejecutada').length, alCorte.length),
    avance_total: pct(ejecutadas.length, vivas.length),
    presupuesto_programado: pesos(vivas.reduce((s, a) => s + cent(a.presupuesto), 0)),
    presupuesto_ejecutado: pesos(ejecutadas.reduce((s, a) => s + cent(a.presupuesto), 0)),
  };
}

function impedimentosAprobar(plan, objetivos, actividades, documento, presupuestoActividades) {
  const m = [];
  if (plan.estado !== 'borrador') m.push('El plan ya fue aprobado');
  if (!objetivos.some((o) => o.estado === 'activo')) m.push('Defina al menos un objetivo con su meta');
  if (!actividades.some((a) => a.estado !== 'cancelada')) m.push('Programe al menos una actividad');
  if (actividades.some((a) => a.estado !== 'cancelada' && !a.responsable_id && !a.responsable_texto)) m.push('Todas las actividades necesitan responsable');
  if (cent(presupuestoActividades) > cent(plan.presupuesto_total)) m.push('El presupuesto de las actividades supera el presupuesto asignado');
  if (!documento) m.push('Asocie el plan firmado por el representante legal (documento PLAN_ANUAL vigente)');
  return m;
}

module.exports = { cent, pesos, avance, impedimentosAprobar };
