// M06: plan de trabajo anual y gestion del cambio de la empresa activa.
const express = require('express');
const cuentas = require('../db/cuentas');
const { requiereSesion, requiereEmpresa } = require('../middleware/auth');
const { hoyBogota } = require('../fechas/calendario');
const { ROLES_VER, ROLES_GESTIONAR, entero, puede, accion, requiereRol } = require('../comun/rutas');
const servicio = require('./servicio');

const router = express.Router();
const gestionar = requiereRol(...ROLES_GESTIONAR);
const aPlan = (req, r) => `/planeacion?plan=${(typeof r === 'number' && r) || entero(req.params.id) || entero(req.body.plan_id) || ''}`;

router.use('/planeacion', requiereSesion, requiereEmpresa, requiereRol(...ROLES_VER));

router.get('/planeacion', async (req, res, next) => {
  try {
    const empresaId = req.session.empresa.id;
    const hoy = hoyBogota();
    const tab = req.query.tab === 'cambios' ? 'cambios' : 'plan';
    const planes = await servicio.planes(req.repo, empresaId);
    const elegido = planes.find((p) => p.id === entero(req.query.plan))
      || planes.find((p) => Number(p.vigencia_anio) === Number(hoy.slice(0, 4))) || planes[0] || null;
    const [d, cambios, usuarios, documentos] = await Promise.all([
      elegido ? servicio.detalle(req.repo, empresaId, elegido.id, hoy) : null,
      servicio.cambios(req.repo, empresaId),
      cuentas.usuariosDeTenants([req.repo.tenantId]),
      req.repo.consultar(
        "SELECT id, codigo, version, titulo, tipo_documental, estado FROM documento_sst WHERE tenant_id = {tenant} AND empresa_id = ? AND estado IN ('vigente','en_firma') ORDER BY tipo_documental, codigo",
        [empresaId],
      ),
    ]);
    res.render('planeacion/index', {
      titulo: 'Planeaci&oacute;n', tab, planes, d, cambios, usuarios, documentos, hoy, gestionar: puede(req),
      scripts: ['/js/planeacion/index.js'],
    });
  } catch (err) {
    next(err);
  }
});

router.post('/planeacion/planes', gestionar, accion('Plan creado en borrador.', (req, e) => servicio.crear(req.repo, e, req.body), aPlan));
router.post('/planeacion/planes/:id(\\d+)/presupuesto', gestionar, accion('Presupuesto actualizado.', (req, e) => servicio.guardarPresupuesto(req.repo, e, entero(req.params.id), req.body), aPlan));
router.post('/planeacion/planes/:id(\\d+)/objetivos', gestionar, accion('Objetivo agregado.', (req, e) => servicio.agregarObjetivo(req.repo, e, entero(req.params.id), req.body), aPlan));
router.post('/planeacion/planes/:id(\\d+)/actividades', gestionar, accion('Actividad programada.', (req, e) => servicio.agregarActividad(req.repo, e, entero(req.params.id), req.body), aPlan));
router.post('/planeacion/planes/:id(\\d+)/importar-capa', gestionar, accion((n) => `${n} acción(es) de mejora incorporadas al cronograma.`,
  (req, e) => servicio.importarCapa(req.repo, e, entero(req.params.id)), aPlan));
router.post('/planeacion/planes/:id(\\d+)/aprobar', gestionar, accion('Plan aprobado.', (req, e) => servicio.aprobar(req.repo, e, entero(req.params.id), req.body), aPlan));
router.post('/planeacion/planes/:id(\\d+)/cerrar', gestionar, accion('Plan cerrado.', (req, e) => servicio.cerrarPlan(req.repo, e, entero(req.params.id)), aPlan));
router.post('/planeacion/actividades/:a(\\d+)/cerrar', gestionar, accion('Actividad actualizada.',
  (req, e) => servicio.cerrarActividad(req.repo, e, entero(req.params.a), req.body), aPlan));
router.post('/planeacion/actividades/:a(\\d+)/reprogramar', gestionar, accion('Actividad reprogramada.',
  (req, e) => servicio.reprogramar(req.repo, e, entero(req.params.a), req.body), aPlan));
router.post('/planeacion/cambios', gestionar, accion('Cambio registrado para evaluación.', (req, e) => servicio.registrarCambio(req.repo, e, req.body), () => '/planeacion?tab=cambios'));
router.post('/planeacion/cambios/:id(\\d+)', gestionar, accion('Gestión del cambio actualizada.',
  (req, e) => servicio.avanzarCambio(req.repo, e, entero(req.params.id), req.body), () => '/planeacion?tab=cambios'));

module.exports = router;
