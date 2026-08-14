import { useState } from 'react'
import { Rocket, Zap, Target, Loader2, ChevronDown, SlidersHorizontal } from 'lucide-react'

/**
 * Clear dropdown option helper.
 */
function ClearOption({ icon, title, desc, disabled, danger, onClick }) {
  return (
    <button
      disabled={disabled}
      onClick={onClick}
      className={`w-full flex items-center gap-3 px-4 py-3 text-sm text-left transition-colors
        border-t border-gray-100 first:border-t-0
        disabled:opacity-30 disabled:cursor-not-allowed
        ${danger ? 'hover:bg-red-50' : 'hover:bg-gray-50'}`}
    >
      <span className="text-base shrink-0">{icon}</span>
      <div>
        <div className={`font-semibold ${danger ? 'text-red-700' : 'text-gray-800'}`}>{title}</div>
        <div className="text-xs text-gray-500">{desc}</div>
      </div>
    </button>
  )
}

/**
 * Top Solver Toolbar — full-width horizontal panel placed below the Tab Selector
 * and above the three-panel layout (Drawer | Grid | MiniRail).
 *
 * Left side:  Optimization mode selector (segmented toggle) + Clear dropdown
 * Right side: Primary "generate remaining" action button (large, prominent)
 *
 * Props:
 *   optimizationMode  — 'BALANCED' | 'FAST'
 *   onModeChange      — (mode) => void
 *   onGenerate        — () => void
 *   isGenerating      — boolean
 *   disabled          — boolean (e.g. when no fixture data)
 *   fixedCount        — int: number of 🔒 locked fixed slots
 *   preAssignedCount  — int: number of 📌 user-placed slots
 *   onClearManual     — () => void
 *   onClearSolver     — () => void
 *   onClearAll        — () => void
 *   onClearByTeacher  — (teacherId: string) => void
 *   teachers          — { id, name }[]
 *   hasResult         — boolean
 *   hasPlacements     — boolean
 *   className         — string (selected class/teacher name for confirmation)
 *   onOpenConstraints — () => void  (opens the constraints overview modal)
 */
