// Utilidades comunes de rutas: roles, enteros de parametros y acciones POST con aviso.
const { requiereRol } = require('../middleware/auth');

const ROLES_VER = ['admin_tenant', 'responsable_sst', 'consultor_sst', 'gerente', 'auditor', 'copasst'];
const ROLES_GESTIONAR = ['admin_tenant', 'responsable_sst', 'consultor_sst'];

const entero = (v) => { const n = Number.parseInt(v, 10); return Number.isSafeInteger(n) && n > 0 ? n : null; };
const roles = (req) => (req.session.empresa && req.session.empresa.roles) || [];
const puede = (req, lista = ROLES_GESTIONAR) => roles(req).some((x) => lista.includes(x));

/**
 * Accion POST: ejecuta fn(req, empresaId); exito -> aviso verde y redirige a destino(req, resultado);
 * error 409/422 -> aviso rojo y vuelve a destino(req, null). Otros errores siguen al manejador global.
 */
function accion(texto, fn, destino) {
  return async (req, res, next) => {
    try {
      const r = await fn(req, req.session.empresa.id);
      req.session.aviso = { tipo: (r && r.tipoAviso) || 'success', texto: typeof texto === 'function' ? texto(r) : texto };
      res.redirect(destino(req, r));
    } catch (err) {
      if ([409, 422].includes(err.status)) {
        req.session.aviso = { tipo: 'danger', texto: err.message };
        return res.redirect(destino(req, null));
      }
      return next(err);
    }
  };
}

function error(status, mensaje) {
  const e = new Error(mensaje);
  e.status = status;
  return e;
}

module.exports = { ROLES_VER, ROLES_GESTIONAR, entero, roles, puede, accion, error, requiereRol };
