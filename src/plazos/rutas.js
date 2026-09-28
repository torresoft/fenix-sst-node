// Panel de obligaciones consolidado: todas las empresas a las que el usuario tiene acceso con
// rol de gestion. Cada tenant se consulta con su propio RepositorioTenant.
const express = require('express');
const cuentas = require('../db/cuentas');
const { RepositorioTenant } = require('../db/repositorio');
const { requiereSesion } = require('../middleware/auth');
const fechas = require('../fechas');
const reglas = require('./reglas');
const servicio = require('./servicio');

const router = express.Router();

const ROLES_VER = ['admin_tenant', 'responsable_sst', 'consultor_sst', 'gerente', 'auditor'];
const ROLES_GESTIONAR = ['admin_tenant', 'responsable_sst', 'consultor_sst'];
const DIAS_CUMPLIDAS = 30;
const GRUPOS = [
  { estado: 'vencido', titulo: 'Vencidas', color: 'danger', icono: 'fa-exclamation-circle' },
  { estado: 'por_vencer', titulo: 'Por vencer', color: 'warning', icono: 'fa-hourglass-half' },
  { estado: 'en_termino', titulo: 'En t&eacute;rmino', color: 'success', icono: 'fa-check-circle' },
  { estado: 'cumplido', titulo: `Cumplidas (&uacute;ltimos ${DIAS_CUMPLIDAS} d&iacute;as)`, color: 'secondary', icono: 'fa-flag-checkered' },
];

const entero = (v) => { const n = Number.parseInt(v, 10); return Number.isSafeInteger(n) && n > 0 ? n : null; };

async function accesosCon(req, roles) {
  const accesos = await cuentas.accesosDeUsuario(req.session.usuario.id);
  return accesos.filter((a) => a.roles.some((r) => roles.includes(r)));
}

// Resuelve la empresa del formulario contra los accesos reales (BD) y devuelve el repo de su tenant.
async function repoDeEmpresa(req, empresaId, roles) {
  const acceso = (await accesosCon(req, roles)).find((a) => a.empresa_id === entero(empresaId));
  if (!acceso) {
    const err = new Error('No tiene permisos sobre esa empresa');
    err.status = 403;
    throw err;
  }
  return { acceso, repo: new RepositorioTenant(acceso.tenant_id, req.actor) };
}

function volverA(req) {
  const v = String(req.body.volver || '');
  return /^\/obligaciones(\?[\w=&%.-]*)?$/.test(v) ? v : '/obligaciones';
}

router.use('/obligaciones', requiereSesion);

