// Integracion M06 contra MariaDB real.
const test = require('node:test');
const assert = require('node:assert/strict');
const u = require('./_util');
const eventos = require('../src/eventos/servicio');
const plan = require('../src/planeacion/servicio');

const s = {};
const rechaza = (p, re) => u.rechaza(assert, p, re);
const HOY = '2026-09-26';

test.before(async () => {
  Object.assign(s, await u.preparar('M06', { personasN: 1 }));
  s.ev = await eventos.registrar(s.repo, s.E, {
    tipo: 'accidente', gravedad: 'leve', persona_id: String(s.personas[0]), fecha_ocurrencia: '2026-09-10T08:00', descripcion: 'Golpe en la mano con herramienta manual',
  }, '2026-09-26T10:00');
  await eventos.crearAccion(s.repo, s.E, s.ev, { descripcion: 'Dotar de guantes de alta resistencia', tipo: 'correctiva', responsable_id: String(s.T.usuarioId), fecha_limite: '2026-10-30' }, HOY);
});
test.after(() => u.cerrar(s));

test('plan: objetivos, actividades con presupuesto y aprobacion con documento firmado', async () => {
  s.plan = await plan.crear(s.repo, s.E, { vigencia_anio: '2026', presupuesto_total: '5000000' });
  await rechaza(plan.crear(s.repo, s.E, { vigencia_anio: '2026' }), /Ya existe/);
  await plan.agregarObjetivo(s.repo, s.E, s.plan, { descripcion: 'Reducir la accidentalidad', meta: 'Frecuencia menor a 2%', indicador_codigo: 'FREC_AT' });
  await plan.agregarActividad(s.repo, s.E, s.plan, { descripcion: 'Inspecciones planeadas trimestrales', ciclo: 'HACER', responsable_id: String(s.T.usuarioId), fecha_inicio: '2026-01-15', fecha_fin: '2026-03-31', presupuesto: '1200000.50' });
  await plan.agregarActividad(s.repo, s.E, s.plan, { descripcion: 'Simulacro anual de evacuacion', ciclo: 'HACER', responsable_texto: 'Brigada', fecha_inicio: '2026-10-01', fecha_fin: '2026-10-31', presupuesto: '800000' });
  await rechaza(plan.agregarActividad(s.repo, s.E, s.plan, { descripcion: 'Fuera de vigencia', ciclo: 'HACER', responsable_texto: 'X', fecha_inicio: '2027-02-01', fecha_fin: '2027-03-01' }), /vigencia/);
  let d = await plan.detalle(s.repo, s.E, s.plan, HOY);
  assert.deepEqual(d.impedimentos, ['Asocie el plan firmado por el representante legal (documento PLAN_ANUAL vigente)']);
  const doc = await u.documentoVigente(s.repo, s.E, 'PLAN_ANUAL', 'PLAN-2026');
  await plan.aprobar(s.repo, s.E, s.plan, { documento_id: String(doc) }, HOY);
  d = await plan.detalle(s.repo, s.E, s.plan, HOY);
  assert.equal(d.p.estado, 'aprobado');
  assert.deepEqual([d.avance.vencidas, d.avance.cumplimiento_corte, d.avance.presupuesto_programado], [1, 0, '2000000.50']);
  await rechaza(s.db.query('UPDATE plan_anual SET documento_id = NULL WHERE id = ?', [s.plan]), /inmutables/);
});

test('ejecutar actividad; importar CAPA y cerrarla desde el cronograma', async () => {
  const d = await plan.detalle(s.repo, s.E, s.plan, HOY);
  assert.equal(d.capaPendientes.length, 1);
  const insp = d.actividades.find((a) => a.descripcion.startsWith('Inspecciones'));
  await plan.cerrarActividad(s.repo, s.E, insp.id, { accion: 'ejecutar', fecha: '2026-03-28', observacion: 'Tres inspecciones realizadas' }, HOY);
  assert.equal(await plan.importarCapa(s.repo, s.E, s.plan), 1);
  assert.equal(await plan.importarCapa(s.repo, s.E, s.plan), 0, 'no duplica');
  const d2 = await plan.detalle(s.repo, s.E, s.plan, HOY);
  assert.equal(d2.avance.cumplimiento_corte, 100);
  const capa = d2.actividades.find((a) => a.origen === 'capa');
  await plan.cerrarActividad(s.repo, s.E, capa.id, { accion: 'ejecutar', fecha: HOY, observacion: 'Guantes entregados' }, HOY);
  const [[a]] = await s.db.query("SELECT estado FROM accion_mejora WHERE origen = 'evento' AND origen_id = ?", [s.ev]);
  assert.equal(a.estado, 'cerrada', 'la accion de mejora se cierra junto con la actividad');
  await rechaza(plan.cerrarActividad(s.repo, s.E, capa.id, { accion: 'ejecutar', observacion: 'otra vez' }, HOY), /cerrada/);
});

test('gestion del cambio: sin evaluacion de impacto no se aprueba', async () => {
  const c = await plan.registrarCambio(s.repo, s.E, { tipo: 'maquinaria', descripcion: 'Nueva prensa hidraulica en linea 2', fecha_prevista: '2026-11-15' });
  await rechaza(plan.avanzarCambio(s.repo, s.E, c, { accion: 'aprobar' }, HOY), /impacto en SST/);
  await plan.avanzarCambio(s.repo, s.E, c, { accion: 'aprobar', impacto_sst: 'Nuevo peligro de atrapamiento; requiere guardas y capacitacion', actualiza_peligros: '1', requiere_capacitacion: '1' }, HOY);
  await plan.avanzarCambio(s.repo, s.E, c, { accion: 'implementar', observacion: 'Instalada con guardas' }, HOY);
  await rechaza(plan.avanzarCambio(s.repo, s.E, c, { accion: 'rechazar' }, HOY), /cerrado/);
});

test('http: plan y gestion del cambio', async () => {
  const ir = await u.clienteHttp(s);
  let r = await ir('/planeacion');
  assert.equal(r.status, 200);
  assert.match(r.texto, /Simulacro anual/);
  r = await ir('/planeacion?tab=cambios');
  assert.match(r.texto, /Nueva prensa/);
});
