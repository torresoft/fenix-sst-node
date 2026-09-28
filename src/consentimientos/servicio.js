// Autorizaciones de tratamiento de datos (Ley 1581/2012) versionadas por finalidad. Append-only:
// una nueva version o una negativa es un registro nuevo; la revocacion solo marca el registro.
const { consultarCatalogo } = require('../db/global');
const { ipABinario } = require('../documentos/reglas');
const { error } = require('../comun/rutas');

const MEDIOS = ['web', 'fisico_escaneado', 'verbal_registrado'];

const finalidades = () => consultarCatalogo("SELECT codigo, nombre, es_dato_sensible, norma_codigo, version, texto FROM finalidad_datos WHERE estado = 'activo' ORDER BY es_dato_sensible, nombre");

/** Estado de una persona frente a una finalidad segun su ultimo registro. */
function estado(ultimo, finalidad) {
  if (!ultimo) return 'sin_registro';
  if (ultimo.estado === 'revocado') return 'revocado';
  if (!ultimo.otorgado) return 'negado';
  return ultimo.politica_version === finalidad.version ? 'vigente' : 'desactualizado';
}

async function ultimos(repo, personaIds) {
  if (!personaIds.length) return new Map();
  const filas = await repo.consultar(
    `SELECT c.* FROM consentimiento c
      WHERE c.tenant_id = {tenant} AND c.persona_id IN (${personaIds.map(() => '?').join(',')})
      ORDER BY c.otorgado_en DESC, c.id DESC`, personaIds,
  );
  const m = new Map();
  for (const f of filas) {
    const k = `${f.persona_id}|${f.finalidad}`;
    if (!m.has(k)) m.set(k, f);
  }
  return m;
}

/** Matriz personas x finalidades de la empresa. */
async function matriz(repo, empresaId) {
  const [fins, personas] = await Promise.all([
    finalidades(),
    repo.consultar(
      `SELECT p.id, p.nombres, p.apellidos, p.numero_documento FROM persona p
         JOIN vinculacion v ON v.tenant_id = {tenant} AND v.persona_id = p.id AND v.empresa_id = ? AND v.estado = 'activa'
        WHERE p.tenant_id = {tenant} GROUP BY p.id, p.nombres, p.apellidos, p.numero_documento ORDER BY p.apellidos, p.nombres`, [empresaId],
    ),
  ]);
  const u = await ultimos(repo, personas.map((p) => p.id));
  const filas = personas.map((p) => ({
    ...p,
    estados: Object.fromEntries(fins.map((f) => {
      const ult = u.get(`${p.id}|${f.codigo}`);
      return [f.codigo, { estado: estado(ult, f), id: ult ? ult.id : null, version: ult ? ult.politica_version : null }];
    })),
  }));
  const pendientes = filas.reduce((s, p) => s + fins.filter((f) => ['sin_registro', 'desactualizado'].includes(p.estados[f.codigo].estado)).length, 0);
  return { finalidades: fins, filas, pendientes };
}

async function finalidad(codigo) {
  const f = (await finalidades()).find((x) => x.codigo === codigo);
  if (!f) throw error(422, 'Finalidad invalida');
  return f;
}

/**
 * Registra la decision de la persona sobre la version actual del texto.
 * medio web: la otorga el propio titular desde su sesion; fisico: exige el soporte escaneado (AUTORIZACION_DATOS).
 */
async function registrar(repo, personaId, d) {
  const f = await finalidad(d.finalidad);
  if (!MEDIOS.includes(d.medio)) throw error(422, 'Medio invalido');
  const otorgado = d.otorgado === '1' || d.otorgado === true ? 1 : 0;
  let documentoId = null;
  if (d.medio === 'fisico_escaneado') {
    const doc = d.documento_id ? await repo.obtener('documento_sst', Number.parseInt(d.documento_id, 10)) : null;
    if (!doc || doc.tipo_documental !== 'AUTORIZACION_DATOS' || doc.estado !== 'vigente' || doc.persona_id !== personaId) {
      throw error(422, 'Asocie la autorizacion firmada (documento AUTORIZACION_DATOS vigente de la persona)');
    }
    documentoId = doc.id;
  }
  if (d.medio === 'verbal_registrado' && f.es_dato_sensible) throw error(422, 'Los datos sensibles requieren autorizacion expresa escrita o electronica');
  return repo.insertar('consentimiento', {
    persona_id: personaId, finalidad: f.codigo, es_dato_sensible: f.es_dato_sensible, politica_version: f.version, texto_mostrado: f.texto,
    otorgado, medio: d.medio, documento_id: documentoId, ip: d.medio === 'web' ? ipABinario(repo.actor.ip) : null, otorgado_en: new Date(),
  });
}

async function revocar(repo, personaId, id) {
  const c = await repo.obtener('consentimiento', id);
  if (!c || c.persona_id !== personaId) throw error(404, 'Autorizacion no encontrada');
  if (c.estado === 'revocado') throw error(409, 'La autorizacion ya fue revocada');
  if (!c.otorgado) throw error(409, 'Una negativa no se revoca: registre una autorizacion nueva');
  await repo.actualizar('consentimiento', id, { estado: 'revocado', revocado_en: new Date() }, { accion: 'revocar' });
}

/** Lo que ve el titular: cada finalidad con su estado y el texto vigente. */
async function dePersona(repo, personaId) {
  const fins = await finalidades();
  const u = await ultimos(repo, [personaId]);
  return fins.map((f) => {
    const ult = u.get(`${personaId}|${f.codigo}`);
    return { ...f, estado: estado(ult, f), id: ult ? ult.id : null, otorgado_en: ult ? ult.otorgado_en : null };
  });
}

/** Persona vinculada al usuario en sesion (canal del trabajador). */
async function personaDeUsuario(repo, usuarioId) {
  const [p] = await repo.listar('persona', { usuario_id: usuarioId });
  if (!p) throw error(422, 'Su usuario no esta vinculado a una persona de esta empresa');
  return p;
}

/** Personas de la empresa que no han autorizado vigente una finalidad (p. ej. antes de aplicar la bateria). */
async function sinAutorizar(repo, empresaId, codigo) {
  const m = await matriz(repo, empresaId);
  return m.filas.filter((p) => p.estados[codigo] && p.estados[codigo].estado !== 'vigente');
}

module.exports = { personaDeUsuario, MEDIOS, finalidades, estado, matriz, registrar, revocar, dePersona, sinAutorizar };
