// M03: gestor documental (/documentos) y bandeja de firma electronica (/firmas).
const express = require('express');
const multer = require('multer');
const rateLimit = require('express-rate-limit');
const config = require('../config');
const cuentas = require('../db/cuentas');
const { consultarCatalogo } = require('../db/global');
const { requiereSesion, requiereEmpresa, requiereRol } = require('../middleware/auth');
const { hoyBogota } = require('../fechas/calendario');
const servicio = require('./servicio');

const router = express.Router();
// La firma pide la clave: mismo freno que el login contra fuerza bruta.
const limiteFirma = rateLimit({ windowMs: 15 * 60 * 1000, limit: 20, standardHeaders: true, legacyHeaders: false });
// Envio de OTP: cada llamada manda un correo; por usuario para no inundar buzones.
const limiteCodigo = rateLimit({
  windowMs: 15 * 60 * 1000, limit: 10, standardHeaders: true, legacyHeaders: false,
  keyGenerator: (req) => `u${req.session.usuario ? req.session.usuario.id : req.ip}`,
  message: { ok: false, mensaje: 'Demasiadas solicitudes de codigo. Intente en unos minutos.' },
});

const ROLES_VER = ['admin_tenant', 'responsable_sst', 'consultor_sst', 'gerente', 'auditor'];
const ROLES_GESTIONAR = ['admin_tenant', 'responsable_sst', 'consultor_sst'];
const ver = requiereRol(...ROLES_VER);
const gestionar = requiereRol(...ROLES_GESTIONAR);
const roles = (req) => req.session.empresa.roles || [];
const esLector = (req) => roles(req).some((r) => ROLES_VER.includes(r));
const puedeGestionar = (req) => roles(req).some((r) => ROLES_GESTIONAR.includes(r));
const entero = (v) => { const n = Number.parseInt(v, 10); return Number.isSafeInteger(n) && n > 0 ? n : null; };

// Un solo archivo en memoria: se hashea antes de tocar el disco.
const subirArchivo = (req, res, next) => multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: config.almacen.maxBytes, files: 1, fields: 60 },
}).single('archivo')(req, res, (err) => {
  if (!err) return next();
  const e = new Error(err.code === 'LIMIT_FILE_SIZE' ? `El archivo supera ${Math.round(config.almacen.maxBytes / 1048576)} MB` : 'No se pudo recibir el archivo');
  e.status = 422;
  return next(e);
});

const volver = (req, destino, err) => {
  req.session.aviso = { tipo: 'danger', texto: err.message };
  return destino;
};

async function datosFormulario(req) {
  const [tipos, normas, personas] = await Promise.all([
    servicio.tiposActivos(),
    consultarCatalogo("SELECT codigo, objeto FROM norma WHERE estado = 'activo' AND estado_vigencia IN ('vigente','vigente_parcial') ORDER BY codigo"),
    req.repo.listar('persona', { estado: 'activa' }, { orden: 'apellidos' }),
  ]);
  return { tipos, normas, personas };
}

async function renderFormulario(req, res, { modo, doc = null, valores = {}, error = null }) {
  const base = await datosFormulario(req);
  const accion = modo === 'crear' ? '/documentos' : `/documentos/${doc.id}/${modo === 'editar' ? 'editar' : 'nueva-version'}`;
  res.status(error ? 422 : 200).render('documentos/formulario', {
    titulo: modo === 'crear' ? 'Nuevo documento' : (modo === 'editar' ? 'Editar borrador' : 'Nueva versi&oacute;n'),
    modo, doc, valores, error, accion, maxMb: Math.round(config.almacen.maxBytes / 1048576), hoy: hoyBogota(), ...base,
    scripts: ['/js/documentos/formulario.js'],
  });
}

// Valores del formulario desde un documento existente (editar / nueva version).
function valoresDe(doc, normas) {
  return {
    tipo_documental: doc.tipo_documental, codigo: doc.codigo, titulo: doc.titulo, descripcion: doc.descripcion,
    fecha_documento: doc.fecha_documento, fecha_vence: doc.fecha_vence, vigencia_anio: doc.vigencia_anio,
    persona_id: doc.persona_id, modalidad_firma: doc.modalidad_firma, firmantes_externos: doc.firmantes_externos,
    referencia_custodio: doc.referencia_custodio, normas: normas.map((n) => n.norma_codigo),
  };
}

const normasDelCuerpo = (b) => [].concat(b['normas[]'] || b.normas || []);

router.use(['/documentos', '/firmas'], requiereSesion, requiereEmpresa);

// ---------- Documentos

