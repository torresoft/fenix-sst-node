// M12: calculo, registro y tablero de indicadores. Lo calculable sale del estado real de los modulos;
// el resto se registra manualmente. Cada cambio de valor reemplaza la medicion (no la sobrescribe).
const { consultarCatalogo } = require('../db/global');
const fechas = require('../fechas');
const { hoyBogota } = require('../fechas/calendario');
const planeacion = require('../planeacion/reglas');
const { error } = require('../comun/rutas');
const c = require('./calculo');

const texto = (v, max) => { const s = String(v ?? '').trim(); return s ? s.slice(0, max) : null; };

async function catalogo() {
  return consultarCatalogo("SELECT * FROM indicador_catalogo WHERE estado = 'activo' ORDER BY FIELD(tipo, 'resultado', 'estructura', 'proceso'), nombre");
}

const binario = (codigo, periodo, ok, metodo) => ({ codigo, periodo, numerador: ok ? 1 : 0, denominador: 1, valor: ok ? 100 : 0, metodo });
const razon = (codigo, periodo, num, den, metodo) => ({ codigo, periodo, numerador: num, denominador: den, valor: c.valor(num, den, 100), metodo });

async function existeDoc(repo, empresaId, tipo) {
  const [f] = await repo.consultar(
    "SELECT COUNT(*) AS n FROM documento_sst WHERE tenant_id = {tenant} AND empresa_id = ? AND tipo_documental = ? AND estado = 'vigente'", [empresaId, tipo],
  );
  return Number(f.n) > 0;
}

