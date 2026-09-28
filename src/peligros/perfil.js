// Perfil de riesgo del cargo: peligros de la matriz vigente, brechas frente al cargo tipo,
// competencias exigibles y EPP. Tambien crea cargos desde el catalogo de cargos tipo.
const personas = require('../personas/servicio');
const formacion = require('../formacion/servicio');
const { error } = require('../comun/rutas');
const servicio = require('./servicio');

async function tipoDe(codigo) {
  if (!codigo) return null;
  return (await servicio.catalogo.cargosTipo()).find((t) => t.codigo === codigo) || null;
}

/** Guarda el cargo; al crearlo desde un cargo tipo hereda sus competencias exigibles. */
async function guardarCargo(repo, empresaId, id, d) {
  const tipo = await tipoDe(d.cargo_tipo_codigo);
  if (d.cargo_tipo_codigo && !tipo) throw error(422, 'Cargo tipo invalido');
  const cargoId = await personas.guardarCargo(repo, empresaId, id, { ...d, cargo_tipo_codigo: tipo ? tipo.codigo : null });
  if (!id && tipo && tipo.competencias.length) {
    const validas = new Set((await formacion.tipos()).filter((t) => !Number(t.requerida_todos)).map((t) => t.codigo));
    const comp = tipo.competencias.filter((c) => validas.has(c));
    if (comp.length) await formacion.guardarRequisitos(repo, empresaId, cargoId, comp);
  }
  return cargoId;
}

/** Crea de una vez los cargos tipo elegidos que la empresa aun no tenga (por nombre). */
async function crearDesdeTipos(repo, empresaId, codigos) {
  const elegidos = new Set([].concat(codigos || []).map(String));
  const tipos = (await servicio.catalogo.cargosTipo()).filter((t) => elegidos.has(t.codigo));
  if (!tipos.length) throw error(422, 'Elija al menos un cargo tipo');
  const existentes = new Set((await personas.cargos(repo, empresaId)).map((c) => c.nombre.toLowerCase()));
  let creados = 0;
  for (const t of tipos.filter((x) => !existentes.has(x.nombre.toLowerCase()))) {
    await guardarCargo(repo, empresaId, null, { nombre: t.nombre, descripcion: t.descripcion, cargo_tipo_codigo: t.codigo });
    creados += 1;
  }
  return creados;
}

async function perfil(repo, empresaId, cargoId) {
  const cargo = await repo.obtener('cargo', cargoId);
  if (!cargo || cargo.empresa_id !== empresaId) throw error(404, 'Cargo no encontrado');
  const [peligros, controles, competencias, epp, [trab], tipo, tiposPel, compCat, clases, jerarquia] = await Promise.all([
    repo.consultar(
      `SELECT i.id, i.matriz_id, i.clase_peligro, i.peligro_tipo_codigo, i.peligro, i.proceso, i.actividad, i.nr, i.nivel_riesgo, i.aceptabilidad, i.efectos
         FROM riesgo_item_cargo ric
         JOIN riesgo_item i ON i.tenant_id = {tenant} AND i.id = ric.item_id AND i.estado = 'activo'
         JOIN matriz_riesgo m ON m.tenant_id = {tenant} AND m.id = i.matriz_id AND m.estado = 'vigente' AND m.empresa_id = ?
        WHERE ric.tenant_id = {tenant} AND ric.cargo_id = ? AND ric.estado = 'activo' ORDER BY i.nr DESC, i.peligro`, [empresaId, cargoId],
    ),
    repo.consultar(
      `SELECT rc.item_id, rc.jerarquia_codigo, rc.descripcion, rc.estado FROM riesgo_control rc
         JOIN riesgo_item_cargo ric ON ric.tenant_id = {tenant} AND ric.item_id = rc.item_id AND ric.cargo_id = ? AND ric.estado = 'activo'
        WHERE rc.tenant_id = {tenant} AND rc.estado <> 'descartado'`, [cargoId],
    ),
    repo.consultar("SELECT competencia FROM cargo_competencia WHERE tenant_id = {tenant} AND cargo_id = ? AND estado = 'activo'", [cargoId]),
    repo.consultar(
      `SELECT e.nombre, r.cantidad FROM cargo_epp r JOIN epp_elemento e ON e.tenant_id = {tenant} AND e.id = r.elemento_id
        WHERE r.tenant_id = {tenant} AND r.cargo_id = ? AND r.estado = 'activo' ORDER BY e.nombre`, [cargoId],
    ),
    repo.consultar("SELECT COUNT(*) AS n FROM vinculacion WHERE tenant_id = {tenant} AND cargo_id = ? AND estado = 'activa'", [cargoId]),
    tipoDe(cargo.cargo_tipo_codigo),
    servicio.catalogo.peligrosTipo(),
    formacion.tipos(),
    servicio.catalogo.clases(),
    servicio.catalogo.jerarquia(),
  ]);
  const pelCat = new Map(tiposPel.map((p) => [p.codigo, p]));
  const identificados = new Set(peligros.map((p) => p.peligro_tipo_codigo).filter(Boolean));
  // Brecha: peligros tipicos del cargo tipo que la matriz vigente no tiene para este cargo.
  const brechas = tipo ? tipo.peligros.filter((x) => !identificados.has(x.peligro) && pelCat.has(x.peligro)).map((x) => ({ ...pelCat.get(x.peligro), ne: x.ne })) : [];
  const nombreComp = new Map(compCat.map((c) => [c.codigo, c.nombre]));
  return {
    cargo, tipo, trabajadores: Number(trab.n), epp, brechas,
    clases: new Map(clases.map((c) => [c.codigo, c.nombre])), jerarquia: new Map(jerarquia.map((j) => [j.codigo, j.nombre])),
    peligros: peligros.map((p) => ({ ...p, controles: controles.filter((c) => c.item_id === p.id) })),
    competencias: competencias.map((c) => ({ codigo: c.competencia, nombre: nombreComp.get(c.competencia) || c.competencia })),
    sugeridasTipo: tipo ? tipo.competencias.filter((c) => !competencias.some((x) => x.competencia === c)).map((c) => nombreComp.get(c) || c) : [],
  };
}

module.exports = { guardarCargo, crearDesdeTipos, perfil };
