// Reglas puras de eventos (incidentes, AT, EL). Criterios de gravedad y roles llegan del catalogo.
const { sinDatosClinicos } = require('../salud/reglas');

const TIPOS = ['incidente', 'accidente', 'enfermedad'];
const GRAVEDADES = ['leve', 'grave', 'mortal'];
const CAUSAS_INMEDIATAS = ['acto_inseguro', 'condicion_insegura'];
const CAUSAS_BASICAS = ['factor_personal', 'factor_trabajo'];

function errorValidacion(mensaje) {
  const e = new Error(mensaje);
  e.status = 422;
  return e;
}

/** Variante para el motor de plazos: incidente | at_leve | at_grave | at_mortal | el. */
function variante(tipo, gravedad) {
  if (tipo === 'incidente') return 'incidente';
  if (tipo === 'enfermedad') return 'el';
  return `at_${gravedad}`;
}

const codigoEvento = (anio, n) => `EV-${anio}-${String(n).padStart(3, '0')}`;

/**
 * Valida y normaliza el registro. ahora: 'YYYY-MM-DDTHH:MM' en hora de Bogota.
 * Un accidente con criterios del art. 3 de la Res. 1401 no puede quedar como leve.
 */
function validarRegistro(d, ahora, criteriosCatalogo) {
  const tipo = String(d.tipo || '');
  if (!TIPOS.includes(tipo)) throw errorValidacion('Tipo de evento invalido');
  const gravedad = tipo === 'accidente' ? String(d.gravedad || '') : null;
  if (tipo === 'accidente' && !GRAVEDADES.includes(gravedad)) throw errorValidacion('Indique la gravedad del accidente');
  const personaId = d.persona_id ? Number.parseInt(d.persona_id, 10) : null;
  if (tipo !== 'incidente' && !personaId) throw errorValidacion('Indique la persona afectada');

  let ocurrencia = null;
  if (d.fecha_ocurrencia) {
    ocurrencia = String(d.fecha_ocurrencia).replace(' ', 'T').slice(0, 16);
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(ocurrencia)) throw errorValidacion('Fecha y hora de ocurrencia invalidas');
    if (ocurrencia > ahora) throw errorValidacion('La ocurrencia no puede ser futura');
  } else if (tipo !== 'enfermedad') throw errorValidacion('Indique la fecha y hora de ocurrencia');

  let diagnostico = null;
  if (tipo === 'enfermedad') {
    diagnostico = String(d.fecha_diagnostico || '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(diagnostico)) throw errorValidacion('Indique la fecha de calificacion o diagnostico de la enfermedad laboral');
    if (diagnostico > ahora.slice(0, 10)) throw errorValidacion('La fecha de calificacion no puede ser futura');
  }

  const validos = new Set(criteriosCatalogo.map((c) => c.codigo));
  const criterios = [...new Set([].concat(d.criterios_grave || []).filter(Boolean).map(String))];
  for (const c of criterios) if (!validos.has(c)) throw errorValidacion('Criterio de gravedad invalido');
  if (tipo === 'accidente') {
    if (gravedad === 'leve' && criterios.length) throw errorValidacion('Con lesiones del art. 3 de la Res. 1401 el accidente es grave, no leve');
    if (gravedad === 'grave' && !criterios.length) throw errorValidacion('Marque la lesion que hace grave al accidente (art. 3, Res. 1401)');
  } else if (criterios.length) throw errorValidacion('Los criterios de gravedad aplican solo a accidentes');

  const descripcion = String(d.descripcion || '').trim();
  if (descripcion.length < 20) throw errorValidacion('Describa como ocurrio el evento (minimo 20 caracteres)');
  // Regla dura 1: la EL se registra sin diagnostico.
  if (tipo === 'enfermedad') sinDatosClinicos(descripcion, 'Descripcion');
  const dias = Number.parseInt(d.dias_incapacidad || 0, 10);
  if (!Number.isInteger(dias) || dias < 0 || dias > 3650) throw errorValidacion('Dias de incapacidad invalidos');

  return {
    tipo, gravedad, persona_id: personaId,
    fecha_ocurrencia: ocurrencia ? `${ocurrencia.replace('T', ' ')}:00` : null,
    fecha_diagnostico: diagnostico,
    fecha_base: tipo === 'enfermedad' ? diagnostico : ocurrencia.slice(0, 10),
    criterios_grave: tipo === 'accidente' && criterios.length ? criterios : null,
    descripcion: descripcion.slice(0, 5000),
    dias_incapacidad: dias,
  };
}

function rolesFaltantes(rolesCatalogo, varianteEvento, equipo) {
  const presentes = new Set(equipo.filter((m) => m.estado === 'activo').map((m) => m.rol_codigo));
  return rolesCatalogo
    .filter((r) => (typeof r.requerido_en === 'string' ? JSON.parse(r.requerido_en) : r.requerido_en).includes(varianteEvento))
    .filter((r) => !presentes.has(r.codigo))
    .map((r) => r.nombre);
}

function analisisFaltante(causas) {
  const activas = causas.filter((c) => c.estado === 'activo');
  const falta = [];
  if (!activas.some((c) => CAUSAS_INMEDIATAS.includes(c.tipo))) falta.push('al menos una causa inmediata (acto o condicion insegura)');
  if (!activas.some((c) => CAUSAS_BASICAS.includes(c.tipo))) falta.push('al menos una causa basica (factor personal o del trabajo)');
  return falta;
}

/** Entidades ante las que falta radicar el FURAT/FUREL (entidad_destino del catalogo, separadas por coma). */
function reportesFaltantes(entidadDestino, reportes) {
  const requeridas = String(entidadDestino || '').split(',').map((x) => x.trim()).filter(Boolean);
  const hechas = new Set(reportes.map((x) => x.entidad));
  return requeridas.filter((x) => !hechas.has(x));
}

const requiereInformeArl = (e) => e.tipo === 'accidente' && ['grave', 'mortal'].includes(e.gravedad);

/** Motivos por los que el evento no puede cerrarse (vacio = puede). */
function impedimentosCerrar(e, { faltanReportes, informeArl }) {
  const m = [];
  if (!e.investigacion_cerrada_en) m.push('Cierre la investigacion');
  if (faltanReportes.length) m.push(`Radique el reporte ante: ${faltanReportes.join(', ')}`);
  if (requiereInformeArl(e) && !informeArl) m.push('Radique el informe de investigacion ante la ARL');
  return m;
}

module.exports = {
  TIPOS, GRAVEDADES, CAUSAS_INMEDIATAS, CAUSAS_BASICAS, variante, codigoEvento, validarRegistro, rolesFaltantes,
  analisisFaltante, reportesFaltantes, requiereInformeArl, impedimentosCerrar,
};
