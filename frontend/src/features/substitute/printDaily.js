/**
 * Print builders — เอกสารสอนแทนรายวัน (ใช้กับ Print Studio)
 *
 * คืน HTML fragment (ไม่ใช่เอกสารเต็ม) เพื่อให้ Print Studio นำไปประกอบกับ
 * buildFullPageHTML (หัวกระดาษ/ท้ายกระดาษ) ได้เหมือนแท็บอื่น ๆ
 *
 * เอกสาร 4 แบบ:
 *  - sub-summary : สรุปการสอนแทนรายวัน (1 หน้า)
 *  - sub-class   : ตารางรายห้องของวันนั้น
 *  - sub-teacher : ตารางของครูที่รับสอนแทน (รายคน)
 *  - sub-absent  : ตารางของครูที่ลา (รายคน) + ใครสอนแทน
 */
import {
  formatThaiDate, formatDDMMYYYY, getDayHalves, isPeriodInRange,
  computeDaySummary, normalizeDailySchedule,
} from './dailySchedule.js'

const esc = (s) => String(s ?? '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')

const RANGE_LABEL = { all: 'ทั้งวัน', morning: 'เช้า', afternoon: 'บ่าย' }

const TH = 'padding:5px 6px;border:1px solid #cbd5e1;background:#f1f5f9;font-weight:700;font-size:11px;color:#334155;text-align:left;'
const TD = 'padding:4px 6px;border:1px solid #e2e8f0;font-size:11px;color:#1f2937;vertical-align:top;'
const TABLE = 'width:100%;border-collapse:collapse;table-layout:fixed;'
const H2 = 'font-size:14px;font-weight:700;color:#0f172a;margin:0 0 8px;'
const SUB_BADGE = 'display:inline-block;background:#ffedd5;color:#c2410c;border-radius:9999px;padding:1px 7px;font-size:10px;font-weight:700;'
const CO_BADGE = 'display:inline-block;background:#e0e7ff;color:#4338ca;border-radius:9999px;padding:1px 7px;font-size:10px;font-weight:700;'

function periodTime(period, timeMap) {
  return timeMap?.[period] || ''
}

function buildTimeMap(scheduleBlocks) {
  const map = {}
  for (const blk of scheduleBlocks || []) {
    for (const p of blk.periods || []) {
      if (p.type === 'LUNCH' || !p.start_time || !p.end_time) continue
      map[p.period_no] = `${p.start_time}-${p.end_time}`
    }
  }
  return map
}

/** ข้อมูลที่ใช้ร่วมกันทุกเอกสาร */
function buildContext({
  dateStr, dailySchedule, daySlots, classes, teachers, subjects, lessonBlockMap,
  scheduleBlocks, scheduleConfig,
}) {
  const ds = normalizeDailySchedule(dailySchedule) || {}
  const absences = ds.absences || []
  const assignments = ds.assignments || []
  const subjectMap = new Map((subjects || []).map((s) => [s.id, s]))
  const classMap = new Map((classes || []).map((c) => [c.id, c]))
  const teacherMap = new Map((teachers || []).map((t) => [t.id, t]))
  const halves = getDayHalves(scheduleBlocks, scheduleConfig)
  const timeMap = buildTimeMap(scheduleBlocks)
  const absenceMap = new Map(absences.map((a) => [a.teacherId, a]))
  const assignByKey = new Map()
  for (const a of assignments) {
    assignByKey.set(`${a.period}-${a.class_id}-${a.role === 'co' ? 'co' : 'main'}`, a)
  }
  const subjectName = (id) => subjectMap.get(id)?.name || id
  const className = (id) => classMap.get(id)?.name || id
  const teacherName = (id) => teacherMap.get(id)?.name || id || ''

  // คาบของวัน แยกตำแหน่ง (main / co)
  const slots = []
  for (const s of daySlots || []) {
    const lb = lessonBlockMap?.get ? lessonBlockMap.get(s.lesson_block_id) : null
    const coId = lb?.co_teacher_id || s.co_teacher_id || null
    slots.push({ ...s, coTeacherId: coId })
  }

  const summary = computeDaySummary({
    daySlots: slots, assignments, absences, halves, lessonBlockMap,
  })

  return {
    ds, absences, assignments, absenceMap, assignByKey, halves, timeMap,
    subjectName, className, teacherName, slots, summary, teacherMap, classMap, subjectMap,
  }
}

