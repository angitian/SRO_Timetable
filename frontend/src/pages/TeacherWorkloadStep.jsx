import { useState, useMemo, useCallback } from 'react'
import {
  Plus, Trash2, ArrowRight, ArrowLeft, User, BookOpen,
  Users, Layers, AlertTriangle, Flag, Home, Compass, X, Pencil,
  Sunrise, Sunset, Sparkles, Ban, Settings, ShieldCheck, ChevronDown,
} from 'lucide-react'
import { useApp } from '../context/AppContext.jsx'
import { buildClassBlockMap } from '../utils/periods.js'
import { getSmartDefaultInfo, getSafetyWarning } from '../utils/smartDefaults.js'
import { computeTeacherAvailableSlots, computeFixedSupervision } from '../utils/teacherLoad.js'

const QUICK_TOGGLES = [
  { key: 'scout', label: 'ลูกเสือ-เนตรนารี', icon: Flag, subject_id: 'ACT_SCOUT', subject_name: 'ลูกเสือ-เนตรนารี' },
  { key: 'homeroom', label: 'โฮมรูม', icon: Home, subject_id: 'ACT_HOME', subject_name: 'โฮมรูม' },
  { key: 'club', label: 'ชุมนุม/รด.', icon: Compass, subject_id: 'ACT_CLUB', subject_name: 'ชุมนุม/รด.' },
]

const TEACHER_TYPES = [
  { value: 'regular', label: 'ครูประจำ', cls: '' },
  { value: 'special', label: 'ครูพิเศษ', cls: 'bg-purple-100 text-purple-700' },
  { value: 'foreign', label: 'ครูต่างชาติ', cls: 'bg-emerald-100 text-emerald-700' },
  { value: 'trainee', label: 'นศ.ฝึกสอน', cls: 'bg-sky-100 text-sky-700' },
]

function getTeacherTypeInfo(type) {
  return TEACHER_TYPES.find((t) => t.value === type) || TEACHER_TYPES[0]
}

