// Valoracion de riesgos (NP = ND x NE; NR = NP x NC) con las escalas del catalogo de metodologias.

const parse = (v) => (typeof v === 'string' ? JSON.parse(v) : v);

function errorValidacion(mensaje) {
  const e = new Error(mensaje);
  e.status = 422;
  return e;
}

const buscar = (escala, codigo, nombre) => {
  const x = escala.find((e) => e.codigo === codigo);
  if (!x) throw errorValidacion(`${nombre} invalido`);
  return x;
};
const rango = (escala, valor, nombre) => {
  const x = escala.find((e) => valor >= e.min && valor <= e.max);
  if (!x) throw new Error(`Sin rango de ${nombre} para ${valor} en la metodologia`);
  return x;
};

/** Evalua un peligro. escalas: { nd, ne, nc, np, nr } de la metodologia. */
function evaluar(escalasCrudas, { nd, ne, nc }) {
  const escalas = parse(escalasCrudas);
  const vnd = buscar(escalas.nd, nd, 'Nivel de deficiencia').valor;
  const vne = buscar(escalas.ne, ne, 'Nivel de exposicion').valor;
  const vnc = buscar(escalas.nc, nc, 'Nivel de consecuencia').valor;
  const np = vnd * vne;
  const nr = np * vnc;
  const nivelNp = rango(escalas.np, np, 'probabilidad');
  const nivelNr = rango(escalas.nr, nr, 'riesgo');
  return {
    np, nr, nivel_probabilidad: nivelNp.nombre, nivel_riesgo: nivelNr.codigo,
    aceptabilidad: nivelNr.aceptabilidad, significado: nivelNr.significado, critico: Boolean(nivelNr.critico),
  };
}

/**
 * Jerarquia obligatoria (art. 2.2.4.6.24): un riesgo critico (I o II) no puede quedarse solo con
 * controles administrativos o EPP. Devuelve advertencias por item.
 */
function advertenciasJerarquia(items, controles, criticos) {
  const niveles = new Map([['eliminacion', 1], ['sustitucion', 2], ['ingenieria', 3], ['administrativo', 4], ['epp', 5]]);
  const avisos = [];
  for (const i of items.filter((x) => x.estado !== 'retirado' && criticos.has(x.nivel_riesgo))) {
    const propios = controles.filter((c) => c.item_id === i.id && c.estado !== 'descartado');
    if (!propios.length) avisos.push({ item: i.id, texto: `Riesgo ${i.nivel_riesgo} en "${i.peligro}" sin medidas de intervencion` });
    else if (!propios.some((c) => niveles.get(c.jerarquia_codigo) <= 3)) {
      avisos.push({ item: i.id, texto: `Riesgo ${i.nivel_riesgo} en "${i.peligro}": solo controles administrativos o EPP; evalue eliminacion, sustitucion o ingenieria` });
    }
  }
  return avisos;
}

function impedimentosPublicar(matriz, items, documento) {
  const m = [];
  if (matriz.estado !== 'borrador') m.push('Solo se publica una matriz en borrador');
  if (!items.some((i) => i.estado === 'activo')) m.push('Registre al menos un peligro');
  const sinRevisar = items.filter((i) => i.estado === 'activo' && Number(i.sugerido)).length;
  if (sinRevisar) m.push(`Revise y guarde la valoracion de ${sinRevisar} peligro(s) sugerido(s)`);
  if (!documento) m.push('Asocie la matriz firmada (documento MATRIZ_PELIGROS vigente)');
  if (!String(matriz.participantes || '').trim()) m.push('Registre la participacion de los trabajadores o del COPASST');
  return m;
}

const clave = (...partes) => partes.map((p) => String(p ?? '').trim().toLowerCase()).join('|');

/**
 * Propuestas de peligros a partir del cargo tipo de cada cargo. Una fila por proceso/actividad/peligro:
 * cargos del mismo tipo y proceso comparten fila. Si la matriz ya tiene esa fila, solo se vincula el cargo.
 * cargos: [{ id, cargo_tipo_codigo, proceso, expuestos }]; tipos/peligros: Map por codigo;
 * existentes: items activos [{ id, proceso, actividad, peligro_tipo_codigo, cargos: [ids] }].
 */
function propuestasDesdeCargos(cargos, tipos, peligros, existentes) {
  const previos = new Map(existentes.filter((i) => i.peligro_tipo_codigo).map((i) => [clave(i.proceso, i.actividad, i.peligro_tipo_codigo), i]));
  const nuevos = new Map();
  const vincular = [];
  for (const c of cargos) {
    const tipo = tipos.get(c.cargo_tipo_codigo);
    if (!tipo) continue;
    const actividad = String(tipo.descripcion || tipo.nombre).slice(0, 255);
    for (const x of tipo.peligros) {
      const p = peligros.get(x.peligro);
      if (!p) continue;
      const k = clave(c.proceso, actividad, p.codigo);
      const previo = previos.get(k);
      if (previo) {
        if (!previo.cargos.includes(c.id)) vincular.push({ item_id: previo.id, cargo_id: c.id });
        continue;
      }
      const n = nuevos.get(k);
      if (n) {
        if (!n.cargos.includes(c.id)) { n.cargos.push(c.id); n.expuestos += c.expuestos || 0; }
        continue;
      }
      nuevos.set(k, {
        proceso: c.proceso, actividad, peligro_tipo_codigo: p.codigo, clase_peligro: p.clase_codigo, peligro: p.nombre,
        efectos: p.efectos, peor_consecuencia: p.peor_consecuencia, norma_codigo: p.norma_codigo,
        nd: 'M', ne: x.ne, nc: p.nc_sugerido || 'L', cargos: [c.id], expuestos: c.expuestos || 0,
      });
    }
  }
  return { nuevos: [...nuevos.values()], vincular };
}

module.exports = { evaluar, advertenciasJerarquia, impedimentosPublicar, propuestasDesdeCargos, errorValidacion };
