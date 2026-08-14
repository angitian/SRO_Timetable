import { Rocket, Loader2 } from 'lucide-react'
import { useApp } from '../../context/AppContext.jsx'

export default function GenerateButton() {
  const { isGenerating, runSolver, result, error } = useApp()

  return (
    <div className="flex flex-col items-center gap-3">
      <button
        onClick={runSolver}
        disabled={isGenerating}
        className="btn-primary flex items-center gap-2 text-lg px-8 py-4"
      >
        {isGenerating ? (
          <>
            <Loader2 className="w-5 h-5 animate-spin" />
            กำลังจัดตาราง...
          </>
        ) : (
          <>
            <Rocket className="w-5 h-5" />
            จัดตารางสอนอัตโนมัติ
          </>
        )}
      </button>
      {error && (
        <div className="text-red-600 text-sm bg-red-50 border border-red-200 rounded-lg px-4 py-2">
          ❌ {error}
        </div>
      )}
      {result && !isGenerating && (
        <div className="text-green-600 text-sm font-medium">
          ✅ จัดตารางสำเร็จ — ดูผลลัพธ์ได้ที่แท็บ "ตารางสอน" และ "ภาระงานครู"
        </div>
      )}
    </div>
  )
}
