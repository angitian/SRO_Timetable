import { useMemo, useState } from 'react'
import { CalendarPlus, MapPin, Clock, Users, Pencil } from 'lucide-react'
import PortalMonthGrid from './PortalMonthGrid.jsx'
import {
  audienceSummary, eventsOnDate, formatDDMMYYYYBuddhist, formatDateRange, todayISO,
} from './portalUtils.js'

/**
 * ปฏิทินกิจกรรมโรงเรียน (ฝั่ง admin)
 * คลิกวัน → เลือกวันนั้น แล้วแสดงแผงของวัน + ปุ่ม "＋ สร้างกิจกรรมวันนี้"
 */
export default function AdminEventCalendar({ events = [], onCreate, onEdit, loading = false }) {
  const today = todayISO()
  const [cursor, setCursor] = useState(() => {
    const now = new Date()
    return { year: now.getFullYear(), month: now.getMonth() + 1 }
  })
  const [selected, setSelected] = useState(today)

  const items = useMemo(
    () => events.map((event) => ({
      kind: 'event',
      id: event.id,
      date: event.event_date,
      end_date: event.end_date,
    })),
    [events],
  )

  const dayEvents = useMemo(() => eventsOnDate(events, selected), [events, selected])

  function shiftMonth(delta) {
    setCursor((prev) => {
      const month = prev.month + delta
      if (month < 1) return { year: prev.year - 1, month: 12 }
      if (month > 12) return { year: prev.year + 1, month: 1 }
      return { ...prev, month }
    })
  }

  return (
    <div className="space-y-3 lg:sticky lg:top-4">
      <PortalMonthGrid
        year={cursor.year}
        month={cursor.month}
        items={items}
        selected={selected}
        today={today}
        loading={loading}
        onSelect={setSelected}
        onShiftMonth={shiftMonth}
        onChangeMonth={(nextYear, nextMonth) => setCursor({ year: nextYear, month: nextMonth })}
        onToday={() => {
          const now = new Date()
          setCursor({ year: now.getFullYear(), month: now.getMonth() + 1 })
          setSelected(today)
        }}
        legend={(
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-blue-500" /> กิจกรรมโรงเรียน
          </span>
        )}
      />

      <section className="bg-white rounded-2xl border border-slate-200 p-3 space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-sm font-bold text-slate-800 tabular-nums">
            {formatDDMMYYYYBuddhist(selected)}
          </p>
          <span className="text-[11px] text-slate-400">
            {dayEvents.length ? `${dayEvents.length} กิจกรรม` : 'ยังไม่มีกิจกรรม'}
          </span>
          <button
            onClick={() => onCreate?.(selected)}
            className="ml-auto min-h-[34px] px-2.5 rounded-lg bg-blue-600 text-white text-xs font-bold inline-flex items-center gap-1"
          >
            <CalendarPlus className="w-3.5 h-3.5" /> สร้างกิจกรรมวันนี้
          </button>
        </div>

        {dayEvents.length === 0 && (
          <p className="text-xs text-slate-500 py-2">คลิกวันอื่นในปฏิทิน หรือกด “สร้างกิจกรรมวันนี้”</p>
        )}

        {dayEvents.map((event) => (
          <button
            key={event.id}
            onClick={() => onEdit?.(event)}
            className="w-full text-left rounded-xl border border-slate-200 p-2.5 hover:border-blue-300"
          >
            <div className="flex items-start justify-between gap-2">
              <span className="text-sm font-semibold text-slate-800 break-words">{event.title}</span>
              <Pencil className="w-3.5 h-3.5 text-slate-400 shrink-0 mt-0.5" />
            </div>
            <p className="text-[11px] text-slate-500 mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5">
              <span>{formatDateRange(event.event_date, event.end_date)}</span>
              {!event.all_day && (
                <span className="inline-flex items-center gap-0.5">
                  <Clock className="w-3 h-3" />{event.start_time}{event.end_time ? `–${event.end_time}` : ''}
                </span>
              )}
              {event.location && (
                <span className="inline-flex items-center gap-0.5">
                  <MapPin className="w-3 h-3" />{event.location}
                </span>
              )}
            </p>
            <p className="text-[11px] text-slate-500 mt-0.5 inline-flex items-center gap-1">
              <Users className="w-3 h-3 text-slate-400" />{audienceSummary(event.audience)}
            </p>
          </button>
        ))}
      </section>
    </div>
  )
}
