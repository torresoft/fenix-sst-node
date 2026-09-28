// Exportacion de la tabla de valores y el plan de mejoramiento (CSV ';' + BOM para Excel en espanol).

const { celda } = require('../integraciones/csv');
const decimal = (v) => (v == null ? '' : String(v).replace('.', ','));
const RESULTADO = { cumple: 'Cumple totalmente', no_cumple: 'No cumple', no_aplica: 'No aplica', pendiente: 'Pendiente' };

function aCsv(d, empresa, acciones) {
  const a = d.autoevaluacion;
  const r = d.resultado;
  const filas = [
    ['Tabla de valores y calificacion - Resolucion 0312 de 2019'],
    ['Empresa', empresa.razon_social, 'NIT', empresa.nit],
    ['Vigencia', a.vigencia_anio, 'Version', a.version, 'Estado', a.estado],
    ['Conjunto', d.conjunto ? `${d.conjunto.cantidad_estandares} estandares (art. ${d.conjunto.articulo})` : a.conjunto_codigo, 'Fecha de corte', a.fecha_corte],
    ['Calificacion', decimal(r.puntaje), 'Valoracion', r.valoracion],
    ...(a.hash_resultado ? [['Hash SHA-256 del resultado', a.hash_resultado]] : []),
    [],
    ['Ciclo', 'Componente', 'Numeral', 'Item', 'Valor', 'Calificacion', 'Resultado', 'Justificacion no aplica', 'Documentos soporte'],
  ];
  for (const i of r.items) {
    filas.push([
      i.ciclo, i.componente, i.numeral, i.nombre, decimal(i.peso), decimal(i.puntaje), RESULTADO[i.resultado] || i.resultado,
      i.motivo === 'fuera_del_conjunto' ? 'No aplica al conjunto de la empresa (art. 27)' : (i.justificacion || ''),
      (i.evidencias || []).join(' '),
    ]);
  }
  filas.push([], ['Plan de mejoramiento'], ['Numeral', 'Accion', 'Responsable', 'Fecha limite', 'Estado', 'Fecha cierre', 'Observacion']);
  for (const x of acciones) {
    filas.push([x.referencia, x.descripcion, x.responsable || '', x.fecha_limite, x.estado, x.fecha_cierre || '', x.observacion_cierre || '']);
  }
  return `﻿${filas.map((f) => f.map(celda).join(';')).join('\r\n')}\r\n`;
}

module.exports = { aCsv };
