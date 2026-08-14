import { useMemo, useState } from 'react'
import { Layers, Users, Search, SearchX, Package, X, ChevronLeft } from 'lucide-react'
import { getSubjectColor } from '../../utils/subjectColors.js'

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
}) {
  const [groupBy, setGroupBy] = useState('class') // 'class' | 'teacher'
  const [searchQuery, setSearchQuery] = useState('')

  const subjectMap = useMemo(() => new Map(subjects.map((s) => [s.id, s])), [subjects])
  const teacherMap = useMemo(() => new Map(teachers.map((t) => [t.id, t])), [teachers])
  const classMap = useMemo(() => new Map(classes.map((c) => [c.id, c])), [classes])

  // Count how many periods of each lesson block are already placed
  // (either by solver or by user pre-assignment)
  const placedCounts = useMemo(() => {
    const counts = {}
    for (const s of resultSlots) {
      counts[s.lesson_block_id] = (counts[s.lesson_block_id] || 0) + 1
    }
    for (const [lbId, placements] of Object.entries(userPlacements)) {
      counts[lbId] = (counts[lbId] || 0) + placements.length
    }
    return counts
  }, [resultSlots, userPlacements])

  // Unassigned = blocks where placed < periods_per_week
  const unassignedBlocks = useMemo(() => {
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
  }, [lessonBlocks, placedCounts, filterClass, searchQuery, subjectMap, teacherMap, classMap])

  // Group blocks
  const grouped = useMemo(() => {
    const groups = {}
    for (const lb of unassignedBlocks) {
      const key = groupBy === 'class' ? lb.class_id : lb.teacher_id
      if (!groups[key]) groups[key] = []
      groups[key].push(lb)
    }
    return groups
  }, [unassignedBlocks, groupBy])

  const totalRemaining = unassignedBlocks.reduce((sum, lb) => sum + lb.remaining, 0)

  function handleDragStart(e, lb) {
    e.dataTransfer.setData('text/plain', '')
    e.dataTransfer.setData('application/json', JSON.stringify(lb))
    e.dataTransfer.effectAllowed = 'copyMove'
    onDragStartBlock?.(lb)
  }

  function handleDragEnd() {
    onDragEndBlock?.()
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
      >
        <div className="h-full bg-white border-r border-gray-200 shadow-lg flex flex-col">
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
            {unassignedBlocks.length === 0 ? (
              <div className="text-center py-8 text-gray-400">
                <SearchX className="w-6 h-6 mx-auto mb-1.5" />
                <div className="text-xs">จัดครบทุกวิชาแล้ว</div>
              </div>
            ) : (
              Object.entries(grouped).map(([groupKey, blocks]) => {
                const groupName = groupBy === 'class'
                  ? (classMap.get(groupKey)?.name || groupKey)
                  : (teacherMap.get(groupKey)?.name || groupKey)
                return (
                  <div key={groupKey}>
                    <div className="text-xs sm:text-sm font-bold text-gray-500 mb-1.5 sticky top-0 bg-white py-0.5">
                      {groupName} <span className="text-gray-400 font-normal">({blocks.length})</span>
                    </div>
                    <div className="space-y-1.5">
                      {blocks.map((lb) => {
                        const subj = subjectMap.get(lb.subject_id)
                        const teacher = teacherMap.get(lb.teacher_id)
                        const cls = classMap.get(lb.class_id)
                        const colors = getSubjectColor(subj?.name, subj?.category)
                        return (
                          <div
                            key={lb.id}
                            draggable
                            onDragStart={(e) => handleDragStart(e, lb)}
                            onDragEnd={handleDragEnd}
                            className={`${colors.bg} ${colors.border} border rounded-lg p-2 cursor-grab hover:shadow-md transition-all active:cursor-grabbing`}
                          >
                            <div className={`text-base sm:text-lg font-bold leading-tight ${colors.text} truncate`}>
                              {subj?.name || lb.subject_id}
                            </div>
                            <div className="flex items-center justify-between mt-0.5">
                              <div className="text-xs sm:text-sm font-semibold text-slate-600 truncate">
                                {teacher?.name || lb.teacher_id}
                              </div>
                              <div className="text-xs sm:text-sm text-slate-500 shrink-0 ml-1">
                                {cls?.name || lb.class_id}
                              </div>
                            </div>
                            <div className="flex items-center gap-1 mt-1">
                              <span className="text-[10px] font-semibold text-gray-700 bg-white/80 rounded-full px-1.5 py-0.5 leading-tight shadow-sm">
                                เหลือ {lb.remaining}/{lb.periods_per_week} คาบ
                              </span>
                              {lb.placed > 0 && (
                                <span className="text-[10px] font-semibold text-green-700 bg-green-100 rounded-full px-1.5 py-0.5 leading-tight shadow-sm">
                                  จัดแล้ว {lb.placed}
                                </span>
                              )}
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
