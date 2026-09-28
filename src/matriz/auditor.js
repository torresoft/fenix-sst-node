// Logica pura de la matriz legal y del auditor (sin BD). Las normas, ambitos y desinformacion
// llegan del catalogo.

const VIGENTES = new Set(['vigente', 'vigente_parcial']);
const DEROGADAS = new Set(['derogada', 'sustituida']);
const PREFIJO = { ley: 'LEY', decreto: 'DEC', decreto_ley: 'DL', resolucion: 'RES', circular: 'CIR' };
const TIPO_POR_PREFIJO = { LEY: 'ley', DEC: 'decreto', DL: 'decreto_ley', RES: 'resolucion', CIR: 'circular' };

const sinTildes = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '');

// decreto y decreto_ley se confunden en las matrices reales: comparten llave.
const llave = (tipo, numero, anio) => `${tipo === 'decreto_ley' ? 'decreto' : tipo}|${Number.parseInt(numero, 10)}|${anio}`;

function tipoDeTexto(t) {
  const x = t.toLowerCase().replace(/\s+/g, ' ');
  if (/^(decreto[ -]*ley|d\. ?l\.?|dl)$/.test(x)) return 'decreto_ley';
  if (/^ley$/.test(x)) return 'ley';
  if (/^(decreto|dec\.?|d\.)$/.test(x)) return 'decreto';
  if (/^(resolucion|res\.?|r\.)$/.test(x)) return 'resolucion';
  if (/^(circular( externa)?|cir\.?|c\. ?e\.?)$/.test(x)) return 'circular';
  return null;
}

const RE_CODIGO = /\b(LEY|DEC|DL|RES|CIR)-0*(\d{1,6})-((?:19|20)\d{2})\b/gi;
const RE_TEXTO = new RegExp(
  '(decreto[ -]*ley|d\\. ?l\\.|resolucion|res\\.?|decreto|dec\\.?|ley|circular(?: externa)?|cir\\.?|c\\. ?e\\.)'
  + '\\s*(?:n(?:o|ro|um|umero)?\\s*[.:°º]?\\s*)?'
  + '((?:\\d{1,6}\\s*(?:,|\\by\\b|\\be\\b)\\s*)*\\d{1,6})'
  + '\\s*(?:de|del|\\/|-)\\s*((?:19|20)\\d{2})',
  'gi',
);

/** Extrae referencias normativas de un texto libre. 'Res. 652 y 1356 de 2012' -> 2 referencias. */
function parsearReferencias(texto) {
  const refs = [];
  const limpio = sinTildes(texto);
  let m;
  RE_CODIGO.lastIndex = 0;
  while ((m = RE_CODIGO.exec(limpio)) !== null) {
    refs.push({ tipo: TIPO_POR_PREFIJO[m[1].toUpperCase()], numero: String(Number(m[2])), anio: Number(m[3]), texto: m[0] });
  }
  if (refs.length) return refs;
  RE_TEXTO.lastIndex = 0;
  while ((m = RE_TEXTO.exec(limpio)) !== null) {
    const tipo = tipoDeTexto(m[1]);
    if (!tipo) continue;
    for (const numero of m[2].split(/\s*(?:,|\by\b|\be\b)\s*/i).filter(Boolean)) {
      refs.push({ tipo, numero: String(Number(numero)), anio: Number(m[3]), texto: m[0].trim() });
    }
  }
  return refs;
}

