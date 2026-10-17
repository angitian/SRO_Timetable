import { useMemo, useState } from 'react'
import {
  ArrowLeft, ArrowRight, CheckCircle, AlertTriangle,
  Users, Layers, ClipboardCheck, Info,
  Search, FlaskConical, Copy, Check, Table2,
} from 'lucide-react'
import { useApp } from '../context/AppContext.jsx'
import { buildClassBlockMap } from '../utils/periods.js'
import { getSubjectColor } from '../utils/subjectColors.js'
import { normalizeClassTeachers } from '../utils/teacherLoad.js'
import TeacherSummaryTable from '../components/verification/TeacherSummaryTable.jsx'
import TeacherWorkloadTable from '../components/verification/TeacherWorkloadTable.jsx'
import ClassroomDensityTable from '../components/verification/ClassroomDensityTable.jsx'
import FacilityUsageSummary from '../components/verification/FacilityUsageSummary.jsx'
import FacilityTimetable from '../components/verification/FacilityTimetable.jsx'
import TeacherClassMatrix from '../components/verification/TeacherClassMatrix.jsx'
import { exportMatrixExcel, exportMatrixPDF } from '../utils/exportMatrix.js'
import { classGradeRoom } from '../utils/grades.js'
import { buildGroupedWorkload } from '../utils/workloadGrouping'
import { exportWorkloadExcel } from '../utils/workloadExcelExport'

