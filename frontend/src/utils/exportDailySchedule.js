/**
 * Export — ตารางสอนแทนรายวัน + รายงานสถิติครู
 *
 * PDF ผ่าน print dialog (เหมือน exportPdf.js), Excel ผ่าน exceljs (เหมือน exportExcel.js)
 * ใช้กับหน้า SubstituteCenter (Step 7)
 */
import { formatTimeRange } from './dailySchedule.js'
import { rangeLabel } from './substituteStats.js'

// ── Style constants (mirror exportExcel.js) ──────────────────────────────
const COLOR_NAVY = 'FF1E3A8A'
const COLOR_SLATE = 'FFE2E8F0'
const COLOR_ORANGE = 'FFFFF3E3'
const COLOR_ORANGE_BORDER = 'FFFDBA74'
const COLOR_WHITE = 'FFFFFFFF'
const COLOR_DARK_TEXT = 'FF1F2937'
const THIN_BORDER = {
  top: { style: 'thin', color: { argb: 'FFD1D5DB' } },
  left: { style: 'thin', color: { argb: 'FFD1D5DB' } },
  bottom: { style: 'thin', color: { argb: 'FFD1D5DB' } },
  right: { style: 'thin', color: { argb: 'FFD1D5DB' } },
}

function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function safeLabel(text) {
  return String(text || 'daily').replace(/[^\w\u0E00-\u0E7F-]+/g, '_')
}

// ── HTML ตารางรายวัน ต่อห้อง ─────────────────────────────────────────────
function buildClassDailyHTML(classRow, { dateStr, dayLabel }) {
  const { className, periods, cells } = classRow
  const rowsHTML = periods.map((p) => {
    const cell = cells[p.period_no]
    if (!cell) {
      return `<tr>
        <td class="num">${p.period_no}</td>
        <td class="time">${esc(formatTimeRange(p.start_time, p.end_time))}</td>
        <td class="empty" colspan="3">—</td>
      </tr>`
    }
    const teacherHTML = cell.isSubstitute
      ? `<span class="sub">${esc(cell.teacherName)}</span>
         <div class="orig">(แทน ${esc(cell.originalName || '')})</div>`
      : `${esc(cell.teacherName)}${cell.coTeacherName ? ` + ${esc(cell.coTeacherName)}` : ''}`
    return `<tr>
      <td class="num">${p.period_no}</td>
      <td class="time">${esc(formatTimeRange(p.start_time, p.end_time))}</td>
      <td>${esc(cell.subjectName)}</td>
      <td>${teacherHTML}</td>
      <td class="note">${cell.isSubstitute ? 'สอนแทน' : ''}</td>
    </tr>`
  }).join('')

  return `
    <div class="class-block">
      <div class="class-title">ห้อง ${esc(className)} — ${esc(dayLabel)}</div>
      <table>
        <thead>
          <tr><th>คาบ</th><th>เวลา</th><th>วิชา</th><th>ครูผู้สอน</th><th>หมายเหตุ</th></tr>
        </thead>
        <tbody>${rowsHTML}</tbody>
      </table>
    </div>`
}

