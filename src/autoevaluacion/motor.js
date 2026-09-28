// Motor puro de la Res. 0312 de 2019: aplicabilidad, evidencia, puntaje PHVA, valoracion y brechas.
// Pesos y umbrales llegan del catalogo. Aritmetica en centesimas enteras (sin flotantes).

const aCent = (v) => Math.round(Number(v) * 100);
const deCent = (c) => (c / 100).toFixed(2);

/**
 * Conjunto aplicable segun trabajadores, nivel de riesgo (1..5) y si es unidad agropecuaria.
 * Se evalua por prioridad; es_residual cubre lo que ningun rango atrapa.
 */
function resolverConjunto(conjuntos, { trabajadores, nivelRiesgo, agropecuaria }) {
  if (!Number.isInteger(trabajadores) || trabajadores < 1) throw new Error('Declare el numero de trabajadores de la empresa');
  if (!Number.isInteger(nivelRiesgo) || nivelRiesgo < 1) throw new Error('Registre al menos un centro de trabajo con su clase de riesgo');
  const enRango = (v, min, max) => (min == null || v >= Number(min)) && (max == null || v <= Number(max));
  const ordenados = [...conjuntos].sort((a, b) => Number(a.prioridad) - Number(b.prioridad));
  const hit = ordenados.find((c) => !Number(c.es_residual)
    && (!Number(c.solo_agropecuario) || agropecuaria)
    && enRango(trabajadores, c.trabajadores_min, c.trabajadores_max)
    && enRango(nivelRiesgo, c.riesgo_nivel_min, c.riesgo_nivel_max));
  const conjunto = hit || ordenados.find((c) => Number(c.es_residual));
  if (!conjunto) throw new Error('El catalogo no tiene conjunto residual de estandares');
  return conjunto;
}

/**
 * Numerales de la tabla de valores que evalua el conjunto -> requisitos (orden) que los cubren.
 * evalua_tabla_completa: los 60. Conjunto sin numerales (agropecuario): mapa vacio.
 */
function numeralesDelConjunto(conjunto, tabla, requisitoNumerales) {
  const mapa = new Map();
  if (Number(conjunto.evalua_tabla_completa)) {
    for (const t of tabla) mapa.set(t.numeral, []);
    return mapa;
  }
  for (const rn of requisitoNumerales.filter((x) => x.conjunto_codigo === conjunto.codigo)) {
    if (!mapa.has(rn.numeral)) mapa.set(rn.numeral, []);
    mapa.get(rn.numeral).push(Number(rn.orden));
  }
  return mapa;
}

const MOTIVOS_FALLA = ['sin_firma', 'vencido', 'posterior_al_corte', 'no_vigente'];

/**
 * existeEvidenciaVigente: un numeral se cumple solo con un documento vigente, emitido antes del
 * corte, no vencido al corte y firmado si su tipo documental lo exige.
 * docs: [{ id, estado, fecha_documento, fecha_vence, requiere_firma, firmado }]
 */
function evaluarEvidencia(docs, fechaCorte) {
  if (!docs.length) return { cumple: false, motivo: 'sin_evidencia', validos: [] };
  const fallas = new Set();
  const validos = [];
  for (const d of docs) {
    if (d.estado !== 'vigente') { fallas.add('no_vigente'); continue; }
    if (d.fecha_documento > fechaCorte) { fallas.add('posterior_al_corte'); continue; }
    if (d.fecha_vence && d.fecha_vence < fechaCorte) { fallas.add('vencido'); continue; }
    if (Number(d.requiere_firma) && !d.firmado) { fallas.add('sin_firma'); continue; }
    validos.push(d.id);
  }
  if (validos.length) return { cumple: true, motivo: 'cumple', validos };
  return { cumple: false, motivo: MOTIVOS_FALLA.find((m) => fallas.has(m)), validos };
}

function valoracionDe(totalCent, valoraciones) {
  const v = valoraciones.find((x) => totalCent >= aCent(x.minimo) && totalCent <= aCent(x.maximo));
  if (!v) throw new Error(`Sin valoracion en el catalogo para ${deCent(totalCent)}`);
  return v.codigo;
}

