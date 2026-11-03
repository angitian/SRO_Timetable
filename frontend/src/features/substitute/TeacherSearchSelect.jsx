import { useState, useMemo, useRef, useEffect } from 'react'
import { Search, X } from 'lucide-react'

/**
 * Combobox เลือกครู — พิมพ์ค้นหา + autofill รายชื่อ (แทน <select>)
 * - กรองด้วยชื่อ (ตรงกลางคำได้)
 * - ↑/↓ เลื่อน, Enter เลือก, Esc ปิด, คลิกเลือก
 * - ป้าย "ลาอยู่แล้ว" สำหรับครูที่ลาอยู่ในวันนั้น
 */
export default function TeacherSearchSelect({
  teachers = [],
  value,
  onChange,
  absentIds = [],
  disabled = false,
  placeholder = 'พิมพ์ชื่อครู…',
}) {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [highlight, setHighlight] = useState(0)
  const boxRef = useRef(null)
  const inputRef = useRef(null)
  const selected = teachers.find((t) => t.id === value) || null

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    const list = q ? teachers.filter((t) => (t.name || '').toLowerCase().includes(q)) : teachers
    return list.slice(0, 8)
  }, [teachers, query])

  useEffect(() => {
    const onDocDown = (e) => {
      if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', onDocDown)
    return () => document.removeEventListener('mousedown', onDocDown)
  }, [])

  const pick = (t) => {
    onChange(t.id)
    setQuery('')
    setOpen(false)
  }

  if (disabled && selected) {
    return (
      <div className="w-full border border-gray-200 bg-gray-50 rounded-lg px-3 py-2 text-sm text-gray-700">
        {selected.name}
      </div>
    )
  }

  return (
    <div ref={boxRef} className="relative">
      <div className="flex items-center gap-2 border border-gray-300 rounded-lg px-3 py-2 focus-within:border-blue-500 focus-within:ring-1 focus-within:ring-blue-200">
        <Search className="w-4 h-4 text-gray-400 shrink-0" />
        <input
          ref={inputRef}
          type="text"
          value={open ? query : (selected?.name || '')}
          onFocus={() => { setOpen(true); setQuery(''); setHighlight(0) }}
          onChange={(e) => { setQuery(e.target.value); setOpen(true); setHighlight(0) }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault()
              setHighlight((h) => Math.min(h + 1, Math.max(0, filtered.length - 1)))
            } else if (e.key === 'ArrowUp') {
              e.preventDefault()
              setHighlight((h) => Math.max(h - 1, 0))
            } else if (e.key === 'Enter') {
              e.preventDefault()
              const t = filtered[highlight]
              if (t) pick(t)
            } else if (e.key === 'Escape') {
              setOpen(false)
            }
          }}
          placeholder={placeholder}
          className="flex-1 min-w-0 outline-none text-sm bg-transparent"
        />
        {selected && (
          <button
            type="button"
            onClick={() => { onChange(''); setQuery(''); setOpen(true); inputRef.current?.focus() }}
            className="shrink-0 text-gray-400 hover:text-gray-600"
            title="ล้างค่า"
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>

      {open && (
        <div className="absolute z-20 mt-1 w-full max-h-56 overflow-y-auto bg-white border border-gray-200 rounded-lg shadow-lg">
          {filtered.length === 0 ? (
            <div className="px-3 py-2.5 text-xs text-gray-400">ไม่พบชื่อครู</div>
          ) : (
            filtered.map((t, i) => (
              <button
                key={t.id}
                type="button"
                onMouseEnter={() => setHighlight(i)}
                onClick={() => pick(t)}
                className={`w-full text-left px-3 py-2 text-sm flex items-center gap-2 transition-colors
                  ${i === highlight ? 'bg-blue-50 text-blue-800' : 'text-gray-700 hover:bg-gray-50'}`}
              >
                <span className="truncate">{t.name}</span>
                {absentIds.includes(t.id) && (
                  <span className="ml-auto shrink-0 text-[10px] px-1.5 py-0.5 rounded-full bg-orange-100 text-orange-700">
                    ลาอยู่แล้ว
                  </span>
                )}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  )
}
