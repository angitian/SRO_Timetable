import { ArrowLeft, Download, CheckCircle, AlertTriangle } from 'lucide-react'

/**
 * Standardized global sticky bottom footer for the timetable workspace.
 *
 * Props:
 *   onBack          — () => void  (navigate to verification step)
 *   placedCount     — int: total periods placed (solver + user)
 *   totalCount      — int: total periods required across all lesson blocks
 *   onExport        — () => void  (placeholder for future export)
 *   exportDisabled  — boolean
 */
export default function StickyFooter({
  onBack,
  placedCount = 0,
  totalCount = 0,
  onExport,
  exportDisabled = false,
}) {
  const isComplete = totalCount > 0 && placedCount >= totalCount
  const remaining = Math.max(0, totalCount - placedCount)
  const pct = totalCount > 0 ? Math.round((placedCount / totalCount) * 100) : 0

  return (
    <div className="fixed bottom-0 left-0 right-0 z-50 bg-white/95 backdrop-blur border-t border-gray-200 shadow-lg px-4 sm:px-6 lg:px-8 py-3">
      <div className="max-w-7xl mx-auto flex items-center justify-between gap-4">
        {/* Left: Back button */}
        <button
          onClick={onBack}
          className="btn-secondary text-sm flex items-center gap-1.5 shrink-0"
        >
          <ArrowLeft className="w-4 h-4" />
          <span className="hidden sm:inline">ย้อนกลับไปหน้าตรวจสอบ</span>
          <span className="sm:hidden">ย้อนกลับ</span>
        </button>

        {/* Center: Status badge */}
        <div className="hidden sm:flex items-center gap-2 text-sm min-w-0">
          {isComplete ? (
            <>
              <CheckCircle className="w-4 h-4 text-green-500 shrink-0" />
              <span className="text-green-700 font-medium truncate">
                📊 จัดสำเร็จแล้ว 100% ({placedCount}/{totalCount} คาบ)
              </span>
            </>
          ) : (
            <>
              <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0" />
              <span className="text-amber-700 font-medium truncate">
                ⚠️ เหลือวิชาค้างจัด {remaining} คาบ ({pct}%)
              </span>
            </>
          )}
        </div>

        {/* Mobile status (compact) */}
        <div className="flex sm:hidden text-xs font-medium shrink-0">
          {isComplete ? (
            <span className="text-green-700">✓ {pct}%</span>
          ) : (
            <span className="text-amber-700">{pct}%</span>
          )}
        </div>

        {/* Right: Export button (placeholder — coming soon) */}
        <button
          onClick={onExport}
          disabled={exportDisabled}
          className="flex items-center gap-2 px-4 py-2.5 bg-gray-400 text-white rounded-xl font-bold text-sm transition-colors shadow-md whitespace-nowrap shrink-0 disabled:opacity-40 disabled:cursor-not-allowed"
          title="ฟีเจอร์ส่งออกจะพร้อมใช้งานในอนาคต"
        >
          <Download className="w-4 h-4" />
          <span className="hidden sm:inline">📥 ส่งออกไฟล์ Excel (เร็วๆ นี้)</span>
          <span className="sm:hidden">📥</span>
        </button>
      </div>
    </div>
  )
}
