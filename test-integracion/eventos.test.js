// Integracion M08 contra MariaDB real. Se ejecuta con: node scripts/integracion.js
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
const ev = require('../src/eventos/servicio');

const s = {};
let db;
const rechaza = (p, re) => assert.rejects(p, (e) => re.test(e.message));
const AHORA = '2026-09-26T10:00';
const obligaciones = async (id) => (await db.query(
  "SELECT plazo_codigo, fecha_limite, estado FROM obligacion_pendiente WHERE entidad_origen_tipo = 'evento' AND entidad_origen_id = ? ORDER BY plazo_codigo", [id],
))[0];

test.before(async () => {
  db = await mysql.createConnection({ ...config.db, dateStrings: ['DATE'] });
  await fechas.inicializar();
  s.T = await cuentas.crearTenantConAdmin({
    tenant: { nombre: 'Tenant M08' },
    empresa: { nit: '900000081', razonSocial: 'Empresa M08', numeroTrabajadores: 20 },
    usuario: { email: 'm08@prueba.co', nombres: 'Rita', apellidos: 'Responsable', tipoDocumento: 'CC', numeroDocumento: '8081' },
    passwordHash: await password.hashear('ClaveTemporal-123'), regionDatos: 'co-bogota',
  });
  s.E = s.T.empresaId;
  s.repo = new RepositorioTenant(s.T.tenantId, { id: s.T.usuarioId, nombre: 'Rita Responsable' });
  await empresa.agregarCentro(s.repo, s.E, { nombre: 'Taller', clase_riesgo: 'III', numero_trabajadores: 20 });
  [s.centro] = await s.repo.listar('centro_trabajo', { empresa_id: s.E });
  s.persona = await personas.crear(s.repo, s.E, {
    tipo_documento: 'CC', numero_documento: '1088808080', nombres: 'Mario', apellidos: 'Martinez',
    vincular: '1', tipo: 'dependiente', fecha_ingreso: '2025-01-10', centro_trabajo_id: String(s.centro.id),
  });
});

test.after(async () => {
  if (s.servidor) s.servidor.close();
  await cerrarStore();
  await db.end();
  await cerrarPool();
});

test('AT mortal el viernes festivo 7-ago-2026: codigo consecutivo y los 4 plazos legales', async () => {
  s.at = await ev.registrar(s.repo, s.E, {
    tipo: 'accidente', gravedad: 'mortal', persona_id: String(s.persona), centro_trabajo_id: String(s.centro.id),
    fecha_ocurrencia: '2026-08-07T14:20', descripcion: 'Caida desde andamio a 4 metros durante mantenimiento de cubierta',
  }, AHORA);
  const [[e]] = await db.query('SELECT codigo, fecha_base, estado FROM evento WHERE id = ?', [s.at]);
  assert.deepEqual(e, { codigo: 'EV-2026-001', fecha_base: '2026-08-07', estado: 'registrado' });
  assert.deepEqual((await obligaciones(s.at)).map((o) => [o.plazo_codigo, o.fecha_limite]), [
    ['COPASST_EXTRA', '2026-08-12'], ['INV_AT', '2026-08-22'], ['INV_AT_ARL', '2026-08-22'], ['MATRIZ_AT_MORTAL', '2026-09-06'], ['REP_AT_ARL', '2026-08-11'],
  ]);
  const d = await ev.detalle(s.repo, s.E, s.at);
  assert.equal(d.e.ocurrencia_texto, '2026-08-07 14:20', 'hora de Bogota, no UTC');
});

