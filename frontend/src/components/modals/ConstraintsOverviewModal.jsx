import { X, SlidersHorizontal, Pencil, Trash2, Lock, UtensilsCrossed, Ban } from 'lucide-react'
import { DAY_LABELS } from '../grid/GridLegend.jsx'

/**
 * ConstraintsOverviewModal — read-only summary of all active rules/constraints
 * with quick links back to the relevant setup steps.
 *
 * Props:
 *   isOpen         — boolean
 *   onClose        — () => void
 *   fixedCount     — int: number of 🔒 locked fixed slots
 *   pinnedCount    — int: number of 📌 user-placed slots
 *   fixedSlots     — FixedSlot[]: list of fixed slot definitions (for naming)
 *   lunchPeriods   — number[]: e.g. [4]
 *   onNavigateStep — (step: number) => void  (closes modal + navigates)
 *   onClearPins    — () => void  (clears user placements + closes modal)
 */
export default function ConstraintsOverviewModal({
  isOpen = false,
  onClose,
  fixedCount = 0,
  pinnedCount = 0,
  fixedSlots = [],
  lunchPeriods = [],
  onNavigateStep,
  onClearPins,
}) {
  if (!isOpen) return null

  function handleNavigate(step) {
    onClose?.()
    onNavigateStep?.(step)
  }

  function handleClearPins() {
    onClearPins?.()
    onClose?.()
  }

  // Build readable fixed-slot descriptions: "โฮมรูม (จันทร์ คาบ 1)"
  const fixedSlotDescriptions = (fixedSlots || [])
    .filter((fs) => fs.day != null && fs.period != null)
    .map((fs) => ({
      id: fs.id,
      label: `${fs.name || fs.slot_type || 'กิจกรรม'} (${DAY_LABELS[fs.day] || `วัน${fs.day}`} คาบ ${fs.period})`,
    }))

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/40 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Modal card */}
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[85vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200 sticky top-0 bg-white rounded-t-2xl z-10">
          <div className="flex items-center gap-2">
            <SlidersHorizontal className="w-5 h-5 text-gray-700" />
            <h3 className="text-lg font-bold text-gray-900">เงื่อนไข & ข้อจำกัดทั้งหมด</h3>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition-colors"
            aria-label="ปิด"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="px-5 py-4 space-y-6">
          {/* ── A. Configurable Constraints ─────────────────────────── */}
          <section>
            <h4 className="text-sm font-bold text-gray-700 mb-3 flex items-center gap-1.5">
              <Pencil className="w-4 h-4 text-blue-600" />
              เงื่อนไขที่ปรับแต่งได้
            </h4>

            <div className="space-y-2.5">
              {/* 1. Teacher workload & availability */}
              <div className="border border-gray-200 rounded-lg p-3 bg-gray-50/50">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-gray-800">
                      ภาระงานและช่วงเวลาว่างของครู
                    </div>
                    <div className="text-xs text-gray-500 mt-0.5">
                      กำหนดคาบสอนสูงสุดต่อวัน, วัน/คาบที่ไม่สะดวกสอน
                    </div>
                  </div>
                  <button
                    onClick={() => handleNavigate(3)}
                    className="shrink-0 inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold
                      text-blue-700 bg-blue-50 border border-blue-200 hover:bg-blue-100 transition-colors"
                  >
                    <Pencil className="w-3 h-3" />
                    ปรับในขั้นที่ 3
                  </button>
                </div>
              </div>

              {/* 2. Block & subject rules */}
              <div className="border border-gray-200 rounded-lg p-3 bg-gray-50/50">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-gray-800">
                      การจัดกลุ่มวิชาและคาบเรียน
                    </div>
                    <div className="text-xs text-gray-500 mt-0.5">
                      การรวมคาบคู่ (Double Periods), จำนวนคาบต่อสัปดาห์
                    </div>
                  </div>
                  <button
                    onClick={() => handleNavigate(2)}
                    className="shrink-0 inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold
                      text-blue-700 bg-blue-50 border border-blue-200 hover:bg-blue-100 transition-colors"
                  >
                    <Pencil className="w-3 h-3" />
                    ปรับในขั้นที่ 2
                  </button>
                </div>
              </div>

              {/* 3. Manual placements & pins */}
              <div className="border border-gray-200 rounded-lg p-3 bg-gray-50/50">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-gray-800">
                      การล็อกตำแหน่งวิชาด้วยมือ
                    </div>
                    <div className="text-xs text-gray-500 mt-0.5">
                      วิชาที่ผู้ใช้ลากวางและล็อกไว้ในหน้านี้ ({pinnedCount} รายการ)
                    </div>
                  </div>
                  <button
                    onClick={handleClearPins}
                    disabled={pinnedCount === 0}
                    className="shrink-0 inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold
                      text-rose-700 bg-rose-50 border border-rose-200 hover:bg-rose-100 transition-colors
                      disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    <Trash2 className="w-3 h-3" />
                    ปลดล็อกทั้งหมด
                  </button>
                </div>
              </div>
            </div>
          </section>

          {/* ── B. Fixed System Rules ───────────────────────────────── */}
          <section>
            <h4 className="text-sm font-bold text-gray-700 mb-3 flex items-center gap-1.5">
              <Lock className="w-4 h-4 text-gray-600" />
              เงื่อนไขตายตัวของระบบ
            </h4>

            <div className="space-y-2.5">
              {/* Lunch periods */}
              <div className="flex items-start gap-2.5 border border-gray-200 rounded-lg p-3">
                <span className="text-base leading-none mt-0.5">🍱</span>
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-gray-800">คาบพักเที่ยง</div>
                  <div className="text-xs text-gray-500 mt-0.5">
                    คาบที่ {lunchPeriods.length > 0 ? lunchPeriods.join(', ') : '—'} ของทุกวัน
                    (ถูกกันไว้ ไม่สามารถจัดวิชาลงได้)
                  </div>
                </div>
              </div>

              {/* Fixed school activities */}
              <div className="flex items-start gap-2.5 border border-gray-200 rounded-lg p-3">
                <Lock className="w-4 h-4 text-gray-600 mt-0.5 shrink-0" />
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-gray-800">
                    กิจกรรมตายตัวของโรงเรียน
                    <span className="ml-1.5 text-xs font-normal text-gray-500">
                      ({fixedCount} รายการ)
                    </span>
                  </div>
                  <div className="text-xs text-gray-500 mt-0.5">
                    {fixedSlotDescriptions.length > 0 ? (
                      <ul className="mt-1 space-y-0.5">
                        {fixedSlotDescriptions.slice(0, 6).map((fs) => (
                          <li key={fs.id} className="truncate">• {fs.label}</li>
                        ))}
                        {fixedSlotDescriptions.length > 6 && (
                          <li className="text-gray-400">
                            และอีก {fixedSlotDescriptions.length - 6} รายการ…
                          </li>
                        )}
                      </ul>
                    ) : (
                      'ไม่มีกิจกรรมล็อกเพิ่มเติม'
                    )}
                  </div>
                </div>
              </div>

              {/* Solver invariants */}
              <div className="flex items-start gap-2.5 border border-gray-200 rounded-lg p-3">
                <Ban className="w-4 h-4 text-gray-600 mt-0.5 shrink-0" />
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-gray-800">กฎพื้นฐาน Solver</div>
                  <div className="text-xs text-gray-500 mt-0.5">
                    ครู 1 ท่านไม่สามารถสอนพร้อมกัน 2 ห้องในคาบเดียวกันได้ 100%
                  </div>
                </div>
              </div>
            </div>
          </section>
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-gray-200 sticky bottom-0 bg-white rounded-b-2xl">
          <button
            onClick={onClose}
            className="w-full px-4 py-2.5 text-sm font-medium text-gray-700 bg-gray-100
              hover:bg-gray-200 rounded-xl transition-colors"
          >
            ปิด
          </button>
        </div>
      </div>
    </div>
  )
}
