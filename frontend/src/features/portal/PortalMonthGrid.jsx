import { ChevronLeft, ChevronRight, Loader2 } from 'lucide-react'
import {
  DAY_SHORT, THAI_MONTHS_FULL, buildMonthGrid, groupItemsByDate, todayISO, yearOptions,
} from './portalUtils.js'

/**
 * กริดปฏิทินเดือน (ใช้ร่วมกันระหว่างหน้าครูและหน้า admin)
 * - items: [{ date, end_date, kind }] → จุดสี (kind = 'event' | 'task')
 * - onSelect(iso) เมื่อคลิกวัน
 */
export default function PortalMonthGrid({
  year,
  month,
  items = [],
  selected = '',
  today = todayISO(),
  onSelect,
  onShiftMonth,
  onChangeMonth,
  onToday,
  loading = false,
  showTaskDots = false,
  compact = false,
  legend = null,
}) {
  const weeks = buildMonthGrid(year, month, today)
  const byDate = groupItemsByDate(items)
  const years = yearOptions(year)
  const selectClass = 'min-h-[40px] rounded-lg border border-slate-300 bg-white px-2 text-sm font-semibold text-slate-800 hover:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-200'

  return (
    <section className={`bg-white rounded-2xl border border-slate-200 ${compact ? 'p-2' : 'p-3'}`}>
      <div className="flex items-center justify-between px-1">
        <button
          onClick={() => onShiftMonth?.(-1)}
          className="min-h-[40px] min-w-[40px] rounded-lg hover:bg-slate-100 flex items-center justify-center"
          aria-label="เดือนก่อนหน้า"
        >
          <ChevronLeft className="w-5 h-5 text-slate-600" />
        </button>
        <div className="flex flex-col items-center gap-0.5 min-w-0">
          <div className="flex items-center justify-center gap-1 min-w-0">
            <select
              value={month}
              onChange={(e) => onChangeMonth?.(year, Number(e.target.value))}
              aria-label="เลือกเดือน"
              className={`${selectClass} max-w-[132px]`}
            >
              {THAI_MONTHS_FULL.map((label, index) => (
                index > 0 && (
                  <option key={label} value={index}>{label}</option>
                )
              ))}
            </select>
            <select
              value={year}
              onChange={(e) => onChangeMonth?.(Number(e.target.value), month)}
              aria-label="เลือกปี (พ.ศ.)"
              className={`${selectClass} max-w-[92px] tabular-nums`}
            >
              {years.map((option) => (
                <option key={option} value={option}>{option + 543}</option>
              ))}
            </select>
          </div>
          {onToday && (
            <button onClick={onToday} className="text-[11px] font-semibold text-blue-600">
              กลับวันนี้
            </button>
          )}
        </div>
        <button
          onClick={() => onShiftMonth?.(1)}
          className="min-h-[40px] min-w-[40px] rounded-lg hover:bg-slate-100 flex items-center justify-center"
          aria-label="เดือนถัดไป"
        >
          <ChevronRight className="w-5 h-5 text-slate-600" />
        </button>
      </div>

      <div className="grid grid-cols-7 mt-2 text-center text-[11px] font-semibold text-slate-400">
        {DAY_SHORT.map((day) => <div key={day} className="py-1">{day}</div>)}
      </div>

      <div className="grid grid-cols-7 gap-1">
        {weeks.flat().map((day) => {
          const dayItems = byDate[day.iso] || []
          const hasEvent = dayItems.some((item) => item.kind !== 'task')
          const hasTask = showTaskDots && dayItems.some((item) => item.kind === 'task')
          const active = day.iso === selected
          return (
            <button
              key={day.iso}
              onClick={() => onSelect?.(day.iso)}
              className={`relative rounded-lg flex flex-col items-center justify-center transition-colors
                ${compact ? 'aspect-square text-xs' : 'aspect-square text-sm'}
                ${active ? 'bg-blue-600 text-white font-bold' : day.inMonth ? 'text-slate-700 hover:bg-slate-100' : 'text-slate-300'}
                ${day.isToday && !active ? 'ring-1 ring-blue-400' : ''}`}
            >
              {day.day}
              <span className="flex gap-0.5 mt-0.5 h-1.5">
                {hasEvent && (
                  <span className={`w-1.5 h-1.5 rounded-full ${active ? 'bg-white' : 'bg-blue-500'}`} />
                )}
                {hasTask && (
                  <span className={`w-1.5 h-1.5 rounded-full ${active ? 'bg-white' : 'bg-amber-500'}`} />
                )}
              </span>
            </button>
          )
        })}
      </div>

      <div className="flex items-center gap-3 px-1 pt-2 text-[11px] text-slate-500">
        {legend}
        {loading && <Loader2 className="w-3.5 h-3.5 animate-spin ml-auto" />}
      </div>
    </section>
  )
}