export default function VerificationStep() {
  const { fixtureData, error, errorResponse, setStep } = useApp()

  const teachers = fixtureData?.teachers || []
  const subjects = fixtureData?.subjects || []
  const classes = fixtureData?.classes || []
  const lessonBlocks = fixtureData?.lesson_blocks || []
  const fixedSlots = fixtureData?.fixed_slots || []
  const scheduleBlocks = fixtureData?.schedule_blocks || []
  const specialRooms = fixtureData?.special_rooms || []
  const result = fixtureData?.result || null
  const resultSlots = result?.slots || []

  const subjectMap = useMemo(() => new Map(subjects.map((s) => [s.id, s])), [subjects])
  const teacherMap = useMemo(() => new Map(teachers.map((t) => [t.id, t])), [teachers])
  const classMap = useMemo(() => new Map(classes.map((c) => [c.id, c])), [classes])
  const classBlockMap = useMemo(() => buildClassBlockMap(scheduleBlocks), [scheduleBlocks])
  const blockMap = useMemo(() => new Map(scheduleBlocks.map((b) => [b.id, b])), [scheduleBlocks])

  const [activeTab, setActiveTab] = useState('teachers')
  const [matrixView, setMatrixView] = useState('matrix') // 'matrix' | 'list'
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedFacilityId, setSelectedFacilityId] = useState('')

  // Teacher Summary
  const teacherSummary = useMemo(() => {
    const loads = {}
    for (const t of teachers) {
      loads[t.id] = {
        teacher: t,
        subjects: {},
        subjectRooms: [],
        total: 0,
        blockIds: new Set(),
      }
    }
    for (const lb of lessonBlocks) {
      const addTeacher = (tid) => {
        const entry = loads[tid]
        if (!entry) return
        const subjName = subjectMap.get(lb.subject_id)?.name || lb.subject_id
        const className = classMap.get(lb.class_id)?.name || lb.class_id
        const key = `${subjName} → ${className}`
        entry.subjects[key] = (entry.subjects[key] || 0) + lb.periods_per_week
        entry.subjectRooms.push({ subject: subjName, class: className, periods: lb.periods_per_week })
        entry.total += lb.periods_per_week
        if (lb.block_id) entry.blockIds.add(lb.block_id)
      }
      // ครูหลัก + ครูผู้สอนร่วม (co-teacher) นับทั้งคู่
      addTeacher(lb.teacher_id)
      if (lb.co_teacher_id) addTeacher(lb.co_teacher_id)
    }
    // คาบดูแลกิจกรรม (fixed slots) — นับเข้างานครูผู้ดูแลรายชั้น (N ครู/ห้อง → 1 คาบ/ครู/สัปดาห์)
    for (const fs of fixedSlots) {
      const effective = new Set([fs.period, ...(fs.periods || [])])
      const seenTeachers = new Set()
      for (const [cid, tids] of Object.entries(normalizeClassTeachers(fs.class_teachers))) {
        for (const tid of tids) {
          if (seenTeachers.has(tid)) continue
          seenTeachers.add(tid)
          const entry = loads[tid]
          if (!entry) continue
          const className = classMap.get(cid)?.name || cid
          const key = `${fs.name} → ${className}`
          entry.subjects[key] = (entry.subjects[key] || 0) + effective.size
          entry.subjectRooms.push({ subject: fs.name, class: className, periods: effective.size })
          entry.total += effective.size
        }
      }
    }
    return Object.values(loads).map((entry) => ({
      ...entry,
      isOver: entry.total > entry.teacher.max_periods_per_week,
      isCrossBlock: entry.blockIds.size > 1,
      blockNames: Array.from(entry.blockIds).map((bid) => blockMap.get(bid)?.name || bid),
    }))
  }, [teachers, lessonBlocks, subjectMap, classMap, blockMap, fixedSlots])

  // Classroom Density
  const classroomDensity = useMemo(() => {
    const classLoads = {}
    for (const c of classes) {
      classLoads[c.id] = {
        class: c,
        subjects: {},
        subjectList: [],
        total: 0,
      }
    }
    for (const lb of lessonBlocks) {
      const entry = classLoads[lb.class_id]
      if (!entry) continue
      const subjName = subjectMap.get(lb.subject_id)?.name || lb.subject_id
      entry.subjects[subjName] = (entry.subjects[subjName] || 0) + lb.periods_per_week
      entry.total += lb.periods_per_week
    }
    // Build subject list arrays from aggregated subjects
    return Object.values(classLoads).map((entry) => ({
      ...entry,
      subjectList: Object.entries(entry.subjects).map(([subject, periods]) => ({ subject, periods })),
    }))
  }, [classes, lessonBlocks, subjectMap])

  const overCount = teacherSummary.filter((t) => t.isOver).length
  const crossBlockTeachers = teacherSummary.filter((t) => t.isCrossBlock)

  // Calculate max periods per block
  const blockMaxPeriods = useMemo(() => {
    const map = {}
    for (const blk of scheduleBlocks) {
      map[blk.id] = blk.periods.filter((p) => p.type === 'STUDY').length * blk.days_per_week
    }
    return map
  }, [scheduleBlocks])

  // Study periods locked per class by fixed slots (กิจกรรมพิเศษ/ลูกเสือ) —
  // only STUDY periods inside the class's own schedule block reduce capacity.
  const lockedPeriodsByClass = useMemo(() => {
    const studySetByClass = {}
    const daysByClass = {}
    for (const c of classes) {
      const blk = blockMap.get(classBlockMap[c.id])
      studySetByClass[c.id] = new Set(
        (blk?.periods || []).filter((p) => p.type === 'STUDY').map((p) => p.period_no),
      )
      daysByClass[c.id] = blk?.days_per_week || 5
    }
    const map = {}
    for (const fs of fixedSlots) {
      const targets = fs.class_ids?.length ? fs.class_ids : classes.map((c) => c.id)
      const fsPeriods = [fs.period, ...(fs.periods || [])]
      for (const cid of targets) {
        const studySet = studySetByClass[cid]
        if (!studySet || (fs.day || 0) > (daysByClass[cid] || 5)) continue
        if (!map[cid]) map[cid] = new Set()
        for (const p of fsPeriods) {
          if (studySet.has(p)) map[cid].add(`${fs.day}-${p}`)
        }
      }
    }
    const counts = {}
    for (const [cid, keys] of Object.entries(map)) counts[cid] = keys.size
    return counts
  }, [classes, fixedSlots, classBlockMap, blockMap])

  // Classes whose total lesson periods exceed usable weekly capacity
  // (block capacity minus fixed-slot locks). These would provably make the
  // solver return INFEASIBLE, so we flag them for the user to fix.
  const overCapacityClasses = useMemo(() => {
    return classroomDensity
      .map((entry) => {
        const blockId = classBlockMap[entry.class.id]
        const maxPeriods = blockId ? blockMaxPeriods[blockId] || 0 : 0
        const locked = lockedPeriodsByClass[entry.class.id] || 0
        const available = maxPeriods - locked
        const isOver = maxPeriods > 0 && entry.total > available
        return isOver
          ? {
              classId: entry.class.id,
              className: entry.class.name,
              total: entry.total,
              maxPeriods: available,
              locked,
              overflow: entry.total - available,
            }
          : null
      })
      .filter(Boolean)
  }, [classroomDensity, classBlockMap, blockMaxPeriods, lockedPeriodsByClass])

  // Classes with zero/near-zero slack (needed == available, or ≤2 spare).
  // Feasible but very hard for the solver — warn so the user picks a longer
  // preset instead of being surprised by "จัดไม่ครบ" later.
  const tightCapacityClasses = useMemo(() => {
    return classroomDensity
      .map((entry) => {
        const blockId = classBlockMap[entry.class.id]
        const maxPeriods = blockId ? blockMaxPeriods[blockId] || 0 : 0
        const locked = lockedPeriodsByClass[entry.class.id] || 0
        const available = maxPeriods - locked
        const slack = available - entry.total
        return maxPeriods > 0 && slack >= 0 && slack <= 2
          ? { className: entry.class.name, total: entry.total, available, slack }
          : null
      })
      .filter(Boolean)
  }, [classroomDensity, classBlockMap, blockMaxPeriods, lockedPeriodsByClass])

  const hasBlockingIssue = overCapacityClasses.length > 0 || overCount > 0

  // Filtered lists based on search query
  const filteredTeachers = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    if (!q) return teacherSummary
    return teacherSummary.filter((t) => t.teacher.name.toLowerCase().includes(q))
  }, [teacherSummary, searchQuery])

  // ── ตารางภาระงานครู: flat rows = ครู × วิชา × ชั้น/ห้อง × คาบ ──
  // ตรงกับ teacherSummary (นับครูร่วมสอน + คาบดูแลกิจกรรมด้วย) เพื่อให้
  // ยอดรวมต่อครูตรงกับตัวเลขอื่น ๆ ในหน้า
  const teacherWorkloadRows = useMemo(() => {
    const rows = []
    for (const lb of lessonBlocks) {
      const subject = subjectMap.get(lb.subject_id)
      const subjectName = subject?.name || lb.subject_id
      const cls = classMap.get(lb.class_id)
      const { grade, room } = classGradeRoom(cls)
      const periods = lb.periods_per_week || 0
      const teacherIds = lb.co_teacher_id ? [lb.teacher_id, lb.co_teacher_id] : [lb.teacher_id]
      for (const tid of teacherIds) {
        const t = teacherMap.get(tid)
        if (!t) continue
        rows.push({
          teacherId: tid, teacherName: t.name,
          subjectId: subject?.id || '', subjectName,
          classId: lb.class_id, className: cls?.name || lb.class_id,
          grade, room, periods,
        })
      }
    }
    // คาบดูแลกิจกรรม (fixed slots) — นับ 1 คาบ/ครู/กิจกรรม (เฉพาะห้องแรกที่ดูแล)
    for (const fs of fixedSlots) {
      const effective = new Set([fs.period, ...(fs.periods || [])])
      const seen = new Set()
      for (const [cid, tids] of Object.entries(normalizeClassTeachers(fs.class_teachers))) {
        const cls = classMap.get(cid)
        const { grade, room } = classGradeRoom(cls)
        for (const tid of tids) {
          if (seen.has(tid)) continue
          seen.add(tid)
          const t = teacherMap.get(tid)
          if (!t) continue
          rows.push({
            teacherId: tid, teacherName: t.name,
            subjectId: '', subjectName: fs.name || 'กิจกรรม',
            classId: cid, className: cls?.name || cid,
            grade, room, periods: effective.size, isActivity: true,
          })
        }
      }
    }
    return rows
  }, [lessonBlocks, fixedSlots, subjectMap, classMap, teacherMap])

  // 1 แถว = 1 ครู (badge วิชากลุ่มห้อง + สถานะภาระงาน) สำหรับตาราง + Excel
  const groupedWorkload = useMemo(
    () => buildGroupedWorkload({
      assignments: teacherWorkloadRows,
      teachers,
      classes,
      subjectMap,
      defaultMaxPeriods: fixtureData?.schedule_config?.default_max_periods_per_week,
    }),
    [teacherWorkloadRows, teachers, classes, subjectMap, fixtureData?.schedule_config?.default_max_periods_per_week],
  )

  const filteredGroups = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    if (!q) return groupedWorkload
    return groupedWorkload.filter((g) => g.teacherName.toLowerCase().includes(q))
  }, [groupedWorkload, searchQuery])

  const filteredClassrooms = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    if (!q) return classroomDensity
    return classroomDensity.filter((c) => c.class.name.toLowerCase().includes(q))
  }, [classroomDensity, searchQuery])

  // ── ครู × ห้อง matrix: cells = periods taught (co-teacher counts for both) ──
  const teacherClassMatrix = useMemo(() => {
    const cell = {} // "teacherId|classId" → { periods, subjects: {} }
    for (const lb of lessonBlocks) {
      const teacherIds = lb.co_teacher_id ? [lb.teacher_id, lb.co_teacher_id] : [lb.teacher_id]
      for (const tid of teacherIds) {
        const key = `${tid}|${lb.class_id}`
        if (!cell[key]) cell[key] = { periods: 0, subjects: {} }
        cell[key].periods += lb.periods_per_week
        const subjName = subjectMap.get(lb.subject_id)?.name || lb.subject_id
        cell[key].subjects[subjName] = (cell[key].subjects[subjName] || 0) + lb.periods_per_week
      }
    }
    const rows = teachers.map((t) => {
      const perClass = {}
      let total = 0
      for (const c of classes) {
        const v = cell[`${t.id}|${c.id}`]
        const periods = v?.periods || 0
        perClass[c.id] = { periods, subjects: v?.subjects || {} }
        total += periods
      }
      return { teacher: t, perClass, total, isOver: total > (t.max_periods_per_week || 0) }
    })
    // Column totals = actual lessons per class (co-taught counts ONCE for the class)
    const colTotals = {}
    for (const lb of lessonBlocks) {
      colTotals[lb.class_id] = (colTotals[lb.class_id] || 0) + lb.periods_per_week
    }
    const grandTotal = Object.values(colTotals).reduce((s, v) => s + v, 0)
    const hasCoTeaching = lessonBlocks.some((lb) => lb.co_teacher_id)
    return { rows, cols: classes, colTotals, grandTotal, hasCoTeaching }
  }, [teachers, classes, lessonBlocks, subjectMap])

  const filteredMatrixRows = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    if (!q) return teacherClassMatrix.rows
    return teacherClassMatrix.rows.filter((r) => r.teacher.name.toLowerCase().includes(q))
  }, [teacherClassMatrix, searchQuery])

  // ── Facility (special room) usage summary ──
  const facilityUsage = useMemo(() => {
    if (specialRooms.length === 0) return []
    const usage = {}
    for (const r of specialRooms) {
      usage[r.id] = {
        room: r,
        subjects: {},
        classes: new Set(),
        total: 0,
      }
    }
    for (const lb of lessonBlocks) {
      if (!lb.room_id || !lb.room_id.startsWith('SR_')) continue
      const entry = usage[lb.room_id]
      if (!entry) continue
      const subjName = subjectMap.get(lb.subject_id)?.name || lb.subject_id
      const className = classMap.get(lb.class_id)?.name || lb.class_id
      const key = `${subjName} → ${className}`
      entry.subjects[key] = (entry.subjects[key] || 0) + lb.periods_per_week
      entry.classes.add(lb.class_id)
      entry.total += lb.periods_per_week
    }
    // Capacity = days × periods_per_day (use first schedule block as reference)
    const refBlock = scheduleBlocks[0]
    const studyPeriods = refBlock?.periods?.filter((p) => p.type === 'STUDY').length || 0
    const daysPerWeek = refBlock?.days_per_week || 5
    const capacity = studyPeriods * daysPerWeek
    return Object.values(usage).map((entry) => ({
      ...entry,
      subjectList: Object.entries(entry.subjects).map(([k, periods]) => ({ subject: k, periods })),
      classCount: entry.classes.size,
      capacity,
      isOver: capacity > 0 && entry.total > capacity,
    }))
  }, [specialRooms, lessonBlocks, subjectMap, classMap, scheduleBlocks])

  // ── Facility timetable (from result slots, if available) ──
  const facilityTimetable = useMemo(() => {
    if (!selectedFacilityId || resultSlots.length === 0) return []
    const dayNames = ['จันทร์', 'อังคาร', 'พุธ', 'พฤหัส', 'ศุกร์']
    return resultSlots
      .filter((s) => s.room_id === selectedFacilityId)
      .map((s) => ({
        ...s,
        dayName: dayNames[(s.day || 1) - 1] || `วัน${s.day}`,
        subjectName: subjectMap.get(s.subject_id)?.name || s.subject_id,
        className: classMap.get(s.class_id)?.name || s.class_id,
        teacherName: teacherMap.get(s.teacher_id)?.name || s.teacher_id,
      }))
      .sort((a, b) => (a.day || 0) - (b.day || 0) || (a.period || 0) - (b.period || 0))
  }, [selectedFacilityId, resultSlots, subjectMap, classMap, teacherMap])

  // Build readable diagnostics from the backend's 422 payload (if any).
  const diagnostics = errorResponse?.diagnostics || null
  const [copied, setCopied] = useState(false)

  // Copy the full error payload to the clipboard so the tester can send it
  // straight to the dev team (pilot feedback channel).
  async function handleCopyDiagnostics() {
    const text = JSON.stringify(errorResponse, null, 2)
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
    } catch {
      // Fallback for browsers without async clipboard API
      const ta = document.createElement('textarea')
      ta.value = text
      ta.style.position = 'fixed'
      ta.style.opacity = '0'
      document.body.appendChild(ta)
      ta.select()
      document.execCommand('copy')
      document.body.removeChild(ta)
      setCopied(true)
    }
    setTimeout(() => setCopied(false), 2000)
  }

  // Helper: progress bar color based on percentage
  const progressColor = (pct) => {
    if (pct > 100) return 'bg-red-500'
    if (pct >= 80) return 'bg-orange-400'
    return 'bg-green-500'
  }

  // Helper: concatenate getSubjectColor object into a single className string
  const subjectColorClass = (name, category) => {
    const c = getSubjectColor(name, category)
    return `${c.bg} ${c.text} ${c.border}`
  }

  // ── Matrix export payload (Excel + PDF) ──
  const matrixExportBase = useMemo(() => {
    const { rows, cols, colTotals, grandTotal } = teacherClassMatrix
    return {
      title: 'ตารางสรุปครู × ห้อง',
      rows: rows.map((r) => ({ id: r.teacher.id, name: r.teacher.name, total: r.total })),
      cols: cols.map((c) => ({ id: c.id, name: c.name })),
      cellOf: (tid, cid) => teacherClassMatrix.rows.find((r) => r.teacher.id === tid)?.perClass[cid]?.periods || 0,
      rowTotals: Object.fromEntries(rows.map((r) => [r.teacher.id, r.total])),
      colTotals,
      grandTotal,
    }
  }, [teacherClassMatrix])

  const handleMatrixExportExcel = () => { exportMatrixExcel(matrixExportBase) }
  const handleMatrixExportPdf = () => { exportMatrixPDF(matrixExportBase) }

  const handleWorkloadExportExcel = () => {
    exportWorkloadExcel({
      title: 'ตารางภาระงานครู',
      groups: groupedWorkload,
      detailAssignments: teacherWorkloadRows,
    })
  }

  return (
    <div className="space-y-6 pb-24">
      {/* Header */}
      <div className="flex items-center gap-2">
        <ClipboardCheck className="w-6 h-6 text-blue-600" />
        <h2 className="text-xl font-bold text-gray-900">ตรวจสอบข้อมูลก่อนจัดตาราง</h2>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="bg-white rounded-lg border border-gray-200 p-3">
          <Users className="w-5 h-5 text-blue-600 mb-1" />
          <div className="text-2xl font-bold">{teachers.length}</div>
          <div className="text-xs text-gray-500">ครูทั้งหมด</div>
        </div>
        <div className="bg-white rounded-lg border border-gray-200 p-3">
          <Layers className="w-5 h-5 text-orange-600 mb-1" />
          <div className="text-2xl font-bold">{lessonBlocks.length}</div>
          <div className="text-xs text-gray-500">Lesson Blocks</div>
        </div>
        <div className="bg-white rounded-lg border border-gray-200 p-3">
          <div className="text-2xl font-bold">{classes.length}</div>
          <div className="text-xs text-gray-500">ห้องเรียนทั้งหมด</div>
        </div>
        <div className={`rounded-lg border p-3 ${hasBlockingIssue ? 'bg-red-50 border-red-200' : 'bg-green-50 border-green-200'}`}>
          {hasBlockingIssue ? (
            <AlertTriangle className="w-5 h-5 text-red-600 mb-1" />
          ) : (
            <CheckCircle className="w-5 h-5 text-green-600 mb-1" />
          )}
          <div className={`text-sm font-bold ${hasBlockingIssue ? 'text-red-700' : 'text-green-700'}`}>
            {hasBlockingIssue ? '⚠️ มีปัญหา' : '✓ พร้อมจัดตาราง'}
          </div>
          <div className="text-xs text-gray-500">
            {hasBlockingIssue
              ? `${overCount + overCapacityClasses.length} รายการ`
              : 'สถานะการตรวจสอบ'}
          </div>
        </div>
      </div>

      {/* Compact issue summary line */}
      {hasBlockingIssue && (
        <div className="text-xs text-gray-600 flex flex-wrap gap-x-4 gap-y-1">
          {overCount > 0 && <span className="text-red-600">• ครูเกินเพดาน: {overCount} คน</span>}
          {overCapacityClasses.length > 0 && (
            <span className="text-red-600">• ห้องเกิน capacity: {overCapacityClasses.length} ห้อง</span>
          )}
        </div>
      )}

      {/* Zero-slack warning — จัดได้แต่ solver ต้องใช้เวลามาก */}
      {tightCapacityClasses.length > 0 && (
        <div className="card bg-amber-50 border-amber-200">
          <div className="flex items-start gap-2">
            <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
            <div className="text-sm">
              <div className="font-bold text-amber-900 mb-1">
                ห้องที่ใช้คาบพอดีเป๊ะ ({tightCapacityClasses.length} ห้อง) — เสี่ยง "จัดไม่ครบ"
              </div>
              <div className="text-amber-800">
                {tightCapacityClasses.map((c) => (
                  <div key={c.className}>
                    • {c.className}: วิชา {c.total} คาบ เท่ากับช่องว่างที่เหลือ {c.available} คาบพอดี (หักคาบล็อกแล้ว)
                  </div>
                ))}
              </div>
              <div className="text-amber-700 mt-2 text-xs">
                ข้อมูลจัดได้ แต่ไม่มีช่องว่างเผื่อ — solver ต้องใช้เวลาค้นหานานกว่าปกติ
                แนะนำใช้ preset <b>"ประณีต" (~2 นาที)</b> หรือ <b>"กำหนดเวลาเอง" (สูงสุด 10 นาที)</b> ในหน้าจัดตาราง
                หรือลดคาบล็อกกิจกรรม/วิชาในห้องเหล่านี้ให้เหลือช่องว่างอย่างน้อย 1-2 คาบ
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Cross-block teachers info */}
      {crossBlockTeachers.length > 0 && (
        <div className="card bg-purple-50 border-purple-200">
          <div className="flex items-start gap-2">
            <Info className="w-5 h-5 text-purple-600 shrink-0 mt-0.5" />
            <div className="text-sm">
              <div className="font-bold text-purple-900 mb-1">
                ครูที่สอนข้าม Schedule Block ({crossBlockTeachers.length} คน)
              </div>
              <div className="text-purple-700">
                ระบบจะจัดการเวลาพักและสล็อตเวลาจริงให้อัตโนมัติ —
                ห้ามจัดคาบเรียนของครูในเวลาจริงที่ซ้อนทับกัน
              </div>
              <div className="mt-2 flex flex-wrap gap-1">
                {crossBlockTeachers.map((t) => (
                  <span key={t.teacher.id} className="badge bg-purple-100 text-purple-700 text-xs">
                    {t.teacher.name} ({t.blockNames.join(' + ')})
                  </span>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Tab Navigation + Search */}
      <div className="card">
        <div className="flex flex-col sm:flex-row sm:items-center gap-3 mb-4">
          <div className="flex gap-2">
            <button
              onClick={() => { setActiveTab('teachers'); setSearchQuery('') }}
              className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium transition-all
                ${activeTab === 'teachers'
                  ? 'bg-blue-600 text-white shadow-sm'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
            >
              <Users className="w-4 h-4" />
              ตรวจสอบตามครู ({teachers.length})
            </button>
            <button
              onClick={() => { setActiveTab('classrooms'); setSearchQuery('') }}
              className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium transition-all
                ${activeTab === 'classrooms'
                  ? 'bg-blue-600 text-white shadow-sm'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
            >
              <Layers className="w-4 h-4" />
              ตรวจสอบตามห้องเรียน ({classes.length})
            </button>
            {specialRooms.length > 0 && (
              <button
                onClick={() => { setActiveTab('facilities'); setSearchQuery('') }}
                className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium transition-all
                  ${activeTab === 'facilities'
                    ? 'bg-indigo-600 text-white shadow-sm'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                  }`}
              >
                <FlaskConical className="w-4 h-4" />
                ห้องปฏิบัติการ ({specialRooms.length})
              </button>
            )}
            <button
              onClick={() => { setActiveTab('matrix'); setSearchQuery('') }}
              className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium transition-all
                ${activeTab === 'matrix'
                  ? 'bg-emerald-600 text-white shadow-sm'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
            >
              <Table2 className="w-4 h-4" />
              ครู × ห้อง
            </button>
          </div>
          <div className="relative sm:ml-auto sm:w-64">
            <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={activeTab === 'teachers' ? 'ค้นหาชื่อครู...' : 'ค้นหาห้องเรียน...'}
              className="w-full pl-9 pr-3 py-2 text-sm rounded-lg border border-gray-300 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none"
            />
          </div>
        </div>

        {/* Tab Content */}
        <div className="transition-opacity duration-200">
          {activeTab === 'teachers' && (
            <TeacherWorkloadTable
              groups={filteredGroups}
              onExportExcel={handleWorkloadExportExcel}
              subjectColorClass={subjectColorClass}
            />
          )}

          {activeTab === 'classrooms' && (
            <ClassroomDensityTable
              classrooms={filteredClassrooms}
              classBlockMap={classBlockMap}
              blockMaxPeriods={blockMaxPeriods}
              lockedPeriodsByClass={lockedPeriodsByClass}
              progressColor={progressColor}
              subjectColorClass={subjectColorClass}
            />
          )}

          {activeTab === 'matrix' && (
            <div className="space-y-3">
              {/* View toggle: matrix ↔ original list */}
              <div className="flex items-center gap-2">
                <div className="inline-flex rounded-lg border border-gray-200 bg-gray-50 p-0.5 text-xs font-medium">
                  <button
                    onClick={() => setMatrixView('matrix')}
                    className={`px-3 py-1.5 rounded-md transition-all
                      ${matrixView === 'matrix' ? 'bg-white text-emerald-700 shadow-sm font-semibold' : 'text-gray-500 hover:text-gray-700'}`}
                  >
                    ตารางรวม (Matrix)
                  </button>
                  <button
                    onClick={() => setMatrixView('list')}
                    className={`px-3 py-1.5 rounded-md transition-all
                      ${matrixView === 'list' ? 'bg-white text-emerald-700 shadow-sm font-semibold' : 'text-gray-500 hover:text-gray-700'}`}
                  >
                    แบบเดิม (ตามครู)
                  </button>
                </div>
              </div>

              {matrixView === 'matrix' ? (
                <TeacherClassMatrix
                  rows={filteredMatrixRows}
                  cols={teacherClassMatrix.cols}
                  colTotals={teacherClassMatrix.colTotals}
                  grandTotal={teacherClassMatrix.grandTotal}
                  hasCoTeaching={teacherClassMatrix.hasCoTeaching}
                  onExportExcel={handleMatrixExportExcel}
                  onExportPdf={handleMatrixExportPdf}
                />
              ) : (
                <TeacherSummaryTable
                  teachers={filteredTeachers}
                  progressColor={progressColor}
                  subjectColorClass={subjectColorClass}
                />
              )}
            </div>
          )}
        </div>
      </div>

      {/* Facilities tab content */}
      {activeTab === 'facilities' && (
        <div className="space-y-4">
          {/* Section A: Usage Summary */}
          <FacilityUsageSummary facilityUsage={facilityUsage} />

          {/* Section B: Room Timetable (if result exists) */}
          <FacilityTimetable
            specialRooms={specialRooms}
            selectedFacilityId={selectedFacilityId}
            onSelectFacility={setSelectedFacilityId}
            facilityTimetable={facilityTimetable}
            hasResult={resultSlots.length > 0}
          />
        </div>
      )}

      {/* Error display */}
      {error && (
        <div className="text-red-600 text-sm bg-red-50 border border-red-200 rounded-lg px-4 py-3 space-y-2">
          <div className="font-bold flex items-center gap-2">
            <AlertTriangle className="w-4 h-4" /> ไม่สามารถจัดตารางสอนได้
          </div>
          <div>{error}</div>
          {diagnostics && (
            <div className="space-y-2 mt-2 text-xs">
              {diagnostics.class_capacity_issues?.length > 0 && (
                <div>
                  <div className="font-semibold underline">ห้องที่คาบเรียนเกินช่องว่าง:</div>
                  <ul className="list-disc pl-5 mt-1">
                    {diagnostics.class_capacity_issues.map((c) => (
                      <li key={c.class_id}>
                        {c.class_name}: {c.needed_periods}/{c.available_slots} คาบ
                        (เกิน {c.overflow} คาบ)
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {diagnostics.teacher_overloads?.length > 0 && (
                <div>
                  <div className="font-semibold underline">ครูที่ภาระงานเกินขีดจำกัด:</div>
                  <ul className="list-disc pl-5 mt-1">
                    {diagnostics.teacher_overloads.map((t) => (
                      <li key={t.teacher_id}>
                        {t.teacher_name}: ต้องสอน {t.needed_periods} คาบ
                        {t.reason === 'over_max' && ` (เกิน max ${t.max_periods_per_week})`}
                        {t.reason === 'over_available' && ` (ช่องว่างมีแค่ ${t.available_slots})`}
                        {t.reason === 'under_min' && ` (ต่ำกว่า min ${t.min_periods_per_week})`}
                        {t.reason === 'am_pm_hard' && ` (โหมด Hard "ว่างเช้า+บ่าย": ต้องสำรองว่าง 2 คาบ/วัน — ลดภาระครู หรือเปลี่ยนเป็น Soft)`}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {diagnostics.room_overloads?.length > 0 && (
                <div>
                  <div className="font-semibold underline">ห้องเฉพาะที่ไม่พอ:</div>
                  <ul className="list-disc pl-5 mt-1">
                    {diagnostics.room_overloads.map((r) => (
                      <li key={r.room_id}>
                        {r.room_name}: ต้องใช้ {r.needed_periods} คาบ
                        (ช่องว่าง {r.available_slots})
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {diagnostics.fixed_slot_conflicts?.length > 0 && (
                <div>
                  <div className="font-semibold underline">คาบที่ล็อกไว้ขัดกับข้อจำกัด:</div>
                  <ul className="list-disc pl-5 mt-1">
                    {diagnostics.fixed_slot_conflicts.map((f, i) => (
                      <li key={i}>
                        {f.lesson_block_id} ที่ วัน{f.day}-คาบ{f.period}: {f.reason}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {diagnostics.hard_rule_issues?.length > 0 && (
                <div>
                  <div className="font-semibold underline">เงื่อนไข Hard ที่จัดไม่ได้:</div>
                  <ul className="list-disc pl-5 mt-1">
                    {diagnostics.hard_rule_issues.map((h, i) => (
                      <li key={i}>{h}</li>
                    ))}
                  </ul>
                </div>
              )}
              {diagnostics.notes?.length > 0 && (
                <div className="italic text-gray-600">
                  {diagnostics.notes.map((n, i) => <div key={i}>{n}</div>)}
                </div>
              )}
            </div>
          )}
          <button
            onClick={handleCopyDiagnostics}
            className={`mt-2 flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors
              ${copied
                ? 'bg-green-100 text-green-700'
                : 'bg-white border border-red-200 text-red-700 hover:bg-red-100'}`}
            title="คัดลอกข้อมูลข้อขัดแย้งทั้งหมดเพื่อส่งให้ทีมพัฒนา"
          >
            {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
            {copied ? 'คัดลอกแล้ว!' : 'คัดลอกข้อมูลปัญหาส่งทีมพัฒนา'}
          </button>
        </div>
      )}

      {/* Sticky Global Wizard Footer */}
      <div className="fixed bottom-0 left-0 right-0 z-50 bg-white/95 backdrop-blur border-t border-gray-200 shadow-lg px-4 sm:px-6 lg:px-8 py-3">
        <div className="max-w-7xl mx-auto flex items-center justify-between gap-4">
          {/* Left: Back button */}
          <button
            onClick={() => setStep(3)}
            className="btn-secondary text-sm flex items-center gap-1.5 shrink-0"
          >
            <ArrowLeft className="w-4 h-4" />
            ย้อนกลับไปแก้ไขภาระงาน
          </button>

          {/* Center: Status indicator */}
          <div className="hidden sm:flex items-center gap-2 text-sm min-w-0">
            {hasBlockingIssue ? (
              <>
                <AlertTriangle className="w-4 h-4 text-red-500 shrink-0" />
                <span className="text-red-700 font-medium truncate">
                  มีปัญหาที่ต้องแก้ไขก่อน
                </span>
              </>
            ) : (
              <>
                <CheckCircle className="w-4 h-4 text-green-500 shrink-0" />
                <span className="text-green-700 font-medium truncate">
                  ข้อมูลพร้อมจัดตาราง: ครู {teachers.length} ท่าน &bull; {classes.length} ห้องเรียน
                </span>
              </>
            )}
          </div>

          {/* Right: Next button */}
          <button
            onClick={() => setStep(5)}
            className="flex items-center gap-2 px-6 py-2.5 bg-blue-600 text-white rounded-xl font-bold text-sm hover:bg-blue-700 transition-colors shadow-md whitespace-nowrap shrink-0"
          >
            ไปยังหน้าจัดตารางสอน
            <ArrowRight className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  )
}
