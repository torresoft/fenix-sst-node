// Integracion de la consola de plataforma (superadmin).
const test = require('node:test');
const assert = require('node:assert/strict');
const u = require('./_util');
const plataforma = require('../src/plataforma/servicio');

const s = {};
const rechaza = (p, re) => u.rechaza(assert, p, re);
const actor = () => ({ id: s.T.usuarioId, nombre: 'Superadmin' });

test.before(async () => { Object.assign(s, await u.preparar('PLAT')); });
test.after(() => u.cerrar(s));

test('alta de cliente con administrador nuevo y cuenta existente', async () => {
  const r = await plataforma.crearCliente({
    tenant: 'Cliente Pereira', nit: '900123456', email: 'admin@clientepereira.co', nombres: 'Ana', apellidos: 'Gil', tipo_documento: 'CC', numero_documento: '10000001',
  });
  assert.ok(r.temporal);
  const r2 = await plataforma.crearCliente({ tenant: 'Otro cliente', nit: '900123457', email: 'admin@clientepereira.co' });
  assert.equal(r2.temporal, null, 'cuenta existente conserva su clave');
  assert.equal(r2.usuarioId, r.usuarioId);
  await rechaza(plataforma.crearCliente({ tenant: 'X', nit: '12', email: 'x@x.co' }), /NIT/);
  s.cliente = r;
});

test('suspender cliente y soporte de cuentas', async () => {
  await plataforma.cambiarEstadoCliente(s.cliente.tenantId, 'suspendido', actor());
  const [[t]] = await s.db.query('SELECT estado FROM tenant WHERE id = ?', [s.cliente.tenantId]);
  assert.equal(t.estado, 'suspendido');
  await s.db.query('UPDATE usuario SET bloqueado_hasta = NOW() + INTERVAL 1 HOUR WHERE id = ?', [s.cliente.usuarioId]);
  await plataforma.desbloquear(s.cliente.usuarioId, actor());
  const r = await plataforma.restablecerClave(s.cliente.usuarioId, actor());
  assert.ok(r.temporal);
  const d = await plataforma.usuario(s.cliente.usuarioId);
  assert.equal(Number(d.u.bloqueado), 0);
  assert.equal(d.u.debe_cambiar_password, 1);
  assert.equal(d.accesos.length, 2);
  await rechaza(plataforma.cambiarEstadoUsuario(s.T.usuarioId, false, actor()), /propia/);
  await plataforma.cambiarEstadoUsuario(s.cliente.usuarioId, false, actor());
  assert.equal((await plataforma.usuario(s.cliente.usuarioId)).u.estado, 'inactivo');
});

test('ficha del cliente: editar, retirar con motivo y administradores', async () => {
  const id = s.cliente.tenantId;
  await plataforma.editarCliente(id, { nombre: 'Cliente Pereira SAS', plan: 'COMPLETO', region_datos: 'co-bogota' }, actor());
  await rechaza(plataforma.editarCliente(id, { nombre: 'X', region_datos: 'Bogota D.C.' }, actor()), /Region/);
  await rechaza(plataforma.cambiarEstadoCliente(id, 'retirado', actor(), 'corto'), /motivo/);
  await plataforma.cambiarEstadoCliente(id, 'retirado', actor(), 'Terminacion del contrato de servicio');
  await rechaza(plataforma.cambiarEstadoCliente(id, 'retirado', actor(), 'Terminacion del contrato de servicio'), /ya esta/);
  await plataforma.cambiarEstadoCliente(id, 'activo', actor());
  const [[au]] = await s.db.query("SELECT JSON_VALUE(despues, '$.motivo') AS m FROM auditoria_log WHERE entidad = 'tenant' AND entidad_id = ? AND accion = 'retirar'", [id]);
  assert.match(au.m, /contrato/);

  // El unico admin (inactivado arriba) no se puede quitar sin dejar otro.
  await rechaza(plataforma.quitarAdmin(id, s.cliente.usuarioId, actor()), /al menos un administrador/);
  const nuevo = await plataforma.asignarAdmin(id, { email: 'nuevo.admin@clientepereira.co', nombres: 'Luis', apellidos: 'Mora', tipo_documento: 'CC', numero_documento: '10000002' }, actor());
  assert.ok(nuevo.temporal);
  const existente = await plataforma.asignarAdmin(id, { email: s.email }, actor());
  assert.equal(existente.existente, true);
  await plataforma.quitarAdmin(id, s.cliente.usuarioId, actor());
  const d = await plataforma.fichaCliente(id, actor());
  assert.equal(d.t.nombre, 'Cliente Pereira SAS');
  assert.equal(d.admins, 2);
  assert.equal(d.empresas.length, 1);
  const [[log]] = await s.db.query("SELECT COUNT(*) AS n FROM auditoria_log WHERE tenant_id = ? AND actor_id = ? AND entidad = 'usuario_tenant'", [id, s.T.usuarioId]);
  assert.ok(log.n > 0, 'cambios de roles auditados en el tenant a nombre del superadmin');
  s.clienteId = id;
});