/** สร้าง HTML เอกสารตารางรายวัน (ทุกห้อง + สรุปสอนแทน) */
export function buildDailyScheduleHTML({
  dateStr,
  dayLabel,
  grid,
  assignments,
  absentTeachers,
  teachers,
  subjects,
  classes,
  scheduleLabel = '',
  note = '',
}) {
  const teacherMap = new Map((teachers || []).map((t) => [t.id, t.name]))
  const subjectMap = new Map((subjects || []).map((s) => [s.id, s.name]))
  const classMap = new Map((classes || []).map((c) => [c.id, c.name]))

  const classPages = grid.rows
    .map((r) => buildClassDailyHTML(r, { dateStr, dayLabel }))
    .join('\n')

  const absentHTML = (absentTeachers || []).length > 0
    ? `<div class="absent-box"><strong>ครูที่ลา/ไม่มา:</strong> ${(absentTeachers || [])
        .map((tid) => esc(teacherMap.get(tid) || tid)).join(', ')}</div>`
    : ''

  const assignRows = (assignments || []).map((a) => {
    const cls = classMap.get(a.class_id)
    const subj = subjectMap.get(a.subject_id)
    return `<tr>
      <td>คาบ ${a.period}</td>
      <td>${esc(cls || a.class_id)}</td>
      <td>${esc(subj || a.subject_id)}</td>
      <td>${esc(teacherMap.get(a.original_teacher_id) || a.original_teacher_id)}</td>
      <td class="sub-cell">${esc(teacherMap.get(a.substitute_teacher_id) || a.substitute_teacher_id)}</td>
    </tr>`
  }).join('')

  return `<!DOCTYPE html>
<html lang="th">
<head>
<meta charset="UTF-8">
<title>ตารางสอนแทนรายวัน ${esc(dateStr)}</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: 'Sarabun', 'Segoe UI', Tahoma, sans-serif; margin: 16px; color: #1f2937; }
  h1 { font-size: 18px; text-align: center; margin: 0 0 4px; }
  .meta { text-align: center; color: #6b7280; font-size: 12px; margin-bottom: 12px; }
  .absent-box { background: #fff7ed; border: 1px solid #fdba74; border-radius: 8px; padding: 8px 12px; font-size: 12px; margin-bottom: 12px; }
  .class-block { margin-bottom: 16px; break-inside: avoid; }
  .class-title { background: #1e3a8a; color: #fff; padding: 6px 10px; font-weight: 700; font-size: 13px; border-radius: 6px 6px 0 0; }
  table { width: 100%; border-collapse: collapse; font-size: 12px; }
  th { background: #e2e8f0; border: 1px solid #d1d5db; padding: 5px 8px; text-align: left; }
  td { border: 1px solid #d1d5db; padding: 5px 8px; vertical-align: top; }
  .num, .time { white-space: nowrap; text-align: center; }
  .sub { color: #c2410c; font-weight: 700; }
  .orig { color: #9ca3af; font-size: 10px; }
  .sub-cell { color: #c2410c; font-weight: 700; }
  .empty { color: #d1d5db; text-align: center; }
  .assign-box { margin-top: 16px; break-inside: avoid; }
  .assign-title { background: #ea580c; color: #fff; padding: 6px 10px; font-weight: 700; font-size: 13px; border-radius: 6px 6px 0 0; }
  .note { color: #6b7280; font-size: 11px; }
</style>
</head>
<body>
  <h1>ตารางสอนแทนรายวัน</h1>
  <div class="meta">${esc(dayLabel)}${scheduleLabel ? ` · ${esc(scheduleLabel)}` : ''}</div>
  ${absentHTML}
  ${classPages}
  ${(assignments || []).length > 0 ? `
  <div class="assign-box">
    <div class="assign-title">สรุปรายการสอนแทน (${assignments.length} คาบ)</div>
    <table>
      <thead><tr><th>คาบ</th><th>ห้อง</th><th>วิชา</th><th>ครูเดิม</th><th>ครูสอนแทน</th></tr></thead>
      <tbody>${assignRows}</tbody>
    </table>
  </div>` : ''}
  ${note ? `<p style="font-size:11px;color:#6b7280;margin-top:10px">${esc(note)}</p>` : ''}
</body>
</html>`
}

/** export PDF ตารางรายวัน — เปิด print dialog (ทุกห้องในหน้าเดียว) */
export async function exportDailySchedulePDF(opts) {
  const html = buildDailyScheduleHTML(opts)
  const printWindow = window.open('', '_blank', 'width=1100,height=850')
  if (!printWindow) throw new Error('กรุณาอนุญาต popup เพื่อพิมพ์ตาราง')
  printWindow.document.write(html)
  printWindow.document.close()
  printWindow.focus()
  await new Promise((resolve) => setTimeout(resolve, 400))
  printWindow.print()
  await new Promise((resolve) => setTimeout(resolve, 400))
  try { printWindow.close() } catch { /* ignore */ }
}

