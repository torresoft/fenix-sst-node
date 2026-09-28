// Calendario activo de la aplicacion, cargado desde la tabla festivo (catalogo en BD).
const path = require('path');
const { Calendario, ErrorCobertura, hoyBogota } = require('./calendario');

let activo = null;

async function inicializar() {
  const { festivosActivos } = require('../db/global');
  activo = new Calendario(await festivosActivos());
  return activo;
}

/** Calendario desde data/festivos_co.json (pruebas y scripts sin BD). */
function desdeJson(ruta = path.join(__dirname, '..', '..', 'data', 'festivos_co.json')) {
  const { festivos } = require(ruta);
  return new Calendario(Object.values(festivos).flat().map((f) => f.fecha));
}

function calendario() {
  if (!activo) throw new Error('Calendario de festivos no inicializado');
  return activo;
}

module.exports = {
  inicializar,
  desdeJson,
  calendario,
  hoyBogota,
  ErrorCobertura,
  esHabil: (f) => calendario().esHabil(f),
  diasHabiles: (desde, hasta) => calendario().diasHabiles(desde, hasta),
  sumarPlazo: (base, cantidad, tipo, opciones) => calendario().sumarPlazo(base, cantidad, tipo, opciones),
  estadoPlazo: (limite, hoy, diasAlerta, cumplimiento) => calendario().estadoPlazo(limite, hoy, diasAlerta, cumplimiento),
};
