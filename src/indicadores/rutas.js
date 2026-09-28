// M12: tablero de indicadores de la empresa activa.
const express = require('express');
const { requiereSesion, requiereEmpresa } = require('../middleware/auth');
const { hoyBogota } = require('../fechas/calendario');
const { ROLES_VER, ROLES_GESTIONAR, entero, puede, accion, requiereRol } = require('../comun/rutas');
const servicio = require('./servicio');

const router = express.Router();
const gestionar = requiereRol(...ROLES_GESTIONAR);
const volver = (req) => `/indicadores?anio=${entero(req.body.anio) || hoyBogota().slice(0, 4)}`;

router.use('/indicadores', requiereSesion, requiereEmpresa, requiereRol(...ROLES_VER));

router.get('/indicadores', async (req, res, next) => {
  try {
    const hoy = hoyBogota();
    const anio = entero(req.query.anio) || Number(hoy.slice(0, 4));
    res.render('indicadores/index', {
      titulo: 'Indicadores', anio, hoy, filas: await servicio.tablero(req.repo, req.session.empresa.id, anio),
      gestionar: puede(req), scripts: ['/js/indicadores/index.js'],
    });
  } catch (err) {
    next(err);
  }
});

router.post('/indicadores/calcular', gestionar, accion((n) => (n ? `Indicadores recalculados: ${n} valor(es) nuevo(s).` : 'Sin cambios desde el último cálculo.'), (req, e) => {
  const hoy = hoyBogota();
  const anio = entero(req.body.anio) || Number(hoy.slice(0, 4));
  if (anio < 2000 || anio > Number(hoy.slice(0, 4))) throw Object.assign(new Error('Anio invalido'), { status: 422 });
  const mes = anio === Number(hoy.slice(0, 4)) ? Number(hoy.slice(5, 7)) : 12;
  return servicio.calcular(req.repo, e, anio, mes);
}, volver));
router.post('/indicadores/manual', gestionar, accion('Medición registrada.', (req, e) => servicio.registrarManual(req.repo, e, req.body), volver));
router.post('/indicadores/ficha', gestionar, accion('Ficha técnica guardada.', (req, e) => servicio.guardarFicha(req.repo, e, req.body), volver));

module.exports = router;
