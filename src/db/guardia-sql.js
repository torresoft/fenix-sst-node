// Validaciones puras (sin BD) que hacen imposible consultar datos de tenant sin filtro.
const { TENANT, GLOBAL } = require('./tablas');

const IDENT = /^[a-z_][a-z0-9_]*$/;
const MARCA = '{tenant}';

function identificador(nombre) {
  if (typeof nombre !== 'string' || !IDENT.test(nombre)) throw new Error(`Identificador SQL invalido: ${nombre}`);
  return nombre;
}

function validarTenantId(tenantId) {
  if (!Number.isSafeInteger(tenantId) || tenantId <= 0) throw new Error('tenant_id invalido o ausente');
  return tenantId;
}

function tablaTenant(tabla) {
  identificador(tabla);
  if (!TENANT.has(tabla)) throw new Error(`Tabla no registrada como tenant: ${tabla}`);
  return tabla;
}

function tablaGlobal(tabla) {
  identificador(tabla);
  if (!GLOBAL.has(tabla)) throw new Error(`Tabla no registrada como global: ${tabla}`);
  return tabla;
}

/**
 * La consulta como la ve el motor: literales vaciados y comentarios fuera, en una sola pasada
 * (un '#' o '--' dentro de un literal no esconde el resto). Los comentarios ejecutables se rechazan.
 */
function sinComentarios(sql) {
  let out = '';
  for (let i = 0; i < sql.length; i += 1) {
    const c = sql[i];
    const d = sql[i + 1];
    if (c === "'" || c === '"') {
      let j = i + 1;
      while (j < sql.length) {
        if (sql[j] === '\\') j += 2;
        else if (sql[j] === c && sql[j + 1] === c) j += 2;
        else if (sql[j] === c) break;
        else j += 1;
      }
      out += c + c;
      i = j;
    } else if (c === '/' && d === '*') {
      if (sql[i + 2] === '!' || (sql[i + 2] === 'M' && sql[i + 3] === '!')) throw new Error('Comentarios ejecutables no permitidos');
      const j = sql.indexOf('*/', i + 2);
      i = j < 0 ? sql.length : j + 1;
      out += ' ';
    } else if (c === '#' || (c === '-' && d === '-')) {
      const j = sql.indexOf('\n', i);
      i = j < 0 ? sql.length : j - 1;
      out += ' ';
    } else out += c;
  }
  return out;
}

const NO_ALIAS = new Set(['where', 'join', 'inner', 'left', 'right', 'cross', 'straight_join', 'natural', 'on', 'using',
  'group', 'order', 'limit', 'having', 'union', 'window', 'for', 'lock', 'as', 'outer']);

// Tablas en FROM / JOIN con su alias. Sin comma joins: se exige JOIN explicito.
function referencias(sql) {
  if (/\bfrom\s+`?[a-z_][a-z0-9_]*`?(\s+(as\s+)?`?[a-z_][a-z0-9_]*`?)?\s*,/i.test(sql)) {
    throw new Error('Use JOIN explicito, no tablas separadas por coma');
  }
  const refs = [];
  const re = /(?:\bfrom|\bjoin|\bstraight_join)\s+`?([a-z_][a-z0-9_]*)`?(?:\s+(?:as\s+)?`?([a-z_][a-z0-9_]*)`?)?/gi;
  let m;
  while ((m = re.exec(sql)) !== null) {
    const alias = m[2] && !NO_ALIAS.has(m[2].toLowerCase()) ? m[2].toLowerCase() : null;
    refs.push({ tabla: m[1].toLowerCase(), alias });
  }
  return refs;
}

const tablasReferenciadas = (sql) => referencias(sql).map((r) => r.tabla);

/**
 * Cada tabla de tenant debe quedar anclada a {tenant}: <alias>.tenant_id = {tenant}, o unida por
 * tenant_id a otra tabla anclada. Sin alias vale tenant_id = {tenant}.
 */
