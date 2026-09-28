// Integracion del tablero del consultor: cartera de varios tenants sin cruzar datos.
const test = require('node:test');
const assert = require('node:assert/strict');
const u = require('./_util');
const empresa = require('../src/empresa/servicio');
const eventos = require('../src/eventos/servicio');
const password = require('../src/auth/password');
const consultor = require('../src/consultor/servicio');

const s = {};
const EMAIL = 'consultora@cartera.co';

test.before(async () => {
  Object.assign(s, await u.preparar('CONS1'));
  s.b = await u.preparar('CONS2');
  s.c = await u.preparar('CONS3');
  const inv = await empresa.invitar(s.repo, { email: EMAIL, nombres: 'Marta', apellidos: 'Rios', tipo_documento: 'CC', numero_documento: '42000111', roles: ['consultor_sst'] }, s.T.usuarioId);
  await empresa.invitar(s.b.repo, { email: EMAIL, roles: ['consultor_sst'] }, s.b.T.usuarioId);
  s.consultora = inv.usuarioId;
  await s.db.query('UPDATE usuario SET password_hash = ? WHERE id = ?', [await password.hashear(u.CLAVE), s.consultora]);
  // AT mortal viejo: sus obligaciones de reporte quedan vencidas.
  await eventos.registrar(s.repo, s.E, {
    tipo: 'accidente', gravedad: 'mortal', persona_id: String(s.personas[0]), fecha_ocurrencia: '2026-08-03T09:00', descripcion: 'Caida desde andamio en bodega',
  }, '2026-09-26T12:00');
});
test.after(async () => {
  for (const x of [s.b, s.c]) await x.db.end();
  await u.cerrar(s);
});

test('cartera: solo las empresas del consultor, con semaforo y orden por urgencia', async () => {
  const c = await consultor.cartera(s.consultora, { id: s.consultora, nombre: 'Marta Rios' }, '2026-09-27');
  assert.deepEqual(c.filas.map((f) => f.empresa_id).sort(), [s.E, s.b.E].sort(), 'no aparece el tercer tenant');
  const [primera] = c.filas;
  assert.equal(primera.empresa_id, s.E, 'la del AT mortal va primero');
  assert.equal(primera.semaforo.nivel, 'rojo');
  assert.ok(primera.obligaciones.vencidas > 0);
  assert.equal(primera.eventos.graves, 1);
  assert.ok(primera.obligaciones.vencidas > c.filas[1].obligaciones.vencidas);
  assert.equal(c.totales.empresas, 2);
  assert.match(consultor.aCsv(c.filas), /Empresa CONS1/);
});

test('http: login del consultor cae en su cartera y entra directo a un modulo', async () => {
  s.email = EMAIL;
  const ir = await u.clienteHttp(s);
  let r = await ir('/mis-empresas');
  assert.equal(r.status, 200);
  assert.match(r.texto, /Empresa CONS1/);
  assert.match(r.texto, /Empresa CONS2/);
  assert.doesNotMatch(r.texto, /Empresa CONS3/);
  r = await ir('/mis-empresas?q=cons2');
  const tabla = /<tbody>([\s\S]*)<\/tbody>/.exec(r.texto)[1];
  assert.match(tabla, /Empresa CONS2/);
  assert.doesNotMatch(tabla, /Empresa CONS1/, 'el navbar lista las empresas; se compara solo la tabla');
  r = await ir('/mis-empresas.csv');
  assert.match(r.tipo, /text\/csv/);
  const token = ir.token((await ir('/mis-empresas')).texto);
  r = await ir('/empresa-activa', { _csrf: token, empresa_id: String(s.b.E), destino: '/autoevaluacion' });
  assert.equal(r.location, '/autoevaluacion');
  r = await ir('/empresa-activa', { _csrf: token, empresa_id: String(s.b.E), destino: 'https://malo.co' });
  assert.equal(r.location, '/', 'destino externo se ignora');
  r = await ir('/empresa-activa', { _csrf: token, empresa_id: String(s.c.E) });
  assert.equal(r.status, 403, 'empresa ajena');
});
