const test = require('node:test');
const assert = require('node:assert/strict');
const r = require('../src/salud/reglas');

const HOY = '2026-09-26';

test('regla dura: se rechazan codigos CIE-10 y terminos clinicos', () => {
  assert.throws(() => r.sinDatosClinicos('Lumbalgia M54.5, evitar cargas', 'Restricciones'), /CIE-10/);
  assert.throws(() => r.sinDatosClinicos('Asma J45', 'Restricciones'), /CIE-10/);
  assert.throws(() => r.sinDatosClinicos('Segun audiometria con hipoacusia', 'Recomendaciones'), /sin diagnosticos/);
  assert.throws(() => r.sinDatosClinicos('Diagnostico de tunel carpiano', 'Recomendaciones'), /sin diagnosticos/);
  assert.equal(r.sinDatosClinicos('No levantar mas de 12 kg; pausas activas cada 2 horas', 'Restricciones'), 'No levantar mas de 12 kg; pausas activas cada 2 horas');
  assert.equal(r.sinDatosClinicos('', 'X'), null);
});

test('concepto: restricciones obligatorias si es apto con restricciones; proximo examen coherente', () => {
  assert.throws(() => r.validarConcepto({ concepto: 'apto_con_restricciones', fecha_examen: '2026-09-20' }, HOY), /restricciones/);
  assert.throws(() => r.validarConcepto({ concepto: 'x', fecha_examen: '2026-09-20' }, HOY), /invalido/);
  assert.throws(() => r.validarConcepto({ concepto: 'apto', fecha_examen: '2026-09-27' }, HOY), /Fecha/);
  assert.throws(() => r.validarConcepto({ concepto: 'apto', fecha_examen: '2026-09-20', proximo_examen: '2026-01-01' }, HOY), /posterior/);
  const v = r.validarConcepto({ tipo: 'periodico', concepto: 'apto', fecha_examen: '2026-09-20', proximo_examen: '2027-09-20' }, HOY);
  assert.equal(v.proximo_examen, '2027-09-20');
  assert.equal(r.validarConcepto({ tipo: 'egreso', concepto: 'apto', fecha_examen: '2026-09-20', proximo_examen: '2027-09-20' }, HOY).proximo_examen, null);
});

test('perfil sociodemografico agregado', () => {
  const p = r.perfilSociodemografico([
    { sexo: 'F', fecha_nacimiento: '2000-10-01', cargo: 'Operario' },
    { sexo: 'M', fecha_nacimiento: '1980-01-15', cargo: 'Operario' },
    { sexo: null, fecha_nacimiento: null, cargo: null },
  ], HOY);
  assert.deepEqual(p.porSexo, { F: 1, M: 1, NB: 0, sin_dato: 1 });
  assert.equal(p.porEdad['25 - 34'], 1, '2000-10-01 aun tiene 25');
  assert.equal(p.porEdad['45 - 54'], 1);
  assert.deepEqual(p.porCargo, { Operario: 2, 'Sin cargo': 1 });
});
