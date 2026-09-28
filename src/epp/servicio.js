// M14: EPP. Elementos con stock, requisitos por cargo, entrega individual firmada (20 anios) y reposicion.
const crypto = require('crypto');
const cuentas = require('../db/cuentas');
const password = require('../auth/password');
const acuerdo = require('../../data/acuerdo_firma.json');
const { ipABinario } = require('../documentos/reglas');
const { hoyBogota, sumarDias } = require('../fechas/calendario');
const { error } = require('../comun/rutas');

const MOTIVOS = ['dotacion_inicial', 'reposicion', 'perdida', 'danio', 'cambio_talla'];
const DIAS_AVISO_REPOSICION = 15;
const fecha = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) ? String(v) : null);
const texto = (v, max) => { const s = String(v ?? '').trim(); return s ? s.slice(0, max) : null; };
const positivo = (v) => { const n = Number.parseInt(v, 10); return Number.isSafeInteger(n) && n > 0 ? n : null; };

async function elemento(repo, empresaId, id) {
  const e = await repo.obtener('epp_elemento', Number.parseInt(id, 10));
  if (!e || e.empresa_id !== empresaId) throw error(404, 'Elemento no encontrado');
  return e;
}

/** Elementos con saldo: ingresos menos entregas no anuladas. */
async function elementos(repo, empresaId) {
  return repo.consultar(
    `SELECT e.*,
            COALESCE((SELECT SUM(i.cantidad) FROM epp_ingreso i WHERE i.tenant_id = {tenant} AND i.elemento_id = e.id), 0)
          - COALESCE((SELECT SUM(x.cantidad) FROM epp_entrega x WHERE x.tenant_id = {tenant} AND x.elemento_id = e.id AND x.estado <> 'anulada'), 0) AS stock
       FROM epp_elemento e WHERE e.tenant_id = {tenant} AND e.empresa_id = ? ORDER BY e.estado, e.nombre`, [empresaId],
  );
}

async function crearElemento(repo, empresaId, d) {
  const nombre = texto(d.nombre, 150);
  if (!nombre) throw error(422, 'El nombre es obligatorio');
  const [dup] = await repo.listar('epp_elemento', { empresa_id: empresaId, nombre });
  if (dup) throw error(409, 'Ya existe ese elemento');
  return repo.insertar('epp_elemento', {
    empresa_id: empresaId, nombre, especificacion: texto(d.especificacion, 300), vida_util_dias: positivo(d.vida_util_dias),
  });
}

async function ingresar(repo, empresaId, d, hoy = hoyBogota()) {
  const e = await elemento(repo, empresaId, d.elemento_id);
  const cantidad = positivo(d.cantidad);
  const f = fecha(d.fecha) || hoy;
  if (!cantidad) throw error(422, 'Cantidad invalida');
  if (f > hoy) throw error(422, 'La fecha no puede ser futura');
  return repo.insertar('epp_ingreso', { elemento_id: e.id, fecha: f, cantidad, proveedor: texto(d.proveedor, 150) });
}

async function guardarRequisito(repo, empresaId, d) {
  const cargo = await repo.obtener('cargo', Number.parseInt(d.cargo_id, 10));
  if (!cargo || cargo.empresa_id !== empresaId) throw error(422, 'Cargo invalido');
  const e = await elemento(repo, empresaId, d.elemento_id);
  const cantidad = positivo(d.cantidad) || 1;
  const [previo] = await repo.listar('cargo_epp', { cargo_id: cargo.id, elemento_id: e.id });
  if (previo) return repo.actualizar('cargo_epp', previo.id, { cantidad, estado: 'activo' }, { accion: 'requerir' });
  return repo.insertar('cargo_epp', { cargo_id: cargo.id, elemento_id: e.id, cantidad });
}

