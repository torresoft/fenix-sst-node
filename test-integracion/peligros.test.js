// Integracion M05 contra MariaDB real.
const test = require('node:test');
const assert = require('node:assert/strict');
const u = require('./_util');
const personas = require('../src/personas/servicio');
const eventos = require('../src/eventos/servicio');
const pel = require('../src/peligros/servicio');

const s = {};
const rechaza = (p, re) => u.rechaza(assert, p, re);
const HOY = '2026-09-26';
const item = (x = {}) => ({ proceso: 'Mantenimiento', actividad: 'Reparacion de cubiertas', clase_peligro: 'SEGURIDAD', peligro: 'Trabajo en alturas', nd: 'MA', ne: 'EF', nc: 'M', expuestos: 3, ...x });

test.before(async () => {
  Object.assign(s, await u.preparar('M05'));
  s.cargo = await personas.guardarCargo(s.repo, s.E, null, { nombre: 'Tecnico de mantenimiento' });
  s.at = await eventos.registrar(s.repo, s.E, {
    tipo: 'accidente', gravedad: 'mortal', persona_id: String(s.personas[0]), fecha_ocurrencia: '2026-09-20T09:00', descripcion: 'Caida desde cubierta sin linea de vida',
  }, '2026-09-26T12:00');
});
test.after(() => u.cerrar(s));

test('version inicial: valoracion GTC 45 calculada en el servidor y cargos expuestos', async () => {
  s.m1 = await pel.crearVersion(s.repo, s.E, { motivo: 'inicial', metodologia_codigo: 'GTC45' }, HOY);
  await rechaza(pel.crearVersion(s.repo, s.E, { motivo: 'anual' }, HOY), /borrador/);
  const r = await pel.guardarItem(s.repo, s.E, s.m1, null, item({ cargos: [String(s.cargo)] }));
  assert.deepEqual([r.np, r.nr, r.nivel_riesgo], [30, 3000, 'I']);
  s.item = r.id;
  await pel.guardarItem(s.repo, s.E, s.m1, null, item({ peligro: 'Ruido de compresor', clase_peligro: 'FISICO', nd: 'M', ne: 'EO', nc: 'L' }));
  await rechaza(pel.guardarItem(s.repo, s.E, s.m1, null, item({ nd: 'X' })), /deficiencia/);
  const d = await pel.detalle(s.repo, s.E, s.m1);
  assert.deepEqual(d.conteo, { I: 1, II: 0, III: 1, IV: 0 }, 'ruido: 2 x 2 x 10 = 40, nivel III');
  assert.equal(d.items.find((i) => i.id === s.item).cargos[0].nombre, 'Tecnico de mantenimiento');
  assert.equal(d.avisos.length, 1, 'riesgo I sin medidas');
});

test('jerarquia: solo EPP no basta para un riesgo I', async () => {
  await pel.agregarControl(s.repo, s.E, s.item, { jerarquia_codigo: 'epp', descripcion: 'Arnes de cuerpo completo' });
  let d = await pel.detalle(s.repo, s.E, s.m1);
  assert.match(d.avisos[0].texto, /ingenieria/);
  await pel.agregarControl(s.repo, s.E, s.item, { jerarquia_codigo: 'ingenieria', descripcion: 'Instalar linea de vida horizontal certificada' });
  d = await pel.detalle(s.repo, s.E, s.m1);
  assert.deepEqual(d.avisos, []);
});

test('publicar exige participacion y documento firmado; cumple la actualizacion por AT mortal', async () => {
  await rechaza(pel.publicar(s.repo, s.E, s.m1, HOY), /participacion/);
  const doc = await u.documentoVigente(s.repo, s.E, 'MATRIZ_PELIGROS', 'MP-2026');
  await pel.guardarDatos(s.repo, s.E, s.m1, { participantes: 'COPASST en sesion del 2026-09-24', documento_id: String(doc) });
  const n = await pel.publicar(s.repo, s.E, s.m1, HOY);
  assert.equal(n, 1);
  const [[o]] = await s.db.query("SELECT estado FROM obligacion_pendiente WHERE entidad_origen_id = ? AND plazo_codigo = 'MATRIZ_AT_MORTAL'", [s.at]);
  assert.equal(o.estado, 'cumplido');
  await rechaza(pel.guardarItem(s.repo, s.E, s.m1, s.item, item()), /borrador/);
  await rechaza(s.db.query("UPDATE riesgo_item SET peligro = 'x' WHERE id = ?", [s.item]), /version nueva/);
  const porCargo = await pel.peligrosPorCargo(s.repo, s.E);
  assert.equal(porCargo[0].peligro, 'Trabajo en alturas');
});

