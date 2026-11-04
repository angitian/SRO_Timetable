import { useRef } from 'react'
import { CalendarDays } from 'lucide-react'
import { formatDateDMY } from '../../utils/traineeAttendance.js'

export default function TraineeDateField({ value, onChange, disabled = false, className = '', title = 'เลือกวันที่' }) {
  const inputRef = useRef(null)

  function openPicker() {
    if (disabled) return
    const el = inputRef.current
    if (!el) return
    if (typeof el.showPicker === 'function') {
      try { el.showPicker(); return } catch {}
    }
    el.focus()
    el.click()
  }

  return (
    <div className={`relative inline-flex items-center ${className}`}>
      <button
        type="button"
        onClick={openPicker}
        disabled={disabled}
        title={title}
        className="w-full inline-flex items-center gap-2 rounded-xl border border-slate-300 bg-slate-50 px-3 py-2 text-sm text-slate-800 hover:border-violet-300 disabled:opacity-50"
      >
        <CalendarDays className="w-4 h-4 text-slate-400 shrink-0" />
        <span className="tabular-nums whitespace-nowrap">{formatDateDMY(value) || 'วว/ดด/ปปปป'}</span>
      </button>
      <input
        ref={inputRef}
        type="date"
        value={value || ''}
        onChange={(e) => onChange?.(e.target.value)}
        disabled={disabled}
        tabIndex={-1}
        aria-hidden="true"
        className="absolute left-0 bottom-0 w-px h-px opacity-0 pointer-events-none"
      />
    </div>
  )
}
