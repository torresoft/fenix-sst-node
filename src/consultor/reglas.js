// Tablero del consultor: semaforo por empresa y orden por urgencia. Puro, sin BD.
// Los plazos legales ya los decide el motor de obligaciones; aqui solo se agregan sus estados.

const NIVELES = { rojo: 0, amarillo: 1, verde: 2 };

/** Semaforo de una empresa con los motivos que lo explican (mas grave primero). */
function semaforo(f) {
  const rojo = [];
  const amarillo = [];
  if (f.obligaciones.vencidas) rojo.push(`${f.obligaciones.vencidas} obligación(es) vencida(s)`);
  if (f.eventos.graves) rojo.push(`${f.eventos.graves} AT grave o mortal sin investigar`);
  if (f.acciones.vencidas) rojo.push(`${f.acciones.vencidas} acción(es) de mejora vencida(s)`);
  if (f.documentos.vencidos) rojo.push(`${f.documentos.vencidos} documento(s) vencido(s)`);
  if (f.obligaciones.porVencer) amarillo.push(`${f.obligaciones.porVencer} obligación(es) por vencer`);
  if (f.eventos.abiertos - f.eventos.graves > 0) amarillo.push(`${f.eventos.abiertos - f.eventos.graves} evento(s) sin investigar`);
  if (f.documentos.porVencer) amarillo.push(`${f.documentos.porVencer} documento(s) por vencer`);
  if (f.reclasificacion) amarillo.push('Reclasificación 0312 pendiente de revisar');
  if (!f.matriz || f.matriz.estado !== 'vigente') amarillo.push('Sin matriz de peligros vigente');
  if (!f.autoevaluacion || f.autoevaluacion.estado !== 'cerrada') amarillo.push('Sin autoevaluación 0312 cerrada');
  const nivel = rojo.length ? 'rojo' : (amarillo.length ? 'amarillo' : 'verde');
  return { nivel, motivos: [...rojo, ...amarillo] };
}

/** Rojo primero; dentro del mismo color, mas vencidas y luego menor puntaje. */
function ordenar(filas) {
  const puntaje = (f) => (f.autoevaluacion && f.autoevaluacion.puntaje != null ? Number(f.autoevaluacion.puntaje) : -1);
  return [...filas].sort((a, b) => NIVELES[a.semaforo.nivel] - NIVELES[b.semaforo.nivel]
    || b.obligaciones.vencidas - a.obligaciones.vencidas
    || puntaje(a) - puntaje(b)
    || a.razon_social.localeCompare(b.razon_social, 'es'));
}

/** Totales de la cartera para la franja superior. */
function totales(filas) {
  const suma = (fn) => filas.reduce((t, f) => t + fn(f), 0);
  const conPuntaje = filas.filter((f) => f.autoevaluacion && f.autoevaluacion.estado === 'cerrada' && f.autoevaluacion.puntaje != null);
  return {
    empresas: filas.length,
    rojo: filas.filter((f) => f.semaforo.nivel === 'rojo').length,
    amarillo: filas.filter((f) => f.semaforo.nivel === 'amarillo').length,
    verde: filas.filter((f) => f.semaforo.nivel === 'verde').length,
    vencidas: suma((f) => f.obligaciones.vencidas),
    trabajadores: suma((f) => Number(f.trabajadores || 0)),
    // Promedio en centesimas enteras para no arrastrar error de coma flotante.
    puntajePromedio: conPuntaje.length ? Math.round(conPuntaje.reduce((t, f) => t + Math.round(Number(f.autoevaluacion.puntaje) * 100), 0) / conPuntaje.length) / 100 : null,
  };
}

module.exports = { semaforo, ordenar, totales };
