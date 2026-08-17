import { useState, useEffect } from 'react'
import { X, FileSpreadsheet, Users, Calendar, Download, Loader2 } from 'lucide-react'

/**
 * ExportExcelModal — modal สำหรับ "ส่งออกแบบกำหนดเองระดับสูง"
 * เลือกชีตที่จะรวมในไฟล์ Excel (ฟอร์แมตเดียวกับเทมเพลตนำเข้าหน้า 1)
 * และตั้งชื่อไฟล์ก่อนดาวน์โหลด
 *
 * Props:
 *   isOpen              — boolean
 *   onClose             — () => void
 *   onConfirm           — (opts, filename) => Promise<void>
 *                         opts = { includeConstraints, includeFixedSlots }
 *   defaultFilename     — string (initial value for filename input)
 *   counts              — { teachers, fixedSlots } for sheet descriptions
 *   exporting           — boolean (disable controls while exporting)
 */
export default function ExportExcelModal({
  isOpen = false,
  onClose,
  onConfirm,
  defaultFilename = 'ตารางสอน',
  counts = {},
  exporting = false,
}) {
  const [includeConstraints, setIncludeConstraints] = useState(true)
  const [includeFixedSlots, setIncludeFixedSlots] = useState(true)
  const [filename, setFilename] = useState(defaultFilename)

  // Sync filename when modal opens or default changes
  useEffect(() => {
    if (isOpen) setFilename(defaultFilename)
  }, [isOpen, defaultFilename])

  if (!isOpen) return null

  function handleConfirm() {
    onConfirm?.(
      { includeConstraints, includeFixedSlots },
      filename.trim() || defaultFilename,
    )
  }

  const teacherCount = counts.teachers || 0
  const fixedCount = counts.fixedSlots || 0

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/40 backdrop-blur-sm"
        onClick={exporting ? undefined : onClose}
      />

      {/* Modal card */}
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-blue-100 flex items-center justify-center">
              <FileSpreadsheet className="w-4 h-4 text-blue-600" />
            </div>
            <div>
              <h3 className="text-base font-bold text-gray-900">ส่งออก Excel แบบกำหนดเอง</h3>
              <p className="text-xs text-gray-500">ฟอร์แมตเดียวกับเทมเพลตนำเข้าหน้า 1 (นำกลับเข้าได้)</p>
            </div>
          </div>
          <button
            onClick={onClose}
            disabled={exporting}
            className="p-1.5 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100
              transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="px-5 py-4 space-y-4">
          {/* Sheet selection */}
          <div className="space-y-2">
            <h4 className="text-xs font-bold text-gray-500 uppercase tracking-wide">เลือกชีตที่จะส่งออก</h4>

            {/* Course_Mapping — always included */}
            <label className="flex items-center gap-3 p-3 rounded-lg border border-gray-200 bg-gray-50 cursor-not-allowed">
              <input type="checkbox" checked disabled className="w-4 h-4 accent-blue-600" />
              <FileSpreadsheet className="w-4 h-4 text-gray-600 shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="text-sm font-semibold text-gray-800">Course_Mapping</div>
                <div className="text-xs text-gray-500">ตารางภาระงานครู-วิชา-ห้อง (บังคับ)</div>
              </div>
              <span className="text-[10px] font-bold text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded">บังคับ</span>
            </label>

            {/* Teacher_Constraints — optional */}
            <label className={`flex items-center gap-3 p-3 rounded-lg border transition-colors
              ${includeConstraints
                ? 'border-blue-300 bg-blue-50/50'
                : 'border-gray-200 bg-white hover:bg-gray-50'}
              ${exporting ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer'}`}>
              <input
                type="checkbox"
                checked={includeConstraints}
                onChange={(e) => setIncludeConstraints(e.target.checked)}
                disabled={exporting}
                className="w-4 h-4 accent-blue-600"
              />
              <Users className="w-4 h-4 text-blue-600 shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="text-sm font-semibold text-gray-800">Teacher_Constraints</div>
                <div className="text-xs text-gray-500">
                  เงื่อนไขครู: ภาระงานสูงสุด/ขั้นต่ำ, ห้ามสอน, บทบาทพิเศษ
                  {teacherCount > 0 && <span className="ml-1 text-gray-400">({teacherCount} คน)</span>}
                </div>
              </div>
            </label>

            {/* Fixed_Slots — optional */}
            <label className={`flex items-center gap-3 p-3 rounded-lg border transition-colors
              ${includeFixedSlots
                ? 'border-purple-300 bg-purple-50/50'
                : 'border-gray-200 bg-white hover:bg-gray-50'}
              ${exporting ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer'}`}>
              <input
                type="checkbox"
                checked={includeFixedSlots}
                onChange={(e) => setIncludeFixedSlots(e.target.checked)}
                disabled={exporting}
                className="w-4 h-4 accent-purple-600"
              />
              <Calendar className="w-4 h-4 text-purple-600 shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="text-sm font-semibold text-gray-800">Fixed_Slots</div>
                <div className="text-xs text-gray-500">
                  คาบกิจกรรมล็อก (ชุมนุม, ลูกเสือ, โฮมรูม...)
                  {fixedCount > 0 && <span className="ml-1 text-gray-400">({fixedCount} รายการ)</span>}
                </div>
              </div>
            </label>
          </div>

          {/* Filename input */}
          <div className="space-y-1.5">
            <label className="text-xs font-bold text-gray-500 uppercase tracking-wide">
              ชื่อไฟล์
            </label>
            <div className="flex items-center rounded-lg border border-gray-300 bg-white overflow-hidden
              focus-within:border-blue-500 focus-within:ring-2 focus-within:ring-blue-100 transition-all">
              <input
                type="text"
                value={filename}
                onChange={(e) => setFilename(e.target.value)}
                disabled={exporting}
                placeholder={defaultFilename}
                className="flex-1 px-3 py-2 text-sm text-gray-900 bg-transparent outline-none
                  disabled:opacity-60 disabled:cursor-not-allowed"
              />
              <span className="px-3 py-2 text-xs text-gray-400 bg-gray-50 border-l border-gray-200">
                _{new Date().toISOString().slice(0, 10)}.xlsx
              </span>
            </div>
          </div>

          {/* Hint */}
          <div className="text-xs text-gray-500 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
            💡 ไฟล์ที่ส่งออกสามารถนำกลับเข้า import ในหน้า 1 ได้ (แบบกำหนดเองระดับสูง)
          </div>
        </div>

        {/* Footer */}
        <div className="flex gap-3 px-5 py-4 border-t border-gray-200 bg-gray-50">
          <button
            onClick={onClose}
            disabled={exporting}
            className="flex-1 px-4 py-2.5 text-sm font-medium text-gray-700 bg-white border border-gray-300
              hover:bg-gray-100 rounded-xl transition-colors
              disabled:opacity-50 disabled:cursor-not-allowed"
          >
            ยกเลิก
          </button>
          <button
            onClick={handleConfirm}
            disabled={exporting}
            className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-bold text-white
              bg-blue-600 hover:bg-blue-700 rounded-xl transition-colors shadow-sm
              disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {exporting ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                กำลังส่งออก...
              </>
            ) : (
              <>
                <Download className="w-4 h-4" />
                ส่งออกไฟล์
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  )
}
