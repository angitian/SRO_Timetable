/**
 * Excel Export — 2 master sheets with stacked styled timetable grids.
 *
 * Uses ExcelJS for full cell styling support (fills, fonts, borders, alignment,
 * merged cells, page breaks) which SheetJS Community Edition does not support.
 *
 * Output workbook structure:
 *   - Sheet 1: "ตารางห้องเรียนทั้งหมด" — every class grid stacked vertically
 *   - Sheet 2: "ตารางครูทุกคน"        — every teacher grid stacked vertically
 *
 * Only sheets matching the selected scope checkboxes are included.
 *
 * Public API:
 *   exportMultiExcel(scope, data) → Promise<void>  (downloads .xlsx)
 *   exportToExcel(data)           → Promise<void>  (legacy, classes only)
 */

import { teacherSupervisesFixedSlot } from './teacherLoad.js'

const DAY_LABELS = ['จันทร์', 'อังคาร', 'พุธ', 'พฤหัสบดี', 'ศุกร์', 'เสาร์', 'อาทิตย์']

// ── Style constants ───────────────────────────────────────────────────────
const COLOR_NAVY = 'FF1E3A8A'      // Section header fill
const COLOR_SLATE = 'FFE2E8F0'     // Column header fill
const COLOR_LUNCH = 'FFF1F5F9'     // Lunch cell fill
const COLOR_WHITE = 'FFFFFFFF'
const COLOR_GRAY_TEXT = 'FF6B7280'
const COLOR_DARK_TEXT = 'FF1F2937'
const THIN_BORDER = {
  top: { style: 'thin', color: { argb: 'FFD1D5DB' } },
  left: { style: 'thin', color: { argb: 'FFD1D5DB' } },
  bottom: { style: 'thin', color: { argb: 'FFD1D5DB' } },
  right: { style: 'thin', color: { argb: 'FFD1D5DB' } },
}

/**
 * Build a lookup map for a single class: "day-period" → { subjectName, teacherName, isFixed, fixedName }
 */
function buildClassCellMap(cls, ctx) {
  const { slotMap, fixedMap, getFixedSlotsFor, getSubstituteFor, userPlacementMap, subjectMap, teacherMap, userPlacements, lessonBlockMap } = ctx
  const map = new Map()

  // Solver slots for this class
  for (const [key, slots] of slotMap.entries()) {
    const slot = slots.find((s) => s.class_id === cls.id)
    if (!slot) continue
    const subj = subjectMap.get(slot.subject_id)
    const teacher = teacherMap.get(slot.teacher_id)
    const lb = lessonBlockMap.get(slot.lesson_block_id)
    const coTeacher = (lb && lb.co_teacher_id) ? teacherMap.get(lb.co_teacher_id) : null
    const [d, p] = key.split('-').map(Number)
    const sub = getSubstituteFor(d, p, cls.id)
    const subTeacher = sub ? teacherMap.get(sub.substitute_teacher_id) : null
    const subOriginal = sub ? (teacherMap.get(sub.original_teacher_id)?.name || sub.original_teacher_id) : null
    map.set(key, {
      subjectName: subj?.name || slot.subject_id,
      teacherName: subTeacher ? (subTeacher.name || subTeacher.id) : (teacher?.name || ''),
      originalName: sub ? subOriginal : null,
      isSubstitute: !!sub,
      ...(!sub && coTeacher ? { coTeacherName: coTeacher.name || coTeacher.id } : {}),
    })
  }

  // User placements for this class (only fill empty cells)
  for (const [lbId, placements] of Object.entries(userPlacements || {})) {
    const lb = lessonBlockMap.get(lbId)
    if (!lb || lb.class_id !== cls.id) continue
    for (const p of placements) {
      const key = `${p.day}-${p.period}`
      if (!map.has(key)) {
        const subj = subjectMap.get(lb.subject_id)
        const teacher = teacherMap.get(lb.teacher_id)
        const coTeacher = lb.co_teacher_id ? teacherMap.get(lb.co_teacher_id) : null
        const sub = getSubstituteFor(p.day, p.period, cls.id)
        const subTeacher = sub ? teacherMap.get(sub.substitute_teacher_id) : null
        const subOriginal = sub ? (teacherMap.get(sub.original_teacher_id)?.name || sub.original_teacher_id) : null
        map.set(key, {
          subjectName: subj?.name || lb.subject_id,
          teacherName: subTeacher ? (subTeacher.name || subTeacher.id) : (teacher?.name || ''),
          originalName: sub ? subOriginal : null,
          isSubstitute: !!sub,
          ...(!sub && coTeacher ? { coTeacherName: coTeacher.name || coTeacher.id } : {}),
        })
      }
    }
  }

  // Fixed slots (override everything) — class-aware only
  const days = ctx.dayList || []
  const periods = ctx.periodList || []
  for (const d of days) {
    for (const p of periods) {
      const fixed = getFixedSlotsFor(d, p, cls.id)[0]
      if (fixed) {
        map.set(`${d}-${p}`, { isFixed: true, fixedName: fixed.name || 'กิจกรรมล็อก' })
      }
    }
  }

  return map
}