test('incidente solo se investiga; EL solo se reporta; gravedad coherente', async () => {
  s.inc = await ev.registrar(s.repo, s.E, { tipo: 'incidente', fecha_ocurrencia: '2026-09-20T09:00', descripcion: 'Caida de cajas desde estanteria sin personas cerca' }, AHORA);
  assert.deepEqual((await obligaciones(s.inc)).map((o) => o.plazo_codigo), ['INV_AT']);
  const el = await ev.registrar(s.repo, s.E, {
    tipo: 'enfermedad', persona_id: String(s.persona), fecha_diagnostico: '2026-09-15', entidad_calificadora: 'ARL',
    agente_riesgo: 'Ruido', descripcion: 'Calificada de origen laboral por la ARL tras evaluacion',
  }, AHORA);
  assert.deepEqual((await obligaciones(el)).map((o) => [o.plazo_codigo, o.fecha_limite]), [['REP_AT_ARL', '2026-09-17']]);
  const [[fila]] = await db.query('SELECT codigo FROM evento WHERE id = ?', [el]);
  assert.equal(fila.codigo, 'EV-2026-003');
  await rechaza(ev.registrar(s.repo, s.E, {
    tipo: 'accidente', gravedad: 'leve', persona_id: String(s.persona), fecha_ocurrencia: '2026-09-25T10:00',
    criterios_grave: ['AMPUTACION'], descripcion: 'Atrapamiento de mano en rodillo de la maquina',
  }, AHORA), /es grave/);
});

test('reporte FURAT: la obligacion de 2 dias habiles se cumple con las 3 radicaciones', async () => {
  await ev.reportar(s.repo, s.E, s.at, { entidad: 'ARL', radicado: 'ARL-1', fecha_radicacion: '2026-08-10' });
  await ev.reportar(s.repo, s.E, s.at, { entidad: 'EPS', radicado: 'EPS-1', fecha_radicacion: '2026-08-10' });
  assert.equal((await obligaciones(s.at)).find((o) => o.plazo_codigo === 'REP_AT_ARL').estado !== 'cumplido', true);
  await rechaza(ev.reportar(s.repo, s.E, s.at, { entidad: 'ARL', radicado: 'X', fecha_radicacion: '2026-08-10' }), /Ya se radico/);
  await ev.reportar(s.repo, s.E, s.at, { entidad: 'MINTRABAJO', radicado: 'MT-1', fecha_radicacion: '2026-08-11' });
  const [[o]] = await db.query("SELECT estado, fecha_cumplimiento, observacion FROM obligacion_pendiente WHERE entidad_origen_id = ? AND plazo_codigo = 'REP_AT_ARL' AND entidad_origen_tipo = 'evento'", [s.at]);
  assert.equal(o.estado, 'cumplido');
  assert.equal(o.fecha_cumplimiento, '2026-08-11');
  assert.match(o.observacion, /ARL ARL-1.*EPS EPS-1.*MINTRABAJO MT-1/);
  await rechaza(ev.reportar(s.repo, s.E, s.inc, { entidad: 'ARL', radicado: 'X', fecha_radicacion: '2026-09-21' }), /incidentes/);
  await rechaza(db.query('UPDATE evento_reporte SET radicado = ? WHERE evento_id = ?', ['x', s.at]), /inmutable/);
});

test('investigacion: equipo por gravedad, analisis causal e informe vigente', async () => {
  await rechaza(ev.cerrarInvestigacion(s.repo, s.E, s.at, {}), /Faltan en el equipo.*Profesional con licencia/);
  for (const [rol, nombre] of [['jefe_inmediato', 'Jefe Taller'], ['copasst', 'Delegado COPASST'], ['responsable_sst', 'Rita Responsable'], ['profesional_licencia', 'Ing. SST externo']]) {
    await ev.agregarInvestigador(s.repo, s.E, s.at, { rol_codigo: rol, nombre });
  }
  await ev.agregarCausa(s.repo, s.E, s.at, { tipo: 'condicion_insegura', descripcion: 'Andamio sin baranda ni punto de anclaje' });
  await rechaza(ev.cerrarInvestigacion(s.repo, s.E, s.at, {}), /causa basica/);
  await ev.agregarCausa(s.repo, s.E, s.at, { tipo: 'factor_trabajo', descripcion: 'Sin programa de proteccion contra caidas' });
  await ev.guardarDatos(s.repo, s.E, s.at, { metodologia: 'Arbol de causas', conclusiones: 'Falta de sistema de proteccion contra caidas', dias_incapacidad: 0, dias_cargados: 6000 });

  const informe = await docs.crear(s.repo, s.E, {
    tipo_documental: 'INV_ACCIDENTE', codigo: 'INV-EV-2026-001', titulo: 'Informe de investigacion EV-2026-001', fecha_documento: '2026-08-20',
    modalidad_firma: 'manuscrita', firmantes_externos: 'Representante legal y equipo investigador',
  }, { originalname: 'inv.pdf', mimetype: 'application/pdf', buffer: Buffer.from('%PDF informe'), size: 12 });
  await rechaza(ev.cerrarInvestigacion(s.repo, s.E, s.at, { documento_id: informe }), /vigente/);
  await docs.publicar(s.repo, s.E, informe, '2026-09-26');
  await ev.cerrarInvestigacion(s.repo, s.E, s.at, { documento_id: informe }, '2026-08-21');
  const o = (await obligaciones(s.at)).find((x) => x.plazo_codigo === 'INV_AT');
  assert.equal(o.estado, 'cumplido');
  await rechaza(db.query("UPDATE evento SET conclusiones = 'otra' WHERE id = ?", [s.at]), /investigacion ya esta cerrada/);
  await rechaza(ev.agregarCausa(s.repo, s.E, s.at, { tipo: 'acto_inseguro', descripcion: 'tarde' }), /cerrada/);
});

