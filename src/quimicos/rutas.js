// M18: inventario de productos quimicos (SGA).
const express = require('express');
const { requiereSesion, requiereEmpresa } = require('../middleware/auth');
const { ROLES_VER, ROLES_GESTIONAR, entero, puede, accion, requiereRol } = require('../comun/rutas');
const servicio = require('./servicio');

const router = express.Router();
const gestionar = requiereRol(...ROLES_GESTIONAR);

router.use('/quimicos', requiereSesion, requiereEmpresa, requiereRol(...ROLES_VER));

router.get('/quimicos', async (req, res, next) => {
  try {
    const e = req.session.empresa.id;
    const [inv, centros, fds, ambitos] = await Promise.all([
      servicio.inventario(req.repo, e),
      req.repo.listar('centro_trabajo', { empresa_id: e }),
      req.repo.consultar(
        "SELECT id, codigo, version, titulo, fecha_documento FROM documento_sst WHERE tenant_id = {tenant} AND empresa_id = ? AND tipo_documental = 'FDS' AND estado = 'vigente' ORDER BY titulo", [e],
      ),
      req.repo.listar('empresa_ambito', { empresa_id: e }),
    ]);
    res.render('quimicos/index', {
      titulo: 'Productos químicos', inv, centros, fds, pictogramas: servicio.PICTOGRAMAS, declarado: ambitos.some((a) => a.ambito === 'quimicos'),
      gestionar: puede(req), scripts: ['/js/quimicos/index.js'],
    });
  } catch (err) {
    next(err);
  }
});

router.post('/quimicos', gestionar, accion('Producto registrado.', (req, e) => servicio.registrar(req.repo, e, req.body), () => '/quimicos'));
router.post('/quimicos/:id(\\d+)/fds', gestionar, accion('FDS actualizada.', (req, e) => servicio.actualizarFds(req.repo, e, entero(req.params.id), req.body), () => '/quimicos'));
router.post('/quimicos/:id(\\d+)/inactivar', gestionar, accion('Producto retirado del inventario.',
  (req, e) => servicio.inactivar(req.repo, e, entero(req.params.id), req.body.motivo), () => '/quimicos'));

module.exports = router;
