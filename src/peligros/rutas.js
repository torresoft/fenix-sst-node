// M05: matriz de peligros de la empresa activa.
const express = require('express');
const { requiereSesion, requiereEmpresa } = require('../middleware/auth');
const { hoyBogota } = require('../fechas/calendario');
const { ROLES_VER, ROLES_GESTIONAR, entero, puede, accion, requiereRol } = require('../comun/rutas');
const personas = require('../personas/servicio');
const servicio = require('./servicio');

const router = express.Router();
const gestionar = requiereRol(...ROLES_GESTIONAR);
const aMatriz = (req, r) => `/peligros/${(r && r.matriz) || entero(req.params.m)}`;

router.use('/peligros', requiereSesion, requiereEmpresa, requiereRol(...ROLES_VER));

router.get('/peligros', async (req, res, next) => {
  try {
    const versiones = await servicio.listar(req.repo, req.session.empresa.id);
    const actual = versiones.find((v) => v.estado === 'borrador') || versiones.find((v) => v.estado === 'vigente');
    if (actual) return res.redirect(`/peligros/${actual.id}`);
    return res.render('peligros/vacio', { titulo: 'Peligros y riesgos', gestionar: puede(req) });
  } catch (err) {
    return next(err);
  }
});

router.post('/peligros', gestionar, accion('Versión en borrador creada.',
  async (req, e) => ({ matriz: await servicio.crearVersion(req.repo, e, req.body) }),
  (req, r) => (r ? `/peligros/${r.matriz}` : '/peligros')));

router.get('/peligros/:m(\\d+)', async (req, res, next) => {
  try {
    const empresaId = req.session.empresa.id;
    const [d, versiones, documentos] = await Promise.all([
      servicio.detalle(req.repo, empresaId, entero(req.params.m)),
      servicio.listar(req.repo, empresaId),
      req.repo.consultar(
        "SELECT id, codigo, version, estado FROM documento_sst WHERE tenant_id = {tenant} AND empresa_id = ? AND tipo_documental = 'MATRIZ_PELIGROS' AND estado IN ('vigente','en_firma','borrador') ORDER BY codigo, version DESC", [empresaId],
      ),
    ]);
    res.render('peligros/matriz', {
      titulo: 'Peligros y riesgos', d, versiones, documentos, gestionar: puede(req), hoy: hoyBogota(),
      filtroNivel: req.query.nivel || '', scripts: ['/js/peligros/matriz.js'],
    });
  } catch (err) {
    next(err);
  }
});

router.get('/peligros/:m(\\d+)/csv', async (req, res, next) => {
  try {
    const d = await servicio.detalle(req.repo, req.session.empresa.id, entero(req.params.m));
    await req.repo.auditar('exportar', 'matriz_riesgo', d.m.id);
    res.set('Content-Type', 'text/csv; charset=utf-8');
    res.set('Content-Disposition', `attachment; filename="matriz-peligros-v${d.m.version}.csv"`);
    res.send(servicio.aCsv(d));
  } catch (err) {
    next(err);
  }
});

async function formularioItem(req, res, { item = null, valores = {}, error = null }) {
  const empresaId = req.session.empresa.id;
  const d = await servicio.detalle(req.repo, empresaId, entero(req.params.m));
  const [cargos, centros, tipos, previos] = await Promise.all([
    personas.cargos(req.repo, empresaId, { soloActivos: true }), personas.centrosActivos(req.repo, empresaId),
    servicio.catalogo.peligrosTipo(), servicio.valoresPrevios(req.repo, empresaId),
  ]);
  res.status(error ? 422 : 200).render('peligros/item', {
    titulo: item ? 'Editar peligro' : 'Nuevo peligro', d, item, valores, error, cargos, centros, tipos, previos, scripts: ['/js/peligros/item.js'],
  });
}

router.get('/peligros/:m(\\d+)/items/nuevo', gestionar, (req, res, next) => formularioItem(req, res, { valores: { rutinaria: '1', nd: 'M', ne: 'EO', nc: 'L' } }).catch(next));

