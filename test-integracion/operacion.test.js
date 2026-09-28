// Integracion F5: emergencias, inspecciones, EPP, permisos de alto riesgo y contratistas.
const test = require('node:test');
const assert = require('node:assert/strict');
const u = require('./_util');
const emergencias = require('../src/emergencias/servicio');
const inspecciones = require('../src/inspecciones/servicio');
const epp = require('../src/epp/servicio');
const permisos = require('../src/permisos/servicio');
const contratistas = require('../src/contratistas/servicio');
const capa = require('../src/capa/servicio');
const formacion = require('../src/formacion/servicio');
const salud = require('../src/salud/servicio');
const personas = require('../src/personas/servicio');

const s = {};
const HOY = '2026-09-26';
const rechaza = (p, re) => u.rechaza(assert, p, re);
const obligaciones = async (entidad, id, plazo) => (await s.db.query(
  'SELECT fecha_limite, estado FROM obligacion_pendiente WHERE tenant_id = ? AND entidad_origen_tipo = ? AND entidad_origen_id = ? AND plazo_codigo = ? ORDER BY id',
  [s.T.tenantId, entidad, id, plazo],
))[0];

test.before(async () => {
  Object.assign(s, await u.preparar('F5', { personasN: 3, clase: 'IV' }));
  s.cargo = await personas.guardarCargo(s.repo, s.E, null, { nombre: 'Tecnico de mantenimiento' });
  const [v] = await s.repo.listar('vinculacion', { persona_id: s.personas[0] });
  await personas.reasignar(s.repo, s.E, v.id, { cargo_id: String(s.cargo) });
});
test.after(() => u.cerrar(s));

test('emergencias: equipo con vencimiento, recarga que renueva y simulacro con accion de mejora', async () => {
  const id = await emergencias.registrarEquipo(s.repo, s.E, { tipo_codigo: 'EXTINTOR', codigo: 'EXT-01', ubicacion: 'Bodega', fecha_ultima: '2025-10-01' }, HOY);
  assert.deepEqual((await obligaciones('equipo_emergencia', id, 'EQUIPO_EMERGENCIA')).map((o) => o.fecha_limite), ['2026-10-01']);
  await emergencias.revisarEquipo(s.repo, s.E, id, { tipo: 'recarga', resultado: 'conforme', fecha: '2026-09-20' }, HOY);
  const obs = await obligaciones('equipo_emergencia', id, 'EQUIPO_EMERGENCIA');
  assert.deepEqual(obs.map((o) => [o.fecha_limite, o.estado]), [['2026-10-01', 'cumplido'], ['2027-09-20', 'en_termino']]);
  await rechaza(s.db.query("UPDATE equipo_revision SET resultado = 'no_conforme' WHERE equipo_id = ?", [id]), /inmutable/);

  await rechaza(emergencias.registrarSimulacro(s.repo, s.E, { fecha: '2026-09-10', amenaza: 'Sismo', alcance: 'total', participantes: '25' }, HOY), /evaluacion/);
  const sim = await emergencias.registrarSimulacro(s.repo, s.E, {
    fecha: '2026-09-10', amenaza: 'Sismo', alcance: 'total', participantes: '25', tiempo_evacuacion_seg: '185',
    oportunidades: 'La alarma no se escucha en el mezzanine', accion_descripcion: 'Instalar sirena en el mezzanine',
    responsable_id: String(s.T.usuarioId), fecha_limite: '2026-11-30',
  }, HOY);
  assert.deepEqual((await obligaciones('empresa', s.E, 'SIMULACRO')).map((o) => o.fecha_limite), ['2027-09-10']);
  const [a] = await capa.listar(s.repo, s.E, { estado: 'abierta' });
  assert.deepEqual([a.origen, a.origen_id, a.responsable], ['simulacro', sim, 'Admin F5']);
  await rechaza(s.db.query("UPDATE simulacro SET fortalezas = 'otra' WHERE id = ?", [sim]), /anule/);
  const p = await emergencias.panel(s.repo, s.E, HOY);
  assert.equal(p.resumen.proximoSimulacro.fecha_limite, '2027-09-10');
});

