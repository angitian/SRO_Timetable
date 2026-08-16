import { SearchX } from 'lucide-react'

/**
 * Renders the classroom density table for the "ตรวจสอบตามห้องเรียน" tab.
 *
 * @param {Object} props
 * @param {Array} props.classrooms - Filtered classroom density entries to render.
 * @param {Object} props.classBlockMap - Map of class id → schedule block id.
 * @param {Object} props.blockMaxPeriods - Map of block id → max weekly study periods.
 * @param {(pct: number) => string} props.progressColor - Returns a tailwind bg-* class for a given percentage.
 * @param {(name: string, category?: string) => string} props.subjectColorClass - Returns concatenated subject color classes.
 */
export default function ClassroomDensityTable({
  classrooms,
  classBlockMap,
  blockMaxPeriods,
  progressColor,
  subjectColorClass,
}) {
  return (
    <div>
      {classrooms.length === 0 ? (
        <div className="text-center py-8 text-gray-400">
          <SearchX className="w-8 h-8 mx-auto mb-2" />
          ไม่พบข้อมูลที่ค้นหา
        </div>
      ) : (
        <table className="min-w-full divide-y divide-gray-200 text-sm">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-3 py-2 text-left text-xs font-bold text-gray-600">ห้อง</th>
              <th className="px-3 py-2 text-left text-xs font-bold text-gray-600">รายวิชา</th>
              <th className="px-3 py-2 text-center text-xs font-bold text-gray-600 whitespace-nowrap">คาบเรียน/สัปดาห์</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {classrooms.map((entry) => {
              const blockId = classBlockMap[entry.class.id]
              const maxPeriods = blockId ? blockMaxPeriods[blockId] || 0 : 0
              const pct = maxPeriods > 0 ? (entry.total / maxPeriods) * 100 : 0
              const diff = maxPeriods - entry.total
              const overflow = entry.total - maxPeriods
              return (
                <tr key={entry.class.id} className="hover:bg-gray-50">
                  <td className="px-3 py-2 font-medium text-gray-900 align-top whitespace-nowrap">{entry.class.name}</td>
                  <td className="px-3 py-2 text-gray-600">
                    <div className="flex flex-wrap gap-1">
                      {entry.subjectList.map((s) => (
                        <span
                          key={s.subject}
                          className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs border whitespace-nowrap ${subjectColorClass(s.subject)}`}
                        >
                          {s.subject} {s.periods}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className="px-3 py-2 text-center align-top">
                    {maxPeriods > 0 ? (
                      <>
                        <div className="font-bold whitespace-nowrap">{entry.total} / {maxPeriods}</div>
                        <div className="mt-1 w-24 h-2 bg-gray-200 rounded-full overflow-hidden mx-auto">
                          <div
                            className={`h-full rounded-full ${progressColor(pct)}`}
                            style={{ width: `${Math.min(100, pct)}%` }}
                          />
                        </div>
                        <div className="mt-1.5">
                          {entry.total === maxPeriods ? (
                            <span className="badge bg-green-100 text-green-700 text-xs">ครบถ้วน</span>
                          ) : entry.total > maxPeriods ? (
                            <span className="badge bg-red-100 text-red-700 text-xs">เกิน {overflow} คาบ</span>
                          ) : (
                            <span className="badge bg-blue-100 text-blue-700 text-xs whitespace-nowrap">
                              {entry.total}/{maxPeriods} (ขาด {diff})
                            </span>
                          )}
                        </div>
                      </>
                    ) : (
                      <span className="text-gray-400">—</span>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}
    </div>
  )
}
