// M02: personas, vinculaciones y cargos de la empresa activa.
const express = require('express');
const { requiereSesion, requiereEmpresa, requiereRol } = require('../middleware/auth');
const { hoyBogota } = require('../fechas/calendario');
const r = require('../empresa/reglas');
const servicio = require('./servicio');
const peligros = require('../peligros/servicio');
const perfil = require('../peligros/perfil');

const router = express.Router();

const ROLES_VER = ['admin_tenant', 'responsable_sst', 'consultor_sst', 'gerente', 'auditor'];
const ROLES_GESTIONAR = ['admin_tenant', 'responsable_sst', 'consultor_sst'];
const gestionar = requiereRol(...ROLES_GESTIONAR);
const puedeGestionar = (req) => (req.session.empresa.roles || []).some((x) => ROLES_GESTIONAR.includes(x));
const entero = (v) => { const n = Number.parseInt(v, 10); return Number.isSafeInteger(n) && n > 0 ? n : null; };

const accion = (destino, fn) => async (req, res, next) => {
  const ir = typeof destino === 'function' ? destino(req) : destino;
  try {
    req.session.aviso = { tipo: 'success', texto: await fn(req) };
    res.redirect(ir);
  } catch (err) {
    if ([409, 422].includes(err.status)) {
      req.session.aviso = { tipo: 'danger', texto: err.message };
      return res.redirect(ir);
    }
    return next(err);
  }
};
const aPersona = (req) => `/personas/${entero(req.params.id) || entero(req.body.persona_id)}`;

router.use('/personas', requiereSesion, requiereEmpresa, requiereRol(...ROLES_VER));

router.get('/personas', async (req, res, next) => {
  try {
    const filtros = { q: req.query.q || '', estado: req.query.estado || 'activas' };
    res.render('personas/index', {
      titulo: 'Personas', personas: await servicio.listar(req.repo, req.session.empresa.id, filtros), filtros,
      tipos: r.TIPOS_VINCULACION, gestionar: puedeGestionar(req),
    });
  } catch (err) {
    next(err);
  }
});

async function formulario(req, res, { persona = null, valores = {}, error = null }) {
  const [cargos, centros] = await Promise.all([
    servicio.cargos(req.repo, req.session.empresa.id, { soloActivos: true }),
    servicio.centrosActivos(req.repo, req.session.empresa.id),
  ]);
  res.status(error ? 422 : 200).render('personas/formulario', {
    titulo: persona ? 'Editar persona' : 'Nueva persona', persona, valores, error, cargos, centros,
    tiposDocumento: r.TIPOS_DOCUMENTO, tiposVinculacion: r.TIPOS_VINCULACION, hoy: hoyBogota(),
  });
}

router.get('/personas/nueva', gestionar, (req, res, next) => formulario(req, res, { valores: { vincular: '1', tipo: 'dependiente', fecha_ingreso: hoyBogota(), tipo_documento: 'CC' } }).catch(next));

router.post('/personas', gestionar, async (req, res, next) => {
  try {
    const id = await servicio.crear(req.repo, req.session.empresa.id, req.body);
    req.session.aviso = { tipo: 'success', texto: 'Persona registrada.' };
    res.redirect(`/personas/${id}`);
  } catch (err) {
    if (err.status === 409 && err.personaId) {
      req.session.aviso = { tipo: 'warning', texto: `${err.message}. Se abrió su ficha: vincúlela desde aquí.` };
      return res.redirect(`/personas/${err.personaId}`);
    }
    if ([409, 422].includes(err.status)) return formulario(req, res, { valores: req.body, error: err.message }).catch(next);
    return next(err);
  }
});

router.get('/personas/:id(\\d+)', async (req, res, next) => {
  try {
    const empresaId = req.session.empresa.id;
    const [d, cargos, centros] = await Promise.all([
      servicio.detalle(req.repo, empresaId, entero(req.params.id)),
      servicio.cargos(req.repo, empresaId, { soloActivos: true }),
      servicio.centrosActivos(req.repo, empresaId),
    ]);
    await req.repo.auditar('consultar', 'persona', d.persona.id);
    res.render('personas/detalle', {
      titulo: `${d.persona.nombres} ${d.persona.apellidos}`, d, cargos, centros, gestionar: puedeGestionar(req),
      tiposDocumento: r.TIPOS_DOCUMENTO, tiposVinculacion: r.TIPOS_VINCULACION, hoy: hoyBogota(), scripts: ['/js/personas/detalle.js'],
    });
  } catch (err) {
    next(err);
  }
});

