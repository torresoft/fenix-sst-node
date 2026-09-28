// M16: contratistas. Evaluacion con criterios SST, trabajadores con induccion y verificacion
// mensual de afiliacion y pago al SGRL en la clase de riesgo correcta (arts. 2.2.4.6.27 y .28, D. 1072).
const operacion = require('../../data/operacion.json');
const { hoyBogota, sumarMeses } = require('../fechas/calendario');
const { error } = require('../comun/rutas');

const CLASES = ['I', 'II', 'III', 'IV', 'V'];
const { criterios: CRITERIOS, umbral_aprobado: APROBADO, umbral_condicionado: CONDICIONADO } = operacion.contratistas;
const fecha = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) ? String(v) : null);
const texto = (v, max) => { const s = String(v ?? '').trim(); return s ? s.slice(0, max) : null; };
const lista = (v) => (Array.isArray(v) ? v : v == null ? [] : [v]);

/** Puntaje en DECIMAL(5,2) como texto: evita flotantes en el registro. */
function calificar(cumplidos, total) {
  const puntaje = total ? Math.round((cumplidos * 10000) / total) / 100 : 0;
  const resultado = puntaje >= APROBADO ? 'aprobado' : puntaje >= CONDICIONADO ? 'condicionado' : 'rechazado';
  return { puntaje: puntaje.toFixed(2), resultado };
}

/** Cotizar en una clase inferior a la de la actividad es inconsistente. */
const claseCorrecta = (cotizada, requerida) => CLASES.indexOf(cotizada) >= CLASES.indexOf(requerida);

async function contratista(repo, empresaId, id) {
  const c = await repo.obtener('contratista', id);
  if (!c || c.empresa_id !== empresaId) throw error(404, 'Contratista no encontrado');
  return c;
}

function datos(d) {
  const c = {
    nit: texto(d.nit, 20), razon_social: texto(d.razon_social, 200), actividad: texto(d.actividad, 300),
    clase_riesgo: CLASES.includes(d.clase_riesgo) ? d.clase_riesgo : null, contacto_nombre: texto(d.contacto_nombre, 150),
    contacto_email: texto(d.contacto_email, 150), fecha_inicio: fecha(d.fecha_inicio), fecha_fin: fecha(d.fecha_fin),
  };
  if (!c.nit || !/^\d{5,15}$/.test(c.nit.replace(/[.\-\s]/g, ''))) throw error(422, 'NIT invalido');
  c.nit = c.nit.replace(/[.\-\s]/g, '');
  if (!c.razon_social || !c.actividad || !c.clase_riesgo) throw error(422, 'Razon social, actividad y clase de riesgo son obligatorias');
  if (c.contacto_email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(c.contacto_email)) throw error(422, 'Correo invalido');
  if (c.fecha_inicio && c.fecha_fin && c.fecha_fin < c.fecha_inicio) throw error(422, 'La fecha fin es anterior al inicio');
  return c;
}

async function crear(repo, empresaId, d) {
  const c = datos(d);
  const [dup] = await repo.listar('contratista', { empresa_id: empresaId, nit: c.nit });
  if (dup) throw error(409, 'Ya existe un contratista con ese NIT');
  return repo.insertar('contratista', { empresa_id: empresaId, ...c });
}

async function editar(repo, empresaId, id, d) {
  const actual = await contratista(repo, empresaId, id);
  const c = datos(d);
  if (c.nit !== actual.nit) throw error(422, 'El NIT no se modifica');
  await repo.actualizar('contratista', id, c, { accion: 'editar' });
}

async function inactivar(repo, empresaId, id) {
  const c = await contratista(repo, empresaId, id);
  if (c.estado === 'inactivo') throw error(409, 'Ya esta inactivo');
  await repo.actualizar('contratista', id, { estado: 'inactivo' }, { accion: 'inactivar' });
}

