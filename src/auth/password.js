// Hash de contrasenas con scrypt (nativo de Node). Formato: scrypt$N$r$p$salt$hash
const crypto = require('crypto');

const N = 16384;
const R = 8;
const P = 1;
const LARGO = 64;

function derivar(password, salt, n, r, p) {
  return new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, LARGO, { N: n, r, p, maxmem: 64 * 1024 * 1024 }, (err, clave) => (err ? reject(err) : resolve(clave)));
  });
}

async function hashear(password) {
  if (typeof password !== 'string' || password.length < 10) throw new Error('La contrasena debe tener al menos 10 caracteres');
  const salt = crypto.randomBytes(16);
  const clave = await derivar(password, salt, N, R, P);
  return ['scrypt', N, R, P, salt.toString('base64'), clave.toString('base64')].join('$');
}

async function verificar(password, almacenado) {
  const partes = String(almacenado || '').split('$');
  if (partes.length !== 6 || partes[0] !== 'scrypt') return false;
  const [, n, r, p, salt, hash] = partes;
  const esperado = Buffer.from(hash, 'base64');
  const clave = await derivar(String(password), Buffer.from(salt, 'base64'), Number(n), Number(r), Number(p));
  return clave.length === esperado.length && crypto.timingSafeEqual(clave, esperado);
}

// Hash de referencia para igualar tiempos cuando el usuario no existe.
let hashSenuelo = null;
async function verificarSenuelo(password) {
  if (!hashSenuelo) hashSenuelo = await hashear('senuelo-no-valido-0000');
  await verificar(password, hashSenuelo);
  return false;
}

module.exports = { hashear, verificar, verificarSenuelo };