/** ครูที่รับสอนแทน + จำนวนคาบ */
function substituteLoad(assignments, teacherName) {
  const counts = new Map()
  for (const a of assignments) {
    counts.set(a.substitute_teacher_id, (counts.get(a.substitute_teacher_id) || 0) + 1)
  }
  return [...counts.entries()]
    .map(([tid, n]) => ({ id: tid, name: teacherName(tid), count: n }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'th'))
}

/* ── A. สรุปการสอนแทนรายวัน ─────────────────────────────────────────── */
function buildSummaryHTML(ctx, { dateStr, note }) {
  const { absences, assignments, subjectName, className, teacherName, absenceMap, timeMap, summary } = ctx

  const absentHTML = absences.length === 0
    ? '<div style="font-size:11px;color:#64748b;font-style:italic;">ไม่มีครูที่ลาในวันนี้</div>'
    : `<div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:10px;">
        ${absences.map((a) => `<span style="display:inline-block;border:1px solid #fecaca;background:#fef2f2;border-radius:6px;padding:3px 8px;font-size:11px;color:#991b1b;">
          <b>${esc(teacherName(a.teacherId))}</b>
          <span style="color:#64748b;">· ${RANGE_LABEL[a.periodRange] || 'ทั้งวัน'}</span>
          ${a.reason ? `<span style="color:#7e22ce;">· ${esc(a.reason)}</span>` : ''}
        </span>`).join('')}
      </div>`

  const rows = assignments.length === 0
    ? `<tr><td colspan="7" style="${TD}text-align:center;color:#94a3b8;font-style:italic;">ยังไม่มีการจัดสอนแทน</td></tr>`
    : [...assignments]
      .sort((a, b) => a.period - b.period || String(a.class_id).localeCompare(String(b.class_id)))
      .map((a) => `<tr>
        <td style="${TD}text-align:center;font-weight:700;">${a.period}</td>
        <td style="${TD}text-align:center;color:#64748b;">${esc(periodTime(a.period, timeMap))}</td>
        <td style="${TD}">${esc(className(a.class_id))}</td>
        <td style="${TD}">${esc(subjectName(a.subject_id))}</td>
        <td style="${TD}">${esc(teacherName(a.original_teacher_id))}${a.role === 'co' ? ` <span style="${CO_BADGE}">ครูร่วม</span>` : ''}</td>
        <td style="${TD}font-weight:700;color:#c2410c;">${esc(teacherName(a.substitute_teacher_id))}</td>
        <td style="${TD}">${esc(absenceMap.get(a.original_teacher_id)?.reason || '—')}</td>
      </tr>`).join('')

  const load = substituteLoad(assignments, teacherName)
  const loadHTML = load.length === 0
    ? ''
    : `<div style="margin-top:10px;">
        <div style="font-size:11px;font-weight:700;color:#334155;margin-bottom:4px;">ภาระสอนแทนวันนี้</div>
        <div style="display:flex;flex-wrap:wrap;gap:5px;">
          ${load.map((r) => `<span style="display:inline-block;border:1px solid #fdba74;background:#fff7ed;border-radius:9999px;padding:2px 9px;font-size:11px;color:#9a3412;">
            <b>${esc(r.name)}</b> · ${r.count} คาบ</span>`).join('')}
        </div>
      </div>`

  return `
    <h2 style="${H2}">สรุปการสอนแทน — ${esc(formatThaiDate(dateStr))}</h2>
    <div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:8px;font-size:11px;">
      <span style="border:1px solid #e2e8f0;background:#f8fafc;border-radius:6px;padding:3px 8px;">คาบเรียนวันนี้ <b>${summary.totalPeriods}</b> คาบ</span>
      <span style="border:1px solid #fde68a;background:#fffbeb;border-radius:6px;padding:3px 8px;color:#b45309;">ต้องหาแทน <b>${summary.absentPositionCount}</b> ตำแหน่ง</span>
      <span style="border:1px solid #bbf7d0;background:#f0fdf4;border-radius:6px;padding:3px 8px;color:#15803d;">จัดแล้ว <b>${assignments.length}</b> คาบ</span>
      ${summary.uncoveredCount > 0
        ? `<span style="border:1px solid #fca5a5;background:#fef2f2;border-radius:6px;padding:3px 8px;color:#b91c1c;">ยังไม่ได้จัด <b>${summary.uncoveredCount}</b> ตำแหน่ง</span>`
        : ''}
    </div>
    <div style="font-size:11px;font-weight:700;color:#334155;margin:8px 0 4px;">ครูที่ลา / ไม่มา (${absences.length})</div>
    ${absentHTML}
    <div style="font-size:11px;font-weight:700;color:#334155;margin:10px 0 4px;">รายการสอนแทน (${assignments.length} คาบ)</div>
    <table style="${TABLE}">
      <thead><tr>
        <th style="${TH}width:9%;">คาบ</th>
        <th style="${TH}width:14%;">เวลา</th>
        <th style="${TH}width:14%;">ห้อง</th>
        <th style="${TH}width:20%;">วิชา</th>
        <th style="${TH}width:17%;">ครูเดิม</th>
        <th style="${TH}width:16%;">ครูสอนแทน</th>
        <th style="${TH}width:10%;">เหตุผล</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>
    ${loadHTML}
    ${note ? `<div style="margin-top:10px;font-size:11px;color:#475569;"><b>หมายเหตุ:</b> ${esc(note)}</div>` : ''}
  `
}