async function retirarRequisito(repo, empresaId, id) {
  const r = await repo.obtener('cargo_epp', id);
  const cargo = r ? await repo.obtener('cargo', r.cargo_id) : null;
  if (!cargo || cargo.empresa_id !== empresaId) throw error(404, 'Requisito no encontrado');
  await repo.actualizar('cargo_epp', id, { estado: 'retirado' }, { accion: 'retirar' });
}

/**
 * Entrega. Manuscrita: exige la planilla ENTREGA_EPP firmada y queda entregada.
 * Electronica: queda pendiente hasta que el trabajador la firme desde Mis registros.
 */
async function entregar(repo, empresaId, d, hoy = hoyBogota()) {
  const personaId = Number.parseInt(d.persona_id, 10);
  const [v] = await repo.listar('vinculacion', { empresa_id: empresaId, persona_id: personaId, estado: 'activa' });
  if (!v) throw error(422, 'La persona no tiene vinculacion activa con la empresa');
  const e = await elemento(repo, empresaId, d.elemento_id);
  if (e.estado !== 'activo') throw error(409, 'El elemento esta inactivo');
  const cantidad = positivo(d.cantidad);
  const f = fecha(d.fecha) || hoy;
  if (!cantidad) throw error(422, 'Cantidad invalida');
  if (f > hoy) throw error(422, 'La fecha no puede ser futura');
  if (!MOTIVOS.includes(d.motivo)) throw error(422, 'Motivo invalido');
  if (!['electronica', 'manuscrita'].includes(d.modalidad)) throw error(422, 'Modalidad de firma invalida');
  let doc = null;
  if (d.modalidad === 'manuscrita') {
    doc = d.documento_id ? await repo.obtener('documento_sst', Number.parseInt(d.documento_id, 10)) : null;
    if (!doc || doc.empresa_id !== empresaId || doc.tipo_documental !== 'ENTREGA_EPP' || doc.estado !== 'vigente') {
      throw error(422, 'Asocie la planilla de entrega firmada (documento ENTREGA_EPP vigente)');
    }
  } else {
    const p = await repo.obtener('persona', personaId);
    if (!p.usuario_id) throw error(422, 'La persona no tiene usuario: use la planilla manuscrita o vincule su usuario');
  }
  return repo.transaccion(async (tx) => {
    // Bloquea el elemento: dos entregas simultaneas no dejan el stock en negativo.
    await tx.listar('epp_elemento', { id: e.id }, { bloquear: true });
    const [{ stock }] = await tx.consultar(
      `SELECT COALESCE((SELECT SUM(cantidad) FROM epp_ingreso WHERE tenant_id = {tenant} AND elemento_id = ?), 0)
            - COALESCE((SELECT SUM(cantidad) FROM epp_entrega WHERE tenant_id = {tenant} AND elemento_id = ? AND estado <> 'anulada'), 0) AS stock`, [e.id, e.id],
    );
    if (Number(stock) < cantidad) throw error(409, `Stock insuficiente de ${e.nombre}: hay ${stock}`);
    return tx.insertar('epp_entrega', {
      empresa_id: empresaId, persona_id: personaId, elemento_id: e.id, cantidad, fecha: f, motivo: d.motivo,
      fecha_reposicion: e.vida_util_dias ? sumarDias(f, e.vida_util_dias) : null, modalidad: d.modalidad,
      documento_id: doc ? doc.id : null, estado: d.modalidad === 'manuscrita' ? 'entregada' : 'pendiente_firma',
    });
  });
}

async function anularEntrega(repo, empresaId, id, motivo) {
  const x = await repo.obtener('epp_entrega', id);
  if (!x || x.empresa_id !== empresaId) throw error(404, 'Entrega no encontrada');
  if (x.estado !== 'pendiente_firma') throw error(409, 'Solo se anula una entrega pendiente de firma');
  const m = texto(motivo, 500);
  if (!m || m.length < 10) throw error(422, 'Indique el motivo');
  await repo.actualizar('epp_entrega', id, { estado: 'anulada', motivo_estado: m }, { accion: 'anular' });
}

