// Exportacion a Excel (.xlsx): encabezado del documento y una tabla por hoja.
const ExcelJS = require('exceljs');

const BORDE = { style: 'thin', color: { argb: 'FFBFBFBF' } };
const BORDES = { top: BORDE, left: BORDE, bottom: BORDE, right: BORDE };

/**
 * hojas: [{ nombre, titulo, encabezado: [[etiqueta, valor]], columnas: [{ titulo, ancho, formato }], filas: [[...]] }]
 * Devuelve el Buffer del libro.
 */
async function libro(hojas) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'TORRESOFT - SG-SST';
  for (const h of hojas) {
    const ws = wb.addWorksheet(h.nombre.slice(0, 31));
    ws.columns = h.columnas.map((c) => ({ width: c.ancho || 15, style: c.formato ? { numFmt: c.formato } : {} }));
    if (h.titulo) {
      ws.addRow([h.titulo]).font = { bold: true, size: 13 };
      ws.mergeCells(ws.rowCount, 1, ws.rowCount, h.columnas.length);
    }
    for (const [k, v] of h.encabezado || []) {
      const r = ws.addRow([k, v]);
      r.getCell(1).font = { bold: true };
    }
    if (h.titulo || (h.encabezado || []).length) ws.addRow([]);
    const cab = ws.addRow(h.columnas.map((c) => c.titulo));
    cab.eachCell((c) => {
      c.font = { bold: true };
      c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD9D9D9' } };
      c.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
      c.border = BORDES;
    });
    ws.views = [{ state: 'frozen', ySplit: cab.number }];
    for (const f of h.filas) {
      const r = ws.addRow(f.map((v) => (v == null ? '' : v)));
      r.eachCell({ includeEmpty: true }, (c) => { c.alignment = { vertical: 'top', wrapText: true }; c.border = BORDES; });
    }
  }
  return wb.xlsx.writeBuffer();
}

module.exports = { libro };