function verificarAnclas(sql, refs) {
  const claves = refs.filter((r) => TENANT.has(r.tabla)).map((r) => r.alias || r.tabla);
  const anclados = new Set();
  const uniones = [];
  const re = /(?:([a-z_][a-z0-9_]*)\.)?tenant_id\s*(?:=|<=>)\s*(?:\{tenant\}|([a-z_][a-z0-9_]*)\.tenant_id)|\{tenant\}\s*(?:=|<=>)\s*(?:([a-z_][a-z0-9_]*)\.)?tenant_id/gi;
  let m;
  while ((m = re.exec(sql)) !== null) {
    const izq = (m[1] || m[3] || '').toLowerCase();
    if (m[2]) uniones.push([izq, m[2].toLowerCase()]);
    else if (izq) anclados.add(izq);
    else for (const r of refs) if (!r.alias) anclados.add(r.tabla);
  }
  let cambio = true;
  while (cambio) {
    cambio = false;
    for (const [a, b] of uniones) {
      if (anclados.has(a) !== anclados.has(b)) { anclados.add(a); anclados.add(b); cambio = true; }
    }
  }
  const sueltas = [...new Set(claves.filter((k) => !anclados.has(k)))];
  if (sueltas.length) throw new Error(`Faltan filtros de tenant para: ${sueltas.join(', ')} (use <alias>.tenant_id = ${MARCA})`);
}

/**
 * Valida un SELECT de tenant y reemplaza {tenant} por el id (entero validado, no inyectable).
 * Reglas: solo lectura; toda tabla registrada; cada tabla de tenant anclada a {tenant};
 * tenant_id nunca se compara contra un parametro externo.
 */
function prepararConsultaTenant(sql, tenantId) {
  validarTenantId(tenantId);
  const limpio = sinComentarios(String(sql));
  if (!/^\s*(select|with)\b/i.test(limpio)) throw new Error('consultar() solo admite SELECT; use insertar/actualizar');
  if (/;\s*\S/.test(limpio)) throw new Error('Una sola sentencia por consulta');
  if (/\b(into\s+(outfile|dumpfile|@)|load_file|sleep|benchmark)\b/i.test(limpio)) throw new Error('Sentencia no permitida');
  if (/tenant_id\s*(<>|!=|<(?!=>)|>|\bis\b|\bbetween\b|\blike\b|\bnot\b|\bin\b)/i.test(limpio)) {
    throw new Error('tenant_id solo admite igualdad contra {tenant}');
  }

  const refs = referencias(limpio);
  if (refs.length === 0) throw new Error('La consulta no referencia tablas');
  let deTenant = 0;
  for (const { tabla } of refs) {
    if (TENANT.has(tabla)) deTenant++;
    else if (!GLOBAL.has(tabla)) throw new Error(`Tabla no registrada: ${tabla}`);
  }
  const marcas = limpio.split(MARCA).length - 1;
  if (deTenant && marcas < 1) throw new Error(`Faltan filtros de tenant: ${deTenant} tabla(s) de tenant y 0 marcas ${MARCA}`);

  // tenant_id = <algo> (en cualquier lado del =) solo contra {tenant} o contra otra columna tenant_id.
  const lados = [
    ...(limpio.match(/tenant_id\s*(?:=|<=>)\s*[^\s,)]+/gi) || []).map((c) => c.replace(/^tenant_id\s*(?:=|<=>)\s*/i, '')),
    ...(limpio.match(/[^\s(,]+\s*(?:=|<=>)\s*(?:[a-z_][a-z0-9_]*\.)?tenant_id\b/gi) || []).map((c) => c.replace(/\s*(?:=|<=>)[\s\S]*$/, '')),
  ];
  for (const lado of lados) {
    if (!/(\{tenant\}|\btenant_id)$/i.test(lado)) throw new Error(`tenant_id solo puede compararse contra ${MARCA} o contra otra columna tenant_id`);
  }
  verificarAnclas(limpio, refs);

  return String(sql).split(MARCA).join(String(tenantId));
}

function prepararConsultaGlobal(sql) {
  const limpio = sinComentarios(String(sql));
  if (!/^\s*(select|with)\b/i.test(limpio)) throw new Error('Solo lectura sobre catalogos');
  if (/;\s*\S/.test(limpio)) throw new Error('Una sola sentencia por consulta');
  for (const t of tablasReferenciadas(limpio)) tablaGlobal(t);
  return sql;
}

module.exports = {
  MARCA, identificador, validarTenantId, tablaTenant, tablaGlobal,
  tablasReferenciadas, prepararConsultaTenant, prepararConsultaGlobal,
};
