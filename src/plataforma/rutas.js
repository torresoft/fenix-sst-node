// Consola de plataforma: clientes y cuentas. Solo superadmin; no da acceso a datos SST de los tenants.
const express = require('express');
const { requiereSesion } = require('../middleware/auth');
const { entero } = require('../comun/rutas');
const servicio = require('./servicio');
const planes = require('../planes/servicio');
const suscripciones = require('./suscripciones');

const router = express.Router();

async function requiereSuperadmin(req, res, next) {
  try {
    if (await servicio.esSuperadmin(req.session.usuario.id)) return next();
    const err = new Error('Solo el superadministrador de la plataforma');
    err.status = 403;
    return next(err);
  } catch (err) {
    return next(err);
  }
}

// POST con aviso: 409/422 vuelven al destino con el mensaje en rojo.
const accion = (destino, fn) => async (req, res, next) => {
  const ir = typeof destino === 'function' ? destino(req) : destino;
  try {
    const r = await fn(req);
    req.session.aviso = typeof r === 'string' ? { tipo: 'success', texto: r } : r;
    res.redirect(ir);
  } catch (err) {
    if ([409, 422].includes(err.status)) {
      req.session.aviso = { tipo: 'danger', texto: err.message };
      return res.redirect(ir);
    }
    return next(err);
  }
};

const textoClave = (base, r) => ({
  tipo: 'warning',
  texto: r.correoEnviado
    ? `${base} La contraseña temporal se envió por correo.`
    : `${base} Contraseña temporal: ${r.temporal} (se muestra una sola vez; el correo no se pudo enviar).`,
});

router.use('/plataforma', requiereSesion, requiereSuperadmin);

router.get('/plataforma', (req, res) => res.redirect('/plataforma/clientes'));

router.get('/plataforma/clientes', async (req, res, next) => {
  try {
    const c = await servicio.clientes(req.actor);
    res.render('plataforma/clientes', { titulo: 'Clientes', subtitulo: 'Cuentas (tenants) de la plataforma', clientes: c.lista, planes: c.planes, limite: planes.limite });
  } catch (err) {
    next(err);
  }
});

router.post('/plataforma/clientes', accion('/plataforma/clientes', async (req) => {
  const r = await servicio.crearCliente(req.body);
  const base = `Cliente #${r.tenantId} creado.`;
  return r.temporal ? textoClave(base, r) : `${base} La cuenta existente quedó como administradora.`;
}));

const aCliente = (req) => (req.body.volver === 'lista' ? '/plataforma/clientes' : `/plataforma/clientes/${entero(req.params.id)}`);
const TEXTO_ESTADO = {
  activo: 'Cliente reactivado.',
  suspendido: 'Cliente suspendido: sus usuarios pierden el acceso y se cerraron sus sesiones.',
  retirado: 'Cliente retirado: sin acceso y con sesiones cerradas. Sus datos se conservan por las retenciones legales.',
};

router.get('/plataforma/clientes/:id(\\d+)', async (req, res, next) => {
  try {
    const [d, sus] = await Promise.all([servicio.fichaCliente(entero(req.params.id), req.actor), suscripciones.detalle(entero(req.params.id))]);
    res.render('plataforma/cliente', {
      titulo: d.t.nombre, subtitulo: `Cliente #${d.t.id}`, d, sus, yo: req.session.usuario.id, limite: planes.limite, scripts: ['/js/plataforma/cliente.js'],
    });
  } catch (err) {
    next(err);
  }
});

router.post('/plataforma/clientes/:id(\\d+)', accion(aCliente, async (req) => {
  await servicio.editarCliente(entero(req.params.id), req.body, req.actor);
  return 'Datos del cliente actualizados.';
}));

router.post('/plataforma/clientes/:id(\\d+)/estado', accion(aCliente, async (req) => {
  await servicio.cambiarEstadoCliente(entero(req.params.id), req.body.estado, req.actor, req.body.motivo);
  return TEXTO_ESTADO[req.body.estado];
}));