router.get('/documentos', ver, async (req, res, next) => {
  try {
    const filtros = { tipo: req.query.tipo || '', estado: req.query.estado || '', q: req.query.q || '' };
    const [docs, tipos] = await Promise.all([servicio.listar(req.repo, req.session.empresa.id, filtros), servicio.tiposActivos()]);
    res.render('documentos/index', {
      titulo: 'Gestor documental', docs, tipos, filtros, gestionar: puedeGestionar(req),
    });
  } catch (err) {
    next(err);
  }
});

router.get('/documentos/nuevo', gestionar, async (req, res, next) => {
  try {
    await renderFormulario(req, res, { modo: 'crear', valores: { fecha_documento: hoyBogota(), tipo_documental: req.query.tipo || '' } });
  } catch (err) {
    next(err);
  }
});

router.post('/documentos', gestionar, subirArchivo, async (req, res, next) => {
  const valores = { ...req.body, normas: normasDelCuerpo(req.body) };
  try {
    const id = await servicio.crear(req.repo, req.session.empresa.id, valores, req.file);
    req.session.aviso = { tipo: 'success', texto: 'Documento creado en borrador.' };
    res.redirect(`/documentos/${id}`);
  } catch (err) {
    if (err.status === 422 || err.status === 409) return renderFormulario(req, res, { modo: 'crear', valores, error: err.message }).catch(next);
    return next(err);
  }
});

router.get('/documentos/retencion', ver, async (req, res, next) => {
  try {
    res.render('documentos/retencion', {
      titulo: 'Tabla de retenci&oacute;n documental', filas: await servicio.tablaRetencion(req.repo, req.session.empresa.id), gestionar: puedeGestionar(req),
    });
  } catch (err) {
    next(err);
  }
});

router.post('/documentos/retencion', gestionar, async (req, res, next) => {
  try {
    const valores = Object.fromEntries(Object.entries(req.body).filter(([k]) => k.startsWith('r_')).map(([k, v]) => [k.slice(2), v]));
    await servicio.guardarRetencion(req.repo, req.session.empresa.id, valores);
    req.session.aviso = { tipo: 'success', texto: 'Tabla de retención guardada.' };
    res.redirect('/documentos/retencion');
  } catch (err) {
    if (err.status === 422) return res.redirect(volver(req, '/documentos/retencion', err));
    return next(err);
  }
});

router.get('/documentos/:id(\\d+)', ver, async (req, res, next) => {
  try {
    const d = await servicio.detalle(req.repo, req.session.empresa.id, entero(req.params.id));
    const usuarios = await cuentas.usuariosDeTenants([req.repo.tenantId]);
    res.render('documentos/detalle', {
      titulo: `${d.doc.codigo} v${d.doc.version}`, d, usuarios, gestionar: puedeGestionar(req),
      verificacion: req.session.verificacion && req.session.verificacion.id === d.doc.id ? req.session.verificacion.resultado : null,
      scripts: ['/js/documentos/detalle.js'],
    });
    delete req.session.verificacion;
  } catch (err) {
    next(err);
  }
});

router.get('/documentos/:id(\\d+)/archivo', async (req, res, next) => {
  try {
    const a = await servicio.archivoParaDescargar(req.repo, req.session.empresa.id, entero(req.params.id), req.session.usuario.id, esLector(req));
    res.download(a.ruta, a.nombre, { headers: { 'Content-Type': a.mime || 'application/octet-stream' } }, (err) => {
      if (err && !res.headersSent) next(err);
    });
  } catch (err) {
    next(err);
  }
});

for (const modo of ['editar', 'nueva-version']) {
  router.get(`/documentos/:id(\\d+)/${modo}`, gestionar, async (req, res, next) => {
    try {
      const d = await servicio.detalle(req.repo, req.session.empresa.id, entero(req.params.id));
      const valores = valoresDe(d.doc, d.normas);
      if (modo === 'nueva-version') Object.assign(valores, { fecha_documento: hoyBogota(), fecha_vence: '' });
      await renderFormulario(req, res, { modo: modo === 'editar' ? 'editar' : 'version', doc: d.doc, valores });
    } catch (err) {
      next(err);
    }
  });

  router.post(`/documentos/:id(\\d+)/${modo}`, gestionar, subirArchivo, async (req, res, next) => {
    const id = entero(req.params.id);
    const valores = { ...req.body, normas: normasDelCuerpo(req.body) };
    try {
      const destino = modo === 'editar'
        ? (await servicio.editar(req.repo, req.session.empresa.id, id, valores, req.file), id)
        : await servicio.nuevaVersion(req.repo, req.session.empresa.id, id, valores, req.file);
      req.session.aviso = { tipo: 'success', texto: modo === 'editar' ? 'Borrador actualizado.' : 'Versión nueva creada en borrador.' };
      res.redirect(`/documentos/${destino}`);
    } catch (err) {
      if (err.status === 422 || err.status === 409) {
        const d = await servicio.detalle(req.repo, req.session.empresa.id, id).catch(() => null);
        if (d) return renderFormulario(req, res, { modo: modo === 'editar' ? 'editar' : 'version', doc: d.doc, valores: { ...valores, codigo: d.doc.codigo, tipo_documental: d.doc.tipo_documental }, error: err.message }).catch(next);
      }
      return next(err);
    }
  });
}

