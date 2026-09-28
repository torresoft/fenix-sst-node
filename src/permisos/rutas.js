// M15: permisos de trabajo de alto riesgo.
const express = require('express');
const { requiereSesion, requiereEmpresa } = require('../middleware/auth');
const { hoyBogota, sumarDias } = require('../fechas/calendario');
const { ROLES_VER, ROLES_GESTIONAR, entero, puede, accion, requiereRol } = require('../comun/rutas');
const servicio = require('./servicio');

const router = express.Router();
const gestionar = requiereRol(...ROLES_GESTIONAR);
const aPermiso = (req, id) => `/permisos/${id || entero(req.params.id)}`;

router.use('/permisos', requiereSesion, requiereEmpresa, requiereRol(...ROLES_VER));

router.get('/permisos', async (req, res, next) => {
  try {
    const e = req.session.empresa.id;
    const hoy = hoyBogota();
    const [filas, tipos, personas, centros, formatos] = await Promise.all([
      servicio.listar(req.repo, e, sumarDias(hoy, -90)), servicio.tipos(),
      req.repo.consultar(
        `SELECT p.id, p.nombres, p.apellidos, MIN(v.tipo) AS tipo FROM persona p JOIN vinculacion v ON v.tenant_id = {tenant} AND v.persona_id = p.id AND v.empresa_id = ? AND v.estado = 'activa'
          WHERE p.tenant_id = {tenant} GROUP BY p.id, p.nombres, p.apellidos ORDER BY p.apellidos`, [e],
      ),
      req.repo.listar('centro_trabajo', { empresa_id: e }),
      req.repo.consultar(
        "SELECT id, codigo, version, tipo_documental FROM documento_sst WHERE tenant_id = {tenant} AND empresa_id = ? AND tipo_documental IN ('PERMISO_ALTURAS','PERMISO_CONFINADO') AND estado = 'vigente' ORDER BY id DESC LIMIT 50", [e],
      ),
    ]);
    res.render('permisos/index', {
      titulo: 'Permisos de alto riesgo', filas, tipos, personas, centros, formatos, hoy, gestionar: puede(req), scripts: ['/js/permisos/index.js'],
    });
  } catch (err) {
    next(err);
  }
});

// Vista previa de la verificacion de un ejecutor (no emite nada).
router.get('/permisos/verificar', gestionar, async (req, res, next) => {
  try {
    const tipo = (await servicio.tipos()).find((t) => t.codigo === req.query.tipo);
    if (!tipo) return res.status(422).json({ ok: false, error: 'Tipo invalido' });
    const fecha = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.fecha || '')) ? req.query.fecha : hoyBogota();
    return res.json({ ok: true, verificacion: await servicio.verificarPersona(req.repo, req.session.empresa.id, entero(req.query.persona_id), tipo, fecha) });
  } catch (err) {
    if (err.status === 422) return res.status(422).json({ ok: false, error: err.message });
    return next(err);
  }
});

router.get('/permisos/:id(\\d+)', async (req, res, next) => {
  try {
    const d = await servicio.detalle(req.repo, req.session.empresa.id, entero(req.params.id));
    res.render('permisos/detalle', { titulo: `Permiso ${d.permiso.numero}`, ...d, gestionar: puede(req) });
  } catch (err) {
    next(err);
  }
});

router.post('/permisos', gestionar, accion('Permiso emitido.', (req, e) => servicio.emitir(req.repo, e, req.body), (req, id) => (id ? aPermiso(req, id) : '/permisos')));
['cerrado', 'suspendido', 'anulado'].forEach((estado) => {
  router.post(`/permisos/:id(\\d+)/${estado}`, gestionar, accion(`Permiso ${estado}.`,
    (req, e) => servicio.cambiarEstado(req.repo, e, entero(req.params.id), estado, req.body.observacion), (req) => aPermiso(req)));
});

module.exports = router;