router.get('/personas/:id(\\d+)/editar', gestionar, async (req, res, next) => {
  try {
    const d = await servicio.detalle(req.repo, req.session.empresa.id, entero(req.params.id));
    await formulario(req, res, { persona: d.persona, valores: d.persona });
  } catch (err) {
    next(err);
  }
});

router.post('/personas/:id(\\d+)/editar', gestionar, async (req, res, next) => {
  try {
    await servicio.editar(req.repo, entero(req.params.id), req.body);
    req.session.aviso = { tipo: 'success', texto: 'Datos actualizados.' };
    res.redirect(aPersona(req));
  } catch (err) {
    if ([409, 422].includes(err.status)) {
      const d = await servicio.detalle(req.repo, req.session.empresa.id, entero(req.params.id)).catch(() => null);
      if (d) return formulario(req, res, { persona: d.persona, valores: req.body, error: err.message }).catch(next);
    }
    return next(err);
  }
});

router.post('/personas/:id(\\d+)/vinculaciones', gestionar, accion(aPersona, async (req) => {
  await servicio.vincular(req.repo, req.session.empresa.id, entero(req.params.id), req.body);
  return 'Vinculación registrada.';
}));

router.post('/personas/vinculaciones/:vid(\\d+)/reasignar', gestionar, accion(aPersona, async (req) => {
  await servicio.reasignar(req.repo, req.session.empresa.id, entero(req.params.vid), req.body);
  return 'Cargo y centro actualizados.';
}));

router.post('/personas/vinculaciones/:vid(\\d+)/retiro', gestionar, accion(aPersona, async (req) => {
  await servicio.retirar(req.repo, req.session.empresa.id, entero(req.params.vid), { fecha: req.body.fecha_retiro, motivo: req.body.motivo_retiro });
  return 'Retiro registrado. Se generó la obligación de examen de egreso y se fijó la retención de sus registros.';
}));

router.post('/personas/vinculaciones/:vid(\\d+)/anular', gestionar, accion(aPersona, async (req) => {
  await servicio.anularVinculacion(req.repo, req.session.empresa.id, entero(req.params.vid), req.body.observacion);
  return 'Vinculación anulada.';
}));

// ---------- Cargos

router.get('/personas/cargos', async (req, res, next) => {
  try {
    const empresaId = req.session.empresa.id;
    const [cargos, tipos, expuestos] = await Promise.all([
      servicio.cargos(req.repo, empresaId), peligros.catalogo.cargosTipo(), peligros.peligrosPorCargo(req.repo, empresaId),
    ]);
    const niveles = new Map();
    for (const p of expuestos) niveles.set(p.cargo_id, [...(niveles.get(p.cargo_id) || []), p.nivel_riesgo]);
    res.render('personas/cargos', {
      titulo: 'Cargos', cargos, tipos, niveles, gestionar: puedeGestionar(req), scripts: ['/js/personas/cargos.js'],
    });
  } catch (err) {
    next(err);
  }
});

router.get('/personas/cargos/:id(\\d+)', async (req, res, next) => {
  try {
    const p = await perfil.perfil(req.repo, req.session.empresa.id, entero(req.params.id));
    res.render('personas/cargo', { titulo: p.cargo.nombre, subtitulo: 'Perfil de riesgo del cargo', p, gestionar: puedeGestionar(req) });
  } catch (err) {
    next(err);
  }
});

router.post('/personas/cargos/catalogo', gestionar, accion('/personas/cargos', async (req) => {
  const n = await perfil.crearDesdeTipos(req.repo, req.session.empresa.id, req.body.tipos);
  return n ? `Se crearon ${n} cargo(s) desde el catálogo.` : 'Los cargos elegidos ya existían.';
}));

router.post('/personas/cargos', gestionar, accion('/personas/cargos', async (req) => {
  await perfil.guardarCargo(req.repo, req.session.empresa.id, entero(req.body.id), req.body);
  return req.body.id ? 'Cargo actualizado.' : 'Cargo creado.';
}));

router.post('/personas/cargos/:id(\\d+)/estado', gestionar, accion('/personas/cargos', async (req) => {
  await servicio.cambiarEstadoCargo(req.repo, req.session.empresa.id, entero(req.params.id), req.body.activo === '1');
  return req.body.activo === '1' ? 'Cargo activado.' : 'Cargo inactivado.';
}));

module.exports = router;