/** Calcula los indicadores del mes (y los anuales al corte del mes). */
async function calcularValores(repo, empresaId, anio, mes) {
  const periodo = `${anio}-${String(mes).padStart(2, '0')}`;
  const fin = c.finDeMes(anio, mes);
  const inicio = c.inicioDeMes(anio, mes);
  const [eventos, vinculaciones, incapacidades] = await Promise.all([
    repo.listar('evento', { empresa_id: empresaId }),
    repo.listar('vinculacion', { empresa_id: empresaId }),
    repo.listar('incapacidad', { empresa_id: empresaId }),
  ]);
  const cal = fechas.calendario();
  const diasProgramados = cal.diasHabiles(new Date(Date.parse(`${inicio}T00:00:00Z`) - 86400000).toISOString().slice(0, 10), fin);
  const valores = c.resultado({ eventos, vinculaciones, incapacidades, anio, mes, diasProgramados });

  // Estructura (existe / no existe al corte)
  const [plan] = await repo.listar('plan_anual', { empresa_id: empresaId, vigencia_anio: anio });
  const objetivos = plan ? await repo.listar('plan_objetivo', { plan_id: plan.id, estado: 'activo' }) : [];
  const [matriz] = await repo.listar('matriz_riesgo', { empresa_id: empresaId, estado: 'vigente' });
  const comites = await repo.listar('comite', { empresa_id: empresaId, estado: 'vigente' });
  valores.push(
    binario('EST_POLITICA', periodo, await existeDoc(repo, empresaId, 'POLITICA_SST'), 'Politica de SST vigente en el gestor documental'),
    binario('EST_OBJETIVOS', periodo, objetivos.length > 0, 'Objetivos activos en el plan de la vigencia'),
    binario('EST_PLAN', periodo, Boolean(plan && ['aprobado', 'cerrado'].includes(plan.estado)), 'Plan de trabajo de la vigencia aprobado'),
    binario('EST_RESPONSABILIDADES', periodo, await existeDoc(repo, empresaId, 'RESPONSABILIDADES'), 'Asignacion de responsabilidades vigente'),
    binario('EST_METODO_PELIGROS', periodo, Boolean(matriz), 'Matriz de peligros vigente'),
    binario('EST_COPASST', periodo, comites.some((x) => ['copasst', 'vigia'].includes(x.tipo)), 'COPASST o Vigia con periodo vigente'),
    binario('EST_EMERGENCIAS', periodo, await existeDoc(repo, empresaId, 'PLAN_EMERGENCIAS'), 'Plan de emergencias vigente'),
    binario('EST_CAPACITACION', periodo, await existeDoc(repo, empresaId, 'PROG_CAPACITACION'), 'Programa de capacitacion vigente'),
  );

  // Proceso (ejecutado / programado al corte)
  if (plan) {
    const av = planeacion.avance(await repo.listar('plan_actividad', { plan_id: plan.id }), fin);
    valores.push(razon('PRO_PLAN_TRABAJO', periodo, av.ejecutadas_al_corte, av.programadas_al_corte, 'Actividades del cronograma con fecha fin al corte'));
  }
  const caps = (await repo.listar('capacitacion', { empresa_id: empresaId })).filter((k) => k.estado !== 'anulada' && k.fecha.startsWith(String(anio)) && k.fecha <= fin);
  valores.push(razon('PRO_CAPACITACION', periodo, caps.filter((k) => k.estado === 'realizada').length, caps.length, 'Capacitaciones del anio con fecha al corte'));
  if (matriz) {
    const [ctl] = await repo.consultar(
      `SELECT SUM(rc.estado = 'implementado') AS impl, SUM(rc.estado IN ('implementado','propuesto')) AS total
         FROM riesgo_control rc JOIN riesgo_item i ON i.tenant_id = {tenant} AND i.id = rc.item_id
        WHERE rc.tenant_id = {tenant} AND i.matriz_id = ? AND i.estado = 'activo'`, [matriz.id],
    );
    valores.push(razon('PRO_INTERVENCION', periodo, Number(ctl.impl || 0), Number(ctl.total || 0), 'Medidas de intervencion de la matriz vigente'));
  }
  const acciones = (await repo.listar('accion_mejora', { empresa_id: empresaId, origen: 'evento' })).filter((a) => a.estado !== 'anulada' && a.fecha_limite <= fin);
  valores.push(razon('PRO_ACCIONES', periodo, acciones.filter((a) => a.estado === 'cerrada').length, acciones.length, 'Acciones de investigaciones con fecha limite al corte'));
  const [rep] = await repo.consultar(
    `SELECT SUM(estado = 'cumplido' AND fecha_cumplimiento <= fecha_limite) AS atiempo, COUNT(*) AS total FROM obligacion_pendiente
      WHERE tenant_id = {tenant} AND empresa_id = ? AND plazo_codigo IN ('REP_AT_ARL','INV_AT') AND estado <> 'anulado'
        AND YEAR(fecha_limite) = ? AND fecha_limite <= ?`, [empresaId, anio, fin],
  );
  valores.push(razon('PRO_REPORTE', periodo, Number(rep.atiempo || 0), Number(rep.total || 0), 'Reportes (2 dias habiles) e investigaciones (15 dias) cumplidos a tiempo'));
  const evals = (await repo.listar('evaluacion_medica', { empresa_id: empresaId })).filter((e) => e.estado !== 'anulada' && e.fecha_orden.startsWith(String(anio)) && e.fecha_orden <= fin);
  valores.push(razon('PRO_COND_SALUD', periodo, evals.filter((e) => e.estado === 'con_concepto').length, evals.length, 'Evaluaciones medicas ordenadas con concepto'));
  return valores;
}

const igual = (a, b) => ['numerador', 'denominador', 'valor'].every((k) => (a[k] == null ? null : Number(a[k])) === (b[k] == null ? null : Number(b[k])));

async function guardarMedicion(tx, empresaId, m, origen, observacion = null) {
  const [previa] = await tx.listar('indicador_medicion', { empresa_id: empresaId, indicador_codigo: m.codigo, periodo: m.periodo, estado: 'vigente' });
  if (previa && igual(previa, m) && previa.origen === origen) return false;
  if (previa) await tx.actualizar('indicador_medicion', previa.id, { estado: 'reemplazada' }, { auditar: false });
  await tx.insertar('indicador_medicion', {
    empresa_id: empresaId, indicador_codigo: m.codigo, periodo: m.periodo, numerador: m.numerador, denominador: m.denominador,
    valor: m.valor, metodo: texto(m.metodo, 500), origen, observacion,
  }, { auditar: false });
  return true;
}

