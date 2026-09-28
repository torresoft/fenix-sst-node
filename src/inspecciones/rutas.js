// M14: inspecciones y EPP de la empresa activa; firma de entregas desde Mis registros.
const express = require('express');
const cuentas = require('../db/cuentas');
const { requiereSesion, requiereEmpresa } = require('../middleware/auth');
const { hoyBogota } = require('../fechas/calendario');
const { ROLES_VER, ROLES_GESTIONAR, entero, puede, accion, requiereRol } = require('../comun/rutas');
const consentimientos = require('../consentimientos/servicio');
const servicio = require('./servicio');
const epp = require('../epp/servicio');

const router = express.Router();
const gestionar = requiereRol(...ROLES_GESTIONAR);
const TABS_EPP = ['matriz', 'entregas', 'elementos'];
const aInspeccion = (req, id) => `/inspecciones/${id || entero(req.params.id)}`;
const aEpp = (tab) => () => `/epp?tab=${tab}`;

router.use(['/inspecciones', '/epp'], requiereSesion, requiereEmpresa, requiereRol(...ROLES_VER));

router.get('/inspecciones', async (req, res, next) => {
  try {
    const e = req.session.empresa.id;
    const hoy = hoyBogota();
    const anio = entero(req.query.anio) || Number(hoy.slice(0, 4));
    res.render('inspecciones/index', {
      titulo: 'Inspecciones', anio, hoy, tipos: servicio.TIPOS, filas: await servicio.listar(req.repo, e, anio),
      centros: await req.repo.listar('centro_trabajo', { empresa_id: e }), gestionar: puede(req),
    });
  } catch (err) {
    next(err);
  }
});

router.get('/inspecciones/:id(\\d+)', async (req, res, next) => {
  try {
    const e = req.session.empresa.id;
    const d = await servicio.detalle(req.repo, e, entero(req.params.id));
    const [registros, usuarios] = await Promise.all([
      req.repo.consultar(
        "SELECT id, codigo, version FROM documento_sst WHERE tenant_id = {tenant} AND empresa_id = ? AND tipo_documental = 'REG_INSPECCION' AND estado = 'vigente' ORDER BY codigo", [e],
      ),
      cuentas.usuariosDelTenant(req.repo.tenantId),
    ]);
    res.render('inspecciones/detalle', {
      titulo: `Inspección ${d.inspeccion.area}`, ...d, registros, usuarios, hoy: hoyBogota(), niveles: servicio.NIVELES,
      gestionar: puede(req), scripts: ['/js/inspecciones/detalle.js'],
    });
  } catch (err) {
    next(err);
  }
});

router.post('/inspecciones', gestionar, accion('Inspección programada.', (req, e) => servicio.programar(req.repo, e, req.body), aInspeccion));
router.post('/inspecciones/:id(\\d+)/realizar', gestionar, accion(
  (r) => `Inspección registrada con ${r.hallazgos} hallazgo(s)${r.acciones ? ` y ${r.acciones} acción(es) correctiva(s)` : ''}.`,
  (req, e) => servicio.realizar(req.repo, e, entero(req.params.id), req.body), (req) => aInspeccion(req)));
router.post('/inspecciones/:id(\\d+)/anular', gestionar, accion('Inspección anulada.',
  (req, e) => servicio.anular(req.repo, e, entero(req.params.id), req.body.motivo), () => '/inspecciones'));

router.get('/epp', async (req, res, next) => {
  try {
    const e = req.session.empresa.id;
    const tab = TABS_EPP.includes(req.query.tab) ? req.query.tab : 'matriz';
    const [m, elementos, entregas, cargos, personas, planillas] = await Promise.all([
      epp.matriz(req.repo, e), epp.elementos(req.repo, e), tab === 'entregas' ? epp.entregas(req.repo, e) : [],
      req.repo.listar('cargo', { empresa_id: e, estado: 'activo' }),
      req.repo.consultar(
        `SELECT p.id, p.nombres, p.apellidos, p.usuario_id FROM persona p JOIN vinculacion v ON v.tenant_id = {tenant} AND v.persona_id = p.id AND v.empresa_id = ? AND v.estado = 'activa'
          WHERE p.tenant_id = {tenant} GROUP BY p.id, p.nombres, p.apellidos, p.usuario_id ORDER BY p.apellidos`, [e],
      ),
      req.repo.consultar(
        "SELECT id, codigo, version FROM documento_sst WHERE tenant_id = {tenant} AND empresa_id = ? AND tipo_documental = 'ENTREGA_EPP' AND estado = 'vigente' ORDER BY id DESC LIMIT 50", [e],
      ),
    ]);
    res.render('epp/index', {
      titulo: 'Elementos de protección personal', tab, m, elementos, entregas, cargos, personas, planillas, motivos: epp.MOTIVOS,
      hoy: hoyBogota(), gestionar: puede(req), scripts: ['/js/epp/index.js'],
    });
  } catch (err) {
    next(err);
  }
});

router.post('/epp/elementos', gestionar, accion('Elemento creado.', (req, e) => epp.crearElemento(req.repo, e, req.body), aEpp('elementos')));
router.post('/epp/ingresos', gestionar, accion('Ingreso de inventario registrado.', (req, e) => epp.ingresar(req.repo, e, req.body), aEpp('elementos')));
router.post('/epp/requisitos', gestionar, accion('Requisito del cargo guardado.', (req, e) => epp.guardarRequisito(req.repo, e, req.body), aEpp('elementos')));
router.post('/epp/requisitos/:id(\\d+)/retirar', gestionar, accion('Requisito retirado.', (req, e) => epp.retirarRequisito(req.repo, e, entero(req.params.id)), aEpp('elementos')));
router.post('/epp/entregas', gestionar, accion('Entrega registrada.', (req, e) => epp.entregar(req.repo, e, req.body), aEpp('entregas')));
router.post('/epp/entregas/:id(\\d+)/anular', gestionar, accion('Entrega anulada.', (req, e) => epp.anularEntrega(req.repo, e, entero(req.params.id), req.body.motivo), aEpp('entregas')));

router.post('/mis-registros/epp/:id(\\d+)/firmar', requiereSesion, requiereEmpresa, accion('Recibo firmado.', async (req) => {
  await consentimientos.personaDeUsuario(req.repo, req.session.usuario.id);
  return epp.firmarEntrega(req.repo, req.session.usuario.id, entero(req.params.id), {
    clave: req.body.clave, aceptaAcuerdo: req.body.acepta_acuerdo === '1', ip: req.ip, userAgent: req.get('user-agent'),
  });
}, () => '/mis-registros?tab=epp'));

module.exports = router;
