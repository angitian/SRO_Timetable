import { useRef } from 'react'
import { CalendarDays } from 'lucide-react'
import { formatDDMMYYYY } from '../../features/substitute/dailySchedule.js'

/**
 * ช่องเลือกวันที่ — แสดงผลเป็น วว/ดด/ปปปป (พ.ศ.)
 * ใช้ native date picker ผ่าน showPicker() (รองรับ Chrome/Edge/Firefox/Safari ใหม่)
 * input ซ่อนสนิท (1px, opacity 0) เพื่อไม่ให้เห็นไอคอนปฏิทินซ้ำซ้อน
 */
export default function DateField({ value, onChange, className = '', title }) {
  const inputRef = useRef(null)

  const openPicker = () => {
    const el = inputRef.current
    if (!el) return
    if (typeof el.showPicker === 'function') {
      try {
        el.showPicker()
        return
      } catch {
        // เบราว์เซอร์ไม่รองรับ/ถูกบล็อก → fallback ด้านล่าง
      }
    }
    el.focus()
    el.click()
  }

  return (
    <div className={`relative inline-flex items-center ${className}`}>
      <button
        type="button"
        onClick={openPicker}
        title={title || 'เลือกวันที่'}
        className="inline-flex items-center gap-1.5 border border-gray-300 rounded-lg px-2.5 py-1.5 bg-white hover:border-blue-400 hover:bg-blue-50/40 transition-colors"
      >
        <CalendarDays className="w-4 h-4 text-gray-400 shrink-0" />
        <span className="text-sm text-gray-800 tabular-nums whitespace-nowrap">
          {formatDDMMYYYY(value) || 'วว/ดด/ปปปป'}
        </span>
      </button>
      <input
        ref={inputRef}
        type="date"
        value={value || ''}
        onChange={(e) => onChange(e.target.value)}
        tabIndex={-1}
        aria-hidden="true"
        className="absolute left-0 bottom-0 w-px h-px opacity-0 pointer-events-none"
      />
    </div>
  )
}
