// Integracion M10 contra MariaDB real. Se ejecuta con: node scripts/integracion.js
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
const empresa = require('../src/empresa/servicio');
const personas = require('../src/personas/servicio');
const docs = require('../src/documentos/servicio');
const eventos = require('../src/eventos/servicio');
const comites = require('../src/comites/servicio');

const s = {};
let db;
const rechaza = (p, re) => assert.rejects(p, (e) => re.test(e.message));
const HOY = '2026-09-26';
const obl = async (tipo, id) => (await db.query(
  'SELECT plazo_codigo, fecha_limite, estado FROM obligacion_pendiente WHERE entidad_origen_tipo = ? AND entidad_origen_id = ? ORDER BY plazo_codigo', [tipo, id],
))[0];
const pdf = (t) => ({ originalname: 'acta.pdf', mimetype: 'application/pdf', buffer: Buffer.from(`%PDF ${t}`), size: 5 + t.length });

test.before(async () => {
  db = await mysql.createConnection({ ...config.db, dateStrings: ['DATE'] });
  await fechas.inicializar();
  s.T = await cuentas.crearTenantConAdmin({
    tenant: { nombre: 'Tenant M10' },
    empresa: { nit: '900000101', razonSocial: 'Empresa M10', numeroTrabajadores: 30 },
    usuario: { email: 'm10@prueba.co', nombres: 'Carla', apellidos: 'Comite', tipoDocumento: 'CC', numeroDocumento: '1010' },
    passwordHash: await password.hashear('ClaveTemporal-123'), regionDatos: 'co-bogota',
  });
  s.E = s.T.empresaId;
  s.repo = new RepositorioTenant(s.T.tenantId, { id: s.T.usuarioId, nombre: 'Carla Comite' });
  await empresa.agregarCentro(s.repo, s.E, { nombre: 'Sede', clase_riesgo: 'II', numero_trabajadores: 30 });
  s.p = [];
  for (let i = 1; i <= 5; i += 1) {
    s.p.push(await personas.crear(s.repo, s.E, {
      tipo_documento: 'CC', numero_documento: `10101010${i}`, nombres: `Persona${i}`, apellidos: 'Prueba',
      vincular: '1', tipo: 'dependiente', fecha_ingreso: '2024-01-10',
    }));
  }
  s.sinVinculo = await personas.crear(s.repo, s.E, { tipo_documento: 'CC', numero_documento: '101010109', nombres: 'Externo', apellidos: 'Sin vinculo' });
  s.at = await eventos.registrar(s.repo, s.E, {
    tipo: 'accidente', gravedad: 'grave', persona_id: String(s.p[0]), fecha_ocurrencia: '2026-09-21T10:00',
    criterios_grave: ['FRACTURA_HUESO_LARGO'], descripcion: 'Caida de escalera con fractura de tibia',
  }, '2026-09-26T12:00');
});

test.after(async () => {
  if (s.servidor) s.servidor.close();
  await cerrarStore();
  await db.end();
  await cerrarPool();
});

test('panel: con 30 trabajadores aplican COPASST y Convivencia, no Vigia', async () => {
  const p = await comites.panel(s.repo, s.E, HOY);
  assert.deepEqual(p.tarjetas.map((t) => t.tipo.codigo).sort(), ['convivencia', 'copasst']);
  assert.ok(p.tarjetas.every((t) => !t.comite));
});

test('periodo de 2 anios con su obligacion de renovacion', async () => {
  await rechaza(comites.conformar(s.repo, s.E, { tipo: 'copasst', periodo_inicio: '2026-10-01' }, HOY), /futuro/);
  s.cop = await comites.conformar(s.repo, s.E, { tipo: 'copasst', periodo_inicio: '2025-03-01' }, HOY);
  const [[c]] = await db.query('SELECT periodo_fin FROM comite WHERE id = ?', [s.cop]);
  assert.equal(c.periodo_fin, '2027-02-28');
  assert.deepEqual((await obl('comite', s.cop)).map((o) => [o.plazo_codigo, o.fecha_limite]), [['PERIODO_COPASST', '2027-02-28']]);
});

