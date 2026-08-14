import { useState, useCallback, useMemo } from 'react'
import GridCell, { getClassColors } from './GridCell.jsx'
import GridLegend from './GridLegend.jsx'
import { DAY_LABELS } from './GridLegend.jsx'

export default function TimetableGrid({
  slots = [],
  subjects,
  teachers,
  classes,
  days,
  periodsPerDay,
  lunchPeriods,
  fixedSlots,
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
}) {
  const [dragSource, setDragSource] = useState(null) // { day, period, classId, lessonBlockId }
  const [dragTarget, setDragTarget] = useState(null)
  const [forcePlacePending, setForcePlacePending] = useState(null) // { lb, day, period, classId, reason }
  const [showForceConfirm, setShowForceConfirm] = useState(false)
  const [localSlots, setLocalSlots] = useState(slots)

  // Update localSlots when props change (but not during active drag)
  if (slots !== localSlots && !dragSource) {
    setLocalSlots(slots)
  }

  const subjectMap = new Map(subjects.map((s) => [s.id, s]))
  const teacherMap = new Map(teachers.map((t) => [t.id, t]))
  const classMap = new Map(classes.map((c) => [c.id, c]))
  const lessonBlockMap = new Map(lessonBlocks.map((lb) => [lb.id, lb]))
  const lunchSet = new Set(lunchPeriods)

  // Build fixed slot lookup: { "day-period": FixedSlot }
  const fixedSlotMap = new Map()
  if (fixedSlots) {
    for (const fs of fixedSlots) {
      fixedSlotMap.set(`${fs.day}-${fs.period}`, fs)
    }
  }

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
  const teacherClasses = useMemo(() => {
    if (!activeTeacherId) return []
    const classIds = new Set()
    for (const s of localSlots) {
      if (s.teacher_id === activeTeacherId) {
        classIds.add(s.class_id)
      }
    }
    // Also include user placements for this teacher
    for (const [lbId, placements] of Object.entries(userPlacements)) {
      const lb = lessonBlockMap.get(lbId)
      if (lb && lb.teacher_id === activeTeacherId) {
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

    // H1: Teacher clash — same teacher already teaching at this day-period
    for (const s of sameSlotSlots) {
      if (s.lesson_block_id !== slot.lesson_block_id) {
        if (s.teacher_id === slot.teacher_id) {
          conflicts.push('H1: ครูสอนซ้ำเวลา')
        }
        // H2: Class clash — same class already has a lesson at this day-period
        if (targetClassId && s.class_id === targetClassId) {
          conflicts.push('H2: ห้องเรียนซ้ำเวลา')
        }
      }
    }
    return conflicts
  }, [slotMap])

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

  // Teacher mode: get all slots for this teacher at day-period, enriched with names
  function getTeacherSlots(d, p) {
    const all = slotMap.get(`${d}-${p}`) || []
    return all
      .filter((s) => s.teacher_id === activeTeacherId)
      .map((s) => ({
        ...s,
        className: classMap.get(s.class_id)?.name || s.class_id,
        subjectName: subjectMap.get(s.subject_id)?.name || s.subject_id,
        subjectCategory: subjectMap.get(s.subject_id)?.category,
      }))
  }

  const dayList = Array.from({ length: days }, (_, i) => i + 1)
  const periodList = Array.from({ length: periodsPerDay }, (_, i) => i + 1)

  // Determine the active class for single-class mode
  const activeClass = useMemo(() => {
    if (selectedClass) return classes.find((c) => c.id === selectedClass) || null
    if (filterClass) return classes.find((c) => c.id === filterClass) || null
    return null
  }, [selectedClass, filterClass, classes])

  function handleDragStart(e, slot, classId) {
    setDragSource({ day: slot.day, period: slot.period, classId, lessonBlockId: slot.lesson_block_id })
    e.dataTransfer.effectAllowed = 'move'
  }

  function handleDragEnd() {
    setDragSource(null)
    setDragTarget(null)
  }

  // ── Validate cell for sidebar drag ──────────────────────────────
  function validateCell(lb, d, p, classId) {
    // 1. Lunch period
    if (lunchSet.has(p)) return { valid: false, reason: 'คาบพักเที่ยง' }
    // 2. Fixed slot
    if (fixedSlotMap.has(`${d}-${p}`)) {
      const fs = fixedSlotMap.get(`${d}-${p}`)
      return { valid: false, reason: `🔒 ${fs.name || 'กิจกรรมล็อก'}` }
    }
    // 3. Class mismatch (in class view)
    if (classId && lb.class_id && lb.class_id !== classId)
      return { valid: false, reason: 'คนละห้องเรียน' }
    // 4. Already occupied by solver slot
    const existingSlots = (slotMap.get(`${d}-${p}`) || []).filter(
      (s) => !classId || s.class_id === classId,
    )
    if (existingSlots.length > 0)
      return { valid: false, reason: 'มีวิชาอื่นวางอยู่แล้ว (ระบบจัด)' }
    // 5. Already occupied by user placement
    if (classId && userPlacementMap.has(`${d}-${p}-${classId}`))
      return { valid: false, reason: 'มีวิชาอื่นวางด้วยมืออยู่แล้ว' }
    // 6. Teacher double-booked at same day+period
    const teacherBusyInSlots = localSlots.some(
      (s) => s.teacher_id === lb.teacher_id && s.day === d && s.period === p,
    )
    const teacherBusyInPlacements = [...userPlacementMap.values()].some(
      (up) => up.lessonBlock.teacher_id === lb.teacher_id && up.day === d && up.period === p,
    )
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
    if (lunchSet.has(p) || fixedSlotMap.has(`${d}-${p}`)) return
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
    if (lunchSet.has(p) || fixedSlotMap.has(`${d}-${p}`)) return

    // Find the slot being dragged
    const sourceSlots = slotMap.get(`${dragSource.day}-${dragSource.period}`) || []
    const draggedSlot = sourceSlots.find((s) => s.lesson_block_id === dragSource.lessonBlockId)
    if (!draggedSlot) return

    // Check conflicts at target
    const conflicts = checkConflicts(draggedSlot, d, p, classId)
    if (conflicts.length > 0) {
      setDragSource(null)
      setDragTarget(null)
      return
    }

    // Perform swap: update slot's day & period
    const newSlots = localSlots.map((s) => {
      if (s.lesson_block_id === draggedSlot.lesson_block_id) {
        return { ...s, day: d, period: p }
      }
      return s
    })
    setLocalSlots(newSlots)
    if (onSlotSwap) onSlotSwap(newSlots)

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

  // ── Single class grid (full-width) ────────────────────────────────
  function renderSingleGrid(classGroup) {
    const classId = classGroup?.id || null

    return (
      <div key={classGroup?.id || 'all'} className="space-y-2">
        <div className="overflow-x-auto">
          <div className="min-w-full">
            {/* Header: วัน | คาบ1 | คาบ2 | ... — full-width cells using minmax(0,1fr) */}
            <div
              className="grid gap-2.5 mb-2"
              style={{ gridTemplateColumns: `100px repeat(${periodList.length}, minmax(0, 1fr))` }}
            >
              <div className="text-xs font-bold text-gray-400 flex items-center justify-center">
                วัน \ คาบ
              </div>
              {periodList.map((p) => (
                <div
                  key={p}
                  className={`text-center text-base font-bold py-2 rounded
                    ${lunchSet.has(p) ? 'bg-gray-200 text-gray-400' : 'text-gray-700'}`}
                >
                  {p}
                </div>
              ))}
            </div>

            {/* Day rows */}
            {dayList.map((d) => (
              <div
                key={d}
                className="grid gap-2.5 mb-2"
                style={{ gridTemplateColumns: `100px repeat(${periodList.length}, minmax(0, 1fr))` }}
              >
                <div className="flex items-center justify-center text-sm sm:text-base font-bold text-gray-600 bg-gray-100 rounded">
                  {DAY_LABELS[d] || `วัน${d}`}
                </div>
                {periodList.map((p) => {
                  const isLunch = lunchSet.has(p)
                  const fixedSlot = fixedSlotMap.get(`${d}-${p}`)
                  const isFixed = !!fixedSlot
                  const userPlacement = userPlacementMap.get(`${d}-${p}-${classId}`)
                  const matchedSlots = isFixed || isLunch ? [] : getFilteredSlots(d, p, classId)
                  const slot = matchedSlots[0] || null
                  const isTarget = dragTarget?.day === d && dragTarget?.period === p && dragTarget?.classId === classId
                  const targetInfo = isTarget ? dragTarget : null
                  const conflicts = slot ? getSlotConflicts(slot, classId) : []

                  // If there's a user placement but no solver slot, build a pseudo-slot
                  let displaySlot = slot
                  let displaySubject = slot ? subjectMap.get(slot.subject_id) : null
                  let displayTeacher = slot ? teacherMap.get(slot.teacher_id) : null
                  let displayClass = slot ? classMap.get(slot.class_id) : null
                  let isPreAssigned = false

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
                    displayClass = classMap.get(lb.class_id)
                    isPreAssigned = true
                  } else if (slot && userPlacements[slot.lesson_block_id]) {
                    // Solver slot that also has user placements → mark as pre-assigned
                    isPreAssigned = true
                  }

                  return (
                    <GridCell
                      key={`${d}-${p}`}
                      slot={displaySlot}
                      isLunch={isLunch}
                      isFixed={isFixed}
                      fixedSlotName={fixedSlot?.name}
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
                      subject={displaySubject}
                      teacher={displayTeacher}
                      classGroup={displayClass}
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
          <div className="min-w-full">
            {/* Header — full-width cells using minmax(0,1fr) */}
            <div
              className="grid gap-2.5 mb-2"
              style={{ gridTemplateColumns: `100px repeat(${periodList.length}, minmax(0, 1fr))` }}
            >
              <div className="text-xs font-bold text-gray-400 flex items-center justify-center">
                วัน \ คาบ
              </div>
              {periodList.map((p) => (
                <div
                  key={p}
                  className={`text-center text-base font-bold py-2 rounded
                    ${lunchSet.has(p) ? 'bg-gray-200 text-gray-400' : 'text-gray-700'}`}
                >
                  {p}
                </div>
              ))}
            </div>

            {/* Day rows */}
            {dayList.map((d) => (
              <div
                key={d}
                className="grid gap-2.5 mb-2"
                style={{ gridTemplateColumns: `100px repeat(${periodList.length}, minmax(0, 1fr))` }}
              >
                <div className="flex items-center justify-center text-sm sm:text-base font-bold text-gray-600 bg-gray-100 rounded">
                  {DAY_LABELS[d] || `วัน${d}`}
                </div>
                {periodList.map((p) => {
                  const isLunch = lunchSet.has(p)
                  const fixedSlot = fixedSlotMap.get(`${d}-${p}`)
                  const isFixed = !!fixedSlot
                  const teacherSlots = isFixed || isLunch ? [] : getTeacherSlots(d, p)
                  const isTarget = dragTarget?.day === d && dragTarget?.period === p
                  const targetInfo = isTarget ? dragTarget : null
                  return (
                    <GridCell
                      key={`${d}-${p}`}
                      slot={null}
                      slots={teacherSlots}
                      isLunch={isLunch}
                      isFixed={isFixed}
                      fixedSlotName={fixedSlot?.name}
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
    <div className="space-y-4">
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
        </div>
      </div>

      <GridLegend
        mode={isTeacherMode ? 'class' : 'subject'}
        teacherClasses={teacherClasses}
        classColorMap={classColorMap}
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
    </div>
  )
}
