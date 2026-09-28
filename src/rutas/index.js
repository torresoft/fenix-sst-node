const express = require('express');
const { requiereSesion, requiereEmpresa } = require('../middleware/auth');

const { ROLES_VER, puede } = require('../comun/rutas');
const inicio = require('../inicio/servicio');
const planes = require('../planes/servicio');
const suscripciones = require('../plataforma/suscripciones');

const router = express.Router();

// Inicio: tablero para el equipo SST; el trabajador va directo a sus registros.
router.get('/', requiereSesion, requiereEmpresa, async (req, res, next) => {
  try {
    if (!puede(req, ROLES_VER)) return res.redirect('/mis-registros');
    const admin = puede(req, ['admin_tenant']);
    const [t, plan, suscripcion] = await Promise.all([
      inicio.tablero(req.repo, req.session.empresa.id, req.session.usuario.id),
      admin ? planes.estado(req.repo) : null,
      admin ? suscripciones.resumenCliente(req.session.empresa.tenantId) : null,
    ]);
    return res.render('inicio', { titulo: req.session.empresa.razonSocial, subtitulo: `NIT ${req.session.empresa.nit}`, t, plan, suscripcion });
  } catch (err) {
    return next(err);
  }
});

router.use(require('../plazos/rutas'));
router.use(require('../matriz/rutas'));
router.use(require('../autoevaluacion/rutas'));
router.use(require('../documentos/rutas'));
router.use(require('../empresa/rutas'));
router.use(require('../personas/rutas'));
router.use(require('../eventos/rutas'));
router.use(require('../comites/rutas'));
router.use(require('../peligros/rutas'));
router.use(require('../formacion/rutas'));
router.use(require('../planeacion/rutas'));
router.use(require('../salud/rutas'));
router.use(require('../indicadores/rutas'));
router.use(require('../emergencias/rutas'));
router.use(require('../inspecciones/rutas'));
router.use(require('../permisos/rutas'));
router.use(require('../contratistas/rutas'));
router.use(require('../capa/rutas'));
router.use(require('../convivencia/rutas'));
router.use(require('../consentimientos/rutas'));
router.use(require('../pesv/rutas'));
router.use(require('../quimicos/rutas'));
router.use(require('../integraciones/rutas'));
router.use(require('../expediente/rutas'));
router.use(require('../plataforma/rutas'));
router.use(require('../consultor/rutas'));

module.exports = router;
