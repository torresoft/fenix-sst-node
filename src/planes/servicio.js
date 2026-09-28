// Plan comercial del tenant: uso actual, alertas de cobertura y verificacion de altas nuevas.
const cuentas = require('../db/cuentas');
const { consultarCatalogo } = require('../db/global');
const { error } = require('../comun/rutas');
const reglas = require('./reglas');

const parse = (v) => (typeof v === 'string' ? JSON.parse(v) : v);
const aPlan = (p) => ({ ...p, conjuntos: parse(p.conjuntos) || [] });

/** Planes ofrecidos (activos) para asignar a clientes. */
async function catalogo() {
  return (await consultarCatalogo("SELECT * FROM plan_comercial WHERE estado = 'activo' ORDER BY orden, nombre")).map(aPlan);
}

// Un plan inactivo deja de ofrecerse, pero los clientes que ya lo tienen conservan sus limites.
async function porCodigo(codigo) {
  if (!codigo) return null;
  const [p] = await consultarCatalogo('SELECT * FROM plan_comercial WHERE codigo = ?', [codigo]);
  return p ? aPlan(p) : null;
}

async function uso(repo) {
  const [[e], [u], clasif] = await Promise.all([
    repo.consultar("SELECT COUNT(*) AS n FROM empresa WHERE tenant_id = {tenant} AND estado = 'activa'"),
    repo.consultar("SELECT COUNT(DISTINCT usuario_id) AS n FROM usuario_tenant WHERE tenant_id = {tenant} AND estado = 'activo'"),
    repo.consultar(
      `SELECT ec.empresa_id, ec.conjunto_codigo, e.razon_social FROM empresa_clasificacion ec
         JOIN empresa e ON e.tenant_id = {tenant} AND e.id = ec.empresa_id AND e.estado = 'activa'
        WHERE ec.tenant_id = {tenant} ORDER BY ec.empresa_id, ec.id DESC`,
    ),
  ]);
  const ultimas = new Map();
  for (const c of clasif) if (!ultimas.has(c.empresa_id)) ultimas.set(c.empresa_id, c);
  return { empresas: Number(e.n), usuarios: Number(u.n), clasificaciones: [...ultimas.values()] };
}

/** Plan, uso y evaluacion del tenant del repositorio. */
async function estado(repo) {
  const [plan, u] = await Promise.all([cuentas.planDeTenant(repo.tenantId).then(porCodigo), uso(repo)]);
  return { ...reglas.evaluar(plan, u), uso: u };
}

async function verificarNuevaEmpresa(repo) {
  const e = await estado(repo);
  if (!e.puedeEmpresa) throw error(409, `El plan ${e.plan.nombre} permite ${e.plan.max_empresas} empresa(s). Solicite un cambio de plan.`);
}

/** Solo cuenta si el usuario aun no tiene acceso activo al tenant. */
async function verificarNuevoUsuario(repo, usuarioId) {
  if (usuarioId) {
    const activos = await repo.listar('usuario_tenant', { usuario_id: usuarioId, estado: 'activo' });
    if (activos.length) return;
  }
  const e = await estado(repo);
  if (!e.puedeUsuario) throw error(409, `El plan ${e.plan.nombre} permite ${e.plan.max_usuarios} usuario(s). Retire el acceso a alguien o solicite un cambio de plan.`);
}

module.exports = { catalogo, porCodigo, estado, verificarNuevaEmpresa, verificarNuevoUsuario, limite: reglas.limite };
