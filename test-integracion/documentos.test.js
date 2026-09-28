// Integracion M03 contra MariaDB real y disco. Se ejecuta con: node scripts/integracion.js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const mysql = require('mysql2/promise');
const config = require('../src/config');
const cuentas = require('../src/db/cuentas');
const { RepositorioTenant } = require('../src/db/repositorio');
const { cerrar: cerrarPool } = require('../src/db/carga-catalogos');
const { cerrarStore } = require('../src/db/sesion-store');
const password = require('../src/auth/password');
const fechas = require('../src/fechas');
const almacen = require('../src/documentos/almacen');
const reglas = require('../src/documentos/reglas');
const docs = require('../src/documentos/servicio');

const s = {};
let db;
const rechaza = (p, re) => assert.rejects(p, (e) => re.test(e.message));
const pdf = (texto) => ({ originalname: 'doc.pdf', mimetype: 'application/pdf', buffer: Buffer.from(`%PDF-1.4 ${texto}`), size: Buffer.byteLength(`%PDF-1.4 ${texto}`) });
const CLAVE = 'ClaveFirma-2026';

// Codigo conocido para la prueba: el real se envia por correo (o consola en desarrollo).
async function otpConocido(repo, solicitudId, usuarioId) {
  await docs.enviarCodigo(repo, usuarioId, solicitudId);
  const o = reglas.generarOtp(config.sesion.secreto, solicitudId);
  await db.query("UPDATE firma_otp SET estado = 'expirado' WHERE solicitud_id = ? AND estado = 'activo'", [solicitudId]);
  await db.query('INSERT INTO firma_otp (tenant_id, solicitud_id, usuario_id, codigo_hash, expira_en) VALUES (?, ?, ?, ?, NOW() + INTERVAL 10 MINUTE)',
    [repo.tenantId, solicitudId, usuarioId, o.hash]);
  return o.codigo;
}

test.before(async () => {
  db = await mysql.createConnection({ ...config.db, dateStrings: ['DATE'] });
  await fechas.inicializar();
  const hash = await password.hashear(CLAVE);
  s.T = await cuentas.crearTenantConAdmin({
    tenant: { nombre: 'Tenant M03' },
    empresa: { nit: '900000031', razonSocial: 'Empresa M03', numeroTrabajadores: 12 },
    usuario: { email: 'm03@prueba.co', nombres: 'Rosa', apellidos: 'Responsable', tipoDocumento: 'CC', numeroDocumento: '3031' },
    passwordHash: hash, regionDatos: 'co-bogota',
  });
  const [u] = await db.query(
    "INSERT INTO usuario (email, nombres, apellidos, tipo_documento, numero_documento, password_hash) VALUES ('gerente.m03@prueba.co', 'Gabriel', 'Gerente', 'CC', '3032', ?)", [hash],
  );
  s.gerenteId = u.insertId;
  await db.query("INSERT INTO usuario_tenant (tenant_id, usuario_id, rol_codigo) VALUES (?, ?, 'gerente')", [s.T.tenantId, s.gerenteId]);
  s.E = s.T.empresaId;
  s.repo = new RepositorioTenant(s.T.tenantId, { id: s.T.usuarioId, nombre: 'Rosa Responsable', ip: '127.0.0.1' });
  s.repoG = new RepositorioTenant(s.T.tenantId, { id: s.gerenteId, nombre: 'Gabriel Gerente', ip: '127.0.0.1' });
});

test.after(async () => {
  if (s.servidor) s.servidor.close();
  await cerrarStore();
  await db.end();
  await cerrarPool();
});