export default function SolverToolbar({
  optimizationMode = 'BALANCED',
  onModeChange,
  onGenerate,
  isGenerating = false,
  disabled = false,
  fixedCount = 0,
  preAssignedCount = 0,
  onClearManual,
  onClearSolver,
  onClearAll,
  onClearByTeacher,
  teachers = [],
  hasResult = false,
  hasPlacements = false,
  className: selectedClassName,
  onOpenConstraints,
}) {
  const [dropdownOpen, setDropdownOpen] = useState(false)
  const [pendingAction, setPendingAction] = useState(null) // 'manual'|'solver'|'all'|'teacher'
  const [showConfirm, setShowConfirm] = useState(false)
  const [selectedTeacherId, setSelectedTeacherId] = useState(null)

  function openConfirm(action) {
    setPendingAction(action)
    if (action === 'teacher') setSelectedTeacherId(null)
    setShowConfirm(true)
    setDropdownOpen(false)
  }

  function handleConfirm() {
    if (pendingAction === 'manual') onClearManual?.()
    else if (pendingAction === 'solver') onClearSolver?.()
    else if (pendingAction === 'all') onClearAll?.()
    else if (pendingAction === 'teacher') onClearByTeacher?.(selectedTeacherId)
    setShowConfirm(false)
    setPendingAction(null)
    setSelectedTeacherId(null)
  }

  function handleCancel() {
    setShowConfirm(false)
    setPendingAction(null)
    setSelectedTeacherId(null)
  }

  const confirmMessage =
    pendingAction === 'manual' ? 'ยืนยันการล้างเฉพาะวิชาที่วางด้วยมือ'
    : pendingAction === 'solver' ? 'ยืนยันการล้างเฉพาะวิชาที่ระบบจัดอัตโนมัติ'
    : pendingAction === 'all' ? 'ยืนยันการล้างทั้งหมดกลับเป็นตารางเปล่า'
    : pendingAction === 'teacher' && selectedTeacherId
      ? `ยืนยันการล้างวิชาทั้งหมดของ ${teachers.find((t) => t.id === selectedTeacherId)?.name}`
      : pendingAction === 'teacher' ? 'กรุณาเลือกครูผู้สอน'
      : ''

  const confirmDisabled = pendingAction === 'teacher' && !selectedTeacherId

  return (
    <>
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 px-5 py-3">
        <div className="flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-4">
          {/* ── Left: Optimization Mode Selector ─────────────────────── */}
          <div className="flex items-center gap-3">
            <span className="text-xs font-bold text-gray-500 uppercase tracking-wide shrink-0">
              โหมดการคำนวณ
            </span>
            <div className="inline-flex rounded-lg border border-gray-300 bg-gray-50 p-1">
              <button
                onClick={() => onModeChange?.('BALANCED')}
                disabled={isGenerating}
                className={`flex items-center gap-1.5 px-4 py-2 rounded-md text-sm font-medium transition-all
                  ${optimizationMode === 'BALANCED'
                    ? 'bg-white text-blue-700 shadow-sm ring-1 ring-blue-200'
                    : 'text-gray-500 hover:text-gray-700'
                  } ${isGenerating ? 'opacity-50 cursor-not-allowed' : ''}`}
              >
                <span className="text-base leading-none">
                  {optimizationMode === 'BALANCED' ? '◉' : '○'}
                </span>
                <Target className="w-4 h-4" />
                🎯 สมดุล (BALANCED)
              </button>
              <button
                onClick={() => onModeChange?.('FAST')}
                disabled={isGenerating}
                className={`flex items-center gap-1.5 px-4 py-2 rounded-md text-sm font-medium transition-all
                  ${optimizationMode === 'FAST'
                    ? 'bg-white text-blue-700 shadow-sm ring-1 ring-blue-200'
                    : 'text-gray-500 hover:text-gray-700'
                  } ${isGenerating ? 'opacity-50 cursor-not-allowed' : ''}`}
              >
                <span className="text-base leading-none">
                  {optimizationMode === 'FAST' ? '◉' : '○'}
                </span>
                <Zap className="w-4 h-4" />
                ⚡ เร็ว (FAST)
              </button>
            </div>
          </div>

          {/* ── Clear Dropdown ────────────────────────────────────────── */}
          <div className="relative">
            <button
              onClick={() => setDropdownOpen(!dropdownOpen)}
              className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-gray-600
                hover:bg-gray-100 rounded-lg transition-colors"
            >
              🗑️ ล้างตาราง
              <ChevronDown className={`w-3.5 h-3.5 transition-transform ${dropdownOpen ? 'rotate-180' : ''}`} />
            </button>

            {dropdownOpen && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setDropdownOpen(false)} />
                <div className="absolute right-0 top-full mt-1 z-50 w-80 bg-white rounded-xl shadow-xl
                  border border-gray-200 overflow-hidden">
                  <ClearOption
                    icon="📌"
                    title="ล้างเฉพาะวิชาที่วางด้วยมือ"
                    desc="นำการ์ด 📌 กลับคลังวิชา โดยไม่ลบผลจัดอัตโนมัติ"
                    disabled={!hasPlacements}
                    onClick={() => openConfirm('manual')}
                  />
                  <ClearOption
                    icon="🚀"
                    title="ล้างเฉพาะวิชาที่ระบบจัดอัตโนมัติ"
                    desc="คงการ์ด 📌 ไว้ ลบเฉพาะผล 🚀 จาก Solver"
                    disabled={!hasResult}
                    onClick={() => openConfirm('solver')}
                  />
                  <ClearOption
                    icon="🔄"
                    title="ล้างทั้งหมดกลับเป็นตารางเปล่า"
                    desc="ลบทั้ง 📌 และ 🚀 คงไว้เฉพาะ 🔒 กิจกรรมล็อก"
                    danger
                    disabled={!hasResult && !hasPlacements}
                    onClick={() => openConfirm('all')}
                  />
                  <ClearOption
                    icon="👤"
                    title="ล้างเฉพาะตารางของครู..."
                    desc="เลือกครูเพื่อลบเฉพาะวิชาที่ครูท่านนั้นสอน"
                    disabled={teachers.length === 0}
                    onClick={() => openConfirm('teacher')}
                  />
                </div>
              </>
            )}
          </div>

          {/* ── Center: Constraint context info ──────────────────────── */}
          <div className="flex items-center gap-2 text-xs text-gray-500 ml-2 flex-wrap">
            {(fixedCount > 0 || preAssignedCount > 0) && (
              <span className="flex items-center gap-1.5">
                ส่งเป็น Hard Constraints:
                {fixedCount > 0 && (
                  <span className="badge bg-gray-100 text-gray-600 border border-gray-300">
                    🔒 {fixedCount} กิจกรรมล็อก
                  </span>
                )}
                {preAssignedCount > 0 && (
                  <span className="badge bg-amber-100 text-amber-700 border border-amber-300">
                    📌 {preAssignedCount} ล็อกด้วยมือ
                  </span>
                )}
              </span>
            )}

            <button
              onClick={onOpenConstraints}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold
                text-gray-700 bg-white border border-gray-300 hover:bg-gray-50 hover:border-gray-400
                transition-colors"
            >
              <SlidersHorizontal className="w-3.5 h-3.5" />
              เงื่อนไข & ข้อจำกัดทั้งหมด
            </button>
          </div>

          {/* ── Spacer ───────────────────────────────────────────────── */}
          <div className="flex-1" />

          {/* ── Right: Primary Action Button ─────────────────────────── */}
          <button
            onClick={onGenerate}
            disabled={isGenerating || disabled}
            className="flex items-center gap-2 px-6 py-3 bg-blue-600 text-white rounded-xl font-bold text-base hover:bg-blue-700 transition-colors shadow-lg whitespace-nowrap shrink-0 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isGenerating ? (
              <>
                <Loader2 className="w-5 h-5 animate-spin" />
                กำลังจัดตาราง...
              </>
            ) : (
              <>
                <Rocket className="w-5 h-5" />
                สั่งจัดตารางสอนส่วนที่เหลืออัตโนมัติ
              </>
            )}
          </button>
        </div>
      </div>

      {/* ── Confirmation Modal ─────────────────────────────────────── */}
      {showConfirm && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center">
          <div className="absolute inset-0 bg-black/40" onClick={handleCancel} />
          <div className="relative bg-white rounded-2xl shadow-2xl p-6 max-w-sm w-full mx-4">
            <h3 className="text-lg font-bold text-gray-900 mb-3">ยืนยันการล้างข้อมูล</h3>
            <p className="text-sm text-gray-600">{confirmMessage}</p>
            {selectedClassName && (
              <p className="text-sm text-gray-500 mt-1">ของ {selectedClassName}</p>
            )}

            {pendingAction === 'teacher' && (
              <select
                value={selectedTeacherId || ''}
                onChange={(e) => setSelectedTeacherId(e.target.value)}
                className="w-full mt-3 text-sm border border-gray-300 rounded-lg px-3 py-2 bg-white
                  focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              >
                <option value="" disabled>-- เลือกครู --</option>
                {teachers.map((t) => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>
            )}

            <div className="flex gap-3 mt-5">
              <button
                onClick={handleCancel}
                className="flex-1 px-4 py-2.5 text-sm font-medium text-gray-700 bg-gray-100
                  hover:bg-gray-200 rounded-xl transition-colors"
              >
                ยกเลิก
              </button>
              <button
                onClick={handleConfirm}
                disabled={confirmDisabled}
                className={`flex-1 px-4 py-2.5 text-sm font-bold text-white rounded-xl transition-colors
                  ${confirmDisabled ? 'bg-gray-300 cursor-not-allowed' : 'bg-rose-600 hover:bg-rose-700'}`}
              >
                ยืนยันล้างข้อมูล
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
