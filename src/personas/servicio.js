// M02: personas, vinculaciones y cargos. El retiro dispara el examen de egreso (5 dias) y
// fija la retencion de 20 anios de sus registros (art. 2.2.4.6.13).
const { hoyBogota } = require('../fechas/calendario');
const plazos = require('../plazos/servicio');
const gestor = require('../documentos/servicio');
const r = require('../empresa/reglas');

const texto = (v, max) => { const s = String(v ?? '').trim(); return s ? s.slice(0, max) : null; };

function error(status, mensaje) {
  const e = new Error(mensaje);
  e.status = status;
  return e;
}

// ---------- Personas

async function listar(repo, empresaId, { q = '', estado = '' } = {}) {
  let sql = `SELECT p.id, p.tipo_documento, p.numero_documento, p.nombres, p.apellidos, p.estado,
                    v.id AS vinculacion_id, v.tipo, v.estado AS vinculacion_estado, v.fecha_ingreso, v.fecha_retiro,
                    c.nombre AS cargo, ct.nombre AS centro
               FROM persona p
               LEFT JOIN vinculacion v ON v.tenant_id = {tenant} AND v.persona_id = p.id AND v.id = (
                    SELECT MAX(v2.id) FROM vinculacion v2
                     WHERE v2.tenant_id = {tenant} AND v2.persona_id = p.id AND v2.empresa_id = ? AND v2.estado <> 'anulada')
               LEFT JOIN cargo c ON c.tenant_id = {tenant} AND c.id = v.cargo_id
               LEFT JOIN centro_trabajo ct ON ct.tenant_id = {tenant} AND ct.id = v.centro_trabajo_id
              WHERE p.tenant_id = {tenant}`;
  const params = [empresaId];
  if (estado === 'activas') sql += " AND v.estado = 'activa'";
  else if (estado === 'retiradas') sql += " AND v.estado = 'retirada'";
  else if (estado === 'sin') sql += ' AND v.id IS NULL';
  const t = String(q || '').trim().slice(0, 60);
  if (t) {
    sql += ' AND (p.numero_documento LIKE ? OR CONCAT(p.nombres, \' \', p.apellidos) LIKE ?)';
    params.push(`%${t}%`, `%${t}%`);
  }
  sql += ' ORDER BY p.apellidos, p.nombres LIMIT 1000';
  return repo.consultar(sql, params);
}

async function datosPersona(d) {
  const doc = r.validarDocumento(d.tipo_documento, d.numero_documento);
  const nombres = texto(d.nombres, 100);
  const apellidos = texto(d.apellidos, 100);
  if (!nombres || !apellidos) throw r.errorValidacion('Nombres y apellidos son obligatorios');
  const sexo = d.sexo ? String(d.sexo) : null;
  if (sexo && !['F', 'M', 'NB'].includes(sexo)) throw r.errorValidacion('Sexo invalido');
  const nacimiento = d.fecha_nacimiento ? String(d.fecha_nacimiento) : null;
  if (nacimiento && (!/^\d{4}-\d{2}-\d{2}$/.test(nacimiento) || nacimiento > hoyBogota())) throw r.errorValidacion('Fecha de nacimiento invalida');
  return {
    tipo_documento: doc.tipo, numero_documento: doc.numero, nombres, apellidos, sexo, fecha_nacimiento: nacimiento,
    email: r.validarEmail(d.email), telefono: texto(d.telefono, 30), eps: texto(d.eps, 100), afp: texto(d.afp, 100),
  };
}

async function documentoLibre(repo, fila, excepto = null) {
  const [otra] = await repo.listar('persona', { tipo_documento: fila.tipo_documento, numero_documento: fila.numero_documento });
  if (otra && otra.id !== excepto) {
    const e = error(409, `Ya existe una persona con ${fila.tipo_documento} ${fila.numero_documento}`);
    e.personaId = otra.id;
    throw e;
  }
}

/** Crea la persona y, si viene, su vinculacion inicial con la empresa activa. */
async function crear(repo, empresaId, d) {
  const fila = await datosPersona(d);
  await documentoLibre(repo, fila);
  const id = await repo.insertar('persona', fila);
  if (d.vincular === '1' || d.vincular === true) await vincular(repo, empresaId, id, d);
  return id;
}

