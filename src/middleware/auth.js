const crypto = require('crypto');
const { RepositorioTenant } = require('../db/repositorio');
const cuentas = require('../db/cuentas');

// Cada cuanto se revalidan contra la BD el estado, la clave y los roles de una sesion.
const REVALIDAR_MS = 60 * 1000;

const esAjax = (req) => req.xhr || (req.get('accept') || '').includes('application/json');

/** Huella de la clave: si cambia, las demas sesiones del usuario quedan invalidas. */
const huellaClave = (hash) => crypto.createHash('sha256').update(String(hash || '')).digest('hex').slice(0, 32);

const resumenAccesos = (accesos) => accesos.map((a) => ({ empresaId: a.empresa_id, razonSocial: a.razon_social, nit: a.nit }));

function rechazar(req, res, status, mensaje, redireccion) {
  if (esAjax(req)) return res.status(status).json({ ok: false, mensaje });
  return res.redirect(redireccion);
}

/** Revoca la sesion si el usuario se desactivo o cambio la clave; refresca roles y accesos. */
async function revalidar(req, res, next) {
  const s = req.session;
  if (!s.usuario || (s.revalidadoEn && Date.now() - s.revalidadoEn < REVALIDAR_MS)) return next();
  try {
    const u = await cuentas.estadoUsuario(s.usuario.id);
    if (!u || u.estado !== 'activo' || huellaClave(u.password_hash) !== s.usuario.huella) {
      return s.destroy(() => {
        res.clearCookie('fenix.sid');
        rechazar(req, res, 401, 'Sesion expirada', '/login');
      });
    }
    s.usuario.esSuperadmin = u.es_superadmin === 1;
    s.usuario.debeCambiarPassword = u.debe_cambiar_password === 1;
    const accesos = await cuentas.accesosDeUsuario(s.usuario.id);
    s.accesos = resumenAccesos(accesos);
    if (s.empresa) {
      const acceso = accesos.find((a) => a.empresa_id === s.empresa.id && a.tenant_id === s.empresa.tenantId);
      if (acceso) s.empresa.roles = acceso.roles;
      else delete s.empresa;
    }
    s.revalidadoEn = Date.now();
    return next();
  } catch (err) {
    return next(err);
  }
}

/** Expone usuario, empresa activa y el repositorio del tenant activo en req / res.locals. */
function contexto(req, res, next) {
  const s = req.session;
  res.locals.usuario = s.usuario || null;
  res.locals.empresaActiva = s.empresa || null;
  res.locals.accesos = s.accesos || [];
  res.locals.rutaActual = req.path;
  res.locals.aviso = s.aviso || null;
  if (s.aviso) delete s.aviso;
  // Carga diferida: comun/menu depende de comun/rutas, que depende de este modulo.
  const { menu, miga } = require('../comun/menu');
  // superadmin es un perfil de plataforma, no un rol de tenant: solo abre el grupo Plataforma del menu.
  const rolesMenu = [...((s.empresa && s.empresa.roles) || []), ...(s.usuario && s.usuario.esSuperadmin ? ['superadmin'] : [])];
  res.locals.menu = menu(rolesMenu, req.path);
  res.locals.miga = miga(req.path);

  if (s.usuario) {
    req.actor = Object.freeze({
      id: s.usuario.id, nombre: s.usuario.nombre, ip: req.ip, userAgent: req.get('user-agent'),
    });
  }
  if (s.usuario && s.empresa) {
    let repo = null;
    Object.defineProperty(req, 'repo', {
      get: () => repo || (repo = new RepositorioTenant(s.empresa.tenantId, req.actor)),
    });
  }
  next();
}

function requiereSesion(req, res, next) {
  if (!req.session.usuario) return rechazar(req, res, 401, 'Sesion expirada', '/login');
  if (req.session.usuario.debeCambiarPassword && req.path !== '/cambiar-password') {
    return rechazar(req, res, 403, 'Debe cambiar la contrasena', '/cambiar-password');
  }
  return next();
}

function requiereEmpresa(req, res, next) {
  if (!req.session.empresa) return rechazar(req, res, 409, 'Seleccione una empresa', '/seleccionar-empresa');
  return next();
}

/** Autoriza si el usuario tiene alguno de los roles en el tenant activo. */
function requiereRol(...roles) {
  return (req, res, next) => {
    const propios = (req.session.empresa && req.session.empresa.roles) || [];
    if (roles.some((r) => propios.includes(r))) return next();
    const err = new Error('No tiene permisos para esta accion');
    err.status = 403;
    return next(err);
  };
}

module.exports = { revalidar, huellaClave, resumenAccesos, contexto, requiereSesion, requiereEmpresa, requiereRol, esAjax };
