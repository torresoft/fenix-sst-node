// M03: gestor documental del SG-SST. Borrador editable -> en firma -> vigente -> reemplazado/anulado.
// Nada se borra ni se sobrescribe: una correccion es una version nueva.
const config = require('../config');
const { consultarCatalogo } = require('../db/global');
const cuentas = require('../db/cuentas');
const password = require('../auth/password');
const correo = require('../correo');
const { normalizar, hoyBogota } = require('../fechas/calendario');
const plazos = require('../plazos/servicio');
const almacen = require('./almacen');
const r = require('./reglas');
const acuerdo = require('../../data/acuerdo_firma.json');

const RE_CODIGO = /^[A-Za-z0-9._-]{2,60}$/;
const MODALIDADES = ['electronica', 'manuscrita', 'digital_externa'];

function error(status, mensaje) {
  const e = new Error(mensaje);
  e.status = status;
  return e;
}

/** Relee la fila con bloqueo dentro de la transaccion: dos transiciones de estado no se pisan. */
async function bloquearEstado(tx, tabla, id, estados, mensaje) {
  const [f] = await tx.listar(tabla, { id }, { bloquear: true });
  if (!f || !estados.includes(f.estado)) throw error(409, mensaje);
  return f;
}
const parse =(v) => (typeof v === 'string' ? JSON.parse(v) : v);

async function tipoDocumental(codigo) {
  const [t] = await consultarCatalogo("SELECT * FROM tipo_documental WHERE codigo = ? AND estado = 'activo'", [String(codigo || '')]);
  if (!t) throw error(422, 'Tipo documental inexistente');
  return { ...t, modalidades_firma: parse(t.modalidades_firma) || [] };
}

async function tiposActivos() {
  const filas = await consultarCatalogo("SELECT * FROM tipo_documental WHERE estado = 'activo' ORDER BY nombre");
  return filas.map((t) => ({ ...t, modalidades_firma: parse(t.modalidades_firma) || [] }));
}

async function obtener(repo, empresaId, id) {
  const d = await repo.obtener('documento_sst', id);
  if (!d || d.empresa_id !== empresaId) throw error(404, 'Documento no encontrado');
  return d;
}

// ---------- Consulta

async function listar(repo, empresaId, { tipo, estado, q } = {}) {
  let sql = `SELECT d.id, d.codigo, d.titulo, d.version, d.tipo_documental, t.nombre AS tipo_nombre, d.fecha_documento,
                    d.fecha_vence, d.estado, d.modalidad_firma,
                    (SELECT COUNT(*) FROM firma_solicitud s WHERE s.tenant_id = {tenant} AND s.documento_id = d.id AND s.estado <> 'anulada') AS firmas_total,
                    (SELECT COUNT(*) FROM firma_solicitud s2 WHERE s2.tenant_id = {tenant} AND s2.documento_id = d.id AND s2.estado = 'firmada') AS firmas_hechas
               FROM documento_sst d JOIN tipo_documental t ON t.codigo = d.tipo_documental
              WHERE d.tenant_id = {tenant} AND d.empresa_id = ?`;
  const params = [empresaId];
  if (tipo) { sql += ' AND d.tipo_documental = ?'; params.push(String(tipo)); }
  if (estado === 'historico') sql += " AND d.estado IN ('reemplazado','anulado')";
  else if (estado) { sql += ' AND d.estado = ?'; params.push(String(estado)); } else sql += " AND d.estado IN ('borrador','en_firma','vigente')";
  if (q) { sql += ' AND (d.codigo LIKE ? OR d.titulo LIKE ?)'; params.push(`%${String(q).slice(0, 60)}%`, `%${String(q).slice(0, 60)}%`); }
  sql += ' ORDER BY d.codigo, d.version DESC LIMIT 500';
  return repo.consultar(sql, params);
}

