import { useMemo } from 'react'
import { useApp } from '../context/AppContext.jsx'
import TeacherLoadTable from '../components/load/TeacherLoadTable.jsx'
import LoadStatusBadge from '../components/load/LoadStatusBadge.jsx'

export default function TeacherLoadView() {
  const { result, fixtureData } = useApp()

  // Calculate "before" load from lesson_blocks
  const loadBefore = useMemo(() => {
    if (!fixtureData) return []
    const loads = {}
    for (const t of fixtureData.teachers) {
      loads[t.id] = { teacher_id: t.id, teacher_name: t.name, assigned: 0, max: t.max_periods_per_week, min: t.min_periods_per_week }
    }
    for (const lb of fixtureData.lesson_blocks) {
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
  }, [fixtureData])

  if (!result || !result.teacher_loads) {
    return (
      <div className="text-center py-12 text-gray-500">
        ยังไม่มีผลลัพธ์ — กลับไปหน้าแรกเพื่อจัดตาราง
      </div>
    )
  }

  const loadAfter = result.teacher_loads
  const beforeMap = new Map(loadBefore.map((l) => [l.teacher_id, l]))

  // Summary stats
  const beforeOver = loadBefore.filter((l) => l.load_status === 'over').length
  const afterOver = loadAfter.filter((l) => l.load_status === 'over').length
  const beforeUnder = loadBefore.filter((l) => l.load_status === 'under').length
  const afterUnder = loadAfter.filter((l) => l.load_status === 'under').length

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-gray-900">👨‍🏫 ภาระงานครู — Before/After</h1>

      {/* Summary comparison */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="bg-white rounded-lg border border-gray-200 p-3 text-center">
          <div className="text-xs text-gray-500 mb-1">ครูเกินเพดาน (ก่อน)</div>
          <div className={`text-2xl font-bold ${beforeOver > 0 ? 'text-red-600' : 'text-green-600'}`}>
            {beforeOver}
          </div>
        </div>
        <div className="bg-white rounded-lg border border-gray-200 p-3 text-center">
          <div className="text-xs text-gray-500 mb-1">ครูเกินเพดาน (หลัง)</div>
          <div className={`text-2xl font-bold ${afterOver > 0 ? 'text-red-600' : 'text-green-600'}`}>
            {afterOver}
          </div>
        </div>
        <div className="bg-white rounded-lg border border-gray-200 p-3 text-center">
          <div className="text-xs text-gray-500 mb-1">ครูว่างมาก (ก่อน)</div>
          <div className={`text-2xl font-bold ${beforeUnder > 0 ? 'text-yellow-600' : 'text-gray-400'}`}>
            {beforeUnder}
          </div>
        </div>
        <div className="bg-white rounded-lg border border-gray-200 p-3 text-center">
          <div className="text-xs text-gray-500 mb-1">ครูว่างมาก (หลัง)</div>
          <div className={`text-2xl font-bold ${afterUnder > 0 ? 'text-yellow-600' : 'text-gray-400'}`}>
            {afterUnder}
          </div>
        </div>
      </div>

      {/* Before/After comparison table */}
      <div className="card">
        <h2 className="font-bold text-gray-900 mb-4">เปรียบเทียบภาระงาน</h2>
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
                    <td className="px-4 py-2 text-sm font-medium text-gray-900">
                      {after.teacher_name}
                    </td>
                    <td className="px-4 py-2 text-sm text-center text-gray-600">
                      {beforeVal}
                    </td>
                    <td className="px-4 py-2 text-sm text-center font-bold text-gray-900">
                      {after.assigned_periods}
                    </td>
                    <td className="px-4 py-2 text-sm text-center">
                      {delta > 0 ? (
                        <span className="text-red-600">+{delta}</span>
                      ) : delta < 0 ? (
                        <span className="text-green-600">{delta}</span>
                      ) : (
                        <span className="text-gray-400">—</span>
                      )}
                    </td>
                    <td className="px-4 py-2 text-sm text-center text-gray-500">
                      {after.max_periods}
                    </td>
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

      {/* Detailed after table with progress bars */}
      <div className="card">
        <h2 className="font-bold text-gray-900 mb-4">รายละเอียดภาระงาน (หลังจัดตาราง)</h2>
        <TeacherLoadTable loads={loadAfter} />
      </div>
    </div>
  )
}
