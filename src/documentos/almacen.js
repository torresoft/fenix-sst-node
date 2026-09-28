// Almacen de archivos del gestor documental, fuera de public/. Ruta: <tenant>/<empresa>/<sha256><ext>.
// El nombre por hash deduplica y hace evidente cualquier alteracion.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const config = require('../config');

function absoluta(relativa) {
  const destino = path.resolve(config.almacen.dir, relativa);
  if (!destino.startsWith(config.almacen.dir + path.sep)) throw new Error('Ruta de archivo invalida');
  return destino;
}

async function guardar(tenantId, empresaId, buffer, hash, ext) {
  const relativa = path.posix.join(String(tenantId), String(empresaId), `${hash}${ext}`);
  const destino = absoluta(relativa);
  await fs.promises.mkdir(path.dirname(destino), { recursive: true });
  try {
    await fs.promises.writeFile(destino, buffer, { flag: 'wx' });
  } catch (err) {
    if (err.code !== 'EEXIST') throw err;
  }
  return relativa;
}

/** SHA-256 del archivo tal como esta hoy en disco (null si no existe). */
function hashEnDisco(relativa) {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash('sha256');
    fs.createReadStream(absoluta(relativa))
      .on('error', (err) => (err.code === 'ENOENT' ? resolve(null) : reject(err)))
      .on('data', (d) => h.update(d))
      .on('end', () => resolve(h.digest('hex')));
  });
}

module.exports = { guardar, absoluta, hashEnDisco };
