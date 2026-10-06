/**
 * Export the ครู × ห้อง matrix to Excel (.xlsx) and PDF (print dialog).
 *
 * Data shape (same as TeacherClassMatrix props):
 *   rows        — [{ id, name, perClass: { classId: number }, total }]
 *   cols        — [{ id, name }]
 *   colTotals   — { classId: number }
 *   grandTotal  — number
 */

import { exportMultiPagePDF } from './exportPdf.js'

const MATRIX_STYLE = 'border:1px solid #cbd5e1;padding:4px 6px;font-size:11px;text-align:center;'

/** Build a self-contained HTML string of the matrix (inline styles, printable). */
export function buildMatrixHTML({ title, rows, cols, cellOf, rowTotals, colTotals, grandTotal }) {
  const headerTh = `${MATRIX_STYLE}background:#1e3a8a;color:#fff;font-weight:700;`
  const totalTh = `${MATRIX_STYLE}background:#e0e7ff;font-weight:700;`
  const nameTd = `${MATRIX_STYLE}background:#f8fafc;font-weight:600;text-align:left;white-space:nowrap;`
  const cellTd = (v) => `${MATRIX_STYLE}${v > 0 ? 'background:#eff6ff;color:#1d4ed8;font-weight:600;' : 'color:#9ca3af;'}`

  let html = `<div class="matrix-page" style="break-inside:avoid;font-family:'Sarabun','Segoe UI',Tahoma,sans-serif;">
  <div style="text-align:center;font-weight:700;font-size:15px;margin-bottom:10px;">${title}</div>
  <table style="border-collapse:collapse;width:100%;">
    <tr><th style="${headerTh}text-align:left;min-width:120px;">ครู \\ ห้อง</th>`
  for (const c of cols) html += `<th style="${headerTh}">${c.name}</th>`
  html += `<th style="${totalTh}background:#4338ca;color:#fff;">รวม</th></tr>`

  for (const r of rows) {
    html += `<tr><td style="${nameTd}">${r.name}</td>`
    for (const c of cols) {
      const v = cellOf(r.id, c.id)
      html += `<td style="${cellTd(v)}">${v > 0 ? v : ''}</td>`
    }
    html += `<td style="${totalTh}">${rowTotals[r.id] || 0}</td></tr>`
  }

  html += `<tr><td style="${nameTd}background:#eef2ff;font-weight:700;">รวมทุกครู</td>`
  for (const c of cols) html += `<td style="${totalTh}">${colTotals[c.id] || 0}</td>`
  html += `<td style="${MATRIX_STYLE}background:#c7d2fe;font-weight:700;">${grandTotal || 0}</td></tr>`

  html += '</table></div>'
  return html
}

/** Export matrix to a styled .xlsx workbook and trigger download. */
export async function exportMatrixExcel({ title, rows, cols, cellOf, rowTotals, colTotals, grandTotal }) {
  const ExcelJS = await import('exceljs')
  const Workbook = ExcelJS.default?.Workbook || ExcelJS.Workbook
  const wb = new Workbook()
  const ws = wb.addWorksheet('ครู×ห้อง')

  const HEADER_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E3A8A' } }
  const TOTAL_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE0E7FF' } }
  const GRAND_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFC7D2FE' } }

  // Title row
  ws.addRow([title])
  ws.getCell('A1').font = { bold: true, size: 14 }

  // Header row
  const headerRow = ws.addRow(['ครู \\ ห้อง', ...cols.map((c) => c.name), 'รวม'])
  headerRow.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } }
    cell.fill = HEADER_FILL
    cell.alignment = { horizontal: 'center', vertical: 'middle' }
    cell.border = { bottom: { style: 'thin' } }
  })

  // Data rows
  for (const r of rows) {
    const row = ws.addRow([r.name, ...cols.map((c) => cellOf(r.id, c.id)), r.total || 0])
    row.getCell(1).font = { bold: true }
    const totalCell = row.getCell(cols.length + 2)
    totalCell.font = { bold: true }
    totalCell.fill = TOTAL_FILL
  }

  // Totals row
  const totalRow = ws.addRow(['รวมทุกครู', ...cols.map((c) => colTotals[c.id] || 0), grandTotal || 0])
  totalRow.eachCell((cell) => {
    cell.font = { bold: true }
    cell.fill = GRAND_FILL
  })

  // Column widths
  ws.getColumn(1).width = 24
  cols.forEach((c, i) => {
    ws.getColumn(i + 2).width = Math.max(10, c.name.length + 4)
  })
  ws.getColumn(cols.length + 2).width = 10

  const buffer = await wb.xlsx.writeBuffer()
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${(title || 'ครูxห้อง').replace(/[^\w\u0E00-\u0E7F-]+/g, '_')}.xlsx`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

/** Export matrix to PDF via the browser print dialog (reuses the app's PDF pipeline). */
export function exportMatrixPDF(opts) {
  const html = buildMatrixHTML(opts)
  return exportMultiPagePDF([{ label: 'ครู×ห้อง', html }], opts.title || 'ตารางสรุปครู×ห้อง')
}
