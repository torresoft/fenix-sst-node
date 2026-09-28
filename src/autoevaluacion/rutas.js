// M11: autoevaluacion de estandares minimos de la empresa activa.
const express = require('express');
const cuentas = require('../db/cuentas');
const { requiereSesion, requiereEmpresa, requiereRol } = require('../middleware/auth');
const { hoyBogota } = require('../fechas/calendario');
const matriz = require('../matriz/servicio');
const servicio = require('./servicio');
const { aCsv } = require('./exportar');

const router = express.Router();

const ROLES_VER = ['admin_tenant', 'responsable_sst', 'consultor_sst', 'gerente', 'auditor'];
const ROLES_GESTIONAR = ['admin_tenant', 'responsable_sst', 'consultor_sst'];
const gestionar = requiereRol(...ROLES_GESTIONAR);
const puedeGestionar = (req) => (req.session.empresa.roles || []).some((r) => ROLES_GESTIONAR.includes(r));
const entero = (v) => { const n = Number.parseInt(v, 10); return Number.isSafeInteger(n) && n > 0 ? n : null; };

// POST con aviso: 422/409 vuelven a la pagina de origen con el mensaje.
const accion = (destino, fn) => async (req, res, next) => {
  const ir = (r) => (typeof destino === 'function' ? destino(req, r) : destino);
  try {
    const r = await fn(req);
    req.session.aviso = { tipo: r.tipo || 'success', texto: r.texto };
    res.redirect(ir(r));
  } catch (err) {
    if (err.status === 422 || err.status === 409) {
      req.session.aviso = { tipo: 'danger', texto: err.message };
      return res.redirect(ir(null));
    }
    return next(err);
  }
};
const aDetalle = (req) => `/autoevaluacion/${entero(req.params.id)}`;

router.use('/autoevaluacion', requiereSesion, requiereEmpresa, requiereRol(...ROLES_VER));

router.get('/autoevaluacion', async (req, res, next) => {
  try {
    const empresaId = req.session.empresa.id;
    const [c, historial] = await Promise.all([
      servicio.verificarClasificacion(req.repo, empresaId),
      servicio.listar(req.repo, empresaId),
    ]);
    const anio = Number(hoyBogota().slice(0, 4));
    res.render('autoevaluacion/index', {
      titulo: 'Autoevaluaci&oacute;n de est&aacute;ndares m&iacute;nimos',
      c, historial, gestionar: puedeGestionar(req),
      vigenciaSugerida: anio, corteSugerido: `${anio}-12-15`,
    });
  } catch (err) {
    next(err);
  }
});

router.post('/autoevaluacion/clasificacion/:id(\\d+)/revisar', gestionar, accion('/autoevaluacion', async (req) => {
  await servicio.revisarClasificacion(req.repo, req.session.empresa.id, entero(req.params.id));
  return { texto: 'Reclasificación revisada.' };
}));

router.post('/autoevaluacion/iniciar', gestionar, accion((req, r) => (r ? `/autoevaluacion/${r.id}` : '/autoevaluacion'), async (req) => {
  const id = await servicio.iniciar(req.repo, req.session.empresa.id, { vigencia: req.body.vigencia, fechaCorte: req.body.fecha_corte });
  return { id, texto: 'Autoevaluación iniciada en borrador.' };
}));

router.get('/autoevaluacion/documentos', async (req, res, next) => {
  try {
    res.json({ ok: true, documentos: await matriz.documentosVigentes(req.repo, req.session.empresa.id) });
  } catch (err) {
    next(err);
  }
});

router.get('/autoevaluacion/:id(\\d+)', async (req, res, next) => {
  try {
    const empresaId = req.session.empresa.id;
    const d = await servicio.detalle(req.repo, empresaId, entero(req.params.id));
    const [acciones, usuarios] = await Promise.all([
      servicio.acciones(req.repo, empresaId, d.autoevaluacion.id),
      cuentas.usuariosDeTenants([req.repo.tenantId]),
    ]);
    const nombres = new Map(usuarios.map((u) => [u.id, u.nombre]));
    res.render('autoevaluacion/detalle', {
      titulo: `Autoevaluaci&oacute;n ${d.autoevaluacion.vigencia_anio}`,
      d, acciones: acciones.map((x) => ({ ...x, responsable: nombres.get(x.responsable_id) || '' })),
      responsables: usuarios, gestionar: puedeGestionar(req), hoy: hoyBogota(),
      scripts: ['/js/autoevaluacion/detalle.js'],
    });
  } catch (err) {
    next(err);
  }
});