/**
 * Build a lookup map for a single teacher: "day-period" → [{ subjectName, className }]
 */
function buildTeacherCellMap(teacher, ctx) {
  const { slotMap, substituteMap, subjectMap, classMap, teacherMap, userPlacements, lessonBlockMap } = ctx
  const map = new Map()

  // Solver slots for this teacher (includes co-taught, resolved from the
  // lesson block or the slot's own co_teacher_id from newer backends)
  for (const [key, slots] of slotMap.entries()) {
    const teacherSlots = slots.filter((s) => {
      if (s.teacher_id === teacher.id) return true
      const lb = lessonBlockMap.get(s.lesson_block_id)
      if (lb && lb.co_teacher_id === teacher.id) return true
      return s.co_teacher_id === teacher.id
    })
    if (teacherSlots.length === 0) continue
    map.set(key, teacherSlots.map((s) => {
      const lb = lessonBlockMap.get(s.lesson_block_id)
      const coTeacherId = (lb && lb.co_teacher_id) || s.co_teacher_id || null
      return {
        subjectName: subjectMap.get(s.subject_id)?.name || s.subject_id,
        className: classMap.get(s.class_id)?.name || s.class_id,
        mainTeacherName: teacherMap.get(s.teacher_id)?.name || s.teacher_id,
        coTeacherName: coTeacherId ? (teacherMap.get(coTeacherId)?.name || coTeacherId) : null,
      }
    }))
  }

  // User placements for this teacher (only fill empty cells)
  for (const [lbId, placements] of Object.entries(userPlacements || {})) {
    const lb = lessonBlockMap.get(lbId)
    if (!lb || (lb.teacher_id !== teacher.id && lb.co_teacher_id !== teacher.id)) continue
    for (const p of placements) {
      const key = `${p.day}-${p.period}`
      if (!map.has(key)) {
        const coTeacherId = lb.co_teacher_id || null
        map.set(key, [{
          subjectName: subjectMap.get(lb.subject_id)?.name || lb.subject_id,
          className: classMap.get(lb.class_id)?.name || lb.class_id,
          mainTeacherName: teacherMap.get(lb.teacher_id)?.name || lb.teacher_id,
          coTeacherName: coTeacherId ? (teacherMap.get(coTeacherId)?.name || coTeacherId) : null,
        }])
      }
    }
  }

  // Substitute duties (สอนแทน) for this teacher
  for (const sub of substituteMap.values()) {
    if (sub.substitute_teacher_id !== teacher.id) continue
    const key = `${sub.day}-${sub.period}`
    const entries = map.get(key) || []
    entries.push({
      subjectName: subjectMap.get(sub.subject_id)?.name || sub.subject_id,
      className: classMap.get(sub.class_id)?.name || sub.class_id,
      isSubstitute: true,
    })
    map.set(key, entries)
  }

  // Fixed slots (override) — only กิจกรรมที่ครูคนนี้เป็นผู้ดูแล (fs.class_teachers)
  for (const fs of (ctx.fixedSlots || [])) {
    if (!teacherSupervisesFixedSlot(fs, teacher.id)) continue
    for (const p of [fs.period, ...(fs.periods || [])]) {
      map.set(`${fs.day}-${p}`, { isFixed: true, fixedName: fs.name || 'กิจกรรมล็อก' })
    }
  }

  return map
}