async function detalle(repo, empresaId, id) {
  const doc = await obtener(repo, empresaId, id);
  const tipo = await tipoDocumental(doc.tipo_documental);
  const [firmas, solicitudes, versiones, normas, estandares, matriz, obligaciones] = await Promise.all([
    repo.consultar(
      `SELECT id, firmante_id, firmante_nombre, firmante_documento, rol_firmante, texto_firmado, hash_contenido, metodo_auth,
              INET6_NTOA(ip) AS ip, firmado_en
         FROM firma WHERE tenant_id = {tenant} AND entidad = 'documento_sst' AND entidad_id = ? ORDER BY firmado_en`, [id],
    ),
    repo.listar('firma_solicitud', { documento_id: id }, { orden: 'id' }),
    repo.consultar(
      `SELECT id, version, estado, fecha_documento, creado_en FROM documento_sst
        WHERE tenant_id = {tenant} AND empresa_id = ? AND codigo = ? ORDER BY version DESC`, [empresaId, doc.codigo],
    ),
    repo.consultar(
      `SELECT dn.norma_codigo, n.objeto, n.estado_vigencia FROM documento_norma dn
         LEFT JOIN norma n ON n.codigo = dn.norma_codigo
        WHERE dn.tenant_id = {tenant} AND dn.documento_id = ? AND dn.estado = 'activo' ORDER BY dn.norma_codigo`, [id],
    ),
    repo.consultar(
      "SELECT numeral FROM evidencia_estandar WHERE tenant_id = {tenant} AND documento_id = ? AND estado = 'activo' ORDER BY numeral", [id],
    ),
    repo.consultar(
      `SELECT i.norma_codigo FROM matriz_legal_evidencia ev JOIN matriz_legal_item i ON i.tenant_id = {tenant} AND i.id = ev.item_id
        WHERE ev.tenant_id = {tenant} AND ev.documento_id = ? AND ev.estado = 'activo'`, [id],
    ),
    repo.consultar(
      `SELECT plazo_codigo, fecha_limite, estado FROM obligacion_pendiente
        WHERE tenant_id = {tenant} AND entidad_origen_tipo = 'documento_sst' AND entidad_origen_id = ? ORDER BY fecha_limite DESC`, [id],
    ),
  ]);
  const nombres = await cuentas.nombresUsuarios(solicitudes.map((s) => s.usuario_id));
  const persona = doc.persona_id ? await repo.obtener('persona', doc.persona_id) : null;
  return {
    doc, tipo, firmas, versiones, normas, estandares, matriz, obligaciones, persona,
    solicitudes: solicitudes.map((s) => ({ ...s, nombre: nombres.get(s.usuario_id) || `#${s.usuario_id}` })),
    impedimentos: r.impedimentosPublicar(doc, tipo, solicitudes),
  };
}

// ---------- Alta y edicion

async function validarDatos(repo, tipo, datos, { parcial = false } = {}) {
  const titulo = String(datos.titulo || '').trim();
  if (titulo.length < 3) throw error(422, 'El titulo es obligatorio');
  let fechaDocumento;
  try { fechaDocumento = normalizar(datos.fecha_documento); } catch { throw error(422, 'Fecha del documento invalida'); }
  let fechaVence = null;
  if (datos.fecha_vence) {
    try { fechaVence = normalizar(datos.fecha_vence); } catch { throw error(422, 'Fecha de vencimiento invalida'); }
    if (fechaVence <= fechaDocumento) throw error(422, 'El vencimiento debe ser posterior a la fecha del documento');
  }
  let modalidad = null;
  if (Number(tipo.requiere_firma)) {
    modalidad = String(datos.modalidad_firma || '');
    if (!MODALIDADES.includes(modalidad) || !tipo.modalidades_firma.includes(modalidad)) throw error(422, 'Modalidad de firma no admitida para este tipo');
  }
  const personaId = datos.persona_id ? Number.parseInt(datos.persona_id, 10) : null;
  if (personaId && !(await repo.obtener('persona', personaId))) throw error(422, 'Persona inexistente');
  const normas = [...new Set([].concat(datos.normas || []).map(String).filter(Boolean))];
  if (normas.length) {
    const existentes = await consultarCatalogo(`SELECT codigo FROM norma WHERE codigo IN (${normas.map(() => '?').join(', ')})`, normas);
    if (existentes.length !== normas.length) throw error(422, 'Hay normas citadas que no existen en el catalogo');
  }
  const vigencia = datos.vigencia_anio ? Number.parseInt(datos.vigencia_anio, 10) : null;
  if (vigencia && (vigencia < 2000 || vigencia > 2100)) throw error(422, 'Vigencia invalida');
  return {
    fila: {
      titulo: titulo.slice(0, 255),
      descripcion: String(datos.descripcion || '').trim().slice(0, 1000) || null,
      fecha_documento: fechaDocumento,
      fecha_vence: fechaVence,
      vigencia_anio: vigencia,
      persona_id: personaId,
      modalidad_firma: modalidad,
      firmantes_externos: modalidad && modalidad !== 'electronica' ? String(datos.firmantes_externos || '').trim().slice(0, 500) || null : null,
      referencia_custodio: Number(tipo.solo_referencia) ? String(datos.referencia_custodio || '').trim().slice(0, 255) || null : null,
    },
    normas,
    parcial,
  };
}