/** export Excel ตารางรายวัน — sheet "ตารางรายวัน" + "รายการสอนแทน" */
export async function exportDailyScheduleExcel(opts) {
  const { dateStr, dayLabel, grid, assignments, teachers, subjects, classes, absentTeachers } = opts
  const ExcelJS = await import('exceljs')
  const Workbook = ExcelJS.default?.Workbook || ExcelJS.Workbook
  const wb = new Workbook()
  wb.creator = 'ระบบจัดตารางสอนอัตโนมัติ'
  wb.created = new Date()

  const teacherMap = new Map((teachers || []).map((t) => [t.id, t.name]))
  const subjectMap = new Map((subjects || []).map((s) => [s.id, s.name]))
  const classMap = new Map((classes || []).map((c) => [c.id, c.name]))

  // ── Sheet 1: ตารางรายวัน ──
  const ws = wb.addWorksheet('ตารางรายวัน', { views: [{ showGridLines: false }] })
  ws.mergeCells('A1:E1')
  const titleCell = ws.getCell('A1')
  titleCell.value = `ตารางสอนแทนรายวัน ${dayLabel}`
  titleCell.font = { bold: true, size: 14, color: { argb: COLOR_WHITE } }
  titleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLOR_NAVY } }
  titleCell.alignment = { horizontal: 'center', vertical: 'middle' }
  ws.getRow(1).height = 24
  ws.mergeCells('A2:E2')
  const metaCell = ws.getCell('A2')
  metaCell.value = absentTeachers?.length
    ? `ครูที่ลา/ไม่มา: ${absentTeachers.map((t) => teacherMap.get(t) || t).join(', ')}`
    : 'ไม่มีครูที่ลา/ไม่มา'
  metaCell.font = { italic: true, size: 10, color: { argb: 'FF6B7280' } }

  let row = 4
  const headers = ['คาบ', 'เวลา', 'วิชา', 'ครูผู้สอน', 'หมายเหตุ']
  const headerRow = ws.getRow(row)
  headers.forEach((h, i) => {
    const cell = headerRow.getCell(i + 1)
    cell.value = h
    cell.font = { bold: true, color: { argb: COLOR_NAVY } }
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLOR_SLATE } }
    cell.border = THIN_BORDER
    cell.alignment = { vertical: 'middle' }
  })
  ws.getRow(row).height = 18
  row += 1

  for (const classRow of grid.rows) {
    ws.mergeCells(row, 1, row, 5)
    const c = ws.getCell(row, 1)
    c.value = `ห้อง ${classRow.className}`
    c.font = { bold: true, color: { argb: COLOR_WHITE } }
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2563EB' } }
    row += 1
    for (const p of classRow.periods) {
      const cell = classRow.cells[p.period_no]
      ws.getCell(row, 1).value = p.period_no
      ws.getCell(row, 2).value = formatTimeRange(p.start_time, p.end_time)
      if (cell) {
        ws.getCell(row, 3).value = cell.subjectName
        ws.getCell(row, 4).value = cell.isSubstitute
          ? `${cell.teacherName} (แทน ${cell.originalName || ''})`
          : cell.teacherName + (cell.coTeacherName ? ` + ${cell.coTeacherName}` : '')
        ws.getCell(row, 5).value = cell.isSubstitute ? 'สอนแทน' : ''
        if (cell.isSubstitute) {
          ws.getCell(row, 4).font = { bold: true, color: { argb: 'FFC2410C' } }
          ws.getCell(row, 4).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLOR_ORANGE } }
          ws.getCell(row, 4).border = THIN_BORDER
        }
      } else {
        ws.getCell(row, 3).value = '—'
      }
      for (let col = 1; col <= 5; col++) {
        const cell = ws.getCell(row, col)
        cell.border = THIN_BORDER
        cell.alignment = { vertical: 'top', wrapText: true }
      }
      row += 1
    }
    row += 1 // blank row between classes
  }

  ws.columns = [{ width: 8 }, { width: 12 }, { width: 22 }, { width: 30 }, { width: 14 }]

  // ── Sheet 2: รายการสอนแทน ──
  const ws2 = wb.addWorksheet('รายการสอนแทน', { views: [{ showGridLines: false }] })
  ws2.columns = [{ width: 10 }, { width: 16 }, { width: 20 }, { width: 24 }, { width: 24 }]
  const h2 = ['คาบ', 'ห้อง', 'วิชา', 'ครูเดิม', 'ครูสอนแทน']
  h2.forEach((h, i) => {
    const cell = ws2.getCell(1, i + 1)
    cell.value = h
    cell.font = { bold: true, color: { argb: COLOR_NAVY } }
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLOR_SLATE } }
    cell.border = THIN_BORDER
  })
  ;(assignments || []).forEach((a, idx) => {
    const r = idx + 2
    ws2.getCell(r, 1).value = `คาบ ${a.period}`
    ws2.getCell(r, 2).value = classMap.get(a.class_id) || a.class_id
    ws2.getCell(r, 3).value = subjectMap.get(a.subject_id) || a.subject_id
    ws2.getCell(r, 4).value = teacherMap.get(a.original_teacher_id) || a.original_teacher_id
    ws2.getCell(r, 5).value = teacherMap.get(a.substitute_teacher_id) || a.substitute_teacher_id
    ws2.getCell(r, 5).font = { bold: true, color: { argb: 'FFC2410C' } }
    for (let col = 1; col <= 5; col++) ws2.getCell(r, col).border = THIN_BORDER
  })

  const buffer = await wb.xlsx.writeBuffer()
  const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `timetable_รายวัน_${safeLabel(dateStr)}.xlsx`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

