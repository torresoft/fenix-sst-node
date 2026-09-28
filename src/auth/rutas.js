const express = require('express');
const rateLimit = require('express-rate-limit');
const cuentas = require('../db/cuentas');
const password = require('./password');
const { requiereSesion, huellaClave, resumenAccesos } = require('../middleware/auth');

const router = express.Router();
const { ROLES_VER } = require('../comun/rutas');

// Mismo mensaje y costo para usuario inexistente, clave errada o cuenta bloqueada: no revela cuentas.
const FALLO_LOGIN = 'Credenciales inv&aacute;lidas o cuenta bloqueada temporalmente. Intente de nuevo m&aacute;s tarde.';
const limiteLogin = rateLimit({ windowMs: 15 * 60 * 1000, limit: 20, standardHeaders: true, legacyHeaders: false });

const actorDe = (req, usuario) => ({
  id: usuario ? usuario.id : null,
  nombre: usuario ? `${usuario.nombres} ${usuario.apellidos}` : 'desconocido',
  ip: req.ip,
  userAgent: req.get('user-agent'),
});

function regenerar(req) {
  return new Promise((resolve, reject) => req.session.regenerate((err) => (err ? reject(err) : resolve())));
}

function activarEmpresa(req, acceso) {
  req.session.empresa = {
    tenantId: acceso.tenant_id,
    id: acceso.empresa_id,
    razonSocial: acceso.razon_social,
    nit: acceso.nit,
    roles: acceso.roles,
  };
}

router.get('/login', (req, res) => {
  if (req.session.usuario) return res.redirect('/');
  return res.render('auth/login', { error: null, email: '' });
});

router.post('/login', limiteLogin, async (req, res, next) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const clave = String(req.body.password || '');
  const fallo = (mensaje) => res.status(401).render('auth/login', { error: mensaje, email });

  try {
    const usuario = email ? await cuentas.buscarUsuarioPorEmail(email) : null;
    if (!usuario || usuario.estado !== 'activo') {
      await password.verificarSenuelo(clave);
      await cuentas.registrarAuditoria({ actor: actorDe(req, null), accion: 'login_fallido', entidad: 'usuario', despues: { email } });
      return fallo(FALLO_LOGIN);
    }
    if (usuario.bloqueado) {
      await cuentas.registrarAuditoria({ actor: actorDe(req, usuario), accion: 'login_bloqueado', entidad: 'usuario', entidadId: usuario.id });
      await password.verificarSenuelo(clave);
      return fallo(FALLO_LOGIN);
    }
    if (!(await password.verificar(clave, usuario.password_hash))) {
      await cuentas.registrarFalloLogin(usuario.id);
      await cuentas.registrarAuditoria({ actor: actorDe(req, usuario), accion: 'login_fallido', entidad: 'usuario', entidadId: usuario.id });
      return fallo(FALLO_LOGIN);
    }

    await cuentas.registrarLoginExitoso(usuario.id);
    const accesos = await cuentas.accesosDeUsuario(usuario.id);
    await regenerar(req);
    req.session.usuario = {
      id: usuario.id,
      nombre: `${usuario.nombres} ${usuario.apellidos}`,
      email: usuario.email,
      documento: `${usuario.tipo_documento} ${usuario.numero_documento}`,
      esSuperadmin: usuario.es_superadmin === 1,
      debeCambiarPassword: usuario.debe_cambiar_password === 1,
      huella: huellaClave(usuario.password_hash),
    };
    req.session.revalidadoEn = Date.now();
    req.session.accesos = resumenAccesos(accesos);
    await cuentas.registrarAuditoria({ actor: actorDe(req, usuario), accion: 'login', entidad: 'usuario', entidadId: usuario.id });

    if (accesos.length === 1) {
      activarEmpresa(req, accesos[0]);
      await cuentas.registrarAuditoria({
        tenantId: accesos[0].tenant_id, actor: actorDe(req, usuario), accion: 'cambiar_empresa',
        entidad: 'empresa', entidadId: accesos[0].empresa_id,
      });
      return res.redirect('/');
    }
    if (!accesos.length && req.session.usuario.esSuperadmin) return res.redirect('/plataforma');
    // Con varias empresas y rol SST (consultor), entra al tablero de su cartera.
    if (accesos.some((a) => a.roles.some((r) => ROLES_VER.includes(r)))) return res.redirect('/mis-empresas');
    return res.redirect('/seleccionar-empresa');
  } catch (err) {
    return next(err);
  }
});

