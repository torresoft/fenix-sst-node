// Matriz legal de la empresa activa y auditor de matrices declaradas.
const express = require('express');
const cuentas = require('../db/cuentas');
const { requiereSesion, requiereEmpresa, requiereRol } = require('../middleware/auth');
const servicio = require('./servicio');
const { aCsv } = require('./informe');

const router = express.Router();

const ROLES_VER = ['admin_tenant', 'responsable_sst', 'consultor_sst', 'gerente', 'auditor'];
const ROLES_GESTIONAR = ['admin_tenant', 'responsable_sst', 'consultor_sst'];

const entero = (v) => { const n = Number.parseInt(v, 10); return Number.isSafeInteger(n) && n > 0 ? n : null; };
const puedeGestionar = (req) => (req.session.empresa.roles || []).some((r) => ROLES_GESTIONAR.includes(r));
const json = (v) => (typeof v === 'string' ? JSON.parse(v) : v);

// POST: errores de validacion vuelven como aviso a la pagina de origen.
const accion = (destino, fn) => async (req, res, next) => {
  try {
    const texto = await fn(req);
    req.session.aviso = { tipo: 'success', texto };
    res.redirect(typeof destino === 'function' ? destino(req) : destino);
  } catch (err) {
    if (err.status === 422 || err.status === 409) {
      req.session.aviso = { tipo: 'danger', texto: err.message };
      return res.redirect(typeof destino === 'function' ? destino(req, true) : destino);
    }
    return next(err);
  }
};

router.use('/matriz-legal', requiereSesion, requiereEmpresa, requiereRol(...ROLES_VER));

router.get('/matriz-legal', async (req, res, next) => {
  try {
    const empresaId = req.session.empresa.id;
    const [m, boletines, usuarios] = await Promise.all([
      servicio.matriz(req.repo, empresaId),
      servicio.boletinesPendientes(req.repo, empresaId),
      cuentas.usuariosDeTenants([req.repo.tenantId]),
    ]);
    const nombres = new Map(usuarios.map((u) => [u.id, u.nombre]));
    const grupos = m.ambitos
      .filter((a) => m.activos.has(a.codigo))
      .map((a) => ({ ambito: a, filas: m.aplicables.filter((f) => f.norma.ambito === a.codigo) }))
      .filter((g) => g.filas.length);

    res.render('matriz/index', {
      titulo: 'Matriz legal',
      m,
      grupos,
      nombres,
      responsables: usuarios,
      boletines: boletines.map((b) => ({ ...b, motivo: json(b.motivo) })),
      gestionar: puedeGestionar(req),
      scripts: ['/js/matriz/matriz.js'],
    });
  } catch (err) {
    next(err);
  }
});

router.get('/matriz-legal/documentos', async (req, res, next) => {
  try {
    const docs = await servicio.documentosVigentes(req.repo, req.session.empresa.id);
    res.json({ ok: true, documentos: docs });
  } catch (err) {
    next(err);
  }
});

router.post('/matriz-legal/perfil', requiereRol(...ROLES_GESTIONAR), accion('/matriz-legal', async (req) => {
  await servicio.guardarPerfil(req.repo, req.session.empresa.id, req.body.ambitos);
  return 'Perfil de aplicabilidad actualizado.';
}));

router.post('/matriz-legal/item', requiereRol(...ROLES_GESTIONAR), accion(
  (req) => `/matriz-legal#norma-${encodeURIComponent(String(req.body.norma_codigo || ''))}`,
  async (req) => {
    await servicio.guardarItem(req.repo, req.session.empresa.id, {
      normaCodigo: req.body.norma_codigo,
      estadoCumplimiento: req.body.estado_cumplimiento,
      responsableId: req.body.responsable_id,
      observacion: req.body.observacion,
      documentos: req.body.documentos,
    });
    return 'Evaluación guardada.';
  },
));

router.post('/matriz-legal/boletines/:id/revisar', requiereRol(...ROLES_GESTIONAR), accion('/matriz-legal', async (req) => {
  await servicio.revisarBoletin(req.repo, req.session.empresa.id, entero(req.params.id), req.body.observacion);
  return 'Cambio normativo marcado como revisado.';
}));

router.get('/matriz-legal/auditor', async (req, res, next) => {
  try {
    const historial = await servicio.listarAuditorias(req.repo, req.session.empresa.id);
    const nombres = await cuentas.nombresUsuarios(historial.map((h) => h.creado_por));
    res.render('matriz/auditor', {
      titulo: 'Auditor de matriz legal',
      historial: historial.map((h) => ({ ...h, autor: nombres.get(h.creado_por) || '' })),
      gestionar: puedeGestionar(req),
      scripts: ['/js/matriz/auditor.js'],
    });
  } catch (err) {
    next(err);
  }
});

router.post('/matriz-legal/auditor', requiereRol(...ROLES_GESTIONAR), async (req, res, next) => {
  try {
    const id = await servicio.ejecutarAuditoria(req.repo, req.session.empresa.id, {
      texto: req.body.texto, fuente: req.body.fuente, nombreArchivo: req.body.nombre_archivo,
    });
    res.redirect(`/matriz-legal/auditor/${id}`);
  } catch (err) {
    if (err.status === 422) {
      req.session.aviso = { tipo: 'danger', texto: err.message };
      return res.redirect('/matriz-legal/auditor');
    }
    return next(err);
  }
});

async function cargarInforme(req, accionLog = 'consultar') {
  const id = entero(req.params.id);
  if (!id) {
    const err = new Error('Auditoria no encontrada');
    err.status = 404;
    throw err;
  }
  const auditoria = await servicio.obtenerAuditoria(req.repo, req.session.empresa.id, id);
  const empresa = await req.repo.obtener('empresa', req.session.empresa.id);
  await req.repo.auditar(accionLog, 'auditoria_matriz', id);
  return { auditoria, empresa };
}

router.get('/matriz-legal/auditor/:id', async (req, res, next) => {
  try {
    const { auditoria, empresa } = await cargarInforme(req);
    const autor = (await cuentas.nombresUsuarios([auditoria.creado_por])).get(auditoria.creado_por) || '';
    res.render('matriz/informe', {
      titulo: `Informe de auditor&iacute;a #${auditoria.id}`,
      a: auditoria,
      r: auditoria.resultado,
      ambitos: Object.entries(json(auditoria.ambitos_evaluados) || {}),
      empresa,
      autor,
      scripts: ['/js/matriz/informe.js'],
    });
  } catch (err) {
    next(err);
  }
});

router.get('/matriz-legal/auditor/:id/csv', async (req, res, next) => {
  try {
    const { auditoria, empresa } = await cargarInforme(req, 'exportar');
    res.set('Content-Type', 'text/csv; charset=utf-8');
    res.set('Content-Disposition', `attachment; filename="auditoria-matriz-legal-${auditoria.id}.csv"`);
    res.send(aCsv(auditoria, empresa));
  } catch (err) {
    next(err);
  }
});

module.exports = router;
