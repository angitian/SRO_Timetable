/**
 * Unified Export Engine — orchestrates multi-class / multi-teacher exports
 * across PDF, PNG, and Excel formats.
 *
 * Builds self-contained static HTML grids (no React mounting required) that
 * mirror the on-screen timetable layout, then hands them off to the format-
 * specific exporters (exportPdf, exportImage, exportExcel).
 *
 * Public API:
 *   runExport({ format, scope, data, onProgress }) → Promise<void>
 *     format: 'pdf' | 'png' | 'xlsx'
 *     scope:  { classes: boolean, teachers: boolean }
 *     data:   { slots, classes, subjects, teachers, gridConfig,
 *               userPlacements, lessonBlocks, fixedSlots, label }
 */

import { exportMultiPagePDF } from './exportPdf.js'
import { exportMultiPNG } from './exportImage.js'
import { exportMultiExcel } from './exportExcel.js'

const DAY_LABELS = ['', 'จันทร์', 'อังคาร', 'พุธ', 'พฤหัสบดี', 'ศุกร์', 'เสาร์', 'อาทิตย์']

// ── Class color palette (mirrors GridCell.jsx CLASS_COLORS) ──────────────
const CLASS_COLOR_HEX = [
  { bg: '#dbeafe', border: '#60a5fa', text: '#1e3a8a' },
  { bg: '#ffe4e6', border: '#fb7185', text: '#9f1239' },
  { bg: '#ccfbf1', border: '#2dd4bf', text: '#134e4a' },
  { bg: '#fef3c7', border: '#fbbf24', text: '#78350f' },
  { bg: '#f3e8ff', border: '#c084fc', text: '#581c87' },
  { bg: '#cffafe', border: '#22d3ee', text: '#155e75' },
  { bg: '#ffedd5', border: '#fb923c', text: '#7c2d12' },
  { bg: '#dcfce7', border: '#4ade80', text: '#14532d' },
  { bg: '#fce7f3', border: '#f472b6', text: '#831843' },
  { bg: '#e0e7ff', border: '#818cf8', text: '#312e81' },
  { bg: '#ecfccb', border: '#a3e635', text: '#365314' },
  { bg: '#ede9fe', border: '#a78bfa', text: '#4c1d95' },
]

// ── Subject color palette (mirrors subjectColors.js) ─────────────────────
const SUBJECT_COLOR_FALLBACK = { bg: '#e0f2fe', border: '#7dd3fc', text: '#075985' }

/**
 * Resolve display data for a single cell in a class grid.
 * Returns { kind, subjectName, teacherName, fixedName, isPreAssigned }
 */
function resolveClassCell({ day, period, classId, slotMap, fixedMap, userPlacementMap, subjectMap, teacherMap, lessonBlockMap, userPlacements }) {
  const fixed = fixedMap.get(`${day}-${period}`)
  if (fixed) return { kind: 'fixed', fixedName: fixed.name || 'กิจกรรมล็อก' }

  const slots = (slotMap.get(`${day}-${period}`) || []).filter((s) => s.class_id === classId)
  const slot = slots[0] || null
  const userPlacement = userPlacementMap.get(`${day}-${period}-${classId}`)

  if (slot) {
    const subj = subjectMap.get(slot.subject_id)
    const teacher = teacherMap.get(slot.teacher_id)
    const isPreAssigned = !!userPlacements[slot.lesson_block_id]
    return {
      kind: 'lesson',
      subjectName: subj?.name || slot.subject_id,
      teacherName: teacher?.name || '',
      isPreAssigned,
      subjectId: slot.subject_id,
    }
  }

  if (userPlacement) {
    const lb = userPlacement.lessonBlock
    const subj = subjectMap.get(lb.subject_id)
    const teacher = teacherMap.get(lb.teacher_id)
    return {
      kind: 'lesson',
      subjectName: subj?.name || lb.subject_id,
      teacherName: teacher?.name || '',
      isPreAssigned: true,
      subjectId: lb.subject_id,
    }
  }

  return { kind: 'empty' }
}

/**
 * Resolve display data for a single cell in a teacher grid.
 * Returns { kind, slots: [{ subjectName, className, classId }] }
 */
function resolveTeacherCell({ day, period, teacherId, slotMap, fixedMap, subjectMap, classMap }) {
  const fixed = fixedMap.get(`${day}-${period}`)
  if (fixed) return { kind: 'fixed', fixedName: fixed.name || 'กิจกรรมล็อก' }

  const slots = (slotMap.get(`${day}-${period}`) || []).filter((s) => s.teacher_id === teacherId)
  if (slots.length === 0) return { kind: 'empty' }

  return {
    kind: 'lessons',
    slots: slots.map((s) => ({
      subjectName: subjectMap.get(s.subject_id)?.name || s.subject_id,
      className: classMap.get(s.class_id)?.name || s.class_id,
      classId: s.class_id,
      subjectId: s.subject_id,
    })),
  }
}

