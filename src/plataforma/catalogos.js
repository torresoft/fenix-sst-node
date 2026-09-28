// Catalogos globales editables por el superadmin. Lista blanca: los catalogos que alimentan calculos
// sensibles (estandares 0312, metodologia GTC 45, finalidades con consentimientos) solo se cambian por seed.
const { consultarCatalogo } = require('../db/global');
const db = require('../db/catalogos-admin');
const fechas = require('../fechas');
const { error } = require('../comun/rutas');
const reglas = require('./catalogo-reglas');

const CATALOGOS = [
  { tabla: 'norma', titulo: 'Normas', grupo: 'Normativo', lista: ['objeto', 'estado_vigencia'] },
  { tabla: 'ambito_normativo', titulo: 'Ámbitos normativos', grupo: 'Normativo', lista: ['nombre'] },
  { tabla: 'plazo_legal', titulo: 'Plazos legales', grupo: 'Plazos', lista: ['descripcion', 'cantidad', 'tipo'] },
  { tabla: 'vencimiento_recurrente', titulo: 'Vencimientos recurrentes', grupo: 'Plazos', lista: ['descripcion', 'cada', 'unidad'] },
  { tabla: 'festivo', titulo: 'Festivos', grupo: 'Plazos', lista: ['nombre'] },
  { tabla: 'tipo_documental', titulo: 'Tipos documentales', grupo: 'Documentos', lista: ['nombre', 'retencion'] },
  { tabla: 'peligro_clase', titulo: 'Clases de peligro', grupo: 'Peligros', lista: ['nombre'] },
  { tabla: 'peligro_tipo', titulo: 'Peligros tipo', grupo: 'Peligros', lista: ['clase_codigo', 'nombre', 'nc_sugerido'] },
  { tabla: 'cargo_tipo', titulo: 'Cargos tipo', grupo: 'Peligros', lista: ['nombre'] },
  { tabla: 'competencia_tipo', titulo: 'Competencias', grupo: 'Formación', lista: ['nombre', 'norma_codigo'] },
  { tabla: 'indicador_catalogo', titulo: 'Indicadores', grupo: 'Indicadores', lista: ['nombre', 'tipo'] },
  { tabla: 'evento_criterio_grave', titulo: 'Criterios de AT grave', grupo: 'Eventos', lista: ['descripcion'] },
  { tabla: 'investigacion_rol', titulo: 'Roles de investigación', grupo: 'Eventos', lista: ['nombre'] },
  { tabla: 'comite_tipo', titulo: 'Tipos de comité', grupo: 'Operación', lista: ['nombre'] },
  { tabla: 'equipo_tipo', titulo: 'Equipos de emergencia', grupo: 'Operación', lista: ['nombre', 'meses_vigencia'] },
  { tabla: 'permiso_tipo', titulo: 'Permisos de trabajo', grupo: 'Operación', lista: ['nombre'] },
  { tabla: 'plan_comercial', titulo: 'Planes comerciales', grupo: 'Comercial', lista: ['nombre', 'max_empresas', 'max_usuarios'] },
];

// Columnas que referencian otro catalogo: el formulario las autocompleta con sus codigos.
const REFERENCIAS = {
  norma_codigo: 'norma', clase_codigo: 'peligro_clase', vencimiento_codigo: 'vencimiento_recurrente',
  competencia_codigo: 'competencia_tipo', documento_tipo: 'tipo_documental', ambito: 'ambito_normativo',
};

const parse = (v) => (typeof v === 'string' ? JSON.parse(v) : v);

