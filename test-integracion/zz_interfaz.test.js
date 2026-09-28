// Humo de interfaz: todas las opciones del menu responden, menu por PHVA con miga y titulos escapados.
const test = require('node:test');
const assert = require('node:assert/strict');
const u = require('./_util');
const { GRUPOS } = require('../src/comun/menu');
const personas = require('../src/personas/servicio');
const eventos = require('../src/eventos/servicio');

const s = {};

test.before(async () => {
  Object.assign(s, await u.preparar('UI', { personasN: 1 }));
  s.xss = await personas.crear(s.repo, s.E, { tipo_documento: 'CC', numero_documento: '55667788', nombres: '<script>alert(1)</script>', apellidos: 'Prueba' });
  s.doc = await u.documentoVigente(s.repo, s.E, 'POLITICA_SST', 'POL-UI');
  s.evento = await eventos.registrar(s.repo, s.E, {
    tipo: 'accidente', gravedad: 'leve', persona_id: String(s.personas[0]), fecha_ocurrencia: '2026-09-20T09:00', descripcion: 'Resbalon en el pasillo de la bodega',
  }, '2026-09-26T10:00');
  const [ct] = await s.db.query("SELECT id FROM comite WHERE tenant_id = ? LIMIT 1", [s.T.tenantId]);
  s.comite = ct[0] ? ct[0].id : null;
  // Superadmin para recorrer tambien el grupo Plataforma.
  await s.db.query('UPDATE usuario SET es_superadmin = 1 WHERE id = ?', [s.T.usuarioId]);
});
test.after(() => u.cerrar(s));

test('menu completo: cada opcion responde 200 y marca su grupo', async () => {
  const ir = s.ir || (s.ir = await u.clienteHttp(s));
  for (const g of GRUPOS) {
    for (const i of g.items) {
      const r = await ir(i.ruta);
      assert.equal(r.status, 200, i.ruta);
      assert.doesNotMatch(r.texto, /<%|%>/, `EJS sin procesar en ${i.ruta}`);
      if (g.titulo) {
        assert.match(r.texto, new RegExp(`menu-open[\\s\\S]*${g.titulo}`), `grupo abierto en ${i.ruta}`);
        assert.match(r.texto, /breadcrumb-item/, `miga en ${i.ruta}`);
      }
    }
  }
  const inicio = await ir('/');
  assert.match(inicio.texto, /Requiere atenci/);
  assert.match(inicio.texto, /franja-estado/);
});

test('detalles refactorizados en pestanas y titulo con datos del usuario escapado', async () => {
  const ir = s.ir || (s.ir = await u.clienteHttp(s));
  const rutas = [`/documentos/${s.doc}`, `/personas/${s.personas[0]}`, `/eventos/${s.evento}`, '/empresa?tab=clasificacion', '/matriz-legal', '/obligaciones'];
  if (s.comite) rutas.push(`/comites/${s.comite}`);
  for (const ruta of rutas) {
    const r = await ir(ruta);
    assert.equal(r.status, 200, ruta);
    assert.match(r.texto, /nav-tabs/, `pestanas en ${ruta}`);
  }
  const r = await ir(`/personas/${s.xss}`);
  assert.equal(r.status, 200);
  assert.doesNotMatch(r.texto, /<script>alert\(1\)<\/script>/);
  assert.match(r.texto, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
});