/**
 * Build a self-contained HTML string for a single class timetable grid.
 * @returns { string } HTML with inline styles, ready for print/capture.
 */
export function buildClassGridHTML(cls, ctx) {
  const { lunchSet, dayList, periodList } = ctx
  const cellStyle = `border:1px solid #d1d5db;border-radius:6px;padding:6px 8px;min-height:62px;font-size:12px;display:flex;flex-direction:column;justify-content:center;overflow:hidden;`

  const headerCells = periodList
    .map((p) => {
      const isLunch = lunchSet.has(p)
      return `<div style="${cellStyle}background:${isLunch ? '#f3f4f6' : '#fff'};text-align:center;font-weight:700;color:${isLunch ? '#9ca3af' : '#374151'};min-height:36px;justify-content:center;">${isLunch ? 'พัก' : p}</div>`
    })
    .join('')

  const rows = dayList
    .map((d) => {
      const cells = periodList
        .map((p) => {
          const isLunch = lunchSet.has(p)
          if (isLunch) {
            return `<div style="${cellStyle}background:#f3f4f6;color:#9ca3af;text-align:center;justify-content:center;">พักเที่ยง</div>`
          }
          const cell = resolveClassCell({
            day: d, period: p, classId: cls.id,
            slotMap: ctx.slotMap, fixedMap: ctx.fixedMap,
            userPlacementMap: ctx.userPlacementMap,
            subjectMap: ctx.subjectMap, teacherMap: ctx.teacherMap,
            lessonBlockMap: ctx.lessonBlockMap, userPlacements: ctx.userPlacements,
          })
          if (cell.kind === 'fixed') {
            return `<div style="${cellStyle}background:#fef9c3;border-color:#facc15;color:#713f12;text-align:center;justify-content:center;">🔒 ${cell.fixedName}</div>`
          }
          if (cell.kind === 'lesson') {
            const pinIcon = cell.isPreAssigned ? '📌 ' : ''
            return `<div style="${cellStyle}background:#fff;">
              <div style="font-weight:700;color:#1f2937;font-size:12px;line-height:1.3;">${pinIcon}${cell.subjectName || ''}</div>
              <div style="color:#6b7280;font-size:10px;margin-top:2px;">${cell.teacherName || ''}</div>
            </div>`
          }
          return `<div style="${cellStyle}background:#fff;"></div>`
        })
        .join('')
      return `<div style="display:grid;grid-template-columns:90px repeat(${periodList.length}, 1fr);gap:4px;margin-bottom:4px;">
        <div style="${cellStyle}background:#f3f4f6;text-align:center;font-weight:700;color:#4b5563;justify-content:center;min-height:62px;">${DAY_LABELS[d] || `วัน${d}`}</div>
        ${cells}
      </div>`
    })
    .join('')

  return `<div class="grid-page" style="page-break-after:always;">
    <h2 style="font-size:16px;font-weight:700;color:#1f2937;margin:0 0 8px 0;text-align:center;">ตารางสอน ${cls.name}</h2>
    <div style="display:grid;grid-template-columns:90px repeat(${periodList.length}, 1fr);gap:4px;margin-bottom:4px;">
      <div style="${cellStyle}background:#f9fafb;text-align:center;font-weight:700;color:#9ca3af;justify-content:center;min-height:36px;">วัน \\ คาบ</div>
      ${headerCells}
    </div>
    ${rows}
  </div>`
}

/**
 * Build a self-contained HTML string for a single teacher timetable grid.
 */