/** Lineas de CSV o captura manual -> [{ linea, texto, refs }]. Toma todas las columnas de cada fila. */
function lineasDeEntrada(texto) {
  return String(texto || '')
    .replace(/^﻿/, '')
    .split(/\r?\n/)
    .map((l, i) => ({ linea: i + 1, texto: l.replace(/[;\t]/g, ' ').replace(/"/g, '').trim() }))
    .filter((l) => l.texto.length > 0)
    .map((l) => ({ ...l, refs: parsearReferencias(l.texto) }));
}

function indexar(normas) {
  const porLlave = new Map();
  const porCodigo = new Map();
  for (const n of normas) {
    porCodigo.set(n.codigo, n);
    porLlave.set(llave(n.tipo, n.numero, n.anio), n);
  }
  return { porLlave, porCodigo };
}

/** Sigue derogada_por hasta una norma vigente. Devuelve la cadena de codigos. */
function cadenaReemplazo(codigo, porCodigo) {
  const cadena = [];
  const vistos = new Set([codigo]);
  let actual = porCodigo.get(codigo);
  while (actual && DEROGADAS.has(actual.estado_vigencia) && actual.derogada_por) {
    const siguiente = String(actual.derogada_por).split(',')[0].trim();
    if (vistos.has(siguiente)) break;
    vistos.add(siguiente);
    cadena.push(siguiente);
    actual = porCodigo.get(siguiente);
  }
  return cadena;
}

function cumpleCondicion(valor, { operador, valor: umbral }) {
  const v = Number(valor || 0);
  switch (operador) {
    case '>': return v > umbral;
    case '>=': return v >= umbral;
    case '<': return v < umbral;
    case '<=': return v <= umbral;
    case '=': return v === umbral;
    default: throw new Error(`Operador de regla desconocido: ${operador}`);
  }
}

/**
 * Ambitos activos de una empresa: los generales, los declarados y los que activa una regla.
 * Devuelve Map codigo -> 'general' | 'declarado' | 'automatico'.
 */
function ambitosActivos(ambitos, empresa, declarados) {
  const activos = new Map();
  const decl = new Set(declarados);
  for (const a of ambitos) {
    if (a.es_general) { activos.set(a.codigo, 'general'); continue; }
    if (decl.has(a.codigo)) { activos.set(a.codigo, 'declarado'); continue; }
    const reglas = typeof a.regla_activacion === 'string' ? JSON.parse(a.regla_activacion) : a.regla_activacion;
    if (Array.isArray(reglas) && reglas.some((r) => cumpleCondicion(empresa[r.campo], r))) activos.set(a.codigo, 'automatico');
  }
  return activos;
}

function normasAplicables(normas, activos) {
  return normas.filter((n) => VIGENTES.has(n.estado_vigencia) && activos.has(n.ambito));
}

/**
 * Audita la matriz declarada por el cliente.
 * @returns {{ derogadas, desinformacion, noReconocidas, faltantes, noAplican, correctas, otras, totales }}
 */
function auditar({ texto, normas, desinformacion, activos }) {
  const { porLlave, porCodigo } = indexar(normas);
  const falsas = new Map(desinformacion.map((d) => {
    const [pref, num, anio] = d.codigo.split('-');
    return [llave(TIPO_POR_PREFIJO[pref], num, anio), d];
  }));

  const r = { derogadas: [], desinformacion: [], noReconocidas: [], faltantes: [], noAplican: [], correctas: [], otras: [] };
  const declaradas = new Set();

  for (const l of lineasDeEntrada(texto)) {
    if (!l.refs.length) { r.noReconocidas.push({ linea: l.linea, declarada: l.texto, motivo: 'Sin referencia normativa reconocible' }); continue; }
    for (const ref of l.refs) {
      const k = llave(ref.tipo, ref.numero, ref.anio);
      const base = { linea: l.linea, declarada: ref.texto };
      const falsa = falsas.get(k);
      if (falsa) {
        r.desinformacion.push({ ...base, codigo: falsa.codigo, explicacion: falsa.explicacion, norma_correcta: falsa.norma_correcta });
        continue;
      }
      const n = porLlave.get(k);
      if (!n) { r.noReconocidas.push({ ...base, motivo: 'No esta en el catalogo normativo' }); continue; }
      if (declaradas.has(n.codigo)) continue;
      declaradas.add(n.codigo);
      const item = { ...base, codigo: n.codigo, objeto: n.objeto, estado: n.estado_vigencia, ambito: n.ambito };
      if (DEROGADAS.has(n.estado_vigencia)) {
        const cadena = cadenaReemplazo(n.codigo, porCodigo);
        const reemplazo = cadena.length ? porCodigo.get(cadena[cadena.length - 1]) : null;
        r.derogadas.push({
          ...item, cadena, reemplazo: reemplazo ? reemplazo.codigo : null,
          reemplazo_objeto: reemplazo ? reemplazo.objeto : null, impacto: n.impacto_derogacion || null,
        });
      } else if (!VIGENTES.has(n.estado_vigencia)) {
        r.otras.push({ ...item, motivo: 'Norma con efecto agotado: no se requiere en la matriz' });
      } else if (!activos.has(n.ambito)) {
        r.noAplican.push({ ...item, motivo: `Ambito ${n.ambito} no activo en el perfil de la empresa` });
      } else {
        r.correctas.push(item);
      }
    }
  }

  // Faltantes: aplicables que no estan declaradas ni cubiertas por una derogada con ese reemplazo.
  const reemplazadas = new Set(r.derogadas.flatMap((d) => d.cadena));
  for (const n of normasAplicables(normas, activos)) {
    if (declaradas.has(n.codigo)) continue;
    r.faltantes.push({
      codigo: n.codigo, objeto: n.objeto, ambito: n.ambito, estado: n.estado_vigencia,
      motivo: reemplazadas.has(n.codigo) ? 'Reemplaza a una norma derogada que la matriz si cita' : 'Aplica al perfil y no esta en la matriz',
    });
  }

  const aplicables = normasAplicables(normas, activos).length;
  r.totales = {
    lineas: lineasDeEntrada(texto).length,
    declaradas: declaradas.size,
    derogadas: r.derogadas.length,
    desinformacion: r.desinformacion.length,
    no_reconocidas: r.noReconocidas.length,
    faltantes: r.faltantes.length,
    no_aplican: r.noAplican.length,
    correctas: r.correctas.length,
    aplicables,
    cobertura: aplicables ? Math.round((r.correctas.length / aplicables) * 10000) / 100 : 0,
  };
  return r;
}

module.exports = {
  VIGENTES, DEROGADAS, PREFIJO, parsearReferencias, lineasDeEntrada, cadenaReemplazo,
  ambitosActivos, normasAplicables, auditar,
};