/* ── B. ตารางรายห้องของวันนั้น ──────────────────────────────────────── */
function buildClassHTML(ctx, cls, { dateStr, onlySubstitute }) {
  const { slots, assignByKey, teacherName, subjectName, timeMap } = ctx
  const classSlots = slots
    .filter((s) => s.class_id === cls.id)
    .sort((a, b) => a.period - b.period)

  const rows = []
  for (const s of classSlots) {
    const mainAssign = assignByKey.get(`${s.period}-${s.class_id}-main`)
    const coAssign = s.coTeacherId ? assignByKey.get(`${s.period}-${s.class_id}-co`) : null
    if (onlySubstitute && !mainAssign && !coAssign) continue
    const mainName = mainAssign ? teacherName(mainAssign.substitute_teacher_id) : teacherName(s.teacher_id)
    const mainOrig = mainAssign ? teacherName(mainAssign.original_teacher_id) : ''
    const coName = s.coTeacherId
      ? (coAssign ? teacherName(coAssign.substitute_teacher_id) : teacherName(s.coTeacherId))
      : ''
    const coOrig = coAssign ? teacherName(coAssign.original_teacher_id) : ''
    rows.push(`<tr>
      <td style="${TD}text-align:center;font-weight:700;">${s.period}</td>
      <td style="${TD}text-align:center;color:#64748b;">${esc(periodTime(s.period, timeMap))}</td>
      <td style="${TD}">${esc(subjectName(s.subject_id))}</td>
      <td style="${TD}${mainAssign ? 'color:#c2410c;font-weight:700;' : ''}">
        ${esc(mainName)}${mainAssign ? ` <span style="${SUB_BADGE}">สอนแทน</span><br><span style="color:#94a3b8;font-size:10px;text-decoration:line-through;">${esc(mainOrig)}</span>` : ''}
      </td>
      <td style="${TD}${coAssign ? 'color:#c2410c;font-weight:700;' : ''}">
        ${coName ? `${esc(coName)}${coAssign ? ` <span style="${SUB_BADGE}">สอนแทน</span><br><span style="color:#94a3b8;font-size:10px;text-decoration:line-through;">${esc(coOrig)}</span>` : ` <span style="${CO_BADGE}">ครูร่วม</span>`}` : '—'}
      </td>
    </tr>`)
  }

  if (rows.length === 0) return null

  return `
    <h2 style="${H2}">${esc(cls.name)} — ${esc(formatThaiDate(dateStr))}</h2>
    <table style="${TABLE}">
      <thead><tr>
        <th style="${TH}width:9%;">คาบ</th>
        <th style="${TH}width:14%;">เวลา</th>
        <th style="${TH}width:25%;">วิชา</th>
        <th style="${TH}width:26%;">ครูผู้สอน</th>
        <th style="${TH}width:26%;">ครูร่วม</th>
      </tr></thead>
      <tbody>${rows.join('')}</tbody>
    </table>
  `
}