/**
 * Calcula la autoevaluacion.
 * @param {object} p
 *   tabla: filas de estandar_minimo (60)
 *   aplican: Map numeral -> requisitos del conjunto
 *   evidencia: Map numeral -> resultado de evaluarEvidencia
 *   noAplica: Map numeral -> justificacion (no aplica justificado)
 *   ponderacion, valoraciones: catalogo
 */
function calcular({ tabla, aplican, evidencia, noAplica, ponderacion, valoraciones }) {
  const items = tabla.map((t) => {
    const pesoCent = aCent(t.peso);
    const base = { numeral: t.numeral, nombre: t.nombre, ciclo: t.ciclo, componente: t.componente, estandar: t.estandar, peso: t.peso, requisitos: aplican.get(t.numeral) || [] };
    if (!aplican.has(t.numeral)) return { ...base, aplica_conjunto: false, resultado: 'no_aplica', motivo: 'fuera_del_conjunto', puntajeCent: pesoCent, evidencias: [] };
    if (noAplica.has(t.numeral)) return { ...base, aplica_conjunto: true, resultado: 'no_aplica', motivo: 'justificado', justificacion: noAplica.get(t.numeral), puntajeCent: pesoCent, evidencias: [] };
    const ev = evidencia.get(t.numeral) || { cumple: false, motivo: 'sin_evidencia', validos: [] };
    return {
      ...base, aplica_conjunto: true, resultado: ev.cumple ? 'cumple' : 'no_cumple', motivo: ev.motivo,
      puntajeCent: ev.cumple ? pesoCent : 0, evidencias: ev.validos,
    };
  });

  const totalCent = items.reduce((s, i) => s + i.puntajeCent, 0);
  const pesoTotal = tabla.reduce((s, t) => s + aCent(t.peso), 0);
  if (pesoTotal !== 10000) throw new Error(`La tabla de valores suma ${deCent(pesoTotal)}, no 100`);

  const desglose = ponderacion.filter((p) => p.componente === '').map((c) => ({
    ciclo: c.ciclo,
    peso: c.peso,
    obtenido: deCent(items.filter((i) => i.ciclo === c.ciclo).reduce((s, i) => s + i.puntajeCent, 0)),
    componentes: ponderacion.filter((p) => p.ciclo === c.ciclo && p.componente !== '').map((p) => ({
      componente: p.componente,
      peso: p.peso,
      obtenido: deCent(items.filter((i) => i.ciclo === c.ciclo && i.componente === p.componente).reduce((s, i) => s + i.puntajeCent, 0)),
    })),
  }));

  return {
    items: items.map((i) => ({ ...i, puntaje: deCent(i.puntajeCent) })),
    totalCent,
    puntaje: deCent(totalCent),
    valoracion: valoracionDe(totalCent, valoraciones),
    desglose,
    conteo: {
      evaluados: items.filter((i) => i.aplica_conjunto).length,
      cumple: items.filter((i) => i.resultado === 'cumple').length,
      no_cumple: items.filter((i) => i.resultado === 'no_cumple').length,
      no_aplica: items.filter((i) => i.resultado === 'no_aplica' && i.aplica_conjunto).length,
    },
  };
}

/** Brechas ordenadas por puntos que aportan, con el puntaje y valoracion proyectados al cerrarlas en orden. */
function brechas(resultado, tabla, valoraciones) {
  const porNumeral = new Map(tabla.map((t) => [t.numeral, t]));
  let acumulado = resultado.totalCent;
  return resultado.items
    .filter((i) => i.resultado === 'no_cumple')
    .sort((a, b) => aCent(b.peso) - aCent(a.peso) || a.numeral.localeCompare(b.numeral, 'es', { numeric: true }))
    .map((i) => {
      acumulado += aCent(i.peso);
      return {
        numeral: i.numeral, nombre: i.nombre, ciclo: i.ciclo, peso: i.peso, motivo: i.motivo,
        modo_verificacion: porNumeral.get(i.numeral).modo_verificacion,
        puntaje_proyectado: deCent(acumulado),
        valoracion_proyectada: valoracionDe(acumulado, valoraciones),
      };
    });
}

module.exports = { aCent, deCent, resolverConjunto, numeralesDelConjunto, evaluarEvidencia, valoracionDe, calcular, brechas };
