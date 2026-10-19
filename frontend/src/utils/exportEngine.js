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
import { teacherSupervisesFixedSlot } from './teacherLoad.js'

const DAY_LABELS = ['', 'จันทร์', 'อังคาร', 'พุธ', 'พฤหัสบดี', 'ศุกร์', 'เสาร์', 'อาทิตย์']
export { DAY_LABELS }

// ── Shared grid building helpers (DRY: used by class/teacher/facility grids) ──

// No overflow:hidden — teacher cells can hold multiple lessons (2+ entries in
// one period) and must grow to fit their content on every screen/print size.
// A fixed min-height + hidden overflow clipped multi-entry cells on small
// screens, which made some users see incomplete tables from the same link.
const GRID_CELL_STYLE = `border:1px solid #d1d5db;border-radius:4px;padding:3px 5px;min-height:42px;font-size:11px;display:flex;flex-direction:column;justify-content:center;`

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

/**
 * Build a locked-activity (fixed slot) cell HTML.
 * Color-codes the lock type in teacher grids (tone 'default'):
 *   supervise → เขียว (ดูแลกิจกรรม) | assembly → เทา (ทั้งโรงเรียน) | class → เหลือง (เฉพาะห้อง)
 * In class grids (tone 'class') the cell stays neutral white, mirroring the
 * on-screen class view, with an optional "ดูแล: ..." badge.
 */
