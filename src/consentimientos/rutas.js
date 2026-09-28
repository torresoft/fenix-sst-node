// Autorizaciones de tratamiento de datos: matriz de la empresa y canal del titular.
const express = require('express');
const { requiereSesion, requiereEmpresa } = require('../middleware/auth');
const { ROLES_VER, ROLES_GESTIONAR, entero, puede, accion, requiereRol } = require('../comun/rutas');
const servicio = require('./servicio');

const router = express.Router();
const gestionar = requiereRol(...ROLES_GESTIONAR);

router.get('/consentimientos', requiereSesion, requiereEmpresa, requiereRol(...ROLES_VER), async (req, res, next) => {
  try {
    const e = req.session.empresa.id;
    const [m, soportes] = await Promise.all([
      servicio.matriz(req.repo, e),
      req.repo.consultar(
        "SELECT id, codigo, version, persona_id FROM documento_sst WHERE tenant_id = {tenant} AND empresa_id = ? AND tipo_documental = 'AUTORIZACION_DATOS' AND estado = 'vigente' ORDER BY codigo", [e],
      ),
    ]);
    res.render('consentimientos/index', {
      titulo: 'Autorizaciones de datos', m, soportes, gestionar: puede(req), scripts: ['/js/consentimientos/index.js'],
    });
  } catch (err) {
    next(err);
  }
});

// Registro en nombre del titular: solo con soporte fisico o verbal (no sensibles).
router.post('/consentimientos', requiereSesion, requiereEmpresa, gestionar, accion('Autorización registrada.', async (req, e) => {
  if (req.body.medio === 'web') throw Object.assign(new Error('La autorización web solo la otorga el titular desde Mis registros'), { status: 422 });
  const [v] = await req.repo.listar('vinculacion', { empresa_id: e, persona_id: entero(req.body.persona_id) });
  if (!v) throw Object.assign(new Error('La persona no tiene vinculación con la empresa'), { status: 422 });
  return servicio.registrar(req.repo, v.persona_id, req.body);
}, () => '/consentimientos'));

router.post('/mis-registros/autorizacion', requiereSesion, requiereEmpresa, accion('Decisión registrada.', async (req) => {
  const p = await servicio.personaDeUsuario(req.repo, req.session.usuario.id);
  return servicio.registrar(req.repo, p.id, { finalidad: req.body.finalidad, otorgado: req.body.otorgado, medio: 'web' });
}, () => '/mis-registros?tab=autorizaciones'));

router.post('/mis-registros/autorizacion/:id(\\d+)/revocar', requiereSesion, requiereEmpresa, accion('Autorización revocada.', async (req) => {
  const p = await servicio.personaDeUsuario(req.repo, req.session.usuario.id);
  return servicio.revocar(req.repo, p.id, entero(req.params.id));
}, () => '/mis-registros?tab=autorizaciones'));

module.exports = router;
