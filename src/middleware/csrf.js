// Token CSRF sincronizado por sesion. Formularios: campo _csrf. AJAX: cabecera X-CSRF-Token.
const crypto = require('crypto');

const METODOS_SEGUROS = new Set(['GET', 'HEAD', 'OPTIONS']);

function iguales(a, b) {
  const x = Buffer.from(String(a || ''));
  const y = Buffer.from(String(b || ''));
  return x.length > 0 && x.length === y.length && crypto.timingSafeEqual(x, y);
}

function csrf(req, res, next) {
  if (!req.session.csrf) req.session.csrf = crypto.randomBytes(32).toString('hex');
  res.locals.csrfToken = req.session.csrf;
  if (METODOS_SEGUROS.has(req.method)) return next();

  // multipart: el cuerpo se parsea despues (multer), por eso el token viaja en la URL del action.
  const multipart = (req.get('content-type') || '').startsWith('multipart/form-data');
  const enviado = (req.body && req.body._csrf) || req.get('x-csrf-token') || (multipart ? req.query._csrf : undefined);
  if (iguales(enviado, req.session.csrf)) return next();

  const err = new Error('Token de seguridad invalido. Recargue la pagina.');
  err.status = 403;
  return next(err);
}

module.exports = csrf;
