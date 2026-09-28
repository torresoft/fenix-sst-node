// Calculo puro de indicadores. Valores redondeados a 4 decimales (se guardan en DECIMAL).

const r4 = (x) => Math.round(x * 10000) / 10000;

function valor(numerador, denominador, factor = 100) {
  if (!denominador) return null;
  return r4((Number(numerador) / Number(denominador)) * Number(factor));
}

const finDeMes = (anio, mes) => new Date(Date.UTC(anio, mes, 0)).toISOString().slice(0, 10);
const inicioDeMes = (anio, mes) => `${anio}-${String(mes).padStart(2, '0')}-01`;

/** Trabajadores con vinculacion activa al cierre de una fecha (ingreso <= fecha y sin retiro o retiro posterior). */
function trabajadoresAl(vinculaciones, fecha) {
  return vinculaciones.filter((v) => v.estado !== 'anulada' && v.fecha_ingreso <= fecha && (!v.fecha_retiro || v.fecha_retiro > fecha)).length;
}

/** Promedio de trabajadores al cierre de cada mes del anio hasta el mes indicado. */
function promedioAnual(vinculaciones, anio, hastaMes) {
  const meses = Array.from({ length: hastaMes }, (_, i) => trabajadoresAl(vinculaciones, finDeMes(anio, i + 1)));
  return meses.length ? r4(meses.reduce((s, n) => s + n, 0) / meses.length) : 0;
}

/** Dias de incapacidad que caen dentro del mes (una incapacidad puede cruzar meses). */
function diasIncapacidadEnMes(incapacidades, anio, mes) {
  const ini = Date.parse(`${inicioDeMes(anio, mes)}T00:00:00Z`);
  const fin = Date.parse(`${finDeMes(anio, mes)}T00:00:00Z`);
  let total = 0;
  for (const i of incapacidades.filter((x) => x.estado !== 'anulada')) {
    const a = Date.parse(`${i.fecha_inicio}T00:00:00Z`);
    const b = a + (Number(i.dias) - 1) * 86400000;
    const desde = Math.max(a, ini);
    const hasta = Math.min(b, fin);
    if (hasta >= desde) total += Math.round((hasta - desde) / 86400000) + 1;
  }
  return total;
}

/**
 * Indicadores de resultado del art. 30 de la Res. 0312 para un mes (y los anuales del anio a la fecha).
 * diasProgramados: dias de trabajo programados en el mes (por trabajador).
 */
function resultado({ eventos, vinculaciones, incapacidades, anio, mes, diasProgramados }) {
  const desde = inicioDeMes(anio, mes);
  const hasta = finDeMes(anio, mes);
  const vivos = eventos.filter((e) => e.estado !== 'anulado');
  const atMes = vivos.filter((e) => e.tipo === 'accidente' && e.fecha_base >= desde && e.fecha_base <= hasta);
  const trab = trabajadoresAl(vinculaciones, hasta) ;
  const finAnio = `${anio}-12-31`;
  const atAnio = vivos.filter((e) => e.tipo === 'accidente' && e.fecha_base.startsWith(String(anio)) && e.fecha_base <= hasta);
  const elNuevos = vivos.filter((e) => e.tipo === 'enfermedad' && e.fecha_base.startsWith(String(anio)) && e.fecha_base <= hasta);
  const elTodos = vivos.filter((e) => e.tipo === 'enfermedad' && e.fecha_base <= (hasta < finAnio ? hasta : finAnio));
  const prom = promedioAnual(vinculaciones, anio, mes);
  const diasSev = atMes.reduce((s, e) => s + Number(e.dias_incapacidad || 0) + Number(e.dias_cargados || 0), 0);
  const diasAus = diasIncapacidadEnMes(incapacidades, anio, mes);
  const periodoMes = `${anio}-${String(mes).padStart(2, '0')}`;
  const metodoTrab = 'trabajadores = vinculaciones activas al cierre del mes';
  return [
    { codigo: 'FREC_AT', periodo: periodoMes, numerador: atMes.length, denominador: trab, valor: valor(atMes.length, trab, 100), metodo: metodoTrab },
    { codigo: 'SEV_AT', periodo: periodoMes, numerador: diasSev, denominador: trab, valor: valor(diasSev, trab, 100), metodo: `${metodoTrab}; dias de incapacidad y cargados del AT asignados al mes del evento` },
    { codigo: 'AUS_MEDICO', periodo: periodoMes, numerador: diasAus, denominador: diasProgramados * trab, valor: valor(diasAus, diasProgramados * trab, 100), metodo: `dias programados = ${diasProgramados} habiles del mes x ${trab} trabajadores; incapacidades de origen comun y laboral` },
    { codigo: 'PROP_AT_MORTAL', periodo: String(anio), numerador: atAnio.filter((e) => e.gravedad === 'mortal').length, denominador: atAnio.length, valor: valor(atAnio.filter((e) => e.gravedad === 'mortal').length, atAnio.length, 100), metodo: `anio a la fecha (${hasta})` },
    { codigo: 'PREV_EL', periodo: String(anio), numerador: elTodos.length, denominador: prom, valor: valor(elTodos.length, prom, 100000), metodo: `casos calificados hasta ${hasta}; promedio de trabajadores al cierre de ${mes} mes(es)` },
    { codigo: 'INC_EL', periodo: String(anio), numerador: elNuevos.length, denominador: prom, valor: valor(elNuevos.length, prom, 100000), metodo: `casos nuevos del anio hasta ${hasta}; promedio de trabajadores al cierre de ${mes} mes(es)` },
  ];
}

/** Cumplimiento frente a la meta de la ficha: true | false | null (sin meta o sin valor). */
function cumpleMeta(valorActual, meta, sentido = 'mayor') {
  if (valorActual == null || meta == null) return null;
  return sentido === 'menor' ? Number(valorActual) <= Number(meta) : Number(valorActual) >= Number(meta);
}

module.exports = { r4, valor, finDeMes, inicioDeMes, trabajadoresAl, promedioAnual, diasIncapacidadEnMes, resultado, cumpleMeta };
