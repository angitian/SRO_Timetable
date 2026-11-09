import { useState, useMemo } from 'react'
import { X, UserX, CalendarClock, Check, Trash2, ArrowRight } from 'lucide-react'
import { computeNeededPerTeacher } from '../../utils/teacherLoad.js'
import { getPeriodDisplayLabel } from '../../utils/periodLabels.js'

const DAY_LABELS = ['', 'จันทร์', 'อังคาร', 'พุธ', 'พฤหัสบดี', 'ศุกร์', 'เสาร์', 'อาทิตย์']
const PERIODS = Array.from({ length: 12 }, (_, i) => i + 1)

/**
 * SubstituteManagerModal — จัดการคาบสอนแทน
 *
 * เลือกครูที่ลา + วัน + คาบ → โชว์วิชา/ห้องที่ครูคนนั้นสอนคาบนั้น
 * + รายชื่อครูที่ว่างคาบนั้น (เลือกได้ว่าให้ใครสอนแทน)
 */
export default function SubstituteManagerModal({
  isOpen = false,
  onClose,
  teachers = [],
  classes = [],
  subjects = [],
  lessonBlocks = [],
  slots = [],
  userPlacements = {},
  substitutes = [],
  days = 5,
  periods = 8,
  periodLabelMap,
  onSet,
  onRemove,
}) {
  const [absentTeacherId, setAbsentTeacherId] = useState('')
  const [day, setDay] = useState(1)
  const [period, setPeriod] = useState(1)

  const lessonBlockMap = useMemo(
    () => new Map(lessonBlocks.map((lb) => [lb.id, lb])),
    [lessonBlocks],
  )
  const classMap = useMemo(() => new Map(classes.map((c) => [c.id, c])), [classes])
  const subjectMap = useMemo(() => new Map(subjects.map((s) => [s.id, s])), [subjects])

  // ── 1. ครูที่ลา สอนอะไรคาบนั้น (จาก result slots + userPlacements) ──
  const absentSlots = useMemo(() => {
    if (!absentTeacherId) return []
    const res = []
    const coName = (coId) => (coId ? (teachers.find((t) => t.id === coId)?.name || coId) : null)
    for (const s of slots) {
      const lb = s.lesson_block_id ? lessonBlockMap.get(s.lesson_block_id) : null
      const coId = s.co_teacher_id || lb?.co_teacher_id || null
      if (s.teacher_id === absentTeacherId && s.day === day && s.period === period) {
        res.push({ class_id: s.class_id, subject_id: s.subject_id, co_teacher: coName(coId) })
      }
      // คาบที่ครูคนนี้เป็น "ครูร่วม" ก็ต้องถือเป็นคาบที่ต้องหาคนแทน
      if (coId === absentTeacherId && s.day === day && s.period === period) {
        res.push({ class_id: s.class_id, subject_id: s.subject_id, is_co_role: true, co_teacher: null })
      }
    }
    for (const [lbId, placements] of Object.entries(userPlacements || {})) {
      const lb = lessonBlockMap.get(lbId)
      if (!lb) continue
      if (placements.some((p) => p.day === day && p.period === period)) {
        if (lb.teacher_id === absentTeacherId) {
          res.push({ class_id: lb.class_id, subject_id: lb.subject_id, co_teacher: coName(lb.co_teacher_id) })
        } else if (lb.co_teacher_id === absentTeacherId) {
          res.push({ class_id: lb.class_id, subject_id: lb.subject_id, is_co_role: true, co_teacher: null })
        }
      }
    }
    return res
  }, [absentTeacherId, day, period, slots, userPlacements, lessonBlockMap, teachers])

  // ── 2. ครูที่ว่างคาบนั้น ──
  const freeTeachers = useMemo(() => {
    const busy = new Set()
    for (const s of slots) {
      if (s.day === day && s.period === period) {
        busy.add(s.teacher_id)
        const lb = lessonBlockMap.get(s.lesson_block_id)
        if (lb && lb.co_teacher_id) busy.add(lb.co_teacher_id)
      }
    }
    for (const [lbId, placements] of Object.entries(userPlacements || {})) {
      if (!placements.some((p) => p.day === day && p.period === period)) continue
      const lb = lessonBlockMap.get(lbId)
      if (lb) {
        busy.add(lb.teacher_id)
        if (lb.co_teacher_id) busy.add(lb.co_teacher_id)
      }
    }
    const key = `${day}-${period}`
    return teachers.filter((t) => (
      t.id !== absentTeacherId &&
      !busy.has(t.id) &&
      !(t.unavailable_slots || []).includes(key) &&
      !(t.admin_free_slots || []).includes(key)
    ))
  }, [teachers, absentTeacherId, day, period, slots, userPlacements, lessonBlockMap])

  // ── 3. ครูว่าง + ภาระ (ภาระปกติ + สอนแทนแล้ว) เรียงรวมน้อยสุดก่อน ──
  const freeTeacherRows = useMemo(() => {
    const needed = computeNeededPerTeacher(lessonBlocks || [])
    const subCounts = {}
    for (const s of substitutes || []) {
      subCounts[s.substitute_teacher_id] = (subCounts[s.substitute_teacher_id] || 0) + 1
    }
    return freeTeachers
      .map((t) => ({ teacher: t, base: needed[t.id] || 0, sub: subCounts[t.id] || 0 }))
      .sort((a, b) => (a.base + a.sub) - (b.base + b.sub) || (a.teacher.name || '').localeCompare(b.teacher.name || '', 'th'))
  }, [freeTeachers, lessonBlocks, substitutes])

  const periodDays = Array.from({ length: Math.max(1, days) }, (_, i) => i + 1)
  const periodNums = PERIODS.slice(0, Math.max(1, periods))

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[85vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200 sticky top-0 bg-white rounded-t-2xl z-10">
          <div className="flex items-center gap-2">
            <CalendarClock className="w-5 h-5 text-orange-600" />
            <h3 className="text-lg font-bold text-gray-900">จัดการคาบสอนแทน</h3>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg text-gray-400 hover:bg-gray-100 hover:text-gray-600" aria-label="ปิด">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="px-5 py-4 space-y-5">
          {/* ── Selector: ครูที่ลา + วัน + คาบ ── */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="text-xs font-medium text-gray-600 block mb-1">ครูที่ลา / ไม่มา</label>
              <select
                value={absentTeacherId}
                onChange={(e) => setAbsentTeacherId(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-2 py-1.5 text-sm"
              >
                <option value="">เลือกครู…</option>
                {teachers.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs font-medium text-gray-600 block mb-1">วัน</label>
              <select
                value={day}
                onChange={(e) => setDay(parseInt(e.target.value))}
                className="w-full border border-gray-300 rounded-lg px-2 py-1.5 text-sm"
              >
                {periodDays.map((d) => <option key={d} value={d}>{DAY_LABELS[d] || `วัน${d}`}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs font-medium text-gray-600 block mb-1">คาบ</label>
              <select
                value={period}
                onChange={(e) => setPeriod(parseInt(e.target.value))}
                className="w-full border border-gray-300 rounded-lg px-2 py-1.5 text-sm"
              >
                {periodNums.map((p) => {
                  const label = getPeriodDisplayLabel(p, periodLabelMap)
                  return <option key={p} value={p} disabled={label === 'พักเที่ยง'}>{label === 'พักเที่ยง' ? label : `คาบที่ ${label}`}</option>
                })}
              </select>
            </div>
          </div>

          {/* ── คาบของครูที่ลา ── */}
          <div className="bg-orange-50/60 border border-orange-200 rounded-lg p-3">
            <div className="text-xs font-bold text-orange-700 mb-1.5 flex items-center gap-1">
              <UserX className="w-3.5 h-3.5" />
              {absentTeacherId
                ? `${teachers.find((t) => t.id === absentTeacherId)?.name || ''} สอนคาบนี้:`
                : 'เลือกครูก่อนเพื่อดูคาบที่ต้องหาคนสอนแทน'}
            </div>
            {absentSlots.length === 0 ? (
              <p className="text-xs text-orange-400 italic">
                {absentTeacherId ? 'ครูคนนี้ไม่มีคาบเรียนในวัน/คาบนี้ (หรือยังไม่ได้จัด)' : '—'}
              </p>
            ) : (
              <div className="space-y-1">
                {absentSlots.map((s, i) => (
                  <div key={i} className="flex items-center gap-2 text-sm">
                    <span className="font-medium text-gray-800">
                      {subjectMap.get(s.subject_id)?.name || s.subject_id}
                    </span>
                    <span className="text-gray-400">·</span>
                    <span className="text-gray-600">{classMap.get(s.class_id)?.name || s.class_id}</span>
                    {s.is_co_role && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-indigo-100 text-indigo-700 font-medium">ตำแหน่งครูร่วม</span>
                    )}
                    {s.co_teacher && (
                      <span className="text-[10px] text-gray-400">+ ครูร่วม {s.co_teacher}</span>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* ── ครูที่ว่างคาบนี้ ── */}
          <div>
            <div className="text-sm font-bold text-gray-700 mb-2">
              ครูที่ว่างคาบนี้ ({absentTeacherId ? freeTeacherRows.length : 0})
              <span className="text-xs font-normal text-gray-400 ml-2">— เลือกว่าจะให้ใครสอนแทน (เรียงตามภาระน้อยสุด)</span>
            </div>
            {absentSlots.length === 0 ? (
              <p className="text-xs text-gray-400 italic py-2">ไม่มีคาบให้จัดการในวัน/คาบนี้</p>
            ) : freeTeacherRows.length === 0 ? (
              <p className="text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                ไม่มีครูว่างในคาบนี้ — ต้องสลับคาบอื่นก่อน หรือปล่อยไว้ (คาบนี้จะไม่มีครูสอนแทน)
              </p>
            ) : (
              <div className="space-y-1.5">
                {freeTeacherRows.map(({ teacher: t, base, sub }) => {
                  const already = substitutes.find(
                    (s) => s.day === day && s.period === period && s.class_id === absentSlots[0].class_id,
                  )
                  const isCurrent = already?.substitute_teacher_id === t.id
                  return (
                    <div key={t.id} className="flex items-center justify-between bg-white border border-gray-200 rounded-lg px-3 py-2">
                      <div className="min-w-0">
                        <div className="text-sm font-medium text-gray-800 truncate">{t.name}</div>
                        <div className="text-[11px] text-gray-400">
                          ภาระ {base} คาบ/สัปดาห์ · สอนแทนแล้ว {sub} คาบ
                        </div>
                      </div>
                      <button
                        onClick={() => {
                          for (const s of absentSlots) {
                            onSet?.({
                              day, period,
                              class_id: s.class_id,
                              subject_id: s.subject_id,
                              original_teacher_id: absentTeacherId,
                              substitute_teacher_id: t.id,
                            })
                          }
                        }}
                        className={`shrink-0 inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors
                          ${isCurrent
                            ? 'bg-emerald-100 text-emerald-700 border border-emerald-300'
                            : 'bg-orange-600 text-white hover:bg-orange-700'}`}
                      >
                        {isCurrent ? <><Check className="w-3 h-3" /> สอนแทนนี้แล้ว</> : 'ให้สอนแทน'}
                      </button>
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          {/* ── รายการที่บันทึกแล้ว ── */}
          {substitutes.length > 0 && (
            <div>
              <div className="text-sm font-bold text-gray-700 mb-2">รายการสอนแทนที่ตั้งไว้ ({substitutes.length})</div>
              <div className="space-y-1.5">
                {substitutes.map((s) => (
                  <div key={s.id} className="flex items-center gap-2 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-sm">
                    <span className="font-medium text-gray-700 shrink-0">
                      {DAY_LABELS[s.day] || `วัน${s.day}`} คาบ {getPeriodDisplayLabel(s.period, periodLabelMap)}
                    </span>
                    <span className="text-gray-400 shrink-0">·</span>
                    <span className="text-gray-600 shrink-0">{classMap.get(s.class_id)?.name || s.class_id}</span>
                    <span className="text-gray-400 shrink-0">·</span>
                    <span className="text-gray-500 truncate">
                      {teachers.find((t) => t.id === s.original_teacher_id)?.name || s.original_teacher_id}
                    </span>
                    <ArrowRight className="w-3.5 h-3.5 text-orange-500 shrink-0" />
                    <span className="font-medium text-orange-700 truncate">
                      {teachers.find((t) => t.id === s.substitute_teacher_id)?.name || s.substitute_teacher_id}
                    </span>
                    <button
                      onClick={() => onRemove?.(s.id)}
                      className="ml-auto text-red-400 hover:text-red-600 shrink-0"
                      title="ยกเลิกสอนแทน"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-gray-200 sticky bottom-0 bg-white rounded-b-2xl">
          <button
            onClick={onClose}
            className="w-full px-4 py-2.5 text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-xl transition-colors"
          >
            ปิด
          </button>
        </div>
      </div>
    </div>
  )
}