/**
 * Format cell content for a class grid cell.
 * Returns "วิชา\nผู้สอน" or "🔒 name" or "พักเที่ยง" or "".
 */
function formatClassCell(entry, isLunch) {
  if (isLunch) return 'พักเที่ยง'
  if (!entry) return ''
  if (entry.isFixed) return `🔒 ${entry.fixedName}`
  const teacherName = entry.isSubstitute
    ? `${entry.teacherName}${entry.originalName ? ` (แทน ${entry.originalName})` : ''}`
    : entry.coTeacherName
      ? `${entry.teacherName} + ${entry.coTeacherName}`
      : entry.teacherName
  const parts = [entry.subjectName, teacherName, entry.isSubstitute ? '🔁 สอนแทน' : ''].filter(Boolean)
  return parts.join('\n')
}

/**
 * Format cell content for a teacher grid cell.
 * Returns "วิชา\nห้องเรียน" (multiple slots separated by blank line) or fixed/lunch/empty.
 */
function formatTeacherCell(entry, isLunch) {
  if (isLunch) return 'พักเที่ยง'
  if (!entry) return ''
  if (entry.isFixed) return `🔒 ${entry.fixedName}`
  // entry is an array of { subjectName, className, mainTeacherName?, coTeacherName? }
  return entry.map((s) => `${s.subjectName}\n${s.className}${s.coTeacherName ? `\n👥 ${s.mainTeacherName} + ${s.coTeacherName}` : ''}${s.isSubstitute ? '\n🔁 สอนแทน' : ''}`).join('\n\n')
}

/**
 * Format cell content for a facility (special room) grid cell.
 * Returns "ห้องเรียน\nวิชา\nครู" or empty.
 */
function formatFacilityCell(entry, isLunch) {
  if (isLunch) return 'พักเที่ยง'
  if (!entry) return ''
  if (entry.isFixed) return `🔒 ${entry.fixedName}`
  const parts = [entry.className, entry.subjectName, entry.teacherName].filter(Boolean)
  return parts.join('\n')
}

/**
 * Draw one timetable block on a worksheet starting at startRow.
 * Returns the next available row index (after block + 2 blank rows).
 *
 * @param {import('exceljs').Worksheet} sheet
 * @param {number} startRow — 1-based row index
 * @param {string} title — section header text
 * @param {Map} cellMap — "day-period" → cell data
 * @param {Object} ctx — export context
 * @param {'class'|'teacher'} mode
 * @returns {number} next start row
 */