/* ── C. ตารางของครูที่รับสอนแทน ─────────────────────────────────────── */
function buildSubstituteTeacherHTML(ctx, teacherId, { dateStr, onlySubstitute }) {
  const { slots, assignByKey, teacherName, className, subjectName, timeMap, absenceMap } = ctx
  const rows = []

  // คาบที่ครูคนนี้รับสอนแทน
  const assigned = ctx.assignments
    .filter((a) => a.substitute_teacher_id === teacherId)
    .sort((a, b) => a.period - b.period)
  for (const a of assigned) {
    rows.push(`<tr>
      <td style="${TD}text-align:center;font-weight:700;">${a.period}</td>
      <td style="${TD}text-align:center;color:#64748b;">${esc(periodTime(a.period, timeMap))}</td>
      <td style="${TD}">${esc(className(a.class_id))}</td>
      <td style="${TD}">${esc(subjectName(a.subject_id))}</td>
      <td style="${TD}color:#c2410c;font-weight:700;">สอนแทน ${esc(teacherName(a.original_teacher_id))}${a.role === 'co' ? ` <span style="${CO_BADGE}">ครูร่วม</span>` : ''}</td>
      <td style="${TD}">${esc(absenceMap.get(a.original_teacher_id)?.reason || '—')}</td>
    </tr>`)
  }

  // โหมดทั้งตาราง: เพิ่มคาบปกติอื่นของวันนั้น (ที่ไม่ใช่คาบสอนแทน)
  if (!onlySubstitute) {
    const assignedKeys = new Set(assigned.map((a) => `${a.period}-${a.class_id}`))
    const normal = slots
      .filter((s) => (s.teacher_id === teacherId || s.coTeacherId === teacherId))
      .filter((s) => !assignedKeys.has(`${s.period}-${s.class_id}`))
      .sort((a, b) => a.period - b.period)
    for (const s of normal) {
      const isCo = s.teacher_id !== teacherId
      rows.push(`<tr>
        <td style="${TD}text-align:center;font-weight:700;">${s.period}</td>
        <td style="${TD}text-align:center;color:#64748b;">${esc(periodTime(s.period, timeMap))}</td>
        <td style="${TD}">${esc(className(s.class_id))}</td>
        <td style="${TD}">${esc(subjectName(s.subject_id))}</td>
        <td style="${TD}color:#475569;">สอนปกติ${isCo ? ` <span style="${CO_BADGE}">ครูร่วม</span>` : ''}</td>
        <td style="${TD}">—</td>
      </tr>`)
    }
  }

  if (rows.length === 0) return null

  return `
    <h2 style="${H2}">${esc(teacherName(teacherId))} — ตารางสอนแทน ${esc(formatThaiDate(dateStr))}</h2>
    <div style="font-size:11px;color:#64748b;margin-bottom:6px;">รับสอนแทน ${assigned.length} คาบ</div>
    <table style="${TABLE}">
      <thead><tr>
        <th style="${TH}width:9%;">คาบ</th>
        <th style="${TH}width:14%;">เวลา</th>
        <th style="${TH}width:16%;">ห้อง</th>
        <th style="${TH}width:22%;">วิชา</th>
        <th style="${TH}width:27%;">รายละเอียด</th>
        <th style="${TH}width:12%;">เหตุผล</th>
      </tr></thead>
      <tbody>${rows.join('')}</tbody>
    </table>
  `
}

