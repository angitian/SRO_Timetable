import { useState, useRef, useCallback } from 'react'
import { Plus, FolderOpen, Check, AlertCircle } from 'lucide-react'
import { useApp } from '../context/AppContext.jsx'

export default function LandingPage() {
  const { setStep, setFixtureDataDirect, importSnapshot } = useApp()
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

  return (
    <div
      className="min-h-[calc(100vh-3.5rem)] flex items-center justify-center bg-gradient-to-br from-blue-50 via-white to-indigo-50"
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <div className="text-center">
        {/* Drag overlay */}
        {isDragOver && (
          <div className="fixed inset-0 z-50 bg-blue-50/80 backdrop-blur-sm flex items-center justify-center pointer-events-none">
            <div className="border-4 border-dashed border-blue-400 rounded-3xl px-12 py-16 bg-white/90">
              <FolderOpen className="w-16 h-16 text-blue-500 mx-auto mb-4" />
              <p className="text-2xl font-bold text-blue-700">วางไฟล์ .json ที่นี่</p>
            </div>
          </div>
        )}

        <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
          {/* Primary: Create new */}
          <button
            onClick={handleCreateNew}
            className="flex items-center gap-3 px-12 py-6 rounded-2xl bg-blue-600 text-white text-2xl font-bold hover:bg-blue-700 transition-all shadow-xl hover:shadow-2xl hover:-translate-y-0.5"
          >
            <Plus className="w-8 h-8" />
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
            className="flex items-center gap-3 px-12 py-6 rounded-2xl bg-white text-gray-700 text-2xl font-bold border border-gray-300 hover:bg-gray-50 hover:border-gray-400 transition-all shadow-lg hover:shadow-xl hover:-translate-y-0.5"
          >
            <FolderOpen className="w-8 h-8 text-gray-500" />
            เปิดไฟล์ตารางเดิม (.json)
          </button>
        </div>

        {/* Hint text */}
        <p className="mt-6 text-sm text-gray-400">
          ลากไฟล์ .json มาวางที่หน้านี้ หรือกดปุ่มด้านบนเพื่อเลือกไฟล์
        </p>
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
