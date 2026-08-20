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
export { DAY_LABELS }

// ── Shared grid building helpers (DRY: used by class/teacher/facility grids) ──

const GRID_CELL_STYLE = `border:1px solid #d1d5db;border-radius:4px;padding:3px 5px;min-height:42px;font-size:11px;display:flex;flex-direction:column;justify-content:center;overflow:hidden;`

/**
 * Build the periodColsTemplate string from periodList + breakSet.
 */
function buildPeriodColsTemplate(periodList, breakSet) {
  return periodList.map((p) => breakSet.has(p) ? '0.2fr' : '1fr').join(' ')
}

/**
 * Build header cell HTML for a period (lunch/break/normal with optional time).
 */
function buildHeaderCellHTML(p, { lunchSet, breakSet, periodTimeMap, showPeriodTimes }) {
  const isLunch = lunchSet.has(p)
  const isBreak = breakSet.has(p)
  const timeStr = showPeriodTimes && periodTimeMap[p] && !isLunch && !isBreak
    ? `<div style="font-size:10px;font-weight:400;color:#6b7280;margin-top:1px;">${periodTimeMap[p]}</div>`
    : ''
  const label = isLunch ? 'พัก' : isBreak ? 'พัก' : p
  const bg = isLunch ? '#f3f4f6' : isBreak ? '#f9fafb' : '#fff'
  const color = isLunch ? '#9ca3af' : isBreak ? '#9ca3af' : '#374151'
  return `<div class="vcell" style="${GRID_CELL_STYLE}background:${bg};text-align:center;font-weight:700;color:${color};min-height:28px;justify-content:center;">${label}${timeStr}</div>`
}

/**
 * Build the full header row HTML (corner cell + period cells).
 */
function buildHeaderRowHTML(ctx) {
  const headerCells = ctx.periodList.map((p) => buildHeaderCellHTML(p, ctx)).join('')
  return `<div style="display:grid;grid-template-columns:var(--vlabel, 80px) ${ctx.periodColsTemplate};gap:2px;margin-bottom:2px;">
    <div class="vcell" style="${GRID_CELL_STYLE}background:#f9fafb;text-align:center;font-weight:700;color:#9ca3af;justify-content:center;min-height:26px;">วัน \\ คาบ</div>
    ${headerCells}
  </div>`
}

/**
 * Build a lunch or break cell HTML. Returns null if the period is neither.
 */
function buildLunchBreakCellHTML(p, { lunchSet, breakSet }) {
  if (lunchSet.has(p)) {
    return `<div class="vcell" style="${GRID_CELL_STYLE}background:#f3f4f6;color:#9ca3af;text-align:center;justify-content:center;">พักเที่ยง</div>`
  }
  if (breakSet.has(p)) {
    return `<div class="vcell" style="${GRID_CELL_STYLE}background:#f9fafb;color:#9ca3af;text-align:center;justify-content:center;font-size:10px;">พัก</div>`
  }
  return null
}

/**
 * Build a day row wrapper HTML with the day label cell.
 */
function buildDayRowHTML(day, cellsHTML, periodColsTemplate) {
  return `<div style="display:grid;grid-template-columns:var(--vlabel, 80px) ${periodColsTemplate};gap:2px;margin-bottom:2px;">
    <div class="vcell" style="${GRID_CELL_STYLE}background:#f3f4f6;text-align:center;font-weight:700;color:#4b5563;justify-content:center;min-height:42px;">${DAY_LABELS[day] || `วัน${day}`}</div>
    ${cellsHTML}
  </div>`
}

/**
 * Build an empty cell HTML.
 */
function buildEmptyCellHTML() {
  return `<div class="vcell" style="${GRID_CELL_STYLE}background:#fff;"></div>`
}

// ── Export branding config ───────────────────────────────────────────────
// Footer text shown at the bottom of every PDF/PNG page.
// Edit this string to customize the branding shown on exported timetables.
const EXPORT_CONFIG = {
  footerText: 'ระบบจัดตารางสอนอัตโนมัติ',
}

/**
 * Build the branding footer HTML appended to every exported grid page.
 * Returns an empty string when footerText is empty/undefined.
 */