router.get('/obligaciones', async (req, res, next) => {
  try {
    const accesos = await accesosCon(req, ROLES_VER);
    if (!accesos.length) {
      const err = new Error('No tiene permisos para ver obligaciones');
      err.status = 403;
      throw err;
    }
    const hoy = fechas.hoyBogota();
    const cal = fechas.calendario();
    const filtroEmpresa = entero(req.query.empresa);
    const filtroResp = req.query.responsable === 'sin' ? 'sin' : entero(req.query.responsable);
    const desdeCumplidas = new Date(Date.parse(`${hoy}T00:00:00Z`) - DIAS_CUMPLIDAS * 86400000).toISOString().slice(0, 10);

    const empresas = filtroEmpresa ? accesos.filter((a) => a.empresa_id === filtroEmpresa) : accesos;
    const tenants = [...new Set(empresas.map((a) => a.tenant_id))];

    let obligaciones = [];
    for (const tenantId of tenants) {
      const repo = new RepositorioTenant(tenantId, req.actor);
      const ids = empresas.filter((a) => a.tenant_id === tenantId).map((a) => a.empresa_id);
      let sql = `SELECT o.*, e.razon_social FROM obligacion_pendiente o
                   JOIN empresa e ON e.tenant_id = {tenant} AND e.id = o.empresa_id
                  WHERE o.tenant_id = {tenant} AND o.empresa_id IN (${ids.map(() => '?').join(', ')})
                    AND (o.estado IN ('en_termino','por_vencer','vencido')
                         OR (o.estado = 'cumplido' AND o.fecha_cumplimiento >= ?))`;
      const params = [...ids, desdeCumplidas];
      if (filtroResp === 'sin') sql += ' AND o.responsable_id IS NULL';
      else if (filtroResp) { sql += ' AND o.responsable_id = ?'; params.push(filtroResp); }
      const filas = await repo.consultar(sql, params);
      const gestiona = new Set(accesos.filter((a) => a.tenant_id === tenantId && a.roles.some((r) => ROLES_GESTIONAR.includes(r))).map((a) => a.empresa_id));
      obligaciones.push(...filas.map((o) => ({ ...o, gestionable: gestiona.has(o.empresa_id) })));
    }

    const nombres = await cuentas.nombresUsuarios(obligaciones.map((o) => o.responsable_id));
    obligaciones = obligaciones.map((o) => {
      const estado = reglas.estadoObligacion(o, hoy, cal);
      return {
        ...o,
        estado,
        restantes: reglas.diasRestantes(o, hoy, cal),
        responsable: o.responsable_id ? nombres.get(o.responsable_id) || `#${o.responsable_id}` : null,
        tarde: estado === 'cumplido' && o.fecha_cumplimiento > o.fecha_limite,
      };
    }).sort(reglas.compararUrgencia);

    const responsables = await cuentas.usuariosDeTenants([...new Set(accesos.map((a) => a.tenant_id))]);
    const unicos = [...new Map(responsables.map((u) => [u.id, u])).values()];

    res.render('obligaciones/panel', {
      titulo: 'Obligaciones y plazos',
      hoy,
      grupos: GRUPOS.map((g) => ({ ...g, filas: obligaciones.filter((o) => o.estado === g.estado) })),
      empresasFiltro: accesos,
      responsablesFiltro: unicos,
      filtro: { empresa: filtroEmpresa, responsable: filtroResp },
      volver: req.originalUrl,
      scripts: ['/js/obligaciones/panel.js'],
    });
  } catch (err) {
    next(err);
  }
});

router.get('/obligaciones/responsables', async (req, res, next) => {
  try {
    const { acceso } = await repoDeEmpresa(req, req.query.empresa_id, ROLES_GESTIONAR);
    const usuarios = await cuentas.usuariosDeTenants([acceso.tenant_id]);
    res.json({ ok: true, usuarios: usuarios.map((u) => ({ id: u.id, nombre: u.nombre })) });
  } catch (err) {
    next(err);
  }
});

router.post('/obligaciones/:id/cumplir', async (req, res, next) => {
  try {
    const { repo } = await repoDeEmpresa(req, req.body.empresa_id, ROLES_GESTIONAR);
    await validarEmpresa(repo, req.params.id, req.body.empresa_id);
    const r = await servicio.cumplirObligacion(repo, entero(req.params.id), {
      fecha: req.body.fecha, observacion: req.body.observacion,
    });
    req.session.aviso = r.cumplidaTarde
      ? { tipo: 'warning', texto: 'Cumplimiento registrado por fuera del plazo legal.' }
      : { tipo: 'success', texto: 'Cumplimiento registrado.' };
    res.redirect(volverA(req));
  } catch (err) {
    if (err.status === 422 || err.status === 409) {
      req.session.aviso = { tipo: 'danger', texto: err.message };
      return res.redirect(volverA(req));
    }
    return next(err);
  }
});

router.post('/obligaciones/:id/responsable', async (req, res, next) => {
  try {
    const { repo } = await repoDeEmpresa(req, req.body.empresa_id, ROLES_GESTIONAR);
    await validarEmpresa(repo, req.params.id, req.body.empresa_id);
    await servicio.asignarResponsable(repo, entero(req.params.id), req.body.responsable_id || null);
    req.session.aviso = { tipo: 'success', texto: 'Responsable actualizado.' };
    res.redirect(volverA(req));
  } catch (err) {
    if (err.status === 422 || err.status === 409) {
      req.session.aviso = { tipo: 'danger', texto: err.message };
      return res.redirect(volverA(req));
    }
    return next(err);
  }
});

// La obligacion debe pertenecer a la empresa autorizada, no solo al tenant.
async function validarEmpresa(repo, id, empresaId) {
  const ob = await repo.obtener('obligacion_pendiente', entero(id));
  if (!ob || ob.empresa_id !== entero(empresaId)) {
    const err = new Error('Obligacion no encontrada');
    err.status = 404;
    throw err;
  }
}

module.exports = router;