test('regla dura: examen complementario no admite archivo, solo referencia', async () => {
  const base = { tipo_documental: 'EXAMEN_COMPLEMENT', codigo: 'EXC-01', titulo: 'Audiometria', fecha_documento: '2026-09-01' };
  await rechaza(docs.crear(s.repo, s.E, { ...base, referencia_custodio: 'IPS X' }, pdf('audiometria')), /Res\. 1843/);
  const id = await docs.crear(s.repo, s.E, { ...base, referencia_custodio: 'IPS Salud Ocupacional, orden 123' });
  await docs.publicar(s.repo, s.E, id, '2026-09-26');
  const [[d]] = await db.query('SELECT estado, archivo_ruta FROM documento_sst WHERE id = ?', [id]);
  assert.deepEqual(d, { estado: 'vigente', archivo_ruta: null });
});

test('borrador con archivo en disco, hash, normas citadas y codigo unico', async () => {
  s.pol = await docs.crear(s.repo, s.E, {
    tipo_documental: 'POLITICA_SST', codigo: 'pol-01', titulo: 'Politica de SST', fecha_documento: '2026-09-01',
    modalidad_firma: 'electronica', normas: ['DEC-1072-2015', 'RES-0312-2019'],
  }, pdf('politica v1'));
  const d = await docs.detalle(s.repo, s.E, s.pol);
  assert.equal(d.doc.codigo, 'POL-01');
  assert.equal(d.doc.archivo_hash, reglas.sha256(pdf('politica v1').buffer));
  assert.equal(await almacen.hashEnDisco(d.doc.archivo_ruta), d.doc.archivo_hash);
  assert.deepEqual(d.normas.map((n) => n.norma_codigo), ['DEC-1072-2015', 'RES-0312-2019']);
  assert.deepEqual(d.impedimentos, ['Solicite al menos una firma']);
  await rechaza(docs.crear(s.repo, s.E, { tipo_documental: 'POLITICA_SST', codigo: 'POL-01', titulo: 'x x x', fecha_documento: '2026-09-01', modalidad_firma: 'electronica' }, pdf('x')), /version nueva/);
  await rechaza(docs.crear(s.repo, s.E, { tipo_documental: 'POLITICA_SST', codigo: 'POL-02', titulo: 'Politica', fecha_documento: '2026-09-01', modalidad_firma: 'digital_externa' }, pdf('x')), /Modalidad/);
  await docs.editar(s.repo, s.E, s.pol, { titulo: 'Politica de SST 2026', fecha_documento: '2026-09-01', modalidad_firma: 'electronica', normas: ['DEC-1072-2015'] }, null);
});

test('solicitud de firmas congela el contenido', async () => {
  await docs.solicitarFirmas(s.repo, s.E, s.pol, [
    { usuarioId: s.T.usuarioId, rol: 'Responsable del SG-SST' },
    { usuarioId: s.gerenteId, rol: 'Representante legal' },
  ]);
  await rechaza(docs.editar(s.repo, s.E, s.pol, { titulo: 'Otro', fecha_documento: '2026-09-01', modalidad_firma: 'electronica' }, null), /borrador/);
  await rechaza(db.query("UPDATE documento_sst SET titulo = 'x' WHERE id = ?", [s.pol]), /version nueva/);
  assert.equal((await docs.misPendientes(s.repoG, s.gerenteId)).length, 1);
});

