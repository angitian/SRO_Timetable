import { AlertTriangle, Copy, FilePlus2 } from 'lucide-react'
import { useApp } from '../../context/AppContext.jsx'

/**
 * ถามยืนยันเมื่อมีงานชื่อเดียวกันอยู่แล้วบนคลาวด์ (backend ตอบ 409)
 * "อัปเดตงานเดิม" → บันทึกทับ record เดิม (รหัสเดิม)
 * "สร้างงานใหม่"  → บังคับสร้าง record ใหม่ (รหัสใหม่)
 */
export default function DuplicateWorkspaceDialog() {
  const { pendingDuplicate, resolveDuplicate } = useApp()
  if (!pendingDuplicate) return null

  const code = pendingDuplicate.short_code || ''
  const title = pendingDuplicate.title || pendingDuplicate.requestedTitle || 'งานที่บันทึกไว้'
  const updated = pendingDuplicate.updated_at
    ? new Date(String(pendingDuplicate.updated_at).replace(' ', 'T')).toLocaleString('th-TH', {
      dateStyle: 'medium', timeStyle: 'short',
    })
    : ''

  return (
    <div className="fixed inset-0 z-[120] bg-slate-900/50 flex items-center justify-center p-4">
      <div
        role="dialog"
        aria-modal="true"
        className="w-full max-w-md bg-white rounded-2xl shadow-xl p-5 space-y-3"
      >
        <div className="flex items-start gap-2">
          <AlertTriangle className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" />
          <div className="min-w-0">
            <h2 className="text-base font-bold text-slate-800">มีงานชื่อนี้อยู่แล้วบนคลาวด์</h2>
            <p className="text-sm text-slate-600 mt-1 break-words">
              “{title}”{code && <> · รหัส <code className="font-semibold">{code}</code></>}
            </p>
            {updated && <p className="text-xs text-slate-500 mt-0.5">แก้ไขล่าสุด {updated}</p>}
          </div>
        </div>

        <p className="text-xs text-slate-500 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2">
          เลือก “อัปเดตงานเดิม” เพื่อใช้รหัสเดิมต่อ (ลิงก์พอร์ทัล/การแชร์ไม่เปลี่ยน)
          หรือ “สร้างงานใหม่” ถ้าเป็นคนละเทอม/คนละชุดข้อมูล
        </p>

        <div className="flex flex-col gap-2 pt-1">
          <button
            type="button"
            onClick={() => resolveDuplicate('update')}
            className="min-h-[42px] rounded-lg bg-blue-600 text-white text-sm font-bold inline-flex items-center justify-center gap-2"
          >
            <Copy className="w-4 h-4" /> อัปเดตงานเดิม{code ? ` (${code})` : ''}
          </button>
          <button
            type="button"
            onClick={() => resolveDuplicate('new')}
            className="min-h-[42px] rounded-lg border border-slate-300 text-sm font-semibold text-slate-700 inline-flex items-center justify-center gap-2"
          >
            <FilePlus2 className="w-4 h-4" /> สร้างงานใหม่
          </button>
          <button
            type="button"
            onClick={() => resolveDuplicate('cancel')}
            className="min-h-[38px] rounded-lg text-sm font-semibold text-slate-500 hover:bg-slate-100"
          >
            ยกเลิก
          </button>
        </div>
      </div>
    </div>
  )
}
