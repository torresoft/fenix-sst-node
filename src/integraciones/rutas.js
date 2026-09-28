// Integraciones por archivo: simular, revisar y aplicar. El archivo simulado queda en la sesion hasta aplicarlo.
const express = require('express');
const multer = require('multer');
const { requiereSesion, requiereEmpresa } = require('../middleware/auth');
const { ROLES_GESTIONAR, entero, requiereRol } = require('../comun/rutas');
const servicio = require('./servicio');
const csv = require('./csv');

const router = express.Router();
const TABS = ['nomina', 'pila', 'furat', 'cargue'];
const MAX_BYTES = 2 * 1048576;

const subir = (req, res, next) => multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_BYTES, files: 1, fields: 10 } })
  .single('archivo')(req, res, (err) => {
    if (!err) return next();
    const e = new Error(err.code === 'LIMIT_FILE_SIZE' ? 'El archivo supera 2 MB' : 'No se pudo recibir el archivo');
    e.status = 422;
    return next(e);
  });

router.use('/integraciones', requiereSesion, requiereEmpresa, requiereRol(...ROLES_GESTIONAR));

async function pagina(req, res, extra = {}) {
  const e = req.session.empresa.id;
  const tab = extra.tab || (TABS.includes(req.query.tab) ? req.query.tab : 'nomina');
  const [historial, eventos, autoevaluaciones] = await Promise.all([
    servicio.historial(req.repo, e),
    tab === 'furat' ? req.repo.consultar(
      `SELECT e.id, e.codigo, e.tipo, e.gravedad, e.fecha_base, p.nombres, p.apellidos FROM evento e LEFT JOIN persona p ON p.tenant_id = {tenant} AND p.id = e.persona_id
        WHERE e.tenant_id = {tenant} AND e.empresa_id = ? AND e.tipo <> 'incidente' AND e.estado <> 'anulado' ORDER BY e.fecha_base DESC LIMIT 100`, [e],
    ) : [],
    tab === 'cargue' ? req.repo.consultar(
      "SELECT id, vigencia_anio, estado, puntaje FROM autoevaluacion WHERE tenant_id = {tenant} AND empresa_id = ? ORDER BY vigencia_anio DESC, id DESC", [e],
    ) : [],
  ]);
  res.render('integraciones/index', {
    titulo: 'Integraciones', tab, historial, eventos, autoevaluaciones, pendiente: req.session.importacion || null,
    columnas: { nomina: servicio.COLUMNAS_NOMINA, pila: servicio.COLUMNAS_PILA }, resultado: null, aplicado: false, ...extra,
  });
}

router.get('/integraciones', async (req, res, next) => {
  try {
    await pagina(req, res);
  } catch (err) {
    next(err);
  }
});

router.get('/integraciones/plantilla/:tipo(nomina|pila).csv', (req, res) => {
  const cols = req.params.tipo === 'nomina' ? servicio.COLUMNAS_NOMINA : servicio.COLUMNAS_PILA;
  res.set({ 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="plantilla-${req.params.tipo}.csv"` });
  res.send(csv.generar([cols]));
});

router.post('/integraciones/:tipo(nomina|pila)/simular', subir, async (req, res, next) => {
  const { tipo } = req.params;
  try {
    const resultado = await servicio[tipo](req.repo, req.session.empresa.id, req.file, { aplicar: false });
    req.session.importacion = {
      tipo, tenantId: req.session.empresa.tenantId, empresaId: req.session.empresa.id, nombre: req.file.originalname, datos: req.file.buffer.toString('base64'),
    };
    await pagina(req, res, { tab: tipo, resultado, aplicado: false });
  } catch (err) {
    if (err.status !== 422) return next(err);
    req.session.aviso = { tipo: 'danger', texto: err.message };
    return res.redirect(`/integraciones?tab=${tipo}`);
  }
});

router.post('/integraciones/:tipo(nomina|pila)/aplicar', async (req, res, next) => {
  const { tipo } = req.params;
  const p = req.session.importacion;
  // Lo simulado se aplica solo en la misma empresa donde se reviso.
  if (!p || p.tipo !== tipo || p.tenantId !== req.session.empresa.tenantId || p.empresaId !== req.session.empresa.id) {
    req.session.aviso = { tipo: 'danger', texto: 'Simule primero el archivo' };
    return res.redirect(`/integraciones?tab=${tipo}`);
  }
  try {
    const archivo = { originalname: p.nombre, buffer: Buffer.from(p.datos, 'base64') };
    const resultado = await servicio[tipo](req.repo, req.session.empresa.id, archivo, { aplicar: true });
    delete req.session.importacion;
    return pagina(req, res, { tab: tipo, resultado, aplicado: true });
  } catch (err) {
    return next(err);
  }
});

router.get('/integraciones/furat/:id(\\d+).csv', async (req, res, next) => {
  try {
    const r = await servicio.furat(req.repo, req.session.empresa.id, entero(req.params.id));
    res.set({ 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${r.nombre}"` });
    res.send(r.contenido);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