async function guardarArchivo(repo, empresaId, tipo, archivo) {
  const v = r.validarArchivo(archivo, tipo, config.almacen.maxBytes);
  if (!v) return {};
  const ruta = await almacen.guardar(repo.tenantId, empresaId, archivo.buffer, v.hash, v.ext);
  return {
    archivo_ruta: ruta, archivo_hash: v.hash, archivo_nombre: String(archivo.originalname).slice(0, 255),
    archivo_mime: archivo.mimetype, archivo_bytes: v.bytes,
  };
}

async function sincronizarNormas(tx, documentoId, normas) {
  const actuales = await tx.listar('documento_norma', { documento_id: documentoId });
  const porCodigo = new Map(actuales.map((n) => [n.norma_codigo, n]));
  for (const c of normas) {
    const n = porCodigo.get(c);
    if (!n) await tx.insertar('documento_norma', { documento_id: documentoId, norma_codigo: c });
    else if (n.estado !== 'activo') await tx.actualizar('documento_norma', n.id, { estado: 'activo' });
  }
  for (const n of actuales) if (n.estado === 'activo' && !normas.includes(n.norma_codigo)) await tx.actualizar('documento_norma', n.id, { estado: 'retirado' });
}

async function crear(repo, empresaId, datos, archivo) {
  const tipo = await tipoDocumental(datos.tipo_documental);
  const codigo = String(datos.codigo || '').trim().toUpperCase();
  if (!RE_CODIGO.test(codigo)) throw error(422, 'Codigo invalido: letras, numeros, punto, guion (2 a 60)');
  const v = await validarDatos(repo, tipo, datos);
  const previos = await repo.listar('documento_sst', { empresa_id: empresaId, codigo });
  if (previos.length) throw error(409, `Ya existe el documento ${codigo}: cree una version nueva desde el vigente`);
  const arch = await guardarArchivo(repo, empresaId, tipo, archivo);
  return repo.transaccion(async (tx) => {
    const id = await tx.insertar('documento_sst', {
      empresa_id: empresaId, tipo_documental: tipo.codigo, codigo, version: 1, estado: 'borrador', ...v.fila, ...arch,
    });
    await sincronizarNormas(tx, id, v.normas);
    return id;
  });
}

async function editar(repo, empresaId, id, datos, archivo) {
  const doc = await obtener(repo, empresaId, id);
  if (doc.estado !== 'borrador') throw error(409, 'Solo se edita un borrador');
  const tipo = await tipoDocumental(doc.tipo_documental);
  const v = await validarDatos(repo, tipo, datos);
  const arch = await guardarArchivo(repo, empresaId, tipo, archivo);
  await repo.transaccion(async (tx) => {
    await bloquearEstado(tx, 'documento_sst', id, ['borrador'], 'Solo se edita un borrador');
    await tx.actualizar('documento_sst', id, { ...v.fila, ...arch });
    await sincronizarNormas(tx, id, v.normas);
  });
}

