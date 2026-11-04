import { useMemo, useState } from 'react'
import { AlertCircle, Archive, BookOpen, Download, FileSpreadsheet, Plus, Save, Trash2, User, Users, X } from 'lucide-react'
import {
  makeTraineeId,
  normalizeText,
  normalizeTraineeProfile,
  traineeDisplayLine,
  validateTraineeProfile,
} from '../../utils/traineeAttendance.js'
import TraineeDateField from './TraineeDateField.jsx'

const inputCls = 'w-full rounded-lg border border-slate-300 px-2.5 py-2 text-xs bg-white disabled:bg-slate-50'

function Field({ label, error, children, className = '' }) {
  return (
    <label className={`block text-xs font-semibold text-slate-600 ${className}`}>
      {label}
      <div className="mt-1">{children}</div>
      {error && <div className="mt-1 text-[10px] font-normal text-rose-600">{error}</div>}
    </label>
  )
}

function matchOption(options, value) {
  const q = normalizeText(value)
  return (options || []).find((o) => normalizeText(o.name) === q) || null
}

function blankAssignment() {
  return {
    id: makeTraineeId(),
    subjectId: '',
    subjectName: '',
    classId: '',
    className: '',
    roomIds: [],
    roomNames: [],
    weeklyPeriods: null,
    roomDraft: '',
  }
}

function blankTrainee() {
  return normalizeTraineeProfile({ assignments: [] })
}

