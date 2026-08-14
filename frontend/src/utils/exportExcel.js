/**
 * Excel Export — true .xlsx multi-sheet workbook via SheetJS.
 *
 * Generates a workbook with:
 *   - Sheet 1: "ภาพรวม" — Master Grid (flat list of all slots)
 *   - Per-class sheets: day × period grid for each class
 *   - Per-teacher sheets: day × period grid for each teacher
 *
 * Only sheets matching the selected scope checkboxes are included.
 *
 * Public API:
 *   exportMultiExcel(scope, data)      → void  (downloads .xlsx)
 *   exportToExcel(data)                → void  (legacy, classes only)
 */

import * as XLSX from 'xlsx'

const DAY_LABELS = ['จันทร์', 'อังคาร', 'พุธ', 'พฤหัสบดี', 'ศุกร์', 'เสาร์', 'อาทิตย์']

/**
 * Build a 2D array (AOA) for a single class timetable grid.
 * @returns {Array<Array<string>>} rows for SheetJS aoa_to_sheet
 */
function buildClassAOA({ cls, slots, subjects, teachers, gridConfig, userPlacements, lessonBlocks, fixedSlots }) {
  const { periodsPerDay = 7, lunchPeriods = [], daysPerWeek = 5 } = gridConfig
  const lunchSet = new Set(lunchPeriods)
  const subjectMap = new Map((subjects || []).map((s) => [s.id, s]))
  const teacherMap = new Map((teachers || []).map((t) => [t.id, t]))
  const lbMap = new Map((lessonBlocks || []).map((lb) => [lb.id, lb]))

  const fixedMap = new Map()
  for (const fs of (fixedSlots || [])) {
    fixedMap.set(`${fs.day}-${fs.period}`, fs)
  }

  // Build slot lookup: "day-period" -> slot
  const slotMap = new Map()
  for (const s of (slots || [])) {
    if (s.class_id !== cls.id) continue
    slotMap.set(`${s.day}-${s.period}`, s)
  }

  // Add user placements for this class
  for (const [lbId, placements] of Object.entries(userPlacements || {})) {
    const lb = lbMap.get(lbId)
    if (!lb || lb.class_id !== cls.id) continue
    for (const p of placements) {
      if (!slotMap.has(`${p.day}-${p.period}`)) {
        slotMap.set(`${p.day}-${p.period}`, {
          subject_id: lb.subject_id,
          teacher_id: lb.teacher_id,
          class_id: lb.class_id,
          day: p.day,
          period: p.period,
        })
      }
    }
  }

  // Header row
  const header = ['วัน \\ คาบ']
  for (let p = 1; p <= periodsPerDay; p++) {
    header.push(lunchSet.has(p) ? 'พัก' : String(p))
  }
  const rows = [header]

  // Day rows
  for (let d = 1; d <= daysPerWeek; d++) {
    const row = [DAY_LABELS[d - 1] || `วัน${d}`]
    for (let p = 1; p <= periodsPerDay; p++) {
      if (lunchSet.has(p)) {
        row.push('พักเที่ยง')
        continue
      }
      const fixed = fixedMap.get(`${d}-${p}`)
      if (fixed) {
        row.push(`🔒 ${fixed.name || 'กิจกรรมล็อก'}`)
        continue
      }
      const slot = slotMap.get(`${d}-${p}`)
      if (slot) {
        const subj = subjectMap.get(slot.subject_id)
        const teacher = teacherMap.get(slot.teacher_id)
        const cellText = [
          subj?.name || slot.subject_id,
          teacher?.name || '',
        ].filter(Boolean).join(' / ')
        row.push(cellText || '')
      } else {
        row.push('')
      }
    }
    rows.push(row)
  }

  return rows
}

/**
 * Build a 2D array (AOA) for a single teacher timetable grid.
 */
