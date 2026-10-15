import { useState } from 'react'
import { Download, SearchX } from 'lucide-react'

// filter keys: 'all' | 'under' | 'over' | 'ok'
const FILTERS = [
  { key: 'all', label: 'ทั้งหมด', activeCls: 'bg-blue-600 text-white' },
  { key: 'under', label: 'ภาระงานขาด (Underload)', activeCls: 'bg-amber-500 text-white' },
  { key: 'over', label: 'ภาระงานเกิน (Overload)', activeCls: 'bg-red-600 text-white' },
  { key: 'ok', label: 'ปกติ (ตามเกณฑ์)', activeCls: 'bg-green-600 text-white' },
]

const GAUGE_COLOR = {
  under: 'bg-amber-400',
  ok: 'bg-green-500',
  over: 'bg-red-500',
}

const STATUS_BADGE = {
  under: 'bg-amber-100 text-amber-700',
  ok: 'bg-green-100 text-green-700',
  over: 'bg-red-100 text-red-700',
}

/**
 * Teacher workload summary — 1 row per teacher, grouped subject badges,
 * workload gauge with under/balanced/over status, quick filters + Excel export.
 *
 * @param {Object} props
 * @param {Array} props.groups - Grouped workloads (already search-filtered by the caller).
 * @param {(name: string, category?: string) => string} props.subjectColorClass
 * @param {() => void} props.onExportExcel
 */
export default function TeacherWorkloadTable({ groups = [], subjectColorClass, onExportExcel }) {
  const [filter, setFilter] = useState('all')

  const counts = {
    all: groups.length,
    under: groups.filter((g) => g.status === 'under').length,
    over: groups.filter((g) => g.status === 'over').length,
    ok: groups.filter((g) => g.status === 'ok').length,
  }
  const filtered = filter === 'all' ? groups : groups.filter((g) => g.status === filter)

  return (
    <div className="space-y-3">
      {/* Toolbar: title + filters + export */}
      <div className="flex flex-col gap-3">
        <div className="flex flex-col sm:flex-row sm:items-center gap-2">
          <h3 className="font-bold text-gray-900">ตารางภาระงานครู</h3>
          <span className="text-xs text-gray-400">1 แถว = 1 ครู — ดูว่าใครสอนวิชาไหน ชั้นไหน ห้องไหน กี่คาบ เพื่อเกลี่ยภาระงาน</span>
          <button
            onClick={onExportExcel}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-emerald-600 text-white hover:bg-emerald-700 transition-colors sm:ml-auto"
          >
            <Download className="w-3.5 h-3.5" />
            ส่งออก Excel
          </button>
        </div>

        {/* Quick filters */}
        <div className="flex flex-wrap gap-1.5">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              className={`px-3 py-1.5 rounded-full text-xs font-medium transition-all
                ${filter === f.key ? f.activeCls + ' shadow-sm' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
            >
              {f.label} ({counts[f.key]})
            </button>
          ))}
        </div>
      </div>

      {/* Table */}
      {filtered.length === 0 ? (
        <div className="text-center py-8 text-gray-400">
          <SearchX className="w-8 h-8 mx-auto mb-2" />
          ไม่พบข้อมูลที่ค้นหา
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200 text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-3 py-2 text-left text-xs font-bold text-gray-600 w-10">ลำดับ</th>
                <th className="px-3 py-2 text-left text-xs font-bold text-gray-600">ครู / กลุ่มสาระฯ</th>
                <th className="px-3 py-2 text-left text-xs font-bold text-gray-600">รายวิชาและห้องที่สอน</th>
                <th className="px-3 py-2 text-center text-xs font-bold text-gray-600 whitespace-nowrap">ภาระงานรวม / สัปดาห์</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filtered.map((g, i) => (
                <tr key={g.teacherId} className="hover:bg-gray-50">
                  <td className="px-3 py-2 text-gray-400 text-xs align-top">{i + 1}</td>
                  <td className="px-3 py-2 align-top">
                    <div className="font-medium text-gray-900 whitespace-nowrap">{g.teacherName}</div>
                    <div className="text-[11px] text-gray-400 mt-0.5 whitespace-nowrap">{g.department}</div>
                  </td>
                  <td className="px-3 py-2 text-gray-600">
                    <div className="flex flex-wrap gap-1">
                      {g.subjects.map((s) => (
                        <span
                          key={`${g.teacherId}-${s.subjectId}-${s.subjectName}`}
                          className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs border whitespace-nowrap ${subjectColorClass(s.subjectName)}`}
                          title={s.badgeText}
                        >
                          {s.subjectName}
                          <span className="ml-1 inline-flex items-center rounded-full px-1.5 py-0 text-[10px] font-semibold bg-black/10">
                            {s.roomsText}
                          </span>
                          • {s.totalPeriods}
                        </span>
                      ))}
                      {g.subjects.length === 0 && <span className="text-gray-400 text-xs">—</span>}
                    </div>
                  </td>
                  <td className="px-3 py-2 text-center align-top">
                    <div className="font-bold whitespace-nowrap">{g.total} / {g.max} คาบ</div>
                    <div className="mt-1 w-24 h-2 bg-gray-200 rounded-full overflow-hidden mx-auto">
                      <div
                        className={`h-full rounded-full ${GAUGE_COLOR[g.status]}`}
                        style={{ width: `${Math.min(100, (g.total / g.max) * 100)}%` }}
                      />
                    </div>
                    <div className="mt-1.5">
                      <span className={`badge text-[10px] whitespace-nowrap ${STATUS_BADGE[g.status]}`}>{g.statusText}</span>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