const accionDocumento = (fn, texto) => async (req, res, next) => {
  const id = entero(req.params.id);
  try {
    await fn(req, id);
    req.session.aviso = { tipo: 'success', texto };
    res.redirect(`/documentos/${id}`);
  } catch (err) {
    if (err.status === 422 || err.status === 409) return res.redirect(volver(req, `/documentos/${id}`, err));
    return next(err);
  }
};

router.post('/documentos/:id(\\d+)/firmas', gestionar, accionDocumento(async (req, id) => {
  const usuarios = [].concat(req.body.firmante_usuario || []);
  const rolesF = [].concat(req.body.firmante_rol || []);
  await servicio.solicitarFirmas(req.repo, req.session.empresa.id, id, usuarios.map((u, i) => ({ usuarioId: u, rol: rolesF[i] })));
}, 'Firmas solicitadas. El documento quedó en firma.'));

router.post('/documentos/:id(\\d+)/publicar', gestionar, accionDocumento(
  (req, id) => servicio.publicar(req.repo, req.session.empresa.id, id), 'Documento publicado como vigente.',
));

router.post('/documentos/:id(\\d+)/anular', gestionar, accionDocumento(
  (req, id) => servicio.anular(req.repo, req.session.empresa.id, id, req.body.motivo), 'Documento anulado.',
));

router.post('/documentos/:id(\\d+)/verificar', ver, async (req, res, next) => {
  const id = entero(req.params.id);
  try {
    const resultado = await servicio.verificarIntegridad(req.repo, req.session.empresa.id, id);
    req.session.verificacion = { id, resultado };
    res.redirect(`/documentos/${id}#integridad`);
  } catch (err) {
    next(err);
  }
});

// ---------- Firmas (cualquier usuario del tenant con solicitudes a su nombre)

router.get('/firmas', async (req, res, next) => {
  try {
    res.render('firmas/index', { titulo: 'Mis firmas pendientes', pendientes: await servicio.misPendientes(req.repo, req.session.usuario.id) });
  } catch (err) {
    next(err);
  }
});

router.get('/firmas/:id(\\d+)', async (req, res, next) => {
  try {
    const f = await servicio.prepararFirma(req.repo, req.session.usuario.id, entero(req.params.id));
    res.render('firmas/firmar', { titulo: 'Firmar documento', f, scripts: ['/js/documentos/firmar.js'] });
  } catch (err) {
    if (err.status === 409) return res.redirect(volver(req, '/firmas', err));
    return next(err);
  }
});

router.post('/firmas/:id(\\d+)/codigo', limiteCodigo, async (req, res) => {
  try {
    const r = await servicio.enviarCodigo(req.repo, req.session.usuario.id, entero(req.params.id));
    res.json({ ok: true, destino: r.destino, desarrollo: r.desarrollo });
  } catch (err) {
    res.status(err.status || 500).json({ ok: false, mensaje: err.status ? err.message : 'Error interno' });
  }
});

router.post('/firmas/:id(\\d+)', limiteFirma, async (req, res, next) => {
  const id = entero(req.params.id);
  try {
    const r = await servicio.firmar(req.repo, req.session.usuario.id, id, {
      clave: req.body.clave, codigo: req.body.codigo, aceptaManifiesto: req.body.acepta_manifiesto === '1',
      aceptaAcuerdo: req.body.acepta_acuerdo === '1', ip: req.ip, userAgent: req.get('user-agent'),
    });
    req.session.aviso = {
      tipo: 'success',
      texto: r.publicado ? 'Documento firmado. Era la última firma: quedó vigente.' : `Documento firmado. Faltan ${r.faltan} firma(s).`,
    };
    res.redirect('/firmas');
  } catch (err) {
    if (err.status === 422) return res.redirect(volver(req, `/firmas/${id}`, err));
    if (err.status === 409) return res.redirect(volver(req, '/firmas', err));
    return next(err);
  }
});

module.exports = router;
