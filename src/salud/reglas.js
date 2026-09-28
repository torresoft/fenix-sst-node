// Reglas puras de salud ocupacional. El empleador solo maneja concepto de aptitud, restricciones y agregados.

const CONCEPTOS = ['apto', 'apto_con_restricciones', 'no_apto', 'aplazado'];
const TIPOS = ['ingreso', 'periodico', 'egreso', 'post_incapacidad', 'reintegro', 'cambio_ocupacion'];

function errorValidacion(mensaje) {
  const e = new Error(mensaje);
  e.status = 422;
  return e;
}

// Codigo CIE-10 (letra + 2 digitos, opcional .digito). Senal de un diagnostico colado en texto libre.
const RE_CIE10 = /\b[A-TV-Z][0-9]{2}(\.[0-9X]{1,2})?\b/;
const PALABRAS_CLINICAS = /\b(diagn[oó]stic|dx\b|cie-?10|audiometr|espirometr|paracl[ií]nic|radiograf|glicemi|hemograma)/i;

/** Rechaza textos que parecen contener informacion clinica (Res. 1843 de 2025). */
function sinDatosClinicos(texto, campo) {
  const t = String(texto || '');
  if (RE_CIE10.test(t)) throw errorValidacion(`${campo}: no registre codigos de diagnostico (CIE-10). El empleador no puede custodiar la historia clinica.`);
  if (PALABRAS_CLINICAS.test(t)) throw errorValidacion(`${campo}: registre solo la restriccion o recomendacion laboral, sin diagnosticos ni resultados de pruebas.`);
  return t.trim() || null;
}

function validarConcepto(d, hoy) {
  if (!CONCEPTOS.includes(d.concepto)) throw errorValidacion('Concepto de aptitud invalido');
  const f = String(d.fecha_examen || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(f) || f > hoy) throw errorValidacion('Fecha del examen invalida');
  const restricciones = sinDatosClinicos(d.restricciones, 'Restricciones');
  const recomendaciones = sinDatosClinicos(d.recomendaciones, 'Recomendaciones');
  if (d.concepto === 'apto_con_restricciones' && !restricciones) throw errorValidacion('Registre las restricciones laborales');
  let proximo = d.proximo_examen ? String(d.proximo_examen) : null;
  if (proximo && (!/^\d{4}-\d{2}-\d{2}$/.test(proximo) || proximo <= f)) throw errorValidacion('El proximo examen debe ser posterior al examen');
  if (['egreso', 'no_apto'].includes(d.tipo)) proximo = null;
  return { concepto: d.concepto, fecha_examen: f, restricciones, recomendaciones, proximo_examen: proximo };
}

function edad(nacimiento, hoy) {
  if (!nacimiento) return null;
  const [a, m, d] = nacimiento.split('-').map(Number);
  const [ha, hm, hd] = hoy.split('-').map(Number);
  return ha - a - (hm < m || (hm === m && hd < d) ? 1 : 0);
}

/** Perfil sociodemografico agregado (sin datos individuales). */
function perfilSociodemografico(personas, hoy) {
  const rangos = [['< 25', 0, 24], ['25 - 34', 25, 34], ['35 - 44', 35, 44], ['45 - 54', 45, 54], ['55 +', 55, 200]];
  const porSexo = { F: 0, M: 0, NB: 0, sin_dato: 0 };
  const porEdad = Object.fromEntries([...rangos.map((r) => [r[0], 0]), ['sin_dato', 0]]);
  const porCargo = {};
  for (const p of personas) {
    porSexo[p.sexo || 'sin_dato'] += 1;
    const e = edad(p.fecha_nacimiento, hoy);
    const r = e == null ? null : rangos.find((x) => e >= x[1] && e <= x[2]);
    porEdad[r ? r[0] : 'sin_dato'] += 1;
    porCargo[p.cargo || 'Sin cargo'] = (porCargo[p.cargo || 'Sin cargo'] || 0) + 1;
  }
  return { total: personas.length, porSexo, porEdad, porCargo };
}

module.exports = { CONCEPTOS, TIPOS, errorValidacion, sinDatosClinicos, validarConcepto, edad, perfilSociodemografico };