test('inspeccion: hallazgos medios y altos exigen responsable y generan CAPA', async () => {
  const id = await inspecciones.programar(s.repo, s.E, { tipo: 'locativa', area: 'Bodega de repuestos', fecha_programada: '2026-09-20' });
  const d = { fecha_realizada: '2026-09-22', inspector: 'Responsable SST', hallazgo_descripcion: ['Piso con aceite', 'Estanteria sin anclar'], hallazgo_nivel: ['bajo', 'alto'] };
  await rechaza(inspecciones.realizar(s.repo, s.E, id, d, HOY), /responsable/);
  const r = await inspecciones.realizar(s.repo, s.E, id, { ...d, responsable_id: String(s.T.usuarioId), fecha_limite: '2026-10-15' }, HOY);
  assert.deepEqual(r, { hallazgos: 2, acciones: 1 });
  const det = await inspecciones.detalle(s.repo, s.E, id);
  assert.equal(det.hallazgos[1].accion_estado, 'abierta');
  await rechaza(s.db.query("UPDATE inspeccion SET area = 'x' WHERE id = ?", [id]), /no se modifica/);
  await capa.cerrar(s.repo, s.E, det.hallazgos[1].accion_mejora_id, { fecha: '2026-09-25', observacion: 'Estanteria anclada al muro' }, HOY);
  assert.equal((await inspecciones.detalle(s.repo, s.E, id)).hallazgos[1].accion_estado, 'cerrada');
});

test('epp: stock, requisito por cargo, firma electronica del trabajador e inmutabilidad', async () => {
  const el = await epp.crearElemento(s.repo, s.E, { nombre: 'Guantes de vaqueta', especificacion: 'EN 388', vida_util_dias: '90' });
  await epp.ingresar(s.repo, s.E, { elemento_id: String(el), cantidad: '10', fecha: '2026-09-01' }, HOY);
  await epp.guardarRequisito(s.repo, s.E, { cargo_id: String(s.cargo), elemento_id: String(el), cantidad: '2' });
  let m = await epp.matriz(s.repo, s.E, HOY);
  assert.deepEqual(m.filas.map((f) => [f.id, f.estado]), [[s.personas[0], 'sin_entrega']]);

  const base = { persona_id: String(s.personas[0]), elemento_id: String(el), fecha: '2026-09-25', motivo: 'dotacion_inicial', modalidad: 'electronica' };
  await rechaza(epp.entregar(s.repo, s.E, { ...base, cantidad: '20' }, HOY), /usuario/);
  await require('./_util').mismoDocumento(s, s.personas[0], s.T.usuarioId);
  await salud.vincularUsuario(s.repo, s.personas[0], s.T.usuarioId);
  await rechaza(epp.entregar(s.repo, s.E, { ...base, cantidad: '20' }, HOY), /Stock insuficiente/);
  const x = await epp.entregar(s.repo, s.E, { ...base, cantidad: '2' }, HOY);
  const [[fila]] = await s.db.query('SELECT fecha_reposicion, estado FROM epp_entrega WHERE id = ?', [x]);
  assert.deepEqual([fila.fecha_reposicion, fila.estado], ['2026-12-24', 'pendiente_firma']);
  m = await epp.matriz(s.repo, s.E, HOY);
  assert.equal(m.filas[0].estado, 'pendiente_firma');

  await rechaza(epp.firmarEntrega(s.repo, s.T.usuarioId, x, { clave: 'mala', aceptaAcuerdo: true }), /Contrasena/);
  await epp.firmarEntrega(s.repo, s.T.usuarioId, x, { clave: u.CLAVE, aceptaAcuerdo: true, ip: '127.0.0.1' });
  const [[firma]] = await s.db.query("SELECT texto_firmado, metodo_auth FROM firma WHERE entidad = 'epp_entrega' AND entidad_id = ?", [x]);
  assert.match(firma.texto_firmado, /recibo 2 unidad\(es\) de Guantes de vaqueta/);
  assert.equal((await epp.elementos(s.repo, s.E))[0].stock, '8');
  await rechaza(s.db.query('UPDATE epp_entrega SET cantidad = 1 WHERE id = ?', [x]), /no se modifica/);
  assert.equal((await epp.matriz(s.repo, s.E, HOY)).filas[0].estado, 'al_dia');
});

