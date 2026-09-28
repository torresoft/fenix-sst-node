// Integracion M01/M02 contra MariaDB real. Se ejecuta con: node scripts/integracion.js
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

const s = {};
let db;
const rechaza = (p, re) => assert.rejects(p, (e) => re.test(e.message));
const HOY = '2026-09-26';

test.before(async () => {
  db = await mysql.createConnection({ ...config.db, dateStrings: ['DATE'] });
  await fechas.inicializar();
  s.T = await cuentas.crearTenantConAdmin({
    tenant: { nombre: 'Tenant M01' },
    empresa: { nit: '900000021', razonSocial: 'Empresa M01', numeroTrabajadores: 5 },
    usuario: { email: 'm01@prueba.co', nombres: 'Ada', apellidos: 'Admin', tipoDocumento: 'CC', numeroDocumento: '2021' },
    passwordHash: await password.hashear('ClaveTemporal-123'), regionDatos: 'co-bogota',
  });
  s.E = s.T.empresaId;
  s.repo = new RepositorioTenant(s.T.tenantId, { id: s.T.usuarioId, nombre: 'Ada Admin' });
});

test.after(async () => {
  if (s.servidor) s.servidor.close();
  await cerrarStore();
  await db.end();
  await cerrarPool();
});

test('empresa: DV del NIT, centros, perfil y modulos activos', async () => {
  await rechaza(empresa.actualizarEmpresa(s.repo, s.E, { razon_social: 'Empresa M01', nit: '800197268', digito_verificacion: '9', numero_trabajadores: 5 }), /deberia ser 4/);
  await empresa.actualizarEmpresa(s.repo, s.E, {
    razon_social: 'Empresa M01 SAS', nit: '800197268', numero_trabajadores: 5, municipio_divipola: '66001',
    representante_legal_email: 'rl@prueba.co', numero_vehiculos: 12, contrata_terceros: '1',
  });
  const [[e]] = await db.query('SELECT digito_verificacion, municipio_divipola FROM empresa WHERE id = ?', [s.E]);
  assert.deepEqual(e, { digito_verificacion: '4', municipio_divipola: '66001' });

  let c = await empresa.agregarCentro(s.repo, s.E, { nombre: 'Planta Pereira', clase_riesgo: 'III', numero_trabajadores: 5 });
  assert.equal(c.conjunto.codigo, 'MIN_7');
  const [centro] = await s.repo.listar('centro_trabajo', { empresa_id: s.E });
  s.centro = centro.id;
  c = await empresa.editarCentro(s.repo, s.E, s.centro, { nombre: 'Planta Pereira', clase_riesgo: 'IV', numero_trabajadores: 5 });
  assert.equal(c.conjunto.codigo, 'FULL_60', 'riesgo IV con 5 trabajadores: 60 estandares');
  assert.equal(c.pendiente.conjunto_anterior, 'MIN_7');
  await rechaza(empresa.cambiarEstadoCentro(s.repo, s.E, s.centro, false), /al menos un centro/);

  const r = await empresa.resumen(s.repo, s.E);
  const m = Object.fromEntries(r.modulos.map((x) => [x.codigo, x.activo]));
  assert.equal(m.M16, true, 'contrata terceros');
  assert.equal(m.M18, true, 'PESV automatico por 12 vehiculos');
  assert.equal(m.M15, false);
});

test('usuarios: invitar nuevo y existente, roles y ultimo administrador', async () => {
  const nuevo = await empresa.invitar(s.repo, {
    email: 'gerente.m01@prueba.co', nombres: 'Gina', apellidos: 'Gerente', tipo_documento: 'CC', numero_documento: '2022', roles: ['gerente'],
  }, s.T.usuarioId);
  assert.equal(nuevo.existente, false);
  assert.match(nuevo.temporal, /^[\w-]{12}$/);
  const [[u]] = await db.query('SELECT debe_cambiar_password FROM usuario WHERE id = ?', [nuevo.usuarioId]);
  assert.equal(u.debe_cambiar_password, 1);

  const propio = await empresa.invitar(s.repo, { email: 'm01@prueba.co', roles: ['responsable_sst'] }, s.T.usuarioId);
  assert.equal(propio.existente, true, 'correo existente: solo se agregan roles');
  assert.equal(propio.temporal, null);

  await rechaza(empresa.guardarRoles(s.repo, s.T.usuarioId, ['responsable_sst'], s.T.usuarioId), /si mismo/);
  await empresa.guardarRoles(s.repo, nuevo.usuarioId, ['gerente', 'copasst'], s.T.usuarioId);
  const lista = await empresa.usuarios(s.repo);
  assert.deepEqual(lista.find((x) => x.id === nuevo.usuarioId).roles, ['copasst', 'gerente']);
  await empresa.guardarRoles(s.repo, nuevo.usuarioId, [], s.T.usuarioId);
  assert.equal(await cuentas.usuarioEnTenant(s.T.tenantId, nuevo.usuarioId), false, 'sin roles pierde el acceso');
  await rechaza(empresa.invitar(s.repo, { email: 'otro@prueba.co', nombres: 'X', apellidos: 'Y', tipo_documento: 'CC', numero_documento: '2022', roles: ['gerente'] }, s.T.usuarioId), /mismo documento|ese documento/);
});