/** Evaluacion de seleccion o desempeno: el resultado define el estado del contratista. */
async function evaluar(repo, empresaId, id, d, hoy = hoyBogota()) {
  const c = await contratista(repo, empresaId, id);
  if (c.estado === 'inactivo') throw error(409, 'El contratista esta inactivo');
  if (!['seleccion', 'desempeno'].includes(d.tipo)) throw error(422, 'Tipo de evaluacion invalido');
  const f = fecha(d.fecha) || hoy;
  if (f > hoy) throw error(422, 'La fecha no puede ser futura');
  const marcados = new Set(lista(d.cumple).map(String));
  const respuestas = CRITERIOS.map((criterio, i) => ({ criterio, cumple: marcados.has(String(i)) }));
  const { puntaje, resultado } = calificar(respuestas.filter((x) => x.cumple).length, respuestas.length);
  await repo.transaccion(async (tx) => {
    await tx.insertar('contratista_evaluacion', {
      contratista_id: id, tipo: d.tipo, fecha: f, respuestas, puntaje, resultado, observacion: texto(d.observacion, 1000),
    });
    await tx.actualizar('contratista', id, { estado: resultado }, { accion: `evaluar_${d.tipo}` });
  });
  return { puntaje, resultado };
}

async function vincularTrabajador(repo, empresaId, id, d, hoy = hoyBogota()) {
  const c = await contratista(repo, empresaId, id);
  if (!['aprobado', 'condicionado'].includes(c.estado)) throw error(409, 'Solo un contratista aprobado o condicionado puede ingresar trabajadores');
  const personaId = Number.parseInt(d.persona_id, 10);
  const [v] = await repo.listar('vinculacion', { empresa_id: empresaId, persona_id: personaId, estado: 'activa' });
  if (!v || v.tipo !== 'contratista') throw error(422, 'Registre primero a la persona en Personas (vinculacion tipo contratista)');
  const [ya] = await repo.listar('contratista_trabajador', { contratista_id: id, persona_id: personaId, estado: 'activo' });
  if (ya) throw error(409, 'La persona ya esta vinculada a este contratista');
  const f = fecha(d.fecha_ingreso) || hoy;
  return repo.insertar('contratista_trabajador', { contratista_id: id, persona_id: personaId, fecha_ingreso: f });
}

async function retirarTrabajador(repo, empresaId, id, trabajadorId, hoy = hoyBogota()) {
  await contratista(repo, empresaId, id);
  const t = await repo.obtener('contratista_trabajador', trabajadorId);
  if (!t || t.contratista_id !== id) throw error(404, 'Trabajador no encontrado');
  if (t.estado !== 'activo') throw error(409, 'Ya fue retirado');
  await repo.actualizar('contratista_trabajador', trabajadorId, { estado: 'retirado', fecha_retiro: hoy }, { accion: 'retirar' });
}

async function verificarSgrl(repo, empresaId, id, d, hoy = hoyBogota()) {
  const c = await contratista(repo, empresaId, id);
  const personaId = Number.parseInt(d.persona_id, 10);
  const [t] = await repo.listar('contratista_trabajador', { contratista_id: id, persona_id: personaId, estado: 'activo' });
  if (!t) throw error(422, 'La persona no es trabajador activo del contratista');
  const v = {
    periodo: /^\d{4}-(0[1-9]|1[0-2])$/.test(String(d.periodo || '')) ? d.periodo : null, planilla: texto(d.planilla, 30), arl: texto(d.arl, 100),
    fecha_pago: fecha(d.fecha_pago), clase_cotizada: CLASES.includes(d.clase_cotizada) ? d.clase_cotizada : null,
  };
  if (!v.periodo || !v.planilla || !v.arl || !v.fecha_pago || !v.clase_cotizada) throw error(422, 'Periodo, planilla, ARL, fecha de pago y clase cotizada son obligatorios');
  if (v.fecha_pago > hoy) throw error(422, 'La fecha de pago no puede ser futura');
  const correcta = claseCorrecta(v.clase_cotizada, c.clase_riesgo);
  const observacion = correcta ? texto(d.observacion, 500) : `Cotiza en clase ${v.clase_cotizada} y la actividad es clase ${c.clase_riesgo}`;
  await repo.insertar('sgrl_verificacion', { contratista_id: id, persona_id: personaId, ...v, resultado: correcta ? 'conforme' : 'inconsistente', observacion });
  return correcta ? { resultado: 'conforme' } : { resultado: 'inconsistente', tipoAviso: 'warning' };
}

