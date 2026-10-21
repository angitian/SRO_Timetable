import { useState, useRef, useCallback, useEffect } from 'react'
import {
  Plus, FolderOpen, Check, AlertCircle, Zap,
  Printer, ShieldCheck, Cloud, Loader2, Trash2,
  History, Download, Rocket,
} from 'lucide-react'
import { useApp } from '../context/AppContext.jsx'
import { formatSnapshotDate } from '../utils/versionManager.js'
import { formatLastSync } from '../utils/cache.js'

const FEATURES = [
  {
    icon: Zap,
    title: 'Auto-Solver',
    desc: 'จัดตารางและล็อกห้องพิเศษ/ครูผู้สอนอัตโนมัติ',
    accent: 'amber',
  },
  {
    icon: Printer,
    title: 'Print Studio',
    desc: 'ส่งออก A4 สวยงาม พร้อม QR Code สแกนดูตาราง',
    accent: 'blue',
  },
  {
    icon: ShieldCheck,
    title: 'Data Privacy',
    desc: 'ประมวลผลบนเบราว์เซอร์ 100% ข้อมูลปลอดภัยบนเครื่องคุณ',
    accent: 'emerald',
  },
]

const ACCENT_STYLES = {
  amber: { icon: 'text-amber-600', bg: 'bg-amber-50', ring: 'ring-amber-100' },
  blue: { icon: 'text-blue-600', bg: 'bg-blue-50', ring: 'ring-blue-100' },
  emerald: { icon: 'text-emerald-600', bg: 'bg-emerald-50', ring: 'ring-emerald-100' },
}