test('firma: clave y codigo obligatorios, manifiesto con huella, ultima firma publica', async () => {
  const [sol] = await s.repo.listar('firma_solicitud', { documento_id: s.pol, usuario_id: s.T.usuarioId });
  const codigo = await otpConocido(s.repo, sol.id, s.T.usuarioId);
  const datos = { clave: CLAVE, codigo, aceptaManifiesto: true, aceptaAcuerdo: true, ip: '::ffff:10.1.2.3', userAgent: 'prueba' };
  await rechaza(docs.firmar(s.repo, s.T.usuarioId, sol.id, { ...datos, aceptaAcuerdo: false }), /acuerdo/);
  await rechaza(docs.firmar(s.repo, s.T.usuarioId, sol.id, { ...datos, clave: 'mala' }), /Contrasena/);
  await rechaza(docs.firmar(s.repo, s.T.usuarioId, sol.id, { ...datos, codigo: '000000' === codigo ? '111111' : '000000' }), /Codigo incorrecto/);
  let r = await docs.firmar(s.repo, s.T.usuarioId, sol.id, datos);
  assert.deepEqual(r, { publicado: false, faltan: 1 });
  await rechaza(docs.firmar(s.repo, s.T.usuarioId, sol.id, datos), /ya no esta pendiente/);
  await db.query('UPDATE usuario SET intentos_fallidos = 0 WHERE id = ?', [s.T.usuarioId]);

  const [solG] = await s.repoG.listar('firma_solicitud', { documento_id: s.pol, usuario_id: s.gerenteId });
  const codigoG = await otpConocido(s.repoG, solG.id, s.gerenteId);
  r = await docs.firmar(s.repoG, s.gerenteId, solG.id, { ...datos, codigo: codigoG });
  assert.deepEqual(r, { publicado: true, faltan: 0 });

  const d = await docs.detalle(s.repo, s.E, s.pol);
  assert.equal(d.doc.estado, 'vigente');
  assert.equal(d.firmas.length, 2);
  assert.ok(d.firmas.every((f) => f.hash_contenido === d.doc.archivo_hash && f.metodo_auth === 'password+otp'));
  assert.match(d.firmas[1].texto_firmado, /Gabriel Gerente.*CC 3032.*Representante legal.*POL-01 version 1/);
  assert.equal(d.firmas[0].ip, '10.1.2.3');
  const [[acuerdos]] = await db.query('SELECT COUNT(*) n FROM acuerdo_firma WHERE tenant_id = ?', [s.T.tenantId]);
  assert.equal(Number(acuerdos.n), 2);
  await rechaza(db.query("UPDATE firma SET rol_firmante = 'x' WHERE entidad_id = ?", [s.pol]), /inmutable/);
});

test('integridad: detecta alteracion del archivo en disco', async () => {
  let v = await docs.verificarIntegridad(s.repo, s.E, s.pol);
  assert.equal(v.ok, true);
  const d = await docs.detalle(s.repo, s.E, s.pol);
  const ruta = almacen.absoluta(d.doc.archivo_ruta);
  const original = fs.readFileSync(ruta);
  fs.writeFileSync(ruta, Buffer.from('%PDF-1.4 adulterado'));
  v = await docs.verificarIntegridad(s.repo, s.E, s.pol);
  assert.equal(v.archivo, 'alterado');
  assert.equal(v.ok, false);
  fs.writeFileSync(ruta, original);
});

test('version nueva manuscrita reemplaza la anterior; anulacion y retencion', async () => {
  await rechaza(docs.nuevaVersion(s.repo, s.E, s.pol, { titulo: 'Politica v2', fecha_documento: '2026-09-20', modalidad_firma: 'manuscrita', firmantes_externos: 'Gabriel Gerente' }, null), /requiere su archivo/);
  s.pol2 = await docs.nuevaVersion(s.repo, s.E, s.pol, {
    titulo: 'Politica v2', fecha_documento: '2026-09-20', modalidad_firma: 'manuscrita', firmantes_externos: 'Gabriel Gerente, representante legal',
  }, pdf('politica v2 escaneada'));
  await rechaza(docs.nuevaVersion(s.repo, s.E, s.pol, { titulo: 'v3', fecha_documento: '2026-09-20', modalidad_firma: 'manuscrita', firmantes_externos: 'x' }, pdf('v3')), /en curso/);
  await docs.publicar(s.repo, s.E, s.pol2, '2026-09-26');
  const [[v1]] = await db.query('SELECT estado FROM documento_sst WHERE id = ?', [s.pol]);
  assert.equal(v1.estado, 'reemplazado');

  await rechaza(docs.anular(s.repo, s.E, s.pol2, 'corto'), /motivo/);
  await docs.anular(s.repo, s.E, s.pol2, 'Se adopto una politica integrada con calidad');
  await docs.guardarRetencion(s.repo, s.E, { POLITICA_SST: '5' });
  assert.equal(await docs.recalcularRetencion(s.repo), 2);
  const [filas] = await db.query('SELECT retencion_hasta FROM documento_sst WHERE id IN (?, ?)', [s.pol, s.pol2]);
  assert.ok(filas.every((f) => /^203\d-/.test(f.retencion_hasta)));
});

