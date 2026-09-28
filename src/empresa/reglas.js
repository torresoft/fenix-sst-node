// Reglas puras de empresa, personas y vinculaciones (sin BD).

const PESOS_DV = [3, 7, 13, 17, 19, 23, 29, 37, 41, 43, 47, 53, 59, 67, 71];
const TIPOS_DOCUMENTO = {
  CC: 'Cedula de ciudadania', CE: 'Cedula de extranjeria', TI: 'Tarjeta de identidad', PA: 'Pasaporte',
  PPT: 'Permiso por proteccion temporal', PEP: 'Permiso especial de permanencia',
};
const TIPOS_VINCULACION = {
  dependiente: 'Dependiente', contratista: 'Contratista', aprendiz: 'Aprendiz', mision: 'Trabajador en mision', independiente: 'Independiente',
};

function errorValidacion(mensaje) {
  const e = new Error(mensaje);
  e.status = 422;
  return e;
}

/** Digito de verificacion del NIT (algoritmo de la DIAN, modulo 11). */
function dvNit(nit) {
  const digitos = String(nit).replace(/\D/g, '');
  if (!digitos || digitos.length > PESOS_DV.length) throw errorValidacion('NIT invalido');
  let suma = 0;
  [...digitos].reverse().forEach((d, i) => { suma += Number(d) * PESOS_DV[i]; });
  const r = suma % 11;
  return String(r > 1 ? 11 - r : r);
}

function validarNit(nit, dv) {
  const n = String(nit || '').replace(/\D/g, '');
  if (n.length < 6 || n.length > 15) throw errorValidacion('El NIT debe tener entre 6 y 15 digitos, sin digito de verificacion');
  const calculado = dvNit(n);
  if (dv !== undefined && dv !== null && String(dv).trim() !== '' && String(dv).trim() !== calculado) {
    throw errorValidacion(`El digito de verificacion no corresponde al NIT (deberia ser ${calculado})`);
  }
  return { nit: n, dv: calculado };
}

function validarDocumento(tipo, numero) {
  const t = String(tipo || '').toUpperCase();
  if (!TIPOS_DOCUMENTO[t]) throw errorValidacion('Tipo de documento invalido');
  const n = String(numero || '').trim().toUpperCase();
  const valido = ['PA', 'PPT', 'PEP', 'CE'].includes(t) ? /^[A-Z0-9]{3,20}$/.test(n) : /^\d{3,15}$/.test(n);
  if (!valido) throw errorValidacion(`Numero de documento invalido para ${TIPOS_DOCUMENTO[t]}`);
  return { tipo: t, numero: n };
}

function validarEmail(email, { obligatorio = false } = {}) {
  const e = String(email || '').trim().toLowerCase();
  if (!e) {
    if (obligatorio) throw errorValidacion('El correo es obligatorio');
    return null;
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e) || e.length > 190) throw errorValidacion(`Correo invalido: ${e}`);
  return e;
}

function validarDivipola(codigo) {
  const c = String(codigo || '').trim();
  if (!c) return null;
  if (!/^\d{5}$/.test(c)) throw errorValidacion('El codigo DIVIPOLA del municipio tiene 5 digitos (p. ej. 66001 Pereira)');
  return c;
}

function entero(valor, { min = 0, max = 10000000, nombre = 'valor' } = {}) {
  const n = Number.parseInt(valor, 10);
  if (!Number.isInteger(n) || n < min || n > max) throw errorValidacion(`${nombre} invalido`);
  return n;
}

function cumple(valor, { operador, valor: umbral }) {
  const v = Number(valor || 0);
  if (operador === '>') return v > umbral;
  if (operador === '>=') return v >= umbral;
  if (operador === '=') return v === umbral;
  if (operador === '<') return v < umbral;
  if (operador === '<=') return v <= umbral;
  throw new Error(`Operador desconocido: ${operador}`);
}

/** Modulos activos segun el perfil. ambitosActivos: Map/Set de codigos de ambito activos. */
function modulosActivos(modulos, empresa, ambitosActivos) {
  const tiene = (a) => (ambitosActivos.has ? ambitosActivos.has(a) : false);
  return modulos.map((m) => {
    let activo = false;
    let motivo = '';
    if (m.activacion === 'siempre') { activo = true; motivo = 'Aplica a toda empresa'; } else if (m.activacion === 'ambitos') {
      const por = (m.ambitos || []).filter(tiene);
      activo = por.length > 0;
      motivo = activo ? `Por: ${por.join(', ')}` : `Se activa con: ${(m.ambitos || []).join(', ')}`;
    } else if (m.activacion === 'regla') {
      activo = (m.regla || []).some((r) => cumple(empresa[r.campo], r));
      motivo = activo ? 'Por el perfil declarado' : 'No aplica al perfil declarado';
    }
    return { ...m, activo, motivo };
  });
}

/** Retiro: posterior o igual al ingreso y no futuro. */
function validarRetiro(vinculacion, fechaRetiro, hoy) {
  const f = String(fechaRetiro || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(f)) throw errorValidacion('Fecha de retiro invalida');
  if (f < vinculacion.fecha_ingreso) throw errorValidacion('El retiro no puede ser anterior al ingreso');
  if (f > hoy) throw errorValidacion('El retiro no puede ser una fecha futura');
  return f;
}

module.exports = {
  TIPOS_DOCUMENTO, TIPOS_VINCULACION, errorValidacion, dvNit, validarNit, validarDocumento, validarEmail,
  validarDivipola, entero, modulosActivos, validarRetiro,
};
