/**
 * Left navigation panel listing all teachers with load status badges.
 * Click to select a teacher; active teacher is highlighted.
 *
 * Props:
 *   teachers           — teacher list from fixtureData
 *   selectedTeacherId  — currently selected teacher ID
 *   onSelectTeacher    — (teacherId) => void
 *   teacherStatuses    — { [teacherId]: { assigned, max, status } }
 *                        status: 'ok' | 'over' | 'under'
 */
export default function TeacherNavPanel({
  teachers = [],
  selectedTeacherId,
  onSelectTeacher,
  teacherStatuses = {},
}) {
  return (
    <div className="w-[180px] shrink-0 bg-white border-r border-gray-200 flex flex-col">
      {/* Header */}
      <div className="px-3 py-2.5 border-b border-gray-100 sticky top-0 bg-white z-10">
        <div className="text-xs font-bold text-gray-500 uppercase tracking-wide">
          ครูผู้สอน ({teachers.length})
        </div>
      </div>

      {/* Teacher list */}
      <div className="flex-1 overflow-y-auto py-1">
        {teachers.map((t) => {
          const status = teacherStatuses[t.id] || { assigned: 0, max: 0, status: 'ok' }
          const isActive = selectedTeacherId === t.id
          const badge = status.status === 'over'
            ? { cls: 'bg-red-100 text-red-700', label: '🔴 เกิน' }
            : status.status === 'under'
              ? { cls: 'bg-amber-100 text-amber-700', label: '🟡 ว่าง' }
              : { cls: 'bg-green-100 text-green-700', label: '🟢 ปกติ' }
          return (
            <button
              key={t.id}
              onClick={() => onSelectTeacher?.(t.id)}
              className={`w-full flex items-center gap-2 px-3 py-2 text-left text-sm transition-colors border-l-2
                ${isActive
                  ? 'bg-purple-50 text-purple-700 font-bold border-purple-500'
                  : 'text-gray-700 hover:bg-gray-50 border-transparent'
                }`}
            >
              <span className="truncate flex-1">{t.name}</span>
              <span className={`shrink-0 inline-flex items-center text-[10px] font-semibold rounded-full px-1.5 py-0 whitespace-nowrap ${badge.cls}`}>
                {badge.label}
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
