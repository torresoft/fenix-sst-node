// Reglas puras del gestor documental (sin BD ni disco).
const crypto = require('crypto');
const path = require('path');
const net = require('net');

const EXTENSIONES = new Map([
  ['.pdf', ['application/pdf']],
  ['.docx', ['application/vnd.openxmlformats-officedocument.wordprocessingml.document']],
  ['.xlsx', ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet']],
  ['.odt', ['application/vnd.oasis.opendocument.text']],
  ['.ods', ['application/vnd.oasis.opendocument.spreadsheet']],
  ['.png', ['image/png']],
  ['.jpg', ['image/jpeg']],
  ['.jpeg', ['image/jpeg']],
]);
const OTP_MINUTOS = 10;
const OTP_INTENTOS = 5;

const sha256 = (datos) => crypto.createHash('sha256').update(datos).digest('hex');

function errorValidacion(mensaje) {
  const e = new Error(mensaje);
  e.status = 422;
  return e;
}

/**
 * Valida el archivo contra el tipo documental. Los tipos solo_referencia (historia clinica)
 * no admiten archivo: el empleador no puede custodiarla (Res. 1843 de 2025).
 */
function validarArchivo(archivo, tipo, maxBytes) {
  if (Number(tipo.solo_referencia)) {
    if (archivo) throw errorValidacion('Este tipo documental es de solo referencia: el empleador no puede custodiar su contenido (historia clinica, Res. 1843 de 2025). Registre solo el custodio.');
    return null;
  }
  if (!archivo) return null;
  const ext = path.extname(String(archivo.originalname || '')).toLowerCase();
  const mimes = EXTENSIONES.get(ext);
  if (!mimes) throw errorValidacion(`Formato no permitido. Use: ${[...EXTENSIONES.keys()].join(', ')}`);
  if (!mimes.includes(archivo.mimetype) && archivo.mimetype !== 'application/octet-stream') throw errorValidacion('El tipo de archivo no coincide con su extension');
  if (!archivo.size) throw errorValidacion('El archivo esta vacio');
  if (archivo.size > maxBytes) throw errorValidacion(`El archivo supera ${Math.round(maxBytes / 1048576)} MB`);
  return { ext, hash: sha256(archivo.buffer), bytes: archivo.size };
}

function sumarMeses(fecha, meses) {
  const [a, m, d] = String(fecha).split('-').map(Number);
  const destino = new Date(Date.UTC(a, m - 1 + meses, 1));
  const ultimo = new Date(Date.UTC(destino.getUTCFullYear(), destino.getUTCMonth() + 1, 0)).getUTCDate();
  destino.setUTCDate(Math.min(d, ultimo));
  return destino.toISOString().slice(0, 10);
}

/** Vencimiento sugerido: fecha del documento + vigencia del tipo (el dia anterior al aniversario). */
function fechaVenceSugerida(fechaDocumento, vigenciaMeses) {
  if (!vigenciaMeses) return null;
  const f = new Date(`${sumarMeses(fechaDocumento, Number(vigenciaMeses))}T00:00:00Z`);
  f.setUTCDate(f.getUTCDate() - 1);
  return f.toISOString().slice(0, 10);
}

/**
 * Texto exacto que el firmante ve y acepta. Incluye la huella del contenido: cualquier cambio
 * posterior del archivo invalida la verificacion (D. 2364 art. 4).
 */
function manifiesto({ documento, firmante, rol, momento }) {
  return [
    `Yo, ${firmante.nombre}, identificado(a) con ${firmante.documento}, en calidad de ${rol},`,
    `firmo electronicamente el documento ${documento.codigo} version ${documento.version}: "${documento.titulo}"`,
    `(tipo ${documento.tipo_documental}), cuyo contenido tiene la huella SHA-256 ${documento.archivo_hash || 'N/A'}.`,
    `Declaro que revise su contenido y lo apruebo. Fecha y hora: ${momento} (America/Bogota).`,
  ].join(' ');
}

function hashOtp(secreto, solicitudId, codigo) {
  return sha256(`${solicitudId}:${String(codigo).trim()}:${secreto}`);
}

function generarOtp(secreto, solicitudId) {
  const codigo = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
  return { codigo, hash: hashOtp(secreto, solicitudId, codigo), minutos: OTP_MINUTOS };
}

function otpValido(otp, secreto, solicitudId, codigo, ahora = new Date()) {
  if (!otp || otp.estado !== 'activo') return { ok: false, motivo: 'Solicite un codigo nuevo' };
  if (new Date(otp.expira_en) < ahora) return { ok: false, motivo: 'El codigo expiro: solicite uno nuevo' };
  if (Number(otp.intentos) >= OTP_INTENTOS) return { ok: false, motivo: 'Demasiados intentos: solicite un codigo nuevo' };
  const esperado = Buffer.from(otp.codigo_hash);
  const recibido = Buffer.from(hashOtp(secreto, solicitudId, codigo));
  if (!/^\d{6}$/.test(String(codigo).trim()) || !crypto.timingSafeEqual(esperado, recibido)) return { ok: false, motivo: 'Codigo incorrecto' };
  return { ok: true };
}

/**
 * Retencion: los 5 tipos del art. 2.2.4.6.13 cuentan 20 anios desde el retiro de la persona;
 * los demas, los anios de la tabla de la empresa desde que el documento deja de estar vigente.
 */
function retencionHasta(tipo, { fechaRetiro = null, fechaCierre = null, anios = null }) {
  const mas = (f, n) => sumarMeses(f, n * 12);
  if (tipo.retencion === '20_anios_desde_retiro') return fechaRetiro ? mas(fechaRetiro, 20) : null;
  return fechaCierre && anios ? mas(fechaCierre, Number(anios)) : null;
}

/** Motivos por los que un documento no puede pasar a vigente (vacio = puede). */
function impedimentosPublicar(doc, tipo, solicitudes) {
  const m = [];
  if (!['borrador', 'en_firma'].includes(doc.estado)) m.push('Solo se publica un borrador o un documento en firma');
  if (Number(tipo.solo_referencia)) {
    if (!doc.referencia_custodio) m.push('Registre el custodio o la referencia del documento');
  } else if (!doc.archivo_hash) m.push('Adjunte el archivo del documento');
  if (Number(tipo.requiere_firma)) {
    if (!doc.modalidad_firma) m.push('Defina la modalidad de firma');
    else if (doc.modalidad_firma === 'electronica') {
      const activas = solicitudes.filter((s) => s.estado !== 'anulada');
      if (!activas.length) m.push('Solicite al menos una firma');
      else if (activas.some((s) => s.estado !== 'firmada')) m.push('Faltan firmas por completar');
    } else if (!doc.firmantes_externos) m.push('Indique quien firmo el documento');
  }
  return m;
}

/** Equivalente a INET6_ATON: 4 bytes para IPv4 (incluida la mapeada ::ffff:), 16 para IPv6. */
function ipABinario(ip) {
  let v = String(ip || '').trim();
  if (v.startsWith('::ffff:') && net.isIPv4(v.slice(7))) v = v.slice(7);
  if (net.isIPv4(v)) return Buffer.from(v.split('.').map(Number));
  if (!net.isIPv6(v)) return null;
  const [cabeza, cola = ''] = v.split('::');
  const partes = (x) => (x ? x.split(':') : []);
  const faltan = 8 - partes(cabeza).length - partes(cola).length;
  const grupos = v.includes('::') ? [...partes(cabeza), ...Array(faltan).fill('0'), ...partes(cola)] : partes(v);
  const b = Buffer.alloc(16);
  grupos.forEach((g, i) => b.writeUInt16BE(parseInt(g, 16), i * 2));
  return b;
}

module.exports = {
  ipABinario, EXTENSIONES, OTP_MINUTOS, OTP_INTENTOS, sha256, validarArchivo, fechaVenceSugerida, manifiesto,
  hashOtp, generarOtp, otpValido, retencionHasta, impedimentosPublicar,
};