export default function TraineeDirectoryPage({
  trainees = [], reference = null, canEdit = false,
  onSave, onArchive, onDelete, onTemplate, onImport, onExport,
}) {
  const [query, setQuery] = useState('')
  const [draft, setDraft] = useState(null)
  const [errors, setErrors] = useState({})

  const teachers = reference?.teachers || []
  const subjects = reference?.subjects || []
  const rooms = reference?.rooms || []

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return trainees.filter((t) => !q || [t.name, t.studentCode, t.major, t.institution, ...(t.mentorNames || [t.mentorTeacherName]), t.department]
      .filter(Boolean).join(' ').toLowerCase().includes(q))
  }, [trainees, query])

  function update(patch) {
    setDraft((prev) => ({ ...(prev || blankTrainee()), ...patch }))
  }

  function updateAssignment(index, patch) {
    setDraft((prev) => {
      const assignments = [...(prev?.assignments?.length ? prev.assignments : [blankAssignment()])]
      assignments[index] = { ...assignments[index], ...patch }
      return { ...prev, assignments }
    })
  }

  function addAssignment() {
    setDraft((prev) => ({ ...(prev || blankTrainee()), assignments: [...(prev?.assignments || []), blankAssignment()] }))
  }

  function removeAssignment(index) {
    setDraft((prev) => ({ ...prev, assignments: (prev.assignments || []).filter((_, i) => i !== index) }))
  }

  function addMentor(value) {
    const name = String(value || '').trim()
    if (!name) return
    setDraft((prev) => {
      const mentorNames = [...(prev?.mentorNames || [])]
      if (!mentorNames.some((m) => normalizeText(m) === normalizeText(name))) mentorNames.push(name)
      return { ...prev, mentorNames, mentorTeacherName: mentorNames[0] || '', mentorDraft: '' }
    })
  }

  function removeMentor(name) {
    setDraft((prev) => {
      const mentorNames = (prev.mentorNames || []).filter((m) => m !== name)
      return { ...prev, mentorNames, mentorTeacherName: mentorNames[0] || '' }
    })
  }

  function addRoom(index, value) {
    const name = String(value || '').trim()
    if (!name) return
    setDraft((prev) => {
      const assignments = [...(prev?.assignments?.length ? prev.assignments : [blankAssignment()])]
      const a = { ...assignments[index] }
      const roomNames = [...(a.roomNames || [])]
      if (!roomNames.some((r) => normalizeText(r) === normalizeText(name))) roomNames.push(name)
      const roomIds = [...(a.roomIds || [])]
      const matched = matchOption(rooms, name)
      if (matched && !roomIds.includes(matched.id)) roomIds.push(matched.id)
      assignments[index] = { ...a, roomDraft: '', roomNames, roomIds }
      return { ...prev, assignments }
    })
  }

  function removeRoom(index, name) {
    setDraft((prev) => {
      const assignments = [...(prev.assignments || [])]
      const a = { ...assignments[index] }
      const roomNames = (a.roomNames || []).filter((r) => r !== name)
      assignments[index] = {
        ...a,
        roomNames,
        roomIds: roomNames.map((room) => matchOption(rooms, room)?.id).filter(Boolean),
      }
      return { ...prev, assignments }
    })
  }

  function startEdit(t) {
    setDraft(normalizeTraineeProfile(t))
    setErrors({})
  }

  function handleSave() {
    const normalized = normalizeTraineeProfile(draft)
    const nextErrors = validateTraineeProfile(normalized)
    setErrors(nextErrors)
    if (Object.keys(nextErrors).length) return
    onSave?.(normalized)
    setDraft(normalized)
  }

  const assignments = draft?.assignments?.length ? draft.assignments : [blankAssignment()]

  return (
    <div className="grid grid-cols-1 xl:grid-cols-[360px_minmax(0,1fr)] gap-5">
      <section className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden h-fit">
        <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between gap-2">
          <div>
            <h3 className="text-sm font-bold text-slate-800 flex items-center gap-2"><Users className="w-4 h-4 text-violet-500" /> รายชื่อนักศึกษา</h3>
            <p className="text-[11px] text-slate-400 mt-0.5">{trainees.filter((t) => !t.archived).length} คนที่ใช้งานอยู่ · {trainees.filter((t) => t.archived).length} คนที่เก็บเข้าคลัง</p>
          </div>
          <button onClick={() => { setDraft(blankTrainee()); setErrors({}) }} disabled={!canEdit} className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold bg-violet-600 text-white hover:bg-violet-700 disabled:opacity-40">
            <Plus className="w-3.5 h-3.5" /> เพิ่ม
          </button>
        </div>
        <div className="p-3 border-b border-slate-100 flex flex-wrap gap-2">
          <button onClick={onTemplate} className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold bg-slate-50 text-slate-700 border border-slate-200 hover:bg-slate-100"><Download className="w-3.5 h-3.5" /> Template</button>
          <button onClick={onImport} disabled={!canEdit} className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-100 disabled:opacity-40"><FileSpreadsheet className="w-3.5 h-3.5" /> นำเข้า Excel</button>
          <button onClick={onExport} className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold bg-blue-50 text-blue-700 border border-blue-200 hover:bg-blue-100"><Download className="w-3.5 h-3.5" /> ส่งออก CSV</button>
        </div>
        <div className="p-3 border-b border-slate-100">
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="ค้นหาชื่อ / รหัส / สาขา / พี่เลี้ยง" className={inputCls} />
        </div>
        <div className="max-h-[70vh] overflow-y-auto divide-y divide-slate-100">
          {filtered.length === 0 ? (
            <div className="p-8 text-center text-slate-400"><User className="w-8 h-8 mx-auto mb-2 opacity-40" /><p className="text-xs">ยังไม่มีรายชื่อนักศึกษา</p></div>
          ) : filtered.map((t) => (
            <div key={t.id} role="button" tabIndex={0} onClick={() => startEdit(t)} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') startEdit(t) }} className={`w-full text-left px-3 py-2.5 hover:bg-slate-50 cursor-pointer ${t.archived ? 'opacity-60' : ''}`}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex items-center gap-2"><span className="text-sm font-semibold text-slate-800 truncate">{t.name}</span>{t.studentCode && <span className="text-[10px] text-slate-400">{t.studentCode}</span>}{t.archived && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-slate-200 text-slate-600">เก็บแล้ว</span>}</div>
                  <div className="text-[11px] text-slate-500 mt-0.5 truncate">{[t.major, t.institution].filter(Boolean).join(' · ') || '—'}</div>
                  <div className="text-[11px] text-slate-400 mt-0.5 truncate">{traineeDisplayLine(t) || 'ยังไม่กำหนดข้อมูลสอน'}</div>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <span className="p-1.5 rounded-lg text-slate-400 hover:text-violet-600 hover:bg-violet-50"><BookOpen className="w-3.5 h-3.5" /></span>
                  <button onClick={(e) => { e.stopPropagation(); onArchive?.(t.id, !t.archived) }} disabled={!canEdit} className="p-1.5 rounded-lg text-slate-400 hover:text-amber-600 hover:bg-amber-50 disabled:opacity-30" title={t.archived ? 'นำกลับมาใช้' : 'เก็บเข้าคลัง'}><Archive className="w-3.5 h-3.5" /></button>
                  <button onClick={(e) => { e.stopPropagation(); onDelete?.(t) }} disabled={!canEdit} className="p-1.5 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 disabled:opacity-30" title="ลบถาวร"><Trash2 className="w-3.5 h-3.5" /></button>
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white shadow-sm p-4">
        {!draft ? (
          <div className="h-full min-h-[320px] flex flex-col items-center justify-center text-center text-slate-400"><User className="w-10 h-10 mb-3 opacity-30" /><p className="text-sm font-semibold text-slate-500">เลือกรายชื่อจากด้านซ้าย หรือกดเพิ่มนักศึกษา</p><p className="text-xs mt-1">ฟอร์มนี้ใช้แก้ไขข้อมูลรายคนได้ครบทุกฟิลด์</p></div>
        ) : (
          <div className="space-y-5">
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-base font-bold text-slate-900">{trainees.some((t) => t.id === draft.id) ? 'แก้ไขข้อมูลนักศึกษา' : 'เพิ่มนักศึกษาใหม่'}</h3>
              <button onClick={handleSave} disabled={!canEdit} className="flex items-center gap-1 px-3 py-2 rounded-lg text-xs font-semibold bg-violet-600 text-white hover:bg-violet-700 disabled:opacity-40"><Save className="w-3.5 h-3.5" /> บันทึก</button>
            </div>
            {Object.keys(errors).length > 0 && <div className="flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700"><AlertCircle className="w-4 h-4 shrink-0 mt-0.5" /> ตรวจสอบข้อมูลที่เน้นแดงอีกครั้ง</div>}

            <div className="rounded-xl border border-slate-100 bg-slate-50/60 p-3">
              <h4 className="text-xs font-bold text-slate-700 mb-3">ข้อมูลพื้นฐาน</h4>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <Field label="ชื่อ–นามสกุล *" error={errors.name} className="md:col-span-2"><input value={draft.name || ''} onChange={(e) => update({ name: e.target.value })} disabled={!canEdit} className={inputCls} /></Field>
                <Field label="รหัสนักศึกษา"><input value={draft.studentCode || ''} onChange={(e) => update({ studentCode: e.target.value })} disabled={!canEdit} className={inputCls} /></Field>
                <Field label="วิชาเอก"><input value={draft.major || ''} onChange={(e) => update({ major: e.target.value })} disabled={!canEdit} className={inputCls} /></Field>
                <Field label="สถาบัน" className="md:col-span-2"><input value={draft.institution || ''} onChange={(e) => update({ institution: e.target.value })} disabled={!canEdit} className={inputCls} /></Field>
              </div>
            </div>

            <div className="rounded-xl border border-slate-100 bg-slate-50/60 p-3">
              <h4 className="text-xs font-bold text-slate-700 mb-3">ข้อมูลติดต่อ</h4>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <Field label="เบอร์โทร"><input value={draft.phone || ''} onChange={(e) => update({ phone: e.target.value })} disabled={!canEdit} className={inputCls} /></Field>
                <Field label="อีเมล" error={errors.email}><input type="email" value={draft.email || ''} onChange={(e) => update({ email: e.target.value })} disabled={!canEdit} className={inputCls} /></Field>
                <Field label="อาจารย์นิเทศ"><input value={draft.advisorName || ''} onChange={(e) => update({ advisorName: e.target.value })} disabled={!canEdit} className={inputCls} /></Field>
              </div>
            </div>

            <div className="rounded-xl border border-slate-100 bg-slate-50/60 p-3">
              <h4 className="text-xs font-bold text-slate-700 mb-3">ช่วงฝึกงาน</h4>
              <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                <Field label="วันเริ่ม"><TraineeDateField value={draft.internshipStart || ''} onChange={(value) => update({ internshipStart: value })} disabled={!canEdit} /></Field>
                <Field label="วันสิ้นสุด" error={errors.internshipEnd}><TraineeDateField value={draft.internshipEnd || ''} onChange={(value) => update({ internshipEnd: value })} disabled={!canEdit} /></Field>
                <Field label="หน่วยงาน/โรงเรียน"><input value={draft.workplace || ''} onChange={(e) => update({ workplace: e.target.value })} disabled={!canEdit} className={inputCls} /></Field>
                <Field label="แผนก/กลุ่มสาระ"><input value={draft.department || ''} onChange={(e) => update({ department: e.target.value })} disabled={!canEdit} className={inputCls} /></Field>
              </div>
            </div>

            <div className="rounded-xl border border-slate-100 bg-slate-50/60 p-3">
              <h4 className="text-xs font-bold text-slate-700 mb-3">ครูพี่เลี้ยง</h4>
              <Field label="เพิ่มครูพี่เลี้ยง">
                <input list="mentor-options" value={draft.mentorDraft || ''} onChange={(e) => update({ mentorDraft: e.target.value })} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addMentor(e.currentTarget.value) } }} onBlur={(e) => addMentor(e.target.value)} disabled={!canEdit} className={inputCls} placeholder="พิมพ์แล้วกด Enter เพื่อเพิ่ม" />
                <datalist id="mentor-options">{teachers.map((t) => <option key={t.id} value={t.name} />)}</datalist>
              </Field>
              {(draft.mentorNames || []).length > 0 && (
                <div className="flex flex-wrap gap-1.5 mt-3">
                  {draft.mentorNames.map((name) => (
                    <span key={name} className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-violet-50 text-violet-700 text-[11px]">
                      {name}
                      <button type="button" onClick={() => removeMentor(name)} disabled={!canEdit} className="hover:text-rose-600 disabled:opacity-40"><X className="w-3 h-3" /></button>
                    </span>
                  ))}
                </div>
              )}
            </div>

            <div className="rounded-xl border border-slate-100 bg-slate-50/60 p-3">
              <div className="flex items-center justify-between gap-3 mb-3"><h4 className="text-xs font-bold text-slate-700">วิชาที่สอน / ห้องเรียน</h4><button type="button" onClick={addAssignment} disabled={!canEdit} className="flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-semibold bg-violet-50 text-violet-700 hover:bg-violet-100 disabled:opacity-40"><Plus className="w-3 h-3" /> เพิ่มวิชา</button></div>

              <div className="space-y-3">
                {assignments.map((a, index) => (
                  <div key={a.id || index} className="rounded-lg border border-slate-200 bg-white p-3">
                    <div className="flex items-center justify-between gap-2 mb-3"><div className="text-[11px] font-bold text-slate-500">วิชาที่ {index + 1}</div><button type="button" onClick={() => removeAssignment(index)} disabled={!canEdit || assignments.length === 1} className="text-slate-300 hover:text-rose-600 disabled:opacity-30"><X className="w-3.5 h-3.5" /></button></div>
                    <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                      <Field label="วิชาที่สอน">
                        <input list={`subject-options-${index}`} value={a.subjectName || ''} onChange={(e) => { const s = matchOption(subjects, e.target.value); updateAssignment(index, { subjectName: e.target.value, subjectId: s?.id || '' }) }} onKeyDown={(e) => { if (e.key === 'Enter') e.preventDefault() }} disabled={!canEdit} className={inputCls} />
                        <datalist id={`subject-options-${index}`}>{subjects.map((s) => <option key={s.id} value={s.name} />)}</datalist>
                      </Field>
                      <Field label="ชั้นเรียน">
                        <input value={a.className || ''} onChange={(e) => updateAssignment(index, { className: e.target.value, classId: '' })} disabled={!canEdit} className={inputCls} placeholder="พิมพ์ชั้นเรียนเอง" />
                      </Field>
                      <Field label="คาบ/สัปดาห์" error={index === 0 ? errors.weeklyPeriods : ''}>
                        <input type="number" min="0" value={a.weeklyPeriods ?? ''} onChange={(e) => updateAssignment(index, { weeklyPeriods: e.target.value })} disabled={!canEdit} className={inputCls} />
                      </Field>
                      <Field label="เพิ่มห้องเรียน">
                        <input list={`room-options-${index}`} value={a.roomDraft || ''} onChange={(e) => updateAssignment(index, { roomDraft: e.target.value })} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addRoom(index, e.currentTarget.value) } }} onBlur={(e) => addRoom(index, e.target.value)} disabled={!canEdit} className={inputCls} placeholder="พิมพ์แล้วกด Enter" />
                        <datalist id={`room-options-${index}`}>{rooms.map((r) => <option key={r.id} value={r.name} />)}</datalist>
                      </Field>
                    </div>
                    {(a.roomNames || []).length > 0 && <div className="flex flex-wrap gap-1.5 mt-3">{(a.roomNames || []).map((room) => <span key={room} className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-indigo-50 text-indigo-700 text-[11px]">{room}<button type="button" onClick={() => removeRoom(index, room)} disabled={!canEdit} className="hover:text-rose-600 disabled:opacity-40"><X className="w-3 h-3" /></button></span>)}</div>}
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-xl border border-slate-100 bg-slate-50/60 p-3">
              <h4 className="text-xs font-bold text-slate-700 mb-3">หมายเหตุรายคน</h4>
              <textarea value={draft.note || ''} onChange={(e) => update({ note: e.target.value })} disabled={!canEdit} rows={3} className={`${inputCls} resize-y`} />
            </div>

            <div className="sticky bottom-0 -mx-4 px-4 py-3 bg-white/95 border-t border-slate-200 flex justify-end">
              <button onClick={handleSave} disabled={!canEdit} className="flex items-center gap-1 px-4 py-2 rounded-lg text-sm font-bold bg-violet-600 text-white hover:bg-violet-700 disabled:opacity-40"><Save className="w-4 h-4" /> บันทึกข้อมูลนักศึกษา</button>
            </div>
          </div>
        )}
      </section>
    </div>
  )
}
