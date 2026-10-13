import { useState, useMemo, useEffect, useRef } from 'react'
import {
  CalendarDays, CalendarClock, UserX, Users, Check, X, Trash2, ArrowRight,
  History, BarChart3, FileDown, Printer, ArrowLeft, Info, AlertTriangle,
} from 'lucide-react'
import { useApp } from '../context/AppContext.jsx'
import {
  DAY_LABELS, dateToDayOfWeek, todayISO, formatThaiDate, formatShortDate,
  getDaySlots, computeFreeTeachers, formatTimeRange, buildDailyGrid, makeAssignmentId,
} from '../utils/dailySchedule.js'
import {
  computeBaseTeacherLoad, computeSubstituteStats, computeSubstituteSummary,
  buildStatsRows, mondayOfWeek, isDateInRange,
} from '../utils/substituteStats.js'
import {
  exportDailySchedulePDF, exportDailyScheduleExcel, exportStatsPDF, exportStatsExcel,
} from '../utils/exportDailySchedule.js'

function toISODate(d) {
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${m}-${day}`
}

const TAB_STYLES = (active) => `flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-semibold transition-colors
  ${active ? 'bg-blue-600 text-white shadow-sm' : 'text-gray-600 hover:bg-gray-100'}`

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
    removeDailySchedule, setStep, selectedFixture,
  } = useApp()

  const [activeTab, setActiveTab] = useState('daily') // 'daily' | 'history' | 'stats'
  const [dateStr, setDateStr] = useState(() => todayISO())
  const [absentTeacherIds, setAbsentTeacherIds] = useState([])
  const [note, setNote] = useState('')
  const [assignments, setAssignments] = useState([])
  const [selectedTeacherId, setSelectedTeacherId] = useState('')
  const [selectedSlot, setSelectedSlot] = useState(null) // { period, classId, subjectId, teacherId }
  const [confirmDeleteDate, setConfirmDeleteDate] = useState(false)
  const [toast, setToast] = useState(null)
  const toastTimerRef = useRef(null)
  const initDateRef = useRef(null)

  const { teachers, classes, subjects, lesson_blocks, schedule_blocks = [], schedule_config } = fixtureData
  const resultSlots = result?.slots || []
  const lessonBlockMap = useMemo(() => new Map((lesson_blocks || []).map((lb) => [lb.id, lb])), [lesson_blocks])
  const dayOfWeek = dateToDayOfWeek(dateStr)
  const daySlots = useMemo(
    () => getDaySlots(resultSlots, userPlacements, lessonBlockMap, dayOfWeek),
    [resultSlots, userPlacements, lessonBlockMap, dayOfWeek],
  )
  const saved = dailySchedules[dateStr]

  // ── โหลด draft ของวันที่เมื่อเปลี่ยนวันที่ (ครั้งเดียวต่อวันที่) ────────
  useEffect(() => {
    if (initDateRef.current === dateStr) return
    initDateRef.current = dateStr
    const s = dailySchedules[dateStr]
    setAbsentTeacherIds(s?.absentTeacherIds || [])
    setNote(s?.note || '')
    setAssignments(s?.assignments || [])
    setSelectedTeacherId('')
    setSelectedSlot(null)
    setConfirmDeleteDate(false)
  }, [dateStr, dailySchedules])

  const showToast = (msg) => {
    setToast(msg)
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current)
    toastTimerRef.current = setTimeout(() => setToast(null), 3000)
  }

  const persistDaily = (nextAssignments, nextAbsent, nextNote) => {
    setDailySchedule({
      date: dateStr,
      dayOfWeek,
      absentTeacherIds: nextAbsent ?? absentTeacherIds,
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

  const toggleAbsent = (tid) => {
    const next = absentTeacherIds.includes(tid)
      ? absentTeacherIds.filter((x) => x !== tid)
      : [...absentTeacherIds, tid]
    setAbsentTeacherIds(next)
    persistDaily(undefined, next)
  }

  const handleNoteChange = (e) => {
    const v = e.target.value
    setNote(v)
    persistDaily(undefined, undefined, v)
  }

  const assignSubstitute = (slot, substituteTeacherId) => {
    const existingIdx = assignments.findIndex((a) => a.period === slot.period && a.class_id === slot.classId)
    const entry = {
      id: existingIdx >= 0 ? assignments[existingIdx].id : makeAssignmentId(),
      period: slot.period,
      class_id: slot.classId,
      subject_id: slot.subjectId,
      original_teacher_id: slot.teacherId,
      substitute_teacher_id: substituteTeacherId,
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
    setAbsentTeacherIds([])
    setNote('')
    setAssignments([])
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

  // ── คาบของครูที่เลือกในวันนี้ ────────────────────────────────────────
  const teacherDaySlots = useMemo(() => {
    if (!selectedTeacherId) return []
    return daySlots
      .filter((s) => s.teacher_id === selectedTeacherId || lessonBlockMap.get(s.lesson_block_id)?.co_teacher_id === selectedTeacherId)
      .sort((a, b) => a.period - b.period)
  }, [selectedTeacherId, daySlots, lessonBlockMap])

  const subjectMap = useMemo(() => new Map((subjects || []).map((s) => [s.id, s])), [subjects])
  const classMap = useMemo(() => new Map((classes || []).map((c) => [c.id, c])), [classes])
  const teacherMap = useMemo(() => new Map((teachers || []).map((t) => [t.id, t])), [teachers])

  const assignmentStatus = (period, classId) => assignments.find((a) => a.period === period && a.class_id === classId)

  const freeTeachers = useMemo(() => {
    if (!selectedSlot) return []
    return computeFreeTeachers({
      dayOfWeek,
      period: selectedSlot.period,
      daySlots,
      assignments,
      teachers,
      absentTeacherIds,
      lessonBlockMap,
      fixedSlots: fixtureData.fixed_slots,
    })
  }, [selectedSlot, dayOfWeek, daySlots, assignments, teachers, absentTeacherIds, lessonBlockMap, fixtureData.fixed_slots])

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
      absentTeachers: absentTeacherIds,
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
      absentTeachers: absentTeacherIds,
      teachers,
      subjects,
      classes,
    }).catch((e) => showToast(`ส่งออกไม่สำเร็จ: ${e.message}`))
  }

  return (
    <div className="space-y-5">
      {/* ── Header ── */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <button
            onClick={() => setStep(5)}
            className="p-2 rounded-lg text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition-colors"
            title="กลับหน้าตารางสอน"
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
        </div>
      </div>

      {activeTab === 'daily' && (
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
          teacherDaySlots={teacherDaySlots}
          selectedTeacherId={selectedTeacherId}
          setSelectedTeacherId={setSelectedTeacherId}
          absentTeacherIds={absentTeacherIds}
          toggleAbsent={toggleAbsent}
          selectedSlot={selectedSlot}
          setSelectedSlot={setSelectedSlot}
          freeTeachers={freeTeachers}
          assignSubstitute={assignSubstitute}
          assignmentStatus={assignmentStatus}
          assignments={assignments}
          removeAssignment={removeAssignment}
          note={note}
          handleNoteChange={handleNoteChange}
          grid={grid}
          handleExportPDF={handleExportPDF}
          handleExportExcel={handleExportExcel}
          confirmDeleteDate={confirmDeleteDate}
          setConfirmDeleteDate={setConfirmDeleteDate}
          handleDeleteDate={handleDeleteDate}
        />
      )}

      {activeTab === 'history' && (
        <HistoryTab
          historyDates={historyDates}
          dailySchedules={dailySchedules}
          teacherMap={teacherMap}
          onOpen={handleOpenDate}
          onDelete={(d) => { removeDailySchedule(d); showToast('ลบตารางสอนแทนของวันนั้นแล้ว') }}
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

      {toast && (
        <div className="fixed bottom-6 right-6 z-[120] px-4 py-3 rounded-xl shadow-lg text-sm font-medium bg-green-600 text-white">
          {toast}
        </div>
      )}
    </div>
  )
}

/* ═══════════════════════════ Tab: รายวัน ═══════════════════════════ */
function DailyTab({
  dateStr, setDateStr, dayOfWeek, teachers, subjectMap, classMap, teacherMap,
  teacherDaySlots, selectedTeacherId, setSelectedTeacherId,
  absentTeacherIds, toggleAbsent, selectedSlot, setSelectedSlot, freeTeachers,
  assignSubstitute, assignmentStatus, assignments, removeAssignment,
  note, handleNoteChange, grid, handleExportPDF, handleExportExcel,
  confirmDeleteDate, setConfirmDeleteDate, handleDeleteDate,
}) {
  const periodTimeLabel = (periodNo) => {
    for (const row of grid.rows) {
      const cell = row.cells[periodNo]
      if (cell) return formatTimeRange(cell.start_time, cell.end_time)
    }
    return ''
  }

  return (
    <div className="space-y-4">
      {/* ── แถวเลือกวันที่ ── */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4 flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <CalendarDays className="w-5 h-5 text-blue-600" />
          <div>
            <label className="text-xs font-medium text-gray-500 block">เลือกวัน/วันที่</label>
            <input
              type="date"
              value={dateStr}
              onChange={(e) => setDateStr(e.target.value)}
              className="border border-gray-300 rounded-lg px-2 py-1.5 text-sm"
            />
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
        <div className="ml-auto flex items-center gap-2">
          {assignments.length > 0 && (
            <span className="text-xs text-orange-600 bg-orange-50 border border-orange-200 rounded-lg px-2.5 py-1.5">
              สอนแทนแล้ว {assignments.length} คาบ
            </span>
          )}
          {confirmDeleteDate ? (
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
          )}
        </div>
      </div>

      {/* ── 2 คอลัมน์: เลือกครู + ครูว่าง ── */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
        {/* เลือกครู + คาบที่สอน */}
        <div className="lg:col-span-3 bg-white rounded-xl border border-gray-200 shadow-sm p-4">
          <div className="flex items-center gap-2 mb-3">
            <UserX className="w-4 h-4 text-orange-600" />
            <h3 className="font-bold text-gray-800 text-sm">1. เลือกครู (ลา / ไม่มา / ต้องการดูคาบ)</h3>
          </div>
          <select
            value={selectedTeacherId}
            onChange={(e) => { setSelectedTeacherId(e.target.value); setSelectedSlot(null) }}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm mb-3"
          >
            <option value="">เลือกครู…</option>
            {teachers.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}{absentTeacherIds.includes(t.id) ? ' (ลาประจำวัน)' : ''}
              </option>
            ))}
          </select>

          {/* ติ๊กลา */}
          <div className="mb-3">
            <div className="text-xs font-medium text-gray-500 mb-1.5">ครูที่ลา / ไม่มาในวันนี้ (จะถูกกันออกจากรายชื่อครูว่าง)</div>
            <div className="flex flex-wrap gap-1.5">
              {teachers.length === 0 && <span className="text-xs text-gray-400 italic">ไม่มีครู</span>}
              {teachers.slice(0, 12).map((t) => {
                const on = absentTeacherIds.includes(t.id)
                return (
                  <button
                    key={t.id}
                    onClick={() => toggleAbsent(t.id)}
                    className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium transition-colors border
                      ${on ? 'bg-red-50 border-red-300 text-red-700' : 'bg-white border-gray-200 text-gray-500 hover:border-gray-300'}`}
                  >
                    {on && <X className="w-3 h-3" />}
                    {t.name}
                  </button>
                )
              })}
              {teachers.length > 12 && (
                <span className="text-[11px] text-gray-400 italic self-center">(แสดง 12 คนแรก — เลือกครูด้านบนเพื่อทำเครื่องหมายลาทั้งหมด)</span>
              )}
            </div>
          </div>

          {/* คาบที่ครูสอน */}
          <div>
            <div className="text-xs font-medium text-gray-500 mb-1.5">
              {selectedTeacherId
                ? `${teacherMap.get(selectedTeacherId)?.name || ''} สอน ${teacherDaySlots.length} คาบในวันนี้ — กดคาบเพื่อหาครูสอนแทน`
                : 'เลือกครูก่อนเพื่อดูคาบที่ต้องหาคนสอนแทน'}
            </div>
            {!selectedTeacherId ? (
              <div className="text-xs text-gray-400 italic bg-gray-50 rounded-lg px-3 py-4 text-center">—</div>
            ) : teacherDaySlots.length === 0 ? (
              <div className="text-xs text-gray-400 italic bg-gray-50 rounded-lg px-3 py-4 text-center">
                ครูคนนี้ไม่มีคาบเรียนในวันนี้
              </div>
            ) : (
              <div className="space-y-1.5">
                {teacherDaySlots.map((s) => {
                  const assign = assignmentStatus(s.period, s.class_id)
                  const isSelected = selectedSlot?.period === s.period && selectedSlot?.classId === s.class_id
                  return (
                    <button
                      key={`${s.period}-${s.class_id}`}
                      onClick={() => setSelectedSlot(isSelected ? null : {
                        period: s.period,
                        classId: s.class_id,
                        subjectId: s.subject_id,
                        teacherId: s.teacher_id,
                      })}
                      className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg border text-left text-sm transition-colors
                        ${isSelected ? 'border-orange-400 bg-orange-50 ring-1 ring-orange-300'
                          : assign ? 'border-emerald-200 bg-emerald-50/50 hover:border-emerald-300'
                          : 'border-gray-200 bg-white hover:border-orange-300'}`}
                    >
                      <span className="shrink-0 w-14 text-center font-bold text-gray-700 bg-gray-100 rounded-md py-1 text-xs">คาบ {s.period}</span>
                      <span className="shrink-0 text-[11px] text-gray-400 w-20">{formatTimeRange(
                        (() => { const c = grid.rows.find((r) => r.classId === s.class_id)?.cells[s.period]; return c ? c.start_time : '' })(),
                        (() => { const c = grid.rows.find((r) => r.classId === s.class_id)?.cells[s.period]; return c ? c.end_time : '' })(),
                      )}</span>
                      <span className="font-medium text-gray-800 shrink-0">{subjectMap.get(s.subject_id)?.name || s.subject_id}</span>
                      <span className="text-gray-400 text-xs">·</span>
                      <span className="text-gray-500 text-xs truncate">{classMap.get(s.class_id)?.name || s.class_id}</span>
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
              {selectedSlot && <span className="ml-1 text-xs text-gray-400">(คาบ {selectedSlot.period})</span>}
            </h3>
          </div>
          {!selectedSlot ? (
            <div className="text-xs text-gray-400 italic bg-gray-50 rounded-lg px-3 py-4 text-center">
              กดเลือกคาบจากฝั่งซ้ายเพื่อดูรายชื่อครูที่ว่าง
            </div>
          ) : freeTeachers.length === 0 ? (
            <div className="text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded-lg px-3 py-3">
              ไม่มีครูว่างในคาบนี้ — ต้องสลับคาบอื่นก่อน หรือปล่อยไว้ (คาบนี้จะไม่มีครูสอนแทน)
            </div>
          ) : (
            <div className="space-y-1.5">
              <div className="text-xs text-gray-400 mb-1">
                {freeTeachers.length} คนว่าง · คาบ {selectedSlot.period} · {classMap.get(selectedSlot.classId)?.name}
                {' · '}{subjectMap.get(selectedSlot.subjectId)?.name}
              </div>
              {freeTeachers.map((t) => (
                <div key={t.id} className="flex items-center justify-between bg-white border border-gray-200 rounded-lg px-3 py-2">
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-gray-800 truncate">{t.name}</div>
                    <div className="text-[11px] text-gray-400 truncate">
                      {subjectMap.get(selectedSlot.subjectId)?.name} · {classMap.get(selectedSlot.classId)?.name}
                    </div>
                  </div>
                  <button
                    onClick={() => assignSubstitute(selectedSlot, t.id)}
                    className="shrink-0 inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold
                      bg-orange-600 text-white hover:bg-orange-700 transition-colors"
                  >
                    ให้สอนแทน
                  </button>
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
                    <button
                      onClick={() => removeAssignment(a.id)}
                      className="ml-auto shrink-0 text-red-400 hover:text-red-600 transition-colors"
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
      </div>

      {/* ── พรีวิวตารางใหม่รายวัน + export ── */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
          <div className="flex items-center gap-2">
            <Info className="w-4 h-4 text-blue-600" />
            <h3 className="font-bold text-gray-800 text-sm">ตารางใหม่รายวัน ({formatThaiDate(dateStr)})</h3>
            <span className="text-[11px] text-gray-400">— ครูสอนแทนไฮไลต์ส้ม ข้อมูลนี้แยกจากตารางหลัก ไม่กระทบตารางหลัก</span>
          </div>
          <div className="flex gap-1.5">
            <button
              onClick={handleExportPDF}
              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold bg-blue-600 text-white hover:bg-blue-700 transition-colors"
            >
              <Printer className="w-3.5 h-3.5" /> PDF
            </button>
            <button
              onClick={handleExportExcel}
              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold bg-emerald-600 text-white hover:bg-emerald-700 transition-colors"
            >
              <FileDown className="w-3.5 h-3.5" /> Excel
            </button>
          </div>
        </div>

        <div className="mb-3">
          <label className="text-xs font-medium text-gray-500 block mb-1">หมายเหตุ (แสดงในเอกสารพิมพ์)</label>
          <input
            type="text"
            value={note}
            onChange={handleNoteChange}
            placeholder="เช่น ครู ก ขอใช้สิทธิ์ลากิจ / ครู ข รับสอนแทน..."
            className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm"
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
                            <div className={`leading-tight ${cell.isSubstitute ? 'text-orange-700 font-bold' : 'text-gray-500'}`}>
                              {cell.teacherName}
                            </div>
                            {cell.isSubstitute && (
                              <div className="text-[10px] text-gray-400 leading-tight">(แทน {cell.originalName})</div>
                            )}
                            {!cell.isSubstitute && cell.coTeacherName && (
                              <div className="text-[10px] text-gray-400 leading-tight">+ {cell.coTeacherName}</div>
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
function HistoryTab({ historyDates, dailySchedules, teacherMap, onOpen, onDelete }) {
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
          const s = dailySchedules[d] || {}
          const assigns = s.assignments || []
          return (
            <div key={d} className="flex items-center gap-3 bg-white border border-gray-200 rounded-lg px-4 py-3 hover:border-blue-300 transition-colors">
              <div className="shrink-0 w-10 h-10 rounded-lg bg-blue-50 flex items-center justify-center">
                <CalendarDays className="w-5 h-5 text-blue-600" />
              </div>
              <div className="min-w-0">
                <div className="text-sm font-bold text-gray-800">{formatThaiDate(d)}</div>
                <div className="text-[11px] text-gray-400 truncate">
                  สอนแทน {assigns.length} คาบ
                  {(s.absentTeacherIds || []).length > 0 && ` · ลา ${s.absentTeacherIds.length} คน`}
                  {(s.absentTeacherIds || []).length > 0 && (
                    <> · {s.absentTeacherIds.map((t) => teacherMap.get(t)?.name || t).join(', ')}</>
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
                <button
                  onClick={() => { if (window.confirm(`ลบตารางสอนแทนวันที่ ${formatShortDate(d)}? (ไม่กระทบตารางหลัก)`)) onDelete(d) }}
                  className="p-1.5 rounded-lg text-red-400 hover:bg-red-50 hover:text-red-600 transition-colors"
                  title="ลบ"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
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

  const rangeLabel = () => {
    if (!fromDate && !toDate) return 'ทั้งหมด'
    if (fromDate && toDate) return fromDate === toDate ? formatShortDate(fromDate) : `${formatShortDate(fromDate)} – ${formatShortDate(toDate)}`
    return fromDate ? `จาก ${formatShortDate(fromDate)}` : `ถึง ${formatShortDate(toDate)}`
  }

  const handleExportPDF = () => {
    exportStatsPDF({ rows, fromDate, toDate }).catch((e) => alert(e.message))
  }
  const handleExportExcel = async () => {
    setExporting(true)
    try {
      await exportStatsExcel({ rows, fromDate, toDate })
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
              <input type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} className="border border-gray-300 rounded-lg px-2 py-1.5 text-sm" />
              <span className="text-gray-400">ถึง</span>
              <input type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)} className="border border-gray-300 rounded-lg px-2 py-1.5 text-sm" />
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