test('miembros: solo vinculados, un presidente, conformacion completa segun Res. 2013', async () => {
  await rechaza(comites.agregarMiembro(s.repo, s.E, s.cop, { persona_id: s.sinVinculo, representacion: 'trabajadores', calidad: 'principal' }, HOY), /vinculacion activa/);
  const alta = (i, representacion, calidad, cargo) => comites.agregarMiembro(s.repo, s.E, s.cop, { persona_id: s.p[i], representacion, calidad, cargo_comite: cargo, fecha_ingreso: '2025-03-01' }, HOY);
  await alta(0, 'empleador', 'principal', 'presidente');
  await rechaza(alta(1, 'empleador', 'suplente', 'presidente'), /Ya hay un presidente/);
  await alta(1, 'empleador', 'suplente', 'miembro');
  await alta(2, 'trabajadores', 'principal', 'secretario');
  let d = await comites.detalle(s.repo, s.E, s.cop, HOY);
  assert.deepEqual(d.conformacion.faltas, ['Faltan 1 suplente(s) por los trabajadores']);
  await alta(3, 'trabajadores', 'suplente', 'miembro');
  d = await comites.detalle(s.repo, s.E, s.cop, HOY);
  assert.deepEqual(d.conformacion.faltas, []);
  await rechaza(alta(3, 'trabajadores', 'suplente', 'miembro'), /ya es miembro/);
});

test('sesion ordinaria: quorum, acta en 8 dias y hechos inmutables', async () => {
  const [m] = await db.query("SELECT id FROM comite_miembro WHERE comite_id = ? AND calidad = 'principal'", [s.cop]);
  await rechaza(comites.registrarSesion(s.repo, s.E, s.cop, { tipo: 'ordinaria', fecha: '2026-09-10', temas: 'Revision', asistentes: [] }, HOY), /temas|asistentes/);
  const r = await comites.registrarSesion(s.repo, s.E, s.cop, { tipo: 'ordinaria', fecha: '2026-09-10', temas: 'Revision de inspecciones y accidentalidad', asistentes: m.map((x) => x.id) }, HOY);
  assert.equal(r.quorum, true);
  s.sesion = r.id;
  assert.deepEqual((await obl('comite_sesion', s.sesion)).map((o) => [o.plazo_codigo, o.fecha_limite]), [['ACTA_COMITE', '2026-09-18']]);
  await rechaza(db.query("UPDATE comite_sesion SET temas = 'otros' WHERE id = ?", [s.sesion]), /inmutables/);
  const sin = await comites.registrarSesion(s.repo, s.E, s.cop, { tipo: 'ordinaria', fecha: '2026-09-12', temas: 'Sesion con baja asistencia', asistentes: [m[0].id] }, HOY);
  assert.equal(sin.quorum, false);
});

test('extraordinaria por AT grave cumple el plazo de 5 dias del M08', async () => {
  const [m] = await db.query("SELECT id FROM comite_miembro WHERE comite_id = ? AND calidad = 'principal'", [s.cop]);
  await rechaza(comites.registrarSesion(s.repo, s.E, s.cop, { tipo: 'ordinaria', fecha: '2026-09-22', temas: 'Analisis del accidente', asistentes: m.map((x) => x.id), evento_id: String(s.at) }, HOY), /extraordinaria/);
  assert.equal((await comites.eventosPendientesExtra(s.repo, s.E)).length, 1);
  await comites.registrarSesion(s.repo, s.E, s.cop, { tipo: 'extraordinaria', fecha: '2026-09-23', temas: 'Analisis del accidente grave EV-2026-001', asistentes: m.map((x) => x.id), evento_id: String(s.at) }, HOY);
  const o = (await obl('evento', s.at)).find((x) => x.plazo_codigo === 'COPASST_EXTRA');
  assert.equal(o.estado, 'cumplido');
  assert.equal((await comites.eventosPendientesExtra(s.repo, s.E)).length, 0);
});