// ── รายงานสถิติ ──────────────────────────────────────────────────────────

/** สร้าง HTML รายงานสถิติครู */
export function buildStatsReportHTML({ rows, fromDate, toDate, dayLabel }) {
  const bodyRows = rows.map((r) => `<tr>
    <td class="num">${r.rank}</td>
    <td>${esc(r.teacherName)}</td>
    <td class="num">${r.basePeriodsPerWeek}</td>
    <td class="num">${r.baseHoursPerWeek.toFixed(1)}</td>
    <td class="num">${r.subPeriods}</td>
    <td class="num">${r.subHours.toFixed(1)}</td>
    <td class="num">${r.totalPeriods}</td>
    <td class="num">${r.sharePct.toFixed(1)}%</td>
  </tr>`).join('')

  return `<!DOCTYPE html>
<html lang="th">
<head>
<meta charset="UTF-8">
<title>รายงานสถิติภาระครู (สอนแทน) ${esc(rangeLabel(fromDate, toDate))}</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: 'Sarabun', 'Segoe UI', Tahoma, sans-serif; margin: 16px; color: #1f2937; }
  h1 { font-size: 18px; text-align: center; margin: 0 0 4px; }
  .meta { text-align: center; color: #6b7280; font-size: 12px; margin-bottom: 14px; }
  table { width: 100%; border-collapse: collapse; font-size: 12px; }
  th { background: #1e3a8a; color: #fff; border: 1px solid #1e3a8a; padding: 6px 8px; }
  td { border: 1px solid #d1d5db; padding: 5px 8px; }
  .num { text-align: center; }
  tr:nth-child(even) td { background: #f8fafc; }
</style>
</head>
<body>
  <h1>รายงานสถิติภาระครู — สอนแทน</h1>
  <div class="meta">ช่วง: ${esc(rangeLabel(fromDate, toDate))}${dayLabel ? ` · สร้างเมื่อ ${esc(dayLabel)}` : ''}</div>
  <table>
    <thead>
      <tr>
        <th>อันดับ</th><th>ครู</th><th>คาบปกติ/สัปดาห์</th><th>ชั่วโมงปกติ/สัปดาห์</th>
        <th>คาบสอนแทน</th><th>ชั่วโมงสอนแทน</th><th>รวมคาบ</th><th>% สอนแทน</th>
      </tr>
    </thead>
    <tbody>${bodyRows}</tbody>
  </table>
</body>
</html>`
}

