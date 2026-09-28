// Reglas puras del motor de plazos (sin BD). Todo valor normativo llega desde el catalogo.
const { normalizar } = require('../fechas/calendario');

const SEVERIDAD_ORDEN = { critica: 0, alta: 1, media: 2 };
const ESTADOS_ABIERTOS = ['en_termino', 'por_vencer', 'vencido'];

/**
 * 'evento.creado' coincide con cualquier variante; 'evento.creado[grave|mortal]' solo con esas.
 */
function coincideDisparador(disparador, evento, variante) {
  const m = /^([a-z0-9_.]+)(?:\[([^\]]+)\])?$/i.exec(String(disparador).trim());
  if (!m || m[1] !== evento) return false;
  if (!m[2]) return true;
  return variante != null && m[2].split('|').map((v) => v.trim()).includes(String(variante));
}

/**
 * Obligaciones que genera un evento.
 * @param {object[]} plazos filas activas de plazo_legal
 * @param {object} ev { evento, variante, fecha, empresaId, entidadTipo, entidadId, responsableId }
 * @param {Calendario} cal
 */
function obligacionesDeEvento(plazos, ev, cal) {
  if (!ev || !ev.evento || !ev.entidadTipo || !ev.entidadId || !ev.empresaId) {
    throw new Error('Evento incompleto: evento, empresaId, entidadTipo y entidadId son obligatorios');
  }
  const fecha = normalizar(ev.fecha);
  return plazos
    .filter((p) => coincideDisparador(p.evento_disparador, ev.evento, ev.variante))
    .map((p) => ({
      empresa_id: ev.empresaId,
      origen: 'evento',
      plazo_codigo: p.codigo,
      descripcion: p.descripcion,
      norma_codigo: p.norma_codigo,
      severidad: p.severidad,
      tipo_plazo: p.tipo,
      cantidad: Number(p.cantidad),
      dias_alerta_previa: Number(p.dias_alerta_previa),
      entidad_origen_tipo: ev.entidadTipo,
      entidad_origen_id: ev.entidadId,
      fecha_disparo: fecha,
      fecha_limite: cal.sumarPlazo(fecha, Number(p.cantidad), p.tipo, { correrSiInhabil: p.correr_si_inhabil === 1 }),
      responsable_id: ev.responsableId ?? null,
    }));
}

/** Fecha de vencimiento de un elemento recurrente a partir de su fecha base. */
function fechaVencimiento(venc, fechaBase, cal) {
  const base = normalizar(fechaBase);
  if (venc.mes_dia_limite) {
    if (!/^\d{2}-\d{2}$/.test(venc.mes_dia_limite)) throw new Error(`mes_dia_limite invalido en ${venc.codigo}`);
    let anio = Number(base.slice(0, 4));
    if (`${anio}-${venc.mes_dia_limite}` <= base) anio += 1;
    return normalizar(`${anio}-${venc.mes_dia_limite}`);
  }
  const cada = Number(venc.cada);
  if (venc.unidad === 'anio') return cal.sumarPlazo(base, cada * 12, 'mes');
  if (venc.unidad === 'mes') return cal.sumarPlazo(base, cada, 'mes');
  if (venc.unidad === 'dia') return cal.sumarPlazo(base, cada, 'calendario');
  throw new Error(`Unidad de vencimiento desconocida: ${venc.unidad}`);
}

/**
 * Obligacion para un elemento con vigencia (comite, licencia, documento...).
 * datos: { empresaId, entidadTipo, entidadId, fechaInicio, fechaLimite?, responsableId }
 */
function obligacionDeVigencia(venc, datos, cal) {
  if (!datos.empresaId || !datos.entidadTipo || !datos.entidadId) throw new Error('Vigencia incompleta');
  const inicio = normalizar(datos.fechaInicio);
  return {
    empresa_id: datos.empresaId,
    origen: 'vencimiento',
    plazo_codigo: venc.codigo,
    descripcion: venc.descripcion,
    norma_codigo: venc.norma_codigo,
    severidad: venc.severidad,
    tipo_plazo: venc.mes_dia_limite ? 'fecha_fija' : venc.unidad,
    cantidad: venc.mes_dia_limite ? null : Number(venc.cada),
    dias_alerta_previa: Number(venc.dias_alerta_previa),
    entidad_origen_tipo: datos.entidadTipo,
    entidad_origen_id: datos.entidadId,
    fecha_disparo: inicio,
    fecha_limite: datos.fechaLimite ? normalizar(datos.fechaLimite) : fechaVencimiento(venc, inicio, cal),
    responsable_id: datos.responsableId ?? null,
  };
}

/**
 * Estado vigente de una obligacion. Cumplido y anulado son finales.
 * En plazos habiles la alerta cuenta dias habiles restantes: un plazo de 2 habiles
 * que arranca un viernes ya esta por vencer aunque falten 4 dias calendario.
 */
function estadoObligacion(ob, hoy, cal) {
  if (ob.estado === 'cumplido' || ob.estado === 'anulado') return ob.estado;
  const base = cal.estadoPlazo(ob.fecha_limite, hoy, Number(ob.dias_alerta_previa), ob.fecha_cumplimiento);
  if (base !== 'en_termino' || ob.tipo_plazo !== 'habil') return base;
  try {
    return cal.diasHabiles(hoy, ob.fecha_limite) <= Number(ob.dias_alerta_previa) ? 'por_vencer' : 'en_termino';
  } catch {
    return base;
  }
}

/** Dias restantes para mostrar: habiles si el plazo es habil, calendario en otro caso. */
function diasRestantes(ob, hoy, cal) {
  const h = normalizar(hoy);
  const limite = normalizar(ob.fecha_limite);
  if (ob.tipo_plazo === 'habil') {
    try { return { dias: cal.diasHabiles(h, limite), habiles: true }; } catch { /* fuera de cobertura: cae a calendario */ }
  }
  return { dias: Math.round((Date.parse(`${limite}T00:00:00Z`) - Date.parse(`${h}T00:00:00Z`)) / 86400000), habiles: false };
}

function compararUrgencia(a, b) {
  const orden = { vencido: 0, por_vencer: 1, en_termino: 2, cumplido: 3, anulado: 4 };
  return (orden[a.estado] - orden[b.estado])
    || (SEVERIDAD_ORDEN[a.severidad] - SEVERIDAD_ORDEN[b.severidad])
    || String(a.fecha_limite).localeCompare(String(b.fecha_limite));
}

module.exports = {
  ESTADOS_ABIERTOS, coincideDisparador, obligacionesDeEvento, fechaVencimiento, obligacionDeVigencia,
  estadoObligacion, diasRestantes, compararUrgencia,
};
