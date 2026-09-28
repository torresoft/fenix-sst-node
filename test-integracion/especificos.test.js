// Integracion F6: PESV, quimicos e integraciones (nomina, PILA, FURAT).
const test = require('node:test');
const assert = require('node:assert/strict');
const u = require('./_util');
const pesv = require('../src/pesv/servicio');
const quimicos = require('../src/quimicos/servicio');
const integraciones = require('../src/integraciones/servicio');
const contratistas = require('../src/contratistas/servicio');
const eventos = require('../src/eventos/servicio');

const s = {};
const HOY = '2026-09-26';
const rechaza = (p, re) => u.rechaza(assert, p, re);
const archivo = (texto) => ({ originalname: 'prueba.csv', buffer: Buffer.from(texto, 'utf8') });
const obligaciones = async (entidad, id, plazo) => (await s.db.query(
  'SELECT fecha_limite, estado FROM obligacion_pendiente WHERE tenant_id = ? AND entidad_origen_tipo = ? AND entidad_origen_id = ? AND plazo_codigo = ? ORDER BY id',
  [s.T.tenantId, entidad, id, plazo],
))[0];

test.before(async () => {
  Object.assign(s, await u.preparar('F6', { personasN: 2 }));
});
test.after(() => u.cerrar(s));

test('pesv: documentos vencidos bloquean el preoperacional; paso implementado exige evidencia', async () => {
  const v = await pesv.registrarVehiculo(s.repo, s.E, { placa: 'abc-123', tipo: 'camioneta', propiedad: 'propio', soat_vence: '2026-09-01', rtm_vence: '2027-03-01' }, HOY);
  const [soat] = await obligaciones('vehiculo', v, 'VEH_SOAT');
  assert.equal(soat.fecha_limite, '2026-09-01');
  const c = await pesv.registrarConductor(s.repo, s.E, { persona_id: String(s.personas[0]), licencia_numero: '1088123', licencia_categoria: 'b1', licencia_vence: '2029-05-10' }, HOY);
  const todos = pesv.ITEMS.map((_, i) => String(i));
  let r = await pesv.preoperacional(s.repo, s.E, { vehiculo_id: String(v), conductor_id: String(c), fecha: HOY, ok: todos }, HOY);
  assert.deepEqual([r.apto, r.bloqueos], [false, ['SOAT vencido el 2026-09-01']]);
  await pesv.renovarVehiculo(s.repo, s.E, v, { soat_vence: '2027-09-01' }, HOY);
  assert.deepEqual((await obligaciones('vehiculo', v, 'VEH_SOAT')).map((o) => o.estado), ['cumplido', 'en_termino']);
  r = await pesv.preoperacional(s.repo, s.E, { vehiculo_id: String(v), conductor_id: String(c), fecha: HOY, ok: todos }, HOY);
  assert.equal(r.apto, true);
  await rechaza(s.db.query('UPDATE preoperacional SET apto = 1 WHERE vehiculo_id = ?', [v]), /inmutable/);

  await rechaza(pesv.registrarAvance(s.repo, s.E, { paso_codigo: 'P03', estado: 'implementado' }, HOY), /evidencia/);
  const doc = await u.documentoVigente(s.repo, s.E, 'EVIDENCIA_PESV', 'PESV-P03');
  await pesv.registrarAvance(s.repo, s.E, { paso_codigo: 'P03', estado: 'implementado', documento_id: String(doc) }, HOY);
  await pesv.registrarAvance(s.repo, s.E, { paso_codigo: 'P15', estado: 'no_aplica', observacion: 'La empresa no administra vias internas' }, HOY);
  const av = await pesv.avance(s.repo, s.E);
  assert.equal(av.porcentaje, '4.35', '1 de 23 pasos aplicables');
  const p = await pesv.panel(s.repo, s.E, HOY);
  assert.equal(p.obligatorio, false);
});

test('quimicos: FDS con vencimiento de 5 anios desde el catalogo', async () => {
  await rechaza(quimicos.registrar(s.repo, s.E, { nombre: 'Thinner', uso: 'Limpieza de piezas' }), /obligatorios/);
  const fds = await u.documentoVigente(s.repo, s.E, 'FDS', 'FDS-THINNER');
  const id = await quimicos.registrar(s.repo, s.E, {
    nombre: 'Thinner', uso: 'Limpieza de piezas', ubicacion: 'Taller', pictograma: ['GHS02', 'GHS07', 'GHS99'], fds_documento_id: String(fds),
  }, HOY);
  assert.deepEqual((await obligaciones('producto_quimico', id, 'FDS_SGA')).map((o) => o.fecha_limite), ['2031-01-15']);
  const inv = await quimicos.inventario(s.repo, s.E);
  assert.deepEqual(inv.productos[0].pictogramas, ['GHS02', 'GHS07']);
  assert.deepEqual([inv.resumen.sinFds, inv.resumen.sinEtiqueta], [0, 1]);
});

