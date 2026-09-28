// M08: eventos (incidentes, AT, EL) de la empresa activa.
const express = require('express');
const cuentas = require('../db/cuentas');
const { requiereSesion, requiereEmpresa, requiereRol } = require('../middleware/auth');
const { hoyBogota } = require('../fechas/calendario');
const autoevaluacion = require('../autoevaluacion/servicio');
const personas = require('../personas/servicio');
const servicio = require('./servicio');

const router = express.Router();

const ROLES_VER = ['admin_tenant', 'responsable_sst', 'consultor_sst', 'gerente', 'auditor', 'copasst'];
const ROLES_GESTIONAR = ['admin_tenant', 'responsable_sst', 'consultor_sst'];
const gestionar = requiereRol(...ROLES_GESTIONAR);
const puedeGestionar = (req) => (req.session.empresa.roles || []).some((x) => ROLES_GESTIONAR.includes(x));
const entero = (v) => { const n = Number.parseInt(v, 10); return Number.isSafeInteger(n) && n > 0 ? n : null; };
const aEvento = (req) => `/eventos/${entero(req.params.id)}`;

const accion = (destino, texto, fn) => async (req, res, next) => {
  const ir = typeof destino === 'function' ? destino(req) : destino;
  try {
    await fn(req, req.session.empresa.id, entero(req.params.id));
    req.session.aviso = { tipo: 'success', texto };
    res.redirect(ir);
  } catch (err) {
    if ([409, 422].includes(err.status)) {
      req.session.aviso = { tipo: 'danger', texto: err.message };
      return res.redirect(ir);
    }
    return next(err);
  }
};

router.use('/eventos', requiereSesion, requiereEmpresa, requiereRol(...ROLES_VER));

router.get('/eventos', async (req, res, next) => {
  try {
    const anio = entero(req.query.anio) || Number(hoyBogota().slice(0, 4));
    const tipo = ['incidente', 'accidente', 'enfermedad'].includes(req.query.tipo) ? req.query.tipo : '';
    const eventos = await servicio.listar(req.repo, req.session.empresa.id, { anio, tipo });
    const todosAnio = tipo ? await servicio.listar(req.repo, req.session.empresa.id, { anio }) : eventos;
    res.render('eventos/index', {
      titulo: 'Incidentes, accidentes y enfermedades laborales', eventos, filtros: { anio, tipo },
      est: servicio.estadistica(todosAnio), gestionar: puedeGestionar(req), hoy: hoyBogota(),
    });
  } catch (err) {
    next(err);
  }
});

async function formulario(req, res, valores = {}, error = null) {
  const empresaId = req.session.empresa.id;
  const [lista, centros, criterios] = await Promise.all([
    personas.listar(req.repo, empresaId, { estado: 'activas' }),
    personas.centrosActivos(req.repo, empresaId),
    servicio.catalogo.criterios(),
  ]);
  res.status(error ? 422 : 200).render('eventos/formulario', {
    titulo: 'Registrar evento', valores, error, personas: lista, centros, criterios, scripts: ['/js/eventos/formulario.js'],
  });
}

router.get('/eventos/nuevo', gestionar, (req, res, next) => formulario(req, res, { tipo: 'accidente', gravedad: 'leve' }).catch(next));

router.post('/eventos', gestionar, async (req, res, next) => {
  try {
    const id = await servicio.registrar(req.repo, req.session.empresa.id, req.body);
    req.session.aviso = { tipo: 'warning', texto: 'Evento registrado. Revise los plazos legales que se generaron.' };
    res.redirect(`/eventos/${id}`);
  } catch (err) {
    if (err.status === 422) return formulario(req, res, req.body, err.message).catch(next);
    return next(err);
  }
});

router.get('/eventos/:id(\\d+)', async (req, res, next) => {
  try {
    const empresaId = req.session.empresa.id;
    const d = await servicio.detalle(req.repo, empresaId, entero(req.params.id));
    const [usuarios, soportes] = await Promise.all([
      cuentas.usuariosDeTenants([req.repo.tenantId]),
      req.repo.consultar(
        `SELECT id, codigo, version, titulo, tipo_documental, estado FROM documento_sst
          WHERE tenant_id = {tenant} AND empresa_id = ? AND tipo_documental IN ('FURAT','FUREL','INV_ACCIDENTE')
            AND estado IN ('vigente','en_firma') ORDER BY codigo, version DESC`, [empresaId],
      ),
    ]);
    await req.repo.auditar('consultar', 'evento', d.e.id);
    res.render('eventos/detalle', {
      titulo: `${d.e.codigo}`, d, usuarios, soportes, gestionar: puedeGestionar(req), hoy: hoyBogota(),
      scripts: ['/js/eventos/detalle.js'],
    });
  } catch (err) {
    next(err);
  }
});

router.post('/eventos/:id(\\d+)/reporte', gestionar, accion(aEvento, 'Radicación registrada.',
  (req, e, id) => servicio.reportar(req.repo, e, id, req.body)));
router.post('/eventos/:id(\\d+)/datos', gestionar, accion(aEvento, 'Investigación actualizada.',
  (req, e, id) => servicio.guardarDatos(req.repo, e, id, req.body)));
router.post('/eventos/:id(\\d+)/investigadores', gestionar, accion(aEvento, 'Investigador agregado.',
  (req, e, id) => servicio.agregarInvestigador(req.repo, e, id, req.body)));
router.post('/eventos/:id(\\d+)/investigadores/:x(\\d+)/retirar', gestionar, accion(aEvento, 'Investigador retirado.',
  (req, e, id) => servicio.retirarElemento(req.repo, e, id, 'evento_investigador', entero(req.params.x))));
router.post('/eventos/:id(\\d+)/causas', gestionar, accion(aEvento, 'Causa agregada.',
  (req, e, id) => servicio.agregarCausa(req.repo, e, id, req.body)));
router.post('/eventos/:id(\\d+)/causas/:x(\\d+)/retirar', gestionar, accion(aEvento, 'Causa retirada.',
  (req, e, id) => servicio.retirarElemento(req.repo, e, id, 'evento_causa', entero(req.params.x))));
router.post('/eventos/:id(\\d+)/investigacion/cerrar', gestionar, accion(aEvento, 'Investigación cerrada.',
  (req, e, id) => servicio.cerrarInvestigacion(req.repo, e, id, req.body)));
router.post('/eventos/:id(\\d+)/informe-arl', gestionar, accion(aEvento, 'Informe radicado ante la ARL.',
  (req, e, id) => servicio.radicarInformeArl(req.repo, e, id, req.body)));
router.post('/eventos/:id(\\d+)/acciones', gestionar, accion(aEvento, 'Acción agregada al plan.',
  (req, e, id) => servicio.crearAccion(req.repo, e, id, req.body)));
router.post('/eventos/:id(\\d+)/acciones/:a(\\d+)/cerrar', gestionar, accion(aEvento, 'Acción cerrada.',
  (req, e) => autoevaluacion.cerrarAccion(req.repo, e, entero(req.params.a), { fecha: req.body.fecha, observacion: req.body.observacion })));
router.post('/eventos/:id(\\d+)/cerrar', gestionar, accion(aEvento, 'Evento cerrado.',
  (req, e, id) => servicio.cerrar(req.repo, e, id)));
router.post('/eventos/:id(\\d+)/anular', gestionar, accion(aEvento, 'Evento anulado junto con sus obligaciones abiertas.',
  (req, e, id) => servicio.anular(req.repo, e, id, req.body.motivo)));

module.exports = router;
