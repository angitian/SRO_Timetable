import { useCallback, useEffect, useState } from 'react'
import {
  CalendarPlus, Pencil, Trash2, Loader2, MapPin, Clock, Users, RefreshCw,
} from 'lucide-react'
import {
  createAdminEvent, deleteAdminEvent, fetchAdminEvents, updateAdminEvent,
} from '../../api/portal.js'
import SchoolEventModal from './SchoolEventModal.jsx'
import AdminEventCalendar from './AdminEventCalendar.jsx'
import { audienceSummary, formatDateRange } from './portalUtils.js'

export default function AdminEventsTab({ code, teachers, depts, classes, onError, onNotice }) {
  const [events, setEvents] = useState([])
  const [loading, setLoading] = useState(true)
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState(null)
  const [presetDate, setPresetDate] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const body = await fetchAdminEvents(code)
      setEvents(body.events || [])
    } catch (e) {
      onError?.(e.message)
    } finally {
      setLoading(false)
    }
  }, [code, onError])

  useEffect(() => { load() }, [load])

  async function save(payload) {
    if (editing?.id) await updateAdminEvent(code, editing.id, payload)
    else await createAdminEvent(code, payload)
    setOpen(false)
    setEditing(null)
    onNotice?.(editing ? 'บันทึกการแก้ไขกิจกรรมแล้ว' : 'สร้างกิจกรรมแล้ว')
    await load()
  }

  async function remove(event) {
    if (!window.confirm(`ลบกิจกรรม “${event.title}”?`)) return
    try {
      await deleteAdminEvent(code, event.id)
      onNotice?.('ลบกิจกรรมแล้ว')
      await load()
    } catch (e) {
      onError?.(e.message)
    }
  }

  function openCreate(date) {
    setEditing(null)
    setPresetDate(date || '')
    setOpen(true)
  }

  function openEdit(event) {
    setEditing(event)
    setPresetDate('')
    setOpen(true)
  }

  return (
    <section className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-start">
      {/* ── ปฏิทิน (ซ้าย) ───────────────────────────────────────── */}
      <div className="lg:col-span-7">
        <AdminEventCalendar
          events={events}
          loading={loading}
          onCreate={openCreate}
          onEdit={openEdit}
        />
      </div>

      {/* ── รายการกิจกรรม (ขวา) ─────────────────────────────────── */}
      <div className="lg:col-span-5 space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-sm font-bold text-slate-700">กิจกรรมโรงเรียน ({events.length})</h2>
          <button
            onClick={load}
            className="min-h-[32px] px-2.5 rounded-lg border border-slate-300 text-xs font-semibold inline-flex items-center gap-1"
            title="โหลดใหม่"
          >
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => openCreate('')}
            className="ml-auto min-h-[38px] px-3 rounded-lg bg-blue-600 text-white text-sm font-bold inline-flex items-center gap-1.5"
          >
            <CalendarPlus className="w-4 h-4" /> สร้างกิจกรรม
          </button>
        </div>

        {loading && (
          <div className="flex items-center gap-2 text-sm text-slate-500">
            <Loader2 className="w-4 h-4 animate-spin" /> กำลังโหลด…
          </div>
        )}

        {!loading && events.length === 0 && (
          <div className="rounded-xl border border-dashed border-slate-300 bg-white/70 p-6 text-center text-sm text-slate-500">
            ยังไม่มีกิจกรรม — คลิกวันในปฏิทินแล้วกด “สร้างกิจกรรมวันนี้” หรือกด “สร้างกิจกรรม”
          </div>
        )}

        <div className="grid gap-2">
          {events.map((event) => (
            <article key={event.id} className="bg-white rounded-xl border border-slate-200 p-3">
              <div className="flex flex-wrap items-start gap-2">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="text-sm font-bold text-slate-800 break-words">{event.title}</h3>
                    {!event.is_published && (
                      <span className="rounded-full bg-slate-100 text-slate-500 px-2 py-0.5 text-[11px] font-semibold">
                        ซ่อนอยู่
                      </span>
                    )}
                    {(event.end_date && event.end_date !== event.event_date) && (
                      <span className="rounded-full bg-violet-100 text-violet-800 px-2 py-0.5 text-[11px] font-semibold">
                        หลายวัน
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-slate-500 mt-1 flex items-center gap-2 flex-wrap">
                    <span>{formatDateRange(event.event_date, event.end_date)}</span>
                    {!event.all_day && (
                      <span className="inline-flex items-center gap-1">
                        <Clock className="w-3 h-3" />{event.start_time}{event.end_time ? `–${event.end_time}` : ''}
                      </span>
                    )}
                    {event.location && (
                      <span className="inline-flex items-center gap-1">
                        <MapPin className="w-3 h-3" />{event.location}
                      </span>
                    )}
                  </p>
                  <p className="text-xs text-slate-600 mt-1 flex items-center gap-1">
                    <Users className="w-3 h-3 text-slate-400" />
                    {audienceSummary(event.audience)}
                  </p>
                </div>
                <div className="flex gap-1">
                  <button
                    onClick={() => openEdit(event)}
                    className="p-2 rounded-lg hover:bg-slate-100"
                    title="แก้ไข"
                  >
                    <Pencil className="w-4 h-4 text-slate-600" />
                  </button>
                  <button
                    onClick={() => remove(event)}
                    className="p-2 rounded-lg hover:bg-rose-50"
                    title="ลบ"
                  >
                    <Trash2 className="w-4 h-4 text-rose-600" />
                  </button>
                </div>
              </div>
            </article>
          ))}
        </div>
      </div>

      <SchoolEventModal
        open={open}
        initial={editing}
        presetDate={presetDate}
        teachers={teachers}
        depts={depts}
        classes={classes}
        onClose={() => { setOpen(false); setEditing(null); setPresetDate('') }}
        onSave={save}
      />
    </section>
  )
}
