// M09: salud ocupacional de la empresa activa y canal del trabajador (/mis-registros).
const express = require('express');
const cuentas = require('../db/cuentas');
const { requiereSesion, requiereEmpresa } = require('../middleware/auth');
const { hoyBogota } = require('../fechas/calendario');
const { ROLES_VER, ROLES_GESTIONAR, entero, puede, accion, requiereRol } = require('../comun/rutas');
const consentimientos = require('../consentimientos/servicio');
const epp = require('../epp/servicio');
const acuerdoFirma = require('../../data/acuerdo_firma.json');
const servicio = require('./servicio');

const router = express.Router();
const gestionar = requiereRol(...ROLES_GESTIONAR);
const TABS = ['evaluaciones', 'ausentismo', 'perfil'];
const MIS_TABS = ['salud', 'formacion', 'epp', 'documentos', 'autorizaciones', 'denuncia'];
const volver = (tab) => () => `/salud?tab=${tab}`;

router.get('/mis-registros', requiereSesion, requiereEmpresa, async (req, res, next) => {
  try {
    const m = await servicio.misRegistros(req.repo, req.session.usuario.id);
    res.render('salud/mis-registros', {
      titulo: 'Mis registros', m, tab: MIS_TABS.includes(req.query.tab) ? req.query.tab : 'salud',
      autorizaciones: m ? await consentimientos.dePersona(req.repo, m.persona.id) : [],
      epp: m ? await epp.dePersona(req.repo, m.persona.id) : [],
      acuerdoPendiente: !(await req.repo.listar('acuerdo_firma', { usuario_id: req.session.usuario.id, version: acuerdoFirma.version })).length,
    });
  } catch (err) {
    next(err);
  }
});

router.use('/salud', requiereSesion, requiereEmpresa, requiereRol(...ROLES_VER));

router.get('/salud', async (req, res, next) => {
  try {
    const empresaId = req.session.empresa.id;
    const hoy = hoyBogota();
    const anio = entero(req.query.anio) || Number(hoy.slice(0, 4));
    const [p, personas, documentos, eventos] = await Promise.all([
      servicio.panel(req.repo, empresaId, anio, hoy, puede(req)),
      req.repo.consultar(
        `SELECT p.id, p.nombres, p.apellidos FROM persona p
           JOIN vinculacion v ON v.tenant_id = {tenant} AND v.persona_id = p.id AND v.empresa_id = ?
          WHERE p.tenant_id = {tenant} GROUP BY p.id, p.nombres, p.apellidos ORDER BY p.apellidos`, [empresaId],
      ),
      req.repo.consultar(
        "SELECT id, codigo, version, persona_id FROM documento_sst WHERE tenant_id = {tenant} AND empresa_id = ? AND tipo_documental = 'CONCEPTO_APTITUD' AND estado = 'vigente' ORDER BY codigo",
        [empresaId],
      ),
      req.repo.consultar(
        "SELECT id, codigo, persona_id FROM evento WHERE tenant_id = {tenant} AND empresa_id = ? AND tipo <> 'incidente' AND estado <> 'anulado' ORDER BY fecha_base DESC", [empresaId],
      ),
    ]);
    res.render('salud/index', {
      titulo: 'Salud ocupacional', tab: TABS.includes(req.query.tab) ? req.query.tab : 'evaluaciones',
      p, personas, documentos, eventos, anio, hoy, gestionar: puede(req), scripts: ['/js/salud/index.js'],
    });
  } catch (err) {
    next(err);
  }
});

router.get('/salud/enfasis', gestionar, async (req, res, next) => {
  try {
    res.json({ ok: true, enfasis: await servicio.enfasisSugerido(req.repo, req.session.empresa.id, entero(req.query.persona_id)) });
  } catch (err) {
    next(err);
  }
});

router.post('/salud/evaluaciones', gestionar, accion('Orden de examen registrada.', (req, e) => servicio.ordenar(req.repo, e, req.body), volver('evaluaciones')));
router.post('/salud/evaluaciones/:id(\\d+)/concepto', gestionar, accion(
  (c) => (c === 'apto_con_restricciones' ? 'Concepto registrado. Corre el plazo de 20 días hábiles para adaptar el puesto.' : 'Concepto registrado.'),
  (req, e) => servicio.registrarConcepto(req.repo, e, entero(req.params.id), req.body), volver('evaluaciones')));
router.post('/salud/evaluaciones/:id(\\d+)/adaptacion', gestionar, accion('Adaptación del puesto registrada.',
  (req, e) => servicio.registrarAdaptacion(req.repo, e, entero(req.params.id), req.body), volver('evaluaciones')));
router.post('/salud/evaluaciones/:id(\\d+)/anular', gestionar, accion('Orden anulada.',
  (req, e) => servicio.anularEvaluacion(req.repo, e, entero(req.params.id), req.body.motivo), volver('evaluaciones')));
router.post('/salud/incapacidades', gestionar, accion('Incapacidad registrada.', (req, e) => servicio.registrarIncapacidad(req.repo, e, req.body), volver('ausentismo')));
router.post('/salud/incapacidades/:id(\\d+)/anular', gestionar, accion('Incapacidad anulada.',
  (req, e) => servicio.anularIncapacidad(req.repo, e, entero(req.params.id), req.body.motivo), volver('ausentismo')));

// Vinculo persona-usuario para el canal del trabajador (desde la ficha de la persona).
router.post('/personas/:id(\\d+)/usuario', requiereSesion, requiereEmpresa, gestionar, accion('Usuario vinculado a la persona.',
  (req) => servicio.vincularUsuario(req.repo, entero(req.params.id), req.body.usuario_id), (req) => `/personas/${entero(req.params.id)}`));

router.get('/personas/:id(\\d+)/usuarios-disponibles', requiereSesion, requiereEmpresa, gestionar, async (req, res, next) => {
  try {
    res.json({ ok: true, usuarios: await cuentas.usuariosDeTenants([req.repo.tenantId]) });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