function buildBlockOnSheet(sheet, startRow, title, cellMap, ctx, mode) {
  const { dayList, periodList, lunchSet, breakSet } = ctx
  const colCount = periodList.length + 1 // +1 for day column
  const lastCol = colCount // 1-based column index

  // ── Column widths: BREAK columns narrower (~30%) than regular columns ──
  sheet.getColumn(1).width = 10 // day column
  for (let i = 0; i < periodList.length; i++) {
    const p = periodList[i]
    sheet.getColumn(i + 2).width = breakSet.has(p) ? 3 : 12
  }

  // ── Row 1: Section Header (merged) ──
  const headerRow = sheet.getRow(startRow)
  headerRow.getCell(1).value = title
  sheet.mergeCells(startRow, 1, startRow, lastCol)
  for (let c = 1; c <= lastCol; c++) {
    const cell = headerRow.getCell(c)
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLOR_NAVY } }
    cell.font = { name: 'TH Sarabun New', size: 14, bold: true, color: { argb: COLOR_WHITE } }
    cell.alignment = { horizontal: 'center', vertical: 'middle' }
    cell.border = THIN_BORDER
  }
  headerRow.height = 28

  // ── Row 2: Column Header ──
  const colHeaderRow = sheet.getRow(startRow + 1)
  colHeaderRow.getCell(1).value = 'วัน \\ คาบ'
  for (let i = 0; i < periodList.length; i++) {
    const p = periodList[i]
    const isLunch = lunchSet.has(p)
    const isBreak = breakSet.has(p)
    colHeaderRow.getCell(i + 2).value = isLunch ? 'พัก' : isBreak ? 'พัก' : `คาบ ${p}`
  }
  for (let c = 1; c <= lastCol; c++) {
    const cell = colHeaderRow.getCell(c)
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLOR_SLATE } }
    cell.font = { name: 'TH Sarabun New', size: 10, bold: true, color: { argb: COLOR_DARK_TEXT } }
    cell.alignment = { horizontal: 'center', vertical: 'middle' }
    cell.border = THIN_BORDER
  }
  colHeaderRow.height = 20

  // ── Data Rows: one per day ──
  const formatter = mode === 'class' ? formatClassCell : mode === 'teacher' ? formatTeacherCell : formatFacilityCell
  for (let di = 0; di < dayList.length; di++) {
    const d = dayList[di]
    const rowIdx = startRow + 2 + di
    const row = sheet.getRow(rowIdx)
    row.getCell(1).value = DAY_LABELS[d - 1] || `วัน${d}`
    // Day cell style
    const dayCell = row.getCell(1)
    dayCell.font = { name: 'TH Sarabun New', size: 10, bold: true, color: { argb: COLOR_DARK_TEXT } }
    dayCell.alignment = { horizontal: 'center', vertical: 'middle' }
    dayCell.border = THIN_BORDER

    for (let pi = 0; pi < periodList.length; pi++) {
      const p = periodList[pi]
      const isLunch = lunchSet.has(p)
      const isBreak = breakSet.has(p)
      const key = `${d}-${p}`
      const entry = cellMap.get(key)
      const cell = row.getCell(pi + 2)
      cell.value = formatter(entry, isLunch || isBreak)
      cell.border = THIN_BORDER
      if (isLunch) {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLOR_LUNCH } }
        cell.font = { name: 'TH Sarabun New', size: 10, color: { argb: COLOR_GRAY_TEXT } }
        cell.alignment = { horizontal: 'center', vertical: 'middle' }
      } else if (isBreak) {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLOR_LUNCH } }
        cell.font = { name: 'TH Sarabun New', size: 9, color: { argb: COLOR_GRAY_TEXT } }
        cell.alignment = { horizontal: 'center', vertical: 'middle' }
      } else if (entry?.isFixed) {
        cell.font = { name: 'TH Sarabun New', size: 10, color: { argb: COLOR_DARK_TEXT } }
        cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true }
      } else {
        cell.font = { name: 'TH Sarabun New', size: 10, color: { argb: COLOR_DARK_TEXT } }
        cell.alignment = { horizontal: 'center', vertical: 'top', wrapText: true }
      }
    }
    row.height = 42
  }

  // ── 2 blank rows after block ──
  const dataEndRow = startRow + 1 + dayList.length // last data row
  const blankRow1 = dataEndRow + 1
  const blankRow2 = dataEndRow + 2

  // Apply thin borders to blank rows (subtle separator)
  for (let c = 1; c <= lastCol; c++) {
    sheet.getRow(blankRow1).getCell(c).border = { style: 'none' }
    sheet.getRow(blankRow2).getCell(c).border = { style: 'none' }
  }

  // ── Page break after block ──
  // ExcelJS: add row break after the last data row so each block prints on its own page
  sheet.getRow(blankRow2).addPageBreak()

  // Commit rows to ensure they're written
  headerRow.commit()
  colHeaderRow.commit()
  for (let di = 0; di < dayList.length; di++) {
    sheet.getRow(startRow + 2 + di).commit()
  }

  // Next block starts after 2 blank rows
  return blankRow2 + 1
}

/**
 * Configure worksheet page setup and column widths.
 */
