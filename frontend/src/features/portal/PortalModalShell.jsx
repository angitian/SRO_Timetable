import { useId } from 'react'
import { X } from 'lucide-react'

/**
 * เปลือก modal ของพอร์ทัล — header/footer ตรึง เนื้อหากลางเลื่อนได้
 * ใช้ร่วมกันระหว่าง "สร้างกิจกรรม" และ "สร้างงานส่งไฟล์"
 */
export default function PortalModalShell({ title, onClose, onSubmit, footer, children }) {
  const titleId = useId()

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center overflow-hidden p-2 sm:p-4">
      <form
        onSubmit={onSubmit}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="w-[92vw] max-w-[1100px] max-h-[90vh] bg-white rounded-2xl shadow-xl flex flex-col overflow-hidden"
      >
        <header className="shrink-0 flex items-center justify-between gap-3 px-4 sm:px-6 py-3 border-b border-slate-200 bg-white">
          <h2 id={titleId} className="text-base font-bold text-slate-800">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="ปิดหน้าต่าง"
            className="p-2 rounded-lg hover:bg-slate-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500"
          >
            <X className="w-5 h-5 text-slate-500" />
          </button>
        </header>

        <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-4 sm:px-6 py-4">
          {children}
        </div>

        <footer className="shrink-0 border-t border-slate-200 bg-slate-50/90 px-4 sm:px-6 py-3 flex flex-wrap items-center justify-end gap-3">
          {footer}
        </footer>
      </form>
    </div>
  )
}