/** Calcula y persiste; solo crea mediciones cuando el valor cambio. Devuelve cuantas cambiaron. */
async function calcular(repo, empresaId, anio, mes) {
  const valores = await calcularValores(repo, empresaId, anio, mes);
  let n = 0;
  await repo.transaccion(async (tx) => {
    for (const m of valores) if (await guardarMedicion(tx, empresaId, m, 'calculado')) n += 1;
  });
  if (n) await repo.auditar('calcular_indicadores', 'empresa', empresaId, null, { periodo: `${anio}-${mes}`, cambios: n });
  return n;
}

async function registrarManual(repo, empresaId, d) {
  const [ind] = await consultarCatalogo('SELECT * FROM indicador_catalogo WHERE codigo = ?', [String(d.indicador_codigo || '')]);
  if (!ind) throw error(422, 'Indicador invalido');
  const periodo = String(d.periodo || '');
  if (!/^(19|20)\d{2}(-(0[1-9]|1[0-2]))?$/.test(periodo)) throw error(422, 'Periodo invalido (AAAA-MM o AAAA)');
  const num = Number(d.numerador);
  const den = Number(d.denominador);
  if (!(num >= 0 && num <= 1e12) || !(den > 0 && den <= 1e12)) throw error(422, 'Numerador y denominador invalidos');
  const factor = ind.factor ? Number(ind.factor) : 100;
  await repo.transaccion((tx) => guardarMedicion(tx, empresaId, {
    codigo: ind.codigo, periodo, numerador: num, denominador: den, valor: c.valor(num, den, factor), metodo: texto(d.metodo, 500) || 'Registro manual',
  }, 'manual', texto(d.observacion, 500)));
}

async function guardarFicha(repo, empresaId, d) {
  const [ind] = await consultarCatalogo('SELECT codigo FROM indicador_catalogo WHERE codigo = ?', [String(d.indicador_codigo || '')]);
  if (!ind) throw error(422, 'Indicador invalido');
  const meta = d.meta === '' || d.meta == null ? null : Number(d.meta);
  if (meta != null && !Number.isFinite(meta)) throw error(422, 'Meta invalida');
  const fila = {
    meta, sentido: d.sentido === 'menor' ? 'menor' : 'mayor', responsable: texto(d.responsable, 150),
    fuente: texto(d.fuente, 255), observacion: texto(d.observacion, 500),
  };
  const [previa] = await repo.listar('indicador_ficha', { empresa_id: empresaId, indicador_codigo: ind.codigo });
  if (previa) await repo.actualizar('indicador_ficha', previa.id, fila, { accion: 'ficha' });
  else await repo.insertar('indicador_ficha', { empresa_id: empresaId, indicador_codigo: ind.codigo, ...fila });
}

/** Tablero: ultimo valor por indicador, serie mensual del anio y cumplimiento frente a la meta. */
async function tablero(repo, empresaId, anio) {
  const [cat, mediciones, fichas] = await Promise.all([
    catalogo(),
    repo.consultar(
      `SELECT indicador_codigo, periodo, numerador, denominador, valor, metodo, origen FROM indicador_medicion
        WHERE tenant_id = {tenant} AND empresa_id = ? AND estado = 'vigente' AND periodo LIKE ? ORDER BY periodo`, [empresaId, `${anio}%`],
    ),
    repo.listar('indicador_ficha', { empresa_id: empresaId, estado: 'activo' }),
  ]);
  const meses = Array.from({ length: 12 }, (_, i) => `${anio}-${String(i + 1).padStart(2, '0')}`);
  return cat.map((ind) => {
    const propias = mediciones.filter((m) => m.indicador_codigo === ind.codigo);
    const ultima = propias[propias.length - 1] || null;
    const ficha = fichas.find((f) => f.indicador_codigo === ind.codigo) || null;
    return {
      ...ind, ultima, ficha,
      serie: meses.map((m) => (propias.find((x) => x.periodo === m) || {}).valor ?? null),
      cumple: c.cumpleMeta(ultima && ultima.valor, ficha && ficha.meta, ficha ? ficha.sentido : 'mayor'),
    };
  });
}

module.exports = { catalogo, calcularValores, calcular, registrarManual, guardarFicha, tablero };