test('personas: alta con vinculacion, documento unico, cargo y reasignacion', async () => {
  s.cargo = await personas.guardarCargo(s.repo, s.E, null, { nombre: 'Operario de planta', perfil_riesgo: 'Ruido, carga fisica' });
  await rechaza(personas.guardarCargo(s.repo, s.E, null, { nombre: 'Operario de planta' }), /Ya existe/);
  s.persona = await personas.crear(s.repo, s.E, {
    tipo_documento: 'CC', numero_documento: '1088000111', nombres: 'Pedro', apellidos: 'Perez', sexo: 'M',
    vincular: '1', tipo: 'dependiente', fecha_ingreso: '2026-02-01', cargo_id: String(s.cargo), centro_trabajo_id: String(s.centro),
  });
  await rechaza(personas.crear(s.repo, s.E, { tipo_documento: 'CC', numero_documento: '1088000111', nombres: 'Otro', apellidos: 'Igual' }), /Ya existe una persona/);
  const d = await personas.detalle(s.repo, s.E, s.persona);
  assert.equal(d.vinculaciones.length, 1);
  assert.equal(d.vinculaciones[0].cargo, 'Operario de planta');
  s.vinc = d.vinculaciones[0].id;
  await rechaza(personas.vincular(s.repo, s.E, s.persona, { tipo: 'dependiente', fecha_ingreso: '2026-03-01' }), /ya tiene una vinculacion activa/);
  await rechaza(personas.cambiarEstadoCargo(s.repo, s.E, s.cargo, false), /vinculacion/);
  await rechaza(empresa.cambiarEstadoCentro(s.repo, s.E, s.centro, false), /centro/);
  const lista = await personas.listar(s.repo, s.E, { estado: 'activas' });
  assert.equal(lista.length, 1);
});

test('retiro: examen de egreso en 5 dias y retencion de 20 anios de los registros individuales', async () => {
  s.epp = await docs.crear(s.repo, s.E, {
    tipo_documental: 'ENTREGA_EPP', codigo: 'EPP-PP-01', titulo: 'Entrega de EPP', fecha_documento: '2026-02-02',
    persona_id: String(s.persona), modalidad_firma: 'manuscrita', firmantes_externos: 'Pedro Perez',
  }, { originalname: 'epp.pdf', mimetype: 'application/pdf', buffer: Buffer.from('%PDF epp'), size: 8 });
  await docs.publicar(s.repo, s.E, s.epp, HOY);

  await rechaza(personas.retirar(s.repo, s.E, s.vinc, { fecha: '2026-01-15', motivo: 'Renuncia' }, HOY), /anterior al ingreso/);
  await personas.retirar(s.repo, s.E, s.vinc, { fecha: '2026-09-25', motivo: 'Renuncia voluntaria' }, HOY);
  const [obl] = await db.query("SELECT plazo_codigo, fecha_limite FROM obligacion_pendiente WHERE entidad_origen_tipo = 'vinculacion' AND entidad_origen_id = ? AND plazo_codigo = 'EXAMEN_EGRESO'", [s.vinc]);
  assert.deepEqual(obl.map((o) => [o.plazo_codigo, o.fecha_limite]), [['EXAMEN_EGRESO', '2026-09-30']]);
  const [[epp]] = await db.query('SELECT retencion_hasta FROM documento_sst WHERE id = ?', [s.epp]);
  assert.equal(epp.retencion_hasta, '2046-09-25');
  await rechaza(db.query("UPDATE vinculacion SET cargo_id = NULL WHERE id = ?", [s.vinc]), /cerrada/);
  await rechaza(personas.retirar(s.repo, s.E, s.vinc, { fecha: '2026-09-25', motivo: 'x' }, HOY), /cerrada/);

  const reintegro = await personas.vincular(s.repo, s.E, s.persona, { tipo: 'contratista', fecha_ingreso: '2026-09-26' });
  await rechaza(personas.anularVinculacion(s.repo, s.E, reintegro, 'error'), /minimo 10/);
  await personas.anularVinculacion(s.repo, s.E, reintegro, 'Se registro por error, era otra persona');
});

test('http: empresa, usuarios, personas y cargos', async () => {
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
  await ir('/login', { _csrf: token(r.texto), email: 'm01@prueba.co', password: 'ClaveTemporal-123' });
  r = await ir('/cambiar-password');
  await ir('/cambiar-password', { _csrf: token(r.texto), actual: 'ClaveTemporal-123', nueva: 'NuevaClave-2026', confirmacion: 'NuevaClave-2026' });

  for (const ruta of ['/empresa', '/empresa?tab=centros', '/empresa/usuarios', '/personas', '/personas?estado=todas', `/personas/${s.persona}`, '/personas/cargos', '/personas/nueva']) {
    r = await ir(ruta);
    assert.equal(r.status, 200, ruta);
  }
  r = await ir('/personas?estado=todas');
  assert.match(r.texto, /Perez Pedro/);
  const csrf = token(r.texto);
  r = await ir('/personas', { _csrf: csrf, tipo_documento: 'CC', numero_documento: '1088000222', nombres: 'Luisa', apellidos: 'Lopez', vincular: '1', tipo: 'aprendiz', fecha_ingreso: HOY });
  assert.match(r.location, /^\/personas\/\d+$/);
  r = await ir('/personas', { _csrf: csrf, tipo_documento: 'CC', numero_documento: '1088000222', nombres: 'Luisa', apellidos: 'Lopez' });
  assert.match(r.location, /^\/personas\/\d+$/, 'documento repetido abre la ficha existente');
});
