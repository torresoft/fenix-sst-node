// Integracion M12 contra MariaDB real.
const test = require('node:test');
const assert = require('node:assert/strict');
const u = require('./_util');
const eventos = require('../src/eventos/servicio');
const salud = require('../src/salud/servicio');
const ind = require('../src/indicadores/servicio');

const s = {};
const rechaza = (p, re) => u.rechaza(assert, p, re);
const vigente = async (codigo, periodo) => (await s.db.query(
  "SELECT numerador, denominador, valor, estado FROM indicador_medicion WHERE empresa_id = ? AND indicador_codigo = ? AND periodo = ? ORDER BY id", [s.E, codigo, periodo],
))[0];

test.before(async () => {
  Object.assign(s, await u.preparar('M12', { personasN: 4 }));
  await eventos.registrar(s.repo, s.E, {
    tipo: 'accidente', gravedad: 'leve', persona_id: String(s.personas[0]), fecha_ocurrencia: '2026-09-03T08:00', descripcion: 'Torcedura de tobillo en escalera de bodega',
    dias_incapacidad: '6',
  }, '2026-09-26T10:00');
  await salud.registrarIncapacidad(s.repo, s.E, { persona_id: String(s.personas[1]), origen: 'comun', fecha_inicio: '2026-08-28', dias: '10' }, '2026-09-26');
  await u.documentoVigente(s.repo, s.E, 'POLITICA_SST', 'POL-M12');
});
test.after(() => u.cerrar(s));

test('resultado: frecuencia, severidad y ausentismo del mes con 4 trabajadores', async () => {
  const n = await ind.calcular(s.repo, s.E, 2026, 9);
  assert.ok(n > 10);
  const [frec] = await vigente('FREC_AT', '2026-09');
  assert.deepEqual([Number(frec.numerador), Number(frec.denominador), Number(frec.valor)], [1, 4, 25]);
  const [sev] = await vigente('SEV_AT', '2026-09');
  assert.equal(Number(sev.valor), 150);
  const [aus] = await vigente('AUS_MEDICO', '2026-09');
  assert.equal(Number(aus.numerador), 6, 'solo los dias de la incapacidad que caen en septiembre');
  assert.equal(Number(aus.denominador), 88, '22 dias habiles de septiembre de 2026 x 4 trabajadores');
  const [pol] = await vigente('EST_POLITICA', '2026-09');
  assert.equal(Number(pol.valor), 100);
  const [plan] = await vigente('EST_PLAN', '2026-09');
  assert.equal(Number(plan.valor), 0);
});

test('recalcular sin cambios no duplica; un cambio reemplaza la medicion anterior', async () => {
  assert.equal(await ind.calcular(s.repo, s.E, 2026, 9), 0);
  await eventos.registrar(s.repo, s.E, {
    tipo: 'accidente', gravedad: 'leve', persona_id: String(s.personas[2]), fecha_ocurrencia: '2026-09-15T14:00', descripcion: 'Corte superficial al abrir cajas con bisturi',
  }, '2026-09-26T10:00');
  assert.ok(await ind.calcular(s.repo, s.E, 2026, 9) >= 1);
  const filas = await vigente('FREC_AT', '2026-09');
  assert.deepEqual(filas.map((f) => [f.estado, Number(f.valor)]), [['reemplazada', 25], ['vigente', 50]]);
  await rechaza(s.db.query("UPDATE indicador_medicion SET valor = 1 WHERE empresa_id = ? AND indicador_codigo = 'FREC_AT' AND estado = 'vigente'", [s.E]), /registre una nueva/);
});

test('ficha tecnica con meta y registro manual', async () => {
  await ind.guardarFicha(s.repo, s.E, { indicador_codigo: 'FREC_AT', meta: '10', sentido: 'menor', responsable: 'Responsable SST' });
  await ind.registrarManual(s.repo, s.E, { indicador_codigo: 'PRO_MANTENIMIENTO', periodo: '2026-09', numerador: '9', denominador: '12' });
  await rechaza(ind.registrarManual(s.repo, s.E, { indicador_codigo: 'PRO_MANTENIMIENTO', periodo: '09-2026', numerador: '1', denominador: '2' }), /Periodo/);
  const t = await ind.tablero(s.repo, s.E, 2026);
  const frec = t.find((x) => x.codigo === 'FREC_AT');
  assert.equal(frec.cumple, false, '50 no es menor o igual a 10');
  assert.equal(frec.serie[8], '50.0000');
  assert.equal(Number(t.find((x) => x.codigo === 'PRO_MANTENIMIENTO').ultima.valor), 75);
});

test('http: tablero', async () => {
  const ir = await u.clienteHttp(s);
  const r = await ir('/indicadores?anio=2026');
  assert.equal(r.status, 200);
  assert.match(r.texto, /Frecuencia de accidentalidad/);
});