router.get('/peligros/:m(\\d+)/items/:i(\\d+)', gestionar, async (req, res, next) => {
  try {
    const d = await servicio.detalle(req.repo, req.session.empresa.id, entero(req.params.m));
    const item = d.items.find((x) => x.id === entero(req.params.i));
    if (!item) return next();
    return formularioItem(req, res, { item, valores: { ...item, cargos: item.cargos.map((c) => c.id) } });
  } catch (err) {
    return next(err);
  }
});

router.post(['/peligros/:m(\\d+)/items', '/peligros/:m(\\d+)/items/:i(\\d+)'], gestionar, async (req, res, next) => {
  try {
    const r = await servicio.guardarItem(req.repo, req.session.empresa.id, entero(req.params.m), entero(req.params.i), req.body);
    req.session.aviso = { tipo: r.critico ? 'warning' : 'success', texto: `Peligro valorado: riesgo ${r.nivel_riesgo} (NR ${r.nr}, ${r.aceptabilidad}).` };
    res.redirect(`/peligros/${entero(req.params.m)}#item-${r.id}`);
  } catch (err) {
    if (err.status === 422) {
      const d = entero(req.params.i) ? { id: entero(req.params.i) } : null;
      return formularioItem(req, res, { item: d, valores: req.body, error: err.message }).catch(next);
    }
    if (err.status === 409) {
      req.session.aviso = { tipo: 'danger', texto: err.message };
      return res.redirect(`/peligros/${entero(req.params.m)}`);
    }
    return next(err);
  }
});

router.get('/peligros/:m(\\d+)/sugerir', gestionar, async (req, res, next) => {
  try {
    const empresaId = req.session.empresa.id;
    const [d, cargos, tipos] = await Promise.all([
      servicio.detalle(req.repo, empresaId, entero(req.params.m)), servicio.cargosParaSugerir(req.repo, empresaId), servicio.catalogo.cargosTipo(),
    ]);
    if (d.m.estado !== 'borrador') return res.redirect(`/peligros/${d.m.id}`);
    return res.render('peligros/sugerir', {
      titulo: 'Sugerir peligros por cargo', subtitulo: `Matriz versión ${d.m.version}`, d, cargos, tipos,
    });
  } catch (err) {
    return next(err);
  }
});

router.post('/peligros/:m(\\d+)/sugerir', gestionar, accion(
  (r) => `Se agregaron ${r.nuevos} peligro(s) sugerido(s) y se vincularon ${r.vinculados} cargo(s) a peligros existentes. Revise cada valoración antes de publicar.`,
  (req, e) => servicio.generarDesdeCargos(req.repo, e, entero(req.params.m), req.body),
  (req, r) => (r ? aMatriz(req) : `/peligros/${entero(req.params.m)}/sugerir`)));

router.post('/peligros/:m(\\d+)/items/:i(\\d+)/retirar', gestionar, accion('Peligro retirado de la matriz.',
  (req, e) => servicio.retirarItem(req.repo, e, entero(req.params.m), entero(req.params.i)), aMatriz));
router.post('/peligros/:m(\\d+)/datos', gestionar, accion('Datos de la matriz guardados.',
  (req, e) => servicio.guardarDatos(req.repo, e, entero(req.params.m), req.body), aMatriz));
router.post('/peligros/:m(\\d+)/publicar', gestionar, accion(
  (n) => (n ? `Matriz publicada. Se cumplieron ${n} actualización(es) pendiente(s) por AT mortal.` : 'Matriz publicada como vigente.'),
  (req, e) => servicio.publicar(req.repo, e, entero(req.params.m)), aMatriz));
router.post('/peligros/:m(\\d+)/anular', gestionar, accion('Borrador descartado.',
  (req, e) => servicio.anular(req.repo, e, entero(req.params.m)), () => '/peligros'));
router.post('/peligros/items/:i(\\d+)/controles', gestionar, accion('Medida de intervención agregada.',
  async (req, e) => ({ matriz: await servicio.agregarControl(req.repo, e, entero(req.params.i), req.body) }),
  (req, r) => (r ? `/peligros/${r.matriz}#item-${entero(req.params.i)}` : '/peligros')));
router.post('/peligros/controles/:c(\\d+)/cerrar', gestionar, accion('Medida actualizada.',
  async (req, e) => ({ matriz: await servicio.cerrarControl(req.repo, e, entero(req.params.c), req.body) }),
  (req, r) => (r ? `/peligros/${r.matriz}` : '/peligros')));

module.exports = router;
