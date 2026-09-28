// Integracion contra MariaDB real. Se ejecuta con: node scripts/integracion.js
const test = require('node:test');
const assert = require('node:assert/strict');
const mysql = require('mysql2/promise');
const config = require('../src/config');
const cuentas = require('../src/db/cuentas');
const { RepositorioTenant } = require('../src/db/repositorio');
const { cerrar } = require('../src/db/carga-catalogos');
const { cerrarStore } = require('../src/db/sesion-store');
const password = require('../src/auth/password');
const fechas = require('../src/fechas');
const plazos = require('../src/plazos/servicio');
const matriz = require('../src/matriz/servicio');
const { ejecutarJobDiario } = require('../src/plazos/job');

const CLAVE = 'ClaveTemporal-123';
const s = {};
let db;

async function alta(sufijo, email, doc) {
  return cuentas.crearTenantConAdmin({
    tenant: { nombre: `Tenant ${sufijo}` },
    empresa: { nit: `90000000${doc}`, razonSocial: `Empresa ${sufijo}`, numeroTrabajadores: 30 },
    usuario: { email, nombres: 'Usuario', apellidos: sufijo, tipoDocumento: 'CC', numeroDocumento: `100${doc}` },
    passwordHash: await password.hashear(CLAVE),
    regionDatos: 'co-bogota',
  });
}

const rechaza = (promesa, patron) => assert.rejects(promesa, (e) => patron.test(e.message));

test.before(async () => {
  db = await mysql.createConnection({ ...config.db, dateStrings: ['DATE'] });
  await fechas.inicializar();
  s.A = await alta('A', 'admin.a@prueba.co', 1);
  s.B = await alta('B', 'admin.b@prueba.co', 2);
  s.repoA = new RepositorioTenant(s.A.tenantId, { id: s.A.usuarioId, nombre: 'Usuario A' });
  s.repoB = new RepositorioTenant(s.B.tenantId, { id: s.B.usuarioId, nombre: 'Usuario B' });
});

test.after(async () => {
  if (s.servidor) s.servidor.close();
  await cerrarStore();
  await db.end();
  await cerrar();
});

test('calendario cargado desde la tabla festivo', () => {
  assert.equal(fechas.sumarPlazo('2026-08-07', 2, 'habil'), '2026-08-11');
});

test('aislamiento: un tenant no ve ni referencia datos de otro', async () => {
  const empresasA = await s.repoA.listar('empresa');
  assert.deepEqual(empresasA.map((e) => e.id), [s.A.empresaId]);
  assert.equal(await s.repoA.obtener('empresa', s.B.empresaId), null);
  await rechaza(s.repoA.insertar('cargo', { empresa_id: s.B.empresaId, nombre: 'Intruso' }), /foreign key/i);
  const filas = await s.repoA.consultar('SELECT id FROM empresa WHERE tenant_id = {tenant}');
  assert.equal(filas.length, 1);
});

test('triggers append-only e inmutabilidad documental', async () => {
  s.docId = await s.repoA.insertar('documento_sst', {
    empresa_id: s.A.empresaId, tipo_documental: 'POLITICA_SST', codigo: 'POL-01', titulo: 'Politica SST',
    version: 1, fecha_documento: '2026-01-15', fecha_vence: '2027-01-15', estado: 'vigente',
  });
  await rechaza(db.query('UPDATE documento_sst SET titulo = ? WHERE id = ?', ['Otro', s.docId]), /version nueva/);
  await rechaza(db.query("UPDATE documento_sst SET estado = 'borrador' WHERE id = ?", [s.docId]), /transicion/);
  await rechaza(db.query('DELETE FROM documento_sst WHERE id = ?', [s.docId]), /no se borra/);
  await rechaza(db.query('UPDATE auditoria_log SET accion = ? LIMIT 1', ['x']), /append-only/);
  await rechaza(db.query('DELETE FROM auditoria_log LIMIT 1'), /append-only/);
  await rechaza(db.query('DELETE FROM empresa WHERE id = ?', [s.A.empresaId]), /no se borra/);
  const [log] = await db.query("SELECT COUNT(*) n FROM auditoria_log WHERE tenant_id = ? AND entidad = 'documento_sst' AND accion = 'crear'", [s.A.tenantId]);
  assert.equal(Number(log[0].n), 1);
});