/** Version nueva desde el vigente: nace en borrador; al publicarse reemplaza a la anterior. */
async function nuevaVersion(repo, empresaId, id, datos, archivo) {
  const base = await obtener(repo, empresaId, id);
  if (base.estado !== 'vigente') throw error(409, 'Solo se versiona el documento vigente');
  const hermanos = await repo.listar('documento_sst', { empresa_id: empresaId, codigo: base.codigo });
  if (hermanos.some((h) => ['borrador', 'en_firma'].includes(h.estado))) throw error(409, 'Ya hay una version en curso de este documento');
  const tipo = await tipoDocumental(base.tipo_documental);
  const v = await validarDatos(repo, tipo, { persona_id: base.persona_id, ...datos });
  const arch = await guardarArchivo(repo, empresaId, tipo, archivo);
  if (!Number(tipo.solo_referencia) && !arch.archivo_hash) throw error(422, 'La version nueva requiere su archivo');
  return repo.transaccion(async (tx) => {
    const nuevo = await tx.insertar('documento_sst', {
      empresa_id: empresaId, tipo_documental: base.tipo_documental, codigo: base.codigo,
      version: Math.max(...hermanos.map((h) => h.version)) + 1, documento_padre_id: base.id, estado: 'borrador', ...v.fila, ...arch,
    });
    await sincronizarNormas(tx, nuevo, v.normas);
    return nuevo;
  });
}

// ---------- Retencion

async function aniosRetencion(repo, empresaId, tipoCodigo) {
  const [f] = await repo.listar('retencion_empresa', { empresa_id: empresaId, tipo_documental: tipoCodigo, estado: 'activo' });
  return f ? f.anios : null;
}

async function tablaRetencion(repo, empresaId) {
  const tipos = (await tiposActivos()).filter((t) => t.retencion === 'segun_tabla_retencion_empresa');
  const filas = await repo.listar('retencion_empresa', { empresa_id: empresaId, estado: 'activo' });
  const anios = new Map(filas.map((f) => [f.tipo_documental, f.anios]));
  return tipos.map((t) => ({ codigo: t.codigo, nombre: t.nombre, anios: anios.get(t.codigo) ?? null }));
}

async function guardarRetencion(repo, empresaId, valores) {
  const tipos = new Set((await tablaRetencion(repo, empresaId)).map((t) => t.codigo));
  return repo.transaccion(async (tx) => {
    const actuales = new Map((await tx.listar('retencion_empresa', { empresa_id: empresaId })).map((f) => [f.tipo_documental, f]));
    for (const [codigo, valor] of Object.entries(valores || {})) {
      if (!tipos.has(codigo) || valor === '' || valor == null) continue;
      const anios = Number.parseInt(valor, 10);
      if (!Number.isInteger(anios) || anios < 1 || anios > 100) throw error(422, `Anios invalidos para ${codigo}`);
      const f = actuales.get(codigo);
      if (!f) await tx.insertar('retencion_empresa', { empresa_id: empresaId, tipo_documental: codigo, anios });
      else if (f.anios !== anios || f.estado !== 'activo') await tx.actualizar('retencion_empresa', f.id, { anios, estado: 'activo' });
    }
  });
}

/** Job diario: fija retencion_hasta donde ya se conoce (retiro de la persona o cierre del documento). */
async function recalcularRetencion(repo) {
  let n = 0;
  const personales = await repo.consultar(
    `SELECT d.id, MAX(v.fecha_retiro) AS fecha_retiro, SUM(v.estado = 'activa') AS activas
       FROM documento_sst d
       JOIN tipo_documental t ON t.codigo = d.tipo_documental
       JOIN vinculacion v ON v.tenant_id = {tenant} AND v.persona_id = d.persona_id AND v.empresa_id = d.empresa_id
      WHERE d.tenant_id = {tenant} AND d.retencion_hasta IS NULL AND t.retencion = '20_anios_desde_retiro'
      GROUP BY d.id HAVING activas = 0 AND fecha_retiro IS NOT NULL`,
  );
  for (const d of personales) {
    await repo.actualizar('documento_sst', d.id, { retencion_hasta: r.retencionHasta({ retencion: '20_anios_desde_retiro' }, { fechaRetiro: d.fecha_retiro }) }, { accion: 'fijar_retencion' });
    n++;
  }
  const cerrados = await repo.consultar(
    `SELECT d.id, DATE(COALESCE(d.actualizado_en, d.creado_en)) AS fecha_cierre, re.anios
       FROM documento_sst d
       JOIN retencion_empresa re ON re.tenant_id = {tenant} AND re.empresa_id = d.empresa_id
            AND re.tipo_documental = d.tipo_documental AND re.estado = 'activo'
      WHERE d.tenant_id = {tenant} AND d.retencion_hasta IS NULL AND d.estado IN ('reemplazado','anulado')`,
  );
  for (const d of cerrados) {
    await repo.actualizar('documento_sst', d.id, { retencion_hasta: r.retencionHasta({ retencion: 'tabla' }, { fechaCierre: d.fecha_cierre, anios: d.anios }) }, { accion: 'fijar_retencion' });
    n++;
  }
  return n;
}

