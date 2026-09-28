// Reglas puras de formacion: estado de cada competencia requerida por persona y sugerencias por peligro.

const DIAS_ALERTA = 30;

const diasEntre = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);

/** 'vigente' | 'por_vencer' | 'vencida' | 'falta' para una competencia requerida. */
function estadoCompetencia(competencia, hoy) {
  if (!competencia) return 'falta';
  if (!competencia.fecha_vence) return 'vigente';
  if (competencia.fecha_vence < hoy) return 'vencida';
  return diasEntre(hoy, competencia.fecha_vence) <= DIAS_ALERTA ? 'por_vencer' : 'vigente';
}

/**
 * Matriz personas x competencias requeridas.
 * personas: [{ id, cargo_id }]; tipos: catalogo; porCargo: Map cargo_id -> [codigos]; vigentes: competencias vigentes.
 */
function matriz(personas, tipos, porCargo, vigentes, hoy) {
  const todos = tipos.filter((t) => Number(t.requerida_todos)).map((t) => t.codigo);
  const columnas = new Set(todos);
  for (const lista of porCargo.values()) lista.forEach((c) => columnas.add(c));
  const orden = tipos.map((t) => t.codigo).filter((c) => columnas.has(c));
  const filas = personas.map((p) => {
    const requeridas = new Set([...todos, ...(porCargo.get(p.cargo_id) || [])]);
    const celdas = {};
    for (const c of orden) {
      if (!requeridas.has(c)) { celdas[c] = null; continue; }
      const comp = vigentes.find((x) => x.persona_id === p.id && x.tipo === c) || null;
      celdas[c] = { estado: estadoCompetencia(comp, hoy), competencia: comp };
    }
    return { persona: p, celdas };
  });
  const resumen = { vigente: 0, por_vencer: 0, vencida: 0, falta: 0 };
  filas.forEach((f) => Object.values(f.celdas).forEach((c) => { if (c) resumen[c.estado] += 1; }));
  return { columnas: orden, filas, resumen };
}

// Sugerencias (no obligatorias) de competencia segun los peligros del cargo en la matriz vigente.
const PISTAS = [
  { re: /altura/i, competencia: 'ALTURAS' },
  { re: /confinad/i, competencia: 'CONFINADOS' },
  { re: /el[eé]ctric/i, competencia: 'ELECTRICO' },
];

function sugerencias(peligros) {
  const porCargo = new Map();
  for (const p of peligros) {
    const s = porCargo.get(p.cargo_id) || new Set();
    for (const x of PISTAS) if (x.re.test(p.peligro)) s.add(x.competencia);
    if (p.clase_peligro === 'QUIMICO') s.add('SGA');
    porCargo.set(p.cargo_id, s);
  }
  return new Map([...porCargo].map(([k, v]) => [k, [...v]]));
}

module.exports = { DIAS_ALERTA, estadoCompetencia, matriz, sugerencias };
