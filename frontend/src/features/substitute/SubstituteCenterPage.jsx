import { useState, useMemo, useEffect, useRef } from 'react'
import {
  CalendarDays, CalendarClock, UserX, Users, Check, X, Trash2, ArrowRight,
  History, BarChart3, FileDown, Printer, ArrowLeft, Info, AlertTriangle,
  Plus, Eye, Pencil, Loader2, CheckCircle2, Cloud,
} from 'lucide-react'
import { useApp } from '../../context/AppContext.jsx'
import DateField from '../../components/common/DateField.jsx'
import {
  DAY_LABELS, dateToDayOfWeek, todayISO, formatThaiDate, formatShortDate,
  getDaySlots, computeFreeTeachers, formatTimeRange, buildDailyGrid, makeAssignmentId,
  normalizeDailySchedule, getDayHalves, filterSlotsByRange, computeDaySummary, isPeriodInRange,
} from './dailySchedule.js'
import TeacherSearchSelect from './TeacherSearchSelect.jsx'
import {
  computeBaseTeacherLoad, computeSubstituteStats, computeSubstituteSummary,
  buildStatsRows, mondayOfWeek, isDateInRange,
  computeSubstituteCountsThisWeek, buildFreeTeacherRows, computeAbsenceReasonStats,
} from './substituteStats.js'
import {
  exportDailySchedulePDF, exportDailyScheduleExcel, exportStatsPDF, exportStatsExcel,
} from './exportDailySchedule.js'