// ---------- Ciclo de vida

async function publicar(repo, empresaId, id, hoy = hoyBogota()) {
  const doc = await obtener(repo, empresaId, id);
  const tipo = await tipoDocumental(doc.tipo_documental);
  const solicitudes = await repo.listar('firma_solicitud', { documento_id: id });
  const imp = r.impedimentosPublicar(doc, tipo, solicitudes);
  if (imp.length) throw error(422, imp.join('. '));
  await repo.transaccion(async (tx) => {
    await bloquearEstado(tx, 'documento_sst', id, [doc.estado], 'El documento cambio de estado; recargue la pagina');
    await tx.actualizar('documento_sst', id, { estado: 'vigente', motivo_estado: null }, { accion: 'publicar' });
    if (doc.documento_padre_id) {
      const padre = await tx.obtener('documento_sst', doc.documento_padre_id);
      if (padre && padre.estado === 'vigente') {
        await tx.actualizar('documento_sst', padre.id, { estado: 'reemplazado', motivo_estado: `Reemplazado por la version ${doc.version}` }, { accion: 'reemplazar' });
      }
    }
  });
  await plazos.sincronizarDocumentos(repo, hoy);
}

async function anular(repo, empresaId, id, motivo) {
  const doc = await obtener(repo, empresaId, id);
  if (!['borrador', 'en_firma', 'vigente'].includes(doc.estado)) throw error(409, 'El documento ya esta cerrado');
  const m = String(motivo || '').trim();
  if (m.length < 10) throw error(422, 'Explique el motivo de la anulacion (minimo 10 caracteres)');
  await repo.transaccion(async (tx) => {
    await bloquearEstado(tx, 'documento_sst', id, ['borrador', 'en_firma', 'vigente'], 'El documento ya esta cerrado');
    for (const s of await tx.listar('firma_solicitud', { documento_id: id, estado: 'pendiente' }, { bloquear: true })) {
      await tx.actualizar('firma_solicitud', s.id, { estado: 'anulada' }, { accion: 'anular' });
    }
    await tx.actualizar('documento_sst', id, { estado: 'anulado', motivo_estado: m.slice(0, 255) }, { accion: 'anular' });
  });
  await plazos.sincronizarDocumentos(repo);
}

/** Recalcula la huella del archivo en disco y la compara con la registrada y con la de cada firma. */
async function verificarIntegridad(repo, empresaId, id) {
  const doc = await obtener(repo, empresaId, id);
  const firmas = await repo.consultar(
    "SELECT id, firmante_nombre, hash_contenido FROM firma WHERE tenant_id = {tenant} AND entidad = 'documento_sst' AND entidad_id = ?", [id],
  );
  const enDisco = doc.archivo_ruta ? await almacen.hashEnDisco(doc.archivo_ruta) : null;
  const resultado = {
    archivo: doc.archivo_ruta ? (enDisco === null ? 'faltante' : enDisco === doc.archivo_hash ? 'integro' : 'alterado') : 'sin_archivo',
    hash_registrado: doc.archivo_hash,
    hash_en_disco: enDisco,
    firmas: firmas.map((f) => ({ id: f.id, firmante: f.firmante_nombre, coincide: f.hash_contenido === doc.archivo_hash })),
  };
  resultado.ok = resultado.archivo !== 'alterado' && resultado.archivo !== 'faltante' && resultado.firmas.every((f) => f.coincide);
  await repo.auditar('verificar_integridad', 'documento_sst', id, null, resultado);
  return resultado;
}

