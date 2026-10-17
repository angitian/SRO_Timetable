import { SearchX } from 'lucide-react'

/**
 * Renders the classroom density table for the "ตรวจสอบตามห้องเรียน" tab.
 *
 * @param {Object} props
 * @param {Array} props.classrooms - Filtered classroom density entries to render.
 * @param {Object} props.classBlockMap - Map of class id → schedule block id.
 * @param {Object} props.blockMaxPeriods - Map of block id → max weekly study periods.
 * @param {Object} [props.lockedPeriodsByClass] - Map of class id → periods locked by fixed slots (กิจกรรมพิเศษ).
 * @param {(pct: number) => string} props.progressColor - Returns a tailwind bg-* class for a given percentage.
 * @param {(name: string, category?: string) => string} props.subjectColorClass - Returns concatenated subject color classes.
 */
export default function ClassroomDensityTable({
  classrooms,
  classBlockMap,
  blockMaxPeriods,
  lockedPeriodsByClass = {},
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
              const locked = lockedPeriodsByClass[entry.class.id] || 0
              const available = maxPeriods - locked
              const pct = available > 0 ? (entry.total / available) * 100 : 0
              const diff = available - entry.total
              const overflow = entry.total - available
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
                    {locked > 0 && (
                      <div className="mt-1 text-[11px] text-amber-600">🔒 คาบพิเศษล็อก {locked} คาบ</div>
                    )}
                  </td>
                  <td className="px-3 py-2 text-center align-top">
                    {available > 0 ? (
                      <>
                        <div className="font-bold whitespace-nowrap">{entry.total} / {available}</div>
                        {locked > 0 && (
                          <div className="text-[10px] text-gray-400 whitespace-nowrap">(ช่องทั้งหมด {maxPeriods} − ล็อก {locked})</div>
                        )}
                        <div className="mt-1 w-24 h-2 bg-gray-200 rounded-full overflow-hidden mx-auto">
                          <div
                            className={`h-full rounded-full ${progressColor(pct)}`}
                            style={{ width: `${Math.min(100, pct)}%` }}
                          />
                        </div>
                        <div className="mt-1.5">
                          {entry.total === available ? (
                            <span className="badge bg-amber-100 text-amber-700 text-xs whitespace-nowrap">พอดีเป๊ะ</span>
                          ) : entry.total > available ? (
                            <span className="badge bg-red-100 text-red-700 text-xs">เกิน {overflow} คาบ</span>
                          ) : (
                            <span className="badge bg-blue-100 text-blue-700 text-xs whitespace-nowrap">
                              เหลือว่าง {diff} คาบ
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