test('cierre: exige el informe radicado ante la ARL (mortal); plan de accion en la CAPA', async () => {
  await rechaza(ev.cerrar(s.repo, s.E, s.at), /informe de investigacion ante la ARL/);
  await ev.radicarInformeArl(s.repo, s.E, s.at, { radicado: 'ARL-INF-9', fecha_radicacion: '2026-08-21' });
  assert.equal((await obligaciones(s.at)).find((x) => x.plazo_codigo === 'INV_AT_ARL').estado, 'cumplido');
  await ev.crearAccion(s.repo, s.E, s.at, { descripcion: 'Instalar lineas de vida en cubierta', tipo: 'correctiva', responsable_id: String(s.T.usuarioId), fecha_limite: '2026-12-31' });
  const [[a]] = await db.query("SELECT referencia FROM accion_mejora WHERE origen = 'evento' AND origen_id = ?", [s.at]);
  assert.equal(a.referencia, 'EV-2026-001-A1');
  await ev.cerrar(s.repo, s.E, s.at);
  await rechaza(db.query("UPDATE evento SET lugar = 'x' WHERE id = ?", [s.at]), /cerrado/);
});

test('anular: el evento y sus plazos abiertos quedan anulados con traza', async () => {
  await rechaza(ev.anular(s.repo, s.E, s.inc, 'error'), /minimo 10/);
  await ev.anular(s.repo, s.E, s.inc, 'Duplicado del reporte del mismo incidente');
  assert.ok((await obligaciones(s.inc)).every((o) => o.estado === 'anulado'));
  const lista = await ev.listar(s.repo, s.E, { anio: 2026 });
  const est = ev.estadistica(lista);
  assert.deepEqual([est.incidentes, est.at, est.at_mortal, est.el], [0, 1, 1, 1]);
});

test('http: listado, formulario, registro y detalle', async () => {
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
  await ir('/login', { _csrf: token(r.texto), email: 'm08@prueba.co', password: 'ClaveTemporal-123' });
  r = await ir('/cambiar-password');
  await ir('/cambiar-password', { _csrf: token(r.texto), actual: 'ClaveTemporal-123', nueva: 'NuevaClave-2026', confirmacion: 'NuevaClave-2026' });

  r = await ir('/eventos?anio=2026');
  assert.equal(r.status, 200);
  assert.match(r.texto, /EV-2026-001/);
  r = await ir('/eventos/nuevo');
  assert.equal(r.status, 200);
  r = await ir('/eventos', {
    _csrf: token(r.texto), tipo: 'accidente', gravedad: 'leve', persona_id: String(s.persona),
    fecha_ocurrencia: '2026-09-24T08:15', descripcion: 'Corte leve en el dedo al manipular lamina metalica',
  });
  assert.match(r.location, /^\/eventos\/\d+$/);
  r = await ir(r.location);
  assert.equal(r.status, 200);
  assert.match(r.texto, /2026-09-24 08:15/);
  assert.match(r.texto, /FURAT/);
});
