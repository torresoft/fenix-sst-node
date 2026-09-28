// Reglas puras de comites (COPASST, Vigia, Convivencia). Conformacion y quorum llegan del catalogo.

const parse = (v) => (typeof v === 'string' ? JSON.parse(v) : v);

function errorValidacion(mensaje) {
  const e = new Error(mensaje);
  e.status = 422;
  return e;
}

const enRango = (n, min, max) => (min == null || n >= Number(min)) && (max == null || n <= Number(max));

/** Tipos de comite que aplican a la empresa segun su numero de trabajadores. */
function tiposAplicables(tipos, trabajadores) {
  return tipos.filter((t) => enRango(Number(trabajadores), t.trabajadores_min, t.trabajadores_max));
}

/** Regla de conformacion para el tamano de la empresa: { por_parte } | { total } | null (no cargada). */
function conformacionRequerida(tipo, trabajadores) {
  const reglas = parse(tipo.conformacion);
  if (!Array.isArray(reglas)) return null;
  return reglas.find((x) => enRango(Number(trabajadores), x.min, x.max)) || null;
}

/**
 * Faltantes de conformacion frente al catalogo. { faltas, aviso }: aviso cuando la regla no esta cargada.
 * miembros: activos, con representacion, calidad y cargo_comite.
 */
function validarConformacion(tipo, trabajadores, miembros) {
  const activos = miembros.filter((m) => m.estado === 'activo');
  const regla = conformacionRequerida(tipo, trabajadores);
  if (!regla) return { faltas: [], aviso: `Regla de conformacion del ${tipo.nombre} no cargada en el catalogo: verifique contra ${tipo.norma_codigo}` };
  const faltas = [];
  const cuenta = (rep, cal) => activos.filter((m) => (!rep || m.representacion === rep) && m.calidad === cal).length;
  if (regla.total != null) {
    if (cuenta(null, 'principal') < regla.total) faltas.push(`Designe ${regla.total} principal(es)`);
  } else {
    for (const rep of ['empleador', 'trabajadores']) {
      const p = cuenta(rep, 'principal');
      const s = cuenta(rep, 'suplente');
      if (p < regla.por_parte) faltas.push(`Faltan ${regla.por_parte - p} principal(es) por ${rep === 'empleador' ? 'el empleador' : 'los trabajadores'}`);
      if (s < regla.por_parte) faltas.push(`Faltan ${regla.por_parte - s} suplente(s) por ${rep === 'empleador' ? 'el empleador' : 'los trabajadores'}`);
    }
    if (!activos.some((m) => m.cargo_comite === 'presidente')) faltas.push('Designe el presidente');
    if (!activos.some((m) => m.cargo_comite === 'secretario')) faltas.push('Elija el secretario');
  }
  return { faltas, aviso: null };
}

/** Quorum: true/false segun la regla del catalogo; null si la regla no esta cargada. */
function hayQuorum(regla, principales, asistentes) {
  if (regla === 'mitad_mas_uno') return principales > 0 && asistentes >= Math.floor(principales / 2) + 1;
  return null;
}

function sumarMeses(fecha, meses) {
  const [a, m, d] = String(fecha).split('-').map(Number);
  const destino = new Date(Date.UTC(a, m - 1 + meses, 1));
  const ultimo = new Date(Date.UTC(destino.getUTCFullYear(), destino.getUTCMonth() + 1, 0)).getUTCDate();
  destino.setUTCDate(Math.min(d, ultimo));
  return destino.toISOString().slice(0, 10);
}

/** Fin del periodo: inicio + N anios - 1 dia. */
function periodoFin(inicio, anios = 2) {
  const f = new Date(`${sumarMeses(inicio, anios * 12)}T00:00:00Z`);
  f.setUTCDate(f.getUTCDate() - 1);
  return f.toISOString().slice(0, 10);
}

/**
 * Meses (YYYY-MM) sin ninguna sesion no anulada, desde el inicio del periodo (maximo 12 atras)
 * hasta el mes anterior a hoy. El mes en curso aun esta a tiempo.
 */
function mesesSinReunion(sesiones, periodoInicio, hoy) {
  const conSesion = new Set(sesiones.filter((s) => s.estado !== 'anulada').map((s) => String(s.fecha).slice(0, 7)));
  const faltan = [];
  let mes = sumarMeses(`${hoy.slice(0, 7)}-01`, -1).slice(0, 7);
  const limite = periodoInicio.slice(0, 7);
  for (let i = 0; i < 12 && mes >= limite; i += 1) {
    if (!conSesion.has(mes)) faltan.push(mes);
    mes = sumarMeses(`${mes}-01`, -1).slice(0, 7);
  }
  return faltan.reverse();
}

module.exports = { errorValidacion, tiposAplicables, conformacionRequerida, validarConformacion, hayQuorum, periodoFin, mesesSinReunion };
