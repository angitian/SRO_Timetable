import { useState, useRef, useCallback } from 'react'
import {
  FolderOpen,
  ChevronDown,
  Save,
  Trash2,
  Upload,
  Download,
  Check,
  Plus,
  AlertCircle,
} from 'lucide-react'
import { useApp } from '../../context/AppContext.jsx'
import { formatSnapshotDate, generateLabel } from '../../utils/versionManager.js'

/**
 * VersionBar — top toolbar for the TimetableView workspace.
 *
 * Left:  VersionDropdown (📁 ตารางเทอม 1/2569 (ร่าง v1.2) ▼)
 * Right: Import / Export JSON buttons (part of the save system)
 */
export default function VersionBar() {
  const {
    snapshots,
    activeSnapshotId,
    activeSnapshotLabel,
    isSnapshotDirty,
    lastSnapshotSaveAt,
    saveSnapshot,
    loadSnapshot,
    deleteSnapshot,
    exportSnapshot,
    importSnapshot,
  } = useApp()

  const [dropdownOpen, setDropdownOpen] = useState(false)
  const [showSaveDialog, setShowSaveDialog] = useState(false)
  const [saveLabel, setSaveLabel] = useState('')
  const [toast, setToast] = useState(null) // { type: 'ok'|'err', msg }
  const fileInputRef = useRef(null)

  const showToast = useCallback((type, msg) => {
    setToast({ type, msg })
    setTimeout(() => setToast(null), 3000)
  }, [])

  function handleSaveNew() {
    const label = saveLabel.trim() || generateLabel(snapshots.length)
    const result = saveSnapshot(label)
    if (result.ok) {
      showToast('ok', `บันทึก "${label}" แล้ว`)
    } else {
      showToast('err', result.error || 'บันทึกไม่สำเร็จ')
    }
    setShowSaveDialog(false)
    setSaveLabel('')
  }

  function handleSaveCurrent() {
    if (!activeSnapshotId) {
      setShowSaveDialog(true)
      return
    }
    const result = saveSnapshot(activeSnapshotLabel, { updateExisting: true })
    if (result.ok) {
      showToast('ok', 'บันทึกการเปลี่ยนแปลงแล้ว')
    } else {
      showToast('err', result.error || 'บันทึกไม่สำเร็จ')
    }
  }

  function handleLoad(id) {
    const result = loadSnapshot(id)
    if (result.ok) {
      showToast('ok', 'โหลดเวอร์ชันแล้ว')
    } else {
      showToast('err', result.error || 'โหลดไม่สำเร็จ')
    }
    setDropdownOpen(false)
  }

  function handleDelete(id, label) {
    if (!confirm(`ยืนยันการลบ "${label}"?`)) return
    const ok = deleteSnapshot(id)
    if (ok) {
      showToast('ok', `ลบ "${label}" แล้ว`)
    } else {
      showToast('err', 'ลบไม่สำเร็จ')
    }
  }

  function handleExport() {
    exportSnapshot(activeSnapshotId)
    showToast('ok', 'ดาวน์โหลดไฟล์ .json แล้ว')
  }

  async function handleImportClick(e) {
    const file = e.target.files?.[0]
    if (!file) return
    const result = await importSnapshot(file)
    if (result.ok) {
      showToast('ok', `นำเข้า "${file.name}" แล้ว`)
    } else {
      showToast('err', result.error || 'นำเข้าไม่สำเร็จ')
    }
    // Reset input so same file can be re-selected
    e.target.value = ''
  }

  const dirtyIndicator = isSnapshotDirty ? '●' : '✓'
  const dirtyColor = isSnapshotDirty ? 'text-amber-500' : 'text-green-500'
  const dirtyText = isSnapshotDirty
    ? 'ยังไม่ได้บันทึก'
    : lastSnapshotSaveAt
      ? `บันทึกล่าสุด ${formatSnapshotDate(lastSnapshotSaveAt)}`
      : 'พร้อมใช้งาน'

  return (
    <>
      <div className="flex items-center justify-between gap-3 flex-wrap">
        {/* ── Left: Version Dropdown ──────────────────────────────── */}
        <div className="flex items-center gap-2">
          <div className="relative">
            <button
              onClick={() => setDropdownOpen(!dropdownOpen)}
              className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold
                bg-white border border-gray-300 hover:border-gray-400 hover:bg-gray-50
                transition-colors min-w-[220px]"
            >
              <FolderOpen className="w-4 h-4 text-blue-600 shrink-0" />
              <span className="truncate flex-1 text-left">
                {activeSnapshotLabel || '— ยังไม่ได้บันทึก —'}
              </span>
              <span className={`text-xs ${dirtyColor} shrink-0`} title={dirtyText}>
                {dirtyIndicator}
              </span>
              <ChevronDown
                className={`w-3.5 h-3.5 text-gray-500 transition-transform shrink-0
                  ${dropdownOpen ? 'rotate-180' : ''}`}
              />
            </button>

            {dropdownOpen && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setDropdownOpen(false)} />
                <div className="absolute left-0 top-full mt-1 z-50 w-96 bg-white rounded-xl
                  shadow-xl border border-gray-200 overflow-hidden">
                  {/* Header */}
                  <div className="px-4 py-3 border-b border-gray-100 bg-gray-50">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-gray-500 uppercase tracking-wide">
                        เวอร์ชันที่บันทึกไว้
                      </span>
                      <span className="text-xs text-gray-400">{snapshots.length} รายการ</span>
                    </div>
                  </div>

                  {/* List */}
                  <div className="max-h-80 overflow-y-auto">
                    {snapshots.length === 0 ? (
                      <div className="px-4 py-8 text-center text-sm text-gray-400">
                        ยังไม่มีเวอร์ชันที่บันทึกไว้
                        <br />
                        กด "บันทึกเวอร์ชันใหม่" เพื่อเริ่ม
                      </div>
                    ) : (
                      snapshots.map((snap) => (
                        <div
                          key={snap.id}
                          className={`flex items-center gap-2 px-4 py-3 border-t border-gray-50
                            first:border-t-0 transition-colors
                            ${snap.id === activeSnapshotId ? 'bg-blue-50' : 'hover:bg-gray-50'}`}
                        >
                          <button
                            onClick={() => handleLoad(snap.id)}
                            className="flex-1 text-left min-w-0"
                          >
                            <div className="flex items-center gap-2">
                              <span className="text-sm font-semibold text-gray-800 truncate">
                                {snap.label}
                              </span>
                              {snap.id === activeSnapshotId && (
                                <Check className="w-3.5 h-3.5 text-blue-600 shrink-0" />
                              )}
                              <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium shrink-0
                                ${snap.status === 'final'
                                  ? 'bg-green-100 text-green-700'
                                  : 'bg-amber-100 text-amber-700'}`}>
                                {snap.status === 'final' ? 'สมบูรณ์' : 'ร่าง'}
                              </span>
                            </div>
                            <div className="text-xs text-gray-400 mt-0.5">
                              {formatSnapshotDate(snap.updatedAt)}
                              {snap.solverPreset && ` · ${snap.solverPreset}`}
                            </div>
                          </button>
                          <button
                            onClick={(e) => { e.stopPropagation(); handleDelete(snap.id, snap.label) }}
                            className="p-1.5 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50
                              transition-colors shrink-0"
                            title="ลบเวอร์ชันนี้"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      ))
                    )}
                  </div>

                  {/* Footer actions */}
                  <div className="border-t border-gray-100 p-2 flex gap-2">
                    <button
                      onClick={() => { setShowSaveDialog(true); setDropdownOpen(false) }}
                      className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2
                        rounded-lg text-sm font-semibold bg-blue-600 text-white hover:bg-blue-700
                        transition-colors"
                    >
                      <Plus className="w-4 h-4" />
                      บันทึกเวอร์ชันใหม่
                    </button>
                    {activeSnapshotId && (
                      <button
                        onClick={() => { handleSaveCurrent(); setDropdownOpen(false) }}
                        className="flex items-center justify-center gap-1.5 px-3 py-2
                          rounded-lg text-sm font-semibold bg-gray-100 text-gray-700
                          hover:bg-gray-200 transition-colors"
                        title="บันทึกทับเวอร์ชันปัจจุบัน"
                      >
                        <Save className="w-4 h-4" />
                        บันทึกทับ
                      </button>
                    )}
                  </div>
                </div>
              </>
            )}
          </div>

          {/* Save status text */}
          <span className={`text-xs ${dirtyColor} hidden sm:inline`}>
            {dirtyText}
          </span>

          {/* ── Visible Save buttons (always accessible) ─────────────── */}
          <div className="flex items-center gap-1.5">
            {/* Save (overwrite current) — only when active snapshot exists */}
            {activeSnapshotId && (
              <button
                onClick={handleSaveCurrent}
                disabled={!isSnapshotDirty}
                className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-bold
                  transition-colors shadow-sm
                  ${isSnapshotDirty
                    ? 'bg-green-600 text-white hover:bg-green-700'
                    : 'bg-gray-100 text-gray-400 cursor-not-allowed'}`}
                title={isSnapshotDirty
                  ? 'บันทึกทับเวอร์ชันปัจจุบัน'
                  : 'ไม่มีการเปลี่ยนแปลงที่ต้องบันทึก'}
              >
                <Save className="w-4 h-4" />
                <span className="hidden sm:inline">บันทึก</span>
              </button>
            )}
            {/* Save as new — always available */}
            <button
              onClick={() => setShowSaveDialog(true)}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-bold
                bg-blue-600 text-white hover:bg-blue-700 transition-colors shadow-sm"
              title="บันทึกเป็นเวอร์ชันใหม่"
            >
              <Plus className="w-4 h-4" />
              <span className="hidden sm:inline">บันทึกใหม่</span>
            </button>
          </div>
        </div>

        {/* ── Right: Import / Export JSON ─────────────────────────── */}
        <div className="flex items-center gap-2">
          <input
            ref={fileInputRef}
            type="file"
            accept=".json,application/json"
            onChange={handleImportClick}
            className="hidden"
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium
              text-gray-700 bg-white border border-gray-300 hover:bg-gray-50
              transition-colors"
            title="นำเข้าไฟล์ .json (สำรอง/กู้คืน)"
          >
            <Upload className="w-4 h-4" />
            <span className="hidden sm:inline">นำเข้า .json</span>
          </button>
          <button
            onClick={handleExport}
            disabled={!activeSnapshotId && !snapshots.length}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium
              text-gray-700 bg-white border border-gray-300 hover:bg-gray-50
              transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            title="ส่งออกไฟล์ .json (สำรองข้อมูล)"
          >
            <Download className="w-4 h-4" />
            <span className="hidden sm:inline">ส่งออก .json</span>
          </button>
        </div>
      </div>

      {/* ── Save New Snapshot Dialog ──────────────────────────────── */}
      {showSaveDialog && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center">
          <div className="absolute inset-0 bg-black/40" onClick={() => setShowSaveDialog(false)} />
          <div className="relative bg-white rounded-2xl shadow-2xl p-6 max-w-sm w-full mx-4">
            <h3 className="text-lg font-bold text-gray-900 mb-3">บันทึกเวอร์ชันใหม่</h3>
            <input
              type="text"
              value={saveLabel}
              onChange={(e) => setSaveLabel(e.target.value)}
              placeholder={generateLabel(snapshots.length)}
              autoFocus
              onKeyDown={(e) => { if (e.key === 'Enter') handleSaveNew() }}
              className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg
                focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            />
            <div className="flex gap-3 mt-5">
              <button
                onClick={() => setShowSaveDialog(false)}
                className="flex-1 px-4 py-2.5 text-sm font-medium text-gray-700 bg-gray-100
                  hover:bg-gray-200 rounded-xl transition-colors"
              >
                ยกเลิก
              </button>
              <button
                onClick={handleSaveNew}
                className="flex-1 px-4 py-2.5 text-sm font-bold text-white bg-blue-600
                  hover:bg-blue-700 rounded-xl transition-colors"
              >
                บันทึก
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Toast ─────────────────────────────────────────────────── */}
      {toast && (
        <div className={`fixed bottom-20 left-1/2 -translate-x-1/2 z-[110] px-4 py-2.5
          rounded-xl shadow-lg text-sm font-medium flex items-center gap-2
          ${toast.type === 'ok' ? 'bg-green-600 text-white' : 'bg-red-600 text-white'}`}>
          {toast.type === 'ok'
            ? <Check className="w-4 h-4" />
            : <AlertCircle className="w-4 h-4" />}
          {toast.msg}
        </div>
      )}
    </>
  )
}
