// Carga data/*.json en los catalogos globales. Idempotente: correrlo N veces no duplica ni
// pisa filas editadas desde la administracion (modificado_manual = 1).
// Uso: node scripts/cargar-catalogos.js [--validar]   (--validar: solo revisa los JSON, sin BD)
const path = require('path');

const DATA = path.join(__dirname, '..', 'data');
const leer = (archivo) => require(path.join(DATA, archivo));

function requerir(obj, campos, contexto) {
  for (const c of campos) {
    if (obj[c] === undefined || obj[c] === null || obj[c] === '') throw new Error(`${contexto}: falta ${c} en ${JSON.stringify(obj).slice(0, 120)}`);
  }
  return obj;
}

function construirLotes() {
  const clases = leer('clases_riesgo.json').clases.map((c) => requerir(c, ['clase', 'nivel', 'descripcion'], 'clase_riesgo'));
  const normas = leer('normas.json').normas.map((n) => requerir(n, ['codigo', 'tipo', 'numero', 'anio', 'emisor', 'objeto', 'estado', 'ambito'], 'norma'));
  const est = leer('estandares_minimos.json');
  const plazos = leer('plazos_legales.json');
  const ind = leer('indicadores.json');
  const tipos = leer('tipos_documentales.json').tipos.map((t) => requerir(t, ['codigo', 'nombre', 'retencion', 'modulo'], 'tipo_documental'));
  // Dos festivos trasladados pueden caer el mismo lunes (p. ej. 2030-07-01): una fila, nombres unidos.
  const festivosPorFecha = new Map();
  for (const f of Object.values(leer('festivos_co.json').festivos).flat()) {
    const previo = festivosPorFecha.get(f.fecha);
    festivosPorFecha.set(f.fecha, previo
      ? { ...previo, nombre: `${previo.nombre} / ${f.nombre}`, trasladado: previo.trasladado || f.trasladado }
      : f);
  }
  const festivos = [...festivosPorFecha.values()];
  const desinformacion = (leer('normas.json').desinformacion || []).map((d) => requerir(d, ['codigo', 'referencia', 'explicacion'], 'norma_desinformacion'));
  const eventos = leer('eventos.json');
  const comites = leer('comites.json').tipos;
  const peligros = leer('peligros.json');
  const planes = leer('planes.json').planes.map((p) => requerir(p, ['codigo', 'nombre', 'conjuntos'], 'plan_comercial'));
  const formacion = leer('formacion.json').tipos;
  const finalidades = leer('datos_personales.json').finalidades.map((f) => requerir(f, ['codigo', 'nombre', 'norma_codigo', 'version', 'texto'], 'finalidad_datos'));
  const operacion = leer('operacion.json');
  const especificos = leer('especificos.json');
  const ambitos = leer('ambitos.json').ambitos.map((a) => requerir(a, ['codigo', 'nombre'], 'ambito_normativo'));

  const conjuntos = est.aplicabilidad.map((a) => requerir(a, ['conjunto', 'articulo', 'criterio', 'estandares', 'prioridad'], 'estandar_conjunto'));
  const codigosConjunto = new Set(conjuntos.map((a) => a.conjunto));

  const tabla = (est.tabla_valores || []).map((e) => {
    requerir(e, ['numeral', 'estandar', 'peso_estandar', 'nombre', 'ciclo', 'componente', 'peso'], 'tabla_valores');
    return {
      numeral: e.numeral, estandar: e.estandar, peso_estandar: e.peso_estandar, nombre: e.nombre, ciclo: e.ciclo,
      componente: e.componente, peso: e.peso, item_articulo: e.item_articulo ?? null, criterio: e.criterio ?? null,
      modo_verificacion: e.modo_verificacion ?? null, articulo: e.articulo ?? null,
    };
  });

  const requisitos = [];
  const requisitoNumerales = [];
  for (const [conjunto, lista] of Object.entries(est.requisitos || {})) {
    if (!codigosConjunto.has(conjunto)) throw new Error(`requisitos.${conjunto}: conjunto inexistente en aplicabilidad`);
    for (const r of lista) {
      requerir(r, ['orden', 'nombre'], `requisitos.${conjunto}`);
      requisitos.push({
        conjunto_codigo: conjunto, orden: r.orden, nombre: r.nombre, criterio: r.criterio ?? null,
        modo_verificacion: r.modo_verificacion ?? null, articulo: r.articulo ?? null, mapeo_verificado: r.mapeo_verificado ? 1 : 0,
      });
      for (const numeral of r.numerales || []) requisitoNumerales.push({ conjunto_codigo: conjunto, orden: r.orden, numeral });
    }
  }

  const ponderacion = [];
  for (const p of est.ponderacion_phva) {
    ponderacion.push({ ciclo: p.ciclo, componente: '', peso: p.peso });
    for (const c of p.componentes || []) ponderacion.push({ ciclo: p.ciclo, componente: c.nombre, peso: c.peso });
  }

  const indicadores = [...ind.resultado, ...ind.estructura, ...ind.proceso].map((i) => {
    requerir(i, ['codigo', 'nombre', 'tipo', 'norma_codigo'], 'indicador');
    return {
      codigo: i.codigo, nombre: i.nombre, tipo: i.tipo, formula_texto: i.formula_texto ?? null,
      formula_literal: i.formula_literal ?? null, definicion: i.definicion ?? null, interpretacion: i.interpretacion ?? null,
      numerador: i.numerador ?? null, denominador: i.denominador ?? null, factor: i.factor ?? null,
      periodicidad: i.periodicidad ?? null, derivable: i.derivable == null ? null : (i.derivable ? 1 : 0),
      norma_codigo: i.norma_codigo,
    };
  });

  const lotes = [
    {
      tabla: 'ambito_normativo', claves: ['codigo'], filas: ambitos.map((a) => ({
        codigo: a.codigo, nombre: a.nombre, descripcion: a.descripcion ?? null, es_general: a.es_general ? 1 : 0,
        declarable: a.declarable ? 1 : 0, regla_activacion: a.regla_activacion ?? null, norma_codigo: a.norma_codigo ?? null,
      })),
    },
    { tabla: 'clase_riesgo', claves: ['clase'], filas: clases.map((c) => ({ clase: c.clase, nivel: c.nivel, descripcion: c.descripcion, ejemplos: c.ejemplos ?? null })) },
    {
      tabla: 'norma', claves: ['codigo'], filas: normas.map((n) => ({
        codigo: n.codigo, tipo: n.tipo, numero: String(n.numero), anio: n.anio, emisor: n.emisor, objeto: n.objeto,
        estado_vigencia: n.estado, reemplaza_a: n.reemplaza_a ?? null, derogada_por: n.derogada_por ?? null,
        ambito: n.ambito, modulos: n.modulos || [], impacto_derogacion: n.impacto_derogacion ?? null,
      })),
    },
    {
      tabla: 'norma_desinformacion', claves: ['codigo'], filas: desinformacion.map((d) => ({
        codigo: d.codigo, referencia: d.referencia, explicacion: d.explicacion, norma_correcta: d.norma_correcta ?? null,
      })),
    },
    {
      tabla: 'estandar_conjunto', claves: ['codigo'], filas: conjuntos.map((a) => ({
        codigo: a.conjunto, articulo: a.articulo, criterio: a.criterio, cantidad_estandares: a.estandares,
        perfil_responsable: a.perfil_responsable ?? null, prioridad: a.prioridad,
        trabajadores_min: a.trabajadores_min ?? null, trabajadores_max: a.trabajadores_max ?? null,
        riesgo_nivel_min: a.riesgo_nivel_min ?? null, riesgo_nivel_max: a.riesgo_nivel_max ?? null,
        solo_agropecuario: a.solo_agropecuario ? 1 : 0, es_residual: a.es_residual ? 1 : 0,
        evalua_tabla_completa: a.evalua_tabla_completa ? 1 : 0,
      })),
    },
    { tabla: 'estandar_ponderacion', claves: ['ciclo', 'componente'], filas: ponderacion },
    {
      tabla: 'estandar_valoracion', claves: ['codigo'],
      filas: est.valoracion.map((v) => ({
        codigo: v.codigo, minimo: v.min, maximo: v.max, criterio_literal: v.criterio_literal ?? null, acciones: v.acciones || [],
      })),
    },
    { tabla: 'estandar_minimo', claves: ['numeral'], filas: tabla },
    {
      tabla: 'estandar_cargue', claves: ['vigencia_anio'], filas: (est.cargue_mintrabajo || []).map((c) => ({
        vigencia_anio: c.vigencia_anio, fecha_limite: c.fecha_limite, norma_codigo: c.norma_codigo, url: c.url ?? null,
      })),
    },
    { tabla: 'estandar_requisito', claves: ['conjunto_codigo', 'orden'], filas: requisitos },
    { tabla: 'estandar_requisito_numeral', claves: ['conjunto_codigo', 'orden', 'numeral'], filas: requisitoNumerales },
    {
      tabla: 'plazo_legal', claves: ['codigo'], filas: plazos.plazos_por_evento.map((p) => {
        requerir(p, ['codigo', 'descripcion', 'cantidad', 'tipo', 'norma_codigo', 'evento_disparador'], 'plazo_legal');
        return {
          codigo: p.codigo, descripcion: p.descripcion, cantidad: Number(p.cantidad), tipo: p.tipo,
          norma_codigo: p.norma_codigo, evento_disparador: p.evento_disparador,
          entidad_destino: p.entidad_destino ?? null, modulo: p.modulo ?? null,
          severidad: p.severidad || 'media', dias_alerta_previa: p.dias_alerta_previa ?? 3,
          correr_si_inhabil: p.correr_si_inhabil ? 1 : 0,
        };
      }),
    },
    {
      tabla: 'vencimiento_recurrente', claves: ['codigo'], filas: plazos.vencimientos_recurrentes.map((v) => {
        requerir(v, ['codigo', 'descripcion', 'cada', 'unidad', 'norma_codigo', 'modulo'], 'vencimiento_recurrente');
        const cada = Number(v.cada);
        if (!Number.isInteger(cada) || cada <= 0) throw new Error(`vencimiento_recurrente ${v.codigo}: cada invalido`);
        return {
          codigo: v.codigo, descripcion: v.descripcion, cada, unidad: v.unidad, norma_codigo: v.norma_codigo,
          consecuencia: v.consecuencia ?? null, modulo: v.modulo, dias_alerta_previa: v.dias_alerta_previa ?? 30,
          severidad: v.severidad || 'media', mes_dia_limite: v.mes_dia_limite ?? null,
        };
      }),
    },
    { tabla: 'indicador_catalogo', claves: ['codigo'], filas: indicadores },
    {
      tabla: 'comite_tipo', claves: ['codigo'], filas: comites.map((c) => ({
        codigo: c.codigo, nombre: c.nombre, norma_codigo: c.norma_codigo, trabajadores_min: c.trabajadores_min ?? null,
        trabajadores_max: c.trabajadores_max ?? null, vencimiento_codigo: c.vencimiento_codigo, documento_tipo: c.documento_tipo,
        quorum: c.quorum ?? null, periodicidad_meses: c.periodicidad_meses ?? 1, conformacion: c.conformacion ?? null,
      })),
    },
    {
      tabla: 'competencia_tipo', claves: ['codigo'], filas: formacion.map((t) => ({
        codigo: t.codigo, nombre: t.nombre, norma_codigo: t.norma_codigo, vencimiento_codigo: t.vencimiento_codigo ?? null,
        requerida_todos: t.requerida_todos ? 1 : 0, requiere_certificado: t.requiere_certificado ? 1 : 0,
      })),
    },
    {
      tabla: 'plan_comercial', claves: ['codigo'], filas: planes.map((p) => ({
        codigo: p.codigo, nombre: p.nombre, descripcion: p.descripcion ?? null, conjuntos: p.conjuntos,
        max_empresas: p.max_empresas ?? null, max_usuarios: p.max_usuarios ?? null, orden: p.orden ?? 0,
      })),
    },
    { tabla: 'metodologia_riesgo', claves: ['codigo'], filas: peligros.metodologias.map((m) => ({ codigo: m.codigo, nombre: m.nombre, escalas: m.escalas })) },
    { tabla: 'peligro_clase', claves: ['codigo'], filas: peligros.clases_peligro.map((c) => ({ codigo: c.codigo, nombre: c.nombre, ejemplos: c.ejemplos })) },
    { tabla: 'control_jerarquia', claves: ['codigo'], filas: peligros.jerarquia_controles.map((c) => ({ codigo: c.codigo, nivel: c.nivel, nombre: c.nombre })) },
    {
      tabla: 'peligro_tipo', claves: ['codigo'], filas: peligros.peligros_tipo.map((p) => ({
        codigo: p.codigo, clase_codigo: p.clase, nombre: p.nombre, efectos: p.efectos ?? null, peor_consecuencia: p.peor_consecuencia ?? null,
        nc_sugerido: p.nc ?? null, norma_codigo: p.norma_codigo ?? null, controles: p.controles || [],
      })),
    },
    {
      tabla: 'cargo_tipo', claves: ['codigo'], filas: peligros.cargos_tipo.map((c) => ({
        codigo: c.codigo, nombre: c.nombre, descripcion: c.descripcion ?? null, peligros: c.peligros, competencias: c.competencias || [],
      })),
    },
    {
      tabla: 'evento_criterio_grave', claves: ['codigo'],
      filas: eventos.criterios_grave.map((c) => ({ codigo: c.codigo, descripcion: c.descripcion, norma_codigo: c.norma_codigo })),
    },
    {
      tabla: 'investigacion_rol', claves: ['codigo'],
      filas: eventos.roles_investigacion.map((x) => ({ codigo: x.codigo, nombre: x.nombre, requerido_en: x.requerido_en, norma_codigo: x.norma_codigo })),
    },
    {
      tabla: 'tipo_documental', claves: ['codigo'], filas: tipos.map((t) => ({
        codigo: t.codigo, nombre: t.nombre, origen_articulo: t.origen_articulo ?? null, retencion: t.retencion,
        requiere_firma: t.requiere_firma ? 1 : 0, vigencia_meses: t.vigencia_meses ?? null,
        vencimiento_codigo: t.vencimiento_codigo ?? null, modulo: t.modulo,
        solo_referencia: t.solo_referencia ? 1 : 0, modalidades_firma: t.modalidades_firma || [],
      })),
    },
    {
      tabla: 'finalidad_datos', claves: ['codigo'], filas: finalidades.map((f) => ({
        codigo: f.codigo, nombre: f.nombre, es_dato_sensible: f.es_dato_sensible ? 1 : 0, norma_codigo: f.norma_codigo, version: f.version, texto: f.texto,
      })),
    },
    { tabla: 'pesv_paso', claves: ['codigo'], filas: especificos.pesv.pasos.map((p) => ({ codigo: p.codigo, fase: p.fase, nombre: p.nombre })) },
    { tabla: 'equipo_tipo', claves: ['codigo'], filas: operacion.equipos.map((e) => ({ codigo: e.codigo, nombre: e.nombre, meses_vigencia: e.meses_vigencia })) },
    {
      tabla: 'permiso_tipo', claves: ['codigo'], filas: operacion.permisos.map((p) => ({
        codigo: p.codigo, nombre: p.nombre, competencia_codigo: p.competencia_codigo ?? null, norma_codigo: p.norma_codigo,
        documento_tipo: p.documento_tipo ?? null, verificaciones: p.verificaciones,
      })),
    },
    {
      tabla: 'festivo', claves: ['fecha'],
      filas: festivos.map((f) => ({ fecha: f.fecha, nombre: f.nombre, trasladado: f.trasladado ? 1 : 0 })),
    },
  ];

  // Estos catalogos referencian tipo_documental y vencimiento_recurrente: van al final.
  const alFinal = ['comite_tipo', 'competencia_tipo', 'permiso_tipo'];
  const ordenados = [...lotes.filter((l) => !alFinal.includes(l.tabla)), ...lotes.filter((l) => alFinal.includes(l.tabla))];
  return { lotes: ordenados, advertencias: validarReferencias(ordenados, est) };
}

