import { useMemo, useState } from 'react'
import { Layers, Users, Search, SearchX, Package, X, ChevronLeft, CheckCircle2 } from 'lucide-react'
import { getSubjectColor } from '../../utils/subjectColors.js'
import { computePlacedCounts } from '../../utils/placementCounts.js'

/**
 * Collapsible right drawer listing unplaced lesson blocks, grouped by class or teacher.
 * Each card is draggable (HTML5 DnD) onto the timetable grid.
 *
 * Props:
 *   lessonBlocks   — all lesson blocks from fixtureData
 *   subjects       — subject list
 *   teachers       — teacher list
 *   classes        — class list
 *   resultSlots    — slots from solver result (to compute already-placed)
 *   userPlacements — { [lesson_block_id]: [{day, period}] } user pre-assignments
 *   filterClass    — current grid class filter (to scope sidebar)
 *   isOpen         — boolean: drawer visible or hidden
 *   onToggle       — () => void: toggle drawer open/closed
 *   onDropFromGrid — (lessonBlockId, isPreAssigned, day, period) => void
 */
export default function UnassignedSidebar({
  lessonBlocks = [],
  subjects = [],
  teachers = [],
  classes = [],
  resultSlots = [],
  userPlacements = {},
  filterClass = null,
  isOpen = true,
  onToggle,
  onDragStartBlock,
  onDragEndBlock,
  onDropFromGrid,
}) {
  const [groupBy, setGroupBy] = useState('class') // 'class' | 'teacher'
  const [searchQuery, setSearchQuery] = useState('')
  const [isGridDragOver, setIsGridDragOver] = useState(false)

  const subjectMap = useMemo(() => new Map(subjects.map((s) => [s.id, s])), [subjects])
  const teacherMap = useMemo(() => new Map(teachers.map((t) => [t.id, t])), [teachers])
  const classMap = useMemo(() => new Map(classes.map((c) => [c.id, c])), [classes])

  // Count how many periods of each lesson block are already placed
  // (either by solver or by user pre-assignment) — shared dedup helper so
  // the drawer always agrees with the banners/footer on the timetable page.
  const { byBlock: placedCounts } = useMemo(
    () => computePlacedCounts(lessonBlocks, resultSlots, userPlacements),
    [lessonBlocks, resultSlots, userPlacements],
  )

  // Unassigned = blocks where placed < periods_per_week
  // Two-stage filter so we can distinguish "everything placed" from
  // "search returned no matches" for the empty-state message.
  const unassignedBeforeSearch = useMemo(() => {
    return lessonBlocks
      .map((lb) => {
        const placed = placedCounts[lb.id] || 0
        const remaining = lb.periods_per_week - placed
        return { ...lb, placed, remaining }
      })
      .filter((lb) => lb.remaining > 0)
      .filter((lb) => {
        if (filterClass && lb.class_id !== filterClass) return false
        return true
      })
  }, [lessonBlocks, placedCounts, filterClass])

  const unassignedBlocks = useMemo(() => {
    return unassignedBeforeSearch
      .filter((lb) => {
        const q = searchQuery.trim().toLowerCase()
        if (!q) return true
        const subjName = subjectMap.get(lb.subject_id)?.name || ''
        const teacherName = teacherMap.get(lb.teacher_id)?.name || ''
        const className = classMap.get(lb.class_id)?.name || ''
        return (
          subjName.toLowerCase().includes(q) ||
          teacherName.toLowerCase().includes(q) ||
          className.toLowerCase().includes(q)
        )
      })
  }, [unassignedBeforeSearch, searchQuery, subjectMap, teacherMap, classMap])

  // True when every subject for the current view (class/teacher filter +
  // no search) is fully placed — used to show the "all done" empty state.
  const allPlaced = unassignedBeforeSearch.length === 0

  // Expand each block into `remaining` period-unit cards so that dragging
  // one card onto the grid makes exactly that card disappear. A block with
  // periods_per_week = 2 and 1 already-placed slot yields 1 unit card.
  // `unitIndex` is purely cosmetic (label "คาบ i/N"); the drag payload is
  // still the full lesson block — the reducer adds one placement per drop.
  const unassignedUnits = useMemo(() => {
    const units = []
    for (const lb of unassignedBlocks) {
      for (let i = 0; i < lb.remaining; i++) {
        units.push({ ...lb, unitIndex: i })
      }
    }
    return units
  }, [unassignedBlocks])

  // Group period-unit cards (not blocks) by class or teacher
  const grouped = useMemo(() => {
    const groups = {}
    for (const unit of unassignedUnits) {
      const key = groupBy === 'class' ? unit.class_id : unit.teacher_id
      if (!groups[key]) groups[key] = []
      groups[key].push(unit)
    }
    return groups
  }, [unassignedUnits, groupBy])

  // Total remaining periods across all visible units (matches the sum of
  // each unit's implicit "1 คาบ" — same as summing block.remaining).
  const totalRemaining = unassignedUnits.length

  function handleDragStart(e, lb) {
    e.dataTransfer.setData('text/plain', '')
    e.dataTransfer.setData('application/json', JSON.stringify(lb))
    e.dataTransfer.effectAllowed = 'copyMove'
    onDragStartBlock?.(lb)
  }

  function handleDragEnd() {
    onDragEndBlock?.()
  }

  // ── Grid → Drawer drop (unassign block) ──────────────────────────
  function handleDrawerDragOver(e) {
    // Only react to grid slot drags
    if (e.dataTransfer.types.includes('application/x-grid-slot')) {
      e.preventDefault()
      e.dataTransfer.dropEffect = 'move'
      setIsGridDragOver(true)
    }
  }

  function handleDrawerDragLeave(e) {
    // Only clear if leaving the drawer container (not entering a child)
    if (e.currentTarget === e.target) {
      setIsGridDragOver(false)
    }
  }

  function handleDrawerDrop(e) {
    const json = e.dataTransfer.getData('application/x-grid-slot')
    if (!json) return
    e.preventDefault()
    setIsGridDragOver(false)
    try {
      const { lessonBlockId, day, period } = JSON.parse(json)
      // Determine if it was a pre-assigned placement by checking userPlacements
      const isPreAssigned = !!(userPlacements[lessonBlockId]?.some(
        (p) => p.day === day && p.period === period,
      ))
      onDropFromGrid?.(lessonBlockId, isPreAssigned, day, period)
    } catch { /* ignore parse errors */ }
  }

  return (
    <>
      {/* Floating toggle button — always visible on the left edge */}
      {!isOpen && (
        <button
          onClick={onToggle}
          className="absolute top-1/2 -translate-y-1/2 left-0 z-30
            flex items-center gap-1.5 px-3 py-3 bg-blue-600 text-white rounded-r-xl shadow-lg
            hover:bg-blue-700 transition-colors whitespace-nowrap"
          style={{ writingMode: 'vertical-rl' }}
          title="เปิดคลังวิชาค้างจัด"
        >
          <Package className="w-4 h-4" />
          <span className="text-xs font-bold">คลังวิชา ({totalRemaining})</span>
        </button>
      )}

      {/* Drawer container — slides in/out from left */}
      <div
        className={`absolute top-0 left-0 bottom-0 z-30 transition-transform duration-300 ease-out
          ${isOpen ? 'translate-x-0' : '-translate-x-full'}`}
        style={{ width: '250px' }}
        onDragOver={handleDrawerDragOver}
        onDragLeave={handleDrawerDragLeave}
        onDrop={handleDrawerDrop}
      >
        <div className={`h-full bg-white border-r shadow-lg flex flex-col transition-colors
          ${isGridDragOver ? 'border-emerald-400 border-r-4 bg-emerald-50/50' : 'border-gray-200'}`}>
          {/* Header */}
          <div className="flex items-center gap-2 px-3 py-2.5 border-b border-gray-100 shrink-0">
            <Package className="w-5 h-5 text-orange-600 shrink-0" />
            <h3 className="font-bold text-gray-900 text-sm flex-1">คลังวิชาค้างจัด</h3>
            <span className="badge bg-orange-100 text-orange-700 text-xs shrink-0">
              {totalRemaining} คาบ
            </span>
            <button
              onClick={onToggle}
              className="p-1 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded transition-colors shrink-0"
              title="ปิด"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Drop zone hint when dragging grid slot over drawer */}
          {isGridDragOver && (
            <div className="mx-3 mt-2 mb-1 px-3 py-2 rounded-lg bg-emerald-100 border border-emerald-300 text-emerald-700 text-xs font-semibold text-center">
              วางที่นี่เพื่อนำวิชาออกจากตาราง
            </div>
          )}

          {/* Group toggle */}
          <div className="flex gap-1 px-3 pt-2 shrink-0">
            <button
              onClick={() => setGroupBy('class')}
              className={`flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium transition-all
                ${groupBy === 'class' ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
            >
              <Layers className="w-3 h-3" />
              ตามห้อง
            </button>
            <button
              onClick={() => setGroupBy('teacher')}
              className={`flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium transition-all
                ${groupBy === 'teacher' ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
            >
              <Users className="w-3 h-3" />
              ตามครู
            </button>
          </div>

          {/* Search */}
          <div className="relative px-3 py-2 shrink-0">
            <Search className="w-3.5 h-3.5 text-gray-400 absolute left-5 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="ค้นหาวิชา/ครู/ห้อง..."
              className="w-full pl-8 pr-3 py-1.5 text-xs rounded-lg border border-gray-300 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none"
            />
          </div>

          {/* List */}
          <div className="flex-1 overflow-y-auto px-3 pb-2 space-y-3">
            {unassignedUnits.length === 0 ? (
              allPlaced ? (
                <div className="flex flex-col items-center justify-center py-8 px-3">
                  <div className="flex items-center gap-1.5 px-3 py-2 rounded-lg
                    bg-emerald-50 text-emerald-700 border border-emerald-200 text-sm font-semibold">
                    <CheckCircle2 className="w-4 h-4 shrink-0" />
                    จัดครบทุกคาบแล้ว
                  </div>
                  <p className="text-[11px] text-emerald-600/70 mt-2 text-center">
                    วิชาทั้งหมดในมุมมองนี้ถูกจัดลงตารางครบแล้ว
                  </p>
                </div>
              ) : (
                <div className="text-center py-8 text-gray-400">
                  <SearchX className="w-6 h-6 mx-auto mb-1.5" />
                  <div className="text-xs">ไม่พบวิชาที่ตรงกับ "{searchQuery}"</div>
                </div>
              )
            ) : (
              Object.entries(grouped).map(([groupKey, units]) => {
                const groupName = groupBy === 'class'
                  ? (classMap.get(groupKey)?.name || groupKey)
                  : (teacherMap.get(groupKey)?.name || groupKey)
                return (
                  <div key={groupKey}>
                    <div className="text-xs sm:text-sm font-bold text-gray-500 mb-1.5 sticky top-0 bg-white py-0.5">
                      {groupName} <span className="text-gray-400 font-normal">({units.length} คาบ)</span>
                    </div>
                    <div className="space-y-1.5">
                      {units.map((unit) => {
                        const subj = subjectMap.get(unit.subject_id)
                        const teacher = teacherMap.get(unit.teacher_id)
                        const cls = classMap.get(unit.class_id)
                        const colors = getSubjectColor(subj?.name, subj?.category)
                        return (
                          <div
                            key={`${unit.id}-${unit.unitIndex}`}
                            draggable
                            onDragStart={(e) => handleDragStart(e, unit)}
                            onDragEnd={handleDragEnd}
                            className={`${colors.bg} ${colors.border} border rounded-lg p-2 cursor-grab hover:shadow-md transition-all active:cursor-grabbing`}
                          >
                            <div className={`text-base sm:text-lg font-bold leading-tight ${colors.text} truncate`}>
                              {subj?.name || unit.subject_id}
                            </div>
                            <div className="flex items-center justify-between mt-0.5">
                              <div className="text-xs sm:text-sm font-semibold text-slate-600 truncate">
                                {teacher?.name || unit.teacher_id}
                              </div>
                              <div className="text-xs sm:text-sm text-slate-500 shrink-0 ml-1">
                                {cls?.name || unit.class_id}
                              </div>
                            </div>
                            <div className="flex items-center gap-1 mt-1">
                              <span className="text-[10px] font-semibold text-gray-700 bg-white/80 rounded-full px-1.5 py-0.5 leading-tight shadow-sm">
                                คาบ {unit.unitIndex + 1}/{unit.periods_per_week}
                              </span>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )
              })
            )}
          </div>

          {/* Footer hint */}
          <div className="px-3 py-2 border-t border-gray-100 text-[10px] text-gray-400 text-center shrink-0">
            ลากการ์ดไปวางในช่องว่างของตาราง
          </div>
        </div>
      </div>
    </>
  )
}