test('nomina: simular no escribe; aplicar crea, reingresa y retira con sus obligaciones', async () => {
  const [p1] = await s.repo.listar('persona', { id: s.personas[1] });
  const texto = [
    'tipo_documento;numero_documento;nombres;apellidos;fecha_ingreso;tipo_vinculacion;cargo;fecha_retiro;motivo_retiro',
    'CC;71000111;Luisa;Nueva;2026-09-21;dependiente;Soldador;;',
    `${p1.tipo_documento};${p1.numero_documento};${p1.nombres};${p1.apellidos};2024-01-10;dependiente;;2026-09-25;Renuncia`,
    'CC;;Sin;Documento;2026-09-21;dependiente;;;',
  ].join('\n');
  const sim = await integraciones.nomina(s.repo, s.E, archivo(texto), { aplicar: false }, HOY);
  assert.deepEqual(sim.map((r) => r.accion), ['crear', 'retirar', 'crear']);
  assert.match(sim[0].advertencia, /Soldador/);
  assert.equal((await s.repo.listar('persona', { numero_documento: '71000111' })).length, 0);

  const res = await integraciones.nomina(s.repo, s.E, archivo(texto), { aplicar: true }, HOY);
  assert.deepEqual(res.map((r) => [r.accion, r.aplicada]), [['crear', true], ['retirar', true], ['error', false]]);
  const [nueva] = await s.repo.listar('persona', { numero_documento: '71000111' });
  const [vn] = await s.repo.listar('vinculacion', { persona_id: nueva.id });
  assert.equal((await obligaciones('vinculacion', vn.id, 'INDUCCION_INGRESO')).length, 1);
  const [vr] = await s.repo.listar('vinculacion', { persona_id: s.personas[1] });
  assert.equal(vr.estado, 'retirada');
  assert.equal((await obligaciones('vinculacion', vr.id, 'EXAMEN_EGRESO')).length, 1);
  const hist = await integraciones.historial(s.repo, s.E);
  assert.deepEqual([hist[0].tipo, hist[0].filas, hist[0].aplicadas], ['nomina', 3, 2]);
  const again = await integraciones.nomina(s.repo, s.E, archivo(texto), { aplicar: false }, HOY);
  assert.deepEqual(again.slice(0, 2).map((r) => r.accion), ['omitir', 'omitir'], 'idempotente');
});

test('pila: lote contra contratistas; inconsistencia de clase', async () => {
  const c = await contratistas.crear(s.repo, s.E, { nit: '900555111', razon_social: 'Andamios SAS', actividad: 'Montaje de andamios', clase_riesgo: 'V' });
  await contratistas.evaluar(s.repo, s.E, c, { tipo: 'seleccion', cumple: ['0', '1', '2', '3', '4', '5', '6', '7', '8'] }, HOY);
  // Solo una vinculacion tipo contratista entra como trabajador del contratista.
  await rechaza(contratistas.vincularTrabajador(s.repo, s.E, c, { persona_id: String(s.personas[0]) }, HOY), /tipo contratista/);
  await s.db.query("UPDATE vinculacion SET tipo = 'contratista' WHERE persona_id = ?", [s.personas[0]]);
  await contratistas.vincularTrabajador(s.repo, s.E, c, { persona_id: String(s.personas[0]) }, HOY);
  const [p0] = await s.repo.listar('persona', { id: s.personas[0] });
  const texto = [
    'numero_documento,nit_contratista,periodo,planilla,arl,fecha_pago,clase_riesgo',
    `${p0.numero_documento},900.555.111,2026-08,111,ARL Sura,2026-09-04,V`,
    `${p0.numero_documento},900555111,2026-07,110,ARL Sura,2026-08-04,iii`,
    '999,900555111,2026-08,112,ARL Sura,2026-09-04,V',
  ].join('\n');
  const r = await integraciones.pila(s.repo, s.E, archivo(texto), { aplicar: true }, HOY);
  assert.deepEqual(r.map((x) => x.resultado), ['conforme', 'inconsistente', 'error']);
  const [[n]] = await s.db.query('SELECT COUNT(*) AS n FROM sgrl_verificacion WHERE contratista_id = ?', [c]);
  assert.equal(Number(n.n), 2);
});

test('furat: CSV con datos del empleador, trabajador y evento en hora de Bogota', async () => {
  const id = await eventos.registrar(s.repo, s.E, {
    tipo: 'accidente', gravedad: 'leve', persona_id: String(s.personas[0]), fecha_ocurrencia: '2026-09-24T15:30', descripcion: 'Golpe en la mano con martillo al armar estiba',
  }, HOY);
  const r = await integraciones.furat(s.repo, s.E, id);
  assert.match(r.contenido, /evento;fecha;2026-09-24\r\nevento;hora;15:30/);
  assert.match(r.contenido, /empleador;razon_social;Empresa F6/);
  const ir = await u.clienteHttp(s);
  const d = await ir(`/integraciones/furat/${id}.csv`);
  assert.equal(d.status, 200);
  assert.match(d.tipo, /text\/csv/);
  for (const ruta of ['/pesv', '/pesv?tab=vehiculos', '/pesv?tab=conductores', '/pesv?tab=preoperacional', '/quimicos',
    '/integraciones', '/integraciones?tab=pila', '/integraciones?tab=furat', '/integraciones?tab=cargue', '/integraciones/plantilla/nomina.csv']) {
    assert.equal((await ir(ruta)).status, 200, ruta);
  }
});
