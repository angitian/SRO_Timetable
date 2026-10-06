import { useState, useMemo, useEffect, useRef, useCallback } from 'react'
import { Calendar, AlertTriangle, ArrowRight, Rocket, CheckCircle, XCircle, FlaskConical, Table, LayoutGrid, Search, X, ChevronLeft, ChevronRight, CalendarClock } from 'lucide-react'
import { useApp } from '../context/AppContext.jsx'
import TimetableGrid from '../components/grid/TimetableGrid.jsx'
import TeacherLoadTable from '../components/load/TeacherLoadTable.jsx'
import LoadStatusBadge from '../components/load/LoadStatusBadge.jsx'
import UnassignedSidebar from '../components/timetable/UnassignedSidebar.jsx'
import SolverToolbar from '../components/timetable/SolverToolbar.jsx'
import StickyFooter from '../components/timetable/StickyFooter.jsx'
import ConstraintsOverviewModal from '../components/modals/ConstraintsOverviewModal.jsx'
import ExportExcelModal from '../components/timetable/ExportExcelModal.jsx'
import SubstituteManagerModal from '../components/timetable/SubstituteManagerModal.jsx'
import { FACILITY_TYPE_ICONS, FACILITY_TYPE_LABELS } from '../utils/roomTypes.js'
import { exportQuickTemplateExcel, exportFullTemplateExcel } from '../utils/exportTemplateExcel.js'
import {
  computeTeacherAvailableSlots,
  computeClassAvailableSlots,
  computeNeededPerClass,
  computeNeededPerTeacher,
} from '../utils/teacherLoad.js'
export default function TimetableView() {
  const {
    result,
    fixtureData,
    isDirty,
    error,
    errorResponse,
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
    // Substitute (สอนแทน)
    substitutes,
    setSubstitute,
    removeSubstitute,
    // Special rooms
    changeSlotRoom,
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
    // Cloud workspace
    user,
    login,
    cloudSyncing,
    activeCloudWorkspaceId,
    saveToCloud,
    cloudWorkspaces,
    listCloudWorkspaces,
    loadFromCloud,
    deleteFromCloud,
  } = useApp()
  const [activeTab, setActiveTab] = useState('timetable')
  const [viewMode, setViewMode] = useState('class') // 'class' | 'teacher'
  const [selectedClassIndex, setSelectedClassIndex] = useState(0)
  const [selectedTeacherIndex, setSelectedTeacherIndex] = useState(0)
  const [selectedFacilityIndex, setSelectedFacilityIndex] = useState(0)
  const [facilityViewMode, setFacilityViewMode] = useState('grid') // 'grid' | 'table'
  // Drawer starts closed on tablet/mobile (< 1024px) so the timetable grid
  // keeps as much horizontal space as possible; on desktop it starts open.
  const [drawerOpen, setDrawerOpen] = useState(() => typeof window !== 'undefined' && window.innerWidth >= 1024)
  const [transitioning, setTransitioning] = useState(false)
  const [sidebarDragBlock, setSidebarDragBlock] = useState(null)
  const [showConstraintsModal, setShowConstraintsModal] = useState(false)
  const [showSubstituteModal, setShowSubstituteModal] = useState(false)
  const [completionToast, setCompletionToast] = useState(null)
  const [railSearch, setRailSearch] = useState('')
  const [facilitySearch, setFacilitySearch] = useState('')
  // ── Stale-data banner dismiss state ───────────────────────────────
  // User can dismiss the "มีการเปลี่ยนแปลงข้อมูล" banner for the current
  // session. Reset to false only when isDirty transitions false → true
  // (i.e. a *new* round of data changes happens in steps 1–4), so the
  // banner re-appears for the next batch of changes.
  const [isBannerDismissed, setIsBannerDismissed] = useState(false)
  const prevIsDirtyRef = useRef(false)
  const gridAreaRef = useRef(null)
  const wheelCooldownRef = useRef(false)
  const wasGeneratingRef = useRef(false)
  // ── Excel export state ────────────────────────────────────────────
  const [showExportModal, setShowExportModal] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [exportToast, setExportToast] = useState(null)
  // ── Placement feedback toast (sidebar → grid drop) ───────────────
  const [placementToast, setPlacementToast] = useState(null)
  const placementTimerRef = useRef(null)

  // ── Auto-toast when solver finishes ───────────────────────────────
  // Fires when isGenerating transitions true → false. Shows success/failure
  // for fresh results AND surfaces backend errors (e.g. 500) so the user
  // never sees a silent "ค้าง" state.
  useEffect(() => {
    const wasGenerating = wasGeneratingRef.current
    wasGeneratingRef.current = isGenerating
    if (wasGenerating && !isGenerating) {
      if (error) {
        setCompletionToast({ ok: false, msg: `จัดตารางไม่สำเร็จ: ${error}` })
        const t = setTimeout(() => setCompletionToast(null), 6000)
        return () => clearTimeout(t)
      }
      if (result?.metrics) {
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
    }
  }, [isGenerating, result, error])

  // ── Reset stale-data banner dismissal on new changes ───────────────
  // When isDirty flips false → true (a fresh batch of data changes from
  // steps 1–4 or from moving a card on the grid), re-arm the banner so
  // the user is alerted to the new changes. When isDirty goes back to
  // false (e.g. after runSolver completes via SET_RESULT), keep the
  // banner hidden — there's nothing stale to warn about anymore.
  useEffect(() => {
    const wasDirty = prevIsDirtyRef.current
    prevIsDirtyRef.current = isDirty
    if (!wasDirty && isDirty) {
      // New round of changes → re-show banner
      setIsBannerDismissed(false)
    }
  }, [isDirty])

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

  const { teachers, classes, subjects, fixed_slots, schedule_config, lesson_blocks, schedule_blocks = [], special_rooms = [] } = fixtureData
  const resultSlots = result?.slots || []

  // ── Unplaced-lessons report: explains WHY some lessons couldn't be placed ──
  // Answers "จัดไม่ครบ — ติดเงื่อนไขไหน" (class capacity / teacher availability /
  // hard rules). Null when everything was placed.
  const unplacedReport = useMemo(() => {
    if (!result || !fixtureData) return null
    const placed = {}
    for (const s of resultSlots) {
      placed[s.lesson_block_id] = (placed[s.lesson_block_id] || 0) + 1
    }
    const missingByClass = {}
    const missingByTeacher = {}
    let totalMissing = 0
    for (const lb of lesson_blocks) {
      const miss = lb.periods_per_week - (placed[lb.id] || 0)
      if (miss > 0) {
        totalMissing += miss
        missingByClass[lb.class_id] = (missingByClass[lb.class_id] || 0) + miss
        missingByTeacher[lb.teacher_id] = (missingByTeacher[lb.teacher_id] || 0) + miss
      }
    }
    if (totalMissing === 0) return null

    const classMap = new Map(classes.map((c) => [c.id, c]))
    const teacherMap = new Map(teachers.map((t) => [t.id, t]))
    const neededByClass = computeNeededPerClass(lesson_blocks)
    const neededByTeacher = computeNeededPerTeacher(lesson_blocks)

    const classRows = Object.entries(missingByClass).map(([cid, miss]) => {
      const needed = neededByClass[cid] || 0
      const avail = computeClassAvailableSlots(cid, schedule_blocks, fixed_slots, schedule_config)
      return { name: classMap.get(cid)?.name || cid, needed, avail, miss }
    })
    const teacherRows = Object.entries(missingByTeacher).map(([tid, miss]) => {
      const t = teacherMap.get(tid)
      const needed = neededByTeacher[tid] || 0
      const avail = computeTeacherAvailableSlots(t, lesson_blocks, schedule_blocks, fixed_slots, schedule_config)
      return { name: t?.name || tid, needed, avail, miss }
    })

    // Active HARD rules that may restrict placement
    const hardRules = []
    const sc = schedule_config || {}
    if (sc.am_pm_free_mode === 'hard') hardRules.push('ว่าง 1 คาบเช้า + 1 คาบบ่าย (Hard)')
    if (sc.heavy_morning_mode === 'hard') hardRules.push('วิชาหนักเน้นเช้า (Hard)')
    if (sc.max_consecutive_mode === 'hard') hardRules.push('หลีกเลี่ยงสอนเกิน N คาบติด (Hard)')
    if (sc.subject_day_spacing_mode === 'hard') hardRules.push('ไม่จัดวิชาเดิมติดวัน (Hard)')
    for (const r of (sc.subject_time_rules || [])) {
      if (r.mode === 'hard') {
        const subj = subjects.find((s) => s.id === r.subject_id)
        hardRules.push(`วิชา ${subj?.name || r.subject_id} เน้น${r.preference === 'morning' ? 'เช้า' : 'บ่าย'} (Hard)`)
      }
    }

    return { totalMissing, classRows, teacherRows, hardRules }
  }, [result, resultSlots, fixtureData, lesson_blocks, classes, teachers, subjects, fixed_slots, schedule_blocks, schedule_config])

  // ── Derive grid structure from actual schedule_blocks data ────────
  // Uses schedule_blocks[].periods (from Step 2) when available,
  // falls back to legacy schedule_config when blocks are missing/empty.
  const gridConfig = useMemo(() => {
    if (schedule_blocks && schedule_blocks.length > 0) {
      const allPeriods = schedule_blocks.flatMap((blk) => blk.periods || [])
      const allPeriodNumbers = allPeriods.map((p) => p.period_no)

      // Guard: ถ้ามี blocks แต่ไม่มี periods ด้านในเลย ให้ fallback
      if (allPeriodNumbers.length > 0) {
        const maxPeriod = Math.max(...allPeriodNumbers)

        const lunchSet = new Set()
        const breakSet = new Set()
        for (const p of allPeriods) {
          if (p.type === 'LUNCH') lunchSet.add(p.period_no)
          else if (p.type === 'BREAK') breakSet.add(p.period_no)
        }

        const maxDays = Math.max(
          ...schedule_blocks.map((blk) => blk.days_per_week || 5),
        )

        // periodList = sorted unique period_no (may include decimals like 3.5
        // for inserted short breaks). Used by grid render to know which
        // columns to draw and in what order.
        const periodList = [...new Set(allPeriodNumbers)].sort((a, b) => a - b)

        return {
          periodsPerDay: maxPeriod,
          periodList,
          lunchPeriods: [...lunchSet].sort((a, b) => a - b),
          breakPeriods: [...breakSet].sort((a, b) => a - b),
          daysPerWeek: maxDays,
        }
      }
    }

    // Legacy Fallback (เมื่อไม่มี schedule_blocks หรือ periods)
    const periodsPerDay = schedule_config?.periods_per_day || 7
    return {
      periodsPerDay,
      periodList: Array.from({ length: periodsPerDay }, (_, i) => i + 1),
      lunchPeriods: schedule_config?.lunch_periods || [4],
      breakPeriods: [],
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

  // ── Facility (special room) data ──────────────────────────────────
  const subjectMap = useMemo(() => new Map(subjects.map((s) => [s.id, s])), [subjects])
  const classMap = useMemo(() => new Map(classes.map((c) => [c.id, c])), [classes])
  const teacherMap = useMemo(() => new Map(teachers.map((t) => [t.id, t])), [teachers])

  const selectedFacility = special_rooms[selectedFacilityIndex] || null

  // Facility timetable: slots filtered by selected room
  const facilityTimetableSlots = useMemo(() => {
    if (!selectedFacility) return []
    const dayNames = ['จันทร์', 'อังคาร', 'พุธ', 'พฤหัส', 'ศุกร์']
    return resultSlots
      .filter((s) => s.room_id === selectedFacility.id)
      .map((s) => ({
        ...s,
        dayName: dayNames[(s.day || 1) - 1] || `วัน${s.day}`,
        subjectName: subjectMap.get(s.subject_id)?.name || s.subject_id,
        className: classMap.get(s.class_id)?.name || s.class_id,
        teacherName: teacherMap.get(s.teacher_id)?.name || s.teacher_id,
      }))
      .sort((a, b) => (a.day || 0) - (b.day || 0) || (a.period || 0) - (b.period || 0))
  }, [selectedFacility, resultSlots, subjectMap, classMap, teacherMap])

  // Facility grid: organize slots into day×period matrix
  const facilityGrid = useMemo(() => {
    if (!selectedFacility) return { days: [], periods: [], cells: {} }
    const dayNames = ['จันทร์', 'อังคาร', 'พุธ', 'พฤหัส', 'ศุกร์']
    const days = dayNames.slice(0, schedule_config?.days_per_week || 5)
    const maxPeriod = schedule_config?.periods_per_day || 8
    const periods = Array.from({ length: maxPeriod }, (_, i) => i + 1)
    const cells = {}
    for (const s of facilityTimetableSlots) {
      const key = `${s.day}-${s.period}`
      cells[key] = s
    }
    return { days, periods, cells }
  }, [selectedFacility, facilityTimetableSlots, schedule_config])

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

  // Auto-close the drawer when resizing into tablet/mobile widths so the
  // grid is never crushed by the 250px drawer (re-open is always possible).
  useEffect(() => {
    function handleResize() {
      if (window.innerWidth < 1024) setDrawerOpen(false)
    }
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

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
    // Predict the post-placement remaining count using the same formula
    // the reducer uses (solver slots + user placements, deduped at this
    // day/period). This is only shown as feedback — the reducer remains
    // the source of truth for actual state.
    const lbId = lessonBlock.id
    const existing = (userPlacements[lbId] || []).filter(
      (p) => !(p.day === day && p.period === period),
    )
    const solverPlaced = resultSlots.filter((s) => s.lesson_block_id === lbId).length
    const afterCount = solverPlaced + existing.length + 1
    const remaining = (lessonBlock.periods_per_week || 0) - afterCount
    placeLessonBlock(lbId, day, period)
    setPlacementToast({
      msg: remaining > 0
        ? `วางแล้ว — เหลืออีก ${remaining} คาบ`
        : 'จัดครบทุกคาบแล้ว ✓',
    })
    if (placementTimerRef.current) clearTimeout(placementTimerRef.current)
    placementTimerRef.current = setTimeout(() => setPlacementToast(null), 2500)
  }

  // ❌ Remove a slot/placement from the grid (button on card)
  function handleRemoveFromGrid(lessonBlockId, isPreAssigned, day, period) {
    if (isPreAssigned) {
      removePlacement(lessonBlockId, day, period)
    } else {
      deleteSlot(lessonBlockId, day, period)
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
    setRailSearch('')
    setTransitioning(true)
    setTimeout(() => setTransitioning(false), 250)
  }

  // ── Filtered rail lists (search) ───────────────────────────────────
  const railQuery = railSearch.trim().toLowerCase()
  const filteredRailItems = useMemo(() => {
    const items = viewMode === 'class' ? classes : teachers
    if (!railQuery) return items
    return items.filter((it) => (it.name || '').toLowerCase().includes(railQuery))
  }, [viewMode, classes, teachers, railQuery])

  const facilityQuery = facilitySearch.trim().toLowerCase()
  const filteredFacilityRooms = useMemo(() => {
    if (!facilityQuery) return special_rooms
    return special_rooms.filter((r) => (r.name || '').toLowerCase().includes(facilityQuery))
  }, [special_rooms, facilityQuery])

  function handleNavigatePrintStudio() {
    setStep(6)
  }

  // ── Excel export handlers (ฟอร์แมตเดียวกับเทมเพลตนำเข้าหน้า 1) ──────
  function showExportToast(ok, msg) {
    setExportToast({ ok, msg })
    setTimeout(() => setExportToast(null), 3000)
  }

  async function handleQuickExport() {
    if (!fixtureData?.lesson_blocks?.length && !fixtureData?.teachers?.length) {
      showExportToast(false, 'ไม่มีข้อมูลให้ส่งออก')
      return
    }
    setExporting(true)
    try {
      await exportQuickTemplateExcel(fixtureData, activeSnapshotLabel || 'ตารางสอน')
      showExportToast(true, 'ส่งออก Excel แบบด่วนสำเร็จ (นำกลับเข้า import หน้า 1 ได้)')
    } catch (e) {
      showExportToast(false, 'ส่งออก Excel ไม่สำเร็จ: ' + (e?.message || e))
    }
    setExporting(false)
  }

  function handleOpenExportModal() {
    if (!fixtureData?.lesson_blocks?.length && !fixtureData?.teachers?.length) {
      showExportToast(false, 'ไม่มีข้อมูลให้ส่งออก')
      return
    }
    setShowExportModal(true)
  }

  async function handleAdvancedExport(opts, filename) {
    setExporting(true)
    try {
      await exportFullTemplateExcel(fixtureData, opts, filename)
      showExportToast(true, 'ส่งออก Excel แบบกำหนดเองสำเร็จ (นำกลับเข้า import หน้า 1 ได้)')
      setShowExportModal(false)
    } catch (e) {
      showExportToast(false, 'ส่งออก Excel ไม่สำเร็จ: ' + (e?.message || e))
    }
    setExporting(false)
  }

  return (
    <div className="w-full space-y-4 pb-4">
      {/* Stale-data warning banner — dismissible, auto-hides on re-solve */}
      {isDirty && !isBannerDismissed && (
        <div className="flex items-center justify-between px-4 py-2 bg-amber-50 border border-amber-200 text-amber-800 rounded-xl mb-3 text-xs sm:text-sm">
          <div className="flex items-center gap-2 min-w-0">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span className="font-medium min-w-0 truncate">
              มีการเปลี่ยนแปลงข้อมูล — กดจัดตารางใหม่เพื่ออัปเดตผลลัพธ์
            </span>
          </div>
          <div className="flex items-center gap-2 shrink-0 ml-3">
            <button
              onClick={() => {
                setIsBannerDismissed(true)
                runSolver({ preAssignments: userPlacements })
              }}
              disabled={isGenerating}
              className="flex items-center gap-1 bg-amber-600 hover:bg-amber-700 text-white px-3 py-1 rounded-lg font-medium text-xs transition-colors disabled:opacity-60"
            >
              <Rocket className="w-3 h-3" />
              จัดใหม่
            </button>
            <button
              onClick={() => setIsBannerDismissed(true)}
              disabled={isGenerating}
              className="p-1 rounded-lg text-amber-600 hover:text-amber-800 hover:bg-amber-100 transition-colors disabled:opacity-50"
              aria-label="ปิดการแจ้งเตือน"
              title="ปิดการแจ้งเตือนชั่วคราว"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* Solver error banner — shows backend failures (e.g. 500) instead of silence */}
      {error && !isGenerating && (
        <div className="flex items-start justify-between gap-3 px-4 py-3 bg-red-50 border border-red-200 text-red-800 rounded-xl mb-3 text-xs sm:text-sm">
          <div className="min-w-0">
            <div className="flex items-center gap-2 font-bold">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              จัดตารางไม่สำเร็จ
            </div>
            <div className="mt-0.5 break-words">{error}</div>
            {errorResponse?.diagnostics?.hard_rule_issues?.length > 0 && (
              <ul className="list-disc pl-5 mt-1">
                {errorResponse.diagnostics.hard_rule_issues.map((h, i) => (
                  <li key={i}>{h}</li>
                ))}
              </ul>
            )}
            {errorResponse?.diagnostics?.teacher_overloads?.length > 0 && (
              <div className="mt-1 text-red-700">
                ครูที่เกินขีดจำกัด: {errorResponse.diagnostics.teacher_overloads.map((t) => t.teacher_name).join(', ')}
              </div>
            )}
            {errorResponse?.diagnostics?.notes?.length > 0 && (
              <div className="mt-1 italic text-red-600">
                {errorResponse.diagnostics.notes.map((n, i) => <div key={i}>{n}</div>)}
              </div>
            )}
          </div>
          <button
            onClick={() => setStep(4)}
            className="shrink-0 inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold
              text-red-700 bg-white border border-red-300 hover:bg-red-100 transition-colors"
          >
            ดูรายละเอียดขั้นที่ 4
          </button>
        </div>
      )}

      {/* Unplaced-lessons panel — อธิบายว่าติดอะไร ทำไมจัดไม่ครบ */}
      {unplacedReport && (
        <div className="px-4 py-3 bg-amber-50 border border-amber-300 text-amber-900 rounded-xl mb-3 text-xs sm:text-sm space-y-2">
          <div className="font-bold flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            จัดไม่ครบ {unplacedReport.totalMissing} คาบ — สาเหตุที่เป็นไปได้:
          </div>
          <ul className="list-disc pl-5 space-y-0.5">
            {unplacedReport.classRows.map((r) => (
              <li key={`c-${r.name}`}>
                ห้อง <b>{r.name}</b>: วิชารวม <b>{r.needed}</b> คาบ แต่มีช่องว่าง {r.avail} คาบ (หักคาบล็อกแล้ว)
                {r.needed > r.avail && <span className="text-red-600"> — เกิน {r.needed - r.avail} คาบ</span>}
              </li>
            ))}
            {unplacedReport.teacherRows.map((r) => (
              <li key={`t-${r.name}`}>
                ครู <b>{r.name}</b>: สอน <b>{r.needed}</b> คาบ แต่มีช่องว่างสอน {r.avail} คาบ (หักล็อก+ไม่สะดวก)
                {r.needed > r.avail && <span className="text-red-600"> — เกิน {r.needed - r.avail} คาบ</span>}
              </li>
            ))}
          </ul>
          {unplacedReport.hardRules.length > 0 && (
            <div>
              เงื่อนไข Hard ที่เปิดอยู่ (อาจจำกัดการวาง):{' '}
              <span className="font-semibold">{unplacedReport.hardRules.join(' · ')}</span>
              <span className="text-amber-700"> — ลองเปลี่ยนเป็น Soft หรือปิด แล้วจัดใหม่</span>
            </div>
          )}
          <p className="text-amber-700 italic">
            หมายเหตุ: การปิดเงื่อนไขใน "เงื่อนไขระดับระบบ" ไม่ได้ปลดคาบล็อกกิจกรรม / ช่องไม่สะดวกของครู / พื้นที่ห้องเรียน —
            คาบที่ลงไม่ได้อาจมาจากพื้นที่จริงไม่พอ (ต้องลดวิชาในห้อง หรือปลดล็อก)
          </p>
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
        onPinByTeacher={handlePinByTeacher}
        onPinByClass={handlePinByClass}
        onUnpinByTeacher={handleUnpinByTeacher}
        onUnpinByClass={handleUnpinByClass}
        teachers={teachers}
        classes={classes}
        hasResult={hasResult}
        hasPlacements={hasPlacements}
        className={viewMode === 'class' ? selectedClass?.name : selectedTeacher?.name}
        onOpenConstraints={() => setShowConstraintsModal(true)}
        onOpenSubstitutes={() => setShowSubstituteModal(true)}
        onOpenDailySubstitute={() => setStep(7)}
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
        // Cloud workspace props
        user={user}
        onLogin={login}
        cloudSyncing={cloudSyncing}
        activeCloudWorkspaceId={activeCloudWorkspaceId}
        onSaveToCloud={saveToCloud}
        cloudWorkspaces={cloudWorkspaces}
        onListCloudWorkspaces={listCloudWorkspaces}
        onLoadFromCloud={loadFromCloud}
        onDeleteFromCloud={deleteFromCloud}
        // Tab + Print Studio props
        activeTab={activeTab}
        onTabChange={setActiveTab}
        onNavigatePrintStudio={handleNavigatePrintStudio}
        // Excel export props
        onQuickExport={handleQuickExport}
        onAdvancedExport={handleOpenExportModal}
        exporting={exporting}
        exportDisabled={!fixtureData?.lesson_blocks?.length && !fixtureData?.teachers?.length}
      />

      {/* Tab Content */}
      {activeTab === 'timetable' && (
        <div className="card p-0 overflow-hidden">
          {/* Three-panel layout: [Drawer (left) | Grid (center) | Mini Rail (right)] */}
          <div className="flex" style={{ height: 'calc(100vh - 220px)', minHeight: '450px' }}>
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
              className="flex-1 min-w-0 relative overflow-y-auto overflow-x-auto p-2"
            >
              {/* Tablet/mobile switcher — mini rail is hidden below lg */}
              <div className="lg:hidden flex items-center gap-2 mb-2">
                <select
                  value={viewMode === 'class'
                    ? (selectedClass?.id || '')
                    : (selectedTeacher?.id || '')}
                  onChange={(e) => {
                    if (viewMode === 'class') handleSelectClass(e.target.value)
                    else handleSelectTeacher(e.target.value)
                  }}
                  className="flex-1 min-w-0 px-2.5 py-1.5 text-sm rounded-lg border border-gray-300 bg-white focus:outline-none focus:ring-1 focus:ring-blue-400 focus:border-blue-400"
                  title={viewMode === 'class' ? 'เลือกห้องเรียน' : 'เลือกครูผู้สอน'}
                >
                  {(viewMode === 'class' ? classes : teachers).map((it) => (
                    <option key={it.id} value={it.id}>{it.name}</option>
                  ))}
                </select>
                <button
                  onClick={() => navigatePage('prev')}
                  className="p-1.5 rounded-lg border border-gray-200 bg-white text-gray-500 hover:bg-gray-50 transition-colors shrink-0"
                  title="ก่อนหน้า"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <button
                  onClick={() => navigatePage('next')}
                  className="p-1.5 rounded-lg border border-gray-200 bg-white text-gray-500 hover:bg-gray-50 transition-colors shrink-0"
                  title="ถัดไป"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
              <div className={transitioning ? 'animate-fadeSlide' : ''}>
                <TimetableGrid
                  slots={resultSlots}
                  subjects={subjects}
                  teachers={teachers}
                  classes={classes}
                  days={gridConfig.daysPerWeek}
                  periodsPerDay={gridConfig.periodsPerDay}
                  periodList={gridConfig.periodList}
                  lunchPeriods={gridConfig.lunchPeriods}
                  breakPeriods={gridConfig.breakPeriods}
                  fixedSlots={fixed_slots}
                  substitutes={substitutes}
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
                  // Special rooms
                  specialRooms={fixtureData?.special_rooms || []}
                  onChangeSlotRoom={changeSlotRoom}
                  onTabChange={setActiveTab}
                />
              </div>
            </div>

            {/* 3. Right: mini navigation rail (hidden below lg — replaced by the dropdown) */}
            <div className="w-[135px] shrink-0 border-l border-gray-200 bg-gray-50/50 hidden lg:flex flex-col">
              {/* Column header */}
              <div className="text-[11px] font-semibold text-gray-400 px-2 py-1 uppercase border-b border-gray-200">
                {viewMode === 'class' ? 'ห้องเรียน' : 'ครูผู้สอน'}
              </div>

              {/* Search input */}
              <div className="p-1.5 border-b border-gray-200 bg-white">
                <div className="relative">
                  <Search className="w-3 h-3 text-gray-400 absolute left-1.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input
                    type="text"
                    value={railSearch}
                    onChange={(e) => setRailSearch(e.target.value)}
                    placeholder="ค้นหา..."
                    className="w-full pl-6 pr-5 py-1 text-[11px] rounded-md border border-gray-200
                      focus:outline-none focus:ring-1 focus:ring-blue-400 focus:border-blue-400
                      placeholder:text-gray-400 bg-white"
                  />
                  {railSearch && (
                    <button
                      onClick={() => setRailSearch('')}
                      className="absolute right-1 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                      title="ล้างคำค้นหา"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  )}
                </div>
              </div>

              {/* Scrollable pill list */}
              <div className="flex-1 overflow-y-auto py-1 px-1.5 space-y-1">
                {filteredRailItems.length === 0 && (
                  <div className="text-[10px] text-gray-400 text-center py-3 px-1">
                    ไม่พบผลลัพธ์
                  </div>
                )}
                {filteredRailItems.map((item) => {
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

      {/* Facilities Tab — Lab room schedules */}
      {activeTab === 'facilities' && (
        <div className="card p-0 overflow-hidden">
          {/* Back button */}
          <div className="px-4 py-2 border-b border-gray-200 bg-gray-50">
            <button
              onClick={() => setActiveTab('timetable')}
              className="flex items-center gap-1 text-sm font-medium text-indigo-600 hover:text-indigo-800"
            >
              ← กลับไปตารางสอน
            </button>
          </div>
          {special_rooms.length === 0 ? (
            <div className="text-center py-12 text-gray-400">
              <FlaskConical className="w-10 h-10 mx-auto mb-3" />
              <p className="text-sm">ยังไม่มีห้องปฏิบัติการ — เพิ่มได้ในขั้นตอน "เตรียมข้อมูล"</p>
            </div>
          ) : resultSlots.length === 0 ? (
            <div className="text-center py-12 text-gray-400">
              <Calendar className="w-10 h-10 mx-auto mb-3" />
              <p className="text-sm">ยังไม่มีตารางสอน — กด "จัดตาราง" ก่อน</p>
            </div>
          ) : (
            <div className="flex">
              {/* Left: Grid or Table */}
              <div className="flex-1 p-4">
                {/* Header with toggle */}
                <div className="flex items-center justify-between mb-4">
                  <h3 className="font-bold text-gray-900 flex items-center gap-2">
                    <FlaskConical className="w-5 h-5 text-indigo-600" />
                    {selectedFacility ? (
                      <>
                        <span className="text-lg">{FACILITY_TYPE_ICONS[selectedFacility.room_type] || '🔬'}</span>
                        {selectedFacility.name}
                        {selectedFacility.room_type && (
                          <span className="text-xs px-1.5 py-0.5 rounded-full bg-indigo-100 text-indigo-700">
                            {FACILITY_TYPE_LABELS[selectedFacility.room_type] || selectedFacility.room_type}
                          </span>
                        )}
                      </>
                    ) : 'เลือกห้องปฏิบัติการ'}
                  </h3>
                  {/* Toggle Grid/Table */}
                  <div className="flex rounded-lg border border-gray-200 bg-gray-50 p-0.5 text-xs">
                    <button
                      onClick={() => setFacilityViewMode('grid')}
                      className={`flex items-center gap-1 px-2.5 py-1 rounded-md transition-all
                        ${facilityViewMode === 'grid' ? 'bg-white text-indigo-700 shadow-sm font-semibold' : 'text-gray-500 hover:text-gray-700'}`}
                    >
                      <LayoutGrid className="w-3.5 h-3.5" />
                      กริด
                    </button>
                    <button
                      onClick={() => setFacilityViewMode('table')}
                      className={`flex items-center gap-1 px-2.5 py-1 rounded-md transition-all
                        ${facilityViewMode === 'table' ? 'bg-white text-indigo-700 shadow-sm font-semibold' : 'text-gray-500 hover:text-gray-700'}`}
                    >
                      <Table className="w-3.5 h-3.5" />
                      ตาราง
                    </button>
                  </div>
                </div>

                {!selectedFacility ? (
                  <div className="text-center py-12 text-gray-400 text-sm">
                    เลือกห้องปฏิบัติการจากแถบด้านขวา
                  </div>
                ) : facilityTimetableSlots.length === 0 ? (
                  <div className="text-center py-12 text-gray-400 text-sm">
                    ยังไม่มีคาบที่ใช้ห้องนี้ในตารางสอนปัจจุบัน
                  </div>
                ) : facilityViewMode === 'grid' ? (
                  /* Grid view: day × period */
                  <div className="overflow-x-auto">
                    <table className="min-w-full border-collapse text-xs">
                      <thead>
                        <tr>
                          <th className="border border-gray-200 bg-gray-50 px-2 py-1.5 text-gray-500 font-medium w-16">วัน</th>
                          {facilityGrid.periods.map((p) => (
                            <th key={p} className="border border-gray-200 bg-gray-50 px-2 py-1.5 text-gray-500 font-medium w-28">
                              คาบ {p}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {facilityGrid.days.map((dayName, dayIdx) => {
                          const day = dayIdx + 1
                          return (
                            <tr key={day}>
                              <td className="border border-gray-200 bg-gray-50 px-2 py-1.5 font-medium text-gray-700">
                                {dayName}
                              </td>
                              {facilityGrid.periods.map((period) => {
                                const cell = facilityGrid.cells[`${day}-${period}`]
                                return (
                                  <td key={period} className="border border-gray-200 px-1.5 py-1 align-top">
                                    {cell ? (
                                      <div className="bg-indigo-50 rounded p-1.5 border border-indigo-100">
                                        <div className="font-semibold text-indigo-800 text-[11px] truncate">
                                          {cell.subjectName}
                                        </div>
                                        <div className="text-gray-600 text-[10px] truncate">{cell.className}</div>
                                        <div className="text-gray-500 text-[10px] truncate">{cell.teacherName}</div>
                                      </div>
                                    ) : (
                                      <div className="text-gray-200 text-center">—</div>
                                    )}
                                  </td>
                                )
                              })}
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  /* Table view: list */
                  <div className="overflow-x-auto">
                    <table className="min-w-full divide-y divide-gray-200 text-sm">
                      <thead className="bg-gray-50">
                        <tr>
                          <th className="px-3 py-2 text-left text-xs font-bold text-gray-600">วัน</th>
                          <th className="px-3 py-2 text-center text-xs font-bold text-gray-600">คาบที่</th>
                          <th className="px-3 py-2 text-left text-xs font-bold text-gray-600">ชั้น</th>
                          <th className="px-3 py-2 text-left text-xs font-bold text-gray-600">วิชา</th>
                          <th className="px-3 py-2 text-left text-xs font-bold text-gray-600">ครู</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100 bg-white">
                        {facilityTimetableSlots.map((s, i) => (
                          <tr key={i} className="hover:bg-gray-50">
                            <td className="px-3 py-2 font-medium text-gray-900">{s.dayName}</td>
                            <td className="px-3 py-2 text-center text-gray-700">{s.period}</td>
                            <td className="px-3 py-2 text-gray-700">{s.className}</td>
                            <td className="px-3 py-2 text-gray-700">{s.subjectName}</td>
                            <td className="px-3 py-2 text-gray-700">{s.teacherName}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              {/* Right: Mini rail with facility chips */}
              <div className="w-[135px] shrink-0 border-l border-gray-200 bg-gray-50/50 flex flex-col">
                <div className="text-[11px] font-semibold text-gray-400 px-2 py-1 uppercase border-b border-gray-200">
                  ห้องปฏิบัติการ
                </div>

                {/* Search input */}
                <div className="p-1.5 border-b border-gray-200 bg-white">
                  <div className="relative">
                    <Search className="w-3 h-3 text-gray-400 absolute left-1.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                    <input
                      type="text"
                      value={facilitySearch}
                      onChange={(e) => setFacilitySearch(e.target.value)}
                      placeholder="ค้นหา..."
                      className="w-full pl-6 pr-5 py-1 text-[11px] rounded-md border border-gray-200
                        focus:outline-none focus:ring-1 focus:ring-indigo-400 focus:border-indigo-400
                        placeholder:text-gray-400 bg-white"
                    />
                    {facilitySearch && (
                      <button
                        onClick={() => setFacilitySearch('')}
                        className="absolute right-1 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                        title="ล้างคำค้นหา"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    )}
                  </div>
                </div>

                <div className="flex-1 overflow-y-auto py-1 px-1.5 space-y-1">
                  {filteredFacilityRooms.length === 0 && (
                    <div className="text-[10px] text-gray-400 text-center py-3 px-1">
                      ไม่พบผลลัพธ์
                    </div>
                  )}
                  {filteredFacilityRooms.map((room) => {
                    const idx = special_rooms.findIndex((r) => r.id === room.id)
                    const isActive = selectedFacilityIndex === idx
                    const icon = FACILITY_TYPE_ICONS[room.room_type] || '🔬'
                    return (
                      <button
                        key={room.id}
                        onClick={() => setSelectedFacilityIndex(idx)}
                        className={`w-full text-left px-2 py-1.5 rounded-lg text-[11px] font-medium
                          transition-all truncate bg-indigo-50 text-indigo-700 border border-indigo-200 hover:bg-indigo-100
                          ${isActive ? 'ring-2 ring-indigo-500 font-bold shadow-sm' : ''}`}
                      >
                        <span className="mr-0.5">{icon}</span>
                        {room.name}
                      </button>
                    )
                  })}
                </div>
              </div>
            </div>
          )}
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

      {/* ── Substitute Manager Modal (สอนแทน) ──────────────────────── */}
      <SubstituteManagerModal
        isOpen={showSubstituteModal}
        onClose={() => setShowSubstituteModal(false)}
        teachers={teachers}
        classes={classes}
        subjects={subjects}
        lessonBlocks={lesson_blocks}
        slots={resultSlots}
        userPlacements={userPlacements}
        substitutes={substitutes}
        days={gridConfig.daysPerWeek}
        periods={gridConfig.periodsPerDay}
        onSet={setSubstitute}
        onRemove={removeSubstitute}
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

      {/* ── Excel Export Modal (แบบกำหนดเองระดับสูง) ──────────────────── */}
      <ExportExcelModal
        isOpen={showExportModal}
        onClose={() => setShowExportModal(false)}
        onConfirm={handleAdvancedExport}
        defaultFilename={activeSnapshotLabel || 'ตารางสอน'}
        exporting={exporting}
        counts={{ teachers: teachers?.length || 0, fixedSlots: fixed_slots?.length || 0 }}
      />

      {/* ── Export toast (top-right, ไม่ชน completion toast) ─────────── */}
      {exportToast && (
        <div className={`fixed top-6 right-6 z-[120] px-4 py-3 rounded-xl shadow-lg
          text-sm font-medium flex items-center gap-2 max-w-sm
          ${exportToast.ok ? 'bg-emerald-600 text-white' : 'bg-red-600 text-white'}`}>
          {exportToast.ok
            ? <CheckCircle className="w-5 h-5 shrink-0" />
            : <XCircle className="w-5 h-5 shrink-0" />}
          {exportToast.msg}
        </div>
      )}

      {/* ── Placement feedback toast (bottom-left, ไม่ชน toasts อื่น) ── */}
      {placementToast && (
        <div className="fixed bottom-6 left-6 z-[120] px-4 py-3 rounded-xl shadow-lg
          text-sm font-medium flex items-center gap-2 max-w-sm bg-emerald-600 text-white">
          <CheckCircle className="w-5 h-5 shrink-0" />
          {placementToast.msg}
        </div>
      )}
    </div>
  )
}