function buildFixedCellHTML({ fixedName, fixedKind = null, supervisedBy = null, affectedClassNames = [], tone = 'default' }) {
  const badge = (text, color, bg) =>
    `<div style="display:inline-block;font-size:9px;font-weight:700;color:${color};background:${bg};border-radius:999px;padding:0 6px;margin-top:2px;">${text}</div>`

  if (tone === 'class') {
    const careBadge = supervisedBy
      ? badge(`ดูแล: ${supervisedBy}`, '#065f46', '#a7f3d0')
      : ''
    return `<div class="vcell" style="${GRID_CELL_STYLE}background:#fff;text-align:center;justify-content:center;font-weight:600;color:#374151;">
      <div class="vcell-title" style="font-weight:700;color:#1e293b;font-size:12px;line-height:1.15;">${fixedName}</div>
      ${careBadge}
    </div>`
  }

  if (fixedKind === 'supervise') {
    const careBadge = supervisedBy ? badge(`ดูแล: ${supervisedBy}`, '#065f46', '#a7f3d0') : ''
    return `<div class="vcell" style="${GRID_CELL_STYLE}background:#ecfdf5;border:1px solid #34d399;text-align:center;justify-content:center;font-weight:600;color:#065f46;">
      <div class="vcell-title" style="font-weight:700;color:#065f46;font-size:12px;line-height:1.15;">🔒 ${fixedName}</div>
      ${careBadge}
    </div>`
  }
  if (fixedKind === 'assembly') {
    return `<div class="vcell" style="${GRID_CELL_STYLE}background:#f1f5f9;border:1px dashed #94a3b8;text-align:center;justify-content:center;font-weight:600;color:#475569;">
      <div class="vcell-title" style="font-weight:700;color:#334155;font-size:12px;line-height:1.15;">🔒 ${fixedName}</div>
      ${badge('ทั้งโรงเรียน', '#475569', '#e2e8f0')}
    </div>`
  }
  if (fixedKind === 'class') {
    const infoBadge = supervisedBy
      ? badge(`ดูแล: ${supervisedBy}`, '#065f46', '#a7f3d0')
      : affectedClassNames.length > 0
        ? badge(`ห้อง: ${affectedClassNames.join(', ')}`, '#92400e', '#fde68a')
        : ''
    return `<div class="vcell" style="${GRID_CELL_STYLE}background:#fffbeb;border:1px dashed #fbbf24;text-align:center;justify-content:center;font-weight:600;color:#92400e;">
      <div class="vcell-title" style="font-weight:700;color:#92400e;font-size:12px;line-height:1.15;">🔒 ${fixedName}</div>
      ${infoBadge}
    </div>`
  }
  // No kind info — legacy neutral cell
  return `<div class="vcell" style="${GRID_CELL_STYLE}background:#fff;text-align:center;justify-content:center;font-weight:600;color:#374151;">${fixedName}</div>`
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
function resolveClassCell({ day, period, classId, slotMap, fixedMap, getFixedSlotsFor, substituteMap, getSubstituteFor, userPlacementMap, subjectMap, teacherMap, lessonBlockMap, userPlacements }) {
  const fixed = getFixedSlotsFor(day, period, classId)[0]
  if (fixed) {
    // ครูผู้ดูแลกิจกรรมของห้องนี้ (class_teachers[classId] — อาจมีหลายคน)
    const raw = fixed.class_teachers?.[classId]
    const ids = Array.isArray(raw) ? raw : raw ? [raw] : []
    const names = ids.map((tid) => teacherMap.get(tid)?.name || tid).filter(Boolean)
    return {
      kind: 'fixed',
      fixedName: fixed.name || 'กิจกรรมล็อก',
      supervisedBy: names.length > 0 ? names.join(', ') : null,
    }
  }

  const slots = (slotMap.get(`${day}-${period}`) || []).filter((s) => s.class_id === classId)
  const slot = slots[0] || null
  const userPlacement = userPlacementMap.get(`${day}-${period}-${classId}`)

  if (slot) {
    const subj = subjectMap.get(slot.subject_id)
    const teacher = teacherMap.get(slot.teacher_id)
    const lb = lessonBlockMap.get(slot.lesson_block_id)
    const coTeacherId = (lb && lb.co_teacher_id) || slot.co_teacher_id || null
    const coTeacher = coTeacherId ? teacherMap.get(coTeacherId) : null
    const isPreAssigned = !!userPlacements[slot.lesson_block_id]
    // Substitute (สอนแทน) overrides the displayed teacher
    const sub = getSubstituteFor(day, period, classId)
    const subTeacher = sub ? teacherMap.get(sub.substitute_teacher_id) : null
    const subOriginal = sub ? (teacherMap.get(sub.original_teacher_id)?.name || sub.original_teacher_id) : null
    return {
      kind: 'lesson',
      subjectName: subj?.name || slot.subject_id,
      teacherName: subTeacher ? (subTeacher.name || subTeacher.id) : (teacher?.name || ''),
      coTeacherName: (!sub && coTeacher) ? (coTeacher.name || coTeacher.id) : null,
      originalName: sub ? subOriginal : null,
      isSubstitute: !!sub,
      isPreAssigned,
      subjectId: slot.subject_id,
    }
  }

  if (userPlacement) {
    const lb = userPlacement.lessonBlock
    const subj = subjectMap.get(lb.subject_id)
    const teacher = teacherMap.get(lb.teacher_id)
    const coTeacher = lb.co_teacher_id ? teacherMap.get(lb.co_teacher_id) : null
    const sub = getSubstituteFor(day, period, classId)
    const subTeacher = sub ? teacherMap.get(sub.substitute_teacher_id) : null
    const subOriginal = sub ? (teacherMap.get(sub.original_teacher_id)?.name || sub.original_teacher_id) : null
    return {
      kind: 'lesson',
      subjectName: subj?.name || lb.subject_id,
      teacherName: subTeacher ? (subTeacher.name || subTeacher.id) : (teacher?.name || ''),
      coTeacherName: (!sub && coTeacher) ? (coTeacher.name || coTeacher.id) : null,
      originalName: sub ? subOriginal : null,
      isSubstitute: !!sub,
      isPreAssigned: true,
      subjectId: lb.subject_id,
    }
  }

  return { kind: 'empty' }
}

/**
 * Resolve display data for a single cell in a teacher grid.
 * Returns { kind, slots: [{ subjectName, className, classId }] } or
 * { kind: 'fixed', fixedName, fixedKind, supervisedBy, affectedClassNames }.
 *
 * Display policy: the teacher's own lessons (main/co/substitute) always show.
 * A locked activity (fixed slot) appears ONLY when the teacher supervises it
 * (fs.class_teachers) — not for whole-school or class-specific locks.
 */
function resolveTeacherCell({ day, period, teacherId, slotMap, fixedSlots, subjectMap, classMap, teacherMap, lessonBlockMap, substituteMap, userPlacementMap }) {
  // Fixed slot shows in a teacher's timetable ONLY when they supervise it
  // (fs.class_teachers) — not merely because it applies to a class they teach.
  // Iterate the raw list so supervisors who teach none of the slot's classes
  // (e.g. ครูประจำชั้นที่ไม่สอนห้องนั้น) are still covered.
  const supervised = (fixedSlots || []).filter((fs) => {
    if (fs.day !== day) return false
    const periods = [fs.period, ...(fs.periods || [])]
    return periods.includes(period) && teacherSupervisesFixedSlot(fs, teacherId)
  })
  if (supervised.length > 0) {
    return {
      kind: 'fixed',
      fixedName: supervised[0].name || 'กิจกรรมล็อก',
      fixedKind: 'supervise',
      supervisedBy: teacherMap.get(teacherId)?.name || teacherId,
      affectedClassNames: [],
    }
  }

  // Include slots where the teacher is the main teacher OR the co-teacher
  const slots = (slotMap.get(`${day}-${period}`) || []).filter((s) => {
    if (s.teacher_id === teacherId) return true
    const lb = lessonBlockMap.get(s.lesson_block_id)
    if (lb && lb.co_teacher_id === teacherId) return true
    return s.co_teacher_id === teacherId
  })
  const entries = slots.map((s) => {
    const lb = lessonBlockMap.get(s.lesson_block_id)
    const coTeacherId = (lb && lb.co_teacher_id) || s.co_teacher_id || null
    return {
      subjectName: subjectMap.get(s.subject_id)?.name || s.subject_id,
      className: classMap.get(s.class_id)?.name || s.class_id,
      classId: s.class_id,
      subjectId: s.subject_id,
      mainTeacherName: teacherMap.get(s.teacher_id)?.name || s.teacher_id,
      coTeacherName: coTeacherId ? (teacherMap.get(coTeacherId)?.name || coTeacherId) : null,
    }
  })
  // User placements (วางด้วยมือ/ปักหมุด) not covered by solver slots — the
  // co-teacher AND main teacher must both see these in their timetable.
  for (const up of (userPlacementMap?.values() || [])) {
    const lb = up.lessonBlock
    if (!lb || up.day !== day || up.period !== period) continue
    if (lb.teacher_id !== teacherId && lb.co_teacher_id !== teacherId) continue
    if (slots.some((s) => s.lesson_block_id === lb.id)) continue
    const coTeacherId = lb.co_teacher_id || null
    entries.push({
      subjectName: subjectMap.get(lb.subject_id)?.name || lb.subject_id,
      className: classMap.get(lb.class_id)?.name || lb.class_id,
      classId: lb.class_id,
      subjectId: lb.subject_id,
      mainTeacherName: teacherMap.get(lb.teacher_id)?.name || lb.teacher_id,
      coTeacherName: coTeacherId ? (teacherMap.get(coTeacherId)?.name || coTeacherId) : null,
    })
  }
  // Substitute duties (สอนแทน) for this teacher
  for (const sub of substituteMap.values()) {
    if (sub.day !== day || sub.period !== period) continue
    if (sub.substitute_teacher_id === teacherId) {
      const allAtSlot = slotMap.get(`${day}-${period}`) || []
      const orig = allAtSlot.find((s) => s.class_id === sub.class_id)
      if (orig) {
        entries.push({
          subjectName: subjectMap.get(sub.subject_id)?.name || sub.subject_id,
          className: classMap.get(sub.class_id)?.name || sub.class_id,
          classId: sub.class_id,
          subjectId: sub.subject_id,
          isSubstitute: true,
        })
      }
    }
  }
  if (entries.length === 0) return { kind: 'empty' }

  return {
    kind: 'lessons',
    slots: entries,
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
            slotMap: ctx.slotMap, fixedMap: ctx.fixedMap, getFixedSlotsFor: ctx.getFixedSlotsFor,
            substituteMap: ctx.substituteMap, getSubstituteFor: ctx.getSubstituteFor,
            userPlacementMap: ctx.userPlacementMap,
            subjectMap: ctx.subjectMap, teacherMap: ctx.teacherMap,
            lessonBlockMap: ctx.lessonBlockMap, userPlacements: ctx.userPlacements,
          })
          if (cell.kind === 'fixed') {
            return buildFixedCellHTML({ fixedName: cell.fixedName, supervisedBy: cell.supervisedBy, tone: 'class' })
          }
          if (cell.kind === 'lesson') {
            const pinIcon = cell.isPreAssigned ? '📌 ' : ''
            const subName = cell.originalName ? ` (แทน ${cell.originalName})` : ''
            const teacherDisplay = cell.isSubstitute
              ? `${cell.teacherName || ''}${subName}`
              : `${cell.teacherName || ''}${cell.coTeacherName ? ` + ${cell.coTeacherName}` : ''}`
            const subBadge = cell.isSubstitute
              ? `<span style="display:inline-block;font-size:9px;font-weight:700;color:#9a3412;background:#ffedd5;border:1px solid #fdba74;border-radius:4px;padding:0 3px;margin-top:2px;">🔁 สอนแทน</span>`
              : ''
            return `<div class="vcell" style="${GRID_CELL_STYLE}background:#fff;align-items:center;text-align:center;">
              <div class="vcell-title" style="font-weight:700;color:#1e293b;font-size:12px;line-height:1.15;">${pinIcon}${cell.subjectName || ''}</div>
              <div class="vcell-sub" style="font-weight:500;color:#475569;font-size:10px;margin-top:1px;">${teacherDisplay}</div>
              ${subBadge}
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
            slotMap: ctx.slotMap, fixedSlots: ctx.fixedSlots,
            subjectMap: ctx.subjectMap, classMap: ctx.classMap, teacherMap: ctx.teacherMap,
            lessonBlockMap: ctx.lessonBlockMap, substituteMap: ctx.substituteMap,
            userPlacementMap: ctx.userPlacementMap,
          })
          if (cell.kind === 'fixed') {
            return buildFixedCellHTML(cell)
          }
          if (cell.kind === 'lessons') {
            const items = cell.slots.map((s) => {
              const subTag = s.isSubstitute
                ? `<div style="font-size:9px;font-weight:700;color:#9a3412;background:#ffedd5;border-radius:3px;display:inline-block;padding:0 3px;margin-top:1px;">🔁 สอนแทน</div>`
                : ''
              const teacherLine = s.coTeacherName
                ? `<div class="vcell-sub" style="font-weight:500;color:#6b7280;font-size:9px;margin-top:0.5px;">${s.mainTeacherName} + ${s.coTeacherName}</div>`
                : ''
              return `<div style="text-align:center;padding:1px 0;">
                <div class="vcell-title" style="font-weight:700;color:#1e293b;font-size:12px;line-height:1.15;">${s.className}</div>
                <div class="vcell-sub" style="font-weight:500;color:#475569;font-size:10px;margin-top:1px;">${s.subjectName}</div>
                ${teacherLine}
                ${subTag}
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
    const periods = (fs.periods && fs.periods.length > 0) ? [fs.period, ...fs.periods] : [fs.period]
    for (const p of periods) {
      const base = `${fs.day}-${p}`
      const targets = (!fs.class_ids || fs.class_ids.length === 0)
        ? [null]
        : fs.class_ids
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

  // Substitute (สอนแทน) lookup: "day-period-classId" → substitute entry
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
    lunchSet, breakSet, fixedMap, slotMap, userPlacementMap, getFixedSlotsFor,
    substituteMap, getSubstituteFor,
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
