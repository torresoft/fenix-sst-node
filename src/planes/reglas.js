// Limites del plan comercial. Puro. Solo se bloquean altas nuevas (empresas, usuarios);
// nunca funcionalidad exigida por la norma: una empresa fuera de cobertura sigue operando y se avisa.

const libre = (max) => max === null || max === undefined;

/**
 * plan: { codigo, nombre, conjuntos, max_empresas, max_usuarios } o null (sin plan = sin limites).
 * uso: { empresas, usuarios, clasificaciones: [{ razon_social, conjunto_codigo }] }
 */
function evaluar(plan, uso) {
  if (!plan) {
    return { plan: null, puedeEmpresa: true, puedeUsuario: true, excedeEmpresas: false, excedeUsuarios: false, fueraCobertura: [], alertas: [] };
  }
  const conjuntos = new Set(plan.conjuntos || []);
  const fueraCobertura = uso.clasificaciones.filter((c) => c.conjunto_codigo && !conjuntos.has(c.conjunto_codigo));
  const r = {
    plan,
    puedeEmpresa: libre(plan.max_empresas) || uso.empresas < plan.max_empresas,
    puedeUsuario: libre(plan.max_usuarios) || uso.usuarios < plan.max_usuarios,
    excedeEmpresas: !libre(plan.max_empresas) && uso.empresas > plan.max_empresas,
    excedeUsuarios: !libre(plan.max_usuarios) && uso.usuarios > plan.max_usuarios,
    fueraCobertura,
  };
  r.alertas = [
    ...fueraCobertura.map((c) => `${c.razon_social} quedó clasificada en ${c.conjunto_codigo}, que el plan ${plan.nombre} no cubre`),
    ...(r.excedeEmpresas ? [`${uso.empresas} empresas activas; el plan permite ${plan.max_empresas}`] : []),
    ...(r.excedeUsuarios ? [`${uso.usuarios} usuarios activos; el plan permite ${plan.max_usuarios}`] : []),
  ];
  return r;
}

const limite = (max) => (libre(max) ? 'ilimitado' : max);

module.exports = { evaluar, limite };
