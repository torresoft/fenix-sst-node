// M18: Plan Estrategico de Seguridad Vial.
const express = require('express');
const { requiereSesion, requiereEmpresa } = require('../middleware/auth');
const { hoyBogota } = require('../fechas/calendario');
const { ROLES_VER, ROLES_GESTIONAR, entero, puede, accion, requiereRol } = require('../comun/rutas');
const servicio = require('./servicio');

const router = express.Router();
const gestionar = requiereRol(...ROLES_GESTIONAR);
const TABS = ['pasos', 'vehiculos', 'conductores', 'preoperacional'];
const volver = (tab) => () => `/pesv?tab=${tab}`;

router.use('/pesv', requiereSesion, requiereEmpresa, requiereRol(...ROLES_VER));

router.get('/pesv', async (req, res, next) => {
  try {
    const e = req.session.empresa.id;
    const hoy = hoyBogota();
    const [p, personas, evidencias, ambitos] = await Promise.all([
      servicio.panel(req.repo, e, hoy),
      req.repo.consultar(
        `SELECT p.id, p.nombres, p.apellidos FROM persona p JOIN vinculacion v ON v.tenant_id = {tenant} AND v.persona_id = p.id AND v.empresa_id = ? AND v.estado = 'activa'
          WHERE p.tenant_id = {tenant} GROUP BY p.id, p.nombres, p.apellidos ORDER BY p.apellidos`, [e],
      ),
      req.repo.consultar(
        "SELECT id, codigo, version, titulo FROM documento_sst WHERE tenant_id = {tenant} AND empresa_id = ? AND tipo_documental IN ('PESV','EVIDENCIA_PESV') AND estado = 'vigente' ORDER BY id DESC LIMIT 100", [e],
      ),
      req.repo.listar('empresa_ambito', { empresa_id: e }),
    ]);
    res.render('pesv/index', {
      titulo: 'Seguridad vial (PESV)', tab: TABS.includes(req.query.tab) ? req.query.tab : 'pasos', hoy, p, personas, evidencias,
      declarado: ambitos.some((a) => a.ambito === 'pesv'), tipos: servicio.TIPOS, propiedad: servicio.PROPIEDAD, estadosPaso: servicio.ESTADOS_PASO,
      items: servicio.ITEMS, gestionar: puede(req), scripts: ['/js/pesv/index.js'],
    });
  } catch (err) {
    next(err);
  }
});

router.post('/pesv/avance', gestionar, accion('Avance registrado.', (req, e) => servicio.registrarAvance(req.repo, e, req.body), volver('pasos')));
router.post('/pesv/vehiculos', gestionar, accion('Vehículo registrado.', (req, e) => servicio.registrarVehiculo(req.repo, e, req.body), volver('vehiculos')));
router.post('/pesv/vehiculos/:id(\\d+)/renovar', gestionar, accion('Vencimientos actualizados.',
  (req, e) => servicio.renovarVehiculo(req.repo, e, entero(req.params.id), req.body), volver('vehiculos')));
router.post('/pesv/vehiculos/:id(\\d+)/inactivar', gestionar, accion('Vehículo inactivado.',
  (req, e) => servicio.inactivarVehiculo(req.repo, e, entero(req.params.id), req.body.motivo), volver('vehiculos')));
router.post('/pesv/conductores', gestionar, accion('Conductor registrado.', (req, e) => servicio.registrarConductor(req.repo, e, req.body), volver('conductores')));
router.post('/pesv/conductores/:id(\\d+)/inactivar', gestionar, accion('Conductor inactivado.',
  (req, e) => servicio.inactivarConductor(req.repo, e, entero(req.params.id)), volver('conductores')));
router.post('/pesv/preoperacional', gestionar, accion(
  (r) => (r.apto ? 'Inspección registrada: vehículo apto.' : `Vehículo NO apto: ${[...r.bloqueos, ...r.fallas].join('; ')}`),
  (req, e) => servicio.preoperacional(req.repo, e, req.body), volver('preoperacional')));

module.exports = router;