function buildBrandingFooter() {
  const text = (EXPORT_CONFIG.footerText || '').trim()
  if (!text) return ''
  return `<div style="margin-top:10px;padding-top:6px;border-top:1px solid #e5e7eb;
    text-align:center;font-size:10px;color:#9ca3af;line-height:1.4;">
    ${text}
  </div>`
}
export { buildBrandingFooter }

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
export { CLASS_COLOR_HEX }

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
  const periodColsTemplate = buildPeriodColsTemplate(ctx.periodList, ctx.breakSet)
  const gridCtx = { ...ctx, periodColsTemplate }

  const rows = ctx.dayList
    .map((d) => {
      const cells = ctx.periodList
        .map((p) => {
          const lunchBreak = buildLunchBreakCellHTML(p, ctx)
          if (lunchBreak) return lunchBreak
          const cell = resolveClassCell({
            day: d, period: p, classId: cls.id,
            slotMap: ctx.slotMap, fixedMap: ctx.fixedMap,
            userPlacementMap: ctx.userPlacementMap,
            subjectMap: ctx.subjectMap, teacherMap: ctx.teacherMap,
            lessonBlockMap: ctx.lessonBlockMap, userPlacements: ctx.userPlacements,
          })
          if (cell.kind === 'fixed') {
            return `<div class="vcell" style="${GRID_CELL_STYLE}background:#fff;text-align:center;justify-content:center;font-weight:600;color:#374151;">${cell.fixedName}</div>`
          }
          if (cell.kind === 'lesson') {
            const pinIcon = cell.isPreAssigned ? '📌 ' : ''
            return `<div class="vcell" style="${GRID_CELL_STYLE}background:#fff;align-items:center;text-align:center;">
              <div class="vcell-title" style="font-weight:700;color:#1e293b;font-size:12px;line-height:1.15;">${pinIcon}${cell.subjectName || ''}</div>
              <div class="vcell-sub" style="font-weight:500;color:#475569;font-size:10px;margin-top:1px;">${cell.teacherName || ''}</div>
            </div>`
          }
          return buildEmptyCellHTML()
        })
        .join('')
      return buildDayRowHTML(d, cells, periodColsTemplate)
    })
    .join('')

  return `<div class="grid-page" style="break-inside:avoid;">
    ${buildHeaderRowHTML(gridCtx)}
    ${rows}
  </div>`
}

/**
 * Build a self-contained HTML string for a single teacher timetable grid.
 */
export function buildTeacherGridHTML(teacher, ctx) {
  const periodColsTemplate = buildPeriodColsTemplate(ctx.periodList, ctx.breakSet)
  const gridCtx = { ...ctx, periodColsTemplate }

  const rows = ctx.dayList
    .map((d) => {
      const cells = ctx.periodList
        .map((p) => {
          const lunchBreak = buildLunchBreakCellHTML(p, ctx)
          if (lunchBreak) return lunchBreak
          const cell = resolveTeacherCell({
            day: d, period: p, teacherId: teacher.id,
            slotMap: ctx.slotMap, fixedMap: ctx.fixedMap,
            subjectMap: ctx.subjectMap, classMap: ctx.classMap,
          })
          if (cell.kind === 'fixed') {
            return `<div class="vcell" style="${GRID_CELL_STYLE}background:#fff;text-align:center;justify-content:center;font-weight:600;color:#374151;">${cell.fixedName}</div>`
          }
          if (cell.kind === 'lessons') {
            const items = cell.slots.map((s) => {
              return `<div style="text-align:center;padding:1px 0;">
                <div class="vcell-title" style="font-weight:700;color:#1e293b;font-size:12px;line-height:1.15;">${s.className}</div>
                <div class="vcell-sub" style="font-weight:500;color:#475569;font-size:10px;margin-top:1px;">${s.subjectName}</div>
              </div>`
            }).join('')
            return `<div class="vcell" style="${GRID_CELL_STYLE}background:#fff;align-items:center;justify-content:center;padding:3px 2px;">${items}</div>`
          }
          return buildEmptyCellHTML()
        })
        .join('')
      return buildDayRowHTML(d, cells, periodColsTemplate)
    })
    .join('')

  return `<div class="grid-page" style="break-inside:avoid;">
    ${buildHeaderRowHTML(gridCtx)}
    ${rows}
  </div>`
}

/**
 * Build a self-contained HTML string for a single facility (special room) timetable grid.
 * Shows which class + teacher + subject uses the room at each day/period.
 */