test('acta firmada cumple la obligacion; compromisos con cierre', async () => {
  const acta = await docs.crear(s.repo, s.E, {
    tipo_documental: 'ACTA_COPASST', codigo: 'ACTA-COP-2026-09', titulo: 'Acta COPASST septiembre', fecha_documento: '2026-09-10',
    modalidad_firma: 'manuscrita', firmantes_externos: 'Presidente y secretario del COPASST',
  }, pdf('acta'));
  await rechaza(comites.adjuntarActa(s.repo, s.E, s.sesion, acta, HOY), /vigente/);
  await docs.publicar(s.repo, s.E, acta, HOY);
  await comites.adjuntarActa(s.repo, s.E, s.sesion, acta, HOY);
  assert.equal((await obl('comite_sesion', s.sesion))[0].estado, 'cumplido');
  await rechaza(comites.adjuntarActa(s.repo, s.E, s.sesion, acta, HOY), /ya tiene acta/);

  await rechaza(comites.crearCompromiso(s.repo, s.E, s.sesion, { descripcion: 'Senalizar escaleras', responsable: 'Mantenimiento', fecha_limite: '2026-09-01' }), /posterior/);
  await comites.crearCompromiso(s.repo, s.E, s.sesion, { descripcion: 'Senalizar escaleras', responsable: 'Mantenimiento', fecha_limite: '2026-10-15' });
  const [[x]] = await db.query('SELECT id FROM comite_compromiso WHERE sesion_id = ?', [s.sesion]);
  await comites.cerrarCompromiso(s.repo, s.E, x.id, { accion: 'cumplir', fecha: HOY, observacion: 'Senalizacion instalada' }, HOY);
  await rechaza(db.query("UPDATE comite_compromiso SET responsable = 'x' WHERE id = ?", [x.id]), /cerrado/);
  const d = await comites.detalle(s.repo, s.E, s.cop, HOY);
  assert.ok(d.sinReunion.includes('2026-08'), 'agosto sin reunion');
  assert.ok(!d.sinReunion.includes('2026-09'));
});

test('convivencia: sin regla cargada avisa y no afirma quorum', async () => {
  const conv = await comites.conformar(s.repo, s.E, { tipo: 'convivencia', periodo_inicio: '2026-01-15' }, HOY);
  await comites.agregarMiembro(s.repo, s.E, conv, { persona_id: s.p[4], representacion: 'trabajadores', calidad: 'principal', fecha_ingreso: '2026-01-15' }, HOY);
  const d = await comites.detalle(s.repo, s.E, conv, HOY);
  assert.match(d.conformacion.aviso, /no cargada/);
  const [[m]] = await db.query('SELECT id FROM comite_miembro WHERE comite_id = ?', [conv]);
  const r = await comites.registrarSesion(s.repo, s.E, conv, { tipo: 'ordinaria', fecha: '2026-09-15', temas: 'Seguimiento de convivencia', asistentes: [m.id] }, HOY);
  assert.equal(r.quorum, null);
  await rechaza(comites.registrarSesion(s.repo, s.E, conv, { tipo: 'extraordinaria', fecha: '2026-09-24', temas: 'Accidente no aplica aqui', asistentes: [m.id], evento_id: String(s.at) }, HOY), /COPASST/);
});

test('nuevo periodo reemplaza el anterior y cumple su renovacion', async () => {
  const nuevo = await comites.conformar(s.repo, s.E, { tipo: 'copasst', periodo_inicio: '2026-09-01' }, HOY);
  const [[viejo]] = await db.query('SELECT estado FROM comite WHERE id = ?', [s.cop]);
  assert.equal(viejo.estado, 'reemplazado');
  assert.equal((await obl('comite', s.cop))[0].estado, 'cumplido');
  assert.equal((await obl('comite', nuevo))[0].fecha_limite, '2028-08-31');
  await rechaza(comites.agregarMiembro(s.repo, s.E, s.cop, { persona_id: s.p[4], representacion: 'trabajadores', calidad: 'principal' }, HOY), /cerrado/);
  s.nuevo = nuevo;
});

test('http: panel y detalle', async () => {
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
    return { status: r.status, location: r.headers.get('location'), texto: await r.text() };
  };
  const token = (h) => /name="_csrf" value="([^"]+)"/.exec(h)[1];
  let r = await ir('/login');
  await ir('/login', { _csrf: token(r.texto), email: 'm10@prueba.co', password: 'ClaveTemporal-123' });
  r = await ir('/cambiar-password');
  await ir('/cambiar-password', { _csrf: token(r.texto), actual: 'ClaveTemporal-123', nueva: 'NuevaClave-2026', confirmacion: 'NuevaClave-2026' });
  r = await ir('/comites');
  assert.equal(r.status, 200);
  assert.match(r.texto, /COPASST/);
  for (const id of [s.cop, s.nuevo]) {
    r = await ir(`/comites/${id}`);
    assert.equal(r.status, 200);
  }
});