async function listar(repo, empresaId) {
  return repo.consultar(
    `SELECT c.*,
            (SELECT COUNT(*) FROM contratista_trabajador t WHERE t.tenant_id = {tenant} AND t.contratista_id = c.id AND t.estado = 'activo') AS trabajadores,
            (SELECT MAX(e.fecha) FROM contratista_evaluacion e WHERE e.tenant_id = {tenant} AND e.contratista_id = c.id) AS ultima_evaluacion,
            (SELECT MAX(s.periodo) FROM sgrl_verificacion s WHERE s.tenant_id = {tenant} AND s.contratista_id = c.id) AS ultimo_periodo,
            (SELECT COUNT(*) FROM sgrl_verificacion s WHERE s.tenant_id = {tenant} AND s.contratista_id = c.id AND s.resultado = 'inconsistente'
                AND s.periodo = (SELECT MAX(s2.periodo) FROM sgrl_verificacion s2 WHERE s2.tenant_id = {tenant} AND s2.contratista_id = c.id)) AS inconsistencias
       FROM contratista c WHERE c.tenant_id = {tenant} AND c.empresa_id = ? ORDER BY c.estado = 'inactivo', c.razon_social`, [empresaId],
  );
}

async function detalle(repo, empresaId, id, hoy = hoyBogota()) {
  const c = await contratista(repo, empresaId, id);
  const [evaluaciones, trabajadores, verificaciones] = await Promise.all([
    repo.consultar('SELECT * FROM contratista_evaluacion WHERE tenant_id = {tenant} AND contratista_id = ? ORDER BY fecha DESC, id DESC', [id]),
    repo.consultar(
      `SELECT t.*, p.nombres, p.apellidos, p.numero_documento,
              (SELECT MAX(k.fecha_obtencion) FROM competencia k WHERE k.tenant_id = {tenant} AND k.empresa_id = ? AND k.persona_id = t.persona_id
                  AND k.tipo = 'INDUCCION' AND k.estado = 'vigente') AS induccion,
              (SELECT s.resultado FROM sgrl_verificacion s WHERE s.tenant_id = {tenant} AND s.contratista_id = t.contratista_id AND s.persona_id = t.persona_id
                ORDER BY s.periodo DESC, s.id DESC LIMIT 1) AS ultimo_sgrl,
              (SELECT s.periodo FROM sgrl_verificacion s WHERE s.tenant_id = {tenant} AND s.contratista_id = t.contratista_id AND s.persona_id = t.persona_id
                ORDER BY s.periodo DESC, s.id DESC LIMIT 1) AS periodo_sgrl
         FROM contratista_trabajador t JOIN persona p ON p.tenant_id = {tenant} AND p.id = t.persona_id
        WHERE t.tenant_id = {tenant} AND t.contratista_id = ? ORDER BY t.estado, p.apellidos`, [empresaId, id],
    ),
    repo.consultar(
      `SELECT s.*, p.nombres, p.apellidos FROM sgrl_verificacion s JOIN persona p ON p.tenant_id = {tenant} AND p.id = s.persona_id
        WHERE s.tenant_id = {tenant} AND s.contratista_id = ? ORDER BY s.periodo DESC, p.apellidos LIMIT 200`, [id],
    ),
  ]);
  const parse = (v) => (typeof v === 'string' ? JSON.parse(v) : v);
  const activos = trabajadores.filter((t) => t.estado === 'activo');
  // La planilla del mes anterior es la ultima que se puede exigir pagada.
  const periodoExigible = sumarMeses(`${hoy.slice(0, 7)}-01`, -1).slice(0, 7);
  const haceUnAnio = sumarMeses(hoy, -12);
  return {
    contratista: c,
    evaluaciones: evaluaciones.map((e) => ({ ...e, respuestas: parse(e.respuestas) })),
    trabajadores, verificaciones,
    resumen: {
      activos: activos.length,
      sinInduccion: activos.filter((t) => !t.induccion).length,
      periodoExigible,
      sinVerificacion: activos.filter((t) => !t.periodo_sgrl || t.periodo_sgrl < periodoExigible).length,
      ingresos12m: trabajadores.filter((t) => t.fecha_ingreso >= haceUnAnio).length,
      retiros12m: trabajadores.filter((t) => t.fecha_retiro && t.fecha_retiro >= haceUnAnio).length,
    },
  };
}

module.exports = {
  CLASES, CRITERIOS, calificar, claseCorrecta, crear, editar, inactivar, evaluar, vincularTrabajador, retirarTrabajador, verificarSgrl, listar, detalle,
};