test('motor: AT mortal en viernes festivo genera 4 obligaciones, idempotente', async () => {
  const ev = { evento: 'evento.creado', variante: 'at_mortal', fecha: '2026-08-07', empresaId: s.A.empresaId, entidadTipo: 'evento', entidadId: 501 };
  const r = await plazos.dispararEvento(s.repoA, ev, '2026-08-07');
  const porPlazo = Object.fromEntries(r.map((x) => [x.plazo, x]));
  assert.equal(porPlazo.REP_AT_ARL.fecha_limite, '2026-08-11');
  assert.equal(r.length, 5);
  assert.ok(r.every((x) => x.creada));
  const otra = await plazos.dispararEvento(s.repoA, ev, '2026-08-07');
  assert.ok(otra.every((x) => !x.creada));
  s.obl = porPlazo;
  const [filas] = await db.query("SELECT estado FROM obligacion_pendiente WHERE id = ?", [porPlazo.REP_AT_ARL.id]);
  assert.equal(filas[0].estado, 'por_vencer');
});

test('motor: transiciones auditadas, cumplimiento y obligacion cerrada inmutable', async () => {
  const t = await plazos.recalcularEstados(s.repoA, '2026-08-12');
  assert.ok(t.some((x) => x.id === s.obl.REP_AT_ARL.id && x.a === 'vencido'));
  const r = await plazos.cumplirObligacion(s.repoA, s.obl.INV_AT.id, { fecha: '2026-08-20', observacion: 'Informe de investigacion radicado' }, '2026-08-21');
  assert.equal(r.cumplidaTarde, false);
  await rechaza(plazos.cumplirObligacion(s.repoA, s.obl.INV_AT.id, { fecha: '2026-08-20', observacion: 'otra vez' }, '2026-08-21'), /cerrada/);
  await rechaza(db.query("UPDATE obligacion_pendiente SET observacion = 'x' WHERE id = ?", [s.obl.INV_AT.id]), /cerrada/);
  await rechaza(db.query("UPDATE obligacion_pendiente SET fecha_limite = '2030-01-01' WHERE id = ?", [s.obl.REP_AT_ARL.id]), /inmutables/);
  const [log] = await db.query("SELECT COUNT(*) n FROM auditoria_log WHERE tenant_id = ? AND accion = 'transicion_estado'", [s.A.tenantId]);
  assert.ok(Number(log[0].n) >= 1);
});

test('motor: vigencia de documento y reemplazo por version nueva', async () => {
  let r = await plazos.sincronizarDocumentos(s.repoA, '2026-09-01');
  assert.equal(r.creadas, 1);
  const v2 = await s.repoA.insertar('documento_sst', {
    empresa_id: s.A.empresaId, tipo_documental: 'POLITICA_SST', codigo: 'POL-01', titulo: 'Politica SST v2',
    version: 2, documento_padre_id: s.docId, fecha_documento: '2026-09-01', fecha_vence: '2027-09-01', estado: 'vigente',
  });
  await s.repoA.actualizar('documento_sst', s.docId, { estado: 'reemplazado' });
  r = await plazos.sincronizarDocumentos(s.repoA, '2026-09-02');
  assert.equal(r.creadas, 1);
  assert.equal(r.cumplidas, 1);
  const [ob] = await db.query("SELECT estado, evidencia_documento_id FROM obligacion_pendiente WHERE entidad_origen_tipo = 'documento_sst' AND entidad_origen_id = ?", [s.docId]);
  assert.equal(ob[0].estado, 'cumplido');
  assert.equal(Number(ob[0].evidencia_documento_id), v2);
  s.docV2 = v2;
});

