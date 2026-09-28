// Utilidades de integracion: tenant de prueba, repositorio y cliente HTTP con sesion.
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

const CLAVE = 'ClaveTemporal-123';

/** Tenant + empresa + admin + un centro + n personas vinculadas. */
async function preparar(sufijo, { trabajadores = 30, clase = 'II', personasN = 3 } = {}) {
  const db = await mysql.createConnection({ ...config.db, dateStrings: ['DATE'] });
  await fechas.inicializar();
  const nit = `9${String(Math.abs([...sufijo].reduce((a, c) => a * 31 + c.charCodeAt(0), 7)) % 100000000).padStart(8, '0')}`;
  const T = await cuentas.crearTenantConAdmin({
    tenant: { nombre: `Tenant ${sufijo}` },
    empresa: { nit, razonSocial: `Empresa ${sufijo}`, numeroTrabajadores: trabajadores },
    usuario: { email: `${sufijo.toLowerCase()}@prueba.co`, nombres: 'Admin', apellidos: sufijo, tipoDocumento: 'CC', numeroDocumento: nit.slice(1) },
    passwordHash: await password.hashear(CLAVE), regionDatos: 'co-bogota',
  });
  const repo = new RepositorioTenant(T.tenantId, { id: T.usuarioId, nombre: `Admin ${sufijo}` });
  await empresa.agregarCentro(repo, T.empresaId, { nombre: 'Sede principal', clase_riesgo: clase, numero_trabajadores: trabajadores });
  const [centro] = await repo.listar('centro_trabajo', { empresa_id: T.empresaId });
  const ids = [];
  for (let i = 1; i <= personasN; i += 1) {
    ids.push(await personas.crear(repo, T.empresaId, {
      tipo_documento: 'CC', numero_documento: `${nit.slice(1, 7)}${i}`, nombres: `Persona${i}`, apellidos: sufijo,
      vincular: '1', tipo: 'dependiente', fecha_ingreso: '2024-01-10', centro_trabajo_id: String(centro.id),
    }));
  }
  return { db, T, E: T.empresaId, repo, centro, personas: ids, email: `${sufijo.toLowerCase()}@prueba.co` };
}

async function cerrar(ctx) {
  if (ctx.servidor) ctx.servidor.close();
  await cerrarStore();
  await ctx.db.end();
  await cerrarPool();
}

/** Levanta la app, inicia sesion y cambia la clave temporal. Devuelve ir(ruta, form?). */
async function clienteHttp(ctx) {
  const app = require('../src/app');
  ctx.servidor = app.listen(0);
  await new Promise((ok) => ctx.servidor.once('listening', ok));
  const base = `http://127.0.0.1:${ctx.servidor.address().port}`;
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
  ir.token = (h) => /name="_csrf" value="([^"]+)"/.exec(h)[1];
  let r = await ir('/login');
  await ir('/login', { _csrf: ir.token(r.texto), email: ctx.email, password: CLAVE });
  r = await ir('/cambiar-password');
  await ir('/cambiar-password', { _csrf: ir.token(r.texto), actual: CLAVE, nueva: 'NuevaClave-2026', confirmacion: 'NuevaClave-2026' });
  return ir;
}

const pdf = (t) => ({ originalname: 'doc.pdf', mimetype: 'application/pdf', buffer: Buffer.from(`%PDF ${t}`), size: 5 + String(t).length });

/** Crea y publica un documento con firma manuscrita (o sin firma si el tipo no la exige). */
async function documentoVigente(repo, empresaId, tipo, codigo, extra = {}) {
  const docs = require('../src/documentos/servicio');
  const id = await docs.crear(repo, empresaId, {
    tipo_documental: tipo, codigo, titulo: `${tipo} ${codigo}`, fecha_documento: '2026-01-15',
    modalidad_firma: 'manuscrita', firmantes_externos: 'Firmante de prueba', ...extra,
  }, pdf(codigo));
  await docs.publicar(repo, empresaId, id, '2026-09-26');
  return id;
}

/** Deja a la persona con el documento del usuario: vincularUsuario exige que sean la misma. */
async function mismoDocumento(ctx, personaId, usuarioId) {
  await ctx.db.query(
    'UPDATE persona p JOIN usuario u ON u.id = ? SET p.tipo_documento = u.tipo_documento, p.numero_documento = u.numero_documento WHERE p.id = ?',
    [usuarioId, personaId],
  );
}

const rechaza = async (assert, p, re) => assert.rejects(p, (e) => re.test(e.message));

module.exports = { preparar, cerrar, clienteHttp, pdf, documentoVigente, rechaza, mismoDocumento, CLAVE };
