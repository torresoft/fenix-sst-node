// CAPA: todas las acciones correctivas, preventivas y de mejora de la empresa activa.
const express = require('express');
const { requiereSesion, requiereEmpresa } = require('../middleware/auth');
const { hoyBogota } = require('../fechas/calendario');
const { ROLES_VER, ROLES_GESTIONAR, entero, puede, accion, requiereRol } = require('../comun/rutas');
const servicio = require('./servicio');

const router = express.Router();

router.use('/acciones', requiereSesion, requiereEmpresa, requiereRol(...ROLES_VER));

router.get('/acciones', async (req, res, next) => {
  try {
    const estado = ['abierta', 'cerrada', 'anulada'].includes(req.query.estado) ? req.query.estado : 'abierta';
    const origen = Object.keys(servicio.ORIGENES).includes(req.query.origen) ? req.query.origen : null;
    const todas = await servicio.listar(req.repo, req.session.empresa.id);
    const conteo = { abierta: 0, cerrada: 0, anulada: 0 };
    todas.forEach((a) => { if (!origen || a.origen === origen) conteo[a.estado] += 1; });
    res.render('capa/index', {
      titulo: 'Acciones de mejora', estado, origen, conteo, origenes: servicio.ORIGENES, hoy: hoyBogota(),
      filas: todas.filter((a) => a.estado === estado && (!origen || a.origen === origen)), gestionar: puede(req),
      scripts: ['/js/capa/index.js'],
    });
  } catch (err) {
    next(err);
  }
});

router.post('/acciones/:id(\\d+)/cerrar', requiereRol(...ROLES_GESTIONAR), accion('Acción cerrada.',
  (req, e) => servicio.cerrar(req.repo, e, entero(req.params.id), req.body), (req) => `/acciones${req.body.volver_origen ? `?origen=${encodeURIComponent(req.body.volver_origen)}` : ''}`));

module.exports = router;