router.post('/logout', requiereSesion, async (req, res, next) => {
  try {
    await cuentas.registrarAuditoria({
      tenantId: req.session.empresa ? req.session.empresa.tenantId : null,
      actor: req.actor, accion: 'logout', entidad: 'usuario', entidadId: req.session.usuario.id,
    });
    req.session.destroy(() => {
      res.clearCookie('fenix.sid');
      res.redirect('/login');
    });
  } catch (err) {
    next(err);
  }
});

router.get('/seleccionar-empresa', requiereSesion, (req, res) => {
  res.render('auth/seleccionar-empresa', { titulo: 'Seleccionar empresa' });
});

// Cambio de empresa activa sin cerrar sesion (perfil consultor). Se valida contra la BD, no contra la sesion.
router.post('/empresa-activa', requiereSesion, async (req, res, next) => {
  try {
    const empresaId = Number.parseInt(req.body.empresa_id, 10);
    const accesos = await cuentas.accesosDeUsuario(req.session.usuario.id);
    const acceso = accesos.find((a) => a.empresa_id === empresaId);
    if (!acceso) {
      const err = new Error('No tiene acceso a esa empresa');
      err.status = 403;
      throw err;
    }
    const anterior = req.session.empresa || null;
    activarEmpresa(req, acceso);
    req.session.accesos = resumenAccesos(accesos);
    await cuentas.registrarAuditoria({
      tenantId: acceso.tenant_id, actor: req.actor, accion: 'cambiar_empresa', entidad: 'empresa', entidadId: empresaId,
      antes: anterior ? { tenant_id: anterior.tenantId, empresa_id: anterior.id } : null,
    });
    // Destino interno opcional (p. ej. desde el tablero del consultor directo a un modulo).
    const destino = String(req.body.destino || '');
    res.redirect(/^\/[a-z-]+(\/\d+)?$/.test(destino) ? destino : '/');
  } catch (err) {
    next(err);
  }
});

router.get('/cambiar-password', requiereSesion, (req, res) => {
  res.render('auth/cambiar-password', { titulo: 'Cambiar contrase&ntilde;a', error: null });
});

router.post('/cambiar-password', requiereSesion, limiteLogin, async (req, res, next) => {
  const [actual, nueva, confirmacion] = ['actual', 'nueva', 'confirmacion'].map((k) => (typeof req.body[k] === 'string' ? req.body[k] : ''));
  const fallo = (error) => res.status(422).render('auth/cambiar-password', { titulo: 'Cambiar contrase&ntilde;a', error });
  try {
    if (nueva.length < 10) return fallo('La nueva contrase&ntilde;a debe tener al menos 10 caracteres.');
    if (nueva !== confirmacion) return fallo('La confirmaci&oacute;n no coincide.');
    if (nueva === actual) return fallo('La nueva contrase&ntilde;a debe ser distinta a la actual.');
    const hashActual = await cuentas.obtenerPasswordHash(req.session.usuario.id);
    if (!hashActual || !(await password.verificar(actual, hashActual))) return fallo('La contrase&ntilde;a actual no es correcta.');

    const hashNuevo = await password.hashear(nueva);
    await cuentas.cambiarPassword(req.session.usuario.id, hashNuevo, req.actor);
    // Sesion nueva: las demas del usuario caen al revalidar por la huella de la clave.
    const { usuario, accesos, empresa } = req.session;
    await regenerar(req);
    Object.assign(req.session, { usuario: { ...usuario, debeCambiarPassword: false, huella: huellaClave(hashNuevo) }, accesos, empresa, revalidadoEn: Date.now() });
    return res.redirect(empresa ? '/' : '/seleccionar-empresa');
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
