// CSV minimo: separador ',' o ';' (detectado en la cabecera), comillas dobles y BOM de Excel.

function detectarSeparador(linea) {
  return (linea.match(/;/g) || []).length > (linea.match(/,/g) || []).length ? ';' : ',';
}

const MAX_COLUMNAS = 100;
const excede = (m) => Object.assign(new Error(m), { status: 422 });

/** Lanza 422 si el archivo pasa de maxFilas de datos o MAX_COLUMNAS (evita bloquear el proceso). */
function parsear(texto, maxFilas = Infinity) {
  const t = String(texto).replace(/^﻿/, '');
  const sep = detectarSeparador(t.split(/\r?\n/, 1)[0] || '');
  const filas = [];
  let fila = [];
  let campo = '';
  let comillas = false;
  const cerrarCampo = () => {
    fila.push(campo); campo = '';
    if (fila.length > MAX_COLUMNAS) throw excede(`Maximo ${MAX_COLUMNAS} columnas`);
  };
  const cerrarFila = () => {
    cerrarCampo();
    if (fila.some((x) => x.trim() !== '')) filas.push(fila);
    if (filas.length > maxFilas + 1) throw excede(`Maximo ${maxFilas} filas por archivo`);
    fila = [];
  };
  for (let i = 0; i < t.length; i += 1) {
    const c = t[i];
    if (comillas) {
      if (c === '"' && t[i + 1] === '"') { campo += '"'; i += 1; } else if (c === '"') comillas = false; else campo += c;
    } else if (c === '"') comillas = true;
    else if (c === sep) cerrarCampo();
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && t[i + 1] === '\n') i += 1;
      cerrarFila();
    } else campo += c;
  }
  if (campo !== '' || fila.length) cerrarFila();
  if (!filas.length) return [];
  const cabecera = filas[0].map((h) => h.trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, '_'));
  return filas.slice(1).map((f, i) => ({ _fila: i + 2, ...Object.fromEntries(cabecera.map((h, j) => [h, (f[j] ?? '').trim()])) }));
}

/** Celda segura para exportar: evita inyeccion de formulas en Excel. */
function celda(v) {
  let s = v == null ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[;"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

const generar = (filas) => `﻿${filas.map((f) => f.map(celda).join(';')).join('\r\n')}\r\n`;

module.exports = { parsear, generar, celda };