test('nueva version copia peligros y cargos; al publicar reemplaza la anterior', async () => {
  const m2 = await pel.crearVersion(s.repo, s.E, { motivo: 'anual', metodologia_codigo: 'GTC45' }, HOY);
  const d = await pel.detalle(s.repo, s.E, m2);
  assert.equal(d.items.length, 2);
  assert.equal(d.items.find((i) => i.peligro === 'Trabajo en alturas').cargos.length, 1);
  const copia = d.items.find((i) => i.peligro === 'Trabajo en alturas');
  await pel.guardarItem(s.repo, s.E, m2, copia.id, item({ nd: 'M', cargos: [] }));
  const d2 = await pel.detalle(s.repo, s.E, m2);
  assert.equal(d2.items.find((i) => i.id === copia.id).cargos.length, 0, 'cargo retirado, no borrado');
  const doc = await u.documentoVigente(s.repo, s.E, 'MATRIZ_PELIGROS', 'MP-2026-B');
  await pel.guardarDatos(s.repo, s.E, m2, { participantes: 'COPASST', documento_id: String(doc) });
  await pel.publicar(s.repo, s.E, m2, HOY);
  const [[v1]] = await s.db.query('SELECT estado FROM matriz_riesgo WHERE id = ?', [s.m1]);
  assert.equal(v1.estado, 'reemplazada');
  s.m2 = m2;
});

test('http: matriz, formulario de peligro y CSV', async () => {
  const ir = s.ir || (s.ir = await u.clienteHttp(s));
  let r = await ir('/peligros');
  assert.equal(r.location, `/peligros/${s.m2}`);
  r = await ir(`/peligros/${s.m2}`);
  assert.equal(r.status, 200);
  assert.match(r.texto, /Trabajo en alturas/);
  r = await ir(`/peligros/${s.m2}/csv`);
  assert.match(r.tipo, /text\/csv/);
  assert.match(r.texto, /Trabajo en alturas/);
});

test('sugerencias: cargo tipo propone peligros marcados como sugeridos y el perfil muestra brechas', async () => {
  const perfil = require('../src/peligros/perfil');
  const cargo = await perfil.guardarCargo(s.repo, s.E, null, { nombre: 'Electricista de planta', cargo_tipo_codigo: 'ELECTRICISTA' });
  const [comp] = await s.db.query("SELECT GROUP_CONCAT(competencia ORDER BY competencia) AS c FROM cargo_competencia WHERE cargo_id = ? AND estado = 'activo'", [cargo]);
  assert.equal(comp[0].c, 'ALTURAS,ELECTRICO', 'hereda competencias del cargo tipo');
  assert.equal(await perfil.crearDesdeTipos(s.repo, s.E, ['ADMINISTRATIVO', 'ELECTRICISTA']), 2);
  assert.equal(await perfil.crearDesdeTipos(s.repo, s.E, ['ADMINISTRATIVO']), 0, 'no duplica por nombre');

  const m3 = await pel.crearVersion(s.repo, s.E, { motivo: 'cambio', metodologia_codigo: 'GTC45' }, HOY);
  const r = await pel.generarDesdeCargos(s.repo, s.E, m3, { cargos: [String(cargo), String(s.cargo)], [`tipo_${s.cargo}`]: 'MANTENIMIENTO', [`proceso_${cargo}`]: 'Mantenimiento' });
  assert.ok(r.nuevos >= 10);
  const [[tc]] = await s.db.query('SELECT cargo_tipo_codigo FROM cargo WHERE id = ?', [s.cargo]);
  assert.equal(tc.cargo_tipo_codigo, 'MANTENIMIENTO', 'el tipo elegido queda en el cargo');
  const otra = await pel.generarDesdeCargos(s.repo, s.E, m3, { cargos: [String(cargo)], [`proceso_${cargo}`]: 'Mantenimiento' });
  assert.equal(otra.nuevos, 0, 'idempotente');

  let d = await pel.detalle(s.repo, s.E, m3);
  const sug = d.items.filter((i) => i.sugerido);
  assert.equal(sug.length, r.nuevos);
  assert.ok(d.impedimentos.some((x) => /sugerido/.test(x)));
  const alturas = sug.find((i) => i.peligro_tipo_codigo === 'SEG_ALTURAS' && i.cargos.some((c) => c.id === cargo));
  assert.equal(alturas.nc, 'M');
  await pel.guardarItem(s.repo, s.E, m3, alturas.id, { ...alturas, cargos: alturas.cargos.map((c) => String(c.id)), medidas_sugeridas: ['1', '2'] });
  d = await pel.detalle(s.repo, s.E, m3);
  const revisado = d.items.find((i) => i.id === alturas.id);
  assert.equal(revisado.sugerido, 0);
  assert.equal(revisado.controles.length, 2, 'medidas del catalogo agregadas como propuestas');

  const p = await perfil.perfil(s.repo, s.E, cargo);
  assert.equal(p.tipo.codigo, 'ELECTRICISTA');
  assert.equal(p.peligros.length, 0, 'aun no hay matriz vigente con el cargo');
  assert.equal(p.brechas.length, p.tipo.peligros.length);
  s.m3 = m3;
  s.cargoElec = cargo;
});

test('http: sugerir, formulario con catalogo y perfil del cargo', async () => {
  const ir = s.ir || (s.ir = await u.clienteHttp(s));
  let r = await ir(`/peligros/${s.m3}/sugerir`);
  assert.equal(r.status, 200);
  assert.match(r.texto, /Electricista de planta/);
  r = await ir(`/peligros/${s.m3}/items/nuevo`);
  assert.match(r.texto, /SEG_ALTURAS/);
  r = await ir(`/personas/cargos/${s.cargoElec}`);
  assert.equal(r.status, 200);
  assert.match(r.texto, /Perfil de riesgo del cargo/);
  r = await ir('/personas/cargos');
  assert.match(r.texto, /Desde cat/);
});