router.post('/plataforma/clientes/:id(\\d+)/admins', accion(aCliente, async (req) => {
  const r = await servicio.asignarAdmin(entero(req.params.id), req.body, req.actor);
  return r.existente ? 'La cuenta existente quedó como administradora del cliente.' : textoClave('Administrador creado.', r);
}));

router.post('/plataforma/clientes/:id(\\d+)/admins/:u(\\d+)/quitar', accion(aCliente, async (req) => {
  await servicio.quitarAdmin(entero(req.params.id), entero(req.params.u), req.actor);
  return 'Rol de administrador retirado; el usuario conserva sus demás roles.';
}));

router.get('/plataforma/usuarios', async (req, res, next) => {
  try {
    const q = String(req.query.q || '').slice(0, 100);
    res.render('plataforma/usuarios', { titulo: 'Usuarios', subtitulo: 'Cuentas de acceso a la plataforma', usuarios: await servicio.usuarios(q), q });
  } catch (err) {
    next(err);
  }
});

router.get('/plataforma/usuarios/:id(\\d+)', async (req, res, next) => {
  try {
    const d = await servicio.usuario(entero(req.params.id));
    res.render('plataforma/usuario', { titulo: `${d.u.nombres} ${d.u.apellidos}`, subtitulo: d.u.email, d, yo: req.session.usuario.id });
  } catch (err) {
    next(err);
  }
});

const aUsuario = (req) => `/plataforma/usuarios/${entero(req.params.id)}`;

router.post('/plataforma/usuarios/:id(\\d+)/desbloquear', accion(aUsuario, async (req) => {
  await servicio.desbloquear(entero(req.params.id), req.actor);
  return 'Cuenta desbloqueada.';
}));

router.post('/plataforma/usuarios/:id(\\d+)/clave', accion(aUsuario, async (req) => textoClave(
  'Contraseña restablecida y sesiones cerradas.', await servicio.restablecerClave(entero(req.params.id), req.actor),
)));

router.post('/plataforma/usuarios/:id(\\d+)/estado', accion(aUsuario, async (req) => {
  const activo = req.body.activo === '1';
  await servicio.cambiarEstadoUsuario(entero(req.params.id), activo, req.actor);
  return activo ? 'Cuenta activada.' : 'Cuenta inactivada y sesiones cerradas.';
}));

// ---------- Suscripciones

const aSuscripcion = (req) => `/plataforma/clientes/${entero(req.params.id)}#suscripcion`;

router.get('/plataforma/suscripciones', async (req, res, next) => {
  try {
    const t = await suscripciones.tablero();
    const nivel = ['al_dia', 'por_vencer', 'vencida', 'sin', 'saldo'].includes(req.query.nivel) ? req.query.nivel : '';
    const filas = t.filas.filter((f) => !nivel || (nivel === 'saldo' ? Number(f.saldo) > 0 : f.situacion.nivel === nivel));
    res.render('plataforma/suscripciones', { titulo: 'Suscripciones', subtitulo: 'Vigencias, renovaciones y pagos de los clientes', t, filas, nivel });
  } catch (err) {
    next(err);
  }
});

router.post('/plataforma/clientes/:id(\\d+)/suscripcion', accion(aSuscripcion, async (req) => {
  const r = await suscripciones.guardar(entero(req.params.id), req.body, req.actor);
  return `Suscripción registrada hasta el ${r.fin}.${r.reactivado ? ' Cliente reactivado.' : ''}`;
}));

router.post('/plataforma/clientes/:id(\\d+)/suscripcion/:s(\\d+)/cancelar', accion(aSuscripcion, async (req) => {
  await suscripciones.cancelar(entero(req.params.id), entero(req.params.s), req.body.motivo, req.actor);
  return 'Suscripción cancelada: no se renovará y cubre hasta su fecha fin.';
}));