/** Ruta del archivo para descargar: lectores del SG-SST o firmantes solicitados del documento. */
async function archivoParaDescargar(repo, empresaId, id, usuarioId, esLector) {
  const doc = await obtener(repo, empresaId, id);
  if (!doc.archivo_ruta) throw error(404, 'El documento no tiene archivo');
  if (!esLector) {
    const [s] = await repo.listar('firma_solicitud', { documento_id: id, usuario_id: usuarioId });
    if (!s) throw error(403, 'No tiene acceso a este documento');
  }
  await repo.auditar('descargar', 'documento_sst', id);
  const ext = require('path').extname(doc.archivo_nombre || doc.archivo_ruta);
  return { ruta: almacen.absoluta(doc.archivo_ruta), nombre: `${doc.codigo}-v${doc.version}${ext}`, mime: doc.archivo_mime };
}

// ---------- Firma electronica

async function solicitarFirmas(repo, empresaId, id, firmantes) {
  const doc = await obtener(repo, empresaId, id);
  const tipo = await tipoDocumental(doc.tipo_documental);
  if (doc.estado !== 'borrador') throw error(409, 'Las firmas se solicitan sobre un borrador');
  if (doc.modalidad_firma !== 'electronica') throw error(422, 'El documento no usa firma electronica');
  if (!doc.archivo_hash) throw error(422, 'Adjunte el archivo antes de solicitar firmas');
  if (!Number(tipo.requiere_firma)) throw error(422, 'Este tipo documental no requiere firma');
  const lista = [].concat(firmantes || []).map((f) => ({ usuarioId: Number.parseInt(f.usuarioId, 10), rol: String(f.rol || '').trim() }))
    .filter((f) => f.usuarioId > 0);
  if (!lista.length) throw error(422, 'Indique al menos un firmante');
  if (new Set(lista.map((f) => f.usuarioId)).size !== lista.length) throw error(422, 'Hay firmantes repetidos');
  for (const f of lista) {
    if (f.rol.length < 3) throw error(422, 'Indique el rol de cada firmante');
    if (!(await cuentas.usuarioEnTenant(repo.tenantId, f.usuarioId))) throw error(422, 'Hay firmantes que no pertenecen a la empresa');
  }
  await repo.transaccion(async (tx) => {
    await bloquearEstado(tx, 'documento_sst', id, ['borrador'], 'Las firmas se solicitan sobre un borrador');
    for (const f of lista) await tx.insertar('firma_solicitud', { documento_id: id, usuario_id: f.usuarioId, rol_firmante: f.rol.slice(0, 60) });
    await tx.actualizar('documento_sst', id, { estado: 'en_firma' }, { accion: 'solicitar_firmas' });
  });
  const solicitudes = await repo.listar('firma_solicitud', { documento_id: id, estado: 'pendiente' });
  for (const s of solicitudes) {
    const u = await cuentas.obtenerUsuario(s.usuario_id);
    if (!u) continue;
    const html = await correo.renderizar('firma_solicitada', { nombre: u.nombres, doc, rol: s.rol_firmante, solicitudId: s.id });
    await correo.enviar({ para: u.email, asunto: `Documento pendiente de firma: ${doc.codigo} v${doc.version}`, html });
  }
}

async function misPendientes(repo, usuarioId) {
  return repo.consultar(
    `SELECT s.id, s.rol_firmante, s.creado_en, d.id AS documento_id, d.codigo, d.titulo, d.version, d.tipo_documental
       FROM firma_solicitud s JOIN documento_sst d ON d.tenant_id = {tenant} AND d.id = s.documento_id
      WHERE s.tenant_id = {tenant} AND s.usuario_id = ? AND s.estado = 'pendiente' AND d.estado = 'en_firma'
      ORDER BY s.creado_en`,
    [usuarioId],
  );
}

async function solicitudPropia(repo, usuarioId, solicitudId) {
  const s = await repo.obtener('firma_solicitud', solicitudId);
  if (!s || s.usuario_id !== usuarioId) throw error(404, 'Solicitud de firma no encontrada');
  const doc = await repo.obtener('documento_sst', s.documento_id);
  if (s.estado !== 'pendiente' || doc.estado !== 'en_firma') throw error(409, 'Esta solicitud ya no esta pendiente');
  return { s, doc };
}