/* ── D. ตารางของครูที่ลา ───────────────────────────────────────────── */
function buildAbsentTeacherHTML(ctx, absence, { dateStr }) {
  const { slots, assignByKey, teacherName, className, subjectName, timeMap } = ctx
  const teacherId = absence.teacherId
  const rows = []

  const teacherSlots = slots
    .filter((s) => s.teacher_id === teacherId || s.coTeacherId === teacherId)
    .filter((s) => isPeriodInRange(s.period, absence.periodRange, ctx.halves))
    .sort((a, b) => a.period - b.period)

  for (const s of teacherSlots) {
    const role = s.teacher_id === teacherId ? 'main' : 'co'
    const a = assignByKey.get(`${s.period}-${s.class_id}-${role}`)
    rows.push(`<tr>
      <td style="${TD}text-align:center;font-weight:700;">${s.period}</td>
      <td style="${TD}text-align:center;color:#64748b;">${esc(periodTime(s.period, timeMap))}</td>
      <td style="${TD}">${esc(className(s.class_id))}</td>
      <td style="${TD}">${esc(subjectName(s.subject_id))}${role === 'co' ? ` <span style="${CO_BADGE}">ครูร่วม</span>` : ''}</td>
      <td style="${TD}${a ? 'color:#15803d;font-weight:700;' : 'color:#b91c1c;font-weight:700;'}">
        ${a ? esc(teacherName(a.substitute_teacher_id)) : 'ยังไม่ได้จัดสอนแทน'}
      </td>
    </tr>`)
  }

  if (rows.length === 0) return null

  const uncovered = teacherSlots.filter((s) => {
    const role = s.teacher_id === teacherId ? 'main' : 'co'
    return !assignByKey.get(`${s.period}-${s.class_id}-${role}`)
  }).length

  return `
    <h2 style="${H2}">${esc(teacherName(teacherId))} — คาบที่ลา ${esc(formatThaiDate(dateStr))}</h2>
    <div style="font-size:11px;color:#64748b;margin-bottom:6px;">
      ช่วงที่ลา: <b>${RANGE_LABEL[absence.periodRange] || 'ทั้งวัน'}</b>
      ${absence.reason ? ` · เหตุผล: <b>${esc(absence.reason)}</b>` : ''}
      · สอน ${teacherSlots.length} คาบ
      ${uncovered > 0 ? ` · <span style="color:#b91c1c;font-weight:700;">ยังไม่ได้จัด ${uncovered} คาบ</span>` : ''}
    </div>
    <table style="${TABLE}">
      <thead><tr>
        <th style="${TH}width:9%;">คาบ</th>
        <th style="${TH}width:14%;">เวลา</th>
        <th style="${TH}width:16%;">ห้อง</th>
        <th style="${TH}width:31%;">วิชา</th>
        <th style="${TH}width:30%;">ครูสอนแทน</th>
      </tr></thead>
      <tbody>${rows.join('')}</tbody>
    </table>
  `
}

/**
 * สร้างหน้าเอกสารสอนแทนทั้งหมด
 * @returns {Array<{ id, label, kind, item: { name }, gridHTML }>}
 */
export function buildDailyPages({
  dateStr,
  dailySchedule,
  daySlots,
  classes = [],
  teachers = [],
  subjects = [],
  lessonBlockMap,
  scheduleBlocks = [],
  scheduleConfig,
  onlySubstitute = false,
  docs = { summary: true, classes: true, teachers: true, absent: true },
  note = '',
}) {
  const ctx = buildContext({
    dateStr, dailySchedule, daySlots, classes, teachers, subjects, lessonBlockMap,
    scheduleBlocks, scheduleConfig,
  })
  const pages = []
  const dateLabel = formatDDMMYYYY(dateStr)

  if (docs.summary) {
    pages.push({
      id: 'sub-summary',
      label: `สรุปสอนแทน ${dateLabel}`,
      kind: 'sub-summary',
      item: { name: `สรุปการสอนแทน ${dateLabel}` },
      gridHTML: buildSummaryHTML(ctx, { dateStr, note }),
    })
  }

  if (docs.classes) {
    for (const cls of classes) {
      const html = buildClassHTML(ctx, cls, { dateStr, onlySubstitute })
      if (!html) continue
      pages.push({
        id: `sub-class-${cls.id}`,
        label: `${cls.name} (สอนแทน)`,
        kind: 'sub-class',
        item: { name: `${cls.name} · ${dateLabel}` },
        gridHTML: html,
      })
    }
  }

  if (docs.teachers) {
    const teacherIds = [...new Set(ctx.assignments.map((a) => a.substitute_teacher_id))]
    for (const tid of teacherIds) {
      const html = buildSubstituteTeacherHTML(ctx, tid, { dateStr, onlySubstitute })
      if (!html) continue
      pages.push({
        id: `sub-teacher-${tid}`,
        label: `${ctx.teacherName(tid)} (รับสอนแทน)`,
        kind: 'sub-teacher',
        item: { name: `${ctx.teacherName(tid)} · ${dateLabel}` },
        gridHTML: html,
      })
    }
  }

  if (docs.absent) {
    for (const absence of ctx.absences) {
      const html = buildAbsentTeacherHTML(ctx, absence, { dateStr })
      if (!html) continue
      pages.push({
        id: `sub-absent-${absence.teacherId}`,
        label: `${ctx.teacherName(absence.teacherId)} (ครูที่ลา)`,
        kind: 'sub-absent',
        item: { name: `${ctx.teacherName(absence.teacherId)} · ${dateLabel}` },
        gridHTML: html,
      })
    }
  }

  return pages
}

