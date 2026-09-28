const path = require('path');
const express = require('express');
const session = require('express-session');
const helmet = require('helmet');
const config = require('./config');
const { crearStore } = require('./db/sesion-store');
const csrf = require('./middleware/csrf');
const { revalidar, contexto, esAjax } = require('./middleware/auth');

const app = express();
const raiz = path.join(__dirname, '..');
const adminlte = path.join(raiz, 'node_modules', 'admin-lte');

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.locals.fh = require('./fechas/calendario').textoBogota;
app.locals.textoPlano = require('./comun/html').textoPlano;
app.locals.pesos = require('./comun/html').pesos;
app.set('trust proxy', 'loopback');
app.disable('x-powered-by');

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'"],
      imgSrc: ["'self'", 'data:'],
      fontSrc: ["'self'"],
      formAction: ["'self'"],
      frameAncestors: ["'none'"],
    },
  },
}));

const estatico = (dir) => express.static(dir, { maxAge: config.produccion ? '7d' : 0, index: false });
app.use('/vendor/adminlte', estatico(path.join(adminlte, 'dist')));
app.use('/vendor/jquery', estatico(path.join(adminlte, 'plugins', 'jquery')));
app.use('/vendor/bootstrap', estatico(path.join(adminlte, 'plugins', 'bootstrap')));
app.use('/vendor/fontawesome', estatico(path.join(adminlte, 'plugins', 'fontawesome-free')));
app.use(estatico(path.join(raiz, 'public')));

app.use(express.urlencoded({ extended: false, limit: '1mb' }));
app.use(express.json({ limit: '1mb' }));

app.use(session({
  name: 'fenix.sid',
  secret: config.sesion.secreto,
  store: crearStore(),
  resave: false,
  saveUninitialized: false,
  rolling: true,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.produccion,
    maxAge: config.sesion.horas * 3600 * 1000,
  },
}));

app.use(csrf);
app.use(revalidar);
app.use(contexto);
// Paginas con sesion: el navegador no las guarda (boton atras tras logout en equipos compartidos).
app.use((req, res, next) => {
  if (req.session.usuario) res.set('Cache-Control', 'no-store');
  next();
});

app.use(require('./auth/rutas'));
app.use(require('./rutas'));

app.use((req, res) => {
  if (esAjax(req)) return res.status(404).json({ ok: false, mensaje: 'No encontrado' });
  return res.status(404).render('error', { titulo: 'No encontrado', status: 404, mensajeHtml: 'La p&aacute;gina solicitada no existe.' });
});

// mensajeHtml solo con constantes; err.message puede traer contenido del cliente y va escapado.
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  const status = err.status || err.statusCode || 500;
  if (status >= 500) console.error(err);
  if (res.headersSent) return next(err);
  if (esAjax(req)) return res.status(status).json({ ok: false, mensaje: status >= 500 ? 'Error interno' : err.message });
  const vista = status >= 500
    ? { mensajeHtml: 'Ocurri&oacute; un error interno.' }
    : { mensaje: err.message };
  return res.status(status).render('error', { titulo: 'Error', status, ...vista });
});

module.exports = app;