async function acuerdoAceptado(repo, usuarioId) {
  const [a] = await repo.listar('acuerdo_firma', { usuario_id: usuarioId, version: acuerdo.version });
  return Boolean(a);
}

function momentoBogota(fecha = new Date()) {
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'America/Bogota', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).format(fecha);
}

/** Datos de la pantalla de firma: documento, manifiesto que vera y aceptara, acuerdo pendiente. */
async function prepararFirma(repo, usuarioId, solicitudId) {
  const { s, doc } = await solicitudPropia(repo, usuarioId, solicitudId);
  const u = await cuentas.obtenerUsuario(usuarioId);
  const firmante = { nombre: `${u.nombres} ${u.apellidos}`, documento: `${u.tipo_documento} ${u.numero_documento}` };
  return {
    solicitud: s, doc, firmante,
    manifiesto: r.manifiesto({ documento: doc, firmante, rol: s.rol_firmante, momento: '[fecha y hora de la firma]' }),
    acuerdoPendiente: !(await acuerdoAceptado(repo, usuarioId)),
    acuerdo,
  };
}

const MAX_OTP_HORA = 5;

async function enviarCodigo(repo, usuarioId, solicitudId) {
  await solicitudPropia(repo, usuarioId, solicitudId);
  const [recientes] = await repo.consultar(
    'SELECT COUNT(*) AS n FROM firma_otp WHERE tenant_id = {tenant} AND usuario_id = ? AND creado_en > NOW() - INTERVAL 1 HOUR', [usuarioId],
  );
  if (Number(recientes.n) >= MAX_OTP_HORA) throw error(429, 'Demasiados codigos solicitados: espere una hora');
  const u = await cuentas.obtenerUsuario(usuarioId);
  const otp = r.generarOtp(config.sesion.secreto, solicitudId);
  await repo.transaccion(async (tx) => {
    for (const o of await tx.listar('firma_otp', { solicitud_id: solicitudId, estado: 'activo' })) {
      await tx.actualizar('firma_otp', o.id, { estado: 'expirado' }, { auditar: false });
    }
    await tx.insertar('firma_otp', {
      solicitud_id: solicitudId, usuario_id: usuarioId, codigo_hash: otp.hash,
      expira_en: new Date(Date.now() + otp.minutos * 60000),
    }, { auditar: false });
  });
  const html = await correo.renderizar('codigo_firma', { nombre: u.nombres, codigo: otp.codigo, minutos: otp.minutos });
  const envio = await correo.enviar({ para: u.email, asunto: 'Codigo para firmar en Fenix SST', html });
  await repo.auditar('enviar_codigo_firma', 'firma_solicitud', solicitudId, null, { estado_envio: envio.estado });
  if (envio.estado === 'enviado') return { destino: u.email.replace(/^(.).*(@.*)$/, '$1***$2'), desarrollo: false };
  if (config.produccion) throw error(503, 'No fue posible enviar el codigo: el correo no esta configurado');
  console.info(`[desarrollo] codigo de firma para ${u.email} (solicitud ${solicitudId}): ${otp.codigo}`);
  return { destino: 'la consola del servidor (modo desarrollo, sin SMTP)', desarrollo: true };
}

/**
 * Firma electronica: clave + codigo de un solo uso + aceptacion expresa del manifiesto.
 * Guarda el manifiesto de evidencia (Ley 527 art. 7 y 11; D. 2364 arts. 3 y 4).
 * Si era la ultima firma pendiente, el documento se publica.
 */
