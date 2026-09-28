// Tablero del consultor ("Mis empresas"): semaforo de toda la cartera sin cambiar de empresa.
const express = require('express');
const { requiereSesion } = require('../middleware/auth');
const servicio = require('./servicio');

const router = express.Router();
const NIVELES = ['rojo', 'amarillo', 'verde'];

router.use('/mis-empresas', requiereSesion);

async function cartera(req) {
  const c = await servicio.cartera(req.session.usuario.id, req.actor);
  if (!c.filas.length) {
    const err = new Error('No tiene empresas con rol del SG-SST');
    err.status = 403;
    throw err;
  }
  return c;
}

router.get('/mis-empresas', async (req, res, next) => {
  try {
    const c = await cartera(req);
    const q = String(req.query.q || '').trim().toLowerCase().slice(0, 100);
    const nivel = NIVELES.includes(req.query.nivel) ? req.query.nivel : '';
    const filas = c.filas.filter((f) => (!nivel || f.semaforo.nivel === nivel)
      && (!q || f.razon_social.toLowerCase().includes(q) || String(f.nit).includes(q)));
    res.render('consultor/tablero', {
      titulo: 'Mis empresas', subtitulo: 'Estado del SG-SST de toda la cartera', c, filas, q, nivel,
    });
  } catch (err) {
    next(err);
  }
});

router.get('/mis-empresas.csv', requiereSesion, async (req, res, next) => {
  try {
    const c = await cartera(req);
    res.set('Content-Type', 'text/csv; charset=utf-8');
    res.set('Content-Disposition', 'attachment; filename="mis-empresas.csv"');
    res.send(servicio.aCsv(c.filas));
  } catch (err) {
    next(err);
  }
});

module.exports = router;
