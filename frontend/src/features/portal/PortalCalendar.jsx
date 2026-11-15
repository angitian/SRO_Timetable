import { useCallback, useEffect, useMemo, useState } from 'react'
import { Loader2, MapPin, Clock, Users, CalendarDays, ChevronDown, ChevronRight } from 'lucide-react'
import { fetchPortalCalendar, fetchPortalEvent } from '../../api/portal.js'
import PortalMonthGrid from './PortalMonthGrid.jsx'
import {
  audienceDetails,
  buildMonthGrid,
  filterCalendarItems,
  formatDateRange,
  groupItemsByDate,
  statusMeta,
  todayISO,
} from './portalUtils.js'

const TONE = {
  emerald: 'bg-emerald-100 text-emerald-800 border-emerald-200',
  amber: 'bg-amber-100 text-amber-800 border-amber-200',
  rose: 'bg-rose-100 text-rose-800 border-rose-200',
  slate: 'bg-slate-100 text-slate-600 border-slate-200',
}

export default function PortalCalendar({ code, teacherId, onOpenTask }) {
  const today = todayISO()
  const [cursor, setCursor] = useState(() => {
    const now = new Date()
    return { year: now.getFullYear(), month: now.getMonth() + 1 }
  })
  const [selected, setSelected] = useState(today)
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [onlyMine, setOnlyMine] = useState(true)
  const [expandedEventId, setExpandedEventId] = useState(null)
  const [eventDetail, setEventDetail] = useState(null)

  const load = useCallback(async () => {
    if (!code) return
    setLoading(true)
    setError(null)
    try {
      const grid = buildMonthGrid(cursor.year, cursor.month, today)
      const from = grid[0][0].iso
      const to = grid[grid.length - 1][6].iso
      const body = await fetchPortalCalendar(code, { from, to, teacherId })
      setItems(body.items || [])
    } catch (e) {
      setError(e.message || 'โหลดปฏิทินไม่สำเร็จ')
      setItems([])
    } finally {
      setLoading(false)
    }
  }, [code, teacherId, cursor, today])

  useEffect(() => { load() }, [load])
  useEffect(() => {
    setExpandedEventId(null)
    setEventDetail(null)
  }, [teacherId])

  const visibleItems = useMemo(
    () => filterCalendarItems(items, { teacherId, onlyMine }),
    [items, teacherId, onlyMine],
  )
  const filtered = Boolean(teacherId) && onlyMine
  const byDate = useMemo(() => groupItemsByDate(visibleItems), [visibleItems])
  const dayItems = byDate[selected] || []

  function shiftMonth(delta) {
    setCursor((prev) => {
      const month = prev.month + delta
      if (month < 1) return { year: prev.year - 1, month: 12 }
      if (month > 12) return { year: prev.year + 1, month: 1 }
      return { ...prev, month }
    })
  }

  async function toggleEvent(item) {
    if (item.kind === 'task') {
      onOpenTask?.(item.id)
      return
    }
    if (expandedEventId === item.id) {
      setExpandedEventId(null)
      return
    }
    setExpandedEventId(item.id)
    if (eventDetail?.id === item.id && (eventDetail.event || eventDetail.error)) return

    setEventDetail({ id: item.id, loading: true, item })
    try {
      const body = await fetchPortalEvent(code, item.id, teacherId)
      setEventDetail({ ...body, id: item.id, item })
    } catch (e) {
      setEventDetail({ id: item.id, error: e.message, item })
    }
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] gap-4 items-start">
        <div className="min-w-0 space-y-4">
          {teacherId ? (
            <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-2 py-2">
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => { setOnlyMine(true); setExpandedEventId(null) }}
                  aria-pressed={onlyMine}
                  className={`min-h-[36px] px-3 rounded-lg text-xs font-bold border
                    ${onlyMine ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-slate-600 border-slate-300'}`}
                >
                  เฉพาะของฉัน
                </button>
                <button
                  type="button"
                  onClick={() => { setOnlyMine(false); setExpandedEventId(null) }}
                  aria-pressed={!onlyMine}
                  className={`min-h-[36px] px-3 rounded-lg text-xs font-bold border
                    ${!onlyMine ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-slate-600 border-slate-300'}`}
                >
                  ทั้งโรงเรียน
                </button>
              </div>
              <span className="ml-auto text-[11px] text-slate-500">
                {visibleItems.length} รายการ
              </span>
            </div>
          ) : (
            <p className="text-xs text-slate-500">เลือกชื่อครูด้านบนเพื่อดูเฉพาะกิจกรรมของคุณ</p>
          )}

          <PortalMonthGrid
        year={cursor.year}
        month={cursor.month}
        items={visibleItems}
        selected={selected}
        today={today}
        loading={loading}
        showTaskDots
        onSelect={(day) => { setSelected(day); setExpandedEventId(null) }}
        onShiftMonth={shiftMonth}
        onChangeMonth={(nextYear, nextMonth) => setCursor({ year: nextYear, month: nextMonth })}
        onToday={() => {
          const now = new Date()
          setCursor({ year: now.getFullYear(), month: now.getMonth() + 1 })
          setSelected(today)
          setExpandedEventId(null)
        }}
        legend={(
          <>
            <span className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-blue-500" /> กิจกรรมโรงเรียน
            </span>
            <span className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-amber-500" /> กำหนดส่งงาน
            </span>
          </>
        )}
      />

      {error && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div>
      )}

        </div>

        <section className="space-y-2 min-w-0">
        <h2 className="text-sm font-bold text-slate-700">
          {formatDateRange(selected, selected)}
          {dayItems.length > 0 && <span className="text-slate-400 font-normal"> · {dayItems.length} รายการ</span>}
        </h2>

        {dayItems.length === 0 && (
          <div className="rounded-2xl border border-dashed border-slate-300 bg-white/70 p-6 text-center text-sm text-slate-500">
            <CalendarDays className="w-6 h-6 mx-auto text-slate-300 mb-1" />
            {filtered ? 'ไม่มีกิจกรรมที่คุณเกี่ยวข้องในวันนี้' : 'ไม่มีกิจกรรมในวันนี้'}
            {filtered && (
              <button
                type="button"
                onClick={() => setOnlyMine(false)}
                className="mt-2 block mx-auto min-h-[34px] px-3 rounded-lg border border-slate-300 bg-white text-xs font-semibold text-slate-600"
              >
                ดูทั้งโรงเรียน
              </button>
            )}
          </div>
        )}

        {dayItems.map((item) => {
          const isTask = item.kind === 'task'
          const expanded = !isTask && expandedEventId === item.id
          const detail = expanded && eventDetail?.id === item.id ? eventDetail : null
          const meta = isTask ? statusMeta(item.status) : null
          return (
            <article
              key={`${item.kind}-${item.id}`}
              className={`bg-white rounded-2xl border overflow-hidden transition-colors ${expanded ? 'border-blue-300 shadow-sm' : 'border-slate-200 hover:border-blue-300'}`}
            >
              <button
                type="button"
                onClick={() => toggleEvent(item)}
                aria-expanded={isTask ? undefined : expanded}
                className="w-full text-left p-4 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
                        isTask ? 'bg-amber-100 text-amber-800' : 'bg-blue-100 text-blue-800'
                      }`}>
                        {isTask ? 'งานส่งไฟล์' : 'กิจกรรม'}
                      </span>
                      {item.i_attend && !filtered && (
                        <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-800">
                          ฉันต้องเข้าร่วม
                        </span>
                      )}
                    </div>
                    <h3 className="text-sm font-bold text-slate-800 mt-1 break-words">{item.title}</h3>
                    <p className="text-xs text-slate-500 mt-0.5 flex items-center gap-1 flex-wrap">
                      {item.all_day ? (
                        <span>ทั้งวัน</span>
                      ) : (
                        <span className="inline-flex items-center gap-1">
                          <Clock className="w-3 h-3" />
                          {item.start_time}{item.end_time ? `–${item.end_time}` : ''}
                        </span>
                      )}
                      {item.location && (
                        <span className="inline-flex items-center gap-1">
                          <MapPin className="w-3 h-3" />{item.location}
                        </span>
                      )}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {isTask && meta && (
                      <span className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold ${TONE[meta.tone]}`}>
                        {meta.dot} {meta.label}
                      </span>
                    )}
                    {!isTask && (expanded
                      ? <ChevronDown className="w-4 h-4 text-slate-500" />
                      : <ChevronRight className="w-4 h-4 text-slate-400" />)}
                  </div>
                </div>
                {isTask && item.total ? (
                  <p className="text-[11px] text-slate-500 mt-1">ส่งแล้ว {item.done}/{item.total} กล่อง</p>
                ) : null}
              </button>

              {expanded && (
                <div className="border-t border-slate-100 px-4 pb-4 pt-3 space-y-3">
                  {detail?.loading && (
                    <div className="flex items-center gap-2 text-sm text-slate-500">
                      <Loader2 className="w-4 h-4 animate-spin" /> กำลังโหลดรายละเอียด…
                    </div>
                  )}
                  {detail?.error && <p className="text-sm text-rose-600">{detail.error}</p>}
                  {detail?.event && (
                    <>
                      <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1 text-sm text-slate-600">
                        <div className="flex gap-2">
                          <dt className="text-slate-400 shrink-0">วันที่</dt>
                          <dd>{formatDateRange(detail.event.event_date, detail.event.end_date)}</dd>
                        </div>
                        {!detail.event.all_day && (
                          <div className="flex gap-2">
                            <dt className="text-slate-400 shrink-0">เวลา</dt>
                            <dd>{detail.event.start_time}{detail.event.end_time ? `–${detail.event.end_time}` : ''}</dd>
                          </div>
                        )}
                        {detail.event.location && (
                          <div className="flex gap-2 sm:col-span-2">
                            <dt className="text-slate-400 shrink-0">สถานที่</dt>
                            <dd>{detail.event.location}</dd>
                          </div>
                        )}
                      </dl>
                      {detail.event.description && (
                        <p className="text-sm text-slate-600 whitespace-pre-line border-t border-slate-100 pt-2">
                          {detail.event.description}
                        </p>
                      )}
                      <div className="border-t border-slate-100 pt-2">
                        <p className="text-xs font-bold text-slate-700 flex items-center gap-1.5 mb-1">
                          <Users className="w-3.5 h-3.5" /> ผู้เข้าร่วม
                        </p>
                        <ul className="space-y-0.5 text-sm text-slate-600">
                          {audienceDetails(detail.audience).map((row, idx) => (
                            <li key={`${row.kind}-${idx}`} className="flex items-center gap-1.5">
                              <span className="w-1 h-1 rounded-full bg-slate-300" /> {row.label}
                            </li>
                          ))}
                        </ul>
                        {detail.i_attend && (
                          <p className="mt-2 text-xs font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-2 py-1">
                            ✓ คุณอยู่ในรายชื่อผู้เข้าร่วม
                          </p>
                        )}
                      </div>
                    </>
                  )}
                </div>
              )}
            </article>
          )
        })}
        </section>
      </div>

    </div>
  )
}