router.post('/autoevaluacion/:id(\\d+)/evidencia', gestionar, accion((req) => `${aDetalle(req)}#n-${encodeURIComponent(String(req.body.numeral || ''))}`, async (req) => {
  const a = await servicio.detalle(req.repo, req.session.empresa.id, entero(req.params.id));
  if (a.autoevaluacion.estado !== 'borrador') {
    const e = new Error('Solo se vincula evidencia con la autoevaluacion en borrador');
    e.status = 409;
    throw e;
  }
  await servicio.vincularEvidencia(req.repo, req.session.empresa.id, req.body.numeral, req.body.documentos);
  return { texto: 'Evidencia actualizada.' };
}));

router.post('/autoevaluacion/:id(\\d+)/no-aplica', gestionar, accion((req) => `${aDetalle(req)}#n-${encodeURIComponent(String(req.body.numeral || ''))}`, async (req) => {
  await servicio.marcarNoAplica(req.repo, req.session.empresa.id, entero(req.params.id), req.body.numeral, req.body.justificacion);
  return { texto: req.body.justificacion ? 'Numeral marcado como no aplica.' : 'Se retiró el no aplica.' };
}));

router.post('/autoevaluacion/:id(\\d+)/cerrar', gestionar, accion(aDetalle, async (req) => {
  const r = await servicio.cerrar(req.repo, req.session.empresa.id, entero(req.params.id));
  return {
    tipo: r.aviso ? 'warning' : 'success',
    texto: `Autoevaluación cerrada: ${r.puntaje} (${r.valoracion}).${r.aviso ? ` ${r.aviso}.` : ''}`,
  };
}));

router.post('/autoevaluacion/:id(\\d+)/version', gestionar, accion((req, r) => (r ? `/autoevaluacion/${r.id}` : aDetalle(req)), async (req) => {
  const id = await servicio.nuevaVersion(req.repo, req.session.empresa.id, entero(req.params.id));
  return { id, texto: 'Versión nueva creada en borrador. La anterior se reemplaza al cerrar esta.' };
}));

router.post('/autoevaluacion/:id(\\d+)/plan', gestionar, accion((req) => `${aDetalle(req)}#plan`, async (req) => {
  const n = await servicio.generarPlan(req.repo, req.session.empresa.id, entero(req.params.id), {
    responsableId: req.body.responsable_id, fechaLimite: req.body.fecha_limite,
  });
  return { texto: n ? `Plan de mejoramiento: ${n} acción(es) creada(s).` : 'Todas las brechas ya tenían acción.' };
}));

router.post('/autoevaluacion/:id(\\d+)/acciones/:accion(\\d+)/cerrar', gestionar, accion((req) => `${aDetalle(req)}#plan`, async (req) => {
  await servicio.cerrarAccion(req.repo, req.session.empresa.id, entero(req.params.accion), { fecha: req.body.fecha, observacion: req.body.observacion });
  return { texto: 'Acción cerrada.' };
}));

router.get('/autoevaluacion/:id(\\d+)/csv', async (req, res, next) => {
  try {
    const empresaId = req.session.empresa.id;
    const d = await servicio.detalle(req.repo, empresaId, entero(req.params.id));
    const [acc, usuarios, empresa] = await Promise.all([
      servicio.acciones(req.repo, empresaId, d.autoevaluacion.id),
      cuentas.usuariosDeTenants([req.repo.tenantId]),
      req.repo.obtener('empresa', empresaId),
    ]);
    const nombres = new Map(usuarios.map((u) => [u.id, u.nombre]));
    await req.repo.auditar('exportar', 'autoevaluacion', d.autoevaluacion.id);
    res.set('Content-Type', 'text/csv; charset=utf-8');
    res.set('Content-Disposition', `attachment; filename="autoevaluacion-${d.autoevaluacion.vigencia_anio}-v${d.autoevaluacion.version}.csv"`);
    res.send(aCsv(d, empresa, acc.map((x) => ({ ...x, responsable: nombres.get(x.responsable_id) || '' }))));
  } catch (err) {
    next(err);
  }
});

module.exports = router;
