import { useMemo, useState } from 'react'
import { Archive, BookOpen, GraduationCap, Plus, Save, Trash2, User, X } from 'lucide-react'
import { makeTraineeId } from '../../utils/traineeAttendance.js'

function blankTrainee() {
  return {
    id: makeTraineeId(),
    studentCode: '',
    name: '',
    major: '',
    institution: '',
    mentorTeacherId: '',
    mentorTeacherName: '',
    subjectId: '',
    subjectName: '',
    classId: '',
    className: '',
    roomId: '',
    roomName: '',
    weeklyPeriods: '',
    archived: false,
  }
}

export default function TraineeDirectoryDrawer({ trainees, reference, canEdit, onSave, onArchive, onClose }) {
  const [editing, setEditing] = useState(null)
  const [query, setQuery] = useState('')

  const teachers = reference?.teachers || []
  const subjects = reference?.subjects || []
  const classes = reference?.classes || []
  const rooms = reference?.rooms || []

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return trainees.filter((t) => {
      if (!q) return true
      return [t.name, t.studentCode, t.major, t.institution].filter(Boolean).join(' ').toLowerCase().includes(q)
    })
  }, [trainees, query])

  function startAdd() {
    setEditing(blankTrainee())
  }

  function update(patch) {
    setEditing((prev) => ({ ...prev, ...patch }))
  }

  function pickTeacher(id) {
    const t = teachers.find((x) => x.id === id)
    update({ mentorTeacherId: id, mentorTeacherName: t?.name || '' })
  }
  function pickSubject(id) {
    const s = subjects.find((x) => x.id === id)
    update({ subjectId: id, subjectName: s?.name || '' })
  }
  function pickClass(id) {
    const c = classes.find((x) => x.id === id)
    update({ classId: id, className: c?.name || '' })
  }
  function pickRoom(id) {
    const r = rooms.find((x) => x.id === id)
    update({ roomId: id, roomName: r?.name || '' })
  }

  function handleSave() {
    if (!editing?.name?.trim()) return
    onSave({
      ...editing,
      name: editing.name.trim(),
      weeklyPeriods: editing.weeklyPeriods === '' ? null : Number(editing.weeklyPeriods) || 0,
      updatedAt: new Date().toISOString(),
      createdAt: editing.createdAt || new Date().toISOString(),
    })
    setEditing(null)
  }

  return (
    <div className="fixed inset-0 z-[125] flex justify-end">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative w-full max-w-xl h-full bg-white shadow-2xl flex flex-col">
        <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
          <div>
            <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
              <GraduationCap className="w-4 h-4 text-violet-600" />
              จัดการรายชื่อนักศึกษา
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">ดึงครู วิชา ชั้น ห้อง และคาบจาก workspace เป็นข้อมูลอ้างอิง</p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-100" aria-label="ปิด">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-5 py-3 border-b border-slate-100 flex items-center gap-2">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="ค้นหาชื่อ / รหัส / สาขา"
            className="flex-1 border border-slate-300 rounded-lg px-3 py-1.5 text-sm"
          />
          <button
            onClick={startAdd}
            disabled={!canEdit}
            className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold bg-violet-600 text-white hover:bg-violet-700 disabled:opacity-40"
          >
            <Plus className="w-3.5 h-3.5" />
            เพิ่ม
          </button>
        </div>

        {editing && (
          <div className="px-5 py-4 border-b border-slate-200 bg-violet-50/40 space-y-3">
            <div className="text-sm font-bold text-slate-800">{editing.createdAt ? 'แก้ไขข้อมูล' : 'เพิ่มนักศึกษาใหม่'}</div>
            <div className="grid grid-cols-2 gap-2">
              <label className="text-xs text-slate-600 col-span-2">
                ชื่อ–นามสกุล *
                <input value={editing.name} onChange={(e) => update({ name: e.target.value })} className="mt-1 w-full border border-slate-300 rounded-lg px-2 py-1.5 text-sm" />
              </label>
              <label className="text-xs text-slate-600">
                รหัสนักศึกษา
                <input value={editing.studentCode || ''} onChange={(e) => update({ studentCode: e.target.value })} className="mt-1 w-full border border-slate-300 rounded-lg px-2 py-1.5 text-sm" />
              </label>
              <label className="text-xs text-slate-600">
                วิชาเอก
                <input value={editing.major || ''} onChange={(e) => update({ major: e.target.value })} className="mt-1 w-full border border-slate-300 rounded-lg px-2 py-1.5 text-sm" />
              </label>
              <label className="text-xs text-slate-600 col-span-2">
                สถาบัน
                <input value={editing.institution || ''} onChange={(e) => update({ institution: e.target.value })} className="mt-1 w-full border border-slate-300 rounded-lg px-2 py-1.5 text-sm" />
              </label>
              <label className="text-xs text-slate-600">
                ครูพี่เลี้ยง
                <select value={editing.mentorTeacherId || ''} onChange={(e) => pickTeacher(e.target.value)} className="mt-1 w-full border border-slate-300 rounded-lg px-2 py-1.5 text-sm">
                  <option value="">— เลือกครู —</option>
                  {teachers.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
              </label>
              <label className="text-xs text-slate-600">
                วิชาที่สอน
                <select value={editing.subjectId || ''} onChange={(e) => pickSubject(e.target.value)} className="mt-1 w-full border border-slate-300 rounded-lg px-2 py-1.5 text-sm">
                  <option value="">— เลือกวิชา —</option>
                  {subjects.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </label>
              <label className="text-xs text-slate-600">
                ชั้นเรียน
                <select value={editing.classId || ''} onChange={(e) => pickClass(e.target.value)} className="mt-1 w-full border border-slate-300 rounded-lg px-2 py-1.5 text-sm">
                  <option value="">— เลือกชั้น —</option>
                  {classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </label>
              <label className="text-xs text-slate-600">
                ห้อง
                <select value={editing.roomId || ''} onChange={(e) => pickRoom(e.target.value)} className="mt-1 w-full border border-slate-300 rounded-lg px-2 py-1.5 text-sm">
                  <option value="">— เลือกห้อง —</option>
                  {rooms.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                </select>
              </label>
              <label className="text-xs text-slate-600">
                คาบ/สัปดาห์
                <input type="number" min="0" value={editing.weeklyPeriods ?? ''} onChange={(e) => update({ weeklyPeriods: e.target.value })} className="mt-1 w-full border border-slate-300 rounded-lg px-2 py-1.5 text-sm" />
              </label>
            </div>
            <div className="flex justify-end gap-2">
              <button onClick={() => setEditing(null)} className="px-3 py-1.5 rounded-lg text-xs font-semibold text-slate-600 bg-slate-100 hover:bg-slate-200">ยกเลิก</button>
              <button onClick={handleSave} disabled={!editing.name.trim()} className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold bg-violet-600 text-white hover:bg-violet-700 disabled:opacity-40">
                <Save className="w-3.5 h-3.5" />
                บันทึก
              </button>
            </div>
          </div>
        )}

        <div className="flex-1 overflow-y-auto px-5 py-3 space-y-2">
          {filtered.length === 0 ? (
            <div className="text-center py-12 text-slate-400">
              <User className="w-8 h-8 mx-auto mb-2 opacity-40" />
              <p className="text-sm">ยังไม่มีรายชื่อนักศึกษา</p>
            </div>
          ) : filtered.map((t) => (
            <div key={t.id} className={`rounded-xl border px-3 py-2.5 ${t.archived ? 'border-slate-200 bg-slate-50 opacity-70' : 'border-slate-200 bg-white'}`}>
              <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-slate-800 truncate">{t.name}</span>
                    {t.studentCode && <span className="text-[10px] text-slate-400">{t.studentCode}</span>}
                    {t.archived && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-slate-200 text-slate-600">เก็บแล้ว</span>}
                  </div>
                  <div className="text-[11px] text-slate-500 mt-0.5 truncate">
                    {[t.major, t.institution].filter(Boolean).join(' · ')}
                  </div>
                  <div className="text-[11px] text-slate-400 mt-0.5 truncate">
                    {[t.mentorTeacherName, [t.subjectName, t.className].filter(Boolean).join(' / '), t.roomName, t.weeklyPeriods ? `${t.weeklyPeriods} คาบ/สัปดาห์` : ''].filter(Boolean).join(' · ') || 'ยังไม่กำหนดข้อมูลสอน'}
                  </div>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button onClick={() => setEditing({ ...t })} disabled={!canEdit} className="p-1.5 rounded-lg text-slate-400 hover:text-violet-600 hover:bg-violet-50 disabled:opacity-30" title="แก้ไข">
                    <BookOpen className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => onArchive(t.id, !t.archived)}
                    disabled={!canEdit}
                    className="p-1.5 rounded-lg text-slate-400 hover:text-amber-600 hover:bg-amber-50 disabled:opacity-30"
                    title={t.archived ? 'นำกลับมาใช้' : 'เก็บเข้าคลัง'}
                  >
                    <Archive className="w-3.5 h-3.5" />
                  </button>
                  <button onClick={() => onArchive(t.id, true, true)} disabled={!canEdit} className="p-1.5 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 disabled:opacity-30" title="ลบรายชื่อ">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