function setupSheetLayout(sheet, colCount) {
  // Column widths: Col A = 14, Col B+ = 20
  sheet.getColumn(1).width = 14
  for (let c = 2; c <= colCount; c++) {
    sheet.getColumn(c).width = 20
  }

  // Page setup: A4 landscape
  sheet.pageSetup.paperSize = sheet.pageSetup.paperSize || 9 // A4
  sheet.pageSetup.orientation = 'landscape'
  sheet.pageSetup.fitToPage = true
  sheet.pageSetup.fitToWidth = 1
  sheet.pageSetup.fitToHeight = 0 // 0 = auto (don't force fit to 1 page tall)
  sheet.pageMargins = {
    left: 0.4, right: 0.4, top: 0.5, bottom: 0.5, header: 0.3, footer: 0.3,
  }
}

/**
 * Build the "ตารางห้องเรียนทั้งหมด" sheet with all class grids stacked vertically.
 */
function buildClassesSheet(wb, ctx) {
  const sheet = wb.addWorksheet('ตารางห้องเรียนทั้งหมด', {
    views: [{ showGridLines: false }],
  })
  const colCount = ctx.periodList.length + 1
  setupSheetLayout(sheet, colCount)

  let row = 1
  for (const cls of ctx.classes) {
    const cellMap = buildClassCellMap(cls, ctx)
    const title = `ตารางเรียน ${cls.name}`
    row = buildBlockOnSheet(sheet, row, title, cellMap, ctx, 'class')
  }
}

/**
 * Build the "ตารางครูทุกคน" sheet with all teacher grids stacked vertically.
 */
function buildTeachersSheet(wb, ctx) {
  const sheet = wb.addWorksheet('ตารางครูทุกคน', {
    views: [{ showGridLines: false }],
  })
  const colCount = ctx.periodList.length + 1
  setupSheetLayout(sheet, colCount)

  let row = 1
  for (const teacher of ctx.teachers) {
    const cellMap = buildTeacherCellMap(teacher, ctx)
    const title = `ตารางสอน ครู${teacher.name}`
    row = buildBlockOnSheet(sheet, row, title, cellMap, ctx, 'teacher')
  }
}

/**
 * Build a cell map for a single facility (special room):
 * "day-period" → { subjectName, teacherName, className }
 */
function buildFacilityCellMap(room, ctx) {
  const { slotMap, subjectMap, teacherMap, classMap } = ctx
  const map = new Map()
  for (const [key, slots] of slotMap.entries()) {
    const slot = slots.find((s) => s.room_id === room.id)
    if (!slot) continue
    const subj = subjectMap.get(slot.subject_id)
    const teacher = teacherMap.get(slot.teacher_id)
    const cls = classMap.get(slot.class_id)
    map.set(key, {
      subjectName: subj?.name || slot.subject_id,
      teacherName: teacher?.name || '',
      className: cls?.name || slot.class_id,
    })
  }
  return map
}

/**
 * Build the "ตารางห้องพิเศษ" sheet with all facility grids stacked vertically.
 */
function buildFacilitiesSheet(wb, ctx) {
  const sheet = wb.addWorksheet('ตารางห้องพิเศษ', {
    views: [{ showGridLines: false }],
  })
  const colCount = ctx.periodList.length + 1
  setupSheetLayout(sheet, colCount)

  let row = 1
  for (const room of (ctx.specialRooms || [])) {
    const cellMap = buildFacilityCellMap(room, ctx)
    const typeLabel = room.room_type ? ` (${room.room_type})` : ''
    const title = `ตารางใช้ห้อง ${room.name}${typeLabel}`
    row = buildBlockOnSheet(sheet, row, title, cellMap, ctx, 'facility')
  }
}

/**
 * Build the export context (shared lookup maps) from raw data.
 */
