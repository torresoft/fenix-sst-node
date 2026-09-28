// Diferencias del catalogo normativo -> boletines. Puro, sin BD.

/**
 * @param {Map<string,string>} antes codigo -> estado_vigencia previo
 * @param {Array<{codigo, estado_vigencia, objeto, derogada_por}>} despues normas tras la carga
 */
function diffNormas(antes, despues) {
  if (antes.size === 0) return [];
  const boletines = [];
  for (const n of despues) {
    const previo = antes.get(n.codigo);
    if (previo === undefined) {
      boletines.push({
        norma_codigo: n.codigo, tipo_cambio: 'nueva', estado_anterior: null, estado_nuevo: n.estado_vigencia,
        detalle: String(n.objeto || '').slice(0, 500),
      });
    } else if (previo !== n.estado_vigencia) {
      const reemplazo = n.derogada_por ? ` Reemplazo: ${n.derogada_por}.` : '';
      boletines.push({
        norma_codigo: n.codigo, tipo_cambio: 'cambio_estado', estado_anterior: previo, estado_nuevo: n.estado_vigencia,
        detalle: `Cambia de ${previo} a ${n.estado_vigencia}.${reemplazo}`.slice(0, 500),
      });
    }
  }
  return boletines;
}

/**
 * Motivos por los que un boletin afecta a una empresa; null si no la afecta.
 * @param {object} ctx { aplicaPerfil, enMatriz, documentos: number[] }
 */
function motivoAfectacion(boletin, ctx) {
  const motivos = [];
  // Una norma nueva o que entra en vigencia solo importa si aplica al perfil.
  if (ctx.aplicaPerfil) motivos.push('aplica_perfil');
  if (ctx.enMatriz) motivos.push('en_matriz');
  if (ctx.documentos.length) motivos.push('citada_en_documentos');
  if (!motivos.length) return null;
  return { motivos, documentos: ctx.documentos, tipo_cambio: boletin.tipo_cambio };
}

module.exports = { diffNormas, motivoAfectacion };
