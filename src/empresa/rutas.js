// M01: empresa activa, centros de trabajo, perfil y usuarios del tenant.
const express = require('express');
const cuentas = require('../db/cuentas');
const { requiereSesion, requiereEmpresa, requiereRol } = require('../middleware/auth');
const matriz = require('../matriz/servicio');
const servicio = require('./servicio');
const planes = require('../planes/servicio');

const router = express.Router();

const ROLES_VER = ['admin_tenant', 'responsable_sst', 'consultor_sst', 'gerente', 'auditor'];
const ROLES_GESTIONAR = ['admin_tenant', 'responsable_sst', 'consultor_sst'];
const gestionar = requiereRol(...ROLES_GESTIONAR);
const administrar = requiereRol('admin_tenant');
const roles = (req) => req.session.empresa.roles || [];
const entero = (v) => { const n = Number.parseInt(v, 10); return Number.isSafeInteger(n) && n > 0 ? n : null; };

const accion = (destino, fn) => async (req, res, next) => {
  const ir = typeof destino === 'function' ? destino(req) : destino;
  try {
    const r = await fn(req);
    req.session.aviso = { tipo: (r && r.tipo) || 'success', texto: (r && r.texto) || r };
    res.redirect(ir);
  } catch (err) {
    if ([409, 422].includes(err.status)) {
      req.session.aviso = { tipo: 'danger', texto: err.message };
      return res.redirect(ir);
    }
    return next(err);
  }
};

// Tras cambiar la clasificacion, el aviso de reclasificacion se ve en el mismo mensaje.
const textoClasificacion = (c, base) => (c && c.pendiente
  ? { tipo: 'warning', texto: `${base} La empresa fue reclasificada: ${c.pendiente.conjunto_anterior} -> ${c.pendiente.conjunto_codigo}.` }
  : base);

router.use('/empresa', requiereSesion, requiereEmpresa, requiereRol(...ROLES_VER));

router.get('/empresa', async (req, res, next) => {
  try {
    const [r, plan] = await Promise.all([servicio.resumen(req.repo, req.session.empresa.id), planes.estado(req.repo)]);
    res.render('empresa/index', {
      plan,
      titulo: 'Empresa', r, gestionar: roles(req).some((x) => ROLES_GESTIONAR.includes(x)),
      administrar: roles(req).includes('admin_tenant'), tab: req.query.tab || 'datos', scripts: ['/js/empresa/index.js'],
    });
  } catch (err) {
    next(err);
  }
});

router.post('/empresa/datos', gestionar, accion('/empresa', async (req) => {
  const c = await servicio.actualizarEmpresa(req.repo, req.session.empresa.id, req.body);
  req.session.empresa.razonSocial = c.empresa.razon_social;
  return textoClasificacion(c, 'Datos del empleador actualizados.');
}));

router.post('/empresa/sincronizar-trabajadores', gestionar, accion('/empresa', async (req) => {
  const c = await servicio.sincronizarTrabajadores(req.repo, req.session.empresa.id);
  return textoClasificacion(c, `Número de trabajadores actualizado a ${c.empresa.numero_trabajadores}.`);
}));

router.post('/empresa/perfil', gestionar, accion('/empresa?tab=perfil', async (req) => {
  await matriz.guardarPerfil(req.repo, req.session.empresa.id, req.body.ambitos);
  return 'Perfil de aplicabilidad actualizado.';
}));

router.post('/empresa/centros', gestionar, accion('/empresa?tab=centros', async (req) => textoClasificacion(
  await servicio.agregarCentro(req.repo, req.session.empresa.id, req.body), 'Centro de trabajo registrado.',
)));

router.post('/empresa/centros/:id(\\d+)', gestionar, accion('/empresa?tab=centros', async (req) => textoClasificacion(
  await servicio.editarCentro(req.repo, req.session.empresa.id, entero(req.params.id), req.body), 'Centro de trabajo actualizado.',
)));

router.post('/empresa/centros/:id(\\d+)/estado', gestionar, accion('/empresa?tab=centros', async (req) => textoClasificacion(
  await servicio.cambiarEstadoCentro(req.repo, req.session.empresa.id, entero(req.params.id), req.body.activo === '1'),
  req.body.activo === '1' ? 'Centro activado.' : 'Centro inactivado.',
)));

router.post('/empresa/nueva', administrar, accion('/empresa', async (req) => {
  const id = await servicio.crearEmpresa(req.repo, req.body);
  const accesos = await cuentas.accesosDeUsuario(req.session.usuario.id);
  req.session.accesos = accesos.map((a) => ({ empresaId: a.empresa_id, razonSocial: a.razon_social, nit: a.nit }));
  return `Empresa creada (#${id}). Cámbiese a ella desde el selector de empresas.`;
}));

// ---------- Usuarios del tenant (solo administrador)

router.get('/empresa/usuarios', administrar, async (req, res, next) => {
  try {
    const [usuarios, rolesCat, plan] = await Promise.all([servicio.usuarios(req.repo, req.session.empresa.id), servicio.rolesValidos(), planes.estado(req.repo)]);
    res.render('empresa/usuarios', { titulo: 'Usuarios de la empresa', usuarios, roles: rolesCat, plan, limite: planes.limite, yo: req.session.usuario.id, scripts: ['/js/empresa/usuarios.js'] });
  } catch (err) {
    next(err);
  }
});

router.post('/empresa/usuarios', administrar, accion('/empresa/usuarios', async (req) => {
  const r = await servicio.invitar(req.repo, { ...req.body, roles: req.body.roles }, req.session.usuario.id, { empresaId: req.session.empresa.id });
  if (r.existente) return 'Usuario existente: se le asignaron los roles en esta empresa.';
  return {
    tipo: 'warning',
    // Con correo enviado la clave no pasa por la sesion ni por la pantalla.
    texto: r.correoEnviado
      ? 'Usuario creado. La contraseña temporal se envió por correo.'
      : `Usuario creado. Contraseña temporal: ${r.temporal} (se muestra una sola vez; el correo no se pudo enviar).`,
  };
}));

router.post('/empresa/usuarios/:id(\\d+)/roles', administrar, accion('/empresa/usuarios', async (req) => {
  await servicio.guardarRoles(req.repo, entero(req.params.id), req.body.roles, req.session.usuario.id, { empresaId: req.session.empresa.id });
  return [].concat(req.body.roles || []).length ? 'Roles actualizados.' : 'Usuario desactivado en esta empresa.';
}));

module.exports = router;