/* ── Excel: 4 ชีต ───────────────────────────────────────────────────── */
/**
 * Export เอกสารสอนแทนรายวันเป็น .xlsx (4 ชีต)
 * @param {Object} opts — พารามิเตอร์เดียวกับ buildDailyPages + schoolName
 */
export async function exportDailyMultiExcel(opts) {
  const {
    dateStr, dailySchedule, daySlots, classes = [], teachers = [], subjects = [],
    lessonBlockMap, scheduleBlocks = [], scheduleConfig, schoolName = '',
  } = opts

  const ExcelJS = await import('exceljs')
  const Workbook = ExcelJS.default?.Workbook || ExcelJS.Workbook
  const ctx = buildContext({
    dateStr, dailySchedule, daySlots, classes, teachers, subjects, lessonBlockMap,
    scheduleBlocks, scheduleConfig,
  })

  const NAVY = 'FF1E293B'
  const SLATE = 'FFF1F5F9'
  const ORANGE = 'FFC2410C'
  const THIN = { style: 'thin', color: { argb: 'FFE2E8F0' } }
  const wb = new Workbook()
  wb.creator = 'ระบบจัดตารางสอนอัตโนมัติ'
  wb.created = new Date()

  const titleRow = (ws, text, span) => {
    ws.mergeCells(1, 1, 1, span)
    const c = ws.getCell(1, 1)
    c.value = text
    c.font = { bold: true, size: 13, color: { argb: NAVY } }
    c.alignment = { vertical: 'middle' }
    ws.getRow(1).height = 24
  }
  const headerRow = (ws, rowIdx, headers) => {
    headers.forEach((h, i) => {
      const c = ws.getCell(rowIdx, i + 1)
      c.value = h
      c.font = { bold: true, color: { argb: NAVY } }
      c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: SLATE } }
      c.border = { top: THIN, left: THIN, bottom: THIN, right: THIN }
    })
  }
  const borderRow = (ws, rowIdx, span) => {
    for (let i = 1; i <= span; i++) {
      ws.getCell(rowIdx, i).border = { top: THIN, left: THIN, bottom: THIN, right: THIN }
    }
  }

  // Sheet 1: สรุปสอนแทน
  const ws1 = wb.addWorksheet('สรุปสอนแทน', { views: [{ showGridLines: false }] })
  ws1.columns = [{ width: 10 }, { width: 14 }, { width: 14 }, { width: 22 }, { width: 22 }, { width: 22 }, { width: 14 }]
  titleRow(ws1, `${schoolName ? schoolName + ' — ' : ''}สรุปการสอนแทน ${formatThaiDate(dateStr)}`, 7)
  ws1.getCell(2, 1).value = `คาบเรียนวันนี้ ${ctx.summary.totalPeriods} คาบ · ต้องหาแทน ${ctx.summary.absentPositionCount} ตำแหน่ง · จัดแล้ว ${ctx.assignments.length} · ยังไม่ได้จัด ${ctx.summary.uncoveredCount}`
  ws1.getCell(2, 1).font = { size: 10, color: { argb: 'FF475569' } }
  headerRow(ws1, 4, ['คาบ', 'เวลา', 'ห้อง', 'วิชา', 'ครูเดิม', 'ครูสอนแทน', 'เหตุผล'])
  const sorted = [...ctx.assignments].sort((a, b) => a.period - b.period)
  sorted.forEach((a, idx) => {
    const r = idx + 5
    ws1.getCell(r, 1).value = a.period
    ws1.getCell(r, 2).value = periodTime(a.period, ctx.timeMap)
    ws1.getCell(r, 3).value = ctx.className(a.class_id)
    ws1.getCell(r, 4).value = ctx.subjectName(a.subject_id)
    ws1.getCell(r, 5).value = `${ctx.teacherName(a.original_teacher_id)}${a.role === 'co' ? ' (ครูร่วม)' : ''}`
    ws1.getCell(r, 6).value = ctx.teacherName(a.substitute_teacher_id)
    ws1.getCell(r, 6).font = { bold: true, color: { argb: ORANGE } }
    ws1.getCell(r, 7).value = ctx.absenceMap.get(a.original_teacher_id)?.reason || ''
    borderRow(ws1, r, 7)
  })

  // Sheet 2: ภาระสอนแทนรายครู
  const ws2 = wb.addWorksheet('ภาระสอนแทนรายครู', { views: [{ showGridLines: false }] })
  ws2.columns = [{ width: 30 }, { width: 14 }]
  titleRow(ws2, `ภาระสอนแทนรายครู ${formatThaiDate(dateStr)}`, 2)
  headerRow(ws2, 3, ['ครู', 'จำนวนคาบ'])
  substituteLoad(ctx.assignments, ctx.teacherName).forEach((r, idx) => {
    const row = idx + 4
    ws2.getCell(row, 1).value = r.name
    ws2.getCell(row, 2).value = r.count
    ws2.getCell(row, 2).alignment = { horizontal: 'center' }
    borderRow(ws2, row, 2)
  })

  // Sheet 3: ครูที่ลา
  const ws3 = wb.addWorksheet('ครูที่ลา', { views: [{ showGridLines: false }] })
  ws3.columns = [{ width: 30 }, { width: 14 }, { width: 18 }, { width: 14 }]
  titleRow(ws3, `ครูที่ลา / ไม่มา ${formatThaiDate(dateStr)}`, 4)
  headerRow(ws3, 3, ['ครู', 'ช่วงที่ลา', 'เหตุผล', 'คาบที่สอน'])
  ctx.absences.forEach((a, idx) => {
    const row = idx + 4
    const n = ctx.slots.filter((s) => (s.teacher_id === a.teacherId || s.coTeacherId === a.teacherId)
      && isPeriodInRange(s.period, a.periodRange, ctx.halves)).length
    ws3.getCell(row, 1).value = ctx.teacherName(a.teacherId)
    ws3.getCell(row, 2).value = RANGE_LABEL[a.periodRange] || 'ทั้งวัน'
    ws3.getCell(row, 3).value = a.reason || '—'
    ws3.getCell(row, 4).value = n
    ws3.getCell(row, 4).alignment = { horizontal: 'center' }
    borderRow(ws3, row, 4)
  })

  // Sheet 4: รายห้อง (คาบสอนแทนของแต่ละห้อง)
  const ws4 = wb.addWorksheet('รายห้อง', { views: [{ showGridLines: false }] })
  ws4.columns = [{ width: 16 }, { width: 9 }, { width: 12 }, { width: 22 }, { width: 22 }, { width: 22 }]
  titleRow(ws4, `คาบสอนแทนรายห้อง ${formatThaiDate(dateStr)}`, 6)
  headerRow(ws4, 3, ['ห้อง', 'คาบ', 'เวลา', 'วิชา', 'ครูเดิม', 'ครูสอนแทน'])
  let r4 = 4
  for (const cls of classes) {
    const clsSlots = ctx.slots.filter((s) => s.class_id === cls.id).sort((a, b) => a.period - b.period)
    for (const s of clsSlots) {
      const mainA = ctx.assignByKey.get(`${s.period}-${s.class_id}-main`)
      const coA = s.coTeacherId ? ctx.assignByKey.get(`${s.period}-${s.class_id}-co`) : null
      if (!mainA && !coA) continue
      ws4.getCell(r4, 1).value = cls.name
      ws4.getCell(r4, 2).value = s.period
      ws4.getCell(r4, 3).value = periodTime(s.period, ctx.timeMap)
      ws4.getCell(r4, 4).value = ctx.subjectName(s.subject_id)
      ws4.getCell(r4, 5).value = `${mainA ? ctx.teacherName(mainA.original_teacher_id) : ctx.teacherName(s.teacher_id)}${coA ? ` + ${ctx.teacherName(coA.original_teacher_id)}` : ''}`
      ws4.getCell(r4, 6).value = `${mainA ? ctx.teacherName(mainA.substitute_teacher_id) : ctx.teacherName(s.teacher_id)}${coA ? ` + ${ctx.teacherName(coA.substitute_teacher_id)}` : ''}`
      ws4.getCell(r4, 6).font = { bold: true, color: { argb: ORANGE } }
      borderRow(ws4, r4, 6)
      r4 += 1
    }
  }

  const safeDate = dateStr || 'today'
  const buffer = await wb.xlsx.writeBuffer()
  const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `สอนแทน_${safeDate}.xlsx`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}
