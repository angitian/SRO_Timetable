import { FileSpreadsheet, FileText } from 'lucide-react'

/**
 * TeacherClassMatrix — ตารางสรุปครู × ห้อง (จำนวนคาบที่ครูสอนในแต่ละห้อง)
 *
 * Props:
 *   rows        — [{ teacher, perClass: { classId: { periods, subjects } }, total, isOver }]
 *   cols        — [{ id, name }]
 *   colTotals   — { classId: number }
 *   grandTotal  — number
 *   onExportExcel — () => void
 *   onExportPdf   — () => void
 */
export default function TeacherClassMatrix({
  rows = [],
  cols = [],
  colTotals = {},
  grandTotal = 0,
  hasCoTeaching = false,
  onExportExcel,
  onExportPdf,
}) {
  // Cell background intensity based on period count
  function cellBg(v) {
    if (v <= 0) return 'bg-gray-50 text-gray-300'
    if (v <= 2) return 'bg-blue-50 text-blue-700'
    if (v <= 4) return 'bg-blue-100 text-blue-800'
    return 'bg-blue-200 text-blue-900'
  }

  return (
    <div className="space-y-3">
      {/* Export buttons */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <p className="text-xs text-gray-500">
          จำนวนคาบที่ครูแต่ละคนสอนในแต่ละห้อง (รวมครูผู้สอนร่วม) — แถวสีแดง = ครูเกินเพดาน
          {hasCoTeaching && <span className="text-purple-600"> · ผลรวมแนวนอน (ตามห้อง) นับ co-teach 2 ครั้ง ส่วนแนวตั้งคือคาบจริงของห้อง</span>}
        </p>
        <div className="flex gap-2">
          <button
            onClick={onExportExcel}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold
              text-green-700 bg-green-50 border border-green-300 hover:bg-green-100 transition-colors"
          >
            <FileSpreadsheet className="w-3.5 h-3.5" /> ส่งออก Excel
          </button>
          <button
            onClick={onExportPdf}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold
              text-red-700 bg-red-50 border border-red-300 hover:bg-red-100 transition-colors"
          >
            <FileText className="w-3.5 h-3.5" /> ส่งออก PDF
          </button>
        </div>
      </div>

      {/* Matrix table */}
      <div className="overflow-x-auto border border-gray-200 rounded-lg">
        <table className="border-collapse w-full text-sm">
          <thead>
            <tr>
              <th className="sticky left-0 z-10 bg-blue-600 text-white px-3 py-2 text-left font-bold whitespace-nowrap min-w-[120px] border-r border-blue-400">
                ครู \ ห้อง
              </th>
              {cols.map((c) => (
                <th key={c.id} className="bg-blue-50 text-blue-800 px-2.5 py-2 font-semibold text-center whitespace-nowrap border-l border-gray-200 min-w-[64px]">
                  {c.name}
                </th>
              ))}
              <th className="bg-indigo-600 text-white px-2.5 py-2 font-bold text-center whitespace-nowrap border-l border-indigo-400">
                รวม
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const rowOver = r.isOver
              return (
                <tr key={r.teacher.id} className={rowOver ? 'bg-red-50/60' : ''}>
                  <td className={`sticky left-0 z-10 px-3 py-1.5 font-semibold whitespace-nowrap border-r border-gray-200
                    ${rowOver ? 'bg-red-100 text-red-800' : 'bg-white text-gray-800'}`}
                    title={rowOver ? `${r.teacher.name} เกินเพดาน (${r.total}/${r.teacher.max_periods_per_week})` : r.teacher.name}
                  >
                    <span className="flex items-center gap-1">
                      {r.teacher.name}
                      {rowOver && <span className="text-[9px] font-bold text-red-600">⚠</span>}
                    </span>
                  </td>
                  {cols.map((c) => {
                    const cell = r.perClass[c.id]
                    const v = cell?.periods || 0
                    const subjList = Object.entries(cell?.subjects || {})
                      .map(([s, n]) => `${s} ${n} คาบ`)
                      .join(', ')
                    return (
                      <td
                        key={c.id}
                        className={`px-2.5 py-1.5 text-center font-semibold border-l border-gray-100 whitespace-nowrap ${cellBg(v)}`}
                        title={subjList || '—'}
                      >
                        {v > 0 ? v : ''}
                      </td>
                    )
                  })}
                  <td className={`px-2.5 py-1.5 text-center font-bold whitespace-nowrap border-l border-gray-200
                    ${rowOver ? 'bg-red-200 text-red-900' : 'bg-indigo-100 text-indigo-900'}`}>
                    {r.total}
                  </td>
                </tr>
              )
            })}
          </tbody>
          <tfoot>
            <tr>
              <td className="sticky left-0 z-10 bg-slate-100 px-3 py-2 font-bold whitespace-nowrap border-r border-gray-300 text-gray-700">
                รวมทุกครู
              </td>
              {cols.map((c) => (
                <td key={c.id} className="bg-slate-100 px-2.5 py-2 text-center font-bold border-l border-gray-200 text-gray-700 whitespace-nowrap">
                  {colTotals[c.id] || 0}
                </td>
              ))}
              <td className="bg-slate-300 px-2.5 py-2 text-center font-bold border-l border-gray-300 whitespace-nowrap">
                {grandTotal}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  )
}