/** export PDF รายงานสถิติ */
export function exportStatsPDF({ rows, fromDate, toDate }) {
  return new Promise((resolve, reject) => {
    const html = buildStatsReportHTML({ rows, fromDate, toDate })
    const printWindow = window.open('', '_blank', 'width=1100,height=850')
    if (!printWindow) {
      reject(new Error('กรุณาอนุญาต popup เพื่อพิมพ์รายงาน'))
      return
    }
    printWindow.document.write(html)
    printWindow.document.close()
    printWindow.focus()
    setTimeout(() => {
      printWindow.print()
      setTimeout(() => {
        try { printWindow.close() } catch { /* ignore */ }
        resolve()
      }, 400)
    }, 400)
  })
}

/** export Excel รายงานสถิติ */
export async function exportStatsExcel({ rows, fromDate, toDate }) {
  const ExcelJS = await import('exceljs')
  const Workbook = ExcelJS.default?.Workbook || ExcelJS.Workbook
  const wb = new Workbook()
  wb.creator = 'ระบบจัดตารางสอนอัตโนมัติ'
  wb.created = new Date()
  const ws = wb.addWorksheet('สถิติสอนแทน', { views: [{ showGridLines: false }] })
  ws.columns = [
    { width: 8 }, { width: 26 }, { width: 16 }, { width: 18 },
    { width: 14 }, { width: 14 }, { width: 12 }, { width: 12 },
  ]
  ws.mergeCells('A1:H1')
  const title = ws.getCell('A1')
  title.value = `รายงานสถิติภาระครู — สอนแทน (${rangeLabel(fromDate, toDate)})`
  title.font = { bold: true, size: 14, color: { argb: COLOR_WHITE } }
  title.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLOR_NAVY } }
  title.alignment = { horizontal: 'center', vertical: 'middle' }
  ws.getRow(1).height = 24

  const headers = ['อันดับ', 'ครู', 'คาบปกติ/สัปดาห์', 'ชั่วโมงปกติ/สัปดาห์', 'คาบสอนแทน', 'ชั่วโมงสอนแทน', 'รวมคาบ', '% สอนแทน']
  headers.forEach((h, i) => {
    const cell = ws.getCell(2, i + 1)
    cell.value = h
    cell.font = { bold: true, color: { argb: COLOR_NAVY } }
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLOR_SLATE } }
    cell.border = THIN_BORDER
  })
  rows.forEach((r, idx) => {
    const row = idx + 3
    const vals = [r.rank, r.teacherName, r.basePeriodsPerWeek, Number(r.baseHoursPerWeek.toFixed(1)), r.subPeriods, Number(r.subHours.toFixed(1)), r.totalPeriods, Number(r.sharePct.toFixed(1))]
    vals.forEach((v, i) => {
      const cell = ws.getCell(row, i + 1)
      cell.value = v
      cell.border = THIN_BORDER
      if (i === 0 || i >= 2) cell.alignment = { horizontal: 'center' }
      if (i === 4 && r.subPeriods > 0) cell.font = { bold: true, color: { argb: 'FFC2410C' } }
    })
  })

  const buffer = await wb.xlsx.writeBuffer()
  const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `สถิติ_สอนแทน_${safeLabel(fromDate || 'start')}_${safeLabel(toDate || 'end')}.xlsx`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}
