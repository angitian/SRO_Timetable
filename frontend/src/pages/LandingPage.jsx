import { useState, useRef, useCallback } from 'react'
import {
  Plus, FolderOpen, Check, AlertCircle, Zap,
  Printer, ShieldCheck,
} from 'lucide-react'
import { useApp } from '../context/AppContext.jsx'
import { BASE_URL } from '../api/config.js'

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
  const { setStep, setFixtureDataDirect, importSnapshot, selectFixture } = useApp()
  const fileInputRef = useRef(null)
  const [toast, setToast] = useState(null) // { type: 'ok'|'err', msg }
  const [isDragOver, setIsDragOver] = useState(false)

  const showToast = useCallback((type, msg) => {
    setToast({ type, msg })
    setTimeout(() => setToast(null), 4000)
  }, [])

  function handleCreateNew() {
    setFixtureDataDirect({
      teachers: [],
      rooms: [],
      subjects: [],
      classes: [],
      lesson_blocks: [],
      fixed_slots: [],
      schedule_blocks: [],
      special_activities: [],
      schedule_config: {
        days_per_week: 5,
        periods_per_day: 8,
        lunch_periods: [4],
        assembly_slots: [],
        max_consecutive_teaching: 4,
        pe_hot_periods: [],
      },
      solver_time_limit_seconds: 5.0,
    })
    setStep(1)
  }

  async function handleFile(file) {
    if (!file) return
    // Quick extension check
    if (!file.name.endsWith('.json')) {
      showToast('err', 'รูปแบบไฟล์ไม่ถูกต้อง กรุณาใช้ไฟล์ Snapshot (.json) ของระบบ')
      return
    }
    const result = await importSnapshot(file)
    if (result?.ok) {
      showToast('ok', 'โหลดข้อมูลตารางสำเร็จ')
    } else {
      showToast('err', result?.error || 'รูปแบบไฟล์ไม่ถูกต้อง กรุณาใช้ไฟล์ Snapshot (.json) ของระบบ')
    }
  }

  async function handleFileChange(e) {
    const file = e.target.files?.[0]
    if (file) await handleFile(file)
    e.target.value = ''
  }

  function handleDragOver(e) {
    e.preventDefault()
    setIsDragOver(true)
  }

  function handleDragLeave(e) {
    e.preventDefault()
    setIsDragOver(false)
  }

  async function handleDrop(e) {
    e.preventDefault()
    setIsDragOver(false)
    const file = e.dataTransfer.files?.[0]
    if (file) await handleFile(file)
  }

  function handleLoadDemo() {
    selectFixture('primary_mock')
    showToast('ok', 'กำลังโหลดข้อมูลตัวอย่าง...')
  }

  function handleDownloadTemplate() {
    window.open(`${BASE_URL}/api/import/excel/template`, '_blank')
  }

  return (
    <div
      className="min-h-[calc(100vh-3.5rem)] bg-gradient-to-br from-blue-50 via-white to-indigo-50 flex flex-col"
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* Drag overlay */}
      {isDragOver && (
        <div className="fixed inset-0 z-50 bg-blue-50/80 backdrop-blur-sm flex items-center justify-center pointer-events-none">
          <div className="border-4 border-dashed border-blue-400 rounded-3xl px-12 py-16 bg-white/90">
            <FolderOpen className="w-16 h-16 text-blue-500 mx-auto mb-4" />
            <p className="text-2xl font-bold text-blue-700">วางไฟล์ .json ที่นี่</p>
          </div>
        </div>
      )}

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

        {/* ── Actions & Drag-Drop Area ───────────────────────────────── */}
        <div
          className={`w-full max-w-2xl mx-auto border-2 border-dashed rounded-2xl p-8 bg-slate-50/50 my-4 transition-all
            ${isDragOver
              ? 'border-blue-500 bg-blue-50/80 scale-[1.01]'
              : 'border-slate-300 hover:border-slate-400'
            }`}
        >
          <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
            {/* Primary: Create new */}
            <button
              onClick={handleCreateNew}
              className="flex items-center gap-2 px-6 py-3.5 text-base font-semibold rounded-xl shadow-sm bg-blue-600 text-white hover:bg-blue-700 transition-all"
            >
              <Plus className="w-5 h-5" />
              สร้างตารางสอน
            </button>

            {/* Secondary: Open existing .json */}
            <input
              ref={fileInputRef}
              type="file"
              accept=".json,application/json"
              onChange={handleFileChange}
              className="hidden"
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              className="flex items-center gap-2 px-6 py-3.5 text-base font-semibold rounded-xl shadow-sm bg-white text-slate-700 border border-slate-300 hover:bg-slate-50 transition-all"
            >
              <FolderOpen className="w-5 h-5 text-slate-500" />
              เปิดไฟล์ตารางเดิม (.json)
            </button>
          </div>

          {/* Hint text */}
          <p className="mt-4 text-center text-sm text-slate-500">
            ลากไฟล์ .json มาวางที่หน้านี้ หรือกดปุ่มด้านบนเพื่อเลือกไฟล์
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
            ดาวน์โหลด Template Excel
          </button>
        </p>

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
    </div>
  )
}
