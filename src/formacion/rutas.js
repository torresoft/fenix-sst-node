// M07: formacion y competencias de la empresa activa.
const express = require('express');
const { requiereSesion, requiereEmpresa } = require('../middleware/auth');
const { hoyBogota } = require('../fechas/calendario');
const { ROLES_VER, ROLES_GESTIONAR, entero, puede, accion, requiereRol } = require('../comun/rutas');
const servicio = require('./servicio');

const router = express.Router();
const gestionar = requiereRol(...ROLES_GESTIONAR);
const TABS = ['matriz', 'capacitaciones', 'requisitos'];

router.use('/formacion', requiereSesion, requiereEmpresa, requiereRol(...ROLES_VER));

router.get('/formacion', async (req, res, next) => {
  try {
    const empresaId = req.session.empresa.id;
    const hoy = hoyBogota();
    const anio = entero(req.query.anio) || Number(hoy.slice(0, 4));
    const [matriz, caps, req2, documentos, personas] = await Promise.all([
      servicio.matrizCompetencias(req.repo, empresaId, hoy),
      servicio.capacitaciones(req.repo, empresaId, anio),
      servicio.requisitos(req.repo, empresaId),
      req.repo.consultar(
        "SELECT id, codigo, version, titulo, tipo_documental FROM documento_sst WHERE tenant_id = {tenant} AND empresa_id = ? AND estado = 'vigente' AND tipo_documental IN ('REG_CAPACITACION','PROG_CAPACITACION') ORDER BY codigo",
        [empresaId],
      ),
      req.repo.consultar(
        `SELECT p.id, p.nombres, p.apellidos FROM persona p
           JOIN vinculacion v ON v.tenant_id = {tenant} AND v.persona_id = p.id AND v.empresa_id = ? AND v.estado = 'activa'
          WHERE p.tenant_id = {tenant} ORDER BY p.apellidos`, [empresaId],
      ),
    ]);
    res.render('formacion/index', {
      titulo: 'Formaci&oacute;n y competencias', tab: TABS.includes(req.query.tab) ? req.query.tab : 'matriz',
      matriz, caps, req: req2, documentos, personas, anio, hoy, gestionar: puede(req), scripts: ['/js/formacion/index.js'],
    });
  } catch (err) {
    next(err);
  }
});

const volver = (tab) => (req) => `/formacion?tab=${tab}`;

router.post('/formacion/competencias', gestionar, accion('Competencia registrada.',
  (req, e) => servicio.registrarCompetencia(req.repo, e, entero(req.body.persona_id), req.body),
  (req) => (req.body.volver === 'persona' ? `/personas/${entero(req.body.persona_id)}` : '/formacion?tab=matriz')));
router.post('/formacion/competencias/:id(\\d+)/anular', gestionar, accion('Competencia anulada.',
  (req, e) => servicio.anularCompetencia(req.repo, e, entero(req.params.id), req.body.motivo), volver('matriz')));
router.post('/formacion/requisitos/:cargo(\\d+)', gestionar, accion('Requisitos del cargo guardados.',
  (req, e) => servicio.guardarRequisitos(req.repo, e, entero(req.params.cargo), req.body.competencias), volver('requisitos')));
router.post('/formacion/capacitaciones', gestionar, accion('Capacitación programada.',
  (req, e) => servicio.programar(req.repo, e, req.body), volver('capacitaciones')));

router.get('/formacion/capacitaciones/:id(\\d+)', async (req, res, next) => {
  try {
    const empresaId = req.session.empresa.id;
    const [d, personas, documentos] = await Promise.all([
      servicio.detalleCapacitacion(req.repo, empresaId, entero(req.params.id)),
      req.repo.consultar(
        `SELECT p.id, p.nombres, p.apellidos FROM persona p
           JOIN vinculacion v ON v.tenant_id = {tenant} AND v.persona_id = p.id AND v.empresa_id = ? AND v.estado = 'activa'
          WHERE p.tenant_id = {tenant} ORDER BY p.apellidos`, [empresaId],
      ),
      req.repo.consultar(
        "SELECT id, codigo, version FROM documento_sst WHERE tenant_id = {tenant} AND empresa_id = ? AND tipo_documental = 'REG_CAPACITACION' AND estado IN ('vigente','en_firma') ORDER BY codigo",
        [empresaId],
      ),
    ]);
    const tipos = await servicio.tipos();
    res.render('formacion/capacitacion', {
      titulo: d.k.tema, d, personas, documentos, tipos, hoy: hoyBogota(), gestionar: puede(req),
    });
  } catch (err) {
    next(err);
  }
});

router.post('/formacion/capacitaciones/:id(\\d+)/realizar', gestionar, accion(
  (n) => (n ? `Capacitación registrada. Competencia acreditada a ${n} persona(s).` : 'Capacitación registrada.'),
  (req, e) => servicio.realizar(req.repo, e, entero(req.params.id), req.body), (req) => `/formacion/capacitaciones/${entero(req.params.id)}`));
router.post('/formacion/capacitaciones/:id(\\d+)/anular', gestionar, accion('Capacitación anulada.',
  (req, e) => servicio.anularCapacitacion(req.repo, e, entero(req.params.id), req.body.motivo), volver('capacitaciones')));

module.exports = router;
