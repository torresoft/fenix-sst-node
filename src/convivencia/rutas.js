// M17: convivencia y acoso (con reserva), bateria psicosocial y documentos base.
const express = require('express');
const { requiereSesion, requiereEmpresa } = require('../middleware/auth');
const { hoyBogota } = require('../fechas/calendario');
const { ROLES_VER, ROLES_GESTIONAR, entero, puede, accion, requiereRol } = require('../comun/rutas');
const consentimientos = require('../consentimientos/servicio');
const servicio = require('./servicio');
const r = require('./reglas');

const router = express.Router();
const COMITE = ['convivencia'];
const comite = requiereRol(...COMITE);
const gestionar = requiereRol(...ROLES_GESTIONAR);
const proteccion = requiereRol(...COMITE, ...ROLES_GESTIONAR);
const TABS = ['quejas', 'psicosocial', 'programas'];
const volver = (tab) => () => `/convivencia?tab=${tab}`;
const aQueja = (req) => `/convivencia/quejas/${entero(req.params.id)}`;

router.use('/convivencia', requiereSesion, requiereEmpresa, requiereRol(...ROLES_VER, ...COMITE));

router.get('/convivencia', async (req, res, next) => {
  try {
    const e = req.session.empresa.id;
    const reserva = puede(req, COMITE);
    const [quejas, psico, documentos, personas, informes] = await Promise.all([
      servicio.quejas(req.repo, e), servicio.psicosocial(req.repo, e), servicio.documentosBase(req.repo, e),
      reserva ? req.repo.consultar(
        `SELECT p.id, p.nombres, p.apellidos FROM persona p JOIN vinculacion v ON v.tenant_id = {tenant} AND v.persona_id = p.id AND v.empresa_id = ?
          WHERE p.tenant_id = {tenant} GROUP BY p.id, p.nombres, p.apellidos ORDER BY p.apellidos`, [e],
      ) : [],
      req.repo.consultar(
        "SELECT id, codigo, version FROM documento_sst WHERE tenant_id = {tenant} AND empresa_id = ? AND tipo_documental = 'INFORME_PSICOSOCIAL' AND estado = 'vigente' ORDER BY codigo", [e],
      ),
    ]);
    res.render('convivencia/index', {
      titulo: 'Convivencia y salud mental', tab: TABS.includes(req.query.tab) ? req.query.tab : 'quejas', hoy: hoyBogota(),
      quejas, psico, documentos, personas, informes, reserva, gestionar: puede(req), proteccion: puede(req, [...COMITE, ...ROLES_GESTIONAR]),
      r, scripts: ['/js/convivencia/index.js'],
    });
  } catch (err) {
    next(err);
  }
});

router.get('/convivencia/quejas/:id(\\d+)', async (req, res, next) => {
  try {
    const reserva = puede(req, COMITE);
    const d = await servicio.detalle(req.repo, req.session.empresa.id, entero(req.params.id), { reserva });
    res.render('convivencia/queja', {
      titulo: `Queja ${d.queja.radicado}`, ...d, reserva, proteccion: puede(req, [...COMITE, ...ROLES_GESTIONAR]), hoy: hoyBogota(), r,
    });
  } catch (err) {
    next(err);
  }
});

router.post('/convivencia/quejas', comite, accion('Queja radicada. Corren los 65 días del procedimiento.',
  (req, e) => servicio.radicar(req.repo, e, req.body), (req, id) => (id ? `/convivencia/quejas/${id}` : '/convivencia')));
router.post('/convivencia/quejas/:id(\\d+)/proteccion', proteccion, accion('Solicitud de protección registrada: 5 días hábiles para adoptar medidas.',
  (req, e) => servicio.solicitarProteccion(req.repo, e, entero(req.params.id), req.body), aQueja));
router.post('/convivencia/quejas/:id(\\d+)/medida', proteccion, accion('Medida de protección registrada.',
  (req, e) => servicio.registrarMedida(req.repo, e, entero(req.params.id), req.body), aQueja));
router.post('/convivencia/quejas/:id(\\d+)/actuacion', comite, accion('Actuación registrada.',
  (req, e) => servicio.actuar(req.repo, e, entero(req.params.id), req.body), aQueja));
router.post('/convivencia/quejas/:id(\\d+)/cerrar', comite, accion('Procedimiento cerrado.',
  (req, e) => servicio.cerrar(req.repo, e, entero(req.params.id), req.body), aQueja));
router.post('/convivencia/quejas/:id(\\d+)/anular', comite, accion('Queja anulada.',
  (req, e) => servicio.anular(req.repo, e, entero(req.params.id), req.body.motivo), aQueja));

router.post('/convivencia/psicosocial', gestionar, accion('Evaluación psicosocial registrada.',
  (req, e) => servicio.registrarPsicosocial(req.repo, e, req.body), volver('psicosocial')));
router.post('/convivencia/psicosocial/:id(\\d+)/anular', gestionar, accion('Evaluación anulada.',
  (req, e) => servicio.anularPsicosocial(req.repo, e, entero(req.params.id), req.body.motivo), volver('psicosocial')));

// Canal electronico del trabajador: radica su propia queja desde /mis-registros.
router.post('/mis-registros/queja', requiereSesion, requiereEmpresa, accion('Queja radicada con reserva. El Comité de Convivencia se comunicará con usted.',
  async (req, e) => {
    const p = await consentimientos.personaDeUsuario(req.repo, req.session.usuario.id);
    return servicio.radicar(req.repo, e, { ...req.body, canal: 'electronico', quejoso_persona_id: String(p.id), quejoso_nombre: '', fecha_radicacion: '' });
  }, () => '/mis-registros?tab=denuncia'));

module.exports = router;