export default function TeacherWorkloadStep() {
  const { fixtureData, updateFixtureData, setStep } = useApp()
  const [expandedTeacher, setExpandedTeacher] = useState(null)
  const [showAddTeacher, setShowAddTeacher] = useState(false)
  const [showSubjectMaster, setShowSubjectMaster] = useState(false)

  const teachers = fixtureData?.teachers || []
  const subjects = fixtureData?.subjects || []
  const classes = fixtureData?.classes || []
  const lessonBlocks = fixtureData?.lesson_blocks || []
  const scheduleBlocks = fixtureData?.schedule_blocks || []

  const classBlockMap = useMemo(() => buildClassBlockMap(scheduleBlocks), [scheduleBlocks])
  const blockMap = useMemo(() => new Map(scheduleBlocks.map((b) => [b.id, b])), [scheduleBlocks])

  // Global default ceiling for new teachers / imports (editable in Global Conditions)
  const defaultMaxPeriods = fixtureData?.schedule_config?.default_max_periods_per_week || 22

  const teacherLoadMap = useMemo(() => {
    const loads = {}
    for (const t of teachers) {
      loads[t.id] = { assigned: 0, max: t.max_periods_per_week || defaultMaxPeriods }
    }
    for (const lb of lessonBlocks) {
      if (loads[lb.teacher_id]) {
        loads[lb.teacher_id].assigned += lb.periods_per_week
      }
      // Co-taught periods count toward the co-teacher's workload too
      if (lb.co_teacher_id && loads[lb.co_teacher_id]) {
        loads[lb.co_teacher_id].assigned += lb.periods_per_week
      }
    }
    // คาบดูแลกิจกรรม (fixed slots class_teachers) — ภาระคงที่ของครูผู้ดูแล (1 คาบ/ครู/กิจกรรม)
    const supervision = computeFixedSupervision(fixtureData?.fixed_slots || [])
    for (const [tid, n] of Object.entries(supervision)) {
      if (loads[tid]) loads[tid].assigned += n
    }
    return loads
  }, [teachers, lessonBlocks, defaultMaxPeriods, fixtureData?.fixed_slots])

  // Available teaching slots per teacher after deducting locked activities
  // (ลูกเสือ/โฮมรูม/ฯลฯ) and unavailable slots — answers "หักล็อกแล้วเหลือเท่าไหร่"
  const teacherAvailableMap = useMemo(() => {
    const map = {}
    for (const t of teachers) {
      map[t.id] = computeTeacherAvailableSlots(
        t, lessonBlocks, scheduleBlocks,
        fixtureData?.fixed_slots || [],
        fixtureData?.schedule_config,
      )
    }
    return map
  }, [teachers, lessonBlocks, scheduleBlocks, fixtureData?.fixed_slots, fixtureData?.schedule_config])

  function addTeacher(name, teacherType = 'regular') {
    if (!name.trim()) return
    const newId = `T${Date.now()}`
    const newTeacher = {
      id: newId,
      name: name.trim(),
      teacher_type: teacherType,
      max_periods_per_week: defaultMaxPeriods,
      min_periods_per_week: 0,
      unavailable_slots: [],
      admin_role: 'none',
    }
    updateFixtureData({ teachers: [...teachers, newTeacher] })
    setShowAddTeacher(false)
    setExpandedTeacher(newId)
  }

  function removeTeacher(teacherId) {
    updateFixtureData({
      teachers: teachers.filter((t) => t.id !== teacherId),
      lesson_blocks: lessonBlocks.filter((lb) => lb.teacher_id !== teacherId),
    })
  }

  function updateTeacher(teacherId, updates) {
    const updated = teachers.map((t) =>
      t.id === teacherId ? { ...t, ...updates } : t
    )
    updateFixtureData({ teachers: updated })
  }

  function addLessonBlock(teacherId, data) {
    const newId = `LB${Date.now()}`
    const classId = data.class_id
    const blockId = classBlockMap[classId] || null
    const newLb = {
      id: newId,
      subject_id: data.subject_id,
      teacher_id: teacherId,
      class_id: classId,
      room_id: `R_${classId}`,
      periods_per_week: data.periods_per_week || 1,
      is_double_period: data.is_double_period || false,
      is_fixed: false,
      fixed_day: null,
      fixed_period: null,
      block_id: blockId,
    }
    updateFixtureData({ lesson_blocks: [...lessonBlocks, newLb] })
  }

  function removeLessonBlock(lbId) {
    updateFixtureData({ lesson_blocks: lessonBlocks.filter((lb) => lb.id !== lbId) })
  }

  function updateLessonBlock(lbId, updates) {
    const updated = lessonBlocks.map((lb) =>
      lb.id === lbId ? { ...lb, ...updates } : lb
    )
    updateFixtureData({ lesson_blocks: updated })
  }

  function addQuickToggle(teacherId, toggle) {
    // Check if already exists
    const existing = lessonBlocks.find(
      (lb) => lb.teacher_id === teacherId && lb.subject_id === toggle.subject_id
    )
    if (existing) {
      removeLessonBlock(existing.id)
      return
    }
    // Ensure subject exists
    let updatedSubjects = subjects
    if (!subjects.find((s) => s.id === toggle.subject_id)) {
      updatedSubjects = [...subjects, {
        id: toggle.subject_id,
        name: toggle.subject_name,
        category: 'admin',
        is_heavy: false,
      }]
      updateFixtureData({ subjects: updatedSubjects })
    }
    // Add lesson block for each class the teacher teaches, or all classes if none
    const teacherClasses = [...new Set(
      lessonBlocks.filter((lb) => lb.teacher_id === teacherId).map((lb) => lb.class_id)
    )]
    const targetClasses = teacherClasses.length > 0 ? teacherClasses : classes.slice(0, 1).map((c) => c.id)
    for (const cid of targetClasses) {
      addLessonBlock(teacherId, {
        subject_id: toggle.subject_id,
        class_id: cid,
        periods_per_week: 1,
      })
    }
  }

  function getTeacherBlocks(teacherId) {
    const blockIds = new Set()
    for (const lb of lessonBlocks) {
      if (lb.teacher_id === teacherId && lb.block_id) {
        blockIds.add(lb.block_id)
      }
    }
    return Array.from(blockIds)
  }

  const subjectMap = useMemo(() => new Map(subjects.map((s) => [s.id, s])), [subjects])
  const classMap = useMemo(() => new Map(classes.map((c) => [c.id, c])), [classes])

  return (
    <div className="space-y-6 pb-24">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Users className="w-6 h-6 text-blue-600" />
          <h2 className="text-xl font-bold text-gray-900">ภาระงานครู</h2>
          <span className="badge bg-blue-100 text-blue-700">{teachers.length} ครู</span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowSubjectMaster(true)}
            className="border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 mr-2 rounded-lg px-4 py-2 text-sm font-medium flex items-center gap-1.5"
          >
            <BookOpen className="w-4 h-4" />
            จัดการวิชาทั้งหมด
          </button>
          <button
            onClick={() => setShowAddTeacher(true)}
            className="btn-primary text-sm flex items-center gap-1.5"
          >
            <Plus className="w-4 h-4" />
            เพิ่มครู
          </button>
        </div>
      </div>

      {/* Teacher Cards */}
      {teachers.length === 0 && (
        <div className="card text-center py-12 text-gray-400">
          <Users className="w-12 h-12 mx-auto mb-3 opacity-30" />
          <p>ยังไม่มีครู — กด "เพิ่มครู" เพื่อเริ่ม หรือนำเข้าจาก Excel</p>
        </div>
      )}

      {/* Global (system-wide) conditions */}
      <GlobalConditionsCard fixtureData={fixtureData} updateFixtureData={updateFixtureData} />

      {teachers.map((teacher) => {
        const load = teacherLoadMap[teacher.id] || { assigned: 0, max: 22 }
        const pct = load.max > 0 ? Math.min(100, (load.assigned / load.max) * 100) : 0
        const isOver = load.assigned > load.max
        const isExpanded = expandedTeacher === teacher.id
        // Co-taught blocks appear on BOTH teachers' cards (with a badge)
        const teacherLbs = lessonBlocks.filter(
          (lb) => lb.teacher_id === teacher.id || lb.co_teacher_id === teacher.id
        )
        const teacherBlockIds = getTeacherBlocks(teacher.id)
        const isCrossBlock = teacherBlockIds.length > 1
        const availableSlots = teacherAvailableMap[teacher.id] || 0

        return (
          <TeacherCard
            key={teacher.id}
            teacher={teacher}
            load={load}
            pct={pct}
            isOver={isOver}
            availableSlots={availableSlots}
            isExpanded={isExpanded}
            teacherLbs={teacherLbs}
            subjects={subjects}
            classes={classes}
            teachers={teachers}
            subjectMap={subjectMap}
            classMap={classMap}
            blockMap={blockMap}
            classBlockMap={classBlockMap}
            isCrossBlock={isCrossBlock}
            teacherBlockIds={teacherBlockIds}
            fixtureData={fixtureData}
            onToggle={() => setExpandedTeacher(isExpanded ? null : teacher.id)}
            onRemove={() => removeTeacher(teacher.id)}
            onUpdateTeacher={(updates) => updateTeacher(teacher.id, updates)}
            onAddLb={(data) => addLessonBlock(teacher.id, data)}
            onRemoveLb={(lbId) => removeLessonBlock(lbId)}
            onUpdateLb={(lbId, updates) => updateLessonBlock(lbId, updates)}
            onQuickToggle={(toggle) => addQuickToggle(teacher.id, toggle)}
          />
        )
      })}

      {/* Add Teacher Modal */}
      {showAddTeacher && (
        <AddTeacherModal onAdd={addTeacher} onClose={() => setShowAddTeacher(false)} />
      )}

      {/* Subject Master Modal */}
      {showSubjectMaster && (
        <SubjectMasterModal
          subjects={subjects}
          lessonBlocks={lessonBlocks}
          onClose={() => setShowSubjectMaster(false)}
          onUpdate={updateFixtureData}
        />
      )}

      {/* Sticky Global Wizard Footer */}
      <div className="fixed bottom-0 left-0 right-0 z-50 bg-white/95 backdrop-blur border-t border-gray-200 shadow-lg px-4 sm:px-6 lg:px-8 py-3">
        <div className="max-w-7xl mx-auto flex items-center justify-between gap-4">
          <button
            onClick={() => setStep(2)}
            className="btn-secondary text-sm flex items-center gap-1.5 shrink-0"
          >
            <ArrowLeft className="w-4 h-4" />
            กลับไปสร้างบล็อก
          </button>
          <div className="hidden sm:flex items-center gap-2 text-sm min-w-0">
            <Users className="w-4 h-4 text-blue-500 shrink-0" />
            <span className="text-gray-700 font-medium truncate">
              ครู {teachers.length} ท่าน &bull; ภาระงาน {lessonBlocks.length} รายการ
            </span>
          </div>
          {teachers.length > 0 ? (
            <button
              onClick={() => setStep(4)}
              className="flex items-center gap-2 px-6 py-2.5 bg-blue-600 text-white rounded-xl font-bold text-sm hover:bg-blue-700 transition-colors shadow-md whitespace-nowrap shrink-0"
            >
              ถัดไป: ตรวจสอบข้อมูล
              <ArrowRight className="w-4 h-4" />
            </button>
          ) : (
            <button
              disabled
              className="flex items-center gap-2 px-6 py-2.5 bg-blue-600 text-white rounded-xl font-bold text-sm hover:bg-blue-700 transition-colors shadow-md whitespace-nowrap opacity-50 cursor-not-allowed shrink-0"
            >
              ถัดไป: ตรวจสอบข้อมูล
              <ArrowRight className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Global Conditions Card ────────────────────────────────────────────────

const AM_PM_MODES = [
  { value: 'off', label: 'ปิด', desc: 'ไม่บังคับ (ครูที่ติ๊กเองได้ Soft)' },
  { value: 'soft', label: 'Soft', desc: 'พยายามจัดให้ ไม่ทำให้จัดไม่ได้' },
  { value: 'hard', label: 'Hard', desc: 'บังคับทุกวัน ถ้าเต็มคาบมากจะแจ้งเตือน' },
]

/** iOS-style toggle switch */
function ToggleSwitch({ checked, onChange, disabled }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange?.(!checked)}
      className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors
        ${checked ? 'bg-blue-600' : 'bg-gray-300'}
        ${disabled ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer'}`}
    >
      <span
        className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform
          ${checked ? 'translate-x-[18px]' : 'translate-x-0.5'}`}
      />
    </button>
  )
}

/** Small Soft/Hard segmented chip shown when a row is enabled */
function ModeChip({ label, active, onClick, disabled }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`px-2.5 py-1 rounded-md text-xs font-semibold border transition-all shrink-0
        ${active
          ? label === 'Hard'
            ? 'bg-red-600 text-white border-red-600'
            : 'bg-amber-500 text-white border-amber-500'
          : disabled
            ? 'bg-gray-100 text-gray-300 border-gray-100 cursor-not-allowed'
            : 'bg-white text-gray-500 border-gray-200 hover:border-gray-300'}`}
    >
      {label}
    </button>
  )
}

/** One condition row: [toggle] label [extra] (Soft/Hard when on) */
function ModeRow({ title, subtitle, mode, hasHard = true, extra, onToggle, onModeChange }) {
  const enabled = mode !== 'off'
  return (
    <div className={`flex items-center gap-2 bg-white rounded-lg px-3 py-2 border transition-colors
      ${enabled ? 'border-blue-200 bg-blue-50/30' : 'border-gray-200'}`}>
      <ToggleSwitch checked={enabled} onChange={onToggle} />
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium text-gray-800">{title}</div>
        {subtitle && <div className="text-xs text-gray-400">{subtitle}</div>}
      </div>
      {extra}
      {enabled && (
        <div className="flex gap-1 shrink-0">
          <ModeChip label="Soft" active={mode === 'soft'} onClick={() => onModeChange('soft')} />
          <ModeChip
            label="Hard"
            active={mode === 'hard'}
            disabled={!hasHard}
            onClick={() => hasHard && onModeChange('hard')}
          />
        </div>
      )}
    </div>
  )
}

function GlobalConditionsCard({ fixtureData, updateFixtureData }) {
  const sc = fixtureData?.schedule_config || {}
  const subjects = fixtureData?.subjects || []
  const rules = sc.subject_time_rules || []
  const maxConsec = sc.max_consecutive_teaching || 4
  const defaultMax = sc.default_max_periods_per_week || 22
  const [expanded, setExpanded] = useState(true)
  const [newRule, setNewRule] = useState({ subject_id: '', preference: 'morning', mode: 'soft' })

  function update(updates) {
    updateFixtureData({
      schedule_config: { ...sc, ...updates },
    })
  }

  // ── Subject time rules handlers ──
  function addRule() {
    if (!newRule.subject_id) return
    if (rules.some((r) => r.subject_id === newRule.subject_id)) return
    update({ subject_time_rules: [...rules, { ...newRule }] })
    setNewRule({ subject_id: '', preference: 'morning', mode: 'soft' })
  }

  function updateRule(idx, patch) {
    update({ subject_time_rules: rules.map((r, i) => (i === idx ? { ...r, ...patch } : r)) })
  }

  function removeRule(idx) {
    update({ subject_time_rules: rules.filter((_, i) => i !== idx) })
  }

  const usedSubjectIds = new Set(rules.map((r) => r.subject_id))

  return (
    <div className="card space-y-3">
      {/* Collapsible header */}
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-2 w-full text-left"
      >
        <Settings className="w-5 h-5 text-slate-700 shrink-0" />
        <h3 className="font-bold text-gray-900">เงื่อนไขระดับระบบ (Global)</h3>
        <span className="text-xs text-gray-400 hidden sm:inline">ใช้กับครูทุกคน — ตั้งก่อนกดจัดตาราง</span>
        <span className={`ml-auto transition-transform ${expanded ? 'rotate-180' : ''}`}>
          <ChevronDown className="w-4 h-4 text-gray-400" />
        </span>
      </button>

      {expanded && (
        <>
          <div className="space-y-2">
            <ModeRow
              title="ว่าง 1 คาบเช้า + 1 คาบบ่าย"
              subtitle="เกลี่ยคาบว่างไม่ให้กองช่วงเดียว"
              mode={sc.am_pm_free_mode || 'off'}
              onToggle={(v) => update({ am_pm_free_mode: v ? 'soft' : 'off' })}
              onModeChange={(m) => update({ am_pm_free_mode: m })}
            />
            <ModeRow
              title="หลีกเลี่ยงสอนเกิน"
              subtitle={`ไม่ให้สอนเกิน ${maxConsec} คาบติดต่อกัน (ค่าเริ่มต้นของครูทุกคน)`}
              mode={sc.max_consecutive_mode || 'soft'}
              extra={
                <select
                  value={maxConsec}
                  onChange={(e) => update({ max_consecutive_teaching: parseInt(e.target.value) })}
                  className="border border-gray-300 rounded px-1.5 py-1 text-sm w-14 text-center shrink-0"
                >
                  {[2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}</option>)}
                </select>
              }
              onToggle={(v) => update({ max_consecutive_mode: v ? 'soft' : 'off' })}
              onModeChange={(m) => update({ max_consecutive_mode: m })}
            />
            <ModeRow
              title="ไม่จัดวิชาเดิมติดวัน"
              subtitle="S1: กระจายวิชาเดิมไม่ให้ติดวันติดกัน"
              mode={sc.subject_day_spacing_mode || 'soft'}
              onToggle={(v) => update({ subject_day_spacing_mode: v ? 'soft' : 'off' })}
              onModeChange={(m) => update({ subject_day_spacing_mode: m })}
            />
            <ModeRow
              title="วิชาหนักเน้นเช้า"
              subtitle="S2: วิชาที่ mark 'วิชาหนัก' (คณิต/ไทย/อังกฤษ) เน้นช่วงเช้า"
              mode={sc.heavy_morning_mode || 'soft'}
              onToggle={(v) => update({ heavy_morning_mode: v ? 'soft' : 'off' })}
              onModeChange={(m) => update({ heavy_morning_mode: m })}
            />
            <ModeRow
              title="เกลี่ยภาระงานข้ามวัน"
              subtitle="ครูไม่โหลดวันใดวันหนึ่งเกินไป"
              mode={sc.workload_balance_mode || 'soft'}
              hasHard={false}
              onToggle={(v) => update({ workload_balance_mode: v ? 'soft' : 'off' })}
              onModeChange={(m) => update({ workload_balance_mode: m })}
            />
            <ModeRow
              title="รวมคาบว่างครู (Deep)"
              subtitle="ลดคาบว่างกระโดด — ปิดเพื่อกระจายคาบว่าง"
              mode={sc.gap_clustering_mode || 'soft'}
              hasHard={false}
              onToggle={(v) => update({ gap_clustering_mode: v ? 'soft' : 'off' })}
              onModeChange={(m) => update({ gap_clustering_mode: m })}
            />
            {/* Default ceiling for new teachers / imports */}
            <div className="flex items-center gap-2 bg-white rounded-lg px-3 py-2 border border-gray-200">
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-gray-800">เพดานคาบเริ่มต้นของครู</div>
                <div className="text-xs text-gray-400">
                  ใช้กับครูที่สร้างใหม่ / import — กด "ใช้กับทุกคน" เพื่อปรับทั้งลิสต์ (ครูแต่ละคนแก้ต่อตัวได้ที่บัตรครู)
                </div>
              </div>
              <input
                type="number" min="0" max="60"
                value={defaultMax}
                onChange={(e) => update({ default_max_periods_per_week: parseInt(e.target.value) || 0 })}
                className="border border-gray-300 rounded px-1.5 py-1 text-sm w-16 text-center shrink-0"
                title="เพดานคาบ/สัปดาห์เริ่มต้นของครูใหม่"
              />
              <span className="text-xs text-gray-500 shrink-0">คาบ/สัปดาห์</span>
              <button
                onClick={() => {
                  const count = (fixtureData?.teachers || []).length
                  if (count === 0) return
                  if (window.confirm(`นำค่า ${defaultMax} คาบ/สัปดาห์ ไปใช้กับครูทุกคน (${count} คน)? ครูที่ตั้งค่าเองจะถูกทับ`)) {
                    updateFixtureData({
                      teachers: (fixtureData.teachers || []).map((t) => ({ ...t, max_periods_per_week: defaultMax })),
                    })
                  }
                }}
                disabled={defaultMax <= 0}
                className="shrink-0 px-2.5 py-1 rounded-lg text-xs font-semibold bg-blue-600 text-white hover:bg-blue-700 transition-colors disabled:opacity-40"
                title="นำค่าเพดานนี้ไปใช้กับครูทุกคน (ทับค่าที่ตั้งไว้)"
              >
                ใช้กับทุกคน
              </button>
            </div>
          </div>

          {/* Subject time rules */}
          <div className="bg-purple-50/40 border border-purple-200 rounded-lg p-3 space-y-2">
            <div className="flex items-center gap-1.5 text-sm font-bold text-purple-800">
              <BookOpen className="w-4 h-4" />
              วิชาเฉพาะช่วงเวลา
              <span className="text-xs font-normal text-purple-400">— เลือกวิชาใดก็ได้ กำหนดเช้า/บ่าย</span>
            </div>

            {/* Add row */}
            <div className="flex items-center gap-1.5 flex-wrap">
              <select
                value={newRule.subject_id}
                onChange={(e) => setNewRule({ ...newRule, subject_id: e.target.value })}
                className="text-sm border border-gray-300 rounded-lg px-2 py-1.5 flex-1 min-w-[140px]"
              >
                <option value="">เลือกวิชา…</option>
                {subjects
                  .filter((s) => !usedSubjectIds.has(s.id))
                  .map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
              <select
                value={newRule.preference}
                onChange={(e) => setNewRule({ ...newRule, preference: e.target.value })}
                className="text-sm border border-gray-300 rounded-lg px-2 py-1.5"
              >
                <option value="morning">เช้า</option>
                <option value="afternoon">บ่าย</option>
              </select>
              <button
                onClick={addRule}
                disabled={!newRule.subject_id}
                className="btn-primary text-xs px-3 py-1.5 flex items-center gap-1 disabled:opacity-40"
              >
                <Plus className="w-3.5 h-3.5" /> เพิ่ม
              </button>
            </div>

            {/* Rule list */}
            {rules.length === 0 ? (
              <p className="text-xs text-gray-400 italic">
                ยังไม่มีวิชาเฉพาะช่วงเวลา — เพิ่มเพื่อบังคับ/โน้มน้าววิชาใด ๆ ไปเช้าหรือบ่าย
              </p>
            ) : (
              <div className="space-y-1.5">
                {rules.map((r, idx) => {
                  const subj = subjects.find((s) => s.id === r.subject_id)
                  const enabled = r.mode !== 'off'
                  return (
                    <div key={r.subject_id} className="flex items-center gap-2 bg-white rounded-lg px-3 py-1.5 border border-purple-200">
                      <ToggleSwitch
                        checked={enabled}
                        onChange={(v) => updateRule(idx, { mode: v ? 'soft' : 'off' })}
                      />
                      <span className="text-sm font-medium text-gray-800 flex-1 truncate">
                        {subj?.name || r.subject_id}
                      </span>
                      <select
                        value={r.preference}
                        onChange={(e) => updateRule(idx, { preference: e.target.value })}
                        className="text-xs border border-gray-300 rounded px-1.5 py-1"
                      >
                        <option value="morning">เช้า</option>
                        <option value="afternoon">บ่าย</option>
                      </select>
                      {enabled && (
                        <div className="flex gap-1">
                          <ModeChip label="Soft" active={r.mode === 'soft'} onClick={() => updateRule(idx, { mode: 'soft' })} />
                          <ModeChip label="Hard" active={r.mode === 'hard'} onClick={() => updateRule(idx, { mode: 'hard' })} />
                        </div>
                      )}
                      <button
                        onClick={() => removeRule(idx)}
                        className="text-red-400 hover:text-red-600 shrink-0"
                        title="ลบ"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          {/* Invariants */}
          <div className="bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-xs text-slate-600 space-y-1">
            <div className="font-bold text-slate-700 flex items-center gap-1.5">
              <ShieldCheck className="w-3.5 h-3.5" /> กฎตายตัวของระบบ (ปรับไม่ได้)
            </div>
            <ul className="list-disc pl-5 space-y-0.5">
              <li>ครู 1 คนสอน 2 ห้องพร้อมกันไม่ได้</li>
              <li>ห้องเรียน 1 ห้องมี 2 วิชาพร้อมกันไม่ได้</li>
              <li>ห้องพิเศษถูกใช้พร้อมกัน 2 วิชาไม่ได้</li>
              <li>ครูต้องมีคาบพักเที่ยงว่างอย่างน้อย 1 ช่วง (11:00-13:30)</li>
              <li>ช่องที่ล็อกกิจกรรม/คาบตายตัว ห้ามวางวิชาอื่น</li>
            </ul>
          </div>
        </>
      )}
    </div>
  )
}

// ── Teacher Card ────────────────────────────────────────────────────────────

function TeacherCard({
  teacher, load, pct, isOver, availableSlots, isExpanded, teacherLbs,
  subjects, classes, teachers, subjectMap, classMap, blockMap, classBlockMap,
  isCrossBlock, teacherBlockIds, fixtureData,
  onToggle, onRemove, onUpdateTeacher, onAddLb, onRemoveLb, onUpdateLb, onQuickToggle,
}) {
  const [showAddRow, setShowAddRow] = useState(false)
  const [editingMax, setEditingMax] = useState(false)
  const [maxDraft, setMaxDraft] = useState('')
  // คาบดูแลกิจกรรม (fixed slots) ของครูคนนี้ — นับเข้างานแล้วใน load.assigned
  const supervisionPeriods = useMemo(
    () => computeFixedSupervision(fixtureData?.fixed_slots || [])[teacher.id] || 0,
    [fixtureData?.fixed_slots, teacher.id],
  )
  const [newRow, setNewRow] = useState({
    subject_id: subjects[0]?.id || '',
    class_id: classes[0]?.id || '',
    periods_per_week: 1,
    is_double_period: false,
  })

  function startEditMax() {
    setMaxDraft(String(load.max ?? ''))
    setEditingMax(true)
  }

  function commitMax() {
    const v = parseInt(maxDraft, 10)
    if (!Number.isNaN(v) && v >= 0) {
      onUpdateTeacher({ max_periods_per_week: v })
    }
    setEditingMax(false)
  }

  function handleAdd() {
    if (!newRow.subject_id || !newRow.class_id) return
    onAddLb(newRow)
    setShowAddRow(false)
    setNewRow({ subject_id: subjects[0]?.id || '', class_id: classes[0]?.id || '', periods_per_week: 1, is_double_period: false })
  }

  return (
    <div className="card">
      {/* Card header */}
      <div className="flex items-center justify-between cursor-pointer" onClick={onToggle}>
        <div className="flex items-center gap-3">
          <div className={`w-10 h-10 rounded-full flex items-center justify-center font-bold text-sm
            ${isOver ? 'bg-red-100 text-red-700' : 'bg-blue-100 text-blue-700'}`}>
            {teacher.name.charAt(0)}
          </div>
          <div>
            <div className="font-bold text-gray-900 flex items-center gap-1.5">
              {teacher.name}
              {(() => {
                const info = getTeacherTypeInfo(teacher.teacher_type)
                return info.cls && (
                  <span className={`badge text-[10px] ${info.cls}`}>{info.label}</span>
                )
              })()}
            </div>
            <div className="text-xs text-gray-500">
              {teacherLbs.length} รายการ
              {supervisionPeriods > 0 && (
                <span className="ml-2 badge bg-emerald-100 text-emerald-700 text-[10px]">
                  กิจกรรมดูแล {supervisionPeriods} คาบ
                </span>
              )}
              {isCrossBlock && (
                <span className="ml-2 badge bg-purple-100 text-purple-700 text-[10px]">
                  สอนข้ามบล็อก ({teacherBlockIds.length})
                </span>
              )}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {/* Load counter */}
          <div className="text-right">
            <div className={`text-sm font-bold ${isOver ? 'text-red-600' : 'text-gray-700'}`}>
              {load.assigned}/
              {editingMax ? (
                <input
                  type="number" min="0" max="60" autoFocus
                  value={maxDraft}
                  onChange={(e) => setMaxDraft(e.target.value)}
                  onBlur={commitMax}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') commitMax()
                    if (e.key === 'Escape') setEditingMax(false)
                  }}
                  className="w-12 border border-blue-400 rounded px-1 py-0.5 text-sm text-center"
                />
              ) : (
                <button
                  onClick={(e) => { e.stopPropagation(); startEditMax() }}
                  className="hover:underline decoration-dotted"
                  title="คลิกเพื่อแก้เพดานคาบ/สัปดาห์ของครูคนนี้"
                >
                  {load.max}
                </button>
              )}{' '}
              คาบ
            </div>
            <div className="w-24 h-2 bg-gray-200 rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full ${isOver ? 'bg-red-500' : pct > 80 ? 'bg-yellow-500' : 'bg-green-500'}`}
                style={{ width: `${pct}%` }}
              />
            </div>
            {isOver && (
              <div className="text-[10px] font-medium text-red-500 mt-0.5" title="คำเตือนเท่านั้น — ระบบยังวางคาบให้ครบ (เกินเพดาน)">
                เกินเพดาน ⚠️
              </div>
            )}
            {availableSlots > 0 && (
              <div
                className={`text-[10px] font-medium mt-0.5 ${load.assigned > availableSlots ? 'text-red-500' : 'text-gray-400'}`}
                title={load.assigned > availableSlots
                  ? `คาบสอน (${load.assigned}) เกินช่องว่างจริง (${availableSlots}) หลังหักคาบล็อก+ไม่สะดวก — ต้องลดคาบหรือปลดล็อก`
                  : 'ช่องว่างสอนทั้งสัปดาห์ หลังหักคาบล็อกกิจกรรม (ลูกเสือ/โฮมรูม/ฯลฯ) + คาบไม่สะดวก'}
              >
                ช่องว่างสอน {availableSlots} คาบ/สัปดาห์
                {load.assigned > availableSlots && ' ⚠️'}
              </div>
            )}
          </div>
          {isOver && <AlertTriangle className="w-5 h-5 text-red-500" />}
        </div>
      </div>

      {/* Expanded content */}
      {isExpanded && (
        <div className="mt-4 border-t border-gray-100 pt-4 space-y-3">
          {/* Quick toggles */}
          <div className="flex flex-wrap gap-2">
            {QUICK_TOGGLES.map((toggle) => {
              const Icon = toggle.icon
              const isActive = teacherLbs.some((lb) => lb.subject_id === toggle.subject_id)
              return (
                <button
                  key={toggle.key}
                  onClick={() => onQuickToggle(toggle)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border-2 transition-all
                    ${isActive
                      ? 'bg-green-100 border-green-400 text-green-700'
                      : 'bg-white border-gray-200 text-gray-500 hover:border-gray-300'
                    }`}
                >
                  <Icon className="w-3.5 h-3.5" />
                  {toggle.label}
                  {isActive && <span className="text-green-600">✓</span>}
                </button>
              )
            })}
          </div>

          {/* Lesson block rows */}
          {teacherLbs.length > 0 && (
            <div className="space-y-1.5">
              {teacherLbs.map((lb) => {
                const subj = subjectMap.get(lb.subject_id)
                const cls = classMap.get(lb.class_id)
                const block = lb.block_id ? blockMap.get(lb.block_id) : null
                return (
                  <div key={lb.id} className="flex items-center gap-2 bg-gray-50 rounded-lg px-3 py-2">
                    <BookOpen className="w-4 h-4 text-gray-400 shrink-0" />
                    <select
                      value={lb.subject_id}
                      onChange={(e) => onUpdateLb(lb.id, { subject_id: e.target.value })}
                      className="text-sm border border-gray-200 rounded px-2 py-1 flex-1 min-w-0"
                    >
                      {subjects.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                    </select>
                    <select
                      value={lb.class_id}
                      onChange={(e) => {
                        const newClassId = e.target.value
                        const newBlockId = classBlockMap[newClassId] || null
                        onUpdateLb(lb.id, { class_id: newClassId, room_id: `R_${newClassId}`, block_id: newBlockId })
                      }}
                      className="text-sm border border-gray-200 rounded px-2 py-1 w-28"
                    >
                      {classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                    {/* Main teacher — change who teaches this subject (หลัก) */}
                    <select
                      value={lb.teacher_id}
                      onChange={(e) => onUpdateLb(lb.id, { teacher_id: e.target.value })}
                      className="text-sm border border-gray-200 rounded px-2 py-1 w-28"
                      title="ครูหลัก (ผู้รับผิดชอบวิชานี้)"
                    >
                      {teachers.map((t) => (
                        <option key={t.id} value={t.id}>{t.name}</option>
                      ))}
                    </select>
                    {/* Co-teacher (second teacher) — e.g. MEP ครูไทย + ต่างชาติ */}
                    <select
                      value={lb.co_teacher_id || ''}
                      onChange={(e) => onUpdateLb(lb.id, { co_teacher_id: e.target.value || null })}
                      className="text-sm border border-gray-200 rounded px-2 py-1 w-28"
                      title="ครูผู้สอนร่วม (สอนพร้อมกัน เช่น MEP)"
                    >
                      <option value="">ครูที่ 2: —</option>
                      {teachers
                        .filter((t) => t.id !== lb.teacher_id)
                        .map((t) => (
                          <option key={t.id} value={t.id}>{t.name}</option>
                        ))}
                    </select>
                    {lb.co_teacher_id && (
                      <span
                        className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700 font-medium shrink-0"
                        title="ครูผู้สอนร่วม (สอนพร้อมกัน เช่น MEP)"
                      >
                        ร่วมกับ {teachers.find((t) => t.id === lb.co_teacher_id)?.name || lb.co_teacher_id}
                      </span>
                    )}
                    <input
                      type="number" min="1" max="10"
                      value={lb.periods_per_week}
                      onChange={(e) => onUpdateLb(lb.id, { periods_per_week: parseInt(e.target.value) || 1 })}
                      className="text-sm border border-gray-200 rounded px-2 py-1 w-14 text-center"
                    />
                    <button
                      onClick={() => onUpdateLb(lb.id, { is_double_period: !lb.is_double_period })}
                      className={`text-xs px-2 py-1 rounded border ${lb.is_double_period ? 'bg-purple-100 border-purple-300 text-purple-700' : 'border-gray-200 text-gray-400'}`}
                    >
                      คู่
                    </button>
                    {block && (
                      <span className="text-[10px] text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded">
                        {block.name}
                      </span>
                    )}
                    <button
                      onClick={() => onRemoveLb(lb.id)}
                      className="text-red-500 hover:text-red-700 shrink-0"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                )
              })}
            </div>
          )}

          {/* Add row */}
          {showAddRow ? (
            <div className="flex items-center gap-2 bg-blue-50 rounded-lg px-3 py-2">
              <select
                value={newRow.subject_id}
                onChange={(e) => setNewRow({ ...newRow, subject_id: e.target.value })}
                className="text-sm border border-gray-200 rounded px-2 py-1 flex-1"
              >
                {subjects.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
              <select
                value={newRow.class_id}
                onChange={(e) => setNewRow({ ...newRow, class_id: e.target.value })}
                className="text-sm border border-gray-200 rounded px-2 py-1 w-28"
              >
                {classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
              <input
                type="number" min="1" max="10"
                value={newRow.periods_per_week}
                onChange={(e) => setNewRow({ ...newRow, periods_per_week: parseInt(e.target.value) || 1 })}
                className="text-sm border border-gray-200 rounded px-2 py-1 w-14 text-center"
              />
              <button onClick={handleAdd} className="btn-primary text-xs px-3 py-1">เพิ่ม</button>
              <button onClick={() => setShowAddRow(false)} className="btn-secondary text-xs px-3 py-1">ยกเลิก</button>
            </div>
          ) : (
            <button
              onClick={() => setShowAddRow(true)}
              className="text-sm text-blue-600 flex items-center gap-1 hover:text-blue-700"
            >
              <Plus className="w-4 h-4" />
              เพิ่มวิชา/ห้อง
            </button>
          )}

          {/* Personal Preferences Section */}
          <TeacherPreferencesSection
            teacher={teacher}
            fixtureData={fixtureData}
            onUpdateTeacher={onUpdateTeacher}
          />

          {/* Remove teacher */}
          <div className="pt-2 border-t border-gray-100">
            <button
              onClick={onRemove}
              className="text-xs text-red-500 hover:text-red-700 flex items-center gap-1"
            >
              <Trash2 className="w-3 h-3" />
              ลบครู
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Teacher Preferences Section ─────────────────────────────────────────────

const PREF_DAY_LABELS = ['', 'จ.', 'อ.', 'พ.', 'พฤ.', 'ศ.', 'ส.']
const PREF_DAY_FULL = ['', 'จันทร์', 'อังคาร', 'พุธ', 'พฤหัสบดี', 'ศุกร์', 'เสาร์']
const PREF_ADMIN_ROLES = [
  { value: 'none', label: '—' },
  { value: 'finance', label: 'การเงิน' },
  { value: 'discipline', label: 'ปกครอง' },
  { value: 'dept_head', label: 'หัวหน้าหมวด' },
]

function TeacherPreferencesSection({ teacher, fixtureData, onUpdateTeacher }) {
  const smartInfo = useMemo(
    () => getSmartDefaultInfo(teacher, fixtureData),
    [teacher, fixtureData]
  )
  const safetyWarning = useMemo(
    () => getSafetyWarning(teacher, fixtureData),
    [teacher, fixtureData]
  )

  const scheduleConfig = fixtureData?.schedule_config || { days_per_week: 5, periods_per_day: 8, lunch_periods: [4] }
  const days = Array.from({ length: scheduleConfig.days_per_week || 5 }, (_, i) => i + 1)
  const periods = Array.from({ length: scheduleConfig.periods_per_day || 8 }, (_, i) => i + 1)
  const lunchSet = new Set(scheduleConfig.lunch_periods || [4])

  const noFirst = teacher.no_first_period || false
  const noLast = teacher.no_last_period || false
  const enableLimit = teacher.enable_consecutive_limit !== false
  const isCustomized = teacher.is_consecutive_customized || false
  const currentN = teacher.max_consecutive_teaching > 0
    ? teacher.max_consecutive_teaching
    : smartInfo.n
  const spreadFree = teacher.spread_free_periods || false
  const adminRole = teacher.admin_role || 'none'
  const unavailable = teacher.unavailable_slots || []
  const defaultMaxPeriods = fixtureData?.schedule_config?.default_max_periods_per_week || 22
  const maxPeriods = teacher.max_periods_per_week != null ? teacher.max_periods_per_week : defaultMaxPeriods
  const minPeriods = teacher.min_periods_per_week || 0
  const globalAmPmMode = fixtureData?.schedule_config?.am_pm_free_mode || 'off'
  const amPmGlobalActive = globalAmPmMode !== 'off'

  function toggleNoFirst(checked) {
    onUpdateTeacher({ no_first_period: checked })
  }
  function toggleNoLast(checked) {
    onUpdateTeacher({ no_last_period: checked })
  }
  function toggleConsecutiveLimit(checked) {
    onUpdateTeacher({ enable_consecutive_limit: checked })
  }
  function selectConsecutiveN(n) {
    onUpdateTeacher({
      max_consecutive_teaching: n,
      is_consecutive_customized: true,
    })
  }
  function toggleSpreadFree(checked) {
    onUpdateTeacher({ spread_free_periods: checked })
  }
  function toggleUnavailableSlot(day, period) {
    if (lunchSet.has(period)) return
    const key = `${day}-${period}`
    const newSlots = unavailable.includes(key)
      ? unavailable.filter((s) => s !== key)
      : [...unavailable, key]
    onUpdateTeacher({ unavailable_slots: newSlots })
  }

  return (
    <div className="bg-amber-50/60 border border-amber-200 rounded-lg p-3 space-y-3">
      <div className="flex items-center gap-1.5 text-sm font-bold text-amber-800">
        <User className="w-4 h-4" />
        เงื่อนไขส่วนตัว
      </div>

      {/* Workload bounds */}
      <div className="grid grid-cols-2 gap-2">
        <div className="bg-white rounded-lg px-3 py-2 border border-gray-200">
          <label className="text-xs font-medium text-gray-600 block">ภาระงานสูงสุด (คาบ/สัปดาห์)</label>
          <input
            type="number" min="1" max="60"
            value={maxPeriods}
            onChange={(e) => onUpdateTeacher({ max_periods_per_week: parseInt(e.target.value) || defaultMaxPeriods })}
            className="mt-1 w-24 border border-gray-300 rounded px-2 py-1 text-sm"
          />
        </div>
        <div className="bg-white rounded-lg px-3 py-2 border border-gray-200">
          <label className="text-xs font-medium text-gray-600 block">ภาระงานขั้นต่ำ (คาบ/สัปดาห์)</label>
          <input
            type="number" min="0" max="40"
            value={minPeriods}
            onChange={(e) => onUpdateTeacher({ min_periods_per_week: parseInt(e.target.value) || 0 })}
            className="mt-1 w-24 border border-gray-300 rounded px-2 py-1 text-sm"
          />
        </div>
      </div>

      {/* Teacher type */}
      <div className="bg-white rounded-lg px-3 py-2 border border-gray-200">
        <label className="text-xs font-medium text-gray-600 block mb-1.5">ประเภทครู</label>
        <div className="flex gap-1.5 flex-wrap">
          {TEACHER_TYPES.map((t) => (
            <button
              key={t.value}
              onClick={() => onUpdateTeacher({ teacher_type: t.value })}
              className={`text-xs px-2.5 py-1 rounded-md font-medium border transition-all
                ${(teacher.teacher_type || 'regular') === t.value
                  ? 'bg-blue-600 text-white border-blue-600'
                  : 'bg-white text-gray-500 border-gray-200 hover:border-blue-300'}`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* Admin role */}
      <div className="bg-white rounded-lg px-3 py-2 border border-gray-200">
        <label className="text-xs font-medium text-gray-600 block mb-1.5">บทบาทพิเศษ (มีคาบว่างสำหรับภารกิจ)</label>
        <div className="flex gap-1.5 flex-wrap">
          {PREF_ADMIN_ROLES.map((role) => (
            <button
              key={role.value}
              onClick={() => onUpdateTeacher({ admin_role: role.value })}
              className={`text-xs px-2.5 py-1 rounded-md font-medium border-2 transition-all
                ${adminRole === role.value
                  ? 'bg-amber-500 text-white border-amber-500'
                  : 'bg-white text-gray-500 border-gray-200 hover:border-amber-300'
                }`}
            >
              {role.label}
            </button>
          ))}
        </div>
      </div>

      {/* First / Last Period Checkboxes */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <label className="flex items-center gap-2 text-sm text-gray-700 bg-white rounded-lg px-3 py-2 border border-gray-200 cursor-pointer hover:border-amber-300">
          <input
            type="checkbox"
            checked={noFirst}
            onChange={(e) => toggleNoFirst(e.target.checked)}
            className="w-4 h-4 accent-amber-600"
          />
          <Sunrise className="w-4 h-4 text-amber-500" />
          <span>ห้ามสอนคาบแรกของวัน (08:30)</span>
        </label>
        <label className="flex items-center gap-2 text-sm text-gray-700 bg-white rounded-lg px-3 py-2 border border-gray-200 cursor-pointer hover:border-amber-300">
          <input
            type="checkbox"
            checked={noLast}
            onChange={(e) => toggleNoLast(e.target.checked)}
            className="w-4 h-4 accent-amber-600"
          />
          <Sunset className="w-4 h-4 text-amber-500" />
          <span>ห้ามสอนคาบสุดท้ายของวัน</span>
        </label>
      </div>

      {/* Spread free periods: 1 free morning + 1 free afternoon */}
      <label className={`flex items-start gap-2 text-sm text-gray-700 bg-white rounded-lg px-3 py-2 border border-gray-200
        ${amPmGlobalActive ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer hover:border-amber-300'}`}>
        <input
          type="checkbox"
          checked={spreadFree || amPmGlobalActive}
          disabled={amPmGlobalActive}
          onChange={(e) => toggleSpreadFree(e.target.checked)}
          className="w-4 h-4 accent-amber-600 mt-0.5"
        />
        <span>
          ว่าง 1 คาบเช้า + 1 คาบบ่าย
          <span className="block text-xs text-gray-400">
            {amPmGlobalActive
              ? `ใช้โหมด Global (${globalAmPmMode === 'hard' ? 'Hard — บังคับ' : 'Soft'}) จากการ์ดเงื่อนไขระดับระบบด้านบน`
              : 'เกลี่ยคาบว่างไม่ให้กองอยู่ช่วงเดียว (เช่น ว่าง 3 คาบเช้าติด) — ระบบจะพยายามจัดให้'}
          </span>
        </span>
      </label>

      {/* Unavailable slots grid */}
      <div className="bg-white rounded-lg px-3 py-2 border border-gray-200">
        <label className="text-xs font-medium text-gray-600 block mb-1.5 flex items-center gap-1.5">
          <Ban className="w-3.5 h-3.5 text-red-500" />
          ช่องที่ห้ามจัดสอน (คลิกเพื่อสลับ)
        </label>
        <div className="overflow-x-auto">
          <div
            className="inline-grid gap-1 min-w-[520px]"
            style={{ gridTemplateColumns: `42px repeat(${periods.length}, minmax(34px, 1fr))` }}
          >
            <div className="text-[10px] text-gray-400 flex items-center justify-center">วัน\คาบ</div>
            {periods.map((p) => (
              <div key={p} className={`text-center text-[10px] font-bold py-0.5 rounded
                ${lunchSet.has(p) ? 'bg-gray-200 text-gray-400' : 'text-gray-600'}`}>
                {p}
              </div>
            ))}
            {days.map((d) => (
              <div key={d} className="contents">
                <div className="flex items-center justify-center text-[10px] font-bold text-gray-600 bg-gray-100 rounded">
                  {PREF_DAY_LABELS[d]}
                </div>
                {periods.map((p) => {
                  const isLunch = lunchSet.has(p)
                  const key = `${d}-${p}`
                  const isUnavailable = unavailable.includes(key)
                  if (isLunch) {
                    return <div key={key} className="bg-gray-100 rounded" />
                  }
                  return (
                    <button
                      key={key}
                      onClick={() => toggleUnavailableSlot(d, p)}
                      className={`w-full h-8 rounded text-[10px] font-medium border-2 transition-all
                        ${isUnavailable
                          ? 'bg-red-100 border-red-400 text-red-700'
                          : 'bg-white border-gray-200 text-gray-300 hover:border-gray-300'
                        }`}
                    >
                      {isUnavailable ? '✕' : ''}
                    </button>
                  )
                })}
              </div>
            ))}
          </div>
        </div>
        {unavailable.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-1.5">
            {unavailable.slice().sort().map((slot) => {
              const [d, p] = slot.split('-')
              return (
                <span key={slot} className="badge bg-red-100 text-red-600 text-[10px]">
                  {PREF_DAY_FULL[parseInt(d)] || `วัน${d}`} คาบ{p}
                </span>
              )
            })}
          </div>
        )}
      </div>

      {/* Consecutive Teaching Limit */}
      <div className="bg-white rounded-lg px-3 py-2 border border-gray-200 space-y-2">
        <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
          <input
            type="checkbox"
            checked={enableLimit}
            onChange={(e) => toggleConsecutiveLimit(e.target.checked)}
            className="w-4 h-4 accent-amber-600"
          />
          <span>หลีกเลี่ยงการสอนเกิน</span>
          <select
            value={currentN}
            onChange={(e) => selectConsecutiveN(parseInt(e.target.value))}
            disabled={!enableLimit}
            className="text-sm border border-gray-300 rounded px-2 py-1 w-16 text-center disabled:bg-gray-100 disabled:text-gray-400"
          >
            {[2, 3, 4, 5].map((n) => (
              <option key={n} value={n}>{n}</option>
            ))}
          </select>
          <span>คาบติดต่อกัน</span>
          {!isCustomized && enableLimit && (
            <span className="badge bg-purple-100 text-purple-600 text-[10px] flex items-center gap-0.5">
              <Sparkles className="w-3 h-3" />
              แนะนำอัตโนมัติ
            </span>
          )}
        </label>
        {enableLimit && (
          <p className="text-xs text-gray-400 pl-6">
            💡 คำนวณอัตโนมัติจากภาระงาน {smartInfo.total} คาบ + คาบกิจกรรม {smartInfo.blocked} คาบ (เฉลี่ย {smartInfo.density.toFixed(1)} คาบ/วัน)
          </p>
        )}
      </div>

      {/* Safety Warning */}
      {safetyWarning && (
        <div className="text-xs text-orange-700 bg-orange-50 border border-orange-200 rounded-lg px-3 py-2">
          {safetyWarning}
        </div>
      )}
    </div>
  )
}

// ── Add Teacher Modal ───────────────────────────────────────────────────────

function AddTeacherModal({ onAdd, onClose }) {
  const [name, setName] = useState('')
  const [teacherType, setTeacherType] = useState('regular')

  return (
    <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-lg p-6 w-full max-w-sm space-y-4" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h3 className="font-bold text-gray-900">เพิ่มครูใหม่</h3>
          <button onClick={onClose}><Trash2 className="w-5 h-5 text-gray-400 rotate-45" /></button>
        </div>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && onAdd(name, teacherType)}
          placeholder="ชื่อครู"
          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
          autoFocus
        />
        <div>
          <label className="text-sm font-medium text-gray-600 block mb-1">ประเภทครู</label>
          <div className="flex gap-1.5 flex-wrap">
            {TEACHER_TYPES.map((t) => (
              <button
                key={t.value}
                onClick={() => setTeacherType(t.value)}
                className={`text-xs px-2.5 py-1 rounded-md font-medium border transition-all
                  ${teacherType === t.value
                    ? 'bg-blue-600 text-white border-blue-600'
                    : 'bg-white text-gray-500 border-gray-200 hover:border-blue-300'}`}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>
        <div className="flex gap-2 justify-end">
          <button onClick={onClose} className="btn-secondary text-sm">ยกเลิก</button>
          <button
            onClick={() => onAdd(name, teacherType)}
            disabled={!name.trim()}
            className="btn-primary text-sm"
          >
            เพิ่ม
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Subject Master Modal ────────────────────────────────────────────────────

const SUBJECT_CATEGORIES = ['core', 'pe', 'art', 'music', 'lab', 'admin']

const SUBJECT_TIME_PREFS = [
  { key: 'morning',   label: 'เน้นเช้า',     icon: '🌅' },
  { key: 'afternoon', label: 'เน้นบ่าย',     icon: '🌇' },
  { key: 'any',       label: 'คาบไหนก็ได้', icon: '🟢' },
]

function SubjectMasterModal({ subjects, lessonBlocks, onClose, onUpdate }) {
  const [showAddForm, setShowAddForm] = useState(false)
  const [editingId, setEditingId] = useState(null)
  const [form, setForm] = useState({
    id: '', name: '', category: 'core', is_heavy: false, time_preference: 'any',
  })

  function resetEdit() {
    setEditingId(null)
    setForm({ id: '', name: '', category: 'core', is_heavy: false, time_preference: 'any' })
  }

  function resetAdd() {
    setShowAddForm(false)
    setForm({ id: '', name: '', category: 'core', is_heavy: false, time_preference: 'any' })
  }

  function setPreference(subjectId, pref) {
    onUpdate({
      subjects: subjects.map((s) =>
        s.id === subjectId ? { ...s, time_preference: pref } : s
      ),
    })
  }

  function addSubject() {
    const id = form.id.trim()
    if (!id || !form.name.trim()) return
    if (subjects.some((s) => s.id === id)) return
    onUpdate({
      subjects: [...subjects, {
        id,
        name: form.name.trim(),
        category: form.category,
        is_heavy: form.is_heavy,
        time_preference: form.time_preference,
      }],
    })
    resetAdd()
  }

  function saveEdit() {
    if (!form.name.trim()) return
    onUpdate({
      subjects: subjects.map((s) =>
        s.id === editingId ? {
          ...s,
          name: form.name.trim(),
          category: form.category,
          is_heavy: form.is_heavy,
          time_preference: form.time_preference,
        } : s
      ),
    })
    resetEdit()
  }

  function deleteSubject(subjectId) {
    onUpdate({
      subjects: subjects.filter((s) => s.id !== subjectId),
      lesson_blocks: lessonBlocks.filter((lb) => lb.subject_id !== subjectId),
    })
    if (editingId === subjectId) resetEdit()
  }

  function startEdit(s) {
    setEditingId(s.id)
    setShowAddForm(false)
    setForm({
      id: s.id,
      name: s.name,
      category: s.category || 'core',
      is_heavy: !!s.is_heavy,
      time_preference: s.time_preference || 'any',
    })
  }

  function startAdd() {
    setEditingId(null)
    setShowAddForm(true)
    setForm({ id: '', name: '', category: 'core', is_heavy: false, time_preference: 'any' })
  }

  return (
    <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50" onClick={onClose}>
      <div
        className="bg-white rounded-xl shadow-lg p-6 w-full max-w-2xl max-h-[85vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-bold text-gray-900">จัดการวิชาทั้งหมด</h3>
          <button onClick={onClose}><X className="w-5 h-5 text-gray-400" /></button>
        </div>

        {/* Subject list */}
        <div className="overflow-y-auto flex-1 space-y-2 pr-1">
          {subjects.length === 0 && (
            <div className="text-center py-8 text-gray-400">
              ยังไม่มีวิชา — กด &quot;+ เพิ่มวิชาใหม่&quot;
            </div>
          )}
          {subjects.map((s) => {
            const refCount = lessonBlocks.filter((lb) => lb.subject_id === s.id).length
            const activePref = s.time_preference || 'any'
            const isEditingThis = editingId === s.id
            return (
              <div
                key={s.id}
                className={`border rounded-lg p-3 transition-colors
                  ${isEditingThis ? 'border-blue-300 bg-blue-50/40' : 'border-gray-200'}`}
              >
                {/* Collapsed header row */}
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="font-medium text-gray-900 truncate">{s.name}</div>
                    <div className="text-xs text-gray-500">
                      รหัส: {s.id} · หมวด: {s.category || 'core'}
                      {s.is_heavy && ' · วิชาหนัก'} · ใช้งาน {refCount} รายการ
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      onClick={() => (isEditingThis ? resetEdit() : startEdit(s))}
                      className={`p-1.5 ${isEditingThis ? 'text-blue-600' : 'text-gray-500 hover:text-blue-600'}`}
                      title={isEditingThis ? 'ปิดการแก้ไข' : 'แก้ไข'}
                    >
                      <Pencil className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => deleteSubject(s.id)}
                      className="p-1.5 text-red-500 hover:text-red-700"
                      title="ลบ"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                {/* In-place expandable edit form */}
                {isEditingThis ? (
                  <div className="mt-3 border-t border-blue-200 pt-3 space-y-3">
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="text-xs text-gray-500">รหัสวิชา</label>
                        <input
                          disabled
                          value={form.id}
                          className="mt-0.5 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm bg-gray-100"
                        />
                      </div>
                      <div>
                        <label className="text-xs text-gray-500">ชื่อวิชา</label>
                        <input
                          placeholder="ชื่อวิชา"
                          value={form.name}
                          onChange={(e) => setForm({ ...form, name: e.target.value })}
                          className="mt-0.5 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                        />
                      </div>
                      <div>
                        <label className="text-xs text-gray-500">หมวดหมู่</label>
                        <select
                          value={form.category}
                          onChange={(e) => setForm({ ...form, category: e.target.value })}
                          className="mt-0.5 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                        >
                          {SUBJECT_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                        </select>
                      </div>
                      <label className="flex items-end gap-2 text-sm text-gray-700 pb-1">
                        <input
                          type="checkbox"
                          checked={form.is_heavy}
                          onChange={(e) => setForm({ ...form, is_heavy: e.target.checked })}
                          className="w-4 h-4"
                        />
                        วิชาหนัก (is_heavy)
                      </label>
                    </div>

                    {/* Time preference picker (form-controlled while editing) */}
                    <div>
                      <div className="text-xs text-gray-500 mb-1">ช่วงเวลาที่เน้น</div>
                      <div className="flex flex-wrap gap-1.5">
                        {SUBJECT_TIME_PREFS.map((p) => {
                          const active = form.time_preference === p.key
                          return (
                            <button
                              key={p.key}
                              onClick={() => setForm({ ...form, time_preference: p.key })}
                              className={`text-xs px-2.5 py-1 rounded-full border transition-colors
                                ${active
                                  ? 'bg-blue-100 border-blue-300 text-blue-700'
                                  : 'bg-white border-gray-200 text-gray-500 hover:border-gray-300'
                                }`}
                            >
                              {p.icon} {p.label}
                            </button>
                          )
                        })}
                      </div>
                      <p className="text-[11px] text-gray-400 mt-1">
                        ใช้เป็นค่าเริ่มต้น (Soft) — ถ้าต้องการบังคับ (Hard) หรือเลือกวิชาเฉพาะหลายรายการ
                        ไปที่ "เงื่อนไขระดับระบบ → วิชาเฉพาะช่วงเวลา" ด้านบน
                      </p>
                    </div>

                    <div className="flex gap-2 justify-end">
                      <button onClick={resetEdit} className="btn-secondary text-sm">ยกเลิก</button>
                      <button
                        onClick={saveEdit}
                        disabled={!form.name.trim()}
                        className="btn-primary text-sm"
                      >
                        บันทึก
                      </button>
                    </div>
                  </div>
                ) : (
                  /* Quick preference toggles (collapsed state) */
                  <div className="flex flex-wrap gap-1.5 mt-2">
                    {SUBJECT_TIME_PREFS.map((p) => {
                      const active = activePref === p.key
                      return (
                        <button
                          key={p.key}
                          onClick={() => setPreference(s.id, p.key)}
                          className={`text-xs px-2.5 py-1 rounded-full border transition-colors
                            ${active
                              ? 'bg-blue-100 border-blue-300 text-blue-700'
                              : 'bg-white border-gray-200 text-gray-500 hover:border-gray-300'
                            }`}
                        >
                          {p.icon} {p.label}
                        </button>
                      )
                    })}
                  </div>
                )}
              </div>
            )
          })}
        </div>

        {/* Add new subject form (bottom — only for adding, not editing) */}
        {showAddForm ? (
          <div className="mt-4 border-t border-gray-100 pt-4 space-y-2">
            <div className="text-sm font-medium text-gray-700">เพิ่มวิชาใหม่</div>
            <div className="grid grid-cols-2 gap-2">
              <input
                placeholder="รหัสวิชา (เช่น MA)"
                value={form.id}
                onChange={(e) => setForm({ ...form, id: e.target.value })}
                className="border border-gray-300 rounded-lg px-3 py-2 text-sm"
              />
              <input
                placeholder="ชื่อวิชา"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                className="border border-gray-300 rounded-lg px-3 py-2 text-sm"
              />
              <select
                value={form.category}
                onChange={(e) => setForm({ ...form, category: e.target.value })}
                className="border border-gray-300 rounded-lg px-3 py-2 text-sm"
              >
                {SUBJECT_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
              <label className="flex items-center gap-2 text-sm text-gray-700">
                <input
                  type="checkbox"
                  checked={form.is_heavy}
                  onChange={(e) => setForm({ ...form, is_heavy: e.target.checked })}
                />
                วิชาหนัก (is_heavy)
              </label>
            </div>
            <div className="flex gap-2 justify-end">
              <button onClick={resetAdd} className="btn-secondary text-sm">ยกเลิก</button>
              <button
                onClick={addSubject}
                disabled={!form.id.trim() || !form.name.trim()}
                className="btn-primary text-sm"
              >
                เพิ่ม
              </button>
            </div>
          </div>
        ) : (
          <div className="mt-4 border-t border-gray-100 pt-4">
            <button
              onClick={startAdd}
              className="text-sm text-blue-600 flex items-center gap-1 hover:text-blue-700"
            >
              <Plus className="w-4 h-4" />
              เพิ่มวิชาใหม่
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