router.post('/plataforma/clientes/:id(\\d+)/pagos', accion(aSuscripcion, async (req) => {
  await suscripciones.registrarPago(entero(req.params.id), req.body, req.actor);
  return 'Pago registrado.';
}));

router.post('/plataforma/clientes/:id(\\d+)/pagos/:p(\\d+)/anular', accion(aSuscripcion, async (req) => {
  await suscripciones.anularPago(entero(req.params.id), entero(req.params.p), req.body.motivo, req.actor);
  return 'Pago anulado.';
}));

// ---------- Catalogos globales

const catalogos = require('./catalogos');

const clave = (req) => String(req.body.c ?? req.query.c ?? '').slice(0, 100);
const aCatalogo = (req) => `/plataforma/catalogos/${req.params.tabla}`;

router.get('/plataforma/catalogos', async (req, res, next) => {
  try {
    res.render('plataforma/catalogos', { titulo: 'Catálogos', subtitulo: 'Normas y parámetros heredados por todos los clientes', grupos: await catalogos.indice() });
  } catch (err) {
    next(err);
  }
});

router.get('/plataforma/catalogos/:tabla([a-z_]+)', async (req, res, next) => {
  try {
    const q = String(req.query.q || '').slice(0, 100);
    const d = await catalogos.listar(req.params.tabla, q);
    res.render('plataforma/catalogo', { titulo: d.def.titulo, subtitulo: `Catálogo ${d.def.tabla}`, d, q });
  } catch (err) {
    next(err);
  }
});

async function formularioCatalogo(req, res, { valores = null, error = null } = {}) {
  const c = clave(req) || null;
  const d = await catalogos.formulario(req.params.tabla, c);
  res.status(error ? 422 : 200).render('plataforma/catalogo-form', {
    titulo: c ? `${d.def.titulo}: ${c}` : `${d.def.titulo}: nuevo`, subtitulo: 'Los cambios quedan protegidos frente a la carga del seed', d, c, valores: valores || d.fila || {}, error,
  });
}

router.get('/plataforma/catalogos/:tabla([a-z_]+)/editar', (req, res, next) => formularioCatalogo(req, res).catch(next));

router.post('/plataforma/catalogos/:tabla([a-z_]+)/guardar', async (req, res, next) => {
  try {
    const r = await catalogos.guardar(req.params.tabla, clave(req) || null, req.body, req.actor);
    const extra = r.boletines ? ` Se generaron ${r.boletines} boletín(es) normativo(s) para los clientes.` : '';
    req.session.aviso = { tipo: r.sinCambios ? 'info' : 'success', texto: r.sinCambios ? 'Sin cambios.' : `Registro ${r.clave} guardado.${extra}` };
    return res.redirect(aCatalogo(req));
  } catch (err) {
    if ([409, 422].includes(err.status) || /^ER_(NO_REFERENCED_ROW|DUP_ENTRY|CONSTRAINT_FAILED|ROW_IS_REFERENCED)/.test(err.code || '')) {
      const msg = err.status ? err.message : 'El valor referencia un código inexistente o viola una restricción del catálogo';
      return formularioCatalogo(req, res, { valores: req.body, error: msg }).catch(next);
    }
    return next(err);
  }
});

router.post('/plataforma/catalogos/:tabla([a-z_]+)/estado', accion(aCatalogo, async (req) => {
  const activo = req.body.activo === '1';
  const r = await catalogos.cambiarEstado(req.params.tabla, clave(req), activo, req.actor);
  return `${clave(req)} ${activo ? 'activado' : 'inactivado'}.${r.boletines ? ` ${r.boletines} boletín(es) generado(s).` : ''}`;
}));

router.post('/plataforma/catalogos/:tabla([a-z_]+)/restaurar', accion(aCatalogo, async (req) => {
  await catalogos.restaurar(req.params.tabla, clave(req), req.actor);
  return `${clave(req)} vuelve al control del seed: la próxima carga de catálogos lo reemplaza con data/*.json (o lo inactiva si no está allí).`;
}));

module.exports = router;
