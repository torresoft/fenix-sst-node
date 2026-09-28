// M16: contratistas de la empresa activa.
const express = require('express');
const { requiereSesion, requiereEmpresa } = require('../middleware/auth');
const { hoyBogota } = require('../fechas/calendario');
const { ROLES_VER, ROLES_GESTIONAR, entero, puede, accion, requiereRol } = require('../comun/rutas');
const servicio = require('./servicio');

const router = express.Router();
const gestionar = requiereRol(...ROLES_GESTIONAR);
const aContratista = (req, id) => `/contratistas/${id || entero(req.params.id)}`;

router.use('/contratistas', requiereSesion, requiereEmpresa, requiereRol(...ROLES_VER));

router.get('/contratistas', async (req, res, next) => {
  try {
    res.render('contratistas/index', {
      titulo: 'Contratistas', filas: await servicio.listar(req.repo, req.session.empresa.id), clases: servicio.CLASES, gestionar: puede(req),
    });
  } catch (err) {
    next(err);
  }
});

router.get('/contratistas/:id(\\d+)', async (req, res, next) => {
  try {
    const e = req.session.empresa.id;
    const hoy = hoyBogota();
    const [d, personas] = await Promise.all([
      servicio.detalle(req.repo, e, entero(req.params.id), hoy),
      req.repo.consultar(
        `SELECT p.id, p.nombres, p.apellidos FROM persona p JOIN vinculacion v ON v.tenant_id = {tenant} AND v.persona_id = p.id AND v.empresa_id = ? AND v.estado = 'activa' AND v.tipo = 'contratista'
          WHERE p.tenant_id = {tenant} GROUP BY p.id, p.nombres, p.apellidos ORDER BY p.apellidos`, [e],
      ),
    ]);
    res.render('contratistas/detalle', {
      titulo: d.contratista.razon_social, ...d, personas, criterios: servicio.CRITERIOS, clases: servicio.CLASES,
      hoy, tab: ['trabajadores', 'sgrl', 'evaluaciones', 'datos'].includes(req.query.tab) ? req.query.tab : 'trabajadores', gestionar: puede(req),
    });
  } catch (err) {
    next(err);
  }
});

router.post('/contratistas', gestionar, accion('Contratista registrado. Evalúelo antes de su ingreso.',
  (req, e) => servicio.crear(req.repo, e, req.body), (req, id) => (id ? `${aContratista(req, id)}?tab=evaluaciones` : '/contratistas')));
router.post('/contratistas/:id(\\d+)/editar', gestionar, accion('Datos actualizados.',
  (req, e) => servicio.editar(req.repo, e, entero(req.params.id), req.body), (req) => `${aContratista(req)}?tab=datos`));
router.post('/contratistas/:id(\\d+)/inactivar', gestionar, accion('Contratista inactivado.',
  (req, e) => servicio.inactivar(req.repo, e, entero(req.params.id)), (req) => aContratista(req)));
router.post('/contratistas/:id(\\d+)/evaluar', gestionar, accion((r) => `Evaluación registrada: ${r.puntaje}% (${r.resultado}).`,
  (req, e) => servicio.evaluar(req.repo, e, entero(req.params.id), req.body), (req) => `${aContratista(req)}?tab=evaluaciones`));
router.post('/contratistas/:id(\\d+)/trabajadores', gestionar, accion('Trabajador vinculado.',
  (req, e) => servicio.vincularTrabajador(req.repo, e, entero(req.params.id), req.body), (req) => aContratista(req)));
router.post('/contratistas/:id(\\d+)/trabajadores/:t(\\d+)/retirar', gestionar, accion('Trabajador retirado.',
  (req, e) => servicio.retirarTrabajador(req.repo, e, entero(req.params.id), entero(req.params.t)), (req) => aContratista(req)));
router.post('/contratistas/:id(\\d+)/sgrl', gestionar, accion((r) => (r.resultado === 'conforme' ? 'Verificación conforme.' : 'Verificación registrada: INCONSISTENTE en la clase de riesgo.'),
  (req, e) => servicio.verificarSgrl(req.repo, e, entero(req.params.id), req.body), (req) => `${aContratista(req)}?tab=sgrl`));

module.exports = router;