test('http: solo el superadmin entra a /plataforma (se verifica en BD en cada peticion)', async () => {
  await s.db.query('UPDATE usuario SET es_superadmin = 1 WHERE id = ?', [s.T.usuarioId]);
  const ir = s.ir || (s.ir = await u.clienteHttp(s));
  let r = await ir('/plataforma/clientes');
  assert.equal(r.status, 200);
  assert.match(r.texto, /Cliente Pereira/);
  r = await ir('/plataforma/usuarios?q=clientepereira');
  assert.match(r.texto, /admin@clientepereira.co/);
  r = await ir(`/plataforma/usuarios/${s.cliente.usuarioId}`);
  assert.equal(r.status, 200);
  r = await ir(`/plataforma/clientes/${s.clienteId}`);
  assert.equal(r.status, 200);
  assert.match(r.texto, /Cliente Pereira SAS/);
  assert.match(r.texto, /nuevo.admin@clientepereira.co/);
  await s.db.query('UPDATE usuario SET es_superadmin = 0 WHERE id = ?', [s.T.usuarioId]);
  r = await ir('/plataforma/clientes');
  assert.equal(r.status, 403);
});

test('catalogos: edicion protegida del seed, boletin de norma, festivos en memoria y validacion de JSON', async () => {
  const cat = require('../src/plataforma/catalogos');
  const fechas = require('../src/fechas');
  const sa = { id: s.T.usuarioId, nombre: 'Superadmin' };

  const n = await cat.formulario('norma', 'RES-2646-2008');
  const r = await cat.guardar('norma', 'RES-2646-2008', { ...n.fila, modulos: JSON.stringify(n.fila.modulos), estado_vigencia: 'derogada', derogada_por: 'RES-2764-2022' }, sa);
  assert.equal(r.boletines, 1, 'cambio de vigencia genera boletin');
  const [[nm]] = await s.db.query("SELECT modificado_manual, actualizado_por FROM norma WHERE codigo = 'RES-2646-2008'");
  assert.deepEqual([nm.modificado_manual, nm.actualizado_por], [1, s.T.usuarioId]);
  assert.equal((await cat.guardar('norma', 'RES-2646-2008', { ...n.fila, modulos: JSON.stringify(n.fila.modulos), estado_vigencia: 'derogada', derogada_por: 'RES-2764-2022' }, sa)).sinCambios, true);

  assert.equal(fechas.esHabil('2031-03-04'), true);
  await cat.guardar('festivo', null, { fecha: '2031-03-04', nombre: 'Festivo de prueba' }, sa);
  assert.equal(fechas.esHabil('2031-03-04'), false, 'calendario recargado');
  await cat.cambiarEstado('festivo', '2031-03-04', false, sa);
  assert.equal(fechas.esHabil('2031-03-04'), true);

  await rechaza(cat.guardar('cargo_tipo', null, { codigo: 'X', nombre: 'X', peligros: '[{"peligro":"NO_EXISTE","ne":"EC"}]', competencias: '[]' }, sa), /peligros/);
  await rechaza(cat.guardar('peligro_tipo', 'SEG_ALTURAS', { clase_codigo: 'SEGURIDAD', nombre: 'Alturas', controles: '[{"jerarquia":"magia","descripcion":"x"}]' }, sa), /controles/);
  await rechaza(cat.guardar('festivo', null, { fecha: '2031-03-04', nombre: 'Duplicado' }, sa), /Ya existe/);
  await rechaza(cat.formulario('estandar_minimo', null), /no administrable/);

  await cat.restaurar('norma', 'RES-2646-2008', sa);
  const [[nr]] = await s.db.query("SELECT modificado_manual FROM norma WHERE codigo = 'RES-2646-2008'");
  assert.equal(nr.modificado_manual, 0);
});

test('http: catalogos listan y abren el formulario de cada tabla', async () => {
  await s.db.query('UPDATE usuario SET es_superadmin = 1 WHERE id = ?', [s.T.usuarioId]);
  const cat = require('../src/plataforma/catalogos');
  const ir = s.ir || (s.ir = await u.clienteHttp(s));
  let r = await ir('/plataforma/catalogos');
  assert.equal(r.status, 200);
  for (const c of cat.CATALOGOS) {
    r = await ir(`/plataforma/catalogos/${c.tabla}`);
    assert.equal(r.status, 200, c.tabla);
    const primero = /editar\?c=([^"]+)"/.exec(r.texto);
    r = await ir(`/plataforma/catalogos/${c.tabla}/editar${primero ? `?c=${primero[1]}` : ''}`);
    assert.equal(r.status, 200, `formulario ${c.tabla}`);
    assert.doesNotMatch(r.texto, /<%|%>/);
  }
  r = await ir('/plataforma/catalogos/festivo/editar');
  const token = ir.token(r.texto);
  r = await ir('/plataforma/catalogos/peligro_clase/guardar', { _csrf: token, c: '', codigo: 'ERGO_X', nombre: 'Prueba', ejemplos: '' });
  assert.equal(r.location, '/plataforma/catalogos/peligro_clase');
  r = await ir('/plataforma/catalogos/peligro_tipo/guardar', { _csrf: token, c: '', codigo: 'PT_X', clase_codigo: 'NO_EXISTE', nombre: 'x', controles: '[]' });
  assert.equal(r.status, 422, 'FK invalida vuelve al formulario');
});
