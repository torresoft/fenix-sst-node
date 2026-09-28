const test = require('node:test');
const assert = require('node:assert/strict');
const r = require('../src/consultor/reglas');

const fila = (x = {}) => ({
  razon_social: 'A', trabajadores: 10, reclasificacion: false,
  obligaciones: { vencidas: 0, porVencer: 0 }, acciones: { abiertas: 0, vencidas: 0 }, eventos: { abiertos: 0, graves: 0 },
  documentos: { vencidos: 0, porVencer: 0 }, matriz: { estado: 'vigente' }, autoevaluacion: { estado: 'cerrada', puntaje: '90.00' }, ...x,
});

test('semaforo: rojo por vencidas o AT grave, amarillo por pendientes, verde al dia', () => {
  assert.equal(r.semaforo(fila()).nivel, 'verde');
  assert.equal(r.semaforo(fila({ matriz: null })).nivel, 'amarillo');
  const rojo = r.semaforo(fila({ obligaciones: { vencidas: 2, porVencer: 1 }, eventos: { abiertos: 3, graves: 1 } }));
  assert.equal(rojo.nivel, 'rojo');
  assert.match(rojo.motivos[0], /2 obligaci/);
  assert.ok(rojo.motivos.some((m) => /2 evento/.test(m)), 'los no graves van como amarillo');
});

test('orden: rojo primero, luego mas vencidas y menor puntaje; totales en centesimas', () => {
  const filas = [
    fila({ razon_social: 'Verde' }),
    fila({ razon_social: 'Rojo1', obligaciones: { vencidas: 1, porVencer: 0 } }),
    fila({ razon_social: 'Rojo3', obligaciones: { vencidas: 3, porVencer: 0 } }),
    fila({ razon_social: 'Amarillo bajo', matriz: null, autoevaluacion: { estado: 'cerrada', puntaje: '40.10' } }),
    fila({ razon_social: 'Amarillo alto', matriz: null, autoevaluacion: { estado: 'cerrada', puntaje: '80.20' } }),
  ].map((f) => ({ ...f, semaforo: r.semaforo(f) }));
  assert.deepEqual(r.ordenar(filas).map((f) => f.razon_social), ['Rojo3', 'Rojo1', 'Amarillo bajo', 'Amarillo alto', 'Verde']);
  const t = r.totales(filas);
  assert.deepEqual([t.rojo, t.amarillo, t.verde, t.vencidas, t.trabajadores], [2, 2, 1, 4, 50]);
  assert.equal(t.puntajePromedio, 78.06);
});
