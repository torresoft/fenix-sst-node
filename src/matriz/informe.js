// Informe del auditor en CSV (separador ';' y BOM para Excel en espanol).

const { celda } = require('../integraciones/csv');

function aCsv(auditoria, empresa) {
  const r = auditoria.resultado;
  const filas = [
    ['Informe de auditoria de matriz legal'],
    ['Empresa', empresa.razon_social, 'NIT', empresa.nit],
    ['Fecha', auditoria.creado_en instanceof Date ? auditoria.creado_en.toISOString() : auditoria.creado_en, 'Auditoria', auditoria.id],
    ['Cobertura de normas aplicables (%)', auditoria.cobertura],
    [],
    ['Hallazgo', 'Linea', 'Referencia declarada', 'Norma catalogo', 'Estado', 'Reemplazo vigente', 'Detalle'],
  ];
  for (const d of r.derogadas) filas.push(['Derogada o sustituida', d.linea, d.declarada, d.codigo, d.estado, d.reemplazo, d.impacto]);
  for (const d of r.desinformacion) filas.push(['Desinformacion', d.linea, d.declarada, d.codigo, 'inexistente', d.norma_correcta, d.explicacion]);
  for (const d of r.noAplican) filas.push(['No aplica al perfil', d.linea, d.declarada, d.codigo, d.estado, '', d.motivo]);
  for (const d of r.noReconocidas) filas.push(['No reconocida', d.linea, d.declarada, '', '', '', d.motivo]);
  for (const d of r.faltantes) filas.push(['Faltante', '', '', d.codigo, d.estado, '', `${d.motivo}: ${d.objeto}`]);
  for (const d of r.correctas) filas.push(['Correcta', d.linea, d.declarada, d.codigo, d.estado, '', d.objeto]);
  for (const d of r.otras || []) filas.push(['Otra', d.linea, d.declarada, d.codigo, d.estado, '', d.motivo]);
  return `﻿${filas.map((f) => f.map(celda).join(';')).join('\r\n')}\r\n`;
}

module.exports = { aCsv };
