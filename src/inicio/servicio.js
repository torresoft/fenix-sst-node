// Tablero de inicio: lo que requiere atencion, agrupado por modulo, desde el motor de plazos y la CAPA.
const { modulos } = require('../../data/modulos.json');
const { hoyBogota } = require('../fechas/calendario');

const RUTA_MODULO = {
  M01: '/empresa', M02: '/personas', M03: '/documentos', M04: '/matriz-legal', M05: '/peligros', M06: '/planeacion', M07: '/formacion',
  M08: '/eventos', M09: '/salud', M10: '/comites', M11: '/autoevaluacion', M12: '/indicadores', M13: '/emergencias', M14: '/inspecciones',
  M15: '/permisos', M16: '/contratistas', M17: '/convivencia', M18: '/pesv',
};
// La entidad de origen manda sobre el modulo del catalogo cuando es mas precisa.
const RUTA_ENTIDAD = {
  evento: (id) => `/eventos/${id}`, documento_sst: (id) => `/documentos/${id}`, producto_quimico: () => '/quimicos', vehiculo: () => '/pesv?tab=vehiculos',
  conductor: () => '/pesv?tab=conductores', equipo_emergencia: () => '/emergencias?tab=equipos', queja_convivencia: (id) => `/convivencia/quejas/${id}`,
  evaluacion_medica: () => '/salud', competencia: () => '/formacion', comite: () => '/comites',
};
const NOMBRE_MODULO = Object.fromEntries(modulos.map((m) => [m.codigo, m.nombre]));

async function tablero(repo, empresaId, usuarioId, hoy = hoyBogota()) {
  const [obligaciones, [acciones], [autoeval], [firmas]] = await Promise.all([
    repo.consultar(
      `SELECT o.id, o.plazo_codigo, o.descripcion, o.fecha_limite, o.estado, o.severidad, o.entidad_origen_tipo, o.entidad_origen_id,
              COALESCE(p.modulo, v.modulo) AS modulo
         FROM obligacion_pendiente o
         LEFT JOIN plazo_legal p ON p.codigo = o.plazo_codigo
         LEFT JOIN vencimiento_recurrente v ON v.codigo = o.plazo_codigo
        WHERE o.tenant_id = {tenant} AND o.empresa_id = ? AND o.estado IN ('en_termino','por_vencer','vencido')
        ORDER BY o.fecha_limite`, [empresaId],
    ),
    repo.consultar(
      `SELECT SUM(estado = 'abierta') AS abiertas, SUM(estado = 'abierta' AND fecha_limite < ?) AS vencidas
         FROM accion_mejora WHERE tenant_id = {tenant} AND empresa_id = ?`, [hoy, empresaId],
    ),
    repo.consultar(
      `SELECT id, vigencia_anio, estado, puntaje, valoracion FROM autoevaluacion WHERE tenant_id = {tenant} AND empresa_id = ?
        ORDER BY vigencia_anio DESC, id DESC LIMIT 1`, [empresaId],
    ),
    repo.consultar(
      `SELECT COUNT(*) AS n FROM firma_solicitud s JOIN documento_sst d ON d.tenant_id = {tenant} AND d.id = s.documento_id
        WHERE s.tenant_id = {tenant} AND s.usuario_id = ? AND s.estado = 'pendiente' AND d.estado = 'en_firma'`, [usuarioId],
    ),
  ]);
  const conRuta = obligaciones.map((o) => {
    const porEntidad = RUTA_ENTIDAD[o.entidad_origen_tipo];
    return { ...o, ruta: porEntidad ? porEntidad(o.entidad_origen_id) : (RUTA_MODULO[o.modulo] || '/obligaciones') };
  });
  const grupos = new Map();
  for (const o of conRuta.filter((x) => x.estado !== 'en_termino')) {
    const k = o.modulo || 'otros';
    if (!grupos.has(k)) grupos.set(k, { modulo: k, nombre: NOMBRE_MODULO[k] || 'Otros', ruta: RUTA_MODULO[k] || '/obligaciones', vencidas: 0, porVencer: 0, items: [] });
    const g = grupos.get(k);
    if (o.estado === 'vencido') g.vencidas += 1; else g.porVencer += 1;
    g.items.push(o);
  }
  return {
    atencion: [...grupos.values()].sort((a, b) => b.vencidas - a.vencidas || b.porVencer - a.porVencer),
    proximos: conRuta.filter((o) => o.estado === 'en_termino').slice(0, 8),
    resumen: {
      vencidas: conRuta.filter((o) => o.estado === 'vencido').length,
      porVencer: conRuta.filter((o) => o.estado === 'por_vencer').length,
      accionesAbiertas: Number(acciones.abiertas || 0),
      accionesVencidas: Number(acciones.vencidas || 0),
      firmas: Number(firmas.n),
      autoevaluacion: autoeval || null,
    },
  };
}

module.exports = { tablero, RUTA_MODULO };
