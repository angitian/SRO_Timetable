import { useState } from 'react'
import { Clock } from 'lucide-react'
import { formatTime24, maskTimeInput } from './portalUtils.js'

const QUICK_TIMES = ['08:00', '12:00', '15:30', '16:30']

/**
 * ช่องเวลา 24 ชม. (HH:MM) — พิมพ์เลขแล้วใส่ ':' ให้เอง
 * ใช้แทน <input type="time"> เพื่อไม่ให้ขึ้น AM/PM ตาม locale ของเครื่อง
 */
export default function TimeField({
  value = '', onChange, disabled = false, placeholder = 'HH:MM', className = '', quick = true,
}) {
  const [touched, setTouched] = useState(false)
  const invalid = touched && value !== '' && !formatTime24(value)

  function handle(text) {
    const masked = maskTimeInput(text)
    onChange?.(masked)
  }

  return (
    <div className={className}>
      <div className="relative">
        <Clock className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
        <input
          type="text"
          inputMode="numeric"
          autoComplete="off"
          maxLength={5}
          value={value}
          disabled={disabled}
          placeholder={placeholder}
          onFocus={() => setTouched(true)}
          onChange={(e) => handle(e.target.value)}
          onBlur={() => {
            const normalized = formatTime24(value)
            if (normalized && normalized !== value) onChange?.(normalized)
          }}
          className={`w-full min-h-[40px] rounded-lg border pl-9 pr-3 text-sm tabular-nums
            ${invalid ? 'border-rose-400 bg-rose-50' : 'border-slate-300'}
            disabled:bg-slate-100 disabled:text-slate-400`}
        />
      </div>
      {invalid && <p className="mt-1 text-[11px] text-rose-600">เวลาไม่ถูกต้อง (00:00–23:59)</p>}
      {quick && !disabled && (
        <div className="mt-1 flex flex-wrap gap-1">
          {QUICK_TIMES.map((time) => (
            <button
              key={time}
              type="button"
              onClick={() => onChange?.(time)}
              className={`px-1.5 py-0.5 rounded text-[11px] font-semibold border tabular-nums
                ${value === time
                  ? 'bg-blue-600 text-white border-blue-600'
                  : 'bg-white text-slate-600 border-slate-300 hover:border-blue-400'}`}
            >
              {time}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
