import { useState, useMemo, useEffect, useRef, useCallback } from 'react'
import { Calendar, AlertTriangle, ArrowRight, Rocket, CheckCircle, XCircle } from 'lucide-react'
import { useApp } from '../context/AppContext.jsx'
import TimetableGrid from '../components/grid/TimetableGrid.jsx'
import TeacherLoadTable from '../components/load/TeacherLoadTable.jsx'
import LoadStatusBadge from '../components/load/LoadStatusBadge.jsx'
import UnassignedSidebar from '../components/timetable/UnassignedSidebar.jsx'
import SolverToolbar from '../components/timetable/SolverToolbar.jsx'
import StickyFooter from '../components/timetable/StickyFooter.jsx'
import ConstraintsOverviewModal from '../components/modals/ConstraintsOverviewModal.jsx'
export default function TimetableView() {
  const {
    result,
    fixtureData,
    isDirty,
    setStep,
    runSolver,
    isGenerating,
    solverPreset,
    setSolverPreset,
    userPlacements,
    placeLessonBlock,
    clearPlacements,
    clearResult,
    clearAllSlots,
    clearByTeacher,
    // Batch pin/unpin/clear actions
    pinByTeacher,
    unpinByTeacher,
    pinByClass,
    unpinByClass,
    pinAllSolverSlots,
    unpinAll,
    clearByClass,
    clearSolverOnly,
    // Slot-level editing
    moveSlot,
    deleteSlot,
    removePlacement,
    lockSlot,
    unlockSlot,
    // Snapshot versioning
    snapshots,
    activeSnapshotId,
    activeSnapshotLabel,
    isSnapshotDirty,
    lastSnapshotSaveAt,
    saveSnapshot,
    loadSnapshot,
    deleteSnapshot,
    exportSnapshot,
    importSnapshot,
  } = useApp()
  const [activeTab, setActiveTab] = useState('timetable')
  const [viewMode, setViewMode] = useState('class') // 'class' | 'teacher'
  const [selectedClassIndex, setSelectedClassIndex] = useState(0)
  const [selectedTeacherIndex, setSelectedTeacherIndex] = useState(0)
  const [drawerOpen, setDrawerOpen] = useState(true)
  const [transitioning, setTransitioning] = useState(false)
  const [sidebarDragBlock, setSidebarDragBlock] = useState(null)
  const [showConstraintsModal, setShowConstraintsModal] = useState(false)
  const [completionToast, setCompletionToast] = useState(null)
  const gridAreaRef = useRef(null)
  const wheelCooldownRef = useRef(false)
  const wasGeneratingRef = useRef(false)

  // ── Auto-toast when solver finishes ───────────────────────────────
  // Fires when isGenerating transitions true → false AND a fresh result
  // with metrics is present. Skips initial mount and snapshot restores.
  useEffect(() => {
    const wasGenerating = wasGeneratingRef.current
    wasGeneratingRef.current = isGenerating
    if (wasGenerating && !isGenerating && result?.metrics) {
      const m = result.metrics
      const secs = m.wall_time_seconds != null ? `${m.wall_time_seconds.toFixed(3)}s` : ''
      const status = m.status || 'UNKNOWN'
      const isOk = status === 'OPTIMAL' || status === 'FEASIBLE'
      const msg = isOk
        ? `จัดตารางสำเร็จ${secs ? ` (ใช้เวลา ${secs} • ${status})` : ` • ${status}`}`
        : `จัดตารางไม่สำเร็จ${secs ? ` (ใช้เวลา ${secs} • ${status})` : ` • ${status}`}`
      setCompletionToast({ ok: isOk, msg })
      const t = setTimeout(() => setCompletionToast(null), 4000)
      return () => clearTimeout(t)
    }
  }, [isGenerating, result])

  // Empty state — no fixture data yet
  if (!fixtureData) {
    return (
      <div className="flex flex-col items-center justify-center py-20 space-y-6">
        <div className="w-20 h-20 rounded-full bg-blue-50 flex items-center justify-center">
          <Calendar className="w-10 h-10 text-blue-300" />
        </div>
        <div className="text-center space-y-2">
          <h2 className="text-xl font-bold text-gray-700">ยังไม่มีข้อมูล</h2>
          <p className="text-gray-500">ไปยังขั้นตอนตรวจสอบข้อมูลเพื่อเริ่ม</p>
        </div>
        <button
          onClick={() => setStep(4)}
          className="btn-primary flex items-center gap-2"
        >
          ไปยังหน้าตรวจสอบ
          <ArrowRight className="w-4 h-4" />
        </button>
      </div>
    )
  }

  const { teachers, classes, subjects, fixed_slots, schedule_config, lesson_blocks, schedule_blocks = [] } = fixtureData
  const resultSlots = result?.slots || []

  // ── Derive grid structure from actual schedule_blocks data ────────
  // Uses schedule_blocks[].periods (from Step 2) when available,
  // falls back to legacy schedule_config when blocks are missing/empty.
  const gridConfig = useMemo(() => {
    if (schedule_blocks && schedule_blocks.length > 0) {
      const allPeriodNumbers = schedule_blocks.flatMap((blk) =>
        (blk.periods || []).map((p) => p.period_no),
      )

      // Guard: ถ้ามี blocks แต่ไม่มี periods ด้านในเลย ให้ fallback
      if (allPeriodNumbers.length > 0) {
        const maxPeriod = Math.max(...allPeriodNumbers)

        const lunchSet = new Set()
        for (const blk of schedule_blocks) {
          for (const p of (blk.periods || [])) {
            if (p.type === 'LUNCH') lunchSet.add(p.period_no)
          }
        }

        const maxDays = Math.max(
          ...schedule_blocks.map((blk) => blk.days_per_week || 5),
        )

        return {
          periodsPerDay: maxPeriod,
          lunchPeriods: [...lunchSet].sort((a, b) => a - b),
          daysPerWeek: maxDays,
        }
      }
    }

    // Legacy Fallback (เมื่อไม่มี schedule_blocks หรือ periods)
    return {
      periodsPerDay: schedule_config?.periods_per_day || 7,
      lunchPeriods: schedule_config?.lunch_periods || [4],
      daysPerWeek: schedule_config?.days_per_week || 5,
    }
  }, [schedule_blocks, schedule_config])

  // ── Compute placement counts for status footer ────────────────────
  const totalCount = useMemo(
    () => lesson_blocks.reduce((sum, lb) => sum + lb.periods_per_week, 0),
    [lesson_blocks],
  )
  const placedCount = useMemo(() => {
    const solverPlaced = resultSlots.length
    const solverBlockIds = new Set(resultSlots.map((s) => s.lesson_block_id))
    const userOnlyPlaced = Object.entries(userPlacements).reduce(
      (sum, [lbId, placements]) => solverBlockIds.has(lbId) ? sum : sum + placements.length,
      0,
    )
    return solverPlaced + userOnlyPlaced
  }, [resultSlots, userPlacements])

  // ── Class statuses for nav panel ──────────────────────────────────
  const classStatuses = useMemo(() => {
    const statuses = {}
    for (const cls of classes) {
      const classLbs = lesson_blocks.filter((lb) => lb.class_id === cls.id)
      const total = classLbs.reduce((sum, lb) => sum + lb.periods_per_week, 0)
      const placed = resultSlots.filter((s) => s.class_id === cls.id).length
        + Object.entries(userPlacements)
          .filter(([lbId]) => {
            const lb = lesson_blocks.find((l) => l.id === lbId)
            return lb && lb.class_id === cls.id
          })
          .reduce((sum, [, placements]) => sum + placements.length, 0)
      const remaining = Math.max(0, total - placed)
      statuses[cls.id] = { total, placed, remaining, isComplete: total > 0 && placed >= total }
    }
    return statuses
  }, [classes, lesson_blocks, resultSlots, userPlacements])

  // ── Teacher statuses for nav panel ────────────────────────────────
  const teacherStatuses = useMemo(() => {
    const statuses = {}
    const loadAfter = result?.teacher_loads || []
    const loadMap = new Map(loadAfter.map((l) => [l.teacher_id, l]))
    for (const t of teachers) {
      const load = loadMap.get(t.id)
      if (load) {
        statuses[t.id] = { assigned: load.assigned_periods, max: load.max_periods, status: load.load_status }
      } else {
        // No result yet — compute from lesson blocks
        const assigned = lesson_blocks
          .filter((lb) => lb.teacher_id === t.id)
          .reduce((sum, lb) => sum + lb.periods_per_week, 0)
        const status = assigned > t.max_periods_per_week ? 'over' : assigned < t.min_periods_per_week ? 'under' : 'ok'
        statuses[t.id] = { assigned, max: t.max_periods_per_week, status }
      }
    }
    return statuses
  }, [teachers, result, lesson_blocks])

  // ── Teacher load data (before/after) for workload tab ─────────────
  const loadBefore = useMemo(() => {
    const loads = {}
    for (const t of teachers) {
      loads[t.id] = { teacher_id: t.id, teacher_name: t.name, assigned: 0, max: t.max_periods_per_week, min: t.min_periods_per_week }
    }
    for (const lb of lesson_blocks) {
      if (loads[lb.teacher_id]) {
        loads[lb.teacher_id].assigned += lb.periods_per_week
      }
    }
    return Object.values(loads).map((l) => ({
      teacher_id: l.teacher_id,
      teacher_name: l.teacher_name,
      assigned_periods: l.assigned,
      max_periods: l.max,
      min_periods: l.min,
      load_status: l.assigned > l.max ? 'over' : l.assigned < l.min ? 'under' : 'ok',
    }))
  }, [teachers, lesson_blocks])

  const loadAfter = result?.teacher_loads || []
  const beforeMap = new Map(loadBefore.map((l) => [l.teacher_id, l]))
  const beforeOver = loadBefore.filter((l) => l.load_status === 'over').length
  const afterOver = loadAfter.filter((l) => l.load_status === 'over').length
  const beforeUnder = loadBefore.filter((l) => l.load_status === 'under').length
  const afterUnder = loadAfter.filter((l) => l.load_status === 'under').length

  // ── Unassigned count for drawer auto-close ────────────────────────
  const unassignedCount = useMemo(() => {
    const placedCounts = {}
    for (const s of resultSlots) {
      placedCounts[s.lesson_block_id] = (placedCounts[s.lesson_block_id] || 0) + 1
    }
    for (const [lbId, placements] of Object.entries(userPlacements)) {
      placedCounts[lbId] = (placedCounts[lbId] || 0) + placements.length
    }
    return lesson_blocks.reduce((sum, lb) => {
      const remaining = lb.periods_per_week - (placedCounts[lb.id] || 0)
      return sum + Math.max(0, remaining)
    }, 0)
  }, [lesson_blocks, resultSlots, userPlacements])

  // ── Constraint counts for toolbar context ──────────────────────────
  const fixedCount = useMemo(
    () => (fixed_slots?.length || 0),
    [fixed_slots],
  )
  const preAssignedCount = useMemo(
    () => Object.values(userPlacements).reduce((sum, placements) => sum + placements.length, 0),
    [userPlacements],
  )

  // Auto-close drawer when no unassigned blocks
  useEffect(() => {
    if (unassignedCount === 0 && drawerOpen) {
      setDrawerOpen(false)
    }
  }, [unassignedCount, drawerOpen])

  // ── Selected class/teacher ────────────────────────────────────────
  const selectedClass = classes[selectedClassIndex] || classes[0] || null
  const selectedTeacher = teachers[selectedTeacherIndex] || teachers[0] || null

  // ── Page-snap navigation ──────────────────────────────────────────
  const navigatePage = useCallback((direction) => {
    if (wheelCooldownRef.current) return
    wheelCooldownRef.current = true
    setTransitioning(true)

    if (viewMode === 'class') {
      setSelectedClassIndex((prev) => {
        const max = classes.length - 1
        if (direction === 'next') return prev >= max ? 0 : prev + 1
        return prev <= 0 ? max : prev - 1
      })
    } else {
      setSelectedTeacherIndex((prev) => {
        const max = teachers.length - 1
        if (direction === 'next') return prev >= max ? 0 : prev + 1
        return prev <= 0 ? max : prev - 1
      })
    }

    // Reset transition flag after animation
    setTimeout(() => setTransitioning(false), 250)
    // Cooldown to prevent rapid multi-page jumps
    setTimeout(() => { wheelCooldownRef.current = false }, 400)
  }, [viewMode, classes.length, teachers.length])

  // Wheel + keyboard navigation (only when grid area is hovered)
  useEffect(() => {
    const gridEl = gridAreaRef.current
    if (!gridEl) return

    function handleWheel(e) {
      // Only intercept when scrolling within the grid area
      if (!gridAreaRef.current?.contains(e.target)) return
      e.preventDefault()
      if (Math.abs(e.deltaY) < 10) return
      navigatePage(e.deltaY > 0 ? 'next' : 'prev')
    }

    function handleKey(e) {
      if (e.key === 'ArrowDown' || e.key === 'PageDown') {
        e.preventDefault()
        navigatePage('next')
      } else if (e.key === 'ArrowUp' || e.key === 'PageUp') {
        e.preventDefault()
        navigatePage('prev')
      }
    }

    // Attach wheel listener to grid area only (passive: false to allow preventDefault)
    gridEl.addEventListener('wheel', handleWheel, { passive: false })
    // Keyboard listener on document (works when page is focused)
    document.addEventListener('keydown', handleKey)

    return () => {
      gridEl.removeEventListener('wheel', handleWheel)
      document.removeEventListener('keydown', handleKey)
    }
  }, [navigatePage])

  // ── Handlers ──────────────────────────────────────────────────────
  function handleDropFromSidebar(lessonBlock, day, period, classId) {
    if (classId && lessonBlock.class_id !== classId) return
    placeLessonBlock(lessonBlock.id, day, period)
  }

  // ❌ Remove a slot/placement from the grid (button on card)
  function handleRemoveFromGrid(lessonBlockId, isPreAssigned, day, period) {
    if (isPreAssigned) {
      removePlacement(lessonBlockId, day, period)
    } else {
      deleteSlot(lessonBlockId)
    }
  }

  // 📌 Toggle pin on a slot (button on card)
  function handleTogglePin(lessonBlockId, day, period, isPinned) {
    if (isPinned) {
      // Unpin: remove the placement (slot reverts to solver-controlled)
      removePlacement(lessonBlockId, day, period)
    } else {
      // Pin: place as user placement (locks position)
      placeLessonBlock(lessonBlockId, day, period)
    }
  }

  // Drag from grid → drop in drawer (unassign)
  function handleDropFromGrid(lessonBlockId, isPreAssigned, day, period) {
    handleRemoveFromGrid(lessonBlockId, isPreAssigned, day, period)
  }

  function handleGenerateRemaining() {
    runSolver({ preAssignments: userPlacements })
  }

  const handleClearManual = useCallback(() => clearPlacements(), [clearPlacements])
  const handleClearSolver = useCallback(() => clearResult(), [clearResult])
  const handleClearAll = useCallback(() => clearAllSlots(), [clearAllSlots])
  const handleClearByTeacher = useCallback((tid) => clearByTeacher(tid), [clearByTeacher])

  // ── Batch pin/unpin/clear handlers ──────────────────────────────────
  const handlePinByTeacher = useCallback((tid) => pinByTeacher(tid), [pinByTeacher])
  const handleUnpinByTeacher = useCallback((tid) => unpinByTeacher(tid), [unpinByTeacher])
  const handlePinByClass = useCallback((cid) => pinByClass(cid), [pinByClass])
  const handleUnpinByClass = useCallback((cid) => unpinByClass(cid), [unpinByClass])
  const handlePinAllSolver = useCallback(() => pinAllSolverSlots(), [pinAllSolverSlots])
  const handleUnpinAll = useCallback(() => unpinAll(), [unpinAll])
  const handleClearByClass = useCallback((cid) => clearByClass(cid), [clearByClass])
  const handleClearSolverOnly = useCallback(() => clearSolverOnly(), [clearSolverOnly])

  const hasResult = result?.slots && result.slots.length > 0
  const hasPlacements = Object.keys(userPlacements).length > 0

  function handleSelectClass(classId) {
    const idx = classes.findIndex((c) => c.id === classId)
    if (idx >= 0) {
      setTransitioning(true)
      setSelectedClassIndex(idx)
      setTimeout(() => setTransitioning(false), 250)
    }
  }

  function handleSelectTeacher(teacherId) {
    const idx = teachers.findIndex((t) => t.id === teacherId)
    if (idx >= 0) {
      setTransitioning(true)
      setSelectedTeacherIndex(idx)
      setTimeout(() => setTransitioning(false), 250)
    }
  }

  function handleViewModeChange(mode) {
    setViewMode(mode)
    setTransitioning(true)
    setTimeout(() => setTransitioning(false), 250)
  }

  return (
    <div className="w-full space-y-4 pb-24">
      {/* Dirty warning banner */}
      {isDirty && (
        <div className="flex items-center gap-2 bg-amber-50 border border-amber-300 rounded-lg px-4 py-3 text-amber-800">
          <AlertTriangle className="w-5 h-5 shrink-0" />
          <span className="text-sm font-medium">
            มีการเปลี่ยนแปลงข้อมูล กรุณากดจัดตารางใหม่เพื่ออัปเดตผลลัพธ์
          </span>
          <button
            onClick={() => runSolver({ preAssignments: userPlacements })}
            disabled={isGenerating}
            className="ml-auto flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-bold bg-amber-600 text-white hover:bg-amber-700 transition-colors disabled:opacity-60"
          >
            <Rocket className="w-3.5 h-3.5" />
            จัดใหม่
          </button>
        </div>
      )}

      {/* Top 4-Card Toolbar — below dirty banner, above tab content */}
      <SolverToolbar
        solverPreset={solverPreset}
        onPresetChange={setSolverPreset}
        onGenerate={handleGenerateRemaining}
        isGenerating={isGenerating}
        disabled={!fixtureData}
        metrics={result?.metrics}
        fixedCount={fixedCount}
        preAssignedCount={preAssignedCount}
        onClearManual={handleClearManual}
        onClearSolver={handleClearSolver}
        onClearAll={handleClearAll}
        onClearByTeacher={handleClearByTeacher}
        onClearSolverOnly={handleClearSolverOnly}
        onClearByClass={handleClearByClass}
        onPinAllSolver={handlePinAllSolver}
        onUnpinAll={handleUnpinAll}
        teachers={teachers}
        classes={classes}
        hasResult={hasResult}
        hasPlacements={hasPlacements}
        className={viewMode === 'class' ? selectedClass?.name : selectedTeacher?.name}
        onOpenConstraints={() => setShowConstraintsModal(true)}
        // Version / Save props
        snapshots={snapshots}
        activeSnapshotId={activeSnapshotId}
        activeSnapshotLabel={activeSnapshotLabel}
        isSnapshotDirty={isSnapshotDirty}
        lastSnapshotSaveAt={lastSnapshotSaveAt}
        onSaveSnapshot={saveSnapshot}
        onLoadSnapshot={loadSnapshot}
        onDeleteSnapshot={deleteSnapshot}
        onExportSnapshot={exportSnapshot}
        onImportSnapshot={importSnapshot}
        // Tab + Export props
        activeTab={activeTab}
        onTabChange={setActiveTab}
        exportData={{
          slots: resultSlots,
          classes,
          subjects,
          teachers,
          gridConfig,
          userPlacements,
          lessonBlocks: lesson_blocks,
          fixedSlots: fixed_slots,
          label: activeSnapshotLabel || (selectedClass?.name || 'ตารางสอน'),
        }}
      />

      {/* Tab Content */}
      {activeTab === 'timetable' && (
        <div className="card p-0 overflow-hidden">
          {/* Three-panel layout: [Drawer (left) | Grid (center) | Mini Rail (right)] */}
          <div className="flex" style={{ height: 'calc(100vh - 340px)', minHeight: '400px' }}>
            {/* 1. Left: collapsible unassigned drawer */}
            <div className={`relative shrink-0 transition-all duration-300 ease-out ${drawerOpen ? 'w-[250px]' : 'w-0'}`}>
              <UnassignedSidebar
                lessonBlocks={lesson_blocks}
                subjects={subjects}
                teachers={teachers}
                classes={classes}
                resultSlots={resultSlots}
                userPlacements={userPlacements}
                filterClass={viewMode === 'class' ? selectedClass?.id : null}
                isOpen={drawerOpen}
                onToggle={() => setDrawerOpen(!drawerOpen)}
                onDragStartBlock={(lb) => setSidebarDragBlock(lb)}
                onDragEndBlock={() => setSidebarDragBlock(null)}
                onDropFromGrid={handleDropFromGrid}
              />
            </div>

            {/* 2. Center: grid area — full remaining width */}
            <div
              ref={gridAreaRef}
              className="flex-1 min-w-0 relative overflow-y-auto p-2"
            >
              <div className={transitioning ? 'animate-fadeSlide' : ''}>
                <TimetableGrid
                  slots={resultSlots}
                  subjects={subjects}
                  teachers={teachers}
                  classes={classes}
                  days={gridConfig.daysPerWeek}
                  periodsPerDay={gridConfig.periodsPerDay}
                  lunchPeriods={gridConfig.lunchPeriods}
                  fixedSlots={fixed_slots}
                  userPlacements={userPlacements}
                  onDropFromSidebar={handleDropFromSidebar}
                  lessonBlocks={lesson_blocks}
                  sidebarDragBlock={sidebarDragBlock}
                  selectedClass={viewMode === 'class' ? selectedClass?.id : null}
                  selectedTeacher={viewMode === 'teacher' ? selectedTeacher?.id : null}
                  viewMode={viewMode}
                  onViewModeChange={handleViewModeChange}
                  // Slot-level editing callbacks
                  onSlotMove={moveSlot}
                  onSlotDelete={deleteSlot}
                  onRemovePlacement={removePlacement}
                  onLockSlot={lockSlot}
                  onUnlockSlot={unlockSlot}
                  // Interactive block editing (buttons on cards)
                  onRemoveSlot={handleRemoveFromGrid}
                  onTogglePin={handleTogglePin}
                  // Batch pin/clear actions (sub-header)
                  selectedClassId={viewMode === 'class' ? selectedClass?.id : null}
                  selectedTeacherId={viewMode === 'teacher' ? selectedTeacher?.id : null}
                  onPinByClass={handlePinByClass}
                  onPinByTeacher={handlePinByTeacher}
                  onUnpinByClass={handleUnpinByClass}
                  onUnpinByTeacher={handleUnpinByTeacher}
                  onClearByClass={handleClearByClass}
                  onClearByTeacher={handleClearByTeacher}
                />
              </div>
            </div>

            {/* 3. Right: mini navigation rail */}
            <div className="w-[135px] shrink-0 border-l border-gray-200 bg-gray-50/50 flex flex-col">
              {/* Column header */}
              <div className="text-[11px] font-semibold text-gray-400 px-2 py-1 uppercase border-b border-gray-200">
                {viewMode === 'class' ? 'ห้องเรียน' : 'ครูผู้สอน'}
              </div>

              {/* Scrollable pill list */}
              <div className="flex-1 overflow-y-auto py-1 px-1.5 space-y-1">
                {(viewMode === 'class' ? classes : teachers).map((item) => {
                  const isActive = viewMode === 'class'
                    ? selectedClass?.id === item.id
                    : selectedTeacher?.id === item.id
                  const status = viewMode === 'class'
                    ? classStatuses[item.id]
                    : teacherStatuses[item.id]
                  const isComplete = viewMode === 'class'
                    ? status?.isComplete
                    : status?.status === 'ok'

                  const pillClass = isComplete
                    ? 'bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-100'
                    : 'bg-amber-50 text-amber-700 border border-amber-200 hover:bg-amber-100'

                  return (
                    <button
                      key={item.id}
                      onClick={() => {
                        if (viewMode === 'class') handleSelectClass(item.id)
                        else handleSelectTeacher(item.id)
                      }}
                      className={`w-full text-left px-2 py-1.5 rounded-lg text-[11px] font-medium
                        transition-all truncate ${pillClass}
                        ${isActive ? 'ring-2 ring-blue-500 font-bold shadow-sm' : ''}`}
                    >
                      {item.name}
                      {viewMode === 'class' && (
                        isComplete
                          ? <span className="ml-1 text-[10px]">✓</span>
                          : <span className="ml-1 text-[10px] opacity-70">({status?.remaining || 0})</span>
                      )}
                    </button>
                  )
                })}
              </div>
            </div>
          </div>
        </div>
      )}

      {activeTab === 'teachers' && (
        <div className="space-y-4">
          {/* Summary comparison */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="bg-white rounded-lg border border-gray-200 p-3 text-center">
              <div className="text-xs text-gray-500 mb-1">ครูเกินเพดาน (ก่อน)</div>
              <div className={`text-2xl font-bold ${beforeOver > 0 ? 'text-red-600' : 'text-green-600'}`}>{beforeOver}</div>
            </div>
            <div className="bg-white rounded-lg border border-gray-200 p-3 text-center">
              <div className="text-xs text-gray-500 mb-1">ครูเกินเพดาน (หลัง)</div>
              <div className={`text-2xl font-bold ${afterOver > 0 ? 'text-red-600' : 'text-green-600'}`}>{afterOver}</div>
            </div>
            <div className="bg-white rounded-lg border border-gray-200 p-3 text-center">
              <div className="text-xs text-gray-500 mb-1">ครูว่างมาก (ก่อน)</div>
              <div className={`text-2xl font-bold ${beforeUnder > 0 ? 'text-yellow-600' : 'text-gray-400'}`}>{beforeUnder}</div>
            </div>
            <div className="bg-white rounded-lg border border-gray-200 p-3 text-center">
              <div className="text-xs text-gray-500 mb-1">ครูว่างมาก (หลัง)</div>
              <div className={`text-2xl font-bold ${afterUnder > 0 ? 'text-yellow-600' : 'text-gray-400'}`}>{afterUnder}</div>
            </div>
          </div>

          {/* Comparison table */}
          <div className="card">
            <h2 className="font-bold text-gray-900 mb-4">เปรียบเทียบภาระงาน Before/After</h2>
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-2 text-left text-xs font-bold text-gray-600">ครู</th>
                    <th className="px-4 py-2 text-center text-xs font-bold text-gray-600">ก่อน</th>
                    <th className="px-4 py-2 text-center text-xs font-bold text-gray-600">หลัง</th>
                    <th className="px-4 py-2 text-center text-xs font-bold text-gray-600">Δ</th>
                    <th className="px-4 py-2 text-center text-xs font-bold text-gray-600">Max</th>
                    <th className="px-4 py-2 text-center text-xs font-bold text-gray-600">สถานะ</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-100">
                  {loadAfter.map((after) => {
                    const before = beforeMap.get(after.teacher_id)
                    const beforeVal = before?.assigned_periods || 0
                    const delta = after.assigned_periods - beforeVal
                    return (
                      <tr key={after.teacher_id} className="hover:bg-gray-50">
                        <td className="px-4 py-2 text-sm font-medium text-gray-900">{after.teacher_name}</td>
                        <td className="px-4 py-2 text-sm text-center text-gray-600">{beforeVal}</td>
                        <td className="px-4 py-2 text-sm text-center font-bold text-gray-900">{after.assigned_periods}</td>
                        <td className="px-4 py-2 text-sm text-center">
                          {delta > 0 ? (
                            <span className="text-red-600">+{delta}</span>
                          ) : delta < 0 ? (
                            <span className="text-green-600">{delta}</span>
                          ) : (
                            <span className="text-gray-400">—</span>
                          )}
                        </td>
                        <td className="px-4 py-2 text-sm text-center text-gray-500">{after.max_periods}</td>
                        <td className="px-4 py-2 text-center">
                          <LoadStatusBadge status={after.load_status} />
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Detailed after table */}
          <div className="card">
            <h2 className="font-bold text-gray-900 mb-4">รายละเอียดภาระงาน (หลังจัดตาราง)</h2>
            <TeacherLoadTable loads={loadAfter} />
          </div>
        </div>
      )}

      {/* Sticky Global Footer — Back button + completion status */}
      <StickyFooter
        onBack={() => setStep(4)}
        placedCount={placedCount}
        totalCount={totalCount}
      />

      {/* Constraints Overview Modal */}
      <ConstraintsOverviewModal
        isOpen={showConstraintsModal}
        onClose={() => setShowConstraintsModal(false)}
        fixedCount={fixedCount}
        pinnedCount={preAssignedCount}
        fixedSlots={fixed_slots}
        lunchPeriods={gridConfig.lunchPeriods}
        onNavigateStep={(step) => { setShowConstraintsModal(false); setStep(step) }}
        onClearPins={() => { clearPlacements(); setShowConstraintsModal(false) }}
      />

      {/* ── Auto completion toast (bottom-right) ─────────────────────── */}
      {completionToast && (
        <div className={`fixed bottom-6 right-6 z-[120] px-4 py-3 rounded-xl shadow-lg
          text-sm font-medium flex items-center gap-2 max-w-sm
          ${completionToast.ok ? 'bg-green-600 text-white' : 'bg-red-600 text-white'}`}>
          {completionToast.ok
            ? <CheckCircle className="w-5 h-5 shrink-0" />
            : <XCircle className="w-5 h-5 shrink-0" />}
          {completionToast.msg}
        </div>
      )}
    </div>
  )
}
