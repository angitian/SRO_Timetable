import { useEffect, useRef, useState } from 'react'
import { Loader2, AlertCircle } from 'lucide-react'
import AudiencePicker from './AudiencePicker.jsx'
import PortalModalShell from './PortalModalShell.jsx'
import DateField from '../../components/common/DateField.jsx'
import TimeField from './TimeField.jsx'
import { formatTime24, todayISO } from './portalUtils.js'

const EMPTY = {
  title: '',
  description: '',
  event_date: '',
  end_date: '',
  start_time: '',
  end_time: '',
  all_day: true,
  location: '',
  target_type: 'all',
  audience: [],
  is_published: true,
}

/** สร้าง/แก้ไข กิจกรรมโรงเรียน (ไม่เกี่ยวกับการส่งไฟล์) */
export default function SchoolEventModal({
  open, initial, presetDate = '', teachers = [], depts = [], classes = [], onClose, onSave,
}) {
  const [form, setForm] = useState(EMPTY)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const descriptionRef = useRef(null)

  useEffect(() => {
    if (!open) return
    setError(null)
    setForm(
      initial
        ? {
            ...EMPTY,
            ...initial,
            end_date: initial.end_date || '',
            start_time: initial.start_time || '',
            end_time: initial.end_time || '',
            location: initial.location || '',
            target_type: initial.target_type || 'all',
            audience: initial.audience_members || initial.audience || [],
          }
        : { ...EMPTY, event_date: presetDate || todayISO() },
    )
  }, [open, initial, presetDate])

  useEffect(() => {
    const field = descriptionRef.current
    if (!field) return
    field.style.height = 'auto'
    field.style.height = `${field.scrollHeight}px`
  }, [form.description, open])

  if (!open) return null

  const update = (patch) => setForm((prev) => ({ ...prev, ...patch }))
  const input = 'mt-1 w-full min-h-[40px] rounded-lg border border-slate-300 px-3 text-sm'

  const recipientCount = (() => {
    if (form.target_type === 'all') return teachers.length
    const recipientIds = new Set()
    for (const member of form.audience || []) {
      if (member.member_kind === 'teacher') recipientIds.add(member.member_id)
      if (member.member_kind === 'dept') {
        teachers.forEach((teacher) => {
          if (teacher.dept === member.member_id) recipientIds.add(teacher.teacher_id)
        })
      }
    }
    return recipientIds.size
  })()
  const selectedClasses = (form.audience || []).filter((member) => member.member_kind === 'class').length

  async function submit(event) {
    event.preventDefault()
    setError(null)
    if (!form.title.trim()) return setError('กรุณากรอกชื่อกิจกรรม')
    if (!form.event_date) return setError('กรุณาเลือกวันที่')
    if (form.end_date && form.end_date < form.event_date) {
      return setError('วันสิ้นสุดต้องไม่ก่อนวันเริ่ม')
    }
    const startTime = form.all_day ? null : formatTime24(form.start_time)
    const endTime = form.all_day ? null : formatTime24(form.end_time)
    if (!form.all_day && form.start_time && !startTime) return setError('เวลาเริ่มไม่ถูกต้อง (HH:MM)')
    if (!form.all_day && form.end_time && !endTime) return setError('เวลาสิ้นสุดไม่ถูกต้อง (HH:MM)')
    if (startTime && endTime && endTime < startTime) return setError('เวลาสิ้นสุดต้องไม่ก่อนเวลาเริ่ม')

    setBusy(true)
    try {
      await onSave({
        title: form.title.trim(),
        description: form.description || '',
        event_date: form.event_date,
        end_date: form.end_date || null,
        start_time: startTime,
        end_time: endTime,
        all_day: !!form.all_day,
        location: form.location || null,
        target_type: form.target_type,
        audience: form.audience || [],
        is_published: !!form.is_published,
      })
    } catch (e) {
      setError(e.message || 'บันทึกไม่สำเร็จ')
    } finally {
      setBusy(false)
    }
  }

  return (
    <PortalModalShell
      title={initial ? 'แก้ไขกิจกรรมโรงเรียน' : 'สร้างกิจกรรมโรงเรียน'}
      onClose={onClose}
      onSubmit={submit}
      footer={(
        <>
          <p className="w-full sm:w-auto sm:mr-auto text-xs text-slate-600">
            {form.target_type === 'all'
              ? `จะแจ้งเตือนไปยังผู้เข้าร่วม ${recipientCount} คน`
              : `จะแจ้งเตือนไปยังครู ${recipientCount} คน${selectedClasses ? ` และ ${selectedClasses} ห้องเรียน` : ''}`}
          </p>
          <button
            type="button"
            onClick={onClose}
            className="min-h-[40px] px-4 rounded-lg border border-slate-300 text-sm font-semibold text-slate-600"
          >
            ยกเลิก
          </button>
          <button
            type="submit"
            disabled={busy}
            className="min-h-[40px] px-4 rounded-lg bg-blue-600 text-white text-sm font-bold inline-flex items-center gap-2 disabled:opacity-60"
          >
            {busy && <Loader2 className="w-4 h-4 animate-spin" />} บันทึก
          </button>
        </>
      )}
    >

          {error && (
            <div className="mb-3 flex items-start gap-2 rounded-lg bg-rose-50 border border-rose-200 px-3 py-2 text-sm text-rose-700" role="alert">
              <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" /> {error}
            </div>
          )}

        <div className="grid gap-5 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
          {/* ── ซ้าย: ข้อมูลกิจกรรม ─────────────────────────────── */}
          <div className="space-y-2.5 min-w-0">
            <label className="block">
              <span className="text-sm font-semibold text-slate-700">ชื่อกิจกรรม</span>
              <input
                value={form.title}
                onChange={(e) => update({ title: e.target.value })}
                maxLength={200}
                placeholder="เช่น ประชุมครู, วันไหว้ครู, อบรมเชิงปฏิบัติการ"
                className={input}
              />
            </label>

            <label className="block">
              <span className="text-sm font-semibold text-slate-700">รายละเอียด</span>
              <textarea
                ref={descriptionRef}
                value={form.description}
                onChange={(e) => update({ description: e.target.value })}
                onInput={(e) => {
                  e.currentTarget.style.height = 'auto'
                  e.currentTarget.style.height = `${e.currentTarget.scrollHeight}px`
                }}
                rows={2}
                className={`${input} resize-none overflow-hidden py-2`}
              />
            </label>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <span className="text-xs font-semibold text-slate-600">วันเริ่ม</span>
                <DateField
                  block
                  value={form.event_date}
                  onChange={(value) => update({ event_date: value })}
                  className="mt-1"
                />
              </div>
              <div>
                <span className="text-xs font-semibold text-slate-600">วันสิ้นสุด</span>
                <DateField
                  block
                  value={form.end_date}
                  onChange={(value) => update({ end_date: value })}
                  className="mt-1"
                  title="เว้นว่าง = วันเดียว"
                />
              </div>
            </div>

            <div className="flex flex-wrap gap-4 items-center">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={form.all_day}
                  onChange={(e) => update({ all_day: e.target.checked })}
                  className="w-4 h-4"
                />
                ทั้งวัน
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={form.is_published}
                  onChange={(e) => update({ is_published: e.target.checked })}
                  className="w-4 h-4"
                />
                เผยแพร่ให้ครูเห็น
              </label>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <span className="text-xs font-semibold text-slate-600">เวลาเริ่ม</span>
                <TimeField
                  className="mt-1"
                  value={form.start_time}
                  disabled={form.all_day}
                  onChange={(value) => update({ start_time: value })}
                />
              </div>
              <div>
                <span className="text-xs font-semibold text-slate-600">เวลาสิ้นสุด</span>
                <TimeField
                  className="mt-1"
                  value={form.end_time}
                  disabled={form.all_day}
                  onChange={(value) => update({ end_time: value })}
                />
              </div>
            </div>

            <label className="block">
              <span className="text-sm font-semibold text-slate-700">สถานที่</span>
              <input
                value={form.location}
                onChange={(e) => update({ location: e.target.value })}
                placeholder="เช่น ห้องประชุม 1, โรงยิม"
                className={input}
              />
            </label>
          </div>

          {/* ── ขวา: ผู้เข้าร่วม ─────────────────────────────────── */}
          <div className="min-w-0">
            <p className="text-sm font-semibold text-slate-700 mb-1">ผู้เข้าร่วม</p>
            <AudiencePicker
              teachers={teachers}
              depts={depts}
              classes={classes}
              allowClasses
              value={{ target_type: form.target_type, audience: form.audience }}
              onChange={(next) => update({ target_type: next.target_type, audience: next.audience })}
            />
          </div>
        </div>
    </PortalModalShell>
  )
}
