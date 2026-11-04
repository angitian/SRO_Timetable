import {
  STATUS_META,
  buildDashboardCSV,
  buildDashboardStats,
  buildSummaryCSV,
  dashboardRange,
  dateKeysInRange,
  formatDateTimeDMY,
  formatThaiDate,
  historyForTrainee,
  mentorDisplayLine,
  statsForTrainee,
  summarizeDay,
  summarizeRange,
  traineeDisplayLine,
} from './traineeAttendance.js'

export const REPORT_TYPES = [
  { value: 'daily', label: 'รายงานรายวัน', orientation: 'landscape' },
  { value: 'range', label: 'สรุปรายเดือน/ภาคเรียน', orientation: 'landscape' },
  { value: 'student', label: 'รายงานรายคน', orientation: 'portrait' },
  { value: 'dashboard', label: 'สรุป Dashboard', orientation: 'portrait' },
]

export function defaultOrientation(type) {
  return REPORT_TYPES.find((r) => r.value === type)?.orientation || 'landscape'
}

export function escapeHTML(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function pct(part, total) {
  return total ? Math.round((part / total) * 100) : 0
}

function sortTrainees(trainees, sortBy = 'name') {
  const getValue = sortBy === 'major'
    ? (t) => t.major || ''
    : sortBy === 'mentor'
      ? (t) => mentorDisplayLine(t)
      : (t) => t.name || ''
  return [...(trainees || [])].sort((a, b) => String(getValue(a)).localeCompare(String(getValue(b)), 'th'))
}

export function resolveReportRange(type, settings = {}, reference = {}) {
  const dateKey = settings.dateKey
  if (type === 'daily') return { start: dateKey, end: dateKey, mode: 'day' }
  const rangeMode = settings.rangeMode || (type === 'dashboard' ? 'semester' : 'month')
  return dashboardRange(dateKey, rangeMode, reference)
}

function rangeText(range, type) {
  if (!range) return '—'
  if (type === 'daily') return formatThaiDate(range.start, { month: 'long' })
  return `${formatThaiDate(range.start)} – ${formatThaiDate(range.end)}`
}

function statusText(status) {
  return STATUS_META[status]?.label || 'ยังไม่บันทึก'
}

function statusChip(status) {
  if (!status) return '<span class="muted">ยังไม่บันทึก</span>'
  return `<span class="chip chip-${escapeHTML(status)}">${escapeHTML(statusText(status))}</span>`
}

function summaryCards(stats) {
  return `<div class="summary">
    <div class="summary-card"><div class="summary-label">บันทึกแล้ว</div><div class="summary-value">${stats.total}</div></div>
    <div class="summary-card green"><div class="summary-label">ปกติ</div><div class="summary-value">${stats.present}</div></div>
    <div class="summary-card amber"><div class="summary-label">สาย</div><div class="summary-value">${stats.late}</div></div>
    <div class="summary-card blue"><div class="summary-label">ลา</div><div class="summary-value">${stats.leave}</div></div>
    <div class="summary-card rose"><div class="summary-label">ขาด</div><div class="summary-value">${stats.absent}</div></div>
  </div>`
}

function signatureBlock(settings = {}) {
  const left = settings.signatureLeft || 'ผู้รายงาน'
  const right = settings.signatureRight || 'ผู้ตรวจสอบ'
  return `<div class="signatures">
    <div class="signature"><div class="signature-line"></div><div>${escapeHTML(left)}</div><div class="muted">วันที่ ......../......../........</div></div>
    <div class="signature"><div class="signature-line"></div><div>${escapeHTML(right)}</div><div class="muted">วันที่ ......../......../........</div></div>
  </div>`
}

function reportHeader({ title, subtitle, settings = {}, range, type }) {
  const school = settings.schoolName ? `<div class="school">${escapeHTML(settings.schoolName)}</div>` : ''
  const term = settings.termLabel ? `<div class="term">${escapeHTML(settings.termLabel)}</div>` : ''
  return `<header class="report-header">
    ${school}
    <h1>${escapeHTML(title)}</h1>
    ${term}
    <div class="meta"><span>ช่วงเวลา: ${escapeHTML(rangeText(range, type))}</span><span>พิมพ์เมื่อ: ${escapeHTML(formatDateTimeDMY(new Date()))}</span></div>
    ${subtitle ? `<div class="subtitle">${escapeHTML(subtitle)}</div>` : ''}
  </header>`
}

function documentShell({ title, orientation = 'landscape', body }) {
  return `<!doctype html>
<html lang="th">
<head>
<meta charset="utf-8" />
<title>${escapeHTML(title)}</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=Sarabun:wght@400;600;700&display=swap');
  @page { size: A4 ${orientation}; margin: 10mm; }
  * { box-sizing: border-box; }
  body { margin: 0; color: #0f172a; background: #fff; font-family: 'Sarabun', 'Noto Sans Thai', Tahoma, sans-serif; font-size: 12px; line-height: 1.45; }
  .report-page { max-width: 100%; }
  .report-header { text-align: center; border-bottom: 2px solid #0f172a; padding-bottom: 8px; margin-bottom: 12px; }
  .school { font-size: 15px; font-weight: 700; }
  .term { font-size: 12px; color: #475569; margin-top: 2px; }
  h1 { font-size: 18px; margin: 5px 0 2px; }
  .meta { display: flex; justify-content: space-between; gap: 12px; color: #64748b; font-size: 10px; margin-top: 6px; }
  .subtitle { color: #475569; font-size: 11px; margin-top: 4px; }
  .summary { display: grid; grid-template-columns: repeat(5, 1fr); gap: 6px; margin: 10px 0 12px; }
  .summary-card { border: 1px solid #e2e8f0; border-radius: 6px; padding: 7px 8px; background: #f8fafc; }
  .summary-label { font-size: 10px; color: #64748b; }
  .summary-value { font-size: 18px; font-weight: 700; margin-top: 2px; }
  .summary-card.green { background: #ecfdf5; border-color: #a7f3d0; }
  .summary-card.amber { background: #fffbeb; border-color: #fde68a; }
  .summary-card.blue { background: #eff6ff; border-color: #bfdbfe; }
  .summary-card.rose { background: #fff1f2; border-color: #fecdd3; }
  table { width: 100%; border-collapse: collapse; margin-top: 8px; }
  th, td { border: 1px solid #e2e8f0; padding: 5px 6px; vertical-align: top; }
  th { background: #f1f5f9; color: #334155; font-size: 10px; text-align: left; }
  td { font-size: 10.5px; }
  td.center, th.center { text-align: center; }
  td.num { text-align: center; font-weight: 600; }
  .chip { display: inline-block; border: 1px solid #e2e8f0; border-radius: 999px; padding: 1px 6px; font-size: 9px; font-weight: 700; white-space: nowrap; }
  .chip-present { background: #ecfdf5; border-color: #a7f3d0; color: #047857; }
  .chip-late { background: #fffbeb; border-color: #fde68a; color: #b45309; }
  .chip-leave { background: #eff6ff; border-color: #bfdbfe; color: #1d4ed8; }
  .chip-absent { background: #fff1f2; border-color: #fecdd3; color: #be123c; }
  .muted { color: #94a3b8; font-size: 9.5px; }
  .section-title { font-size: 12px; font-weight: 700; margin: 14px 0 4px; }
  .signatures { display: flex; justify-content: space-around; gap: 30px; margin-top: 34px; page-break-inside: avoid; }
  .signature { text-align: center; width: 40%; font-size: 11px; }
  .signature-line { border-bottom: 1px dotted #64748b; height: 34px; margin-bottom: 4px; }
  .two-col { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
  .note { color: #64748b; font-size: 10px; margin-top: 6px; }
  .kpi-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; margin: 10px 0; }
  .kpi { border: 1px solid #e2e8f0; border-radius: 6px; padding: 8px; background: #f8fafc; }
  .kpi-label { font-size: 10px; color: #64748b; }
  .kpi-value { font-size: 20px; font-weight: 700; margin-top: 2px; }
  @media print { body { -webkit-print-color-adjust: exact; print-color-adjust: exact; } .no-print { display: none; } }
</style>
</head>
<body><main class="report-page">${body}</main></body>
</html>`
}

export function buildDailyReportHTML({ trainees = [], attendance = {}, reference = {}, settings = {} }) {
  const range = resolveReportRange('daily', settings, reference)
  const active = sortTrainees(trainees, settings.sortBy)
  const ids = active.map((t) => t.id)
  const stats = summarizeDay(attendance, range.start, ids)
  const includeNotes = settings.includeNotes !== false
  const rows = active.map((t, index) => {
    const record = attendance?.[range.start]?.[t.id]
    return `<tr>
      <td class="center">${index + 1}</td>
      <td><strong>${escapeHTML(t.name)}</strong><div class="muted">${escapeHTML(traineeDisplayLine(t) || '—')}</div></td>
      <td class="center">${statusChip(record?.status)}</td>
      <td class="center">${escapeHTML(record?.time || '—')}</td>
      ${includeNotes ? `<td>${escapeHTML(record?.note || '—')}</td>` : ''}
    </tr>`
  }).join('')
  const body = `${reportHeader({ title: 'รายงานการลงเวลาปฏิบัติงานประจำวัน', settings, range, type: 'daily' })}
    ${summaryCards(stats)}
    <table>
      <thead><tr><th class="center" style="width:5%">ลำดับ</th><th style="width:42%">ชื่อ–นามสกุล / ข้อมูล</th><th class="center" style="width:13%">สถานะ</th><th class="center" style="width:10%">เวลา</th>${includeNotes ? '<th style="width:30%">หมายเหตุ</th>' : ''}</tr></thead>
      <tbody>${rows || `<tr><td colspan="${includeNotes ? 5 : 4}" class="center muted">ยังไม่มีรายชื่อนักศึกษา</td></tr>`}</tbody>
    </table>
    <div class="note">* สรุปเฉพาะรายการที่บันทึกไว้ วันที่ยังไม่บันทึกไม่นับรวมเป็นวันขาด</div>
    ${signatureBlock(settings)}`
  return documentShell({ title: 'รายงานรายวัน', orientation: settings.orientation || 'landscape', body })
}

export function buildRangeSummaryHTML({ trainees = [], attendance = {}, reference = {}, settings = {} }) {
  const range = resolveReportRange('range', settings, reference)
  const active = sortTrainees(trainees, settings.sortBy)
  const ids = active.map((t) => t.id)
  const total = summarizeRange(attendance, range, ids)
  const rows = active.map((t, index) => {
    const stats = statsForTrainee(attendance, t.id, range)
    return `<tr>
      <td class="center">${index + 1}</td>
      <td><strong>${escapeHTML(t.name)}</strong><div class="muted">${escapeHTML(t.studentCode || '—')}</div></td>
      <td>${escapeHTML(t.major || '—')}</td>
      <td>${escapeHTML(t.institution || '—')}</td>
      <td>${escapeHTML(mentorDisplayLine(t) || '—')}</td>
      <td class="num">${stats.present}</td><td class="num">${stats.late}</td><td class="num">${stats.leave}</td><td class="num">${stats.absent}</td><td class="num">${stats.total}</td>
      <td class="num">${pct(stats.present + stats.late, stats.total)}%</td>
    </tr>`
  }).join('')
  const body = `${reportHeader({ title: 'สรุปการลงเวลาปฏิบัติงาน', settings, range, type: 'range' })}
    ${summaryCards(total)}
    <table>
      <thead><tr><th class="center">ลำดับ</th><th>ชื่อ–นามสกุล / รหัส</th><th>วิชาเอก</th><th>สถาบัน</th><th>ครูพี่เลี้ยง</th><th class="center">ปกติ</th><th class="center">สาย</th><th class="center">ลา</th><th class="center">ขาด</th><th class="center">รวม</th><th class="center">มา%</th></tr></thead>
      <tbody>${rows || '<tr><td colspan="11" class="center muted">ยังไม่มีรายชื่อนักศึกษา</td></tr>'}
        <tr><td colspan="5" class="center"><strong>รวมทั้งสิ้น</strong></td><td class="num">${total.present}</td><td class="num">${total.late}</td><td class="num">${total.leave}</td><td class="num">${total.absent}</td><td class="num">${total.total}</td><td class="num">${pct(total.present + total.late, total.total)}%</td></tr>
      </tbody>
    </table>
    <div class="note">* วันที่ไม่มีรายการบันทึกไม่ถูกนับเป็นวันขาด</div>
    ${signatureBlock(settings)}`
  return documentShell({ title: 'สรุปการลงเวลา', orientation: settings.orientation || 'landscape', body })
}

export function buildStudentReportHTML({ trainees = [], attendance = {}, reference = {}, settings = {} }) {
  const range = resolveReportRange('student', settings, reference)
  const trainee = trainees.find((t) => t.id === settings.studentId) || trainees[0]
  if (!trainee) {
    return documentShell({
      title: 'รายงานรายคน',
      orientation: settings.orientation || 'portrait',
      body: reportHeader({ title: 'รายงานรายคน', settings, range, type: 'student' }) + '<p class="muted">ยังไม่มีรายชื่อนักศึกษา</p>',
    })
  }
  const stats = statsForTrainee(attendance, trainee.id, range)
  const allowedDates = new Set(dateKeysInRange(range))
  const history = historyForTrainee(attendance, trainee.id).filter((h) => allowedDates.has(h.dateKey))
  const historyRows = history.map((h) => `<tr>
    <td>${escapeHTML(formatThaiDate(h.dateKey))}</td><td class="center">${statusChip(h.status)}</td><td class="center">${escapeHTML(h.time || '—')}</td><td>${escapeHTML(h.note || '—')}</td>
  </tr>`).join('')
  const body = `${reportHeader({ title: 'รายงานประวัตินักศึกษาฝึกประสบการณ์', subtitle: trainee.name, settings, range, type: 'student' })}
    <table>
      <tbody>
        <tr><th style="width:22%">ชื่อ–นามสกุล</th><td>${escapeHTML(trainee.name)}</td><th style="width:18%">รหัสนักศึกษา</th><td>${escapeHTML(trainee.studentCode || '—')}</td></tr>
        <tr><th>วิชาเอก</th><td>${escapeHTML(trainee.major || '—')}</td><th>สถาบัน</th><td>${escapeHTML(trainee.institution || '—')}</td></tr>
        <tr><th>ครูพี่เลี้ยง</th><td>${escapeHTML(mentorDisplayLine(trainee) || '—')}</td><th>วิชา/ชั้น/ห้อง</th><td>${escapeHTML([trainee.subjectName, trainee.className, trainee.roomName].filter(Boolean).join(' / ') || '—')}</td></tr>
        <tr><th>คาบ/สัปดาห์</th><td>${escapeHTML(trainee.weeklyPeriods || '—')}</td><th>ช่วงรายงาน</th><td>${escapeHTML(rangeText(range, 'student'))}</td></tr>
      </tbody>
    </table>
    ${summaryCards(stats)}
    <div class="section-title">ประวัติรายการที่ไม่ปกติ</div>
    <table>
      <thead><tr><th style="width:22%">วันที่</th><th class="center" style="width:14%">สถานะ</th><th class="center" style="width:12%">เวลา</th><th>หมายเหตุ</th></tr></thead>
      <tbody>${historyRows || '<tr><td colspan="4" class="center muted">ไม่มีรายการสาย/ลา/ขาดในช่วงนี้</td></tr>'}</tbody>
    </table>
    <div class="note">* รายการปกติไม่แสดงในประวัติ; วันที่ยังไม่บันทึกไม่นับเป็นขาด</div>
    ${signatureBlock(settings)}`
  return documentShell({ title: `รายงาน ${trainee.name}`, orientation: settings.orientation || 'portrait', body })
}

export function buildDashboardReportHTML({ trainees = [], attendance = {}, reference = {}, settings = {} }) {
  const range = resolveReportRange('dashboard', settings, reference)
  const stats = buildDashboardStats({ trainees, attendance, range })
  const trendRows = stats.trend.map((b) => `<tr><td>${escapeHTML(b.label)}</td><td class="num">${b.present}</td><td class="num">${b.late}</td><td class="num">${b.leave}</td><td class="num">${b.absent}</td><td class="num">${b.total}</td></tr>`).join('')
  const breakdown = (title, rows) => `<div class="section-title">${escapeHTML(title)}</div>
    <table><thead><tr><th>กลุ่ม</th><th class="center">คน</th><th class="center">ปกติ</th><th class="center">สาย</th><th class="center">ลา</th><th class="center">ขาด</th><th class="center">รวม</th><th class="center">มา%</th></tr></thead>
    <tbody>${rows.map((r) => `<tr><td>${escapeHTML(r.key)}</td><td class="num">${r.traineeCount}</td><td class="num">${r.present}</td><td class="num">${r.late}</td><td class="num">${r.leave}</td><td class="num">${r.absent}</td><td class="num">${r.total}</td><td class="num">${r.attendedRate}%</td></tr>`).join('') || '<tr><td colspan="8" class="center muted">ไม่มีข้อมูล</td></tr>'}</tbody></table>`
  const body = `${reportHeader({ title: 'สรุปภาพรวมการลงเวลาปฏิบัติงาน', settings, range, type: 'dashboard' })}
    <div class="kpi-grid">
      <div class="kpi"><div class="kpi-label">นักศึกษาทั้งหมด</div><div class="kpi-value">${stats.traineeCount}</div></div>
      <div class="kpi"><div class="kpi-label">วันที่มีบันทึก</div><div class="kpi-value">${stats.recordedDays}/${stats.rangeDays}</div></div>
      <div class="kpi"><div class="kpi-label">มาปฏิบัติงาน</div><div class="kpi-value">${stats.attendedRate}%</div></div>
      <div class="kpi"><div class="kpi-label">ตรงเวลา</div><div class="kpi-value">${stats.punctualRate}%</div></div>
      <div class="kpi"><div class="kpi-label">สาย / ลา / ขาด</div><div class="kpi-value">${stats.totals.late} / ${stats.totals.leave} / ${stats.totals.absent}</div></div>
    </div>
    <div class="section-title">แนวโน้มการลงเวลา</div>
    <table><thead><tr><th>ช่วง</th><th class="center">ปกติ</th><th class="center">สาย</th><th class="center">ลา</th><th class="center">ขาด</th><th class="center">รวม</th></tr></thead><tbody>${trendRows || '<tr><td colspan="6" class="center muted">ไม่มีข้อมูล</td></tr>'}</tbody></table>
    ${breakdown('แยกตามวิชาเอก', stats.byMajor)}
    ${breakdown('แยกตามสถาบัน', stats.byInstitution)}
    ${breakdown('แยกตามครูพี่เลี้ยง', stats.byMentor)}
    <div class="section-title">Top 5 สาย / ขาด</div>
    <div class="two-col">
      <table><thead><tr><th>ชื่อ</th><th class="center">สาย</th></tr></thead><tbody>${stats.topLate.map((r) => `<tr><td>${escapeHTML(r.trainee.name)}</td><td class="num">${r.late}</td></tr>`).join('') || '<tr><td colspan="2" class="center muted">ไม่มี</td></tr>'}</tbody></table>
      <table><thead><tr><th>ชื่อ</th><th class="center">ขาด</th></tr></thead><tbody>${stats.topAbsent.map((r) => `<tr><td>${escapeHTML(r.trainee.name)}</td><td class="num">${r.absent}</td></tr>`).join('') || '<tr><td colspan="2" class="center muted">ไม่มี</td></tr>'}</tbody></table>
    </div>
    <div class="note">* วันที่ยังไม่บันทึกไม่นับเป็นวันขาด</div>
    ${signatureBlock(settings)}`
  return documentShell({ title: 'สรุป Dashboard', orientation: settings.orientation || 'portrait', body })
}

export function buildReportHTML({ type = 'daily', trainees = [], attendance = {}, reference = {}, settings = {} }) {
  if (type === 'range') return buildRangeSummaryHTML({ trainees, attendance, reference, settings })
  if (type === 'student') return buildStudentReportHTML({ trainees, attendance, reference, settings })
  if (type === 'dashboard') return buildDashboardReportHTML({ trainees, attendance, reference, settings })
  return buildDailyReportHTML({ trainees, attendance, reference, settings })
}

export function buildReportCSV({ type = 'daily', trainees = [], attendance = {}, reference = {}, settings = {} }) {
  const range = resolveReportRange(type, settings, reference)
  if (type === 'dashboard') {
    return buildDashboardCSV(buildDashboardStats({ trainees, attendance, range }))
  }
  const selected = type === 'student'
    ? trainees.filter((t) => t.id === settings.studentId).slice(0, 1)
    : trainees
  return buildSummaryCSV({ trainees: selected, attendance, range, reference })
}

export function printHTML(html) {
  const win = window.open('', '_blank', 'width=1100,height=850')
  if (!win) return false
  win.document.open()
  win.document.write(html)
  win.document.close()
  win.focus()
  setTimeout(() => {
    try { win.print() } catch { /* user can print manually */ }
  }, 400)
  return true
}
