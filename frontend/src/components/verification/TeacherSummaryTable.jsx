import { SearchX } from 'lucide-react'

/**
 * Renders the teacher summary table for the "ตรวจสอบตามครู" tab.
 *
 * @param {Object} props
 * @param {Array} props.teachers - Filtered teacher summary entries to render.
 * @param {(pct: number) => string} props.progressColor - Returns a tailwind bg-* class for a given percentage.
 * @param {(name: string, category?: string) => string} props.subjectColorClass - Returns concatenated subject color classes.
 */
export default function TeacherSummaryTable({ teachers, progressColor, subjectColorClass }) {
  return (
    <div>
      {teachers.length === 0 ? (
        <div className="text-center py-8 text-gray-400">
          <SearchX className="w-8 h-8 mx-auto mb-2" />
          ไม่พบข้อมูลที่ค้นหา
        </div>
      ) : (
        <table className="min-w-full divide-y divide-gray-200 text-sm">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-3 py-2 text-left text-xs font-bold text-gray-600">ครู</th>
              <th className="px-3 py-2 text-left text-xs font-bold text-gray-600">วิชา → ห้อง</th>
              <th className="px-3 py-2 text-center text-xs font-bold text-gray-600 whitespace-nowrap">รวมคาบ / เพดาน</th>
              <th className="px-3 py-2 text-center text-xs font-bold text-gray-600">สถานะ</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {teachers.map((entry) => {
              const max = entry.teacher.max_periods_per_week
              const pct = max > 0 ? (entry.total / max) * 100 : 0
              return (
                <tr key={entry.teacher.id} className="hover:bg-gray-50">
                  <td className="px-3 py-2 font-medium text-gray-900 align-top whitespace-nowrap">
                    {entry.teacher.name}
                    {entry.isCrossBlock && (
                      <span className="ml-1 badge bg-purple-100 text-purple-700 text-[10px]">ข้ามบล็อก</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-gray-600">
                    <div className="flex flex-wrap gap-1">
                      {entry.subjectRooms.map((sr, i) => (
                        <span
                          key={`${sr.subject}-${sr.class}-${i}`}
                          className={`inline-flex items-center gap-1 rounded-full pl-2 pr-1 py-0.5 text-xs border whitespace-nowrap ${subjectColorClass(sr.subject)}`}
                        >
                          {sr.subject}
                          <span className="inline-flex items-center rounded-full px-1.5 py-0 text-[10px] font-semibold bg-black/10">
                            {sr.class}
                          </span>
                          • {sr.periods}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className="px-3 py-2 text-center align-top">
                    <div className="font-bold whitespace-nowrap">{entry.total} / {max}</div>
                    <div className="mt-1 w-24 h-2 bg-gray-200 rounded-full overflow-hidden mx-auto">
                      <div
                        className={`h-full rounded-full ${progressColor(pct)}`}
                        style={{ width: `${Math.min(100, pct)}%` }}
                      />
                    </div>
                  </td>
                  <td className="px-3 py-2 text-center align-top">
                    {entry.isOver ? (
                      <span className="badge bg-red-100 text-red-700 text-xs">เกินเพดาน ⚠️</span>
                    ) : (
                      <span className="badge bg-green-100 text-green-700 text-xs">ปกติ</span>
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