test('descarga: solo lectores del SG-SST o firmantes solicitados', async () => {
  const [t] = await db.query("INSERT INTO usuario (email, nombres, apellidos, tipo_documento, numero_documento, password_hash) VALUES ('trabajador.m03@prueba.co', 'Tomas', 'Trabajador', 'CC', '3033', 'x')");
  await rechaza(docs.archivoParaDescargar(s.repo, s.E, s.pol, t.insertId, false), /acceso/);
  const a = await docs.archivoParaDescargar(s.repo, s.E, s.pol, s.gerenteId, false);
  assert.match(a.nombre, /^POL-01-v1\.pdf$/);
});

test('http: listado, alta multipart con CSRF en la URL, descarga y bandeja de firmas', async () => {
  const app = require('../src/app');
  s.servidor = app.listen(0);
  await new Promise((ok) => s.servidor.once('listening', ok));
  const base = `http://127.0.0.1:${s.servidor.address().port}`;
  let cookie = '';
  const ir = async (ruta, { form, multipart } = {}) => {
    const r = await fetch(base + ruta, {
      method: form || multipart ? 'POST' : 'GET', redirect: 'manual',
      headers: { ...(cookie ? { cookie } : {}), ...(form ? { 'content-type': 'application/x-www-form-urlencoded' } : {}) },
      body: form ? new URLSearchParams(form).toString() : multipart,
    });
    const set = r.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    return { status: r.status, location: r.headers.get('location'), buffer: Buffer.from(await r.arrayBuffer()) };
  };
  const token = (b) => /name="_csrf" value="([^"]+)"/.exec(b.toString())[1];

  let r = await ir('/login');
  r = await ir('/login', { form: { _csrf: token(r.buffer), email: 'm03@prueba.co', password: CLAVE } });
  r = await ir('/cambiar-password');
  await ir('/cambiar-password', { form: { _csrf: token(r.buffer), actual: CLAVE, nueva: 'OtraClave-2026', confirmacion: 'OtraClave-2026' } });

  r = await ir('/documentos');
  assert.equal(r.status, 200);
  assert.match(r.buffer.toString(), /EXC-01/, 'listado por defecto: solo activos');
  r = await ir('/documentos/nuevo');
  const csrf = token(r.buffer);

  const fd = new FormData();
  fd.append('tipo_documental', 'PROCEDIMIENTO');
  fd.append('codigo', 'PRO-07');
  fd.append('titulo', 'Procedimiento de trabajo seguro');
  fd.append('fecha_documento', '2026-09-26');
  fd.append('normas[]', 'DEC-1072-2015');
  fd.append('archivo', new Blob([Buffer.from('%PDF-1.4 procedimiento')], { type: 'application/pdf' }), 'procedimiento.pdf');
  r = await ir('/documentos', { multipart: fd });
  assert.equal(r.status, 403, 'multipart sin token en la URL');
  r = await ir(`/documentos?_csrf=${encodeURIComponent(csrf)}`, { multipart: fd });
  assert.match(r.location, /^\/documentos\/\d+$/);

  const detalle = await ir(r.location);
  assert.match(detalle.buffer.toString(), /Procedimiento de trabajo seguro/);
  const archivo = await ir(`${r.location}/archivo`);
  assert.equal(archivo.status, 200);
  assert.equal(archivo.buffer.toString(), '%PDF-1.4 procedimiento');

  r = await ir('/firmas');
  assert.equal(r.status, 200);
});