test('permiso de alturas: bloquea al ejecutor sin certificacion ni aptitud; foto de la verificacion', async () => {
  const P0 = s.personas[0];
  const P1 = s.personas[1];
  await formacion.registrarCompetencia(s.repo, s.E, P0, { tipo: 'INDUCCION', fecha_obtencion: '2024-01-10' }, HOY);
  const cert = await u.documentoVigente(s.repo, s.E, 'REG_CAPACITACION', 'CERT-ALT-1', { persona_id: String(P0) });
  await formacion.registrarCompetencia(s.repo, s.E, P0, { tipo: 'ALTURAS', fecha_obtencion: '2026-03-01', documento_id: String(cert) }, HOY);
  const orden = await salud.ordenar(s.repo, s.E, { persona_id: String(P0), tipo: 'periodico', ips: 'IPS Pereira', fecha_orden: '2026-08-01' });
  const doc = await u.documentoVigente(s.repo, s.E, 'CONCEPTO_APTITUD', 'CA-F5', { persona_id: String(P0), modalidad_firma: 'digital_externa', firmantes_externos: 'Medico IPS' });
  await salud.registrarConcepto(s.repo, s.E, orden, { concepto: 'apto', fecha_examen: '2026-08-05', proximo_examen: '2027-08-05', documento_id: String(doc) }, HOY);

  const d = {
    tipo_codigo: 'alturas', fecha: '2026-09-28', hora_inicio: '08:00', hora_fin: '12:00', lugar: 'Cubierta bodega 2', supervisor: 'Coordinador de alturas',
    tarea: 'Cambio de tejas traslucidas', ats: 'Caida de altura: linea de vida certificada, arnes y eslinga con absorbedor; caida de objetos: area demarcada',
    verificacion: ['0', '1', '2', '3', '4', '5'], ejecutor: [String(P0), String(P1)],
  };
  await rechaza(permisos.emitir(s.repo, s.E, d, HOY), /Persona2 F5: Sin Certificacion de trabajo en alturas vigente, Sin concepto de aptitud medica, Sin induccion/);
  await rechaza(permisos.emitir(s.repo, s.E, { ...d, ejecutor: [String(P0)], verificacion: ['0', '1'] }, HOY), /Verificacion previa incompleta/);
  const id = s.permiso = await permisos.emitir(s.repo, s.E, { ...d, ejecutor: [String(P0)] }, HOY);
  const det = await permisos.detalle(s.repo, s.E, id);
  assert.equal(det.permiso.numero, 'PT-2026-0001');
  assert.equal(det.ejecutores[0].verificacion.ok, true);
  assert.match(det.ejecutores[0].verificacion.aptitud.detalle, /apto del 2026-08-05/);
  await rechaza(s.db.query("UPDATE permiso_ejecutor SET verificacion = '{}' WHERE permiso_id = ?", [id]), /inmutable/);
  await permisos.cambiarEstado(s.repo, s.E, id, 'cerrado', 'Trabajo terminado sin novedad');
  await rechaza(permisos.cambiarEstado(s.repo, s.E, id, 'anulado', 'Por error'), /No se puede pasar/);
});

test('contratista: evaluacion, trabajadores y verificacion de la clase de riesgo', async () => {
  const id = s.contratista = await contratistas.crear(s.repo, s.E, { nit: '900.123.456', razon_social: 'Montajes SAS', actividad: 'Montaje de estructuras metalicas', clase_riesgo: 'IV' });
  const trabajador = await personas.crear(s.repo, s.E, {
    tipo_documento: 'CC', numero_documento: '10203040', nombres: 'Carlos', apellidos: 'Montajes', vincular: '1', tipo: 'contratista',
    fecha_ingreso: '2026-09-01', centro_trabajo_id: String(s.centro.id),
  });
  await rechaza(contratistas.vincularTrabajador(s.repo, s.E, id, { persona_id: String(trabajador) }, HOY), /aprobado o condicionado/);
  const r = await contratistas.evaluar(s.repo, s.E, id, { tipo: 'seleccion', fecha: '2026-09-02', cumple: ['0', '1', '2', '3', '4', '5', '6', '7'] }, HOY);
  assert.deepEqual(r, { puntaje: '88.89', resultado: 'aprobado' });
  await contratistas.vincularTrabajador(s.repo, s.E, id, { persona_id: String(trabajador), fecha_ingreso: '2026-09-03' }, HOY);
  const v = await contratistas.verificarSgrl(s.repo, s.E, id, {
    persona_id: String(trabajador), periodo: '2026-08', planilla: '9876543', arl: 'ARL Colmena', fecha_pago: '2026-09-05', clase_cotizada: 'I',
  }, HOY);
  assert.equal(v.resultado, 'inconsistente');
  const det = await contratistas.detalle(s.repo, s.E, id, HOY);
  assert.deepEqual([det.resumen.activos, det.resumen.sinInduccion, det.resumen.sinVerificacion], [1, 1, 0]);
  assert.match(det.verificaciones[0].observacion, /clase I y la actividad es clase IV/);
  const [[ev]] = await s.db.query('SELECT puntaje FROM contratista_evaluacion WHERE contratista_id = ?', [id]);
  assert.equal(ev.puntaje, '88.89');
});

test('http: paginas de F5 y CAPA', async () => {
  const ir = await u.clienteHttp(s);
  for (const ruta of ['/emergencias?tab=equipos', '/emergencias?tab=simulacros', '/inspecciones', '/epp', '/epp?tab=entregas', '/epp?tab=elementos',
    '/permisos', `/permisos/${s.permiso}`, '/contratistas', `/contratistas/${s.contratista}?tab=sgrl`, '/acciones?estado=cerrada', '/mis-registros?tab=epp']) {
    const r = await ir(ruta);
    assert.equal(r.status, 200, ruta);
  }
  const r = await ir('/acciones?estado=abierta');
  assert.match(r.texto, /Instalar sirena en el mezzanine/);
});