test('matriz: perfil, evidencia obligatoria para cumple y boletin propagado', async () => {
  await matriz.guardarPerfil(s.repoA, s.A.empresaId, ['alturas']);
  const m = await matriz.matriz(s.repoA, s.A.empresaId);
  assert.ok(m.aplicables.some((f) => f.norma.codigo === 'RES-4272-2021'));
  assert.equal(m.activos.get('alturas'), 'declarado');

  await rechaza(matriz.guardarItem(s.repoA, s.A.empresaId, { normaCodigo: 'RES-4272-2021', estadoCumplimiento: 'cumple' }), /al menos un documento/);
  await rechaza(matriz.guardarItem(s.repoA, s.A.empresaId, { normaCodigo: 'RES-4272-2021', estadoCumplimiento: 'cumple', documentos: [s.docId] }), /vigentes/);
  await matriz.guardarItem(s.repoA, s.A.empresaId, { normaCodigo: 'RES-4272-2021', estadoCumplimiento: 'cumple', documentos: [s.docV2] });
  const m2 = await matriz.matriz(s.repoA, s.A.empresaId);
  const fila = m2.aplicables.find((f) => f.norma.codigo === 'RES-4272-2021');
  assert.equal(fila.item.estado_cumplimiento, 'cumple');
  assert.equal(fila.evidencias.length, 1);

  await db.query("INSERT INTO boletin_normativo (norma_codigo, tipo_cambio, estado_anterior, estado_nuevo, detalle) VALUES ('RES-4272-2021', 'cambio_estado', 'vigente', 'vigente_parcial', 'prueba')");
  assert.equal(await matriz.propagarBoletines(s.repoA), 1);
  assert.equal(await matriz.propagarBoletines(s.repoB), 0, 'B no tiene alturas ni la norma en su matriz');
  assert.equal(await matriz.propagarBoletines(s.repoA), 0, 'idempotente');
  const [pend] = await matriz.boletinesPendientes(s.repoA, s.A.empresaId);
  const motivo = typeof pend.motivo === 'string' ? JSON.parse(pend.motivo) : pend.motivo;
  assert.deepEqual(motivo.motivos, ['aplica_perfil', 'en_matriz', 'citada_en_documentos']);
  await matriz.revisarBoletin(s.repoA, s.A.empresaId, pend.id, 'Se reviso la matriz de alturas');
  assert.equal((await matriz.boletinesPendientes(s.repoA, s.A.empresaId)).length, 0);
});

test('auditor: corrida inmutable con totales', async () => {
  const id = await matriz.ejecutarAuditoria(s.repoA, s.A.empresaId, {
    texto: 'Resolucion 2346 de 2007\nDecreto 0312 de 2026\nLey 1562 de 2012', fuente: 'manual',
  });
  const a = await matriz.obtenerAuditoria(s.repoA, s.A.empresaId, id);
  assert.equal(a.total_derogadas, 1);
  assert.equal(a.total_desinformacion, 1);
  assert.equal(a.resultado.derogadas[0].reemplazo, 'RES-1843-2025');
  await rechaza(db.query('UPDATE auditoria_matriz SET cobertura = 100 WHERE id = ?', [id]), /inmutable/);
  s.auditoriaB = await matriz.ejecutarAuditoria(s.repoB, s.B.empresaId, { texto: 'Ley 1562 de 2012', fuente: 'manual' });
  await rechaza(matriz.obtenerAuditoria(s.repoA, s.A.empresaId, s.auditoriaB), /no encontrada/);
});

test('job diario: sin SMTP registra envios omitidos y no marca escalamiento', async () => {
  await db.query("UPDATE empresa SET representante_legal_email = 'gerente.a@prueba.co' WHERE id = ?", [s.A.empresaId]);
  const silencioso = { info() {}, error() {} };
  const r = await ejecutarJobDiario({ hoy: '2026-08-12', notificar: true, log: silencioso });
  assert.ok(r.every((x) => !x.error), JSON.stringify(r));
  const [envios] = await db.query('SELECT tipo, estado, destinatario_email FROM notificacion_envio WHERE tenant_id = ? ORDER BY id', [s.A.tenantId]);
  assert.ok(envios.some((e) => e.tipo === 'resumen_diario' && e.estado === 'omitido' && e.destinatario_email === 'admin.a@prueba.co'));
  assert.ok(envios.some((e) => e.tipo === 'escalamiento' && e.destinatario_email === 'gerente.a@prueba.co'));
  const [ob] = await db.query('SELECT escalado_en FROM obligacion_pendiente WHERE id = ?', [s.obl.REP_AT_ARL.id]);
  assert.equal(ob[0].escalado_en, null);
});