function buildTeacherAOA({ teacher, slots, subjects, classes, gridConfig, userPlacements, lessonBlocks, fixedSlots }) {
  const { periodsPerDay = 7, lunchPeriods = [], daysPerWeek = 5 } = gridConfig
  const lunchSet = new Set(lunchPeriods)
  const subjectMap = new Map((subjects || []).map((s) => [s.id, s]))
  const classMap = new Map((classes || []).map((c) => [c.id, c]))
  const lbMap = new Map((lessonBlocks || []).map((lb) => [lb.id, lb]))

  const fixedMap = new Map()
  for (const fs of (fixedSlots || [])) {
    fixedMap.set(`${fs.day}-${fs.period}`, fs)
  }

  // Build slot lookup for this teacher: "day-period" -> [slots]
  const slotMap = new Map()
  for (const s of (slots || [])) {
    if (s.teacher_id !== teacher.id) continue
    const key = `${s.day}-${s.period}`
    if (!slotMap.has(key)) slotMap.set(key, [])
    slotMap.get(key).push(s)
  }

  // Add user placements for this teacher
  for (const [lbId, placements] of Object.entries(userPlacements || {})) {
    const lb = lbMap.get(lbId)
    if (!lb || lb.teacher_id !== teacher.id) continue
    for (const p of placements) {
      const key = `${p.day}-${p.period}`
      if (!slotMap.has(key)) {
        slotMap.set(key, [{
          subject_id: lb.subject_id,
          teacher_id: lb.teacher_id,
          class_id: lb.class_id,
          day: p.day,
          period: p.period,
        }])
      }
    }
  }

  // Header row
  const header = ['วัน \\ คาบ']
  for (let p = 1; p <= periodsPerDay; p++) {
    header.push(lunchSet.has(p) ? 'พัก' : String(p))
  }
  const rows = [header]

  // Day rows
  for (let d = 1; d <= daysPerWeek; d++) {
    const row = [DAY_LABELS[d - 1] || `วัน${d}`]
    for (let p = 1; p <= periodsPerDay; p++) {
      if (lunchSet.has(p)) {
        row.push('พักเที่ยง')
        continue
      }
      const fixed = fixedMap.get(`${d}-${p}`)
      if (fixed) {
        row.push(`🔒 ${fixed.name || 'กิจกรรมล็อก'}`)
        continue
      }
      const cellSlots = slotMap.get(`${d}-${p}`) || []
      if (cellSlots.length > 0) {
        const cellText = cellSlots.map((s) => {
          const subj = subjectMap.get(s.subject_id)
          const cls = classMap.get(s.class_id)
          return [
            cls?.name || s.class_id,
            subj?.name || s.subject_id,
          ].filter(Boolean).join(' / ')
        }).join(' | ')
        row.push(cellText)
      } else {
        row.push('')
      }
    }
    rows.push(row)
  }

  return rows
}

/**
 * Build the master overview sheet (flat list of all slots).
 */
function buildMasterAOA({ slots, subjects, teachers, classes, userPlacements, lessonBlocks }) {
  const subjectMap = new Map((subjects || []).map((s) => [s.id, s]))
  const teacherMap = new Map((teachers || []).map((t) => [t.id, t]))
  const classMap = new Map((classes || []).map((c) => [c.id, c]))
  const lbMap = new Map((lessonBlocks || []).map((lb) => [lb.id, lb]))

  const header = ['วัน', 'คาบ', 'วิชา', 'ครูผู้สอน', 'ห้องเรียน', 'ประเภท']
  const rows = [header]

  // Solver slots
  for (const s of (slots || [])) {
    rows.push([
      DAY_LABELS[(s.day || 1) - 1] || `วัน${s.day}`,
      String(s.period || ''),
      subjectMap.get(s.subject_id)?.name || s.subject_id || '',
      teacherMap.get(s.teacher_id)?.name || s.teacher_id || '',
      classMap.get(s.class_id)?.name || s.class_id || '',
      userPlacements?.[s.lesson_block_id] ? '📌 วางด้วยมือ' : '🚀 ระบบจัด',
    ])
  }

  // User-only placements (not in solver slots)
  const solverBlockIds = new Set((slots || []).map((s) => s.lesson_block_id))
  for (const [lbId, placements] of Object.entries(userPlacements || {})) {
    if (solverBlockIds.has(lbId)) continue
    const lb = lbMap.get(lbId)
    if (!lb) continue
    for (const p of placements) {
      rows.push([
        DAY_LABELS[(p.day || 1) - 1] || `วัน${p.day}`,
        String(p.period || ''),
        subjectMap.get(lb.subject_id)?.name || lb.subject_id || '',
        teacherMap.get(lb.teacher_id)?.name || lb.teacher_id || '',
        classMap.get(lb.class_id)?.name || lb.class_id || '',
        '📌 วางด้วยมือ',
      ])
    }
  }

  return rows
}

