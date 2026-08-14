import { CheckCircle, AlertCircle } from 'lucide-react'

/**
 * Left navigation panel listing all classes with status badges.
 * Click to select a class; active class is highlighted.
 *
 * Props:
 *   classes          — class list from fixtureData
 *   selectedClassId  — currently selected class ID
 *   onSelectClass    — (classId) => void
 *   classStatuses    — { [classId]: { total, placed, isComplete, remaining } }
 */
export default function ClassNavPanel({
  classes = [],
  selectedClassId,
  onSelectClass,
  classStatuses = {},
}) {
  return (
    <div className="w-[180px] shrink-0 bg-white border-r border-gray-200 flex flex-col">
      {/* Header */}
      <div className="px-3 py-2.5 border-b border-gray-100 sticky top-0 bg-white z-10">
        <div className="text-xs font-bold text-gray-500 uppercase tracking-wide">
          ห้องเรียน ({classes.length})
        </div>
      </div>

      {/* Class list */}
      <div className="flex-1 overflow-y-auto py-1">
        {classes.map((cls) => {
          const status = classStatuses[cls.id] || { total: 0, placed: 0, isComplete: false, remaining: 0 }
          const isActive = selectedClassId === cls.id
          return (
            <button
              key={cls.id}
              onClick={() => onSelectClass?.(cls.id)}
              className={`w-full flex items-center gap-2 px-3 py-2 text-left text-sm transition-colors border-l-2
                ${isActive
                  ? 'bg-blue-50 text-blue-700 font-bold border-blue-500'
                  : 'text-gray-700 hover:bg-gray-50 border-transparent'
                }`}
            >
              <span className="truncate flex-1">{cls.name}</span>
              {status.isComplete ? (
                <span className="shrink-0 inline-flex items-center gap-0.5 text-[10px] font-semibold text-green-700 bg-green-100 rounded-full px-1.5 py-0">
                  🟢 ครบ
                </span>
              ) : status.total > 0 ? (
                <span className="shrink-0 inline-flex items-center gap-0.5 text-[10px] font-semibold text-amber-700 bg-amber-100 rounded-full px-1.5 py-0 whitespace-nowrap">
                  🟡 ขาด {status.remaining}
                </span>
              ) : null}
            </button>
          )
        })}
      </div>
    </div>
  )
}