function buildExportContext(data) {
  const { slots, classes, subjects, teachers, gridConfig, userPlacements, lessonBlocks, fixedSlots, specialRooms } = data
  const { periodsPerDay = 7, lunchPeriods = [], breakPeriods = [], daysPerWeek = 5 } = gridConfig

  const subjectMap = new Map((subjects || []).map((s) => [s.id, s]))
  const teacherMap = new Map((teachers || []).map((t) => [t.id, t]))
  const classMap = new Map((classes || []).map((c) => [c.id, c]))
  const lessonBlockMap = new Map((lessonBlocks || []).map((lb) => [lb.id, lb]))
  const lunchSet = new Set(lunchPeriods)
  const breakSet = new Set(breakPeriods)

  const fixedMap = new Map()
  for (const fs of (fixedSlots || [])) {
    const periods = (fs.periods && fs.periods.length > 0) ? [fs.period, ...fs.periods] : [fs.period]
    for (const p of periods) {
      const base = `${fs.day}-${p}`
      const targets = (!fs.class_ids || fs.class_ids.length === 0) ? [null] : fs.class_ids
      for (const cid of targets) {
        const key = cid ? `${base}-${cid}` : base
        if (!fixedMap.has(key)) fixedMap.set(key, [])
        fixedMap.get(key).push(fs)
      }
    }
  }
  // Class-aware fixed slot lookup: "d-p" (all classes) + "d-p-classId" (specific)
  const getFixedSlotsFor = (d, p, classId) => {
    const result = [...(fixedMap.get(`${d}-${p}`) || [])]
    if (classId) {
      result.push(...(fixedMap.get(`${d}-${p}-${classId}`) || []))
    }
    return result
  }
  // Substitute (สอนแทน) lookup
  const substituteMap = new Map()
  for (const s of (data.substitutes || [])) {
    substituteMap.set(`${s.day}-${s.period}-${s.class_id}`, s)
  }
  const getSubstituteFor = (d, p, classId) => substituteMap.get(`${d}-${p}-${classId}`) || null

  const slotMap = new Map()
  for (const s of (slots || [])) {
    const key = `${s.day}-${s.period}`
    if (!slotMap.has(key)) slotMap.set(key, [])
    slotMap.get(key).push(s)
  }

  const dayList = Array.from({ length: daysPerWeek }, (_, i) => i + 1)
  // Use explicit periodList from gridConfig (supports decimals for inserted
  // short breaks); fall back to integer range 1..periodsPerDay.
  const periodList = (gridConfig?.periodList && gridConfig.periodList.length > 0)
    ? gridConfig.periodList
    : Array.from({ length: periodsPerDay }, (_, i) => i + 1)

  return {
    classes: classes || [],
    teachers: teachers || [],
    specialRooms: specialRooms || [],
    userPlacements: userPlacements || {},
    fixedSlots: fixedSlots || [],
    subjectMap, teacherMap, classMap, lessonBlockMap,
    lunchSet, breakSet, fixedMap, slotMap, getFixedSlotsFor, substituteMap, getSubstituteFor,
    dayList, periodList,
  }
}

/**
 * Export timetable to a styled .xlsx workbook with 2 master sheets.
 *
 * @param {{ classes: boolean, teachers: boolean }} scope
 * @param {Object} data — export data payload
 * @returns {Promise<void>}
 */
export async function exportMultiExcel(scope, data) {
  // Dynamic import to keep exceljs out of the initial bundle
  const ExcelJS = await import('exceljs')
  const Workbook = ExcelJS.default?.Workbook || ExcelJS.Workbook

  const ctx = buildExportContext(data)
  const wb = new Workbook()
  wb.creator = 'ระบบจัดตารางสอนอัตโนมัติ'
  wb.created = new Date()

  if (scope.classes && ctx.classes.length > 0) {
    buildClassesSheet(wb, ctx)
  }

  if (scope.teachers && ctx.teachers.length > 0) {
    buildTeachersSheet(wb, ctx)
  }

  if (scope.facilities && ctx.specialRooms.length > 0) {
    buildFacilitiesSheet(wb, ctx)
  }

  // Generate filename
  const safeLabel = (data.label || 'timetable').replace(/[^\w\u0E00-\u0E7F-]+/g, '_')
  const dateStr = new Date().toISOString().slice(0, 10)
  const filename = `${safeLabel}_${dateStr}.xlsx`

  // Write to blob and trigger download
  const buffer = await wb.xlsx.writeBuffer()
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

/**
 * Legacy export (kept for backward compatibility) — classes only.
 * @param {Object} data — export data payload
 * @returns {Promise<void>}
 */
export function exportToExcel(data) {
  return exportMultiExcel({ classes: true, teachers: false }, data)
}
