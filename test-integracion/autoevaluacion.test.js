// Integracion M11 contra MariaDB real. Se ejecuta con: node scripts/integracion.js
const test = require('node:test');
const assert = require('node:assert/strict');
const mysql = require('mysql2/promise');
const config = require('../src/config');
const cuentas = require('../src/db/cuentas');
const { RepositorioTenant } = require('../src/db/repositorio');
const { cerrar: cerrarPool } = require('../src/db/carga-catalogos');
const { cerrarStore } = require('../src/db/sesion-store');
const password = require('../src/auth/password');
const fechas = require('../src/fechas');
const ae = require('../src/autoevaluacion/servicio');
const empresa = require('../src/empresa/servicio');

const s = {};
let db;
const rechaza = (p, re) => assert.rejects(p, (e) => re.test(e.message));
const HOY = '2026-12-20';

test.before(async () => {
  db = await mysql.createConnection({ ...config.db, dateStrings: ['DATE'] });
  await fechas.inicializar();
  s.T = await cuentas.crearTenantConAdmin({
    tenant: { nombre: 'Tenant M11' },
    empresa: { nit: '900000011', razonSocial: 'Empresa M11', numeroTrabajadores: 30 },
    usuario: { email: 'm11@prueba.co', nombres: 'Usuario', apellidos: 'M11', tipoDocumento: 'CC', numeroDocumento: '1011' },
    passwordHash: await password.hashear('ClaveTemporal-123'),
    regionDatos: 'co-bogota',
  });
  s.repo = new RepositorioTenant(s.T.tenantId, { id: s.T.usuarioId, nombre: 'Usuario M11' });
  s.E = s.T.empresaId;
});

test.after(async () => {
  if (s.servidor) s.servidor.close();
  await cerrarStore();
  await db.end();
  await cerrarPool();
});

test('clasificacion: sin centro no resuelve; con riesgo II y 30 trabajadores son 21 estandares', async () => {
  const sin = await ae.verificarClasificacion(s.repo, s.E);
  assert.match(sin.error, /centro de trabajo/);
  const c = await empresa.agregarCentro(s.repo, s.E, { nombre: 'Sede principal', clase_riesgo: 'II', numero_trabajadores: 30 });
  assert.equal(c.conjunto.codigo, 'MED_21');
  assert.equal(c.pendiente, null, 'la primera clasificacion no es una reclasificacion');
});

test('borrador: sin evidencia 21 estandares = 59.75 CRITICO (art. 27)', async () => {
  s.id = await ae.iniciar(s.repo, s.E, { vigencia: 2026, fechaCorte: '2026-12-15' });
  await rechaza(ae.iniciar(s.repo, s.E, { vigencia: 2026, fechaCorte: '2026-12-15' }), /Ya existe/);
  const d = await ae.detalle(s.repo, s.E, s.id);
  assert.equal(d.resultado.puntaje, '59.75');
  assert.equal(d.resultado.valoracion, 'CRITICO');
  assert.equal(d.brechas.length, 23);
});

test('evidencia: documento sin firma no cuenta; firmado si', async () => {
  s.doc = await s.repo.insertar('documento_sst', {
    empresa_id: s.E, tipo_documental: 'POLITICA_SST', codigo: 'POL-M11', titulo: 'Politica', version: 1,
    fecha_documento: '2026-02-01', fecha_vence: '2027-02-01', estado: 'vigente',
  });
  await ae.vincularEvidencia(s.repo, s.E, '2.1.1', [s.doc]);
  let d = await ae.detalle(s.repo, s.E, s.id);
  assert.equal(d.resultado.items.find((i) => i.numeral === '2.1.1').motivo, 'sin_firma');
  await s.repo.insertar('firma', {
    entidad: 'documento_sst', entidad_id: s.doc, firmante_id: s.T.usuarioId, firmante_nombre: 'Usuario M11',
    firmante_documento: 'CC 1011', rol_firmante: 'gerente', texto_firmado: 'Politica', hash_contenido: 'a'.repeat(64),
    metodo_auth: 'password', firmado_en: new Date(),
  });
  d = await ae.detalle(s.repo, s.E, s.id);
  assert.equal(d.resultado.items.find((i) => i.numeral === '2.1.1').resultado, 'cumple');
  assert.equal(d.resultado.puntaje, '60.75');
  assert.equal(d.resultado.valoracion, 'MODERADAMENTE_ACEPTABLE');
});

test('no aplica justificado suma el maximo y exige justificacion', async () => {
  await rechaza(ae.marcarNoAplica(s.repo, s.E, s.id, '1.1.8', 'corta'), /justificacion/);
  await rechaza(ae.marcarNoAplica(s.repo, s.E, s.id, '4.2.1', 'No es parte de los 21 estandares'), /no hace parte/);
  await ae.marcarNoAplica(s.repo, s.E, s.id, '1.1.8', 'Comite de convivencia en proceso de eleccion por norma nueva');
  const d = await ae.detalle(s.repo, s.E, s.id);
  assert.equal(d.resultado.puntaje, '61.25');
});

