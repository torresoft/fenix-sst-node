// Reglas puras de la administracion de catalogos: tipo de campo segun la columna y normalizacion de valores.

// Columnas que maneja el sistema, nunca el formulario.
const SISTEMA = new Set(['estado', 'modificado_manual', 'creado_en', 'actualizado_en', 'actualizado_por']);

function errorValidacion(mensaje) {
  const e = new Error(mensaje);
  e.status = 422;
  return e;
}

/** Campo de formulario a partir de una fila de information_schema.COLUMNS. */
function campo(c) {
  const tipoCol = String(c.COLUMN_TYPE).toLowerCase();
  const base = {
    nombre: c.COLUMN_NAME, clave: c.COLUMN_KEY === 'PRI', unico: c.COLUMN_KEY === 'UNI', nulo: c.IS_NULLABLE === 'YES',
    conDefecto: c.COLUMN_DEFAULT !== null && c.COLUMN_DEFAULT !== 'NULL', max: c.CHARACTER_MAXIMUM_LENGTH ? Number(c.CHARACTER_MAXIMUM_LENGTH) : null,
  };
  if (tipoCol.startsWith('enum(')) return { ...base, tipo: 'enum', opciones: [...tipoCol.matchAll(/'((?:[^']|'')*)'/g)].map((m) => m[1].replace(/''/g, "'")) };
  if (tipoCol === 'tinyint(1)') return { ...base, tipo: 'bool' };
  if (/^(tinyint|smallint|mediumint|int|bigint)/.test(tipoCol)) return { ...base, tipo: 'entero' };
  if (tipoCol.startsWith('decimal')) return { ...base, tipo: 'decimal' };
  if (c.DATA_TYPE === 'date') return { ...base, tipo: 'fecha' };
  // En MariaDB, JSON es un alias de LONGTEXT: en estos catalogos todo LONGTEXT es JSON.
  if (c.DATA_TYPE === 'longtext') return { ...base, tipo: 'json' };
  if (c.DATA_TYPE === 'text' || (base.max && base.max > 255)) return { ...base, tipo: 'largo' };
  return { ...base, tipo: 'texto' };
}

/**
 * Campos editables de la tabla (excluye columnas de sistema y autoincrementales). Si la llave primaria es
 * un id autoincremental, la clave de negocio es la primera columna UNIQUE (p. ej. norma.codigo).
 */
function campos(columnas) {
  const lista = columnas.filter((c) => !SISTEMA.has(c.COLUMN_NAME) && !/auto_increment/i.test(c.EXTRA || '')).map(campo);
  if (!lista.some((c) => c.clave)) {
    const u = lista.find((c) => c.unico);
    if (u) u.clave = true;
  }
  return lista;
}

/** Valores del formulario -> fila lista para la BD. Al editar, la clave no se toca. */
function normalizar(lista, datos, { nuevo }) {
  const fila = {};
  for (const f of lista) {
    if (f.clave && !nuevo) continue;
    const crudo = datos[f.nombre];
    if (f.tipo === 'bool') { fila[f.nombre] = ['1', 'on', 'true'].includes(String(crudo)) ? 1 : 0; continue; }
    const v = String(crudo ?? '').trim();
    if (!v) {
      if (f.clave || (!f.nulo && !f.conDefecto)) throw errorValidacion(`${f.nombre} es obligatorio`);
      if (f.nulo) fila[f.nombre] = null;
      continue;
    }
    if (f.tipo === 'enum' && !f.opciones.includes(v)) throw errorValidacion(`${f.nombre}: valor no permitido`);
    if (f.tipo === 'entero' && !/^-?\d+$/.test(v)) throw errorValidacion(`${f.nombre} debe ser un numero entero`);
    if (f.tipo === 'decimal' && !/^-?\d+(\.\d+)?$/.test(v)) throw errorValidacion(`${f.nombre} debe ser un numero`);
    if (f.tipo === 'fecha' && !/^\d{4}-\d{2}-\d{2}$/.test(v)) throw errorValidacion(`${f.nombre} debe ser una fecha AAAA-MM-DD`);
    if (f.max && v.length > f.max) throw errorValidacion(`${f.nombre} admite maximo ${f.max} caracteres`);
    if (f.tipo === 'json') {
      try {
        fila[f.nombre] = JSON.stringify(JSON.parse(v));
      } catch (e) {
        throw errorValidacion(`${f.nombre}: JSON invalido (${e.message})`);
      }
      continue;
    }
    fila[f.nombre] = f.tipo === 'entero' ? Number(v) : v;
  }
  return fila;
}

/** Campos que cambiaron (para la auditoria). */
function diferencias(antes, despues) {
  const a = {};
  const d = {};
  for (const k of Object.keys(despues)) {
    const previo = antes[k] !== null && typeof antes[k] === 'object' && !(antes[k] instanceof Date) ? JSON.stringify(antes[k]) : antes[k];
    if (String(previo ?? '') !== String(despues[k] ?? '')) { a[k] = antes[k]; d[k] = despues[k]; }
  }
  return { antes: a, despues: d };
}

module.exports = { SISTEMA, campo, campos, normalizar, diferencias, errorValidacion };