export default function LandingPage() {
  const {
    createNewWorkspace, importSnapshot, selectFixture,
    user, listCloudWorkspaces, loadFromCloud, deleteFromCloud, cloudWorkspaces, cloudSyncing,
    // Workspace snapshots saved in this browser
    snapshots, loadSnapshot, deleteSnapshot, exportSnapshot,
    // Resume last session from IndexedDB cache
    cacheHint, resumeFromCache,
  } = useApp()
  const fileInputRef = useRef(null)
  const [toast, setToast] = useState(null) // { type: 'ok'|'err', msg }
  const [showCloudModal, setShowCloudModal] = useState(false)
  const [cloudLoading, setCloudLoading] = useState(false)
  const [showNewModal, setShowNewModal] = useState(false)
  const [newTitle, setNewTitle] = useState('')

  // Preload the cloud workspace list once when logged in so the landing page
  // can show recent cloud timetables without requiring an extra click.
  useEffect(() => {
    if (user) {
      listCloudWorkspaces().catch(() => {})
    }
  }, [user, listCloudWorkspaces])

  const showToast = useCallback((type, msg) => {
    setToast({ type, msg })
    setTimeout(() => setToast(null), 4000)
  }, [])

  // "สร้างตารางใหม่" opens a small title dialog first — the actual work
  // happens in createNewWorkspace(), which auto-saves the current workspace
  // before resetting, so a second timetable never overwrites the first.
  function handleCreateNew() {
    setNewTitle(`ตารางใหม่ ${new Date().toLocaleDateString('th-TH', { day: 'numeric', month: 'short' })}`)
    setShowNewModal(true)
  }

  function handleConfirmCreate() {
    const result = createNewWorkspace(newTitle)
    setShowNewModal(false)
    if (!result?.ok) {
      showToast('err', result?.error || 'สร้างตารางใหม่ไม่สำเร็จ')
      return
    }
    if (result.savedLabel) {
      showToast('ok', `บันทึก "${result.savedLabel}" ไว้ในรายการงานแล้ว`)
    }
  }

  async function handleFile(file) {
    if (!file) return
    // Quick extension check
    if (!file.name.endsWith('.json')) {
      showToast('err', 'รูปแบบไฟล์ไม่ถูกต้อง กรุณาใช้ไฟล์สำรอง (.json) ของระบบ')
      return
    }
    const result = await importSnapshot(file)
    if (result?.ok) {
      showToast('ok', 'โหลดข้อมูลตารางสำเร็จ')
    } else {
      showToast('err', result?.error || 'รูปแบบไฟล์ไม่ถูกต้อง กรุณาใช้ไฟล์สำรอง (.json) ของระบบ')
    }
  }

  async function handleFileChange(e) {
    const file = e.target.files?.[0]
    if (file) await handleFile(file)
    e.target.value = ''
  }

  function handleLoadDemo() {
    selectFixture('primary_mock')
    showToast('ok', 'กำลังโหลดข้อมูลตัวอย่าง...')
  }

  function handleDownloadTemplate() {
    window.open('/samples/ตัวอย่างข้อมูลการเรียน.xlsx', '_blank')
  }

  async function handleOpenCloud() {
    if (!user) {
      showToast('err', 'กรุณาเข้าสู่ระบบเพื่อเปิดตารางจากคลาวด์')
      return
    }
    setShowCloudModal(true)
    setCloudLoading(true)
    try {
      await listCloudWorkspaces()
    } catch (e) {
      showToast('err', 'โหลดรายการตารางไม่สำเร็จ')
    } finally {
      setCloudLoading(false)
    }
  }

  async function handleLoadCloudWorkspace(id) {
    const result = await loadFromCloud(id)
    if (result.ok) {
      setShowCloudModal(false)
      showToast('ok', 'โหลดตารางจากคลาวด์แล้ว')
    } else {
      showToast('err', result.error || 'โหลดไม่สำเร็จ')
    }
  }

  async function handleDeleteCloudWorkspace(id, title) {
    if (!confirm(`ยืนยันการลบ "${title}" จากคลาวด์?`)) return
    const result = await deleteFromCloud(id)
    if (result.ok) {
      showToast('ok', `ลบ "${title}" แล้ว`)
    } else {
      showToast('err', result.error || 'ลบไม่สำเร็จ')
    }
  }

  // ── Resume last session from IndexedDB cache ─────────────────────────
  async function handleResume() {
    if (!cacheHint) return
    const result = await resumeFromCache(cacheHint.cacheKey)
    if (result.ok) {
      showToast('ok', 'โหลดงานล่าสุดแล้ว')
    } else {
      showToast('err', result.error || 'โหลดงานล่าสุดไม่สำเร็จ')
    }
  }

  // ── Local workspace snapshot actions ─────────────────────────────────
  function handleOpenSnapshot(id) {
    const result = loadSnapshot(id)
    if (result.ok) {
      showToast('ok', 'เปิดงานแล้ว')
    } else {
      showToast('err', result.error || 'เปิดไม่สำเร็จ')
    }
  }

  function handleExportSnapshot(id) {
    exportSnapshot(id)
    showToast('ok', 'ดาวน์โหลดไฟล์ .json สำรองแล้ว')
  }

  function handleDeleteSnapshot(id, label) {
    if (!confirm(`ยืนยันการลบ "${label}"?`)) return
    const ok = deleteSnapshot(id)
    if (ok) {
      showToast('ok', `ลบ "${label}" แล้ว`)
    } else {
      showToast('err', 'ลบไม่สำเร็จ')
    }
  }

  // Merge local workspace snapshots + cloud workspaces into ONE list sorted
  // by last-modified — the user sees "งาน/ตารางของฉัน" regardless of where
  // each timetable is stored.
  const localItems = snapshots.map((s) => ({
    type: 'local',
    id: s.id,
    title: s.label,
    status: s.status,
    updatedAt: s.updatedAt || 0,
    counts: s.counts,
  }))
  const cloudItems = (user ? cloudWorkspaces : []).map((w) => ({
    type: 'cloud',
    id: w.id,
    title: w.title,
    updatedAt: w.updated_at ? new Date(w.updated_at).getTime() : 0,
    academic_year: w.academic_year,
    term: w.term,
  }))
  const allItems = [...localItems, ...cloudItems].sort((a, b) => b.updatedAt - a.updatedAt)
  // Show the "ทำงานต่อ" card only when the cache is newer than every saved
  // workspace — otherwise the newest workspace card already covers it.
  const showResumeCard = Boolean(cacheHint) &&
    (allItems.length === 0 || cacheHint.lastCachedAt > Math.max(...allItems.map((i) => i.updatedAt)))
  const hasRecent = showResumeCard || allItems.length > 0

  return (
    <div className="min-h-[calc(100vh-3.5rem)] bg-gradient-to-br from-blue-50 via-white to-indigo-50 flex flex-col">

      <div className="w-full max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-6 flex-1 flex flex-col justify-center">
        {/* ── Hero Title Section ─────────────────────────────────────── */}
        <div className="text-center">
          <h1 className="text-3xl md:text-4xl font-extrabold text-slate-800 tracking-tight mb-3">
            ระบบจัดตารางสอนอัตโนมัติ
          </h1>
          <p className="text-base md:text-lg text-slate-600 max-w-2xl mx-auto leading-normal mb-8">
            จัดตารางรวดเร็ว ตรวจจับคาบชนอัตโนมัติ ส่งออกเอกสาร A4 พร้อมพิมพ์ และเปิดดูออนไลน์ผ่าน QR Code
          </p>
        </div>

        {/* ── Main Actions ───────────────────────────────────────────── */}
        <div className="w-full max-w-4xl mx-auto border-2 border-dashed border-slate-300 hover:border-slate-400 rounded-2xl p-8 bg-slate-50/50 my-4 transition-all">
          <div className="flex flex-wrap items-center justify-center gap-3 sm:gap-4">
            {/* Primary: Create new */}
            <button
              onClick={handleCreateNew}
              className="flex items-center gap-2 px-6 py-3.5 text-base font-semibold rounded-xl shadow-sm bg-blue-600 text-white hover:bg-blue-700 transition-all whitespace-nowrap"
            >
              <Plus className="w-5 h-5 flex-shrink-0" />
              สร้างตารางใหม่
            </button>

            {/* Secondary: Open from cloud (requires login) */}
            <button
              onClick={handleOpenCloud}
              className={`flex items-center gap-2 px-6 py-3.5 text-base font-semibold rounded-xl shadow-sm transition-all whitespace-nowrap
                ${user
                  ? 'bg-violet-600 text-white hover:bg-violet-700'
                  : 'bg-white text-slate-400 border border-slate-200 cursor-not-allowed'}`}
              title={user ? 'เปิดตารางที่บันทึกไว้บนคลาวด์' : 'เข้าสู่ระบบเพื่อใช้งาน'}
            >
              <Cloud className="w-5 h-5 flex-shrink-0" />
              เปิดจากคลาวด์
            </button>
          </div>

          {/* Hint text */}
          <p className="mt-4 text-center text-sm text-slate-500">
            งานทั้งหมดถูกบันทึกอัตโนมัติ — เลือกเปิดงานเก่าได้จากรายการ &quot;งาน/ตารางของฉัน&quot; ด้านล่าง
          </p>
        </div>

        {/* ── Help Links ─────────────────────────────────────────────── */}
        <p className="text-sm text-slate-600 mt-4 mb-8 text-center">
          ยังไม่มีไฟล์?
          <button
            onClick={handleLoadDemo}
            className="text-blue-600 font-medium hover:underline mx-1"
          >
            ทดลองข้อมูลตัวอย่าง
          </button>
          หรือ
          <button
            onClick={handleDownloadTemplate}
            className="text-blue-600 font-medium hover:underline mx-1"
          >
            ดาวน์โหลดไฟล์ตัวอย่าง Excel
          </button>
        </p>

        {/* ── My Workspaces (งาน/ตารางของฉัน) ────────────────────────── */}
        {hasRecent && (
          <div className="w-full max-w-4xl mx-auto mb-6">
            <h2 className="text-lg font-bold text-slate-800 mb-3 flex items-center gap-2">
              <History className="w-5 h-5 text-slate-500" />
              งาน/ตารางของฉัน
            </h2>
            <div className="space-y-3">
              {/* Resume card — shown only when the cache is newer than every
                  saved workspace */}
              {showResumeCard && (
                <div className="flex items-center gap-3 p-4 rounded-xl border border-blue-200 bg-blue-50/70">
                  <div className="w-10 h-10 rounded-lg bg-blue-100 flex items-center justify-center shrink-0">
                    <Rocket className="w-5 h-5 text-blue-600" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-semibold text-blue-900">
                      คุณมีงานที่ทำค้างไว้ล่าสุด
                    </div>
                    <div className="text-xs text-blue-600">
                      แก้ไขล่าสุด {formatLastSync(cacheHint.lastCachedAt)}
                    </div>
                  </div>
                  <button
                    onClick={handleResume}
                    className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-bold
                      bg-blue-600 text-white hover:bg-blue-700 transition-colors shadow-sm whitespace-nowrap"
                  >
                    <Rocket className="w-4 h-4" />
                    ทำงานต่อทันที
                  </button>
                </div>
              )}

              {/* One unified workspace list — local + cloud, newest first */}
              <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
                <div className="px-4 py-2.5 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
                  <span className="text-xs font-bold text-slate-500">
                    {allItems.length} งาน
                  </span>
                  <span className="text-[10px] text-slate-400">
                    💻 เก็บในเบราว์เซอร์นี้ · ☁️ = บนคลาวด์
                  </span>
                </div>
                <ul className="divide-y divide-slate-100">
                  {allItems.map((item) => (
                    <li key={`${item.type}-${item.id}`} className="flex items-center gap-2 px-4 py-2.5 hover:bg-slate-50/60 transition-colors">
                      <button
                        onClick={() => (item.type === 'local'
                          ? handleOpenSnapshot(item.id)
                          : handleLoadCloudWorkspace(item.id))}
                        disabled={item.type === 'cloud' && cloudSyncing}
                        className="flex-1 text-left min-w-0"
                        title={`เปิด "${item.title}"`}
                      >
                        <div className="flex items-center gap-2">
                          {item.type === 'cloud' && (
                            <Cloud className="w-3.5 h-3.5 text-violet-500 shrink-0" />
                          )}
                          <span className="text-sm font-semibold text-slate-800 truncate">{item.title}</span>
                          {item.type === 'local' && (
                            <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium shrink-0
                              ${item.status === 'final' ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'}`}>
                              {item.status === 'final' ? 'สมบูรณ์' : 'ร่าง'}
                            </span>
                          )}
                        </div>
                        <div className="text-xs text-slate-400 mt-0.5">
                          {item.type === 'local'
                            ? formatSnapshotDate(item.updatedAt)
                            : item.updatedAt
                              ? new Date(item.updatedAt).toLocaleDateString('th-TH', {
                                  day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
                                })
                              : '—'}
                          {item.type === 'local' && item.counts?.teachers > 0 && (
                            <span> · ครู {item.counts.teachers} · ห้อง {item.counts.classes} · วิชา {item.counts.subjects}</span>
                          )}
                          {item.type === 'cloud' && ` · ปีการศึกษา ${item.academic_year}/${item.term}`}
                        </div>
                      </button>
                      {item.type === 'local' && (
                        <button
                          onClick={() => handleExportSnapshot(item.id)}
                          className="p-2 rounded-lg text-slate-400 hover:text-blue-600 hover:bg-blue-50 transition-colors shrink-0"
                          title="ส่งออกไฟล์ .json สำรอง"
                        >
                          <Download className="w-4 h-4" />
                        </button>
                      )}
                      <button
                        onClick={() => (item.type === 'local'
                          ? handleDeleteSnapshot(item.id, item.title)
                          : handleDeleteCloudWorkspace(item.id, item.title))}
                        disabled={item.type === 'cloud' && cloudSyncing}
                        className="p-2 rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50 transition-colors shrink-0"
                        title={item.type === 'local' ? 'ลบงานนี้' : 'ลบจากคลาวด์'}
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        )}

        {/* ── Backup (.json) — secondary ─────────────────────────────── */}
        <div className="w-full max-w-4xl mx-auto mb-10">
          <input
            ref={fileInputRef}
            type="file"
            accept=".json,application/json"
            onChange={handleFileChange}
            className="hidden"
          />
          <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50/50 px-4 py-3 flex flex-wrap items-center gap-3">
            <FolderOpen className="w-4 h-4 text-slate-400 shrink-0" />
            <div className="flex-1 min-w-[200px]">
              <div className="text-xs font-semibold text-slate-600">ข้อมูลสำรอง (.json)</div>
              <div className="text-[11px] text-slate-400">
                สำหรับสำรองงานไว้ภายนอกหรือย้ายไปเครื่องอื่น — ปกติไม่จำเป็นต้องใช้ ระบบบันทึกอัตโนมัติ
              </div>
            </div>
            <button
              onClick={() => fileInputRef.current?.click()}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-white border border-slate-300 text-slate-600 hover:bg-slate-100 transition-colors"
            >
              <FolderOpen className="w-3.5 h-3.5" />
              นำเข้าไฟล์สำรอง (.json)
            </button>
          </div>
        </div>

        {/* ── Feature Highlight Grid ─────────────────────────────────── */}
        <div className="w-full max-w-4xl mx-auto grid grid-cols-1 md:grid-cols-3 gap-5 mb-10">
          {FEATURES.map((f) => {
            const Icon = f.icon
            const s = ACCENT_STYLES[f.accent]
            return (
              <div
                key={f.title}
                className="p-5 rounded-xl border border-slate-200 bg-white shadow-sm text-left hover:shadow-md transition-all"
              >
                <div className={`w-10 h-10 rounded-lg ${s.bg} ${s.ring} ring-1 flex items-center justify-center mb-3`}>
                  <Icon className={`w-5 h-5 ${s.icon}`} />
                </div>
                <h3 className="text-base font-bold text-slate-800 mb-1">
                  {f.title}
                </h3>
                <p className="text-sm text-slate-600 leading-relaxed">{f.desc}</p>
              </div>
            )
          })}
        </div>

        {/* ── Footer ─────────────────────────────────────────────────── */}
        <footer className="w-full py-4 text-center text-xs text-slate-500 border-t border-slate-100 bg-white">
          <p>
            © 2026 SRO Timetable. Developed by{' '}
            <span className="font-semibold text-slate-700">One Man Lab</span>{' '}
            for{' '}
            <a
              href="https://kru-platform.com"
              target="_blank"
              rel="noreferrer"
              className="font-semibold text-slate-700 hover:text-blue-600 underline decoration-slate-300"
            >
              KRU Platform
            </a>
          </p>
        </footer>
      </div>

      {/* Toast */}
      {toast && (
        <div className={`fixed bottom-8 left-1/2 -translate-x-1/2 z-[110] px-6 py-3.5
          rounded-xl shadow-lg text-base font-medium flex items-center gap-2.5
          ${toast.type === 'ok' ? 'bg-green-600 text-white' : 'bg-red-600 text-white'}`}>
          {toast.type === 'ok'
            ? <Check className="w-5 h-5" />
            : <AlertCircle className="w-5 h-5" />}
          {toast.msg}
        </div>
      )}

      {/* ── New Workspace Modal ───────────────────────────────────────── */}
      {showNewModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center">
          <div className="absolute inset-0 bg-black/40" onClick={() => setShowNewModal(false)} />
          <div className="relative bg-white rounded-2xl shadow-2xl p-6 max-w-sm w-full mx-4">
            <h3 className="text-lg font-bold text-gray-900 mb-1 flex items-center gap-2">
              <Plus className="w-5 h-5 text-blue-600" />
              สร้างตารางใหม่
            </h3>
            <p className="text-xs text-gray-500 mb-4">
              ตั้งชื่องานนี้ — งานเก่าทั้งหมดจะถูกเก็บไว้ในรายการ &quot;งาน/ตารางของฉัน&quot; ไม่ถูกลบหรือเขียนทับ
            </p>
            <input
              type="text"
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleConfirmCreate() }}
              placeholder="เช่น ตารางภาคเรียนที่ 1/2569"
              className="w-full px-3 py-2.5 rounded-xl border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 mb-4"
              autoFocus
            />
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setShowNewModal(false)}
                className="px-4 py-2 rounded-lg text-sm font-semibold text-slate-600 hover:bg-slate-100 transition-colors"
              >
                ยกเลิก
              </button>
              <button
                onClick={handleConfirmCreate}
                className="px-5 py-2 rounded-lg text-sm font-bold bg-blue-600 text-white hover:bg-blue-700 transition-colors"
              >
                สร้างตาราง
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Cloud Workspace Modal ─────────────────────────────────────── */}
      {showCloudModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center">
          <div className="absolute inset-0 bg-black/40" onClick={() => setShowCloudModal(false)} />
          <div className="relative bg-white rounded-2xl shadow-2xl p-6 max-w-lg w-full mx-4 max-h-[80vh] flex flex-col">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold text-gray-900 flex items-center gap-2">
                <Cloud className="w-5 h-5 text-violet-600" />
                ตารางบนคลาวด์
              </h3>
              <button
                onClick={() => setShowCloudModal(false)}
                className="text-gray-400 hover:text-gray-600 text-xl"
              >
                ✕
              </button>
            </div>

            {cloudLoading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="w-8 h-8 text-violet-500 animate-spin" />
              </div>
            ) : cloudWorkspaces.length === 0 ? (
              <div className="text-center py-12 text-gray-400">
                <Cloud className="w-12 h-12 mx-auto mb-3 opacity-40" />
                <p className="text-sm">ยังไม่มีตารางบนคลาวด์</p>
                <p className="text-xs mt-1">บันทึกจากหน้าตารางสอน (step 5) เพื่อเก็บขึ้นคลาวด์</p>
              </div>
            ) : (
              <div className="overflow-y-auto flex-1 space-y-2">
                {cloudWorkspaces.map((ws) => (
                  <div
                    key={ws.id}
                    className="flex items-center gap-3 p-3 rounded-xl border border-gray-200 hover:border-violet-300 hover:bg-violet-50/30 transition-colors"
                  >
                    <button
                      onClick={() => handleLoadCloudWorkspace(ws.id)}
                      disabled={cloudSyncing}
                      className="flex-1 text-left min-w-0"
                    >
                      <div className="text-sm font-semibold text-gray-800 truncate">
                        {ws.title}
                      </div>
                      <div className="text-xs text-gray-400 mt-0.5">
                        {ws.updated_at
                          ? new Date(ws.updated_at).toLocaleDateString('th-TH', {
                              day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
                            })
                          : '—'}
                        {' · '}
                        ปีการศึกษา {ws.academic_year}/{ws.term}
                      </div>
                    </button>
                    <button
                      onClick={() => handleDeleteCloudWorkspace(ws.id, ws.title)}
                      className="p-1.5 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50 transition-colors shrink-0"
                      title="ลบจากคลาวด์"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
