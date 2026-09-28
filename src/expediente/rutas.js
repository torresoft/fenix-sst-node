// Exportacion del expediente del SG-SST para la visita de inspeccion.
const express = require('express');
const { requiereSesion, requiereEmpresa } = require('../middleware/auth');
const { requiereRol } = require('../comun/rutas');
const servicio = require('./servicio');

const router = express.Router();

// Mismos lectores del gestor documental: el ZIP lleva conceptos de aptitud y otros registros individuales.
const LECTORES = ['admin_tenant', 'responsable_sst', 'consultor_sst', 'gerente', 'auditor'];
router.use('/expediente', requiereSesion, requiereEmpresa, requiereRol(...LECTORES));

router.get('/expediente', (req, res) => {
  res.render('expediente/index', { titulo: 'Expediente para inspección' });
});

router.post('/expediente', async (req, res, next) => {
  try {
    const r = await servicio.generar(req.repo, req.session.empresa.id, { historico: req.body.historico === '1' });
    res.set({ 'Content-Type': 'application/zip', 'Content-Disposition': `attachment; filename="${r.nombre}"` });
    res.send(r.zip);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