async function personaDelTenant(repo, id) {
  const p = await repo.obtener('persona', id);
  if (!p) throw error(404, 'Persona no encontrada');
  return p;
}

async function editar(repo, id, d) {
  await personaDelTenant(repo, id);
  const fila = await datosPersona(d);
  await documentoLibre(repo, fila, id);
  await repo.actualizar('persona', id, fila);
}

async function detalle(repo, empresaId, id) {
  const persona = await personaDelTenant(repo, id);
  const [vinculaciones, documentos, obligaciones] = await Promise.all([
    repo.consultar(
      `SELECT v.*, c.nombre AS cargo, ct.nombre AS centro, e.razon_social
         FROM vinculacion v
         JOIN empresa e ON e.tenant_id = {tenant} AND e.id = v.empresa_id
         LEFT JOIN cargo c ON c.tenant_id = {tenant} AND c.id = v.cargo_id
         LEFT JOIN centro_trabajo ct ON ct.tenant_id = {tenant} AND ct.id = v.centro_trabajo_id
        WHERE v.tenant_id = {tenant} AND v.persona_id = ? ORDER BY v.fecha_ingreso DESC, v.id DESC`, [id],
    ),
    repo.consultar(
      `SELECT d.id, d.codigo, d.titulo, d.version, d.estado, d.fecha_documento, d.retencion_hasta, t.nombre AS tipo, t.retencion
         FROM documento_sst d JOIN tipo_documental t ON t.codigo = d.tipo_documental
        WHERE d.tenant_id = {tenant} AND d.persona_id = ? ORDER BY d.fecha_documento DESC`, [id],
    ),
    repo.consultar(
      `SELECT o.plazo_codigo, o.descripcion, o.fecha_limite, o.estado FROM obligacion_pendiente o
        WHERE o.tenant_id = {tenant} AND o.entidad_origen_tipo = 'vinculacion'
          AND o.entidad_origen_id IN (SELECT v.id FROM vinculacion v WHERE v.tenant_id = {tenant} AND v.persona_id = ?)
        ORDER BY o.fecha_limite DESC`, [id],
    ),
  ]);
  return {
    persona, documentos, obligaciones,
    vinculaciones: vinculaciones.map((v) => ({ ...v, deEstaEmpresa: v.empresa_id === empresaId })),
  };
}

// ---------- Vinculaciones

async function validarAsignacion(repo, empresaId, { cargo_id: cargoId, centro_trabajo_id: centroId }) {
  const cargo = cargoId ? await repo.obtener('cargo', Number.parseInt(cargoId, 10)) : null;
  if (cargoId && (!cargo || cargo.empresa_id !== empresaId || cargo.estado !== 'activo')) throw r.errorValidacion('Cargo invalido');
  const centro = centroId ? await repo.obtener('centro_trabajo', Number.parseInt(centroId, 10)) : null;
  if (centroId && (!centro || centro.empresa_id !== empresaId || centro.estado !== 'activo')) throw r.errorValidacion('Centro de trabajo invalido');
  return { cargo_id: cargo ? cargo.id : null, centro_trabajo_id: centro ? centro.id : null };
}

async function vincular(repo, empresaId, personaId, d) {
  await personaDelTenant(repo, personaId);
  const tipo = String(d.tipo || '');
  if (!r.TIPOS_VINCULACION[tipo]) throw r.errorValidacion('Tipo de vinculacion invalido');
  const ingreso = String(d.fecha_ingreso || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ingreso)) throw r.errorValidacion('Fecha de ingreso invalida');
  const activas = await repo.listar('vinculacion', { empresa_id: empresaId, persona_id: personaId, estado: 'activa' });
  if (activas.length) throw error(409, 'La persona ya tiene una vinculacion activa con esta empresa');
  const asignacion = await validarAsignacion(repo, empresaId, d);
  return repo.transaccion(async (tx) => {
    const id = await tx.insertar('vinculacion', { empresa_id: empresaId, persona_id: personaId, tipo, fecha_ingreso: ingreso, ...asignacion });
    await plazos.dispararEvento(tx, { evento: 'vinculacion.ingreso', variante: tipo, fecha: ingreso, empresaId, entidadTipo: 'vinculacion', entidadId: id });
    return id;
  });
}

