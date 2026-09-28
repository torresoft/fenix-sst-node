const test = require('node:test');
const assert = require('node:assert/strict');
const r = require('../src/documentos/reglas');

const tipoPdf = { solo_referencia: 0, requiere_firma: 1, retencion: 'segun_tabla_retencion_empresa' };
const archivo = (x = {}) => ({ originalname: 'politica.pdf', mimetype: 'application/pdf', size: 10, buffer: Buffer.from('contenido'), ...x });
const MB = 1048576;

test('archivo: formato, mime, tamano y hash', () => {
  const v = r.validarArchivo(archivo(), tipoPdf, MB);
  assert.equal(v.hash, r.sha256(Buffer.from('contenido')));
  assert.throws(() => r.validarArchivo(archivo({ originalname: 'x.exe' }), tipoPdf, MB), /no permitido/);
  assert.throws(() => r.validarArchivo(archivo({ mimetype: 'text/html' }), tipoPdf, MB), /no coincide/);
  assert.throws(() => r.validarArchivo(archivo({ size: 2 * MB }), tipoPdf, MB), /supera/);
  assert.throws(() => r.validarArchivo(archivo({ size: 0 }), tipoPdf, MB), /vacio/);
});

test('regla dura: tipo de solo referencia (historia clinica) rechaza archivo', () => {
  const clinico = { ...tipoPdf, solo_referencia: 1 };
  assert.throws(() => r.validarArchivo(archivo(), clinico, MB), /Res\. 1843/);
  assert.equal(r.validarArchivo(null, clinico, MB), null);
});

test('vencimiento sugerido por vigencia del tipo', () => {
  assert.equal(r.fechaVenceSugerida('2026-02-01', 12), '2027-01-31');
  assert.equal(r.fechaVenceSugerida('2024-02-29', 12), '2025-02-27');
  assert.equal(r.fechaVenceSugerida('2026-02-01', null), null);
});

test('manifiesto incluye identidad, rol, huella y momento', () => {
  const t = r.manifiesto({
    documento: { codigo: 'POL-01', version: 2, titulo: 'Politica', tipo_documental: 'POLITICA_SST', archivo_hash: 'ab'.repeat(32) },
    firmante: { nombre: 'Ana Perez', documento: 'CC 123' }, rol: 'representante legal', momento: '2026-09-26 10:00:00',
  });
  assert.match(t, /Ana Perez.*CC 123.*representante legal.*POL-01 version 2.*abab/);
});

test('OTP: 6 digitos, hash, expiracion e intentos', () => {
  const o = r.generarOtp('secreto', 7);
  assert.match(o.codigo, /^\d{6}$/);
  const fila = { estado: 'activo', codigo_hash: o.hash, intentos: 0, expira_en: new Date(Date.now() + 60000) };
  assert.equal(r.otpValido(fila, 'secreto', 7, o.codigo).ok, true);
  assert.equal(r.otpValido(fila, 'secreto', 8, o.codigo).ok, false, 'ligado a la solicitud');
  assert.equal(r.otpValido(fila, 'otro', 7, o.codigo).ok, false);
  assert.match(r.otpValido({ ...fila, expira_en: new Date(Date.now() - 1) }, 'secreto', 7, o.codigo).motivo, /expiro/);
  assert.match(r.otpValido({ ...fila, intentos: 5 }, 'secreto', 7, o.codigo).motivo, /intentos/);
  assert.equal(r.otpValido(fila, 'secreto', 7, 'abc').ok, false);
});

test('retencion: 20 anios desde el retiro o tabla de la empresa desde el cierre', () => {
  assert.equal(r.retencionHasta({ retencion: '20_anios_desde_retiro' }, { fechaRetiro: '2026-03-15' }), '2046-03-15');
  assert.equal(r.retencionHasta({ retencion: '20_anios_desde_retiro' }, {}), null, 'mientras la persona siga vinculada');
  assert.equal(r.retencionHasta(tipoPdf, { fechaCierre: '2026-09-26', anios: 10 }), '2036-09-26');
  assert.equal(r.retencionHasta(tipoPdf, { fechaCierre: '2026-09-26' }), null, 'sin tabla de la empresa');
});

test('impedimentos para publicar segun archivo, modalidad y firmas', () => {
  const doc = { estado: 'borrador', archivo_hash: 'x', modalidad_firma: 'electronica' };
  assert.deepEqual(r.impedimentosPublicar(doc, tipoPdf, []), ['Solicite al menos una firma']);
  assert.deepEqual(r.impedimentosPublicar(doc, tipoPdf, [{ estado: 'firmada' }, { estado: 'pendiente' }]), ['Faltan firmas por completar']);
  assert.deepEqual(r.impedimentosPublicar(doc, tipoPdf, [{ estado: 'firmada' }, { estado: 'anulada' }]), []);
  assert.deepEqual(r.impedimentosPublicar({ ...doc, modalidad_firma: 'manuscrita' }, tipoPdf, []), ['Indique quien firmo el documento']);
  assert.deepEqual(r.impedimentosPublicar({ ...doc, archivo_hash: null, modalidad_firma: null }, tipoPdf, []), ['Adjunte el archivo del documento', 'Defina la modalidad de firma']);
  assert.deepEqual(r.impedimentosPublicar({ estado: 'borrador' }, { solo_referencia: 1, requiere_firma: 0 }, []), ['Registre el custodio o la referencia del documento']);
  assert.deepEqual(r.impedimentosPublicar({ ...doc, estado: 'vigente' }, { requiere_firma: 0 }, [])[0], 'Solo se publica un borrador o un documento en firma');
});

test('ip a binario como INET6_ATON', () => {
  assert.equal(r.ipABinario('127.0.0.1').toString('hex'), '7f000001');
  assert.equal(r.ipABinario('::ffff:10.0.0.5').toString('hex'), '0a000005');
  assert.equal(r.ipABinario('::1').toString('hex'), '00000000000000000000000000000001');
  assert.equal(r.ipABinario('2001:db8::ff00:42:8329').toString('hex'), '20010db8000000000000ff0000428329');
  assert.equal(r.ipABinario('basura'), null);
});
