// M10: comites de la empresa activa.
const express = require('express');
const { requiereSesion, requiereEmpresa, requiereRol } = require('../middleware/auth');
const { hoyBogota } = require('../fechas/calendario');
const servicio = require('./servicio');

const router = express.Router();

const ROLES_VER = ['admin_tenant', 'responsable_sst', 'consultor_sst', 'gerente', 'auditor', 'copasst', 'convivencia'];
const ROLES_GESTIONAR = ['admin_tenant', 'responsable_sst', 'consultor_sst'];
// Sesiones, actas y compromisos: el equipo SST y el rol copasst; los del comite de convivencia solo sus
// miembros (reserva de la Res. 3461 de 2025). La conformacion es del SG-SST.
const rolesSesiones = (tipo) => (tipo === 'convivencia' ? ['convivencia'] : [...ROLES_GESTIONAR, 'copasst']);
const gestionar = requiereRol(...ROLES_GESTIONAR);
const roles = (req) => req.session.empresa.roles || [];
const entero = (v) => { const n = Number.parseInt(v, 10); return Number.isSafeInteger(n) && n > 0 ? n : null; };
const puedeSesiones = (req, tipo) => roles(req).some((x) => rolesSesiones(tipo).includes(x));
const PARAM = { comiteId: 'id', sesionId: 's', compromisoId: 'c' };

// Autoriza segun el tipo del comite al que pertenece el recurso de la URL.
const sesiones = (clave) => async (req, res, next) => {
  try {
    const tipo = await servicio.tipoComite(req.repo, req.session.empresa.id, { [clave]: entero(req.params[PARAM[clave]]) });
    if (puedeSesiones(req, tipo)) return next();
    const err = new Error('No tiene permisos para esta accion');
    err.status = 403;
    return next(err);
  } catch (err) {
    return next(err);
  }
};

// Vuelve a la pagina de origen solo si es una ruta local de comites (nunca una URL externa).
function volverA(req, respaldo) {
  try {
    const u = new URL(req.get('referer') || '', 'http://local');
    return /^\/comites(\/\d+)?$/.test(u.pathname) ? u.pathname : respaldo;
  } catch {
    return respaldo;
  }
}

// fn devuelve el id del comite al que se vuelve (o una ruta).
const accion = (texto, fn, respaldo = '/comites') => async (req, res, next) => {
  try {
    const destino = await fn(req, req.session.empresa.id);
    req.session.aviso = { tipo: 'success', texto: typeof texto === 'function' ? texto(destino) : texto };
    res.redirect(typeof destino === 'number' ? `/comites/${destino}` : (destino && destino.ruta) || respaldo);
  } catch (err) {
    if ([409, 422].includes(err.status)) {
      req.session.aviso = { tipo: 'danger', texto: err.message };
      return res.redirect(volverA(req, respaldo));
    }
    return next(err);
  }
};

router.use('/comites', requiereSesion, requiereEmpresa, requiereRol(...ROLES_VER));

router.get('/comites', async (req, res, next) => {
  try {
    res.render('comites/index', {
      titulo: 'Comit&eacute;s', p: await servicio.panel(req.repo, req.session.empresa.id), hoy: hoyBogota(),
      gestionar: roles(req).some((x) => ROLES_GESTIONAR.includes(x)),
    });
  } catch (err) {
    next(err);
  }
});

router.post('/comites', gestionar, accion('Periodo del comité registrado. Agregue sus miembros.', async (req, e) => servicio.conformar(req.repo, e, req.body)));

router.get('/comites/:id(\\d+)', async (req, res, next) => {
  try {
    const d = await servicio.detalle(req.repo, req.session.empresa.id, entero(req.params.id));
    // Convivencia: temas y compromisos quedan en reserva del comite.
    if (d.c.tipo === 'convivencia' && !roles(req).includes('convivencia')) {
      d.reservado = true;
      d.sesiones.forEach((s) => { s.temas = null; });
      d.compromisos.forEach((x) => { x.descripcion = null; x.observacion = null; });
    }
    res.render('comites/detalle', {
      titulo: d.t.nombre, d, hoy: hoyBogota(),
      gestionar: roles(req).some((x) => ROLES_GESTIONAR.includes(x)),
      sesiones: puedeSesiones(req, d.c.tipo),
      scripts: ['/js/comites/detalle.js'],
    });
  } catch (err) {
    next(err);
  }
});

router.post('/comites/:id(\\d+)/acta', gestionar, accion('Acta de conformación asociada.', async (req, e) => {
  await servicio.asociarActaConformacion(req.repo, e, entero(req.params.id), req.body.documento_id);
  return entero(req.params.id);
}));
router.post('/comites/:id(\\d+)/miembros', gestionar, accion('Miembro agregado.', async (req, e) => {
  await servicio.agregarMiembro(req.repo, e, entero(req.params.id), req.body);
  return entero(req.params.id);
}));
router.post('/comites/miembros/:m(\\d+)/retirar', gestionar, accion('Miembro retirado.',
  (req, e) => servicio.retirarMiembro(req.repo, e, entero(req.params.m), req.body)));
router.post('/comites/:id(\\d+)/sesiones', sesiones('comiteId'), accion(
  () => 'Sesión registrada. El acta firmada debe asociarse dentro de los 8 días.',
  async (req, e) => { await servicio.registrarSesion(req.repo, e, entero(req.params.id), req.body); return entero(req.params.id); },
));
router.post('/comites/sesiones/:s(\\d+)/acta', sesiones('sesionId'), accion('Acta asociada a la sesión.',
  (req, e) => servicio.adjuntarActa(req.repo, e, entero(req.params.s), req.body.documento_id)));
router.post('/comites/sesiones/:s(\\d+)/anular', gestionar, accion('Sesión anulada.',
  (req, e) => servicio.anularSesion(req.repo, e, entero(req.params.s), req.body.motivo)));
router.post('/comites/sesiones/:s(\\d+)/compromisos', sesiones('sesionId'), accion('Compromiso registrado.',
  (req, e) => servicio.crearCompromiso(req.repo, e, entero(req.params.s), req.body)));
router.post('/comites/compromisos/:c(\\d+)/cerrar', sesiones('compromisoId'), accion('Compromiso cerrado.',
  (req, e) => servicio.cerrarCompromiso(req.repo, e, entero(req.params.c), req.body)));

module.exports = router;