/**
 * Sanitize a sheet name (Excel limits: 31 chars, no special chars).
 */
function sanitizeSheetName(name) {
  return (name || 'Sheet')
    .replace(/[\\/?*[\]:]+/g, '_')
    .slice(0, 31)
}

/**
 * Export timetable to a true .xlsx workbook with multiple sheets.
 *
 * @param {{ classes: boolean, teachers: boolean }} scope
 * @param {Object} data — export data payload
 */
export function exportMultiExcel(scope, data) {
  const { slots, classes, subjects, teachers, gridConfig, userPlacements, lessonBlocks, fixedSlots, label } = data
  const wb = XLSX.utils.book_new()

  // Sheet 1: Master overview
  const masterAOA = buildMasterAOA({ slots, subjects, teachers, classes, userPlacements, lessonBlocks })
  const masterSheet = XLSX.utils.aoa_to_sheet(masterAOA)
  // Set column widths
  masterSheet['!cols'] = [
    { wch: 10 }, { wch: 6 }, { wch: 20 }, { wch: 20 }, { wch: 15 }, { wch: 14 },
  ]
  XLSX.utils.book_append_sheet(wb, masterSheet, 'ภาพรวม')

  // Per-class sheets
  if (scope.classes) {
    for (const cls of (classes || [])) {
      const aoa = buildClassAOA({
        cls, slots, subjects, teachers, gridConfig, userPlacements, lessonBlocks, fixedSlots,
      })
      const sheet = XLSX.utils.aoa_to_sheet(aoa)
      // Auto column widths
      const colCount = aoa[0]?.length || 1
      sheet['!cols'] = Array.from({ length: colCount }, (_, i) => ({ wch: i === 0 ? 12 : 18 }))
      XLSX.utils.book_append_sheet(wb, sheet, sanitizeSheetName(cls.name))
    }
  }

  // Per-teacher sheets
  if (scope.teachers) {
    for (const teacher of (teachers || [])) {
      const aoa = buildTeacherAOA({
        teacher, slots, subjects, classes, gridConfig, userPlacements, lessonBlocks, fixedSlots,
      })
      const sheet = XLSX.utils.aoa_to_sheet(aoa)
      const colCount = aoa[0]?.length || 1
      sheet['!cols'] = Array.from({ length: colCount }, (_, i) => ({ wch: i === 0 ? 12 : 22 }))
      XLSX.utils.book_append_sheet(wb, sheet, sanitizeSheetName(teacher.name))
    }
  }

  const safeLabel = (label || 'timetable').replace(/[^\w\u0E00-\u0E7F-]+/g, '_')
  const dateStr = new Date().toISOString().slice(0, 10)
  const filename = `${safeLabel}_${dateStr}.xlsx`

  XLSX.writeFile(wb, filename)
}

/**
 * Legacy CSV export (kept for backward compatibility).
 * Generates one CSV per class.
 */
export function exportToExcel({ slots, classes, subjects, teachers, gridConfig, userPlacements, lessonBlocks, fixedSlots, label }) {
  // Delegate to the new multi-sheet exporter (classes only, for legacy callers)
  exportMultiExcel({ classes: true, teachers: false }, {
    slots, classes, subjects, teachers, gridConfig, userPlacements, lessonBlocks, fixedSlots, label,
  })
}
