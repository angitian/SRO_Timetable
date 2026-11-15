import { useEffect, useRef, useState } from 'react'
import { Loader2, AlertCircle, Plus, Trash2, ArrowUp, ArrowDown, Package } from 'lucide-react'
import AudiencePicker from './AudiencePicker.jsx'
import PortalModalShell from './PortalModalShell.jsx'
import DateField from '../../components/common/DateField.jsx'
import TimeField from './TimeField.jsx'
import { formatTime24, joinDateTime, splitDateTime, todayISO } from './portalUtils.js'

const EXT_PRESETS = [
  { label: 'PDF เท่านั้น', value: '.pdf' },
  { label: 'PDF / Word', value: '.pdf,.docx' },
  { label: 'PDF / Word / Excel', value: '.pdf,.docx,.xlsx' },
  { label: 'ทุกแบบ (+ ZIP)', value: '.pdf,.docx,.xlsx,.zip' },
]

const newSlot = () => ({
  id: null,
  title: '',
  description: '',
  is_required: true,
  allowed_ext: '.pdf,.docx',
  max_mb: 25,
})

const EMPTY = {
  title: '',
  description: '',
  open_date: '',
  open_time: '',
  due_date: '',
  due_time: '',
  allow_late: true,
  is_published: true,
  target_type: 'all',
  audience: [],
  slots: [newSlot()],
}

