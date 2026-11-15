import { useMemo, useRef, useState } from 'react'
import { Users, Search, Check, X, Plus, Trash2 } from 'lucide-react'
import {
  audienceSelectionGroups, isAudienceMember, removeAudienceMember, toggleAudienceMember,
} from './portalUtils.js'

/**
 * ตัวเลือกผู้เข้าร่วม/ผู้ต้องส่ง
 * value = { target_type, audience: [{member_kind, member_id}] }
 */
export default function AudiencePicker({
  teachers = [], depts = [], classes = [], allowClasses = false, value, onChange,
}) {
  const targetType = value?.target_type || 'all'
  const members = value?.audience || []
  const [tab, setTab] = useState(allowClasses ? 'class' : 'teacher')
  const [query, setQuery] = useState('')
  const [highlight, setHighlight] = useState(0)
  const inputRef = useRef(null)

  const groups = useMemo(
    () => audienceSelectionGroups(members, teachers, classes),
    [members, teachers, classes],
  )
  const normalizedQuery = query.trim().toLocaleLowerCase()

  const filteredTeachers = useMemo(() => {
    if (!normalizedQuery) return teachers
    return teachers.filter((teacher) => [
      teacher.display_name,
      teacher.full_name,
      teacher.teacher_id,
      teacher.dept,
      teacher.subject,
      Array.isArray(teacher.subjects) ? teacher.subjects.join(' ') : teacher.subjects,
    ].some((value) => String(value || '').toLocaleLowerCase().includes(normalizedQuery)))
  }, [teachers, normalizedQuery])

  const filteredClasses = useMemo(() => (
    normalizedQuery
      ? classes.filter((cls) => String(cls.name || '').toLocaleLowerCase().includes(normalizedQuery))
      : classes
  ), [classes, normalizedQuery])

  const suggestions = useMemo(() => {
    if (tab !== 'teacher' || !normalizedQuery) return []
    return filteredTeachers
      .filter((teacher) => !isAudienceMember(members, 'teacher', teacher.teacher_id))
      .slice(0, 6)
  }, [filteredTeachers, normalizedQuery, tab, members])

  function emit(nextTargetType, nextMembers) {
    onChange?.({ target_type: nextTargetType, audience: nextMembers })
  }

  function toggle(kind, id) {
    emit('custom', toggleAudienceMember(members, kind, id))
  }

  function addTeacher(teacher) {
    if (!teacher) return
    emit('custom', toggleAudienceMember(members, 'teacher', teacher.teacher_id))
    setQuery('')
    setHighlight(0)
    inputRef.current?.focus()
  }

  const selectedCount = groups.depts.length + groups.classes.length + groups.teachers.length
  const hasSelection = selectedCount > 0
  const tabs = [
    ...(allowClasses ? [{ id: 'class', label: 'ห้องเรียน', count: groups.classes.length }] : []),
    { id: 'teacher', label: 'ครูรายคน', count: groups.teachers.length },
  ]
  const activeTab = tabs.some((item) => item.id === tab) ? tab : tabs[0].id

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3 space-y-3">
      {/* แถว 1: โหมดการเลือก + จำนวนที่เลือก */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => emit('all', [])}
            aria-pressed={targetType === 'all'}
            className={`min-h-[36px] px-3 rounded-lg text-xs font-bold border inline-flex items-center gap-1.5
              ${targetType === 'all' ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-slate-600 border-slate-300'}`}
          >
            <Users className="w-3.5 h-3.5" /> ทุกคน
          </button>
          <button
            type="button"
            onClick={() => emit('custom', members)}
            aria-pressed={targetType === 'custom'}
            className={`min-h-[36px] px-3 rounded-lg text-xs font-bold border
              ${targetType === 'custom' ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-slate-600 border-slate-300'}`}
          >
            เลือกเอง
          </button>
        </div>
        <span className="ml-auto text-[11px] text-slate-500 whitespace-nowrap">
          {targetType === 'all' ? `ทุกคน (${teachers.length} คน)` : `เลือกแล้ว ${selectedCount} รายการ`}
        </span>
      </div>

      {/* แถว 2: แท็บตัวเลือก + ช่องค้นหา */}
      {targetType === 'custom' && (
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <div className="flex items-center gap-1">
            {tabs.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => { setTab(item.id); setHighlight(0) }}
                aria-pressed={activeTab === item.id}
                className={`min-h-[34px] px-2.5 rounded-lg text-xs font-semibold whitespace-nowrap border
                  ${activeTab === item.id
                    ? 'bg-blue-50 text-blue-700 border-blue-300'
                    : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'}`}
              >
                {item.label}
                {item.count > 0 && <span className="ml-1 text-[10px] opacity-70">{item.count}</span>}
              </button>
            ))}
          </div>

          <div className="relative min-w-0 flex-1 sm:max-w-[320px]">
            <Search className="w-4 h-4 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => { setQuery(e.target.value); setHighlight(0) }}
              onKeyDown={(e) => {
                if (e.key === 'ArrowDown' && suggestions.length) {
                  e.preventDefault()
                  setHighlight((index) => Math.min(index + 1, suggestions.length - 1))
                } else if (e.key === 'ArrowUp' && suggestions.length) {
                  e.preventDefault()
                  setHighlight((index) => Math.max(index - 1, 0))
                } else if (e.key === 'Enter' && activeTab === 'teacher') {
                  e.preventDefault()
                  addTeacher(suggestions[highlight] || suggestions[0])
                } else if (e.key === 'Escape') {
                  setQuery('')
                }
              }}
              placeholder={activeTab === 'teacher' ? 'ค้นหาชื่อครู / วิชา แล้วกด Enter เพื่อเพิ่ม' : 'ค้นหาห้องเรียน'}
              aria-label="ค้นหาผู้เข้าร่วม"
              className="w-full min-h-[36px] pl-8 pr-3 rounded-lg border border-slate-300 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-blue-200"
            />

            {suggestions.length > 0 && (
              <div className="absolute z-20 top-full mt-1 left-0 right-0 rounded-lg border border-slate-200 bg-white shadow-lg divide-y divide-slate-100 max-h-44 overflow-y-auto">
                {suggestions.map((teacher, index) => (
                  <button
                    key={teacher.teacher_id}
                    type="button"
                    onMouseEnter={() => setHighlight(index)}
                    onClick={() => addTeacher(teacher)}
                    className={`w-full flex items-center gap-2 px-2.5 py-2 text-left ${index === highlight ? 'bg-blue-50' : ''}`}
                  >
                    <Plus className="w-3.5 h-3.5 text-blue-600 shrink-0" />
                    <span className="text-xs text-slate-700 truncate flex-1">
                      {teacher.display_name || teacher.full_name || teacher.teacher_id}
                    </span>
                    <span className="text-[10px] text-slate-400 shrink-0">{teacher.dept || ''}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {targetType === 'custom' && (
        <>
          {/* พื้นที่ตัวเลือกเต็มความกว้าง */}
          <div className="rounded-lg border border-slate-200 bg-slate-50/70 p-2.5 min-h-[116px] max-h-[34vh] overflow-y-auto">
            {activeTab === 'class' && allowClasses && (
              filteredClasses.length
                ? <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 gap-2">
                    {filteredClasses.map((cls) => {
                      const selected = isAudienceMember(members, 'class', cls.class_id)
                      return (
                        <button
                          key={cls.class_id}
                          type="button"
                          onClick={() => toggle('class', cls.class_id)}
                          aria-pressed={selected}
                          className={`min-h-[38px] px-2.5 rounded-lg text-xs font-semibold border text-left inline-flex items-center gap-1.5
                            ${selected ? 'bg-violet-600 text-white border-violet-600' : 'bg-white text-slate-700 border-slate-200 hover:border-violet-300'}`}
                        >
                          <span className={`w-4 h-4 rounded border flex items-center justify-center shrink-0
                            ${selected ? 'border-white/70 bg-white/15' : 'border-slate-300'}`}>
                            {selected && <Check className="w-3 h-3" />}
                          </span>
                          <span className="truncate">{cls.name}</span>
                        </button>
                      )
                    })}
                  </div>
                : <EmptyOptions query={query} empty="ไม่พบห้องเรียนใน workspace นี้" />
            )}

            {activeTab === 'teacher' && (
              filteredTeachers.length
                ? <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-1.5">
                    {filteredTeachers.map((teacher) => {
                      const selected = isAudienceMember(members, 'teacher', teacher.teacher_id)
                      return (
                        <button
                          key={teacher.teacher_id}
                          type="button"
                          onClick={() => toggle('teacher', teacher.teacher_id)}
                          aria-pressed={selected}
                          className="min-h-[38px] flex items-center gap-2 px-2.5 rounded-lg text-left bg-white border border-slate-200 hover:border-blue-300"
                        >
                          <span className={`w-4 h-4 rounded border flex items-center justify-center shrink-0
                            ${selected ? 'bg-blue-600 border-blue-600' : 'border-slate-300'}`}>
                            {selected && <Check className="w-3 h-3 text-white" />}
                          </span>
                          <span className="text-xs text-slate-700 truncate flex-1">
                            {teacher.display_name || teacher.full_name || teacher.teacher_id}
                          </span>
                          <span className="text-[10px] text-slate-400 shrink-0">{teacher.dept || ''}</span>
                        </button>
                      )
                    })}
                  </div>
                : <EmptyOptions query={query} empty="ไม่พบครูที่ค้นหา" />
            )}
          </div>

          {/* สรุปผู้เข้าร่วมอยู่ด้านล่างเต็มความกว้าง */}
          <section className="rounded-lg bg-slate-50 border border-slate-200 p-3">
            <div className="flex flex-wrap items-center gap-2 mb-2">
              <p className="text-xs font-bold text-slate-700">
                ผู้เข้าร่วมที่เลือก
                <span className="ml-1.5 text-slate-500 font-normal">({selectedCount})</span>
              </p>
              {hasSelection && (
                <button
                  type="button"
                  onClick={() => emit('custom', [])}
                  className="ml-auto min-h-[28px] px-2 rounded-md text-[11px] font-semibold text-rose-600 hover:bg-rose-50 inline-flex items-center gap-1"
                >
                  <Trash2 className="w-3 h-3" /> ล้างทั้งหมด
                </button>
              )}
            </div>

            {!hasSelection ? (
              <p className="text-xs text-slate-400">ยังไม่ได้เลือกผู้เข้าร่วม</p>
            ) : (
              <div className="flex flex-wrap gap-1.5 max-h-28 overflow-y-auto">
                {groups.depts.map((dept) => (
                  <Chip key={`dept-${dept.id}`} tone="emerald" label={`กลุ่มสาระ ${dept.label}`}
                    onRemove={() => emit('custom', removeAudienceMember(members, 'dept', dept.id))} />
                ))}
                {groups.classes.map((cls) => (
                  <Chip key={`class-${cls.id}`} tone="violet" label={`ห้อง ${cls.label}`}
                    onRemove={() => emit('custom', removeAudienceMember(members, 'class', cls.id))} />
                ))}
                {groups.teachers.map((teacher) => (
                  <Chip key={`teacher-${teacher.id}`} tone="blue" label={teacher.label}
                    onRemove={() => emit('custom', removeAudienceMember(members, 'teacher', teacher.id))} />
                ))}
              </div>
            )}
          </section>
        </>
      )}
    </div>
  )
}

function EmptyOptions({ query, empty }) {
  return (
    <p className="py-6 text-center text-xs text-slate-400">
      {query ? 'ไม่พบรายการที่ตรงกับคำค้นหา' : empty}
    </p>
  )
}

const CHIP_TONE = {
  emerald: 'bg-emerald-50 border-emerald-200 text-emerald-800',
  violet: 'bg-violet-50 border-violet-200 text-violet-800',
  blue: 'bg-blue-50 border-blue-200 text-blue-800',
}

function Chip({ tone, label, onRemove }) {
  return (
    <span className={`inline-flex max-w-full items-center gap-1 rounded-full border pl-2.5 pr-1 py-1 ${CHIP_TONE[tone]}`}>
      <span className="text-[11px] font-semibold truncate max-w-[220px]" title={label}>{label}</span>
      <button
        type="button"
        onClick={onRemove}
        className="p-1 rounded-full hover:bg-white/70 shrink-0 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500"
        aria-label={`ลบ ${label}`}
      >
        <X className="w-3 h-3" />
      </button>
    </span>
  )
}