/** Contenido firmado: lo que recibe, con huella para detectar alteraciones posteriores. */
function textoRecibo(x, e, firmante) {
  return `Yo, ${firmante.nombre} (${firmante.documento}), recibo ${x.cantidad} unidad(es) de ${e.nombre}${e.especificacion ? ` (${e.especificacion})` : ''} `
    + `el ${x.fecha}, me comprometo a usarlas y conservarlas segun la capacitacion recibida y a solicitar su reposicion cuando se deterioren.`;
}

/** Firma del trabajador: re-autenticacion con contrasena; acepta el acuerdo de firma si no lo ha hecho. */
async function firmarEntrega(repo, usuarioId, id, { clave, aceptaAcuerdo, ip, userAgent }) {
  const x = await repo.obtener('epp_entrega', id);
  const p = x ? await repo.obtener('persona', x.persona_id) : null;
  if (!x || !p || p.usuario_id !== usuarioId) throw error(404, 'Entrega no encontrada');
  if (x.estado !== 'pendiente_firma') throw error(409, 'La entrega ya fue firmada o anulada');
  const [ya] = await repo.listar('acuerdo_firma', { usuario_id: usuarioId, version: acuerdo.version });
  if (!ya && !aceptaAcuerdo) throw error(422, 'Debe aceptar el acuerdo de uso de firma electronica');
  const hash = await cuentas.obtenerPasswordHash(usuarioId);
  if (!hash || !(await password.verificar(String(clave || ''), hash))) {
    await cuentas.registrarFalloLogin(usuarioId);
    await repo.auditar('firma_fallida', 'epp_entrega', id, null, { motivo: 'clave' });
    throw error(422, 'Contrasena incorrecta');
  }
  const u = await cuentas.obtenerUsuario(usuarioId);
  const e = await repo.obtener('epp_elemento', x.elemento_id);
  const firmante = { nombre: `${u.nombres} ${u.apellidos}`, documento: `${u.tipo_documento} ${u.numero_documento}` };
  const textoFirmado = textoRecibo(x, e, firmante);
  const ahora = new Date();
  const ipBin = ipABinario(ip);
  const agente = userAgent ? String(userAgent).slice(0, 255) : null;
  await repo.transaccion(async (tx) => {
    if (!ya) await tx.insertar('acuerdo_firma', { usuario_id: usuarioId, version: acuerdo.version, texto: acuerdo.texto, ip: ipBin, user_agent: agente, aceptado_en: ahora });
    await tx.insertar('firma', {
      entidad: 'epp_entrega', entidad_id: id, firmante_id: usuarioId, firmante_nombre: firmante.nombre, firmante_documento: firmante.documento,
      rol_firmante: 'trabajador', texto_firmado: textoFirmado, hash_contenido: crypto.createHash('sha256').update(textoFirmado).digest('hex'),
      metodo_auth: 'password', ip: ipBin, user_agent: agente, firmado_en: ahora,
    });
    await tx.actualizar('epp_entrega', id, { estado: 'entregada' }, { accion: 'firmar' });
  });
}

async function entregas(repo, empresaId, { personaId = null, limite = 200 } = {}) {
  const params = [empresaId];
  let filtro = '';
  if (personaId) { filtro = 'AND x.persona_id = ?'; params.push(personaId); }
  return repo.consultar(
    `SELECT x.*, e.nombre AS elemento, p.nombres, p.apellidos FROM epp_entrega x
       JOIN epp_elemento e ON e.tenant_id = {tenant} AND e.id = x.elemento_id
       JOIN persona p ON p.tenant_id = {tenant} AND p.id = x.persona_id
      WHERE x.tenant_id = {tenant} AND x.empresa_id = ? ${filtro} ORDER BY x.fecha DESC, x.id DESC LIMIT ${Math.min(Math.max(Number.parseInt(limite, 10) || 200, 1), 1000)}`, params,
  );
}