// Referencias a norma.codigo y sumas de ponderacion: advertencias, no errores.
function validarReferencias(lotes, est) {
  const avisos = [];
  const filas = (t) => lotes.find((l) => l.tabla === t).filas;
  const codigos = new Set(filas('norma').map((n) => n.codigo));
  for (const t of ['plazo_legal', 'vencimiento_recurrente', 'indicador_catalogo', 'estandar_conjunto', 'ambito_normativo', 'peligro_tipo']) {
    for (const f of filas(t)) {
      if (f.norma_codigo && !codigos.has(f.norma_codigo)) avisos.push(`${t} ${f.codigo}: norma_codigo ${f.norma_codigo} no existe en normas.json`);
    }
  }
  for (const n of filas('norma')) {
    // reemplaza_a puede citar normas historicas fuera del catalogo; derogada_por siempre debe existir
    for (const ref of String(n.derogada_por || '').split(',').filter(Boolean)) {
      if (!codigos.has(ref.trim())) avisos.push(`norma ${n.codigo}: derogada_por ${ref} no existe en normas.json`);
    }
  }
  const ambitos = new Set(filas('ambito_normativo').map((x) => x.codigo));
  for (const n of filas('norma')) if (!ambitos.has(n.ambito)) avisos.push(`norma ${n.codigo}: ambito ${n.ambito} no existe en ambitos.json`);
  for (const d of filas('norma_desinformacion')) if (d.norma_correcta && !codigos.has(d.norma_correcta)) avisos.push(`desinformacion ${d.codigo}: norma_correcta inexistente`);
  const suma = (lista) => lista.reduce((t, x) => t + Number(x.peso), 0);
  if (Math.abs(suma(est.ponderacion_phva) - 100) > 0.001) avisos.push(`ponderacion PHVA suma ${suma(est.ponderacion_phva)}, no 100`);
  const tabla = filas('estandar_minimo');
  if (Math.abs(suma(tabla) - 100) > 0.001) avisos.push(`tabla de valores suma ${suma(tabla)}, no 100`);
  for (const p of est.ponderacion_phva) {
    for (const c of p.componentes || []) {
      const s = suma(tabla.filter((e) => e.ciclo === p.ciclo && e.componente === c.nombre));
      if (Math.abs(s - c.peso) > 0.001) avisos.push(`componente ${c.nombre}: tabla suma ${s}, ponderacion ${c.peso}`);
    }
  }
  for (const c of filas('estandar_conjunto')) {
    const n = c.evalua_tabla_completa
      ? tabla.length
      : filas('estandar_requisito').filter((r) => r.conjunto_codigo === c.codigo).length;
    if (n !== c.cantidad_estandares) avisos.push(`estandar_conjunto ${c.codigo}: ${n} de ${c.cantidad_estandares} estandares cargados`);
  }
  const sinVerificar = filas('estandar_requisito').filter((r) => !r.mapeo_verificado && r.conjunto_codigo !== 'AGRO_3').length;
  if (sinVerificar) avisos.push(`${sinVerificar} requisitos con mapeo a numerales NO verificado en texto oficial (parametrizable)`);
  return avisos;
}

async function main() {
  const { lotes, advertencias } = construirLotes();
  advertencias.forEach((a) => console.warn(`AVISO  ${a}`));
  if (process.argv.includes('--validar')) {
    lotes.forEach((l) => console.info(`${l.tabla.padEnd(24)} ${l.filas.length} filas`));
    return;
  }
  const { cargarCatalogos, cerrar } = require('../src/db/carga-catalogos');
  try {
    const resumenes = await cargarCatalogos(lotes, 'data/*.json');
    for (const r of resumenes) {
      if (r.tabla === 'boletin_normativo') { console.info(`boletines normativos      ${r.insertadas} nuevos (se propagan en el job diario)`); continue; }
      console.info(`${r.tabla.padEnd(24)} +${r.insertadas} nuevas  ~${r.actualizadas} actualizadas  =${r.sin_cambio} iguales  !${r.protegidas} protegidas`);
    }
  } finally {
    await cerrar();
  }
}

main().catch((err) => {
  console.error(`Error: ${err.message}`);
  process.exit(1);
});
