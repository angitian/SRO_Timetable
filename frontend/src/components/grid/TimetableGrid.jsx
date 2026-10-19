import { useState, useCallback, useMemo, useEffect } from 'react'
import GridCell, { getClassColors } from './GridCell.jsx'
import GridHeader from './GridHeader.jsx'
import GridLegend from './GridLegend.jsx'
import { DAY_LABELS } from './GridLegend.jsx'
import CellContextMenu from './CellContextMenu.jsx'
import CellRoomEditModal from './CellRoomEditModal.jsx'
import { teacherBusyByFixedSlot } from '../../utils/teacherLoad.js'

export default function TimetableGrid({
  slots = [],
  subjects,
  teachers,
  classes,
  days,
  periodsPerDay,
  // Optional explicit period list (supports decimal period_no for inserted
  // short breaks, e.g. [1, 2, 3, 3.5, 4, 5]). Falls back to 1..periodsPerDay.
  periodList: periodListProp,
  lunchPeriods,
  // BREAK period numbers (decimals like 3.5) — rendered as narrow cells.
  breakPeriods = [],
  fixedSlots,
  // Manual substitute overrides (สอนแทน): [{ day, period, class_id, subject_id, original_teacher_id, substitute_teacher_id }]
  substitutes = [],
  filterClass,
  filterTeacher,
  onSlotSwap,
  // User pre-assignments { [lesson_block_id]: [{day, period}] }
  userPlacements = {},
  // Callback when a lesson block is dropped from the sidebar
  // (lessonBlock, day, period, classId) => void
  onDropFromSidebar,
  // Lesson blocks list (needed to resolve user placements into display data)
  lessonBlocks = [],
  // Currently dragged lesson block from sidebar (set at dragstart, cleared at dragend)
  sidebarDragBlock,
  // Single-class mode: render only this class's grid at full width
  selectedClass = null,
  // Single-teacher mode: render only this teacher's combined grid
  selectedTeacher = null,
  // View mode for header toggle: 'class' | 'teacher'
  viewMode = 'class',
  // Callback when user switches view mode via header toggle
  onViewModeChange,
  // ── Slot-level editing (persisted to AppContext) ──
  onSlotMove,         // (lessonBlockId, day, period, newDay, newPeriod) => void — moves only the slot at the source position
  onSlotDelete,       // (lessonBlockId, day, period) => void
  onRemovePlacement,  // (lessonBlockId, day, period) => void
  onLockSlot,         // (day, period) => void
  onUnlockSlot,       // (day, period) => void
  // ── Interactive block editing (buttons on cards) ──
  onRemoveSlot,       // (lessonBlockId, isPreAssigned, day, period) => void
  onTogglePin,        // (lessonBlockId, day, period, isPinned) => void
  // ── Batch pin/clear actions (sub-header) ──
  selectedClassId = null,
  selectedTeacherId = null,
  onPinByClass,       // (classId) => void
  onPinByTeacher,     // (teacherId) => void
  onUnpinByClass,     // (classId) => void
  onUnpinByTeacher,   // (teacherId) => void
  onClearByClass,     // (classId) => void
  onClearByTeacher,   // (teacherId) => void
  // ── Special rooms ──
  specialRooms = [],
  onChangeSlotRoom,   // (lessonBlockId, newRoomId) => void
  // ── Tab navigation (for facility tab) ──
  onTabChange,
}) {
  const [dragSource, setDragSource] = useState(null) // { day, period, classId, lessonBlockId }
  const [dragTarget, setDragTarget] = useState(null)
  const [forcePlacePending, setForcePlacePending] = useState(null) // { lb, day, period, classId, reason }
  const [showForceConfirm, setShowForceConfirm] = useState(false)
  const [localSlots, setLocalSlots] = useState(slots)
  const [contextMenu, setContextMenu] = useState(null) // { x, y, cellType, slot, day, period, classId }
  const [roomEditSlot, setRoomEditSlot] = useState(null) // slot being room-edited

  // Update localSlots when props change (but not during active drag)
  useEffect(() => {
    if (!dragSource) {
      setLocalSlots(slots)
    }
  }, [slots, dragSource])

  const subjectMap = new Map(subjects.map((s) => [s.id, s]))
  const teacherMap = new Map(teachers.map((t) => [t.id, t]))
  const classMap = new Map(classes.map((c) => [c.id, c]))
  const lessonBlockMap = new Map(lessonBlocks.map((lb) => [lb.id, lb]))
  const lunchSet = new Set(lunchPeriods)

  // Build special room name lookup: { id → name } for displaying room badges
  const specialRoomMap = useMemo(() => {
    const map = new Map()
    for (const r of specialRooms) {
      map.set(r.id, r.name)
    }
    return map
  }, [specialRooms])

  // Helper: get special room name for a slot (returns null if default classroom)
  function getSpecialRoomName(slot) {
    if (!slot?.room_id) return null
    // Default classroom rooms start with R_ and match R_{classId}
    if (slot.room_id.startsWith('R_') && slot.room_id === `R_${slot.class_id}`) return null
    return specialRoomMap.get(slot.room_id) || null
  }

  // Build fixed slot lookup — CLASS-AWARE + multi-period.
  // Key formats:
  //   "d-p"          → fixed slot applies to ALL classes (empty class_ids)
  //   "d-p-classId"  → fixed slot applies to that specific class only
  const fixedSlotMap = useMemo(() => {
    const map = new Map()
    if (!fixedSlots) return map
    const add = (key, fs) => {
      if (!map.has(key)) map.set(key, [])
      map.get(key).push(fs)
    }
    for (const fs of fixedSlots) {
      const periods = (fs.periods && fs.periods.length > 0)
        ? [fs.period, ...fs.periods]
        : [fs.period]
      for (const p of periods) {
        const base = `${fs.day}-${p}`
        if (!fs.class_ids || fs.class_ids.length === 0) {
          add(base, fs)
        } else {
          for (const cid of fs.class_ids) {
            add(`${base}-${cid}`, fs)
          }
        }
      }
    }
    return map
  }, [fixedSlots])

  // All fixed slots applying to (day, period, classId) — classId null = all-class slots only
  function getFixedSlotsFor(d, p, classId) {
    const result = [...(fixedSlotMap.get(`${d}-${p}`) || [])]
    if (classId) {
      result.push(...(fixedSlotMap.get(`${d}-${p}-${classId}`) || []))
    }
    return result
  }

  function getFixedSlotFor(d, p, classId) {
    return getFixedSlotsFor(d, p, classId)[0] || null
  }

  // Fixed slots affecting this teacher at (day, period) — display policy mirrors
  // solver/preflight (teacherBusyByFixedSlot):
  //   supervise → ครูผู้ดูแลกิจกรรม → busy (แสดงเสมอ)
  //   assembly  → ล็อกทั้งโรงเรียน (class_ids ว่าง) → busy (แสดงทุกคน)
  //   class     → ล็อกเฉพาะห้องที่ครูสอน → ให้ข้อมูล (คาบสอนชนะ, ตัดสินใจที่ render)
  // Returns { fs, kind, affectedClassIds } | null (priority supervise > assembly > class).
  function getFixedSlotsForTeacher(d, p) {
    if (!activeTeacherId || !fixedSlots) return null
    const taughtClassIds = new Set(teacherClasses.map((c) => c.id))
    return teacherBusyByFixedSlot(fixedSlots, d, p, activeTeacherId, taughtClassIds)
  }

  // Substitute lookup: "day-period-classId" → substitute entry (สอนแทน)
  const substituteMap = useMemo(() => {
    const map = new Map()
    for (const s of substitutes || []) {
      map.set(`${s.day}-${s.period}-${s.class_id}`, s)
    }
    return map
  }, [substitutes])

  // Build user placement lookup: { "day-period-classId": { lessonBlock, day, period } }
  const userPlacementMap = useMemo(() => {
    const map = new Map()
    for (const [lbId, placements] of Object.entries(userPlacements)) {
      const lb = lessonBlockMap.get(lbId)
      if (!lb) continue
      for (const p of placements) {
        map.set(`${p.day}-${p.period}-${lb.class_id}`, { lessonBlock: lb, day: p.day, period: p.period })
      }
    }
    return map
  }, [userPlacements, lessonBlockMap])

  // Build slot lookup from localSlots
  const slotMap = new Map()
  for (const slot of localSlots) {
    const key = `${slot.day}-${slot.period}`
    if (!slotMap.has(key)) slotMap.set(key, [])
    slotMap.get(key).push(slot)
  }

  // Determine mode: teacher mode vs class mode
  const isTeacherMode = !!(selectedTeacher || filterTeacher)
  const activeTeacherId = selectedTeacher || filterTeacher

  // Teacher mode: compute teacher's classes and class color map
  // (includes classes where the teacher is the co-teacher)
  const teacherClasses = useMemo(() => {
    if (!activeTeacherId) return []
    const classIds = new Set()
    for (const s of localSlots) {
      if (s.teacher_id === activeTeacherId) {
        classIds.add(s.class_id)
        continue
      }
      const lb = lessonBlockMap.get(s.lesson_block_id)
      if (lb && lb.co_teacher_id === activeTeacherId) {
        classIds.add(s.class_id)
      }
    }
    // Also include user placements for this teacher
    for (const [lbId, placements] of Object.entries(userPlacements)) {
      const lb = lessonBlockMap.get(lbId)
      if (lb && (lb.teacher_id === activeTeacherId || lb.co_teacher_id === activeTeacherId)) {
        classIds.add(lb.class_id)
      }
    }
    return classes.filter((c) => classIds.has(c.id))
  }, [activeTeacherId, localSlots, classes, userPlacements, lessonBlockMap])

  const classColorMap = useMemo(() => {
    const map = {}
    teacherClasses.forEach((c, i) => { map[c.id] = i })
    return map
  }, [teacherClasses])

  // Conflict detection: check if a slot would clash at a target position
  const checkConflicts = useCallback((slot, targetDay, targetPeriod, targetClassId) => {
    const conflicts = []
    const sameSlotSlots = slotMap.get(`${targetDay}-${targetPeriod}`) || []

    // H1: Teacher clash — same teacher (main OR co) already teaching at this day-period
    for (const s of sameSlotSlots) {
      if (s.lesson_block_id !== slot.lesson_block_id) {
        const slotLb = lessonBlockMap.get(slot.lesson_block_id)
        const otherLb = lessonBlockMap.get(s.lesson_block_id)
        const slotTeachers = new Set([
          slot.teacher_id,
          ...(slotLb && slotLb.co_teacher_id ? [slotLb.co_teacher_id] : []),
        ])
        const otherTeachers = new Set([
          s.teacher_id,
          ...(otherLb && otherLb.co_teacher_id ? [otherLb.co_teacher_id] : []),
        ])
        if ([...slotTeachers].some((tid) => otherTeachers.has(tid))) {
          conflicts.push('H1: ครูสอนซ้ำเวลา')
        }
        // H2: Class clash — same class already has a lesson at this day-period
        if (targetClassId && s.class_id === targetClassId) {
          conflicts.push('H2: ห้องเรียนซ้ำเวลา')
        }
      }
    }
    return conflicts
  }, [slotMap, lessonBlockMap])

  // Detect conflicts for all displayed slots
  function getSlotConflicts(slot, classId) {
    if (!slot) return []
    return checkConflicts(slot, slot.day, slot.period, classId)
  }

  function getFilteredSlots(d, p, classId) {
    const all = slotMap.get(`${d}-${p}`) || []
    return all.filter((s) => {
      if (classId && s.class_id !== classId) return false
      if (activeTeacherId && s.teacher_id !== activeTeacherId) return false
      return true
    })
  }

  // Teacher mode: get all slots for this teacher at day-period, enriched with names.
  // Includes slots where the teacher is the co-teacher (resolved from the lesson
  // block, or the slot's own co_teacher_id from newer backends), user placements
  // placed manually, plus substitute (สอนแทน) duties where the teacher is covering
  // another teacher's slot.
  function getTeacherSlots(d, p) {
    const all = slotMap.get(`${d}-${p}`) || []
    const mapped = all
      .filter((s) => {
        if (s.teacher_id === activeTeacherId) return true
        if (s.co_teacher_id === activeTeacherId) return true
        const lb = lessonBlockMap.get(s.lesson_block_id)
        return !!(lb && lb.co_teacher_id === activeTeacherId)
      })
      .map((s) => {
        const lb = lessonBlockMap.get(s.lesson_block_id)
        const coTeacherId = lb?.co_teacher_id || s.co_teacher_id || null
        return {
          ...s,
          className: classMap.get(s.class_id)?.name || s.class_id,
          subjectName: subjectMap.get(s.subject_id)?.name || s.subject_id,
          subjectCategory: subjectMap.get(s.subject_id)?.category,
          coTeacherId,
          // Names of BOTH teachers for co-taught entries (ตารางครูต้องโชว์ 2 ชื่อ)
          mainTeacherName: teacherMap.get(s.teacher_id)?.name || s.teacher_id,
          coTeacherName: coTeacherId ? (teacherMap.get(coTeacherId)?.name || coTeacherId) : null,
          isPreAssigned: (() => {
            const placements = userPlacements[s.lesson_block_id]
            return !!(placements && placements.some((pp) => pp.day === s.day && pp.period === s.period))
          })(),
        }
      })
    // User placements (วางด้วยมือ/ปักหมุด) that have no solver slot yet —
    // without this they are invisible in teacher mode and the period count
    // doesn't match the teacher's actual workload.
    for (const up of userPlacementMap.values()) {
      const lb = up.lessonBlock
      if (!lb || up.day !== d || up.period !== p) continue
      if (lb.teacher_id !== activeTeacherId && lb.co_teacher_id !== activeTeacherId) continue
      const already = mapped.some((m) => m.lesson_block_id === lb.id && m.day === d && m.period === p)
      if (already) continue
      const coTeacherId = lb.co_teacher_id || null
      mapped.push({
        lesson_block_id: lb.id,
        day: d,
        period: p,
        subject_id: lb.subject_id,
        teacher_id: lb.teacher_id,
        class_id: lb.class_id,
        room_id: lb.room_id,
        className: classMap.get(lb.class_id)?.name || lb.class_id,
        subjectName: subjectMap.get(lb.subject_id)?.name || lb.subject_id,
        subjectCategory: subjectMap.get(lb.subject_id)?.category,
        coTeacherId,
        mainTeacherName: teacherMap.get(lb.teacher_id)?.name || lb.teacher_id,
        coTeacherName: coTeacherId ? (teacherMap.get(coTeacherId)?.name || coTeacherId) : null,
        isPreAssigned: true,
      })
    }
    // Substitute duties for this teacher at (d, p)
    for (const sub of substitutes || []) {
      if (sub.day !== d || sub.period !== p || sub.substitute_teacher_id !== activeTeacherId) continue
      const orig = all.find((s) => s.class_id === sub.class_id)
      if (orig) {
        mapped.push({
          ...orig,
          className: classMap.get(sub.class_id)?.name || sub.class_id,
          subjectName: subjectMap.get(sub.subject_id)?.name || sub.subject_id,
          subjectCategory: subjectMap.get(sub.subject_id)?.category,
          isSubstitute: true,
          isPreAssigned: false,
        })
      }
    }
    return mapped
  }

  const dayList = Array.from({ length: days }, (_, i) => i + 1)
  const breakSet = new Set(breakPeriods)
  // Use explicit periodList prop (supports decimals) when provided;
  // otherwise fall back to integer range 1..periodsPerDay.
  const periodList = periodListProp && periodListProp.length > 0
    ? periodListProp
    : Array.from({ length: periodsPerDay }, (_, i) => i + 1)
  // Build grid-template-columns: BREAK columns are narrower (~0.2fr) than
  // regular columns (1fr) to visually emphasize they are short breaks.
  // minmax(0, ...) prevents grid blowout from long cell content.
  const periodColsTemplate = periodList
    .map((p) => (breakSet.has(p) ? 'minmax(0, 0.2fr)' : 'minmax(0, 1fr)'))
    .join(' ')

  // Determine the active class for single-class mode
  const activeClass = useMemo(() => {
    if (selectedClass) return classes.find((c) => c.id === selectedClass) || null
    if (filterClass) return classes.find((c) => c.id === filterClass) || null
    return null
  }, [selectedClass, filterClass, classes])

  function handleDragStart(e, slot, classId) {
    setDragSource({ day: slot.day, period: slot.period, classId, lessonBlockId: slot.lesson_block_id })
    e.dataTransfer.effectAllowed = 'move'
    // Also set grid slot info for drag-to-drawer support
    e.dataTransfer.setData('application/x-grid-slot', JSON.stringify({
      lessonBlockId: slot.lesson_block_id,
      day: slot.day,
      period: slot.period,
      classId,
    }))
  }

  function handleDragEnd() {
    setDragSource(null)
    setDragTarget(null)
  }

  // ── Validate cell for sidebar drag ──────────────────────────────
  function validateCell(lb, d, p, classId) {
    // 1. Lunch period
    if (lunchSet.has(p)) return { valid: false, reason: 'คาบพักเที่ยง' }
    // 1b. Short break (inserted BREAK with decimal period_no)
    if (breakSet.has(p)) return { valid: false, reason: 'คาบพักสั้น' }
    // 2. Fixed slot (class-aware — only blocks classes in fs.class_ids)
    const effClassId = classId || lb?.class_id || null
    const fixedSlotsAtCell = getFixedSlotsFor(d, p, effClassId)
    if (fixedSlotsAtCell.length > 0) {
      const fs = fixedSlotsAtCell[0]
      return { valid: false, reason: `🔒 ${fs.name || 'กิจกรรมล็อก'}` }
    }
    // 3. Class mismatch (in class view)
    if (classId && lb.class_id && lb.class_id !== classId)
      return { valid: false, reason: 'คนละห้องเรียน' }
    // 4. Already occupied by solver slot
    const existingSlots = (slotMap.get(`${d}-${p}`) || []).filter(
      (s) => !classId || s.class_id === classId,
    )
    if (existingSlots.length > 0) {
      // Same lesson block already occupies this cell → hard-block (no
      // force option) with a clear message. Force-placing would create
      // a duplicate placement that the reducer would reject anyway, and
      // pinning the same block twice would double-count.
      if (existingSlots.some((s) => s.lesson_block_id === lb.id))
        return { valid: false, forceable: false, reason: 'มีคาบนี้วางอยู่แล้ว' }
      return { valid: false, reason: 'มีวิชาอื่นวางอยู่แล้ว (ระบบจัด)' }
    }
    // 5. Already occupied by user placement
    if (classId && userPlacementMap.has(`${d}-${p}-${classId}`))
      return { valid: false, reason: 'มีวิชาอื่นวางด้วยมืออยู่แล้ว' }
    // 6. Teacher double-booked at same day+period (main OR co-teacher)
    const lbTeachers = new Set([
      lb.teacher_id,
      ...(lb.co_teacher_id ? [lb.co_teacher_id] : []),
    ])
    const teacherBusyInSlots = localSlots.some((s) => {
      if (s.day !== d || s.period !== p || s.lesson_block_id === lb.id) return false
      const otherLb = lessonBlockMap.get(s.lesson_block_id)
      const otherTeachers = new Set([
        s.teacher_id,
        ...(otherLb && otherLb.co_teacher_id ? [otherLb.co_teacher_id] : []),
      ])
      return [...lbTeachers].some((tid) => otherTeachers.has(tid))
    })
    const teacherBusyInPlacements = [...userPlacementMap.values()].some((up) => {
      if (up.day !== d || up.period !== p || up.lessonBlock.id === lb.id) return false
      const otherTeachers = new Set([
        up.lessonBlock.teacher_id,
        ...(up.lessonBlock.co_teacher_id ? [up.lessonBlock.co_teacher_id] : []),
      ])
      return [...lbTeachers].some((tid) => otherTeachers.has(tid))
    })
    if (teacherBusyInSlots || teacherBusyInPlacements)
      return { valid: false, reason: 'ครูติดสอนห้องอื่นในคาบนี้' }
    // 7. Block already fully placed (total placements >= periods_per_week)
    const totalPlaced =
      localSlots.filter((s) => s.lesson_block_id === lb.id).length +
      (userPlacements[lb.id]?.length || 0)
    if (totalPlaced >= (lb.periods_per_week || 0))
      return { valid: false, reason: `วางครบ ${lb.periods_per_week} คาบแล้ว` }
    // 8. Consecutive same-block on same day (adjacent period)
    const isAdjacentInSlots = localSlots.some(
      (s) =>
        s.lesson_block_id === lb.id &&
        s.day === d &&
        (s.period === p - 1 || s.period === p + 1),
    )
    const isAdjacentInPlacements = [...userPlacementMap.values()].some(
      (up) =>
        up.lessonBlock.id === lb.id &&
        up.day === d &&
        (up.period === p - 1 || up.period === p + 1),
    )
    if (isAdjacentInSlots || isAdjacentInPlacements)
      return { valid: false, reason: 'วางติดกันกับบล็อกเดียวกัน' }
    // Valid
    return { valid: true, reason: null }
  }

  function handleDragOver(e, d, p, classId) {
    e.preventDefault()
    // Sidebar drag: use stored block (getData() is blocked during dragover)
    if (e.dataTransfer.types.includes('application/json') && sidebarDragBlock) {
      const result = validateCell(sidebarDragBlock, d, p, classId)
      setDragTarget({ day: d, period: p, classId, ...result })
      e.dataTransfer.dropEffect = result.valid ? 'copy' : 'none'
      return
    }
    // Internal grid drag
    e.dataTransfer.dropEffect = 'move'
    const effClassId = classId || dragSource?.classId || null
    if (lunchSet.has(p) || breakSet.has(p) || getFixedSlotsFor(d, p, effClassId).length > 0) return
    setDragTarget({ day: d, period: p, classId, valid: true, reason: null })
  }

  function handleDrop(e, d, p, classId) {
    e.preventDefault()
    if (!dragSource) {
      // Sidebar drop: check dataTransfer for lesson block JSON
      const lbJson = e.dataTransfer.getData('application/json')
      if (lbJson && onDropFromSidebar) {
        try {
          const lb = JSON.parse(lbJson)
          onDropFromSidebar(lb, d, p, classId)
        } catch { /* ignore parse errors */ }
      }
      return
    }
    const effClassId = classId || dragSource?.classId || null
    if (lunchSet.has(p) || breakSet.has(p) || getFixedSlotsFor(d, p, effClassId).length > 0) return

    // Find the slot being dragged (match the exact source position so a
    // double-period block's other period is not picked up)
    const sourceSlots = slotMap.get(`${dragSource.day}-${dragSource.period}`) || []
    const draggedSlot = sourceSlots.find(
      (s) => s.lesson_block_id === dragSource.lessonBlockId
        && s.day === dragSource.day
        && s.period === dragSource.period,
    ) || sourceSlots.find((s) => s.lesson_block_id === dragSource.lessonBlockId)
    if (!draggedSlot) return

    // No-op: dropped back on its own position
    if (d === dragSource.day && p === dragSource.period) {
      setDragSource(null)
      setDragTarget(null)
      return
    }

    // Check conflicts at target
    const conflicts = checkConflicts(draggedSlot, d, p, classId)
    if (conflicts.length > 0) {
      setDragSource(null)
      setDragTarget(null)
      return
    }

    // Guard: the target must not already contain another period of the SAME
    // lesson block (e.g. the sibling of a double-period pair) — otherwise
    // both slots would stack in one cell and the source cell goes empty.
    const targetSlots = slotMap.get(`${d}-${p}`) || []
    const siblingAtTarget = targetSlots.some(
      (s) => s.lesson_block_id === draggedSlot.lesson_block_id,
    )
    if (siblingAtTarget) {
      setDragSource(null)
      setDragTarget(null)
      return
    }

    // Perform swap: move ONLY the dragged slot's day & period. Double-period
    // blocks emit one slot per period (p, p+1); the sibling stays in place.
    const newSlots = localSlots.map((s) => {
      if (s.lesson_block_id === draggedSlot.lesson_block_id
        && s.day === dragSource.day
        && s.period === dragSource.period) {
        return { ...s, day: d, period: p }
      }
      return s
    })
    setLocalSlots(newSlots)
    if (onSlotSwap) onSlotSwap(newSlots)
    // Persist move to AppContext so it survives refresh
    if (onSlotMove) onSlotMove(draggedSlot.lesson_block_id, dragSource.day, dragSource.period, d, p)

    setDragSource(null)
    setDragTarget(null)
  }

  // Handle drop from sidebar (when no internal drag source is active)
  function handleSidebarDrop(e, d, p, classId) {
    const lbJson = e.dataTransfer.getData('application/json')
    if (!lbJson || !onDropFromSidebar) return
    e.preventDefault()
    try {
      const lb = JSON.parse(lbJson)
      const result = validateCell(lb, d, p, classId)
      if (!result.valid) {
        // Hard-block (e.g. same lesson block already in this cell) — do
        // NOT open the force-place modal; just leave the red drag target
        // so the user sees the reason without being offered a destructive
        // confirm that would double-count the placement.
        if (result.forceable === false) {
          setDragTarget({ day: d, period: p, classId, ...result })
          return
        }
        // Show force-place confirmation
        setForcePlacePending({ lb, day: d, period: p, classId, reason: result.reason })
        setShowForceConfirm(true)
        setDragTarget(null)
        return
      }
      onDropFromSidebar(lb, d, p, classId)
    } catch { /* ignore parse errors */ }
    setDragTarget(null)
  }

  // ── Right-click context menu ──────────────────────────────────────
  function handleContextMenu(e, d, p, classId, cellType, slot) {
    e.preventDefault()
    setContextMenu({
      x: e.clientX,
      y: e.clientY,
      cellType, // 'solver' | 'placement' | 'fixed' | 'empty'
      slot,
      day: d,
      period: p,
      classId,
    })
  }

  // ── Single class grid (full-width) ────────────────────────────────
  function renderSingleGrid(classGroup) {
    const classId = classGroup?.id || null

    return (
      <div key={classGroup?.id || 'all'} className="space-y-2">
        {/* min-w keeps the 8-period grid legible on tablets — the wrapper
            scrolls horizontally instead of crushing the cells */}
        <div className="overflow-x-auto">
          <div className="min-w-[760px]">
            {/* Header: วัน | คาบ1 | คาบ2 | ... */}
            <GridHeader
              periodList={periodList}
              periodColsTemplate={periodColsTemplate}
              lunchSet={lunchSet}
              breakSet={breakSet}
            />

            {/* Day rows */}
            {dayList.map((d) => (
              <div
                key={d}
                className="grid gap-2.5 mb-2"
                style={{ gridTemplateColumns: `100px ${periodColsTemplate}` }}
              >
                <div className="flex items-center justify-center text-sm sm:text-base font-bold text-gray-600 bg-gray-100 rounded">
                  {DAY_LABELS[d] || `วัน${d}`}
                </div>
                {periodList.map((p) => {
                  const isLunch = lunchSet.has(p)
                  const isBreak = breakSet.has(p)
                  const fixedSlot = getFixedSlotFor(d, p, classId)
                  const isFixed = !!fixedSlot
                  // ครูผู้ดูแลกิจกรรมของห้องนี้ (class_teachers[classId] — อาจมีหลายคน)
                  const fixedSlotTeacherName = (() => {
                    if (!isFixed || !fixedSlot?.class_teachers?.[classId]) return null
                    const raw = fixedSlot.class_teachers[classId]
                    const ids = Array.isArray(raw) ? raw : [raw]
                    const names = ids.map((tid) => teacherMap.get(tid)?.name || tid).filter(Boolean)
                    if (names.length === 0) return null
                    return names.length <= 2
                      ? names.join(', ')
                      : `${names.slice(0, 2).join(', ')} +${names.length - 2}`
                  })()
                  const userPlacement = userPlacementMap.get(`${d}-${p}-${classId}`)
                  const matchedSlots = isFixed || isLunch || isBreak ? [] : getFilteredSlots(d, p, classId)
                  const slot = matchedSlots[0] || null
                  const isTarget = dragTarget?.day === d && dragTarget?.period === p && dragTarget?.classId === classId
                  const targetInfo = isTarget ? dragTarget : null
                  const conflicts = slot ? getSlotConflicts(slot, classId) : []

                  // If there's a user placement but no solver slot, build a pseudo-slot
                  let displaySlot = slot
                  let displaySubject = slot ? subjectMap.get(slot.subject_id) : null
                  let displayTeacher = slot ? teacherMap.get(slot.teacher_id) : null
                  let displayCoTeacher = null
                  let displayClass = slot ? classMap.get(slot.class_id) : null
                  let isPreAssigned = false

                  // Resolve co-teacher name from the lesson block (if any),
                  // falling back to the slot's own co_teacher_id (newer backends
                  // send it, useful when the lesson block lookup misses).
                  const resolveCoTeacher = (lb, slot) => {
                    const coId = lb?.co_teacher_id || slot?.co_teacher_id || null
                    return coId ? (teacherMap.get(coId) || null) : null
                  }

                  if (!slot && userPlacement) {
                    const lb = userPlacement.lessonBlock
                    displaySlot = {
                      lesson_block_id: lb.id,
                      day: d,
                      period: p,
                      subject_id: lb.subject_id,
                      teacher_id: lb.teacher_id,
                      class_id: lb.class_id,
                      room_id: lb.room_id,
                    }
                    displaySubject = subjectMap.get(lb.subject_id)
                    displayTeacher = teacherMap.get(lb.teacher_id)
                    displayCoTeacher = resolveCoTeacher(lb)
                    displayClass = classMap.get(lb.class_id)
                    isPreAssigned = true
                  } else if (slot) {
                    // Solver slot that also has a user placement at this exact (day, period) → pinned
                    const lb = lessonBlockMap.get(slot.lesson_block_id)
                    displayCoTeacher = resolveCoTeacher(lb, slot)
                    const placements = userPlacements[slot.lesson_block_id]
                    if (placements && placements.some((p) => p.day === slot.day && p.period === slot.period)) {
                      isPreAssigned = true
                    }
                  }

                  // Substitute (สอนแทน) for this class slot
                  const substituteEntry = (isFixed || isLunch || isBreak) ? null : substituteMap.get(`${d}-${p}-${classId}`)
                  const displaySubstitute = substituteEntry
                    ? teacherMap.get(substituteEntry.substitute_teacher_id) || null
                    : null
                  const substituteOriginalName = substituteEntry
                    ? (teacherMap.get(substituteEntry.original_teacher_id)?.name || substituteEntry.original_teacher_id)
                    : null

                  return (
                    <GridCell
                      key={`${d}-${p}`}
                      slot={displaySlot}
                      isLunch={isLunch}
                      isBreak={isBreak}
                      isFixed={isFixed}
                      fixedSlotName={fixedSlot?.name}
                      fixedSlotTeacherName={fixedSlotTeacherName}
                      isPreAssigned={isPreAssigned}
                      isDragTarget={isTarget}
                      dragTargetInfo={targetInfo}
                      isDraggable={!!slot && !isFixed && !isPreAssigned}
                      conflicts={conflicts}
                      onDragStart={(e) => handleDragStart(e, slot, classId)}
                      onDragEnd={handleDragEnd}
                      onDragOver={(e) => handleDragOver(e, d, p, classId)}
                      onDrop={(e) => {
                        if (!dragSource) {
                          handleSidebarDrop(e, d, p, classId)
                        } else {
                          handleDrop(e, d, p, classId)
                        }
                      }}
                      onContextMenu={(e) => handleContextMenu(e, d, p, classId,
                        isFixed ? 'fixed' : isPreAssigned ? 'placement' : slot ? 'solver' : 'empty',
                        displaySlot,
                      )}
                      subject={displaySubject}
                      teacher={displayTeacher}
                      coTeacher={displayCoTeacher}
                      substitute={displaySubstitute}
                      substituteOriginalName={substituteOriginalName}
                      classGroup={displayClass}
                      roomName={getSpecialRoomName(displaySlot)}
                      onRemoveSlot={displaySlot && !isFixed ? () => onRemoveSlot?.(displaySlot.lesson_block_id, isPreAssigned, d, p) : undefined}
                      onTogglePin={displaySlot && !isFixed ? () => onTogglePin?.(displaySlot.lesson_block_id, d, p, isPreAssigned) : undefined}
                    />
                  )
                })}
              </div>
            ))}
          </div>
        </div>
      </div>
    )
  }

  // Render single combined grid for teacher mode
  function renderTeacherGrid() {
    return (
      <div className="space-y-2">
        <div className="overflow-x-auto">
          <div className="min-w-[760px]">
            {/* Header */}
            <GridHeader
              periodList={periodList}
              periodColsTemplate={periodColsTemplate}
              lunchSet={lunchSet}
              breakSet={breakSet}
            />

            {/* Day rows */}
            {dayList.map((d) => (
              <div
                key={d}
                className="grid gap-2.5 mb-2"
                style={{ gridTemplateColumns: `100px ${periodColsTemplate}` }}
              >
                <div className="flex items-center justify-center text-sm sm:text-base font-bold text-gray-600 bg-gray-100 rounded">
                  {DAY_LABELS[d] || `วัน${d}`}
                </div>
                {periodList.map((p) => {
                  const isLunch = lunchSet.has(p)
                  const isBreak = breakSet.has(p)
                  const teacherSlots = isLunch || isBreak ? [] : getTeacherSlots(d, p)
                  const fixedInfo = isLunch || isBreak ? null : getFixedSlotsForTeacher(d, p)
                  // supervise/assembly = busy → แสดงล็อกเสมอ; class = ให้ข้อมูล → แสดงเมื่อครูไม่มีคาบสอน
                  const isFixed = !!fixedInfo && (fixedInfo.kind !== 'class' || teacherSlots.length === 0)
                  const fixedSlot = isFixed ? fixedInfo.fs : null
                  const fixedSlotKind = isFixed ? fixedInfo.kind : null
                  // supervise → badge "ดูแลกิจกรรม"; class → ป้ายชื่อห้องที่ติด
                  const fixedSlotTeacherName = isFixed && fixedInfo.kind === 'supervise'
                    ? (teacherMap.get(activeTeacherId)?.name || activeTeacherId)
                    : null
                  const fixedClassNames = fixedInfo?.kind === 'class'
                    ? fixedInfo.affectedClassIds.map((cid) => classMap.get(cid)?.name || cid)
                    : []
                  const isTarget = dragTarget?.day === d && dragTarget?.period === p
                  const targetInfo = isTarget ? dragTarget : null
                  return (
                    <GridCell
                      key={`${d}-${p}`}
                      slot={null}
                      slots={teacherSlots}
                      isLunch={isLunch}
                      isBreak={isBreak}
                      isFixed={isFixed}
                      fixedSlotName={fixedSlot?.name}
                      fixedSlotTeacherName={fixedSlotTeacherName}
                      fixedSlotKind={fixedSlotKind}
                      fixedClassNames={fixedClassNames}
                      isDragTarget={isTarget}
                      dragTargetInfo={targetInfo}
                      isDraggable={teacherSlots.length > 0 && !isFixed}
                      colorMode="class"
                      classColorMap={classColorMap}
                      onDragStart={(e, s) => handleDragStart(e, s, s.class_id)}
                      onDragEnd={handleDragEnd}
                      onDragOver={(e) => handleDragOver(e, d, p, null)}
                      onDrop={(e) => {
                        if (!dragSource) {
                          handleSidebarDrop(e, d, p, null)
                        } else {
                          handleDrop(e, d, p, null)
                        }
                      }}
                      onContextMenu={(e) => handleContextMenu(e, d, p, null,
                        isFixed ? 'fixed' : teacherSlots.length > 0 ? 'solver' : 'empty',
                        teacherSlots[0],
                      )}
                      onTogglePinSlot={onTogglePin ? (s) => onTogglePin(s.lesson_block_id, s.day, s.period, s.isPreAssigned) : undefined}
                    />
                  )
                })}
              </div>
            ))}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-4 pb-4">
      {/* Header: active name badge + view-mode segmented toggle */}
      <div className="flex items-center gap-3 mb-1">
        {isTeacherMode ? (
          <>
            <span className="text-base font-bold bg-purple-50 text-purple-700 border border-purple-200 px-3 py-1 rounded-lg">
              👨‍🏫 {teacherMap.get(activeTeacherId)?.name || activeTeacherId} — ทุกห้อง
            </span>
            <span className="text-xs text-gray-500">{teacherClasses.length} ห้อง</span>
          </>
        ) : (
          <span className="text-base font-bold bg-blue-50 text-blue-700 border border-blue-200 px-3 py-1 rounded-lg">
            {activeClass ? activeClass.name : 'ทุกห้อง'}
          </span>
        )}

        <div className="inline-flex rounded-lg border border-gray-200 bg-gray-100 p-0.5">
          <button
            onClick={() => onViewModeChange?.('class')}
            className={`px-3 py-1 rounded-md text-xs font-semibold transition-all ${
              viewMode === 'class'
                ? 'bg-white text-blue-700 shadow-sm'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            🏫 ดูตามห้องเรียน
          </button>
          <button
            onClick={() => onViewModeChange?.('teacher')}
            className={`px-3 py-1 rounded-md text-xs font-semibold transition-all ${
              viewMode === 'teacher'
                ? 'bg-white text-purple-700 shadow-sm'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            👤 ดูตามครูผู้สอน
          </button>
          <button
            onClick={() => onTabChange?.('facilities')}
            className="px-3 py-1 rounded-md text-xs font-semibold transition-all text-gray-500 hover:text-gray-700"
          >
            🔬 ห้องปฏิบัติการ
          </button>
        </div>

        {/* Context-sensitive batch actions */}
        {viewMode === 'class' && selectedClassId && (
          <div className="flex items-center gap-1.5 ml-auto">
            <button
              onClick={() => onPinByClass?.(selectedClassId)}
              className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-amber-700
                bg-amber-50 border border-amber-200 hover:bg-amber-100 rounded-lg transition-colors"
              title="ล็อกทุกคาบของห้องนี้ (ปักหมุดผล AI ทั้งหมดของห้อง)"
            >
              📌 ล็อกห้องนี้
            </button>
            <button
              onClick={() => onClearByClass?.(selectedClassId)}
              className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-red-700
                bg-red-50 border border-red-200 hover:bg-red-100 rounded-lg transition-colors"
              title="ล้างทุกคาบของห้องนี้ (คืนวิชาทั้งหมดเข้าคลัง)"
            >
              🗑️ ล้างห้องนี้
            </button>
          </div>
        )}
        {viewMode === 'teacher' && selectedTeacherId && (
          <div className="flex items-center gap-1.5 ml-auto">
            <button
              onClick={() => onPinByTeacher?.(selectedTeacherId)}
              className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-amber-700
                bg-amber-50 border border-amber-200 hover:bg-amber-100 rounded-lg transition-colors"
              title="ล็อกทุกคาบของครูท่านนี้ (ปักหมุดผล AI ทั้งหมดของครู)"
            >
              📌 ล็อกตารางครูท่านนี้
            </button>
            <button
              onClick={() => onClearByTeacher?.(selectedTeacherId)}
              className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-red-700
                bg-red-50 border border-red-200 hover:bg-red-100 rounded-lg transition-colors"
              title="ล้างทุกคาบของครูท่านนี้ (คืนวิชาทั้งหมดเข้าคลัง)"
            >
              🗑️ ล้างตารางครูท่านนี้
            </button>
          </div>
        )}
      </div>

      <GridLegend
        mode={isTeacherMode ? 'class' : 'subject'}
        teacherClasses={teacherClasses}
        classColorMap={classColorMap}
        showLockLegend={isTeacherMode && !!(fixedSlots && fixedSlots.length > 0)}
      />
      {dragSource && (
        <div className="text-sm text-blue-600 bg-blue-50 rounded-lg px-3 py-1.5">
          ลาก cell ไปยังช่องว่าง (เขียว = วางได้) เพื่อสลับคาบ
        </div>
      )}
      {isTeacherMode ? renderTeacherGrid() : renderSingleGrid(activeClass)}

      {/* Force-place confirmation modal */}
      {showForceConfirm && forcePlacePending && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center">
          <div
            className="absolute inset-0 bg-black/40"
            onClick={() => { setShowForceConfirm(false); setForcePlacePending(null) }}
          />
          <div className="relative bg-white rounded-2xl shadow-2xl p-6 max-w-sm w-full mx-4">
            <h3 className="text-lg font-bold text-gray-900 mb-2">ไม่สามารถวางในช่องนี้ได้</h3>
            <p className="text-sm text-amber-700 bg-amber-50 rounded-lg px-3 py-2">
              {forcePlacePending.reason}
            </p>
            <p className="text-sm text-gray-600 mt-3">ต้องการฝืนวางในช่องนี้หรือไม่?</p>
            <p className="text-xs text-gray-400 mt-1">
              (เฉพาะบล็อกนี้เท่านั้น บล็อกอื่นเงื่อนไขเหมือนเดิม)
            </p>
            <div className="flex gap-3 mt-5">
              <button
                onClick={() => { setShowForceConfirm(false); setForcePlacePending(null) }}
                className="flex-1 px-4 py-2.5 text-sm font-medium text-gray-700 bg-gray-100
                  hover:bg-gray-200 rounded-xl transition-colors"
              >
                ยกเลิก
              </button>
              <button
                onClick={() => {
                  const { lb, day, period, classId } = forcePlacePending
                  onDropFromSidebar(lb, day, period, classId)
                  setShowForceConfirm(false)
                  setForcePlacePending(null)
                  setDragTarget(null)
                }}
                className="flex-1 px-4 py-2.5 text-sm font-bold text-white bg-amber-600
                  hover:bg-amber-700 rounded-xl transition-colors"
              >
                ยืนยันการวาง
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Right-click context menu */}
      <CellContextMenu
        menu={contextMenu}
        onClose={() => setContextMenu(null)}
        onDeleteSlot={onSlotDelete}
        onRemovePlacement={onRemovePlacement}
        onLockSlot={onLockSlot}
        onUnlockSlot={onUnlockSlot}
        onChangeRoom={onChangeSlotRoom ? (slot) => {
          setContextMenu(null)
          setRoomEditSlot(slot)
        } : undefined}
      />

      {/* Room edit modal (change special room on-the-fly) */}
      {roomEditSlot && (
        <CellRoomEditModal
          slot={roomEditSlot}
          specialRooms={specialRooms}
          allSlots={localSlots}
          onClose={() => setRoomEditSlot(null)}
          onChange={onChangeSlotRoom}
        />
      )}
    </div>
  )
}