/** สร้าง/แก้ไข งานส่งไฟล์ (มีกล่องรับไฟล์หลายใบ) */
export default function TaskEditorModal({
  open, initial, teachers = [], depts = [], onClose, onSave,
}) {
  const [form, setForm] = useState(EMPTY)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const descriptionRef = useRef(null)

  useEffect(() => {
    if (!open) return
    setError(null)
    if (initial) {
      const openParts = splitDateTime(initial.open_at)
      const dueParts = splitDateTime(initial.due_datetime)
      setForm({
        ...EMPTY,
        ...initial,
        open_date: openParts.date,
        open_time: openParts.time,
        due_date: dueParts.date,
        due_time: dueParts.time,
        target_type: initial.target_type || 'all',
        audience: initial.audience_members || initial.audience || [],
        slots: (initial.slots || []).length
          ? initial.slots.map((s) => ({
              id: s.id,
              title: s.title,
              description: s.description || '',
              is_required: s.is_required !== false,
              allowed_ext: s.allowed_ext || '.pdf,.docx,.xlsx,.zip',
              max_mb: s.max_mb || 25,
            }))
          : [newSlot()],
      })
    } else {
      setForm({ ...EMPTY, due_date: todayISO(), due_time: '16:30', slots: [newSlot()] })
    }
  }, [open, initial])

  useEffect(() => {
    const field = descriptionRef.current
    if (!field) return
    field.style.height = 'auto'
    field.style.height = `${field.scrollHeight}px`
  }, [form.description, open])

  if (!open) return null

  const update = (patch) => setForm((prev) => ({ ...prev, ...patch }))
  const updateSlot = (idx, patch) => setForm((prev) => ({
    ...prev,
    slots: prev.slots.map((s, i) => (i === idx ? { ...s, ...patch } : s)),
  }))
  const addSlot = () => setForm((prev) => ({ ...prev, slots: [...prev.slots, newSlot()] }))
  const removeSlot = (idx) => setForm((prev) => ({
    ...prev,
    slots: prev.slots.filter((_, i) => i !== idx),
  }))
  const moveSlot = (idx, delta) => setForm((prev) => {
    const next = [...prev.slots]
    const target = idx + delta
    if (target < 0 || target >= next.length) return prev
    ;[next[idx], next[target]] = [next[target], next[idx]]
    return { ...prev, slots: next }
  })

  const input = 'mt-1 w-full min-h-[40px] rounded-lg border border-slate-300 px-3 text-sm'
  const filledSlots = form.slots.filter((s) => s.title.trim()).length
  const recipientCount = (() => {
    if (form.target_type === 'all') return teachers.length
    const ids = new Set()
    for (const member of form.audience || []) {
      if (member.member_kind === 'teacher') ids.add(member.member_id)
      if (member.member_kind === 'dept') {
        teachers.forEach((teacher) => {
          if (teacher.dept === member.member_id) ids.add(teacher.teacher_id)
        })
      }
    }
    return ids.size
  })()

  async function submit(event) {
    event.preventDefault()
    setError(null)
    if (!form.title.trim()) return setError('กรุณากรอกชื่องาน')
    if (!form.due_date) return setError('กรุณาระบุกำหนดส่ง')
    if (form.open_time && !formatTime24(form.open_time)) return setError('เวลาเปิดรับไม่ถูกต้อง (HH:MM)')
    if (form.due_time && !formatTime24(form.due_time)) return setError('เวลากำหนดส่งไม่ถูกต้อง (HH:MM)')

    const openAt = joinDateTime(form.open_date, form.open_time, { fallbackTime: '00:00' })
    const dueAt = joinDateTime(form.due_date, form.due_time, { fallbackTime: '23:59' })
    if (openAt && dueAt && openAt > dueAt) return setError('เปิดรับต้องไม่หลังกำหนดส่ง')

    const slots = form.slots.filter((s) => s.title.trim())
    if (!slots.length) return setError('ต้องมีอย่างน้อย 1 กล่องรับไฟล์')

    setBusy(true)
    try {
      await onSave({
        title: form.title.trim(),
        description: form.description || '',
        open_at: openAt,
        due_datetime: dueAt,
        allow_late: !!form.allow_late,
        is_published: !!form.is_published,
        target_type: form.target_type,
        audience: form.audience || [],
        slots: slots.map((s, idx) => ({
          id: s.id || undefined,
          title: s.title.trim(),
          description: s.description || '',
          is_required: !!s.is_required,
          allowed_ext: s.allowed_ext,
          max_mb: Number(s.max_mb) || 25,
          sort_order: idx,
        })),
      })
    } catch (e) {
      setError(e.message || 'บันทึกไม่สำเร็จ')
    } finally {
      setBusy(false)
    }
  }

  return (
    <PortalModalShell
      title={initial ? 'แก้ไขงานส่งไฟล์' : 'สร้างงานส่งไฟล์'}
      onClose={onClose}
      onSubmit={submit}
      footer={(
        <>
          <p className="w-full sm:w-auto sm:mr-auto text-xs text-slate-600">
            จะแจ้งเตือนไปยังผู้ต้องส่ง {recipientCount} คน · {filledSlots} กล่อง
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
        {/* ── ซ้าย: ข้อมูลงาน + กล่องรับไฟล์ ───────────────────── */}
        <div className="space-y-2.5 min-w-0">
          <label className="block">
            <span className="text-sm font-semibold text-slate-700">ชื่องาน</span>
            <input
              value={form.title}
              onChange={(e) => update({ title: e.target.value })}
              maxLength={200}
              placeholder="เช่น ส่งแผนการจัดการเรียนรู้ ภาคเรียนที่ 2"
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
              <span className="text-xs font-semibold text-slate-600">เปิดรับตั้งแต่</span>
              <DateField
                block
                value={form.open_date}
                onChange={(value) => update({ open_date: value })}
                className="mt-1"
                title="เว้นว่าง = เปิดรับทันที"
              />
            </div>
            <div>
              <span className="text-xs font-semibold text-slate-600">เวลาเปิดรับ</span>
              <TimeField
                className="mt-1"
                value={form.open_time}
                disabled={!form.open_date}
                onChange={(value) => update({ open_time: value })}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <span className="text-xs font-semibold text-slate-600">กำหนดส่ง *</span>
              <DateField
                block
                value={form.due_date}
                onChange={(value) => update({ due_date: value })}
                className="mt-1"
              />
            </div>
            <div>
              <span className="text-xs font-semibold text-slate-600">เวลากำหนดส่ง</span>
              <TimeField
                className="mt-1"
                value={form.due_time}
                onChange={(value) => update({ due_time: value })}
              />
            </div>
          </div>

          <div className="flex flex-wrap gap-4 items-center">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={form.allow_late}
                onChange={(e) => update({ allow_late: e.target.checked })}
                className="w-4 h-4"
              />
              รับไฟล์หลังกำหนด (มาร์กส่งช้า)
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

          <div className="pt-1">
            <div className="flex items-center justify-between mb-1 gap-2">
              <p className="text-sm font-semibold text-slate-700 flex items-center gap-1.5">
                <Package className="w-4 h-4 text-amber-500" /> กล่องรับไฟล์ ({form.slots.length})
              </p>
              <button
                type="button"
                onClick={addSlot}
                className="min-h-[32px] px-2.5 rounded-lg border border-slate-300 text-xs font-semibold inline-flex items-center gap-1 bg-white"
              >
                <Plus className="w-3.5 h-3.5" /> เพิ่มกล่อง
              </button>
            </div>

            <div className="space-y-2">
              {form.slots.map((slot, idx) => (
                <div key={idx} className="rounded-xl border border-slate-200 p-2.5 space-y-2 bg-slate-50">
                  <div className="flex items-center gap-1.5">
                    <span className="text-[11px] font-bold text-slate-400 shrink-0">#{idx + 1}</span>
                    <input
                      value={slot.title}
                      onChange={(e) => updateSlot(idx, { title: e.target.value })}
                      placeholder="ชื่อกล่อง เช่น แผนการสอน"
                      className="flex-1 min-w-0 min-h-[34px] rounded-lg border border-slate-300 px-2 text-sm"
                    />
                    <button
                      type="button"
                      onClick={() => moveSlot(idx, -1)}
                      disabled={idx === 0}
                      className="p-1.5 rounded hover:bg-white disabled:opacity-30"
                      title="เลื่อนขึ้น"
                    >
                      <ArrowUp className="w-3.5 h-3.5 text-slate-500" />
                    </button>
                    <button
                      type="button"
                      onClick={() => moveSlot(idx, 1)}
                      disabled={idx === form.slots.length - 1}
                      className="p-1.5 rounded hover:bg-white disabled:opacity-30"
                      title="เลื่อนลง"
                    >
                      <ArrowDown className="w-3.5 h-3.5 text-slate-500" />
                    </button>
                    <button
                      type="button"
                      onClick={() => removeSlot(idx)}
                      disabled={form.slots.length === 1}
                      className="p-1.5 rounded hover:bg-rose-50 disabled:opacity-30"
                      title="ลบกล่อง"
                    >
                      <Trash2 className="w-3.5 h-3.5 text-rose-500" />
                    </button>
                  </div>

                  <input
                    value={slot.description}
                    onChange={(e) => updateSlot(idx, { description: e.target.value })}
                    placeholder="คำอธิบาย (ไม่บังคับ)"
                    className="w-full min-h-[32px] rounded-lg border border-slate-300 px-2 text-xs"
                  />

                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-slate-600">
                    <label className="flex items-center gap-1.5">
                      <input
                        type="checkbox"
                        checked={slot.is_required}
                        onChange={(e) => updateSlot(idx, { is_required: e.target.checked })}
                        className="w-3.5 h-3.5"
                      />
                      บังคับ
                    </label>
                    <label className="flex items-center gap-1.5">
                      ชนิดไฟล์
                      <select
                        value={slot.allowed_ext}
                        onChange={(e) => updateSlot(idx, { allowed_ext: e.target.value })}
                        className="min-h-[30px] rounded-lg border border-slate-300 px-1.5 text-xs bg-white"
                      >
                        {EXT_PRESETS.map((preset) => (
                          <option key={preset.value} value={preset.value}>{preset.label}</option>
                        ))}
                      </select>
                    </label>
                    <label className="flex items-center gap-1.5">
                      สูงสุด
                      <input
                        type="number"
                        min={1}
                        max={100}
                        value={slot.max_mb}
                        onChange={(e) => updateSlot(idx, { max_mb: e.target.value })}
                        className="w-16 min-h-[30px] rounded-lg border border-slate-300 px-1.5 text-xs"
                      />
                      MB
                    </label>
                  </div>
                </div>
              ))}
            </div>

            <p className="mt-1 text-[11px] text-slate-500">
              ⚠ การลบกล่องจะลบไฟล์ที่ครูส่งในกล่องนั้นด้วย
            </p>
          </div>
        </div>

        {/* ── ขวา: ผู้ต้องส่ง ───────────────────────────────────── */}
        <div className="min-w-0">
          <p className="text-sm font-semibold text-slate-700 mb-1">ผู้ต้องส่ง</p>
          <AudiencePicker
            teachers={teachers}
            depts={depts}
            value={{ target_type: form.target_type, audience: form.audience }}
            onChange={(next) => update({ target_type: next.target_type, audience: next.audience })}
          />
        </div>
      </div>
    </PortalModalShell>
  )
}
