import { useState } from 'react'
import { ArrowUpDown } from 'lucide-react'
import LoadStatusBadge from './LoadStatusBadge.jsx'

export default function TeacherLoadTable({ loads }) {
  const [sortBy, setSortBy] = useState('name')

  if (!loads || loads.length === 0) return null

  const sorted = [...loads].sort((a, b) => {
    if (sortBy === 'name') return a.teacher_name.localeCompare(b.teacher_name)
    if (sortBy === 'load') return b.assigned_periods - a.assigned_periods
    if (sortBy === 'status') return a.load_status.localeCompare(b.load_status)
    return 0
  })

  const okCount = loads.filter((l) => l.load_status === 'ok').length
  const overCount = loads.filter((l) => l.load_status === 'over').length
  const underCount = loads.filter((l) => l.load_status === 'under').length

  const columns = [
    { key: 'name', label: 'ครู' },
    { key: 'load', label: 'คาบที่สอน' },
    { key: 'max', label: 'Max' },
    { key: 'min', label: 'Min' },
    { key: 'status', label: 'สถานะ' },
  ]

  return (
    <div className="space-y-4">
      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-3">
        <div className="bg-green-50 border border-green-200 rounded-lg p-3 text-center">
          <div className="text-2xl font-bold text-green-700">{okCount}</div>
          <div className="text-xs text-green-600">ปกติ</div>
        </div>
        <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-center">
          <div className="text-2xl font-bold text-red-700">{overCount}</div>
          <div className="text-xs text-red-600">เกินเพดาน</div>
        </div>
        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3 text-center">
          <div className="text-2xl font-bold text-yellow-700">{underCount}</div>
          <div className="text-xs text-yellow-600">ว่างมาก</div>
        </div>
      </div>

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              {columns.map((col) => (
                <th
                  key={col.key}
                  onClick={() => setSortBy(col.key)}
                  className="px-4 py-2 text-left text-xs font-bold text-gray-600 uppercase tracking-wider cursor-pointer hover:bg-gray-100"
                >
                  <span className="flex items-center gap-1">
                    {col.label}
                    <ArrowUpDown className="w-3 h-3 opacity-50" />
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-100">
            {sorted.map((load) => {
              const pct = load.max_periods > 0
                ? Math.min(100, (load.assigned_periods / load.max_periods) * 100)
                : 0
              return (
                <tr key={load.teacher_id} className="hover:bg-gray-50">
                  <td className="px-4 py-2 text-sm font-medium text-gray-900">
                    {load.teacher_name}
                  </td>
                  <td className="px-4 py-2 text-sm text-gray-700">
                    <div className="flex items-center gap-2">
                      <span className="font-bold">{load.assigned_periods}</span>
                      <div className="w-20 h-2 bg-gray-200 rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full ${
                            load.load_status === 'over' ? 'bg-red-500'
                            : load.load_status === 'under' ? 'bg-yellow-500'
                            : 'bg-green-500'
                          }`}
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-2 text-sm text-gray-500">{load.max_periods}</td>
                  <td className="px-4 py-2 text-sm text-gray-500">{load.min_periods}</td>
                  <td className="px-4 py-2">
                    <LoadStatusBadge status={load.load_status} />
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