export function buildTeacherGridHTML(teacher, ctx) {
  const { lunchSet, dayList, periodList } = ctx
  const cellStyle = `border:1px solid #d1d5db;border-radius:6px;padding:6px 8px;min-height:62px;font-size:12px;display:flex;flex-direction:column;justify-content:center;overflow:hidden;`

  // Compute teacher's classes for color mapping
  const teacherClassIds = new Set()
  for (const s of ctx.allSlots) {
    if (s.teacher_id === teacher.id) teacherClassIds.add(s.class_id)
  }
  for (const [lbId, placements] of Object.entries(ctx.userPlacements)) {
    const lb = ctx.lessonBlockMap.get(lbId)
    if (lb && lb.teacher_id === teacher.id) {
      teacherClassIds.add(lb.class_id)
    }
  }
  const teacherClasses = ctx.classes.filter((c) => teacherClassIds.has(c.id))
  const classColorMap = {}
  teacherClasses.forEach((c, i) => { classColorMap[c.id] = i })

  const headerCells = periodList
    .map((p) => {
      const isLunch = lunchSet.has(p)
      return `<div style="${cellStyle}background:${isLunch ? '#f3f4f6' : '#fff'};text-align:center;font-weight:700;color:${isLunch ? '#9ca3af' : '#374151'};min-height:36px;justify-content:center;">${isLunch ? 'พัก' : p}</div>`
    })
    .join('')

  const rows = dayList
    .map((d) => {
      const cells = periodList
        .map((p) => {
          const isLunch = lunchSet.has(p)
          if (isLunch) {
            return `<div style="${cellStyle}background:#f3f4f6;color:#9ca3af;text-align:center;justify-content:center;">พักเที่ยง</div>`
          }
          const cell = resolveTeacherCell({
            day: d, period: p, teacherId: teacher.id,
            slotMap: ctx.slotMap, fixedMap: ctx.fixedMap,
            subjectMap: ctx.subjectMap, classMap: ctx.classMap,
          })
          if (cell.kind === 'fixed') {
            return `<div style="${cellStyle}background:#fef9c3;border-color:#facc15;color:#713f12;text-align:center;justify-content:center;">🔒 ${cell.fixedName}</div>`
          }
          if (cell.kind === 'lessons') {
            const items = cell.slots.map((s) => {
              const colorIdx = classColorMap[s.classId] ?? 0
              const color = CLASS_COLOR_HEX[colorIdx % CLASS_COLOR_HEX.length]
              return `<div style="margin-bottom:2px;padding:2px 4px;border-radius:3px;background:${color.bg};border-left:3px solid ${color.border};">
                <span style="font-weight:700;color:${color.text};font-size:11px;">${s.className}</span>
                <span style="color:${color.text};font-size:10px;margin-left:4px;">${s.subjectName}</span>
              </div>`
            }).join('')
            return `<div style="${cellStyle}background:#fff;padding:4px;">${items}</div>`
          }
          return `<div style="${cellStyle}background:#fff;"></div>`
        })
        .join('')
      return `<div style="display:grid;grid-template-columns:90px repeat(${periodList.length}, 1fr);gap:4px;margin-bottom:4px;">
        <div style="${cellStyle}background:#f3f4f6;text-align:center;font-weight:700;color:#4b5563;justify-content:center;min-height:62px;">${DAY_LABELS[d] || `วัน${d}`}</div>
        ${cells}
      </div>`
    })
    .join('')

  // Legend
  const legendItems = teacherClasses
    .map((c) => {
      const colorIdx = classColorMap[c.id] ?? 0
      const color = CLASS_COLOR_HEX[colorIdx % CLASS_COLOR_HEX.length]
      return `<span style="display:inline-flex;align-items:center;gap:4px;margin-right:12px;font-size:11px;color:#4b5563;">
        <span style="display:inline-block;width:12px;height:12px;border-radius:3px;background:${color.bg};border:1px solid ${color.border};"></span>
        ${c.name}
      </span>`
    })
    .join('')

  return `<div class="grid-page" style="page-break-after:always;">
    <h2 style="font-size:16px;font-weight:700;color:#1f2937;margin:0 0 4px 0;text-align:center;">ตารางสอน ${teacher.name} (ครูผู้สอน)</h2>
    ${legendItems ? `<div style="text-align:center;margin-bottom:8px;">${legendItems}</div>` : ''}
    <div style="display:grid;grid-template-columns:90px repeat(${periodList.length}, 1fr);gap:4px;margin-bottom:4px;">
      <div style="${cellStyle}background:#f9fafb;text-align:center;font-weight:700;color:#9ca3af;justify-content:center;min-height:36px;">วัน \\ คาบ</div>
      ${headerCells}
    </div>
    ${rows}
  </div>`
}

/**
 * Build the shared context object used by both class and teacher grid builders.
 */