function toISODate(d) {
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${m}-${day}`
}

const TAB_STYLES = (active) => `flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-semibold transition-colors
  ${active ? 'bg-blue-600 text-white shadow-sm' : 'text-gray-600 hover:bg-gray-100'}`

const REASON_PRESETS = ['ลาป่วย', 'ลากิจ', 'ลาอบรม', 'ราชการ', 'อื่นๆ']
const RANGE_LABELS = { all: 'ทั้งวัน', morning: 'เช้า', afternoon: 'บ่าย' }

export default function SubstituteCenterPage() {
  const { fixtureData, result, setStep } = useApp()
  if (!fixtureData) {
    return (
      <div className="flex flex-col items-center justify-center py-20 space-y-6">
        <div className="w-20 h-20 rounded-full bg-orange-50 flex items-center justify-center">
          <CalendarClock className="w-10 h-10 text-orange-300" />
        </div>
        <div className="text-center space-y-2">
          <h2 className="text-xl font-bold text-gray-700">ยังไม่มีข้อมูล</h2>
          <p className="text-gray-500">ต้องมีตารางหลักที่จัดแล้วก่อนใช้ระบบสอนแทนรายวัน</p>
        </div>
        <button onClick={() => setStep(5)} className="btn-primary flex items-center gap-2">
          ไปหน้าตารางสอน
          <ArrowRight className="w-4 h-4" />
        </button>
      </div>
    )
  }
  if (!result) {
    return (
      <div className="flex flex-col items-center justify-center py-20 space-y-6">
        <div className="w-20 h-20 rounded-full bg-orange-50 flex items-center justify-center">
          <AlertTriangle className="w-10 h-10 text-orange-300" />
        </div>
        <div className="text-center space-y-2">
          <h2 className="text-xl font-bold text-gray-700">ยังไม่ได้จัดตารางหลัก</h2>
          <p className="text-gray-500">กรุณาจัดตารางสอนก่อน (Step 5) แล้วจึงเข้าสอนแทนรายวัน</p>
        </div>
        <button onClick={() => setStep(5)} className="btn-primary flex items-center gap-2">
          ไปจัดตารางสอน
          <ArrowRight className="w-4 h-4" />
        </button>
      </div>
    )
  }
  return <SubstituteCenterInner />
}

function SubstituteCenterInner() {
  const {
    fixtureData, result, userPlacements, dailySchedules, setDailySchedule,
    removeDailySchedule, setStep, selectedFixture, canManage,
    isSnapshotDirty, lastSnapshotSaveAt, activeSnapshotId, saveSnapshot, saveToCloud, user,
  } = useApp()
  const readOnly = !canManage

  const [activeTab, setActiveTab] = useState('daily') // 'daily' | 'history' | 'stats'
  const [dateStr, setDateStr] = useState(() => todayISO())
  const [absences, setAbsences] = useState([]) // [{ teacherId, reason, periodRange }]
  const [note, setNote] = useState('')
  const [assignments, setAssignments] = useState([])
  const [viewMode, setViewMode] = useState('edit') // 'edit' | 'result'
  const [selectedAbsenceIdx, setSelectedAbsenceIdx] = useState(null)
  const [selectedSlot, setSelectedSlot] = useState(null) // { period, classId, subjectId, teacherId, role }
  const [showAbsenceDialog, setShowAbsenceDialog] = useState(false)
  const [editAbsenceIdx, setEditAbsenceIdx] = useState(null)
  const [confirmDeleteDate, setConfirmDeleteDate] = useState(false)
  const [pendingChange, setPendingChange] = useState(null) // { kind, idx, entry, affected }
  const [toast, setToast] = useState(null)
  const toastTimerRef = useRef(null)
  const initDateRef = useRef(null)

  const { teachers, classes, subjects, lesson_blocks, schedule_blocks = [], schedule_config } = fixtureData
  const resultSlots = result?.slots || []
  const lessonBlockMap = useMemo(() => new Map((lesson_blocks || []).map((lb) => [lb.id, lb])), [lesson_blocks])
  const dayOfWeek = dateToDayOfWeek(dateStr)
  const dayHalves = useMemo(() => getDayHalves(schedule_blocks, schedule_config), [schedule_blocks, schedule_config])
  const daySlots = useMemo(
    () => getDaySlots(resultSlots, userPlacements, lessonBlockMap, dayOfWeek),
    [resultSlots, userPlacements, lessonBlockMap, dayOfWeek],
  )
  const saved = useMemo(() => normalizeDailySchedule(dailySchedules[dateStr]), [dailySchedules, dateStr])

  // ── โหลดข้อมูลของวันที่เมื่อเปลี่ยนวันที่ (ครั้งเดียวต่อวันที่) ────────
  useEffect(() => {
    if (initDateRef.current === dateStr) return
    initDateRef.current = dateStr
    setAbsences(saved?.absences || [])
    setNote(saved?.note || '')
    setAssignments(saved?.assignments || [])
    setSelectedAbsenceIdx(null)
    setSelectedSlot(null)
    setViewMode('edit')
    setConfirmDeleteDate(false)
  }, [dateStr, saved])

  const showToast = (msg) => {
    setToast(msg)
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current)
    toastTimerRef.current = setTimeout(() => setToast(null), 3000)
  }

  const persistDaily = (nextAssignments, nextAbsences, nextNote) => {
    if (readOnly) return
    setDailySchedule({
      date: dateStr,
      dayOfWeek,
      day_type: saved?.day_type || 'normal',
      blocked_periods: saved?.blocked_periods || [],
      absences: nextAbsences ?? absences,
      note: nextNote ?? note,
      assignments: nextAssignments ?? assignments,
      created_at: saved?.created_at || null,
      updated_at: new Date().toISOString(),
    })
  }

  // ── Handlers ─────────────────────────────────────────────────────────
  const handleSelectDate = (d) => {
    if (!d) return
    setDateStr(d)
  }

  const applyAbsenceChange = (entry, replaceIdx, dropAssignments = []) => {
    const next = replaceIdx >= 0
      ? absences.map((a, i) => (i === replaceIdx ? entry : a))
      : [...absences, entry]
    let nextAssignments = assignments
    if (dropAssignments.length) {
      const ids = new Set(dropAssignments.map((x) => x.id))
      nextAssignments = assignments.filter((x) => !ids.has(x.id))
      setAssignments(nextAssignments)
    }
    setAbsences(next)
    persistDaily(nextAssignments, next)
  }

  const upsertAbsence = (entry) => {
    const replaceIdx = editAbsenceIdx != null
      ? editAbsenceIdx
      : absences.findIndex((a) => a.teacherId === entry.teacherId)
    if (replaceIdx >= 0) {
      // เปลี่ยนช่วงลาให้แคบลง → มีสอนแทนที่อยู่นอกช่วงใหม่ (ต้องถามก่อน)
      const affected = assignments.filter(
        (x) => x.original_teacher_id === entry.teacherId && !isPeriodInRange(x.period, entry.periodRange, dayHalves),
      )
      if (affected.length > 0) {
        setPendingChange({ kind: 'edit', idx: replaceIdx, entry, affected })
        setShowAbsenceDialog(false)
        return
      }
    }
    applyAbsenceChange(entry, replaceIdx)
    setEditAbsenceIdx(null)
    setShowAbsenceDialog(false)
  }

  const applyRemoveAbsence = (idx, dropAssignments = []) => {
    const next = absences.filter((_, i) => i !== idx)
    let nextAssignments = assignments
    if (dropAssignments.length) {
      const ids = new Set(dropAssignments.map((x) => x.id))
      nextAssignments = assignments.filter((x) => !ids.has(x.id))
      setAssignments(nextAssignments)
    }
    setAbsences(next)
    persistDaily(nextAssignments, next)
    if (selectedAbsenceIdx === idx) { setSelectedAbsenceIdx(null); setSelectedSlot(null) }
    else if (selectedAbsenceIdx != null && selectedAbsenceIdx > idx) setSelectedAbsenceIdx(selectedAbsenceIdx - 1)
  }

  const removeAbsence = (idx) => {
    const absence = absences[idx]
    const affected = assignments.filter((x) => x.original_teacher_id === absence.teacherId)
    if (affected.length > 0) {
      setPendingChange({ kind: 'remove', idx, entry: absence, affected })
      return
    }
    applyRemoveAbsence(idx)
  }

  const resolvePendingChange = (drop) => {
    const p = pendingChange
    setPendingChange(null)
    if (!p) return
    const dropped = drop ? p.affected : []
    if (p.kind === 'remove') applyRemoveAbsence(p.idx, dropped)
    else { applyAbsenceChange(p.entry, p.idx, dropped); setEditAbsenceIdx(null) }
    if (drop) showToast(`ลบการสอนแทน ${dropped.length} รายการแล้ว`)
  }

  const handleNoteChange = (e) => {
    const v = e.target.value
    setNote(v)
    persistDaily(undefined, undefined, v)
  }

  const assignSubstitute = (slot, substituteTeacherId) => {
    const role = slot.role || 'main'
    const existingIdx = assignments.findIndex(
      (a) => a.period === slot.period && a.class_id === slot.classId && (a.role || 'main') === role,
    )
    const entry = {
      id: existingIdx >= 0 ? assignments[existingIdx].id : makeAssignmentId(),
      period: slot.period,
      class_id: slot.classId,
      subject_id: slot.subjectId,
      original_teacher_id: slot.teacherId,
      substitute_teacher_id: substituteTeacherId,
      role,
      created_at: existingIdx >= 0 ? assignments[existingIdx].created_at : new Date().toISOString(),
    }
    const next = existingIdx >= 0
      ? assignments.map((a, i) => (i === existingIdx ? entry : a))
      : [...assignments, entry]
    setAssignments(next)
    persistDaily(next)
    setSelectedSlot(null)
    showToast(`มอบหมาย ${teachers.find((t) => t.id === substituteTeacherId)?.name || ''} สอนแทนแล้ว`)
  }

  const removeAssignment = (id) => {
    const next = assignments.filter((a) => a.id !== id)
    setAssignments(next)
    persistDaily(next)
  }

  const handleDeleteDate = () => {
    removeDailySchedule(dateStr)
    initDateRef.current = null
    setAbsences([])
    setNote('')
    setAssignments([])
    setViewMode('edit')
    setConfirmDeleteDate(false)
    showToast('ลบตารางสอนแทนของวันนี้แล้ว')
  }

  const handleOpenDate = (d) => {
    setDateStr(d)
    setActiveTab('daily')
  }

  const grid = useMemo(
    () => buildDailyGrid({
      daySlots,
      assignments,
      classes,
      subjects,
      teachers,
      scheduleBlocks: schedule_blocks,
      scheduleConfig: schedule_config,
      lessonBlockMap,
    }),
    [daySlots, assignments, classes, subjects, teachers, schedule_blocks, schedule_config, lessonBlockMap],
  )

  const summary = useMemo(
    () => computeDaySummary({ daySlots, assignments, absences, halves: dayHalves, lessonBlockMap }),
    [daySlots, assignments, absences, dayHalves, lessonBlockMap],
  )

  // สอนแทนที่ค้าง — ครูไม่ได้ลาอยู่ในคาบนั้นแล้ว (เช่น ลบครูที่ลาหรือเปลี่ยนช่วงลา)
  const staleAssignments = useMemo(() => {
    const map = new Map(absences.map((a) => [a.teacherId, a]))
    return assignments.filter((x) => {
      const abs = map.get(x.original_teacher_id)
      return !abs || !isPeriodInRange(x.period, abs.periodRange, dayHalves)
    })
  }, [assignments, absences, dayHalves])

  const clearStaleAssignments = () => {
    const ids = new Set(staleAssignments.map((x) => x.id))
    const next = assignments.filter((x) => !ids.has(x.id))
    setAssignments(next)
    persistDaily(next)
    showToast(`ล้างการสอนแทนค้าง ${ids.size} รายการแล้ว`)
  }

  const subjectMap = useMemo(() => new Map((subjects || []).map((s) => [s.id, s])), [subjects])
  const classMap = useMemo(() => new Map((classes || []).map((c) => [c.id, c])), [classes])
  const teacherMap = useMemo(() => new Map((teachers || []).map((t) => [t.id, t])), [teachers])

  // ── คาบของครูที่ลา (ตาม teacherId + ช่วงของ absence นั้น) + role ──────
  const slotsForTeacher = (teacherId, periodRange) => {
    const tagged = daySlots
      .map((s) => {
        const lb = lessonBlockMap.get(s.lesson_block_id)
        const coId = lb?.co_teacher_id || s.co_teacher_id
        if (s.teacher_id === teacherId) return { ...s, role: 'main' }
        if (coId === teacherId) return { ...s, role: 'co', _coTeacherId: coId }
        return null
      })
      .filter(Boolean)
      .sort((a, b) => a.period - b.period)
    return filterSlotsByRange(tagged, periodRange || 'all', dayHalves)
  }

  const assignmentStatus = (period, classId) => {
    const found = { main: null, co: null }
    for (const a of assignments) {
      if (a.period === period && a.class_id === classId) {
        found[a.role === 'co' ? 'co' : 'main'] = a
      }
    }
    return found
  }

  // ── สถิติสอนแทนสัปดาห์นี้ + ภาระฐาน สำหรับเรียงครูว่าง ─────────────────
  const baseLoads = useMemo(
    () => computeBaseTeacherLoad({
      resultSlots, userPlacements, lessonBlockMap,
      scheduleBlocks: schedule_blocks, scheduleConfig: schedule_config,
      fixedSlots: fixtureData.fixed_slots,
    }),
    [resultSlots, userPlacements, lessonBlockMap, schedule_blocks, schedule_config, fixtureData.fixed_slots],
  )
  const subCountsThisWeek = useMemo(
    () => computeSubstituteCountsThisWeek(dailySchedules, { scheduleBlocks: schedule_blocks, scheduleConfig: schedule_config }),
    [dailySchedules, schedule_blocks, schedule_config],
  )

  const freeTeacherRows = useMemo(() => {
    if (!selectedSlot) return []
    const absentTeacherIds = absences.map((a) => a.teacherId)
    const free = computeFreeTeachers({
      dayOfWeek,
      period: selectedSlot.period,
      daySlots,
      assignments,
      teachers,
      absentTeacherIds,
      lessonBlockMap,
      fixedSlots: fixtureData.fixed_slots,
    })
    const rows = buildFreeTeacherRows({ freeTeachers: free, baseLoads, subCountsThisWeek })
    // ครูร่วมของคาบ/ห้องนี้ (ตำแหน่งตรงข้าม) ที่ยังไม่ลา — ขึ้นเป็นตัวเลือกแรกเสมอ
    const slot = daySlots.find((s) => s.class_id === selectedSlot.classId && s.period === selectedSlot.period)
    const coIds = []
    if (slot) {
      const lb = lessonBlockMap.get(slot.lesson_block_id)
      const coId = lb?.co_teacher_id || slot.co_teacher_id || null
      const partner = selectedSlot.role === 'co' ? slot.teacher_id : coId
      if (partner && !absentTeacherIds.includes(partner)) coIds.push(partner)
    }
    const coRows = coIds
      .filter((id) => !rows.some((r) => r.teacher.id === id))
      .map((id) => {
        const t = teachers.find((x) => x.id === id)
        if (!t) return null
        const base = baseLoads[id]?.periodsPerWeek || 0
        const sub = subCountsThisWeek[id] || 0
        return { teacher: t, basePeriodsPerWeek: base, subPeriodsThisWeek: sub, totalLoad: base + sub, isCoTeacher: true }
      })
      .filter(Boolean)
    return [...coRows, ...rows]
  }, [selectedSlot, dayOfWeek, daySlots, assignments, teachers, absences, lessonBlockMap, fixtureData.fixed_slots, baseLoads, subCountsThisWeek])

  const historyDates = useMemo(
    () => Object.keys(dailySchedules || {}).sort((a, b) => b.localeCompare(a)),
    [dailySchedules],
  )

  const handleExportPDF = () => {
    exportDailySchedulePDF({
      dateStr,
      dayLabel: formatThaiDate(dateStr),
      grid,
      assignments,
      absences,
      teachers,
      subjects,
      classes,
      scheduleLabel: `ตารางหลัก: ${selectedFixture}`,
      note,
    }).catch((e) => showToast(`ส่งออกไม่สำเร็จ: ${e.message}`))
  }
  const handleExportExcel = () => {
    exportDailyScheduleExcel({
      dateStr,
      dayLabel: formatThaiDate(dateStr),
      grid,
      assignments,
      absences,
      teachers,
      subjects,
      classes,
    }).catch((e) => showToast(`ส่งออกไม่สำเร็จ: ${e.message}`))
  }

  const handleSaveNow = () => {
    const res = saveSnapshot(null, { updateExisting: true })
    if (res?.ok) showToast('บันทึกการสอนแทนแล้ว')
    else showToast(`บันทึกไม่สำเร็จ: ${res?.error || 'ไม่ทราบสาเหตุ'}`)
  }

  const handleSaveCloud = async () => {
    if (!user) { showToast('กรุณาเข้าสู่ระบบ Google ก่อนบันทึกขึ้นคลาวด์'); return }
    const res = await saveToCloud()
    if (res?.ok) showToast('บันทึกขึ้นคลาวด์แล้ว')
    else showToast(`บันทึกขึ้นคลาวด์ไม่สำเร็จ: ${res?.error || 'ไม่ทราบสาเหตุ'}`)
  }

  const handleOpenPrintStudio = () => {
    try { sessionStorage.setItem('print_sub_date', dateStr) } catch { /* ignore */ }
    setStep(6)
  }

  const saveTimeLabel = lastSnapshotSaveAt
    ? new Date(lastSnapshotSaveAt).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' })
    : null

  return (
    <div className="space-y-5">
      {/* ── Header ── */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <button
            onClick={() => setStep(0)}
            className="p-2 rounded-lg text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition-colors"
            title="กลับหน้าเลือกงาน"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div>
            <h1 className="text-xl font-bold text-gray-800 flex items-center gap-2">
              <CalendarClock className="w-5 h-5 text-orange-600" />
              ระบบสอนแทนรายวัน
            </h1>
            <p className="text-xs text-gray-400">จัดตารางรายวันแยกจากตารางหลัก + ประวัติ + สถิติยืนยันภาระครู</p>
          </div>
        </div>
        <div className="flex gap-1.5">
          <button onClick={() => setActiveTab('daily')} className={TAB_STYLES(activeTab === 'daily')}>
            <CalendarDays className="w-4 h-4" /> รายวัน
          </button>
          <button onClick={() => setActiveTab('history')} className={TAB_STYLES(activeTab === 'history')}>
            <History className="w-4 h-4" /> ประวัติ
            {historyDates.length > 0 && (
              <span className="px-1.5 py-0.5 rounded-full bg-white/25 text-[10px] font-bold">{historyDates.length}</span>
            )}
          </button>
          <button onClick={() => setActiveTab('stats')} className={TAB_STYLES(activeTab === 'stats')}>
            <BarChart3 className="w-4 h-4" /> สถิติ
          </button>
          <button
            onClick={handleOpenPrintStudio}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-semibold bg-slate-700 text-white hover:bg-slate-800 transition-colors"
            title="เปิดเอกสารสอนแทน (สรุป/รายห้อง/รายครู/ครูที่ลา) ใน Print Studio"
          >
            <Printer className="w-4 h-4" /> Print Studio
          </button>
        </div>
      </div>

      {/* ── แถบสถานะการบันทึก + ปุ่มบันทึก ── */}
      <div className="flex items-center justify-between gap-2 flex-wrap bg-white border border-gray-200 rounded-xl px-4 py-2.5 shadow-sm">
        <div className="flex items-center gap-2 text-xs flex-wrap">
          <span className={`inline-flex items-center gap-1.5 font-semibold ${isSnapshotDirty ? 'text-amber-600' : (saveTimeLabel ? 'text-emerald-600' : 'text-gray-500')}`}>
            {isSnapshotDirty
              ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> กำลังบันทึก…</>
              : <><CheckCircle2 className="w-3.5 h-3.5" /> {saveTimeLabel ? `บันทึกแล้ว ${saveTimeLabel}` : 'ยังไม่ได้บันทึก'}</>}
          </span>
          <span className="text-gray-400">
            · บันทึกอัตโนมัติ{activeSnapshotId ? 'ลง workspace นี้' : 'ในเครื่องนี้'} ทุกการเปลี่ยนแปลง
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <button
            onClick={handleSaveNow}
            disabled={readOnly}
            className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold bg-blue-50 text-blue-700 hover:bg-blue-100 transition-colors disabled:opacity-40"
            title="บันทึกลง workspace ทันที (ไม่ต้องรอ auto-save)"
          >
            <Check className="w-3.5 h-3.5" /> บันทึก
          </button>
          <button
            onClick={handleSaveCloud}
            disabled={readOnly || !user}
            className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold bg-violet-600 text-white hover:bg-violet-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            title={user ? 'บันทึกขึ้นคลาวด์ (Google)' : 'ต้องเข้าสู่ระบบ Google ก่อน'}
          >
            <Cloud className="w-3.5 h-3.5" /> บันทึกขึ้นคลาวด์
          </button>
        </div>
      </div>

      {activeTab === 'daily' && viewMode === 'edit' && (
        <DailyTab
          dateStr={dateStr}
          setDateStr={handleSelectDate}
          dayOfWeek={dayOfWeek}
          teachers={teachers}
          subjects={subjects}
          classes={classes}
          subjectMap={subjectMap}
          classMap={classMap}
          teacherMap={teacherMap}
          slotsForTeacher={slotsForTeacher}
          dayHalves={dayHalves}
          absences={absences}
          selectedAbsenceIdx={selectedAbsenceIdx}
          setSelectedAbsenceIdx={setSelectedAbsenceIdx}
          removeAbsence={removeAbsence}
          onOpenAbsenceDialog={() => { setEditAbsenceIdx(null); setShowAbsenceDialog(true) }}
          onEditAbsence={(idx) => { setEditAbsenceIdx(idx); setShowAbsenceDialog(true) }}
          selectedSlot={selectedSlot}
          setSelectedSlot={setSelectedSlot}
          freeTeacherRows={freeTeacherRows}
          assignSubstitute={assignSubstitute}
          assignmentStatus={assignmentStatus}
          assignments={assignments}
          removeAssignment={removeAssignment}
          note={note}
          handleNoteChange={handleNoteChange}
          summary={summary}
          onShowResult={() => setViewMode('result')}
          confirmDeleteDate={confirmDeleteDate}
          setConfirmDeleteDate={setConfirmDeleteDate}
          handleDeleteDate={handleDeleteDate}
          readOnly={readOnly}
          staleCount={summary.staleAssignmentCount}
          onClearStale={clearStaleAssignments}
          onOpenPrintStudio={handleOpenPrintStudio}
        />
      )}

      {activeTab === 'daily' && viewMode === 'result' && (
        <ResultView
          dateStr={dateStr}
          dayOfWeek={dayOfWeek}
          grid={grid}
          assignments={assignments}
          absences={absences}
          summary={summary}
          teacherMap={teacherMap}
          subjectMap={subjectMap}
          classMap={classMap}
          note={note}
          handleNoteChange={handleNoteChange}
          onBack={() => setViewMode('edit')}
          onExportPDF={handleExportPDF}
          onExportExcel={handleExportExcel}
          onShowStats={() => setActiveTab('stats')}
          onOpenPrintStudio={handleOpenPrintStudio}
          readOnly={readOnly}
        />
      )}

      {activeTab === 'history' && (
        <HistoryTab
          historyDates={historyDates}
          dailySchedules={dailySchedules}
          teacherMap={teacherMap}
          onOpen={handleOpenDate}
          onDelete={(d) => { removeDailySchedule(d); showToast('ลบตารางสอนแทนของวันนั้นแล้ว') }}
          readOnly={readOnly}
        />
      )}

      {activeTab === 'stats' && (
        <StatsTab
          teachers={teachers}
          dailySchedules={dailySchedules}
          resultSlots={resultSlots}
          userPlacements={userPlacements}
          lessonBlockMap={lessonBlockMap}
          scheduleBlocks={schedule_blocks}
          scheduleConfig={schedule_config}
          fixedSlots={fixtureData.fixed_slots}
        />
      )}

      {/* ── Dialog เพิ่ม/แก้ไขครูที่ลา ── */}
      {showAbsenceDialog && (
        <AbsenceDialog
          teachers={teachers}
          teacherMap={teacherMap}
          existing={editAbsenceIdx != null ? absences[editAbsenceIdx] : null}
          absentIds={absences.map((a) => a.teacherId)}
          fixtureName={selectedFixture}
          slotsForTeacher={slotsForTeacher}
          dayOfWeek={dayOfWeek}
          onClose={() => { setShowAbsenceDialog(false); setEditAbsenceIdx(null) }}
          onSave={upsertAbsence}
        />
      )}

      {pendingChange && (
        <ConfirmAssignmentsDialog
          pending={pendingChange}
          teacherMap={teacherMap}
          onCancel={() => { setPendingChange(null); setEditAbsenceIdx(null) }}
          onResolve={resolvePendingChange}
        />
      )}

      {toast && (
        <div className="fixed bottom-6 right-6 z-[120] px-4 py-3 rounded-xl shadow-lg text-sm font-medium bg-green-600 text-white">
          {toast}
        </div>
      )}
    </div>
  )
}

/* ═══════════════════════════ Dialog: เพิ่ม/แก้ครูที่ลา ═══════════════════════════ */
function AbsenceDialog({ teachers, teacherMap, existing, absentIds, fixtureName, slotsForTeacher, dayOfWeek, onClose, onSave }) {
  const [teacherId, setTeacherId] = useState(existing?.teacherId || '')
  const [periodRange, setPeriodRange] = useState(existing?.periodRange || 'all')
  const [reason, setReason] = useState(existing?.reason || '')
  const reasonKey = `absence_reasons_${fixtureName}`
  const [recentReasons, setRecentReasons] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem(reasonKey) || '[]')
    } catch { return [] }
  })
  const [customReason, setCustomReason] = useState('')

  const slotCount = teacherId ? slotsForTeacher(teacherId, periodRange).length : 0

  const saveReasonToStorage = (r) => {
    const v = (r || '').trim()
    if (!v || REASON_PRESETS.includes(v)) return
    const next = [v, ...recentReasons.filter((x) => x !== v)].slice(0, 50)
    setRecentReasons(next)
    try { localStorage.setItem(reasonKey, JSON.stringify(next)) } catch { /* ignore */ }
  }

  const handleSave = () => {
    if (!teacherId) return
    const finalReason = (customReason.trim() || reason || '').trim()
    saveReasonToStorage(finalReason)
    onSave({ teacherId, reason: finalReason, periodRange })
  }

  const allReasons = [...new Set([...REASON_PRESETS, ...recentReasons])]

  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-md p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-base font-bold text-gray-900 flex items-center gap-2">
            <UserX className="w-4 h-4 text-orange-600" />
            {existing ? 'แก้ไขครูที่ลา' : 'เพิ่มครูที่ลา / ไม่มา'}
          </h3>
          <button onClick={onClose} className="p-1 rounded-lg text-gray-400 hover:bg-gray-100"><X className="w-4 h-4" /></button>
        </div>

        <div>
          <label className="text-xs font-medium text-gray-600 block mb-1">ครู (พิมพ์ชื่อเพื่อค้นหา)</label>
          <TeacherSearchSelect
            teachers={teachers}
            value={teacherId}
            onChange={setTeacherId}
            absentIds={existing ? [] : absentIds}
            disabled={!!existing}
            placeholder="พิมพ์ชื่อครู เช่น สมชาย…"
          />
        </div>

        <div>
          <label className="text-xs font-medium text-gray-600 block mb-1.5">ช่วงที่ลา</label>
          <div className="flex gap-1.5">
            {[['all', 'ทั้งวัน'], ['morning', 'เช้า'], ['afternoon', 'บ่าย']].map(([val, label]) => (
              <button
                key={val}
                onClick={() => setPeriodRange(val)}
                className={`flex-1 px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors
                  ${periodRange === val ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-600 border-gray-200 hover:border-blue-300'}`}
              >
                {label}
              </button>
            ))}
          </div>
          {teacherId && (
            <p className="text-[11px] text-gray-400 mt-1">
              ครูคนนี้มีสอน {slotCount} คาบในช่วง{RANGE_LABELS[periodRange]}นี้
            </p>
          )}
        </div>

        <div>
          <label className="text-xs font-medium text-gray-600 block mb-1.5">เหตุผลที่ลา</label>
          <div className="flex flex-wrap gap-1.5 mb-2">
            {REASON_PRESETS.map((r) => (
              <button
                key={r}
                onClick={() => { setReason(r); setCustomReason('') }}
                className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-colors
                  ${reason === r && !customReason ? 'bg-orange-100 border-orange-300 text-orange-700' : 'bg-white border-gray-200 text-gray-500 hover:border-gray-300'}`}
              >
                {r}
              </button>
            ))}
          </div>
          <input
            type="text"
            value={customReason}
            onChange={(e) => { setCustomReason(e.target.value); if (e.target.value) setReason(e.target.value) }}
            placeholder="พิมพ์เหตุผลอื่น (จำไว้ให้ครั้งหน้า)"
            list="absence-reasons-list"
            className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm"
          />
          <datalist id="absence-reasons-list">
            {allReasons.map((r) => <option key={r} value={r} />)}
          </datalist>
        </div>

        <div className="flex gap-2 pt-1">
          <button onClick={onClose} className="flex-1 px-4 py-2 rounded-lg text-sm font-medium text-gray-600 bg-gray-100 hover:bg-gray-200 transition-colors">
            ยกเลิก
          </button>
          <button
            onClick={handleSave}
            disabled={!teacherId}
            className="flex-1 px-4 py-2 rounded-lg text-sm font-semibold bg-orange-600 text-white hover:bg-orange-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {existing ? 'บันทึก' : 'เพิ่มครูที่ลา'}
          </button>
        </div>
      </div>
    </div>
  )
}

/* ═══════════════════════════ Tab: รายวัน (โหมดจัด) ═══════════════════════════ */
function DailyTab({
  dateStr, setDateStr, dayOfWeek, teachers, subjectMap, classMap, teacherMap,
  slotsForTeacher, absences, selectedAbsenceIdx, setSelectedAbsenceIdx,
  removeAbsence, onOpenAbsenceDialog, onEditAbsence,
  selectedSlot, setSelectedSlot, freeTeacherRows, assignSubstitute, assignmentStatus,
  assignments, removeAssignment, note, handleNoteChange,
  summary, onShowResult, confirmDeleteDate, setConfirmDeleteDate, handleDeleteDate,
  readOnly, staleCount = 0, onClearStale, onOpenPrintStudio,
}) {
  const selectedAbsence = selectedAbsenceIdx != null ? absences[selectedAbsenceIdx] : null
  const teacherDaySlots = useMemo(
    () => (selectedAbsence ? slotsForTeacher(selectedAbsence.teacherId, selectedAbsence.periodRange) : []),
    [selectedAbsence, slotsForTeacher],
  )
  return (
    <div className="space-y-4">
      {/* ── แถวเลือกวันที่ + สรุปวันนี้ ── */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4 flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <CalendarDays className="w-5 h-5 text-blue-600" />
          <div>
            <label className="text-xs font-medium text-gray-500 block">เลือกวัน/วันที่ (วว/ดด/ปปปป)</label>
            <DateField value={dateStr} onChange={setDateStr} title="เลือกวันที่" />
          </div>
        </div>
        <div className="text-sm text-gray-700 font-medium">
          {formatThaiDate(dateStr)}
          <span className="ml-2 text-xs text-gray-400">(วัน{DAY_LABELS[dayOfWeek]})</span>
        </div>
        <button
          onClick={() => setDateStr(todayISO())}
          className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-blue-50 text-blue-700 hover:bg-blue-100 transition-colors"
        >
          วันนี้
        </button>

        <div className="ml-auto flex items-center gap-2 flex-wrap">
          {/* สรุปวันนี้: สอนกี่คาบ / ครูลา / จัดแล้ว / ยังไม่ได้จัด */}
          <span className="text-[11px] text-gray-500 bg-gray-50 border border-gray-200 rounded-lg px-2.5 py-1.5">
            วันนี้มีสอน <b className="text-gray-700">{summary.totalPeriods}</b> คาบ
          </span>
          {summary.absentTeacherCount > 0 && (
            <span className="text-[11px] text-red-600 bg-red-50 border border-red-200 rounded-lg px-2.5 py-1.5">
              ครูลา {summary.absentTeacherCount} คน
            </span>
          )}
          {summary.absentPositionCount > 0 && (
            <span className="text-[11px] text-amber-600 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-1.5">
              ต้องหาแทน {summary.absentPositionCount} ตำแหน่ง
            </span>
          )}
          {assignments.length > 0 && (
            <span className="text-[11px] text-orange-600 bg-orange-50 border border-orange-200 rounded-lg px-2.5 py-1.5">
              สอนแทนแล้ว {assignments.length} คาบ
            </span>
          )}
          {summary.uncoveredCount > 0 && (
            <span className="text-[11px] font-bold text-white bg-red-500 rounded-lg px-2.5 py-1.5">
              ยังไม่ได้จัด {summary.uncoveredCount} ตำแหน่ง
            </span>
          )}
          {summary.coHintCount > 0 && (
            <span className="text-[11px] text-indigo-600 bg-indigo-50 border border-indigo-200 rounded-lg px-2.5 py-1.5">
              มีครูร่วมในห้อง {summary.coHintCount} คาบ — แนะนำเลือกครูร่วม
            </span>
          )}
          {staleCount > 0 && (
            <span className="text-[11px] text-amber-800 bg-amber-100 border border-amber-300 rounded-lg px-2.5 py-1.5 inline-flex items-center gap-1.5">
              สอนแทนค้าง {staleCount} คาบ (ครูไม่ได้ลาแล้ว)
              {!readOnly && onClearStale && (
                <button onClick={onClearStale} className="font-bold underline hover:text-red-700">ล้าง</button>
              )}
            </span>
          )}
        </div>
      </div>

      {/* ── ขั้น 1+2: รายการครูที่ลา + คาบที่สอน + ครูว่าง ── */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
        <div className="lg:col-span-3 bg-white rounded-xl border border-gray-200 shadow-sm p-4 space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <UserX className="w-4 h-4 text-orange-600" />
              <h3 className="font-bold text-gray-800 text-sm">1. ครูที่ลา / ไม่มาในวันนี้ ({absences.length})</h3>
            </div>
            {!readOnly && (
              <button
                onClick={onOpenAbsenceDialog}
                className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold bg-orange-600 text-white hover:bg-orange-700 transition-colors"
              >
                <Plus className="w-3.5 h-3.5" /> เพิ่มครูที่ลา
              </button>
            )}
          </div>

          {/* รายการครูที่ลา */}
          {absences.length === 0 ? (
            <p className="text-xs text-gray-400 italic bg-gray-50 rounded-lg px-3 py-4 text-center">
              ยังไม่มีครูที่ลา — กด "เพิ่มครูที่ลา" เพื่อเริ่มจัดสอนแทน
            </p>
          ) : (
            <div className="space-y-1.5 max-h-64 overflow-y-auto">
              {absences.map((a, idx) => {
                const t = teacherMap.get(a.teacherId)
                const slotCount = slotsForTeacher(a.teacherId, a.periodRange).length
                const isSelected = selectedAbsenceIdx === idx
                return (
                  <div
                    key={idx}
                    className={`flex items-center gap-2 rounded-lg border px-3 py-2 cursor-pointer transition-colors
                      ${isSelected ? 'border-orange-400 bg-orange-50 ring-1 ring-orange-300' : 'border-gray-200 bg-white hover:border-orange-300'}`}
                    onClick={() => { setSelectedAbsenceIdx(isSelected ? null : idx); setSelectedSlot(null) }}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-semibold text-gray-800">{t?.name || a.teacherId}</span>
                        <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium
                          ${a.periodRange === 'morning' ? 'bg-yellow-100 text-yellow-700'
                            : a.periodRange === 'afternoon' ? 'bg-sky-100 text-sky-700'
                            : 'bg-gray-100 text-gray-600'}`}>
                          {RANGE_LABELS[a.periodRange] || 'ทั้งวัน'}
                        </span>
                        {a.reason && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-purple-100 text-purple-700 font-medium">
                            {a.reason}
                          </span>
                        )}
                      </div>
                      <div className="text-[11px] text-gray-400">สอน {slotCount} คาบในช่วงนี้</div>
                    </div>
                    {!readOnly && (
                      <>
                        <button
                          onClick={(e) => { e.stopPropagation(); onEditAbsence(idx) }}
                          className="p-1.5 rounded-lg text-gray-400 hover:bg-gray-100 hover:text-gray-600 shrink-0"
                          title="แก้ไข"
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={(e) => { e.stopPropagation(); removeAbsence(idx) }}
                          className="p-1.5 rounded-lg text-red-400 hover:bg-red-50 hover:text-red-600 shrink-0"
                          title="ลบ"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </>
                    )}
                  </div>
                )
              })}
            </div>
          )}

          {/* คาบของครูที่เลือก */}
          <div>
            <div className="text-xs font-medium text-gray-500 mb-1.5">
              {selectedAbsence
                ? `${teacherMap.get(selectedAbsence.teacherId)?.name || ''} สอน ${teacherDaySlots.length} คาบ (ช่วง${RANGE_LABELS[selectedAbsence.periodRange] || 'ทั้งวัน'}) — กดคาบเพื่อหาครูสอนแทน`
                : 'เลือกครูที่ลาเพื่อดูคาบที่ต้องหาคนสอนแทน'}
            </div>
            {!selectedAbsence ? (
              <div className="text-xs text-gray-400 italic bg-gray-50 rounded-lg px-3 py-4 text-center">—</div>
            ) : teacherDaySlots.length === 0 ? (
              <div className="text-xs text-gray-400 italic bg-gray-50 rounded-lg px-3 py-4 text-center">
                ครูคนนี้ไม่มีคาบเรียนในช่วงนี้
              </div>
            ) : (
              <div className="space-y-1.5">
                {teacherDaySlots.map((s) => {
                  const role = s.role || 'main'
                  const assign = assignmentStatus(s.period, s.class_id)[role]
                  const coName = (() => { const lb = teacherMap.get(s.co_teacher_id); return lb?.name })()
                  const isSelected = selectedSlot?.period === s.period && selectedSlot?.classId === s.class_id && (selectedSlot?.role || 'main') === role
                  return (
                    <button
                      key={`${s.period}-${s.class_id}-${role}`}
                      onClick={() => setSelectedSlot(isSelected ? null : {
                        period: s.period,
                        classId: s.class_id,
                        subjectId: s.subject_id,
                        teacherId: s.teacher_id,
                        role,
                      })}
                      className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg border text-left text-sm transition-colors
                        ${isSelected ? 'border-orange-400 bg-orange-50 ring-1 ring-orange-300'
                          : assign ? 'border-emerald-200 bg-emerald-50/50 hover:border-emerald-300'
                          : 'border-gray-200 bg-white hover:border-orange-300'}`}
                    >
                      <span className="shrink-0 w-14 text-center font-bold text-gray-700 bg-gray-100 rounded-md py-1 text-xs">คาบ {s.period}</span>
                      <span className="font-medium text-gray-800 shrink-0">{subjectMap.get(s.subject_id)?.name || s.subject_id}</span>
                      <span className="text-gray-400 text-xs">·</span>
                      <span className="text-gray-500 text-xs truncate">{classMap.get(s.class_id)?.name || s.class_id}</span>
                      {role === 'co' && (
                        <span className="shrink-0 text-[10px] px-1.5 py-0.5 rounded-full bg-indigo-100 text-indigo-700 font-medium">ตำแหน่งครูร่วม</span>
                      )}
                      {assign && (
                        <span className="ml-auto shrink-0 inline-flex items-center gap-1 text-xs font-semibold text-emerald-700">
                          <Check className="w-3.5 h-3.5" />
                          {teacherMap.get(assign.substitute_teacher_id)?.name || ''}
                        </span>
                      )}
                      {!assign && isSelected && <ArrowRight className="ml-auto w-4 h-4 text-orange-500 shrink-0" />}
                    </button>
                  )
                })}
              </div>
            )}
          </div>
        </div>

        {/* ครูที่ว่าง */}
        <div className="lg:col-span-2 bg-white rounded-xl border border-gray-200 shadow-sm p-4">
          <div className="flex items-center gap-2 mb-3">
            <Users className="w-4 h-4 text-blue-600" />
            <h3 className="font-bold text-gray-800 text-sm">
              2. ครูที่ว่างคาบนี้
              {selectedSlot && <span className="ml-1 text-xs text-gray-400">(คาบ {selectedSlot.period}{selectedSlot.role === 'co' ? ' · ครูร่วม' : ''})</span>}
            </h3>
          </div>
          {!selectedSlot ? (
            <div className="text-xs text-gray-400 italic bg-gray-50 rounded-lg px-3 py-4 text-center">
              กดเลือกคาบจากฝั่งซ้ายเพื่อดูรายชื่อครูที่ว่าง
            </div>
          ) : freeTeacherRows.length === 0 ? (
            <div className="text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded-lg px-3 py-3">
              ไม่มีครูว่างในคาบนี้ — ต้องสลับคาบอื่นก่อน หรือปล่อยไว้ (คาบนี้จะไม่มีครูสอนแทน)
            </div>
          ) : (
            <div className="space-y-1.5">
              <div className="text-xs text-gray-400 mb-1">
                {freeTeacherRows.length} คนว่าง · เรียงตามภาระรวมน้อยสุดก่อน · คาบ {selectedSlot.period} · {classMap.get(selectedSlot.classId)?.name}
                {' · '}{subjectMap.get(selectedSlot.subjectId)?.name}
              </div>
              {freeTeacherRows.some((r) => r.isCoTeacher) && (
                <div className="text-[11px] text-indigo-700 bg-indigo-50 border border-indigo-200 rounded-lg px-2.5 py-1.5 mb-1">
                  คาบนี้มีครูร่วมอยู่แล้ว — แนะนำเลือกครูร่วมก่อน (หรือเลือกครูท่านอื่นก็ได้)
                </div>
              )}
              {freeTeacherRows.map((row) => (
                <div
                  key={row.teacher.id}
                  className={`flex items-center justify-between rounded-lg px-3 py-2.5 border
                    ${row.isCoTeacher ? 'bg-indigo-50/40 border-indigo-200' : 'bg-white border-gray-200'}`}
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-base font-semibold text-gray-900 truncate">{row.teacher.name}</span>
                      {row.isCoTeacher && (
                        <span className="shrink-0 text-[10px] px-1.5 py-0.5 rounded-full bg-indigo-100 text-indigo-700 font-medium">
                          ครูร่วม (สอนอยู่แล้ว)
                        </span>
                      )}
                    </div>
                    <div className="text-sm text-gray-600 truncate mt-0.5">
                      ภาระ {row.basePeriodsPerWeek} คาบ/สัปดาห์ · รวม {row.totalLoad} คาบ
                    </div>
                    <div className="mt-1">
                      {row.subPeriodsThisWeek === 0 ? (
                        <span className="text-xs px-2 py-0.5 rounded-full bg-slate-100 text-slate-500 font-medium">
                          ยังไม่เคยสอนแทน
                        </span>
                      ) : (
                        <span className="text-xs px-2 py-0.5 rounded-full bg-orange-100 text-orange-700 font-bold">
                          สอนแทนแล้ว {row.subPeriodsThisWeek} คาบ
                        </span>
                      )}
                    </div>
                  </div>
                  {!readOnly && (
                    <button
                      onClick={() => assignSubstitute(selectedSlot, row.teacher.id)}
                      className="shrink-0 inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold
                        bg-orange-600 text-white hover:bg-orange-700 transition-colors"
                    >
                      ให้สอนแทน
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* รายการที่ตั้งแล้ว */}
          {assignments.length > 0 && (
            <div className="mt-4 border-t border-gray-100 pt-3">
              <div className="text-xs font-bold text-gray-500 mb-1.5">รายการสอนแทนของวันนี้ ({assignments.length})</div>
              <div className="space-y-1.5 max-h-64 overflow-y-auto">
                {assignments.map((a) => (
                  <div key={a.id} className="flex items-center gap-1.5 bg-orange-50/60 border border-orange-200 rounded-lg px-2.5 py-1.5 text-xs">
                    <span className="font-bold text-gray-700 shrink-0">คาบ {a.period}</span>
                    <span className="text-gray-500 shrink-0">{classMap.get(a.class_id)?.name || a.class_id}</span>
                    <span className="text-gray-400 shrink-0">·</span>
                    <span className="text-gray-500 truncate">{teacherMap.get(a.original_teacher_id)?.name || a.original_teacher_id}</span>
                    <ArrowRight className="w-3 h-3 text-orange-500 shrink-0" />
                    <span className="font-bold text-orange-700 truncate">{teacherMap.get(a.substitute_teacher_id)?.name || a.substitute_teacher_id}</span>
                    {a.role === 'co' && (
                      <span className="shrink-0 text-[10px] px-1 py-0.5 rounded bg-indigo-100 text-indigo-700">ครูร่วม</span>
                    )}
                    {!readOnly && (
                      <button
                        onClick={() => removeAssignment(a.id)}
                        className="ml-auto shrink-0 text-red-400 hover:text-red-600 transition-colors"
                        title="ยกเลิกสอนแทน"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── ปุ่มไปหน้าแสดงตารางสอนแทน + ลบทั้งวัน ── */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4 flex flex-wrap items-center gap-3">
        <div className="flex-1 min-w-[200px]">
          <div className="text-sm font-semibold text-gray-800 flex items-center gap-2">
            <Info className="w-4 h-4 text-blue-600" />
            {summary.uncoveredCount > 0
              ? `ยังมี ${summary.uncoveredCount} ตำแหน่งที่ยังไม่ได้จัดสอนแทน`
              : summary.absentPositionCount > 0
                ? 'จัดสอนแทนครบแล้วทุกตำแหน่ง'
                : 'ไม่มีคาบที่ต้องจัดสอนแทน'}
          </div>
          <div className="text-xs text-gray-400 mt-0.5">
            บันทึกอัตโนมัติทุกการเปลี่ยนแปลง — กด "ดูตารางสอนแทน" เมื่อพร้อมดูผลรวม
          </div>
        </div>
        <div className="flex items-center gap-2">
          {!readOnly && (confirmDeleteDate ? (
            <div className="flex items-center gap-1.5">
              <button
                onClick={handleDeleteDate}
                className="px-3 py-1.5 rounded-lg text-xs font-bold bg-red-600 text-white hover:bg-red-700 transition-colors"
              >
                ยืนยันลบทั้งวัน
              </button>
              <button
                onClick={() => setConfirmDeleteDate(false)}
                className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-gray-100 text-gray-600 hover:bg-gray-200 transition-colors"
              >
                ยกเลิก
              </button>
            </div>
          ) : (
            <button
              onClick={() => setConfirmDeleteDate(true)}
              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold text-red-500 border border-red-200 hover:bg-red-50 transition-colors"
              title="ลบตารางสอนแทนของวันนี้ทั้งหมด (ไม่กระทบตารางหลัก)"
            >
              <Trash2 className="w-3.5 h-3.5" /> ลบทั้งวัน
            </button>
          ))}
          {onOpenPrintStudio && (
            <button
              onClick={onOpenPrintStudio}
              className="inline-flex items-center gap-1.5 px-3 py-2.5 rounded-xl text-sm font-semibold bg-slate-700 text-white hover:bg-slate-800 transition-colors"
              title="เปิดเอกสารสอนแทนใน Print Studio"
            >
              <Printer className="w-4 h-4" /> Print Studio
            </button>
          )}
          <button
            onClick={onShowResult}
            className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-sm font-bold bg-blue-600 text-white hover:bg-blue-700 transition-colors shadow-sm"
          >
            <Eye className="w-4 h-4" /> ดูตารางสอนแทน
          </button>
        </div>
      </div>
    </div>
  )
}

/* ═══════════════════════════ โหมดผลลัพธ์: ตารางสอนแทน + ภาระงาน ═══════════════════════════ */
function ResultView({
  dateStr, dayOfWeek, grid, assignments, absences, summary,
  teacherMap, subjectMap, classMap, note, handleNoteChange,
  onBack, onExportPDF, onExportExcel, onShowStats, readOnly, onOpenPrintStudio,
}) {
  const periodTimeLabel = (periodNo) => {
    for (const row of grid.rows) {
      const cell = row.cells[periodNo]
      if (cell) return formatTimeRange(cell.start_time, cell.end_time)
    }
    return ''
  }
  const substituteLoad = useMemo(() => {
    const counts = new Map()
    for (const a of assignments || []) {
      counts.set(a.substitute_teacher_id, (counts.get(a.substitute_teacher_id) || 0) + 1)
    }
    return [...counts.entries()]
      .map(([tid, n]) => ({ name: teacherMap.get(tid)?.name || tid, count: n }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'th'))
  }, [assignments, teacherMap])

  return (
    <div className="space-y-4">
      {/* สรุป + ปุ่ม */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4 flex flex-wrap items-center gap-3">
        <button
          onClick={onBack}
          className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold bg-gray-100 text-gray-600 hover:bg-gray-200 transition-colors"
        >
          <ArrowLeft className="w-3.5 h-3.5" /> กลับไปจัด
        </button>
        <div className="text-sm text-gray-700 font-medium">
          ตารางสอนแทน {formatThaiDate(dateStr)}
        </div>
        <div className="ml-auto flex items-center gap-2 flex-wrap">
          <span className="text-[11px] text-gray-500 bg-gray-50 border border-gray-200 rounded-lg px-2.5 py-1.5">
            วันนี้มีสอน <b className="text-gray-700">{summary.totalPeriods}</b> คาบ
          </span>
          {summary.absentTeacherCount > 0 && (
            <span className="text-[11px] text-red-600 bg-red-50 border border-red-200 rounded-lg px-2.5 py-1.5">ครูลา {summary.absentTeacherCount} คน</span>
          )}
          {assignments.length > 0 && (
            <span className="text-[11px] text-orange-600 bg-orange-50 border border-orange-200 rounded-lg px-2.5 py-1.5">สอนแทนแล้ว {assignments.length} คาบ</span>
          )}
          {summary.uncoveredCount > 0 && (
            <span className="text-[11px] font-bold text-white bg-red-500 rounded-lg px-2.5 py-1.5">ยังไม่ได้จัด {summary.uncoveredCount} ตำแหน่ง</span>
          )}
          {summary.coHintCount > 0 && (
            <span className="text-[11px] text-indigo-600 bg-indigo-50 border border-indigo-200 rounded-lg px-2.5 py-1.5">มีครูร่วมในห้อง {summary.coHintCount} คาบ</span>
          )}
        </div>
        <div className="flex gap-1.5">
          <button onClick={onExportPDF} className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold bg-blue-600 text-white hover:bg-blue-700 transition-colors">
            <Printer className="w-3.5 h-3.5" /> PDF
          </button>
          <button onClick={onExportExcel} className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold bg-emerald-600 text-white hover:bg-emerald-700 transition-colors">
            <FileDown className="w-3.5 h-3.5" /> Excel
          </button>
          <button onClick={onShowStats} className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold bg-purple-600 text-white hover:bg-purple-700 transition-colors">
            <BarChart3 className="w-3.5 h-3.5" /> ดูภาระงาน
          </button>
          {onOpenPrintStudio && (
            <button
              onClick={onOpenPrintStudio}
              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold bg-slate-700 text-white hover:bg-slate-800 transition-colors"
              title="เปิดเอกสารสอนแทนใน Print Studio (เลือกเอกสาร/โหมดได้)"
            >
              <Printer className="w-3.5 h-3.5" /> Print Studio
            </button>
          )}
        </div>
      </div>

      {/* ภาระสอนแทนวันนี้ */}
      {substituteLoad.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4">
          <h3 className="font-bold text-gray-800 text-sm mb-2 flex items-center gap-2">
            <BarChart3 className="w-4 h-4 text-purple-600" />
            ภาระงานสอนแทนวันนี้
          </h3>
          <div className="flex flex-wrap gap-2">
            {substituteLoad.map((r) => (
              <span key={r.name} className="inline-flex items-center gap-1.5 text-xs bg-orange-50 border border-orange-200 rounded-lg px-3 py-1.5">
                <b className="text-orange-700">{r.name}</b>
                <span className="text-gray-500">{r.count} คาบ</span>
              </span>
            ))}
          </div>
        </div>
      )}

      {/* ครูที่ลา */}
      {absences.length > 0 && (
        <div className="bg-white rounded-xl border border-orange-200 shadow-sm p-4">
          <div className="text-xs font-bold text-orange-700 mb-1.5 flex items-center gap-1">
            <UserX className="w-3.5 h-3.5" /> ครูที่ลา/ไม่มา ({absences.length})
          </div>
          <div className="flex flex-wrap gap-2">
            {absences.map((a, i) => (
              <span key={i} className="inline-flex items-center gap-1.5 text-xs bg-red-50 border border-red-200 rounded-lg px-3 py-1.5">
                <b className="text-red-700">{teacherMap.get(a.teacherId)?.name || a.teacherId}</b>
                <span className="text-gray-500">{RANGE_LABELS[a.periodRange] || 'ทั้งวัน'}</span>
                {a.reason && <span className="text-purple-600">({a.reason})</span>}
              </span>
            ))}
          </div>
        </div>
      )}

      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4">
        <div className="mb-3">
          <label className="text-xs font-medium text-gray-500 block mb-1">หมายเหตุ (แสดงในเอกสารพิมพ์)</label>
          <input
            type="text"
            value={note}
            onChange={handleNoteChange}
            disabled={readOnly}
            placeholder="เช่น ครู ก ขอใช้สิทธิ์ลากิจ / ครู ข รับสอนแทน..."
            className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm disabled:bg-gray-50 disabled:text-gray-400"
          />
        </div>

        <div className="overflow-x-auto rounded-lg border border-gray-200">
          <table className="min-w-full text-xs">
            <thead>
              <tr>
                <th className="sticky left-0 bg-gray-50 border-b border-r border-gray-200 px-2 py-1.5 text-left text-gray-500 font-semibold min-w-[80px]">
                  ห้อง / คาบ
                </th>
                {grid.periodNos.map((p) => (
                  <th key={p} className="bg-gray-50 border-b border-r border-gray-200 px-2 py-1.5 text-center text-gray-500 font-semibold min-w-[110px]">
                    <div>คาบ {p}</div>
                    <div className="text-[10px] text-gray-400 font-normal">{periodTimeLabel(p)}</div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {grid.rows.map((row) => (
                <tr key={row.classId}>
                  <td className="sticky left-0 bg-gray-50 border-b border-r border-gray-200 px-2 py-1.5 font-semibold text-gray-700">
                    {row.className}
                  </td>
                  {grid.periodNos.map((p) => {
                    const cell = row.cells[p]
                    return (
                      <td key={p} className={`border-b border-r border-gray-100 px-1.5 py-1 align-top ${cell?.isSubstitute ? 'bg-orange-50' : ''}`}>
                        {cell ? (
                          <div>
                            <div className="font-medium text-gray-800 leading-tight">{cell.subjectName}</div>
                            <div className={`leading-tight ${cell.mainIsSubstitute ? 'text-orange-700 font-bold' : 'text-gray-500'}`}>
                              {cell.teacherName}
                            </div>
                            {cell.mainIsSubstitute && (
                              <div className="text-[10px] text-gray-400 leading-tight">(แทน {cell.originalName})</div>
                            )}
                            {cell.coTeacherName && (
                              <div className={`leading-tight text-[10px] ${cell.coIsSubstitute ? 'text-orange-700 font-bold' : 'text-gray-400'}`}>
                                + {cell.coTeacherName}
                                {cell.coIsSubstitute && <span className="text-gray-400"> (แทน {cell.coOriginalName})</span>}
                              </div>
                            )}
                          </div>
                        ) : (
                          <div className="text-gray-200 text-center">—</div>
                        )}
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

/* ═══════════════════════════ Tab: ประวัติ ═══════════════════════════ */
function HistoryTab({ historyDates, dailySchedules, teacherMap, onOpen, onDelete, readOnly }) {
  if (historyDates.length === 0) {
    return (
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-10 text-center">
        <History className="w-12 h-12 text-gray-300 mx-auto mb-3" />
        <div className="text-gray-500 font-medium">ยังไม่มีประวัติการสอนแทน</div>
        <p className="text-xs text-gray-400 mt-1">ไปที่แท็บ "รายวัน" แล้วจัดตารางสอนแทนวันแรกของคุณ</p>
      </div>
    )
  }
  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4">
      <h3 className="font-bold text-gray-800 text-sm mb-3">ประวัติตารางสอนแทนรายวัน ({historyDates.length} วัน)</h3>
      <div className="space-y-2">
        {historyDates.map((d) => {
          const s = normalizeDailySchedule(dailySchedules[d]) || {}
          const assigns = s.assignments || []
          const absentIds = (s.absences || []).map((a) => a.teacherId)
          return (
            <div key={d} className="flex items-center gap-3 bg-white border border-gray-200 rounded-lg px-4 py-3 hover:border-blue-300 transition-colors">
              <div className="shrink-0 w-10 h-10 rounded-lg bg-blue-50 flex items-center justify-center">
                <CalendarDays className="w-5 h-5 text-blue-600" />
              </div>
              <div className="min-w-0">
                <div className="text-sm font-bold text-gray-800">{formatThaiDate(d)}</div>
                <div className="text-[11px] text-gray-400 truncate">
                  สอนแทน {assigns.length} คาบ
                  {absentIds.length > 0 && ` · ลา ${absentIds.length} คน`}
                  {absentIds.length > 0 && (
                    <> · {absentIds.map((t) => teacherMap.get(t)?.name || t).join(', ')}</>
                  )}
                </div>
              </div>
              <div className="ml-auto flex items-center gap-1.5 shrink-0">
                <button
                  onClick={() => onOpen(d)}
                  className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-blue-50 text-blue-700 hover:bg-blue-100 transition-colors"
                >
                  เปิดดู / แก้ไข
                </button>
                {!readOnly && (
                  <button
                    onClick={() => { if (window.confirm(`ลบตารางสอนแทนวันที่ ${formatShortDate(d)}? (ไม่กระทบตารางหลัก)`)) onDelete(d) }}
                    className="p-1.5 rounded-lg text-red-400 hover:bg-red-50 hover:text-red-600 transition-colors"
                    title="ลบ"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

/* ═══════════════════════════ Tab: สถิติ ═══════════════════════════ */
function StatsTab({ teachers, dailySchedules, resultSlots, userPlacements, lessonBlockMap, scheduleBlocks, scheduleConfig, fixedSlots }) {
  const [statsRange, setStatsRange] = useState('week') // week | month | custom
  const [customFrom, setCustomFrom] = useState('')
  const [customTo, setCustomTo] = useState('')
  const [exporting, setExporting] = useState(false)

  const { fromDate, toDate } = useMemo(() => {
    const today = todayISO()
    if (statsRange === 'week') {
      const start = mondayOfWeek(today)
      const end = new Date(`${start}T00:00:00`)
      end.setDate(end.getDate() + 6)
      return { fromDate: start, toDate: toISODate(end) }
    }
    if (statsRange === 'month') {
      const [y, m] = today.split('-').map(Number)
      const lastDay = new Date(y, m, 0).getDate()
      return {
        fromDate: `${y}-${String(m).padStart(2, '0')}-01`,
        toDate: `${y}-${String(m).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`,
      }
    }
    return { fromDate: customFrom || null, toDate: customTo || null }
  }, [statsRange, customFrom, customTo])

  const baseLoads = useMemo(
    () => computeBaseTeacherLoad({ resultSlots, userPlacements, lessonBlockMap, scheduleBlocks, scheduleConfig, fixedSlots }),
    [resultSlots, userPlacements, lessonBlockMap, scheduleBlocks, scheduleConfig, fixedSlots],
  )
  const subStats = useMemo(
    () => computeSubstituteStats(dailySchedules, { fromDate, toDate, scheduleBlocks, scheduleConfig }),
    [dailySchedules, fromDate, toDate, scheduleBlocks, scheduleConfig],
  )
  const summary = useMemo(
    () => computeSubstituteSummary(dailySchedules, { fromDate, toDate, scheduleBlocks, scheduleConfig }),
    [dailySchedules, fromDate, toDate, scheduleBlocks, scheduleConfig],
  )
  const reasonStats = useMemo(
    () => computeAbsenceReasonStats(dailySchedules, { fromDate, toDate }),
    [dailySchedules, fromDate, toDate],
  )
  const rows = useMemo(
    () => buildStatsRows({ teachers, baseLoads, subStats, fromDate, toDate }),
    [teachers, baseLoads, subStats, fromDate, toDate],
  )
  const weeklyTotals = useMemo(() => {
    const map = {}
    for (const ds of Object.values(dailySchedules || {})) {
      if (!isDateInRange(ds.date, fromDate, toDate)) continue
      const wk = mondayOfWeek(ds.date)
      map[wk] = (map[wk] || 0) + (ds.assignments?.length || 0)
    }
    return Object.entries(map).sort((a, b) => a[0].localeCompare(b[0]))
  }, [dailySchedules, fromDate, toDate])

  const teacherMap = useMemo(() => new Map(teachers.map((t) => [t.id, t.name])), [teachers])
  const maxSub = Math.max(1, ...rows.map((r) => r.subPeriods))
  const maxReason = Math.max(1, ...reasonStats.map((r) => r.count))

  const rangeLabel = () => {
    if (!fromDate && !toDate) return 'ทั้งหมด'
    if (fromDate && toDate) return fromDate === toDate ? formatShortDate(fromDate) : `${formatShortDate(fromDate)} – ${formatShortDate(toDate)}`
    return fromDate ? `จาก ${formatShortDate(fromDate)}` : `ถึง ${formatShortDate(toDate)}`
  }

  const handleExportPDF = () => {
    exportStatsPDF({ rows, fromDate, toDate, reasonRows: reasonStats }).catch((e) => alert(e.message))
  }
  const handleExportExcel = async () => {
    setExporting(true)
    try {
      await exportStatsExcel({ rows, fromDate, toDate, reasonRows: reasonStats })
    } catch (e) {
      alert(`ส่งออกไม่สำเร็จ: ${e.message}`)
    } finally {
      setExporting(false)
    }
  }

  return (
    <div className="space-y-4">
      {/* ── ช่วงเวลา ── */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4">
        <div className="flex flex-wrap items-center gap-2">
          <BarChart3 className="w-4 h-4 text-blue-600" />
          <span className="text-sm font-bold text-gray-700">ช่วงเวลาสถิติ</span>
          <div className="flex gap-1.5 ml-2">
            {[['week', 'สัปดาห์นี้'], ['month', 'เดือนนี้'], ['custom', 'ช่วงวันที่เอง']].map(([val, label]) => (
              <button
                key={val}
                onClick={() => setStatsRange(val)}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors
                  ${statsRange === val ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
              >
                {label}
              </button>
            ))}
          </div>
          {statsRange === 'custom' && (
            <div className="flex items-center gap-1.5 ml-2">
              <DateField value={customFrom} onChange={setCustomFrom} title="ตั้งแต่วันที่" />
              <span className="text-gray-400 text-xs">ถึง</span>
              <DateField value={customTo} onChange={setCustomTo} title="ถึงวันที่" />
            </div>
          )}
          <span className="ml-auto text-xs text-gray-400">ช่วงที่แสดง: {rangeLabel()}</span>
        </div>
      </div>

      {/* ── สรุป ── */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4">
          <div className="text-3xl font-bold text-orange-600">{summary.totalPeriods}</div>
          <div className="text-xs text-gray-500 mt-1">คาบสอนแทนทั้งหมดในช่วงนี้</div>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4">
          <div className="text-3xl font-bold text-blue-600">{summary.teacherCount}</div>
          <div className="text-xs text-gray-500 mt-1">ครูที่รับสอนแทน</div>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4">
          <div className="text-3xl font-bold text-gray-800 truncate">
            {summary.busiestTeacherId ? teacherMap.get(summary.busiestTeacherId) || '' : '—'}
          </div>
          <div className="text-xs text-gray-500 mt-1">ครูที่รับสอนแทนมากสุด ({summary.busiestCount} คาบ)</div>
        </div>
      </div>

      {/* ── ตารางต่อครู ── */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
          <h3 className="font-bold text-gray-800 text-sm">ภาระครู: สอนปกติ vs สอนแทน</h3>
          <div className="flex gap-1.5">
            <button
              onClick={handleExportPDF}
              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold bg-blue-600 text-white hover:bg-blue-700 transition-colors"
            >
              <Printer className="w-3.5 h-3.5" /> PDF
            </button>
            <button
              onClick={handleExportExcel}
              disabled={exporting}
              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold bg-emerald-600 text-white hover:bg-emerald-700 transition-colors disabled:opacity-50"
            >
              <FileDown className="w-3.5 h-3.5" /> Excel
            </button>
          </div>
        </div>
        <div className="overflow-x-auto rounded-lg border border-gray-200">
          <table className="min-w-full text-xs">
            <thead>
              <tr className="bg-gray-50">
                <th className="px-2 py-2 text-left text-gray-500 font-semibold">#</th>
                <th className="px-2 py-2 text-left text-gray-500 font-semibold">ครู</th>
                <th className="px-2 py-2 text-center text-gray-500 font-semibold">คาบปกติ/สัปดาห์</th>
                <th className="px-2 py-2 text-center text-gray-500 font-semibold">ชม./สัปดาห์</th>
                <th className="px-2 py-2 text-center text-orange-600 font-semibold">คาบสอนแทน</th>
                <th className="px-2 py-2 text-center text-gray-500 font-semibold">ชม.สอนแทน</th>
                <th className="px-2 py-2 text-center text-gray-500 font-semibold">รวมคาบ</th>
                <th className="px-2 py-2 text-center text-gray-500 font-semibold">% สัดส่วน</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.teacherId} className="border-t border-gray-100 hover:bg-gray-50/60">
                  <td className="px-2 py-2 text-gray-400">{r.rank}</td>
                  <td className="px-2 py-2 font-medium text-gray-800">{r.teacherName}</td>
                  <td className="px-2 py-2 text-center text-gray-600">{r.basePeriodsPerWeek}</td>
                  <td className="px-2 py-2 text-center text-gray-600">{r.baseHoursPerWeek.toFixed(1)}</td>
                  <td className="px-2 py-2 text-center">
                    <span className={`inline-flex items-center justify-center min-w-[2rem] px-2 py-0.5 rounded-full text-xs font-bold
                      ${r.subPeriods > 0 ? 'bg-orange-100 text-orange-700' : 'bg-gray-100 text-gray-400'}`}>
                      {r.subPeriods}
                    </span>
                  </td>
                  <td className="px-2 py-2 text-center text-gray-600">{r.subHours.toFixed(1)}</td>
                  <td className="px-2 py-2 text-center text-gray-600">{r.totalPeriods}</td>
                  <td className="px-2 py-2">
                    <div className="flex items-center gap-1.5">
                      <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-orange-500 rounded-full"
                          style={{ width: `${Math.min(100, (r.subPeriods / maxSub) * 100)}%` }}
                        />
                      </div>
                      <span className="text-[11px] text-gray-500 w-10 text-right">{r.sharePct.toFixed(1)}%</span>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-[11px] text-gray-400 mt-2">
          * คาบปกติ/สัปดาห์และชั่วโมงคำนวณจากตารางหลัก (รวมครูผู้สอนร่วม) · คาบสอนแทนจากระบบสอนแทนรายวันในช่วงที่เลือก
          · ชั่วโมงคำนวณจากช่วงเวลาจริงของแต่ละคาบ (ไม่นับพักเที่ยง/เบรก)
        </p>
      </div>

      {/* ── สถิติเหตุผลที่ลา ── */}
      {reasonStats.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4">
          <h3 className="font-bold text-gray-800 text-sm mb-3">สถิติเหตุผลที่ลา (ช่วงที่เลือก)</h3>
          <div className="space-y-2">
            {reasonStats.map((r) => (
              <div key={r.reason} className="flex items-center gap-3">
                <span className="text-xs text-gray-600 w-40 shrink-0 truncate">{r.reason}</span>
                <div className="flex-1 h-2.5 bg-gray-100 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-purple-500 rounded-full"
                    style={{ width: `${(r.count / maxReason) * 100}%` }}
                  />
                </div>
                <span className="text-xs font-bold text-gray-700 w-12 text-right">{r.count} ครั้ง</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── คาบสอนแทนรายสัปดาห์ ── */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4">
        <h3 className="font-bold text-gray-800 text-sm mb-3">คาบสอนแทนรายสัปดาห์ (ช่วงที่เลือก)</h3>
        {weeklyTotals.length === 0 ? (
          <div className="text-xs text-gray-400 italic">ไม่มีข้อมูลสอนแทนในช่วงนี้</div>
        ) : (
          <div className="space-y-2">
            {weeklyTotals.map(([wk, count]) => (
              <div key={wk} className="flex items-center gap-3">
                <span className="text-xs text-gray-600 w-44 shrink-0">สัปดาห์ของ {formatShortDate(wk)}</span>
                <div className="flex-1 h-2.5 bg-gray-100 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-blue-500 rounded-full"
                    style={{ width: `${(count / Math.max(1, ...weeklyTotals.map(([, c]) => c))) * 100}%` }}
                  />
                </div>
                <span className="text-xs font-bold text-gray-700 w-8 text-right">{count} คาบ</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

/* ═══════════════════════════ Dialog: ยืนยันการสอนแทนค้าง ═══════════════════════════ */
function ConfirmAssignmentsDialog({ pending, teacherMap, onCancel, onResolve }) {
  const teacherName = teacherMap.get(pending.entry?.teacherId)?.name || pending.entry?.teacherId || ''
  const count = pending.affected.length
  return (
    <div className="fixed inset-0 z-[115] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onCancel} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-md p-5 space-y-4">
        <h3 className="text-base font-bold text-gray-900 flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 text-amber-600" />
          มีการสอนแทนที่จัดไว้แล้ว
        </h3>
        <p className="text-sm text-gray-600 leading-relaxed">
          {pending.kind === 'remove'
            ? <>กำลังลบ <b className="text-gray-900">{teacherName}</b> ออกจากรายการครูที่ลา — </>
            : <>กำลังเปลี่ยนช่วงลาของ <b className="text-gray-900">{teacherName}</b> — </>}
          มีการสอนแทนที่จัดไว้ <b className="text-orange-600">{count} คาบ</b> ที่จะไม่มีครูลาอยู่ในคาบนั้นแล้ว
        </p>
        <div className="text-xs text-gray-600 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 max-h-36 overflow-y-auto space-y-1">
          {pending.affected.map((a) => (
            <div key={a.id}>
              คาบ {a.period} · {teacherMap.get(a.original_teacher_id)?.name || a.original_teacher_id}
              {' → '}
              <b className="text-orange-700">{teacherMap.get(a.substitute_teacher_id)?.name || a.substitute_teacher_id}</b>
            </div>
          ))}
        </div>
        <div className="space-y-2 pt-1">
          <button
            onClick={() => onResolve(true)}
            className="w-full px-4 py-2 rounded-lg text-sm font-semibold bg-red-600 text-white hover:bg-red-700 transition-colors"
          >
            ลบการสอนแทนด้วย ({count} คาบ)
          </button>
          <div className="flex gap-2">
            <button
              onClick={() => onResolve(false)}
              className="flex-1 px-4 py-2 rounded-lg text-sm font-medium bg-gray-100 text-gray-700 hover:bg-gray-200 transition-colors"
            >
              เก็บการสอนแทนไว้
            </button>
            <button
              onClick={onCancel}
              className="flex-1 px-4 py-2 rounded-lg text-sm font-medium text-gray-600 border border-gray-200 hover:bg-gray-50 transition-colors"
            >
              ยกเลิก
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