// ---------- HTTP de punta a punta

function cliente(base) {
  let cookie = '';
  return async (ruta, { method = 'GET', form, headers = {} } = {}) => {
    const r = await fetch(base + ruta, {
      method,
      redirect: 'manual',
      headers: { ...(cookie ? { cookie } : {}), ...(form ? { 'content-type': 'application/x-www-form-urlencoded' } : {}), ...headers },
      body: form ? new URLSearchParams(form).toString() : undefined,
    });
    const set = r.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    const texto = await r.text();
    return { status: r.status, location: r.headers.get('location'), tipo: r.headers.get('content-type'), texto };
  };
}
const csrf = (html) => (/name="_csrf" value="([^"]+)"/.exec(html) || /name="csrf-token" content="([^"]+)"/.exec(html))[1];

test('http: login, cambio de clave obligatorio, paneles, auditor, CSRF y consultor', async () => {
  const app = require('../src/app');
  s.servidor = app.listen(0);
  await new Promise((ok) => s.servidor.once('listening', ok));
  const ir = cliente(`http://127.0.0.1:${s.servidor.address().port}`);

  let r = await ir('/login');
  let token = csrf(r.texto);
  r = await ir('/login', { method: 'POST', form: { _csrf: token, email: 'admin.a@prueba.co', password: 'mala' } });
  assert.equal(r.status, 401);
  r = await ir('/login', { method: 'POST', form: { _csrf: token, email: 'admin.a@prueba.co', password: CLAVE } });
  assert.equal(r.status, 302);
  r = await ir('/');
  assert.equal(r.location, '/cambiar-password');

  r = await ir('/cambiar-password');
  token = csrf(r.texto);
  r = await ir('/cambiar-password', { method: 'POST', form: { _csrf: token, actual: CLAVE, nueva: 'NuevaClave-2026', confirmacion: 'NuevaClave-2026' } });
  assert.equal(r.location, '/');

  r = await ir('/obligaciones');
  assert.equal(r.status, 200);
  assert.match(r.texto, /REP_AT_ARL/);
  token = csrf(r.texto);

  r = await ir('/matriz-legal');
  assert.equal(r.status, 200);
  assert.match(r.texto, /RES-4272-2021/);

  r = await ir('/matriz-legal/auditor', { method: 'POST', form: { _csrf: token, texto: 'Res. 652 y 1356 de 2012', fuente: 'manual' } });
  assert.match(r.location, /^\/matriz-legal\/auditor\/\d+$/);
  const informe = await ir(r.location);
  assert.equal(informe.status, 200);
  assert.match(informe.texto, /RES-3461-2025/);
  const csv = await ir(`${r.location}/csv`);
  assert.match(csv.tipo, /text\/csv/);

  r = await ir(`/matriz-legal/auditor/${s.auditoriaB}`);
  assert.equal(r.status, 404, 'no ve auditorias de otro tenant');

  r = await ir('/matriz-legal/perfil', { method: 'POST', form: { ambitos: 'quimicos' } });
  assert.equal(r.status, 403, 'POST sin CSRF');

  // Consultor: el mismo correo recibe acceso a un tercer tenant y cambia de empresa sin cerrar sesion.
  const C = await alta('C', 'admin.a@prueba.co', 3);
  assert.equal(C.usuarioExistente, true);
  r = await ir('/empresa-activa', { method: 'POST', form: { _csrf: token, empresa_id: String(C.empresaId) } });
  assert.equal(r.location, '/');
  r = await ir('/empresa-activa', { method: 'POST', form: { _csrf: token, empresa_id: String(s.B.empresaId) } });
  assert.equal(r.status, 403, 'no puede activar empresa de otro tenant');
  r = await ir('/obligaciones');
  assert.match(r.texto, /Empresa A/);
  assert.match(r.texto, /Empresa C/);
});