test('cierre: congela con hash, bloquea cambios y dispara obligaciones segun valoracion', async () => {
  const r = await ae.cerrar(s.repo, s.E, s.id, HOY);
  assert.equal(r.puntaje, '61.25');
  assert.equal(r.hash.length, 64);
  assert.match(r.aviso, /2026/, 'sin fecha de cargue para la vigencia 2026 en el catalogo');
  await rechaza(db.query('UPDATE autoevaluacion SET puntaje = 99 WHERE id = ?', [s.id]), /version nueva/);
  await rechaza(db.query("UPDATE autoevaluacion_item SET resultado = 'cumple' WHERE autoevaluacion_id = ? LIMIT 1", [s.id]), /cerrada/);
  const [obl] = await db.query("SELECT plazo_codigo, fecha_limite FROM obligacion_pendiente WHERE tenant_id = ? AND entidad_origen_tipo = 'autoevaluacion' ORDER BY plazo_codigo", [s.T.tenantId]);
  assert.deepEqual(obl.map((o) => [o.plazo_codigo, o.fecha_limite]), [['AUTOEVALUACION', '2027-12-15'], ['INFORME_AVANCE_6M', '2027-06-20']]);
  const d = await ae.detalle(s.repo, s.E, s.id);
  assert.equal(d.resultado.puntaje, '61.25', 'el detalle cerrado sale de lo congelado');
  assert.equal(d.resultado.items.find((i) => i.numeral === '2.1.1').resultado, 'cumple');
});

test('plan de mejoramiento: una accion por brecha, idempotente, cierre inmutable', async () => {
  await rechaza(ae.generarPlan(s.repo, s.E, s.id, { responsableId: s.T.usuarioId, fechaLimite: '2026-01-01' }, HOY), /futura/);
  const n = await ae.generarPlan(s.repo, s.E, s.id, { responsableId: s.T.usuarioId, fechaLimite: '2027-03-31' }, HOY);
  assert.equal(n, 21);
  assert.equal(await ae.generarPlan(s.repo, s.E, s.id, { responsableId: s.T.usuarioId, fechaLimite: '2027-03-31' }, HOY), 0);
  const [x] = await ae.acciones(s.repo, s.E, s.id);
  await ae.cerrarAccion(s.repo, s.E, x.id, { fecha: HOY, observacion: 'Documento aprobado y firmado' }, HOY);
  await rechaza(db.query("UPDATE accion_mejora SET descripcion = 'x' WHERE id = ?", [x.id]), /cerrada/);
});

test('version nueva reemplaza la anterior y anula sus obligaciones abiertas', async () => {
  s.v2 = await ae.nuevaVersion(s.repo, s.E, s.id);
  const d2 = await ae.detalle(s.repo, s.E, s.v2);
  assert.equal(d2.autoevaluacion.version, 2);
  assert.equal(d2.resultado.puntaje, '61.25', 'conserva el no aplica justificado');
  await ae.cerrar(s.repo, s.E, s.v2, HOY);
  const [[v1]] = await db.query('SELECT estado FROM autoevaluacion WHERE id = ?', [s.id]);
  assert.equal(v1.estado, 'reemplazada');
  const [obl] = await db.query("SELECT estado FROM obligacion_pendiente WHERE entidad_origen_tipo = 'autoevaluacion' AND entidad_origen_id = ?", [s.id]);
  assert.ok(obl.every((o) => o.estado === 'anulado'));
});

test('reclasificacion: pasar a 60 trabajadores queda pendiente de revision', async () => {
  const c = await empresa.actualizarEmpresa(s.repo, s.E, { razon_social: 'Empresa M11', nit: '900000011', numero_trabajadores: 60 });
  assert.equal(c.conjunto.codigo, 'FULL_60');
  assert.equal(c.pendiente.conjunto_anterior, 'MED_21');
  await ae.revisarClasificacion(s.repo, s.E, c.pendiente.id);
  assert.equal((await ae.verificarClasificacion(s.repo, s.E)).pendiente, null);
});

test('http: tablero, detalle y exportacion', async () => {
  const app = require('../src/app');
  s.servidor = app.listen(0);
  await new Promise((ok) => s.servidor.once('listening', ok));
  const base = `http://127.0.0.1:${s.servidor.address().port}`;
  let cookie = '';
  const ir = async (ruta, form) => {
    const r = await fetch(base + ruta, {
      method: form ? 'POST' : 'GET', redirect: 'manual',
      headers: { ...(cookie ? { cookie } : {}), ...(form ? { 'content-type': 'application/x-www-form-urlencoded' } : {}) },
      body: form ? new URLSearchParams(form).toString() : undefined,
    });
    const set = r.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    return { status: r.status, location: r.headers.get('location'), tipo: r.headers.get('content-type'), texto: await r.text() };
  };
  const token = (h) => /name="_csrf" value="([^"]+)"/.exec(h)[1];

  let r = await ir('/login');
  await ir('/login', { _csrf: token(r.texto), email: 'm11@prueba.co', password: 'ClaveTemporal-123' });
  r = await ir('/cambiar-password');
  await ir('/cambiar-password', { _csrf: token(r.texto), actual: 'ClaveTemporal-123', nueva: 'NuevaClave-2026', confirmacion: 'NuevaClave-2026' });

  r = await ir('/autoevaluacion');
  assert.equal(r.status, 200);
  assert.match(r.texto, /60 est&aacute;ndares/);
  r = await ir(`/autoevaluacion/${s.v2}`);
  assert.equal(r.status, 200);
  assert.match(r.texto, /61\.25/);
  assert.match(r.texto, /SHA-256 [0-9a-f]{64}/);
  r = await ir(`/autoevaluacion/${s.v2}/csv`);
  assert.match(r.tipo, /text\/csv/);
  assert.match(r.texto, /Calificacion;61,25/);
});