export function buildExportContext(data) {
  const { slots, classes, subjects, teachers, gridConfig, userPlacements, lessonBlocks, fixedSlots } = data
  const { periodsPerDay = 7, lunchPeriods = [], daysPerWeek = 5 } = gridConfig

  const subjectMap = new Map((subjects || []).map((s) => [s.id, s]))
  const teacherMap = new Map((teachers || []).map((t) => [t.id, t]))
  const classMap = new Map((classes || []).map((c) => [c.id, c]))
  const lessonBlockMap = new Map((lessonBlocks || []).map((lb) => [lb.id, lb]))
  const lunchSet = new Set(lunchPeriods)

  const fixedMap = new Map()
  for (const fs of (fixedSlots || [])) {
    fixedMap.set(`${fs.day}-${fs.period}`, fs)
  }

  const slotMap = new Map()
  for (const s of (slots || [])) {
    const key = `${s.day}-${s.period}`
    if (!slotMap.has(key)) slotMap.set(key, [])
    slotMap.get(key).push(s)
  }

  // User placement lookup: { "day-period-classId": { lessonBlock, day, period } }
  const userPlacementMap = new Map()
  for (const [lbId, placements] of Object.entries(userPlacements || {})) {
    const lb = lessonBlockMap.get(lbId)
    if (!lb) continue
    for (const p of placements) {
      userPlacementMap.set(`${p.day}-${p.period}-${lb.class_id}`, { lessonBlock: lb, day: p.day, period: p.period })
    }
  }

  const dayList = Array.from({ length: daysPerWeek }, (_, i) => i + 1)
  const periodList = Array.from({ length: periodsPerDay }, (_, i) => i + 1)

  return {
    allSlots: slots || [],
    classes: classes || [],
    subjects: subjects || [],
    teachers: teachers || [],
    gridConfig,
    userPlacements: userPlacements || {},
    lessonBlocks: lessonBlocks || [],
    fixedSlots: fixedSlots || [],
    subjectMap, teacherMap, classMap, lessonBlockMap,
    lunchSet, fixedMap, slotMap, userPlacementMap,
    dayList, periodList,
  }
}

/**
 * Build all grid HTML pages based on the selected scope.
 * @returns { { title: string, pages: Array<{ label: string, html: string }> } }
 */
export function buildAllGridHTMLs(scope, data) {
  const ctx = buildExportContext(data)
  const pages = []

  if (scope.classes) {
    for (const cls of ctx.classes) {
      pages.push({
        label: cls.name,
        kind: 'class',
        id: cls.id,
        html: buildClassGridHTML(cls, ctx),
      })
    }
  }

  if (scope.teachers) {
    for (const teacher of ctx.teachers) {
      pages.push({
        label: teacher.name,
        kind: 'teacher',
        id: teacher.id,
        html: buildTeacherGridHTML(teacher, ctx),
      })
    }
  }

  return { pages, ctx }
}

/**
 * Main export entry point. Dispatches to the format-specific exporter.
 *
 * @param {Object} params
 * @param {'pdf'|'png'|'xlsx'} params.format
 * @param {{ classes: boolean, teachers: boolean }} params.scope
 * @param {Object} params.data — export data payload
 * @param {(msg: string) => void} [params.onProgress] — optional progress callback
 * @returns {Promise<{ ok: boolean, error?: string, count?: number }>}
 */
export async function runExport({ format, scope, data, onProgress }) {
  const progress = onProgress || (() => {})

  if (!data) {
    return { ok: false, error: 'ไม่มีข้อมูลที่จะส่งออก' }
  }
  if (!scope.classes && !scope.teachers) {
    return { ok: false, error: 'กรุณาเลือกอย่างน้อย 1 ขอบเขต (ห้องเรียน หรือ ครู)' }
  }

  try {
    if (format === 'pdf') {
      progress('กำลังเตรียม PDF...')
      const { pages, ctx } = buildAllGridHTMLs(scope, data)
      if (pages.length === 0) return { ok: false, error: 'ไม่มีตารางที่จะส่งออก' }
      await exportMultiPagePDF(pages, data.label || 'ตารางสอน')
      return { ok: true, count: pages.length }
    }

    if (format === 'png') {
      progress('กำลังเรนเดอร์ภาพ PNG...')
      const { pages, ctx } = buildAllGridHTMLs(scope, data)
      if (pages.length === 0) return { ok: false, error: 'ไม่มีตารางที่จะส่งออก' }
      await exportMultiPNG(pages, data.label || 'ตารางสอน', progress)
      return { ok: true, count: pages.length }
    }

    if (format === 'xlsx') {
      progress('กำลังสร้างไฟล์ Excel...')
      await exportMultiExcel(scope, data)
      return { ok: true }
    }

    return { ok: false, error: `รูปแบบไม่รองรับ: ${format}` }
  } catch (e) {
    console.error('[exportEngine] Export failed:', e)
    return { ok: false, error: e.message || 'ส่งออกไม่สำเร็จ' }
  }
}