/** Estado de cada requisito de EPP del cargo para cada persona activa. */
function estadoRequisito(ultima, hoy) {
  if (!ultima) return 'sin_entrega';
  if (ultima.estado === 'pendiente_firma') return 'pendiente_firma';
  if (ultima.fecha_reposicion && ultima.fecha_reposicion <= hoy) return 'reponer';
  if (ultima.fecha_reposicion && ultima.fecha_reposicion <= sumarDias(hoy, DIAS_AVISO_REPOSICION)) return 'por_reponer';
  return 'al_dia';
}

async function matriz(repo, empresaId, hoy = hoyBogota()) {
  const [personas, requisitos, ultimas] = await Promise.all([
    repo.consultar(
      `SELECT p.id, p.nombres, p.apellidos, v.cargo_id, c.nombre AS cargo FROM vinculacion v
         JOIN persona p ON p.tenant_id = {tenant} AND p.id = v.persona_id
         LEFT JOIN cargo c ON c.tenant_id = {tenant} AND c.id = v.cargo_id
        WHERE v.tenant_id = {tenant} AND v.empresa_id = ? AND v.estado = 'activa' ORDER BY c.nombre, p.apellidos`, [empresaId],
    ),
    repo.consultar(
      `SELECT r.id, r.cargo_id, r.elemento_id, r.cantidad, e.nombre AS elemento, c.nombre AS cargo FROM cargo_epp r
         JOIN epp_elemento e ON e.tenant_id = {tenant} AND e.id = r.elemento_id
         JOIN cargo c ON c.tenant_id = {tenant} AND c.id = r.cargo_id
        WHERE r.tenant_id = {tenant} AND c.empresa_id = ? AND r.estado = 'activo' ORDER BY c.nombre, e.nombre`, [empresaId],
    ),
    repo.consultar(
      `SELECT x.persona_id, x.elemento_id, x.fecha, x.fecha_reposicion, x.estado FROM epp_entrega x
        WHERE x.tenant_id = {tenant} AND x.empresa_id = ? AND x.estado <> 'anulada'
        ORDER BY x.fecha DESC, x.id DESC`, [empresaId],
    ),
  ]);
  const ultima = new Map();
  for (const u of ultimas) {
    const k = `${u.persona_id}|${u.elemento_id}`;
    if (!ultima.has(k)) ultima.set(k, u);
  }
  const filas = [];
  for (const p of personas) {
    for (const r of requisitos.filter((x) => x.cargo_id === p.cargo_id)) {
      const u = ultima.get(`${p.id}|${r.elemento_id}`);
      filas.push({ ...p, elemento_id: r.elemento_id, elemento: r.elemento, cantidad: r.cantidad, ultima: u || null, estado: estadoRequisito(u, hoy) });
    }
  }
  return { filas, requisitos, pendientes: filas.filter((f) => f.estado !== 'al_dia').length };
}

/** Lo que ve el trabajador: sus entregas y las pendientes de firma. */
async function dePersona(repo, personaId) {
  return repo.consultar(
    `SELECT x.id, x.fecha, x.cantidad, x.estado, x.fecha_reposicion, e.nombre AS elemento, e.especificacion FROM epp_entrega x
       JOIN epp_elemento e ON e.tenant_id = {tenant} AND e.id = x.elemento_id
      WHERE x.tenant_id = {tenant} AND x.persona_id = ? AND x.estado <> 'anulada' ORDER BY x.estado = 'pendiente_firma' DESC, x.fecha DESC`, [personaId],
  );
}

module.exports = {
  MOTIVOS, elementos, crearElemento, ingresar, guardarRequisito, retirarRequisito, entregar, anularEntrega, firmarEntrega,
  entregas, estadoRequisito, matriz, dePersona, textoRecibo,
};