async function vinculacionActiva(repo, empresaId, id) {
  const v = await repo.obtener('vinculacion', id);
  if (!v || v.empresa_id !== empresaId) throw error(404, 'Vinculacion no encontrada');
  if (v.estado !== 'activa') throw error(409, 'La vinculacion ya esta cerrada');
  return v;
}

async function reasignar(repo, empresaId, id, d) {
  await vinculacionActiva(repo, empresaId, id);
  await repo.actualizar('vinculacion', id, await validarAsignacion(repo, empresaId, d), { accion: 'reasignar' });
}

/** Retiro: dispara el examen de egreso y fija la retencion de 20 anios de los registros de la persona. */
async function retirar(repo, empresaId, id, { fecha, motivo }, hoy = hoyBogota()) {
  const v = await vinculacionActiva(repo, empresaId, id);
  const f = r.validarRetiro(v, fecha, hoy);
  const m = texto(motivo, 255);
  if (!m) throw r.errorValidacion('Indique el motivo del retiro');
  await repo.transaccion(async (tx) => {
    await tx.actualizar('vinculacion', id, { estado: 'retirada', fecha_retiro: f, motivo_retiro: m }, { accion: 'retirar' });
    await plazos.dispararEvento(tx, { evento: 'vinculacion.retiro', variante: v.tipo, fecha: f, empresaId, entidadTipo: 'vinculacion', entidadId: id }, hoy);
  });
  await gestor.recalcularRetencion(repo);
}

/** Solo para registros hechos por error; queda la traza con el motivo. */
async function anularVinculacion(repo, empresaId, id, motivo) {
  await vinculacionActiva(repo, empresaId, id);
  const m = texto(motivo, 500);
  if (!m || m.length < 10) throw r.errorValidacion('Explique por que se anula (minimo 10 caracteres)');
  await repo.actualizar('vinculacion', id, { estado: 'anulada', observacion: m }, { accion: 'anular' });
}

// ---------- Cargos

async function cargos(repo, empresaId, { soloActivos = false } = {}) {
  const filtro = soloActivos ? { empresa_id: empresaId, estado: 'activo' } : { empresa_id: empresaId };
  return repo.listar('cargo', filtro, { orden: 'nombre' });
}

async function centrosActivos(repo, empresaId) {
  return repo.listar('centro_trabajo', { empresa_id: empresaId, estado: 'activo' }, { orden: 'nombre' });
}

async function guardarCargo(repo, empresaId, id, d) {
  const nombre = texto(d.nombre, 150);
  if (!nombre || nombre.length < 3) throw r.errorValidacion('Nombre del cargo obligatorio');
  const fila = {
    nombre, cargo_tipo_codigo: d.cargo_tipo_codigo || null, descripcion: texto(d.descripcion, 5000), perfil_riesgo: texto(d.perfil_riesgo, 5000),
  };
  const [mismo] = await repo.listar('cargo', { empresa_id: empresaId, nombre });
  if (mismo && mismo.id !== id) throw error(409, 'Ya existe un cargo con ese nombre');
  if (!id) return repo.insertar('cargo', { empresa_id: empresaId, ...fila });
  const c = await repo.obtener('cargo', id);
  if (!c || c.empresa_id !== empresaId) throw error(404, 'Cargo no encontrado');
  await repo.actualizar('cargo', id, fila);
  return id;
}

async function cambiarEstadoCargo(repo, empresaId, id, activo) {
  const c = await repo.obtener('cargo', id);
  if (!c || c.empresa_id !== empresaId) throw error(404, 'Cargo no encontrado');
  if (!activo) {
    const [enUso] = await repo.consultar("SELECT COUNT(*) AS n FROM vinculacion WHERE tenant_id = {tenant} AND cargo_id = ? AND estado = 'activa'", [id]);
    if (Number(enUso.n)) throw error(409, `El cargo tiene ${enUso.n} vinculacion(es) activa(s)`);
  }
  await repo.actualizar('cargo', id, { estado: activo ? 'activo' : 'inactivo' }, { accion: activo ? 'activar' : 'inactivar' });
}

module.exports = {
  listar, crear, editar, detalle, vincular, reasignar, retirar, anularVinculacion,
  cargos, centrosActivos, guardarCargo, cambiarEstadoCargo,
};