// Coherencia de los JSON que otros modulos leen.
const VALIDAR = {
  async plan_comercial(fila) {
    if (fila.conjuntos === undefined) return;
    const validos = new Set((await consultarCatalogo('SELECT codigo FROM estandar_conjunto')).map((x) => x.codigo));
    const lista = parse(fila.conjuntos);
    if (!Array.isArray(lista) || !lista.length || lista.some((c) => !validos.has(c))) {
      throw reglas.errorValidacion(`conjuntos: lista de codigos de la Res. 0312 (${[...validos].join(', ')})`);
    }
  },
  async peligro_tipo(fila) {
    if (fila.controles === undefined) return;
    const jer = new Set((await consultarCatalogo('SELECT codigo FROM control_jerarquia')).map((x) => x.codigo));
    const lista = parse(fila.controles);
    if (!Array.isArray(lista) || lista.some((c) => !jer.has(c.jerarquia) || !String(c.descripcion || '').trim())) {
      throw reglas.errorValidacion('controles: lista de { jerarquia, descripcion } con un nivel de la jerarquia valido');
    }
  },
  async cargo_tipo(fila) {
    if (fila.peligros !== undefined) {
      const pel = new Set((await consultarCatalogo('SELECT codigo FROM peligro_tipo')).map((x) => x.codigo));
      const lista = parse(fila.peligros);
      if (!Array.isArray(lista) || lista.some((x) => !pel.has(x.peligro) || !['EC', 'EF', 'EO', 'EE'].includes(x.ne))) {
        throw reglas.errorValidacion('peligros: lista de { peligro, ne } con codigos de peligro tipo existentes y NE EC, EF, EO o EE');
      }
    }
    if (fila.competencias !== undefined) {
      const comp = new Set((await consultarCatalogo('SELECT codigo FROM competencia_tipo')).map((x) => x.codigo));
      const lista = parse(fila.competencias);
      if (!Array.isArray(lista) || lista.some((c) => !comp.has(c))) throw reglas.errorValidacion('competencias: lista de codigos de competencia existentes');
    }
  },
};

function definicion(tabla) {
  const d = CATALOGOS.find((c) => c.tabla === tabla);
  if (!d) throw error(404, 'Catalogo no administrable');
  return d;
}

async function estructura(tabla) {
  const def = definicion(tabla);
  const cols = await db.columnas(tabla);
  const campos = reglas.campos(cols);
  const clave = campos.find((c) => c.clave);
  return { def, cols, campos, clave };
}

async function indice() {
  const r = new Map((await db.resumen(CATALOGOS.map((c) => c.tabla))).map((x) => [x.tabla, x]));
  const grupos = [...new Set(CATALOGOS.map((c) => c.grupo))];
  return grupos.map((g) => ({ grupo: g, catalogos: CATALOGOS.filter((c) => c.grupo === g).map((c) => ({ ...c, ...r.get(c.tabla) })) }));
}

async function listar(tabla, q) {
  const e = await estructura(tabla);
  return { ...e, filas: await db.listar(tabla, e.clave.nombre, e.def.lista, q) };
}

async function formulario(tabla, valor) {
  const e = await estructura(tabla);
  const fila = valor == null ? null : await db.obtener(tabla, e.clave.nombre, valor);
  if (valor != null && !fila) throw error(404, 'Registro no encontrado');
  const refs = {};
  for (const c of e.campos.filter((x) => REFERENCIAS[x.nombre])) {
    refs[c.nombre] = (await consultarCatalogo(`SELECT codigo FROM ${REFERENCIAS[c.nombre]} WHERE estado = 'activo' ORDER BY codigo`)).map((x) => x.codigo);
  }
  return { ...e, fila, refs };
}

// El calendario de festivos vive en memoria del proceso: se recarga tras cambiarlo.
async function trasCambio(tabla) {
  if (tabla === 'festivo') await fechas.inicializar();
}

async function guardar(tabla, valor, datos, actor) {
  const e = await estructura(tabla);
  const nuevo = valor == null;
  const fila = reglas.normalizar(e.campos, datos, { nuevo });
  if (VALIDAR[tabla]) await VALIDAR[tabla](fila);
  let r;
  if (nuevo) {
    r = await db.insertar(tabla, e.clave.nombre, fila, e.cols, actor);
  } else {
    const previa = await db.obtener(tabla, e.clave.nombre, valor);
    if (!previa) throw error(404, 'Registro no encontrado');
    const cambios = reglas.diferencias(previa, fila);
    if (!Object.keys(cambios.despues).length) return { sinCambios: true, clave: valor };
    r = await db.actualizar(tabla, e.clave.nombre, valor, cambios, e.cols, actor);
  }
  await trasCambio(tabla);
  return { ...r, clave: nuevo ? fila[e.clave.nombre] : valor };
}

async function cambiarEstado(tabla, valor, activo, actor) {
  const e = await estructura(tabla);
  if (!(await db.obtener(tabla, e.clave.nombre, valor))) throw error(404, 'Registro no encontrado');
  const r = await db.cambiarEstado(tabla, e.clave.nombre, valor, activo ? 'activo' : 'inactivo', e.cols, actor);
  await trasCambio(tabla);
  return r;
}

async function restaurar(tabla, valor, actor) {
  const e = await estructura(tabla);
  await db.restaurar(tabla, e.clave.nombre, valor, actor);
}

module.exports = { CATALOGOS, indice, listar, formulario, guardar, cambiarEstado, restaurar };