async function firmar(repo, usuarioId, solicitudId, { clave, codigo, aceptaManifiesto, aceptaAcuerdo, ip, userAgent }) {
  const { s, doc } = await solicitudPropia(repo, usuarioId, solicitudId);
  if (!aceptaManifiesto) throw error(422, 'Debe aceptar el texto de la firma');
  const requiereAcuerdo = !(await acuerdoAceptado(repo, usuarioId));
  if (requiereAcuerdo && !aceptaAcuerdo) throw error(422, 'Debe aceptar el acuerdo de uso de firma electronica');

  // La clave de firma comparte el bloqueo por intentos del login: no sirve de oraculo de fuerza bruta.
  const cuenta = await cuentas.estadoUsuario(usuarioId);
  if (!cuenta || cuenta.estado !== 'activo' || Number(cuenta.bloqueado) === 1) throw error(422, 'Cuenta bloqueada temporalmente por intentos fallidos. Intente mas tarde.');
  if (!(await password.verificar(String(clave || ''), cuenta.password_hash))) {
    await cuentas.registrarFalloLogin(usuarioId);
    await repo.auditar('firma_fallida', 'firma_solicitud', solicitudId, null, { motivo: 'clave' });
    throw error(422, 'Contrasena incorrecta');
  }

  const u = await cuentas.obtenerUsuario(usuarioId);
  const firmante = { nombre: `${u.nombres} ${u.apellidos}`, documento: `${u.tipo_documento} ${u.numero_documento}` };
  const ahora = new Date();
  const texto = r.manifiesto({ documento: doc, firmante, rol: s.rol_firmante, momento: momentoBogota(ahora) });
  const ipBin = r.ipABinario(ip);

  // OTP con bloqueo de fila: los intentos se cuentan en serie aunque lleguen en paralelo.
  const fallo = await repo.transaccion(async (tx) => {
    const [otp] = await tx.listar('firma_otp', { solicitud_id: solicitudId, estado: 'activo' }, { orden: 'id DESC', limite: 1, bloquear: true });
    const v = r.otpValido(otp, config.sesion.secreto, solicitudId, codigo);
    if (!v.ok) {
      if (otp) await tx.actualizar('firma_otp', otp.id, { intentos: Number(otp.intentos) + 1 }, { auditar: false });
      return v.motivo;
    }
    await bloquearEstado(tx, 'firma_solicitud', s.id, ['pendiente'], 'Esta solicitud ya no esta pendiente');
    await bloquearEstado(tx, 'documento_sst', doc.id, ['en_firma'], 'Esta solicitud ya no esta pendiente');
    if (requiereAcuerdo) {
      await tx.insertar('acuerdo_firma', {
        usuario_id: usuarioId, version: acuerdo.version, texto: acuerdo.texto, ip: ipBin,
        user_agent: userAgent ? String(userAgent).slice(0, 255) : null, aceptado_en: ahora,
      });
    }
    await tx.actualizar('firma_otp', otp.id, { estado: 'usado', usado_en: ahora }, { auditar: false });
    const firmaId = await tx.insertar('firma', {
      entidad: 'documento_sst', entidad_id: doc.id, firmante_id: usuarioId, firmante_nombre: firmante.nombre,
      firmante_documento: firmante.documento, rol_firmante: s.rol_firmante, texto_firmado: texto,
      hash_contenido: doc.archivo_hash, metodo_auth: 'password+otp', ip: ipBin,
      user_agent: userAgent ? String(userAgent).slice(0, 255) : null, firmado_en: ahora,
    });
    await tx.actualizar('firma_solicitud', s.id, { estado: 'firmada', firma_id: firmaId, firmado_en: ahora }, { accion: 'firmar' });
    return null;
  });
  if (fallo) {
    await repo.auditar('firma_fallida', 'firma_solicitud', solicitudId, null, { motivo: 'codigo' });
    throw error(422, fallo);
  }

  const pendientes = await repo.listar('firma_solicitud', { documento_id: doc.id, estado: 'pendiente' });
  if (pendientes.length) return { publicado: false, faltan: pendientes.length };
  try {
    await publicar(repo, doc.empresa_id, doc.id);
  } catch (err) {
    // Otro firmante concurrente ya lo publico.
    if (err.status !== 409) throw err;
  }
  return { publicado: true, faltan: 0 };
}

module.exports = {
  tiposActivos, listar, detalle, crear, editar, nuevaVersion, publicar, anular, verificarIntegridad,
  archivoParaDescargar, solicitarFirmas, misPendientes, prepararFirma, enviarCodigo, firmar,
  tablaRetencion, guardarRetencion, recalcularRetencion, acuerdo,
};