export function buildFacilityGridHTML(room, ctx) {
  const { allSlots, subjectMap, teacherMap, classMap } = ctx
  const periodColsTemplate = buildPeriodColsTemplate(ctx.periodList, ctx.breakSet)
  const gridCtx = { ...ctx, periodColsTemplate }

  // Filter slots that use this special room
  const roomSlots = (allSlots || []).filter((s) => s.room_id === room.id)
  // Build lookup: { "day-period": slot }
  const roomSlotMap = new Map()
  for (const s of roomSlots) {
    roomSlotMap.set(`${s.day}-${s.period}`, s)
  }

  const rows = ctx.dayList
    .map((d) => {
      const cells = ctx.periodList
        .map((p) => {
          const lunchBreak = buildLunchBreakCellHTML(p, ctx)
          if (lunchBreak) return lunchBreak
          const s = roomSlotMap.get(`${d}-${p}`)
          if (s) {
            const subjName = subjectMap.get(s.subject_id)?.name || s.subject_id
            const teacherName = teacherMap.get(s.teacher_id)?.name || s.teacher_id
            const className = classMap.get(s.class_id)?.name || s.class_id
            return `<div class="vcell" style="${GRID_CELL_STYLE}background:#eef2ff;align-items:center;text-align:center;">
              <div class="vcell-title" style="font-weight:700;color:#3730a3;font-size:12px;line-height:1.15;">${className}</div>
              <div class="vcell-sub" style="font-weight:500;color:#475569;font-size:10px;margin-top:1px;">${subjName}</div>
              <div class="vcell-sub" style="font-weight:400;color:#6b7280;font-size:10px;margin-top:0.5px;">${teacherName}</div>
            </div>`
          }
          return buildEmptyCellHTML()
        })
        .join('')
      return buildDayRowHTML(d, cells, periodColsTemplate)
    })
    .join('')

  return `<div class="grid-page" style="break-inside:avoid;">
    ${buildHeaderRowHTML(gridCtx)}
    ${rows}
  </div>`
}

/**
 * Build the shared context object used by both class and teacher grid builders.
 */
export function buildExportContext(data) {
  const { slots, classes, subjects, teachers, gridConfig, userPlacements, lessonBlocks, fixedSlots, periodTimeMap, showPeriodTimes } = data
  const { periodsPerDay = 7, lunchPeriods = [], breakPeriods = [], daysPerWeek = 5 } = gridConfig

  const subjectMap = new Map((subjects || []).map((s) => [s.id, s]))
  const teacherMap = new Map((teachers || []).map((t) => [t.id, t]))
  const classMap = new Map((classes || []).map((c) => [c.id, c]))
  const lessonBlockMap = new Map((lessonBlocks || []).map((lb) => [lb.id, lb]))
  const lunchSet = new Set(lunchPeriods)
  const breakSet = new Set(breakPeriods)

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
  // Use explicit periodList from gridConfig (supports decimals for inserted
  // short breaks); fall back to integer range 1..periodsPerDay.
  const periodList = (gridConfig?.periodList && gridConfig.periodList.length > 0)
    ? gridConfig.periodList
    : Array.from({ length: periodsPerDay }, (_, i) => i + 1)

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
    lunchSet, breakSet, fixedMap, slotMap, userPlacementMap,
    dayList, periodList,
    periodTimeMap: periodTimeMap || {},
    showPeriodTimes: showPeriodTimes !== false,
  }
}

/**
 * Build all grid HTML pages based on the selected scope.
 * @returns { { title: string, pages: Array<{ label: string, html: string }> } }
 */
export function buildAllGridHTMLs(scope, data) {
  const ctx = buildExportContext(data)
  const pages = []
  const footer = buildBrandingFooter()

  if (scope.classes) {
    for (const cls of ctx.classes) {
      pages.push({
        label: cls.name,
        kind: 'class',
        id: cls.id,
        html: buildClassGridHTML(cls, ctx) + footer,
      })
    }
  }

  if (scope.teachers) {
    for (const teacher of ctx.teachers) {
      pages.push({
        label: teacher.name,
        kind: 'teacher',
        id: teacher.id,
        html: buildTeacherGridHTML(teacher, ctx) + footer,
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
