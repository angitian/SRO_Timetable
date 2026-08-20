import { useRef } from 'react'
import { Upload, Trash2, Save, RotateCcw } from 'lucide-react'

// ── Toggle Switch Component ──────────────────────────────────────────────
function ToggleSwitch({ checked, onChange, label }) {
  return (
    <label className="flex items-start justify-between cursor-pointer select-none py-1">
      <span className="text-sm text-gray-700 leading-tight pr-2">{label}</span>
      <button
        type="button"
        onClick={() => onChange(!checked)}
        className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors
          ${checked ? 'bg-blue-600' : 'bg-gray-300'}`}
        role="switch"
        aria-checked={checked}
      >
        <span
          className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform
            ${checked ? 'translate-x-4' : 'translate-x-0.5'}`}
        />
      </button>
    </label>
  )
}

/**
 * PrintSettingsPanel — the print template settings form.
 *
 * Props:
 *   settings          — settings object (schoolName, semester, academicYear,
 *                       schoolLogo, signatoryName, signatoryTitle,
 *                       showPeriodTimes, showWorkloadSummary, showSignOff,
 *                       showFooter, showQRCode)
 *   onSettingsChange  — callback receiving partial updates, e.g.
 *                       onSettingsChange({ schoolName: '...' })
 *   onSaveTemplate    — callback for the save-template button
 *   onResetTemplate   — callback for the reset-template button
 */
export default function PrintSettingsPanel({
  settings,
  onSettingsChange,
  onSaveTemplate,
  onResetTemplate,
}) {
  const logoInputRef = useRef(null)

  // ── Logo upload handler — converts image file to Base64 data URL ──────
  function handleLogoUpload(e) {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (ev) => {
      onSettingsChange({ schoolLogo: ev.target.result })
    }
    reader.readAsDataURL(file)
    e.target.value = '' // reset so same file can be re-uploaded
  }

  return (
    <>
      {/* Document Header Form */}
      <div className="space-y-2">
        <h3 className="text-xs font-bold text-gray-500 uppercase tracking-wide">ส่วนหัวเอกสาร</h3>
        <div>
          <label className="block text-xs text-gray-600 mb-1">ชื่อโรงเรียน</label>
          <input
            type="text"
            value={settings.schoolName}
            onChange={(e) => onSettingsChange({ schoolName: e.target.value })}
            placeholder="เช่น โรงเรียนตัวอย่าง"
            className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg
              focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          />
        </div>
        {/* School Logo Upload */}
        <div>
          <label className="block text-xs text-gray-600 mb-1">ตราโรงเรียน</label>
          <div className="flex items-center gap-2">
            <input
              ref={logoInputRef}
              type="file"
              accept=".png,.jpg,.jpeg,.svg"
              onChange={handleLogoUpload}
              className="hidden"
            />
            <button
              type="button"
              onClick={() => logoInputRef.current?.click()}
              className="flex items-center gap-1 px-3 py-2 text-xs font-medium text-gray-700
                bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
            >
              <Upload className="w-3.5 h-3.5" />
              {settings.schoolLogo ? 'เปลี่ยนรูป' : 'อัปโหลดตราโรงเรียน'}
            </button>
            {settings.schoolLogo && (
              <>
                <div className="w-10 h-10 rounded border border-gray-200 overflow-hidden bg-white flex items-center justify-center">
                  <img src={settings.schoolLogo} alt="ตราโรงเรียน" className="max-w-full max-h-full object-contain" />
                </div>
                <button
                  type="button"
                  onClick={() => onSettingsChange({ schoolLogo: '' })}
                  className="p-1.5 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50 transition-colors"
                  title="ลบรูปตราโรงเรียน"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </>
            )}
          </div>
          <p className="text-[10px] text-gray-400 mt-1">รองรับ .png, .jpg, .svg</p>
        </div>
        <div>
          <label className="block text-xs text-gray-600 mb-1">ภาคเรียน / ปีการศึกษา</label>
          <div className="flex gap-2">
            <select
              value={settings.semester}
              onChange={(e) => onSettingsChange({ semester: e.target.value })}
              className="flex-1 px-2 py-2 text-sm border border-gray-300 rounded-lg bg-white
                focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            >
              <option value="1">ภาคเรียนที่ 1</option>
              <option value="2">ภาคเรียนที่ 2</option>
              <option value="summer">ภาคเรียนฤดูร้อน</option>
            </select>
            <input
              type="number"
              value={settings.academicYear}
              onChange={(e) => onSettingsChange({ academicYear: parseInt(e.target.value) || 2569 })}
              placeholder="2569"
              className="w-20 px-2 py-2 text-sm border border-gray-300 rounded-lg
                focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="block text-xs text-gray-600 mb-1">ผู้ลงนาม</label>
            <input
              type="text"
              value={settings.signatoryName}
              onChange={(e) => onSettingsChange({ signatoryName: e.target.value })}
              placeholder="เช่น นายสมชาย ใจดี"
              className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg
                focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-600 mb-1">ตำแหน่ง</label>
            <input
              type="text"
              value={settings.signatoryTitle}
              onChange={(e) => onSettingsChange({ signatoryTitle: e.target.value })}
              placeholder="เช่น ผู้อำนวยการโรงเรียน"
              className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg
                focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            />
          </div>
        </div>
      </div>

      {/* Component Toggles — 2-column grid */}
      <div className="space-y-1">
        <h3 className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-1">ส่วนประกอบเอกสาร</h3>
        <div className="grid grid-cols-2 gap-x-3 gap-y-1">
          <ToggleSwitch
            checked={settings.showPeriodTimes}
            onChange={(v) => onSettingsChange({ showPeriodTimes: v })}
            label="ช่วงเวลาคาบ"
          />
          <ToggleSwitch
            checked={settings.showWorkloadSummary}
            onChange={(v) => onSettingsChange({ showWorkloadSummary: v })}
            label="สรุปภาระงาน"
          />
          <ToggleSwitch
            checked={settings.showSignOff}
            onChange={(v) => onSettingsChange({ showSignOff: v })}
            label="บล็อกลงนาม"
          />
          <ToggleSwitch
            checked={settings.showFooter}
            onChange={(v) => onSettingsChange({ showFooter: v })}
            label="วันที่พิมพ์ท้ายกระดาษ"
          />
          <ToggleSwitch
            checked={settings.showQRCode}
            onChange={(v) => onSettingsChange({ showQRCode: v })}
            label="QR ดูตารางสอน"
          />
        </div>
      </div>

      {/* Template Persistence */}
      <div className="space-y-2 pt-2 border-t border-gray-200">
        <h3 className="text-xs font-bold text-gray-500 uppercase tracking-wide">เทมเพลต</h3>
        <div className="flex gap-2">
          <button
            onClick={onSaveTemplate}
            className="flex items-center justify-center gap-1.5 flex-1 py-2
              bg-gray-100 text-gray-700 rounded-lg font-medium text-xs
              hover:bg-gray-200 transition-colors border border-gray-300"
          >
            <Save className="w-3.5 h-3.5" />
            บันทึกเทมเพลต
          </button>
          <button
            onClick={onResetTemplate}
            className="flex items-center justify-center gap-1.5 flex-1 py-2
              bg-gray-100 text-gray-700 rounded-lg font-medium text-xs
              hover:bg-gray-200 transition-colors border border-gray-300"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            รีเซ็ต
          </button>
        </div>
      </div>
    </>
  )
}
