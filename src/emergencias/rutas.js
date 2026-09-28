// M13: emergencias de la empresa activa.
const express = require('express');
const cuentas = require('../db/cuentas');
const { requiereSesion, requiereEmpresa } = require('../middleware/auth');
const { hoyBogota } = require('../fechas/calendario');
const { ROLES_VER, ROLES_GESTIONAR, entero, puede, accion, requiereRol } = require('../comun/rutas');
const servicio = require('./servicio');

const router = express.Router();
const gestionar = requiereRol(...ROLES_GESTIONAR);
const TABS = ['brigada', 'equipos', 'simulacros', 'plan'];
const volver = (tab) => () => `/emergencias?tab=${tab}`;

router.use('/emergencias', requiereSesion, requiereEmpresa, requiereRol(...ROLES_VER));

router.get('/emergencias', async (req, res, next) => {
  try {
    const e = req.session.empresa.id;
    const hoy = hoyBogota();
    const [p, personas, centros, informes, usuarios] = await Promise.all([
      servicio.panel(req.repo, e, hoy),
      req.repo.consultar(
        `SELECT p.id, p.nombres, p.apellidos FROM persona p JOIN vinculacion v ON v.tenant_id = {tenant} AND v.persona_id = p.id AND v.empresa_id = ? AND v.estado = 'activa'
          WHERE p.tenant_id = {tenant} GROUP BY p.id, p.nombres, p.apellidos ORDER BY p.apellidos`, [e],
      ),
      req.repo.listar('centro_trabajo', { empresa_id: e }),
      req.repo.consultar(
        "SELECT id, codigo, version FROM documento_sst WHERE tenant_id = {tenant} AND empresa_id = ? AND tipo_documental = 'INFORME_SIMULACRO' AND estado = 'vigente' ORDER BY codigo", [e],
      ),
      cuentas.usuariosDelTenant(req.repo.tenantId),
    ]);
    res.render('emergencias/index', {
      titulo: 'Emergencias', tab: TABS.includes(req.query.tab) ? req.query.tab : 'brigada', hoy, p, personas, centros, informes, usuarios,
      roles: servicio.ROLES_BRIGADA, gestionar: puede(req), scripts: ['/js/emergencias/index.js'],
    });
  } catch (err) {
    next(err);
  }
});

router.get('/emergencias/equipos/:id(\\d+)/revisiones', async (req, res, next) => {
  try {
    res.json({ ok: true, revisiones: await servicio.revisiones(req.repo, req.session.empresa.id, entero(req.params.id)) });
  } catch (err) {
    next(err);
  }
});

router.post('/emergencias/brigada', gestionar, accion('Brigadista designado.', (req, e) => servicio.designar(req.repo, e, req.body), volver('brigada')));
router.post('/emergencias/brigada/:id(\\d+)/retirar', gestionar, accion('Brigadista retirado.', (req, e) => servicio.retirar(req.repo, e, entero(req.params.id)), volver('brigada')));
router.post('/emergencias/equipos', gestionar, accion('Equipo registrado.', (req, e) => servicio.registrarEquipo(req.repo, e, req.body), volver('equipos')));
router.post('/emergencias/equipos/:id(\\d+)/revision', gestionar, accion('Revisión registrada.',
  (req, e) => servicio.revisarEquipo(req.repo, e, entero(req.params.id), req.body), volver('equipos')));
router.post('/emergencias/equipos/:id(\\d+)/baja', gestionar, accion('Equipo dado de baja.',
  (req, e) => servicio.darDeBaja(req.repo, e, entero(req.params.id), req.body.motivo), volver('equipos')));
router.post('/emergencias/simulacros', gestionar, accion('Simulacro registrado.', (req, e) => servicio.registrarSimulacro(req.repo, e, req.body), volver('simulacros')));
router.post('/emergencias/simulacros/:id(\\d+)/anular', gestionar, accion('Simulacro anulado.',
  (req, e) => servicio.anularSimulacro(req.repo, e, entero(req.params.id), req.body.motivo), volver('simulacros')));

module.exports = router;
