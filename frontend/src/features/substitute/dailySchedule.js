/**
 * Daily substitute schedule helpers — ตารางสอนแทนรายวัน
 *
 * ระบบสอนแทนรายวันทำงานเป็น "layer" ทับบนตารางหลัก (master timetable)
 * โดยไม่แก้ข้อมูลตารางหลัก — assignment แต่ละรายการอ้างอิง slot เดิม
 * (day, period, class) แล้วแทนที่ครูผู้สอนเฉพาะมุมมองรายวัน/สถิติ
 */

export const DAY_LABELS = ['', 'จันทร์', 'อังคาร', 'พุธ', 'พฤหัสบดี', 'ศุกร์', 'เสาร์', 'อาทิตย์']
export const THAI_MONTHS = [
  '', 'มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน',
  'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม',
]

/** 'YYYY-MM-DD' → 1..7 (จันทร์=1 … อาทิตย์=7) */
export function dateToDayOfWeek(dateStr) {
  if (!dateStr) return 1
  const d = new Date(`${dateStr}T00:00:00`)
  const jsDay = d.getDay() // 0 = อาทิตย์
  return jsDay === 0 ? 7 : jsDay
}

/** วันที่วันนี้ (local) เป็น 'YYYY-MM-DD' */
export function todayISO() {
  const now = new Date()
  const m = String(now.getMonth() + 1).padStart(2, '0')
  const d = String(now.getDate()).padStart(2, '0')
  return `${now.getFullYear()}-${m}-${d}`
}

/** แปลง 'YYYY-MM-DD' → 'จันทร์ที่ 6 ตุลาคม 2569' (พ.ศ.) */
export function formatThaiDate(dateStr) {
  if (!dateStr) return ''
  const [y, m, d] = dateStr.split('-').map(Number)
  if (!y || !m || !d) return dateStr
  return `${DAY_LABELS[dateToDayOfWeek(dateStr)]}ที่ ${d} ${THAI_MONTHS[m] || ''} ${y + 543}`
}

/** แปลง 'YYYY-MM-DD' → '6 ต.ค. 69' แบบสั้น */
export function formatShortDate(dateStr) {
  if (!dateStr) return ''
  const [y, m, d] = dateStr.split('-').map(Number)
  if (!y || !m || !d) return dateStr
  const shortMonth = (THAI_MONTHS[m] || '').slice(0, 3)
  return `${d} ${shortMonth}. ${String(y + 543).slice(-2)}`
}

/** แปลง 'YYYY-MM-DD' → '03/11/2569' (วว/ดด/ปปปป พ.ศ.) — ใช้แสดงในช่องวันที่ */
export function formatDDMMYYYY(dateStr) {
  if (!dateStr) return ''
  const [y, m, d] = dateStr.split('-').map(Number)
  if (!y || !m || !d) return dateStr
  const dd = String(d).padStart(2, '0')
  const mm = String(m).padStart(2, '0')
  return `${dd}/${mm}/${y + 543}`
}

/** สร้าง id สำหรับ assignment ใหม่ */
export function makeAssignmentId() {
  return `ASG_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
}

/**
 * ผู้รับสอนแทนของ assignment — ครู (เดิม) หรือ นศ.ฝึกสอน (ใหม่)
 * คืน { kind: 'teacher'|'trainee', id, name } หรือ null
 */
export function substitutePerson(assignment) {
  if (!assignment) return null
  if (assignment.substitute_trainee_id) {
    return {
      kind: 'trainee',
      id: assignment.substitute_trainee_id,
      name: assignment.substitute_name || '',
    }
  }
  if (assignment.substitute_teacher_id) {
    return {
      kind: 'teacher',
      id: assignment.substitute_teacher_id,
      name: assignment.substitute_name || '',
    }
  }
  return null
}

/** key สำหรับ group สถิติ/เอกสาร: 't:<teacherId>' หรือ 'tr:<traineeId>' */
export function substitutePersonKey(assignment) {
  const person = substitutePerson(assignment)
  if (!person) return ''
  return `${person.kind === 'trainee' ? 'tr' : 't'}:${person.id}`
}

/**
 * ชื่อที่แสดงของผู้สอนแทน — ใช้ snapshot name ก่อน แล้ว fallback teacherMap
 * `withKind` = ต่อท้าย " (นศ.ฝึกสอน)" สำหรับเอกสารพิมพ์/Excel
 */
export function substituteDisplayName(assignment, teacherMap, { withKind = false } = {}) {
  const person = substitutePerson(assignment)
  if (!person) return ''
  const entry = teacherMap?.get ? teacherMap.get(person.id) : null
  const fallback = typeof entry === 'string' ? entry : entry?.name
  const name = person.name || fallback || person.id || ''
  return withKind && person.kind === 'trainee' ? `${name} (นศ.ฝึกสอน)` : name
}

/**
 * Normalize ข้อมูล daily schedule 1 วัน — backward compat:
 *   - `absentTeacherIds: string[]` (โมเดลเก่า) → `absences` [{ teacherId, reason:'', periodRange:'all' }]
 *   - assignment ที่ไม่มี `role` → 'main'
 *   - เติม `day_type` / `blocked_periods` ให้ครบ (สำหรับปฏิทินการศึกษาในอนาคต)
 * เรียกทุกจุดที่อ่าน dailySchedules จาก storage/snapshot
 */
export function normalizeDailySchedule(raw) {
  if (!raw || typeof raw !== 'object') return raw
  const absences = Array.isArray(raw.absences)
    ? raw.absences
    : (raw.absentTeacherIds || []).map((tid) => ({
        teacherId: tid,
        reason: '',
        periodRange: 'all',
      }))
  const assignments = (raw.assignments || []).map((a) => ({
    role: 'main',
    substitute_kind: a.substitute_trainee_id ? 'trainee' : (a.substitute_kind || 'teacher'),
    substitute_name: a.substitute_name || '',
    ...a,
  }))
  return {
    ...raw,
    day_type: raw.day_type || 'normal',
    blocked_periods: Array.isArray(raw.blocked_periods) ? raw.blocked_periods : [],
    absences,
    assignments,
  }
}

/**
 * แบ่งคาบของวันเป็น เช้า/บ่าย — ขอบคั่นคือคาบพักเที่ยงแรก
 * (จาก schedule_blocks; fallback = schedule_config.lunch_periods)
 * คืน { morning: Set<period_no>, afternoon: Set<period_no> }
 */
export function getDayHalves(scheduleBlocks, scheduleConfig) {
  const lunchNos = new Set()
  const allNos = new Set()
  for (const b of scheduleBlocks || []) {
    for (const p of b.periods || []) {
      allNos.add(p.period_no)
      if (p.type === 'LUNCH') lunchNos.add(p.period_no)
    }
  }
  if (!allNos.size) {
    const cfg = scheduleConfig || {}
    for (let i = 1; i <= (cfg.periods_per_day || 8); i++) allNos.add(i)
  }
  if (!lunchNos.size) {
    for (const p of scheduleConfig?.lunch_periods || [4]) lunchNos.add(p)
  }
  const firstLunch = Math.min(...lunchNos)
  const morning = new Set()
  const afternoon = new Set()
  for (const p of allNos) {
    (p < firstLunch ? morning : afternoon).add(p)
  }
  return { morning, afternoon }
}

/** กรอง slots ตามช่วงเช้า/บ่าย/ทั้งวัน (periodRange: 'all'|'morning'|'afternoon') */
export function filterSlotsByRange(slots, periodRange, halves) {
  if (!halves || !slots) return slots || []
  if (periodRange === 'morning') return slots.filter((s) => halves.morning.has(s.period))
  if (periodRange === 'afternoon') return slots.filter((s) => halves.afternoon.has(s.period))
  return slots
}

/** คาบนี้อยู่ในช่วงที่ลาหรือไม่ (periodRange: 'all'|'morning'|'afternoon') */
export function isPeriodInRange(period, periodRange, halves) {
  if (!periodRange || periodRange === 'all' || !halves) return true
  if (periodRange === 'morning') return halves.morning.has(period)
  if (periodRange === 'afternoon') return halves.afternoon.has(period)
  return true
}

/**
 * สรุป "วันนี้มีสอนกี่คาบ" — นับเป็น "ตำแหน่ง" (ครูหลัก main / ครูร่วม co) ที่ต้องหาแทน
 * - กรองตามช่วงที่ลาจริง (เช้า/บ่าย) ของ absence แต่ละคน
 * - ถ้าครูหลัก+ครูร่วมลาพร้อมกันในคาบเดียว = 2 ตำแหน่ง
 * - `staleAssignmentCount` = สอนแทนที่ค้างอยู่แต่ครูไม่ได้ลาอยู่ในคาบนั้นแล้ว
 * - `coHintCount` = ตำแหน่งที่ยังไม่ได้จัด แต่ยังมีครูอีกคนสอนอยู่ในห้อง (แนะนำให้เลือกครูร่วม)
 */
export function computeDaySummary({ daySlots, assignments, absences, halves, lessonBlockMap }) {
  const classPeriods = new Set()
  const absenceMap = new Map()
  for (const a of absences || []) {
    if (a?.teacherId) absenceMap.set(a.teacherId, a)
  }

  const absentPositions = new Set()
  const partnerPresent = new Set()
  for (const s of daySlots || []) {
    classPeriods.add(`${s.class_id}-${s.period}`)
    const lb = lessonBlockMap?.get ? lessonBlockMap.get(s.lesson_block_id) : null
    const coId = lb?.co_teacher_id || s.co_teacher_id || null
    const mainAbs = absenceMap.get(s.teacher_id)
    const coAbs = coId ? absenceMap.get(coId) : null
    const mainAbsent = !!mainAbs && isPeriodInRange(s.period, mainAbs.periodRange, halves)
    const coAbsent = !!coAbs && isPeriodInRange(s.period, coAbs.periodRange, halves)
    if (mainAbsent) {
      const key = `${s.class_id}-${s.period}-main`
      absentPositions.add(key)
      if (coId && !coAbsent) partnerPresent.add(key)
    }
    if (coAbsent) {
      const key = `${s.class_id}-${s.period}-co`
      absentPositions.add(key)
      if (s.teacher_id && !mainAbsent) partnerPresent.add(key)
    }
  }

  const covered = new Set()
  for (const a of assignments || []) {
    covered.add(`${a.class_id}-${a.period}-${a.role === 'co' ? 'co' : 'main'}`)
  }

  let uncovered = 0
  let coHint = 0
  for (const key of absentPositions) {
    if (covered.has(key)) continue
    uncovered += 1
    if (partnerPresent.has(key)) coHint += 1
  }

  let stale = 0
  for (const a of assignments || []) {
    const abs = absenceMap.get(a.original_teacher_id)
    if (!abs || !isPeriodInRange(a.period, abs.periodRange, halves)) stale += 1
  }

  return {
    totalPeriods: classPeriods.size,
    absentTeacherCount: absenceMap.size,
    absentPositionCount: absentPositions.size,
    assignedCount: (assignments || []).length,
    uncoveredCount: uncovered,
    staleAssignmentCount: stale,
    coHintCount: coHint,
  }
}

/**
 * รวม slots ของวันนั้น (จาก solver result + user placements)
 * คืนค่าในรูปเดียวกับ solver slot: { lesson_block_id, day, period, subject_id, teacher_id, class_id, room_id }
 */
export function getDaySlots(resultSlots, userPlacements, lessonBlockMap, dayOfWeek) {
  const out = []
  for (const s of resultSlots || []) {
    if (s.day === dayOfWeek) out.push(s)
  }
  for (const [lbId, placements] of Object.entries(userPlacements || {})) {
    const lb = lessonBlockMap.get(lbId)
    if (!lb) continue
    for (const p of placements) {
      if (p.day !== dayOfWeek) continue
      out.push({
        lesson_block_id: lbId,
        day: p.day,
        period: p.period,
        subject_id: lb.subject_id,
        teacher_id: lb.teacher_id,
        co_teacher_id: lb.co_teacher_id || null,
        class_id: lb.class_id,
        room_id: lb.room_id,
      })
    }
  }
  return out
}

/**
 * ครูที่ว่างคาบ (วัน, คาบ) นั้น — busy = ครู/co-teacher ของคาบนั้นในตารางหลัก
 * + ครูที่รับสอนแทนคาบนั้นแล้วในวันนี้ + unavailable/admin_free + ครูที่มาร์คลา
 * + ครูที่เป็นผู้ดูแลกิจกรรม (fixed slot class_teachers) ในคาบนั้น
 */
export function computeFreeTeachers({
  dayOfWeek,
  period,
  daySlots,
  assignments,
  teachers,
  absentTeacherIds = [],
  lessonBlockMap,
  fixedSlots,
}) {
  const busy = new Set()
  for (const s of daySlots) {
    if (s.day !== dayOfWeek || s.period !== period) continue
    busy.add(s.teacher_id)
    const lb = lessonBlockMap.get(s.lesson_block_id)
    if (lb?.co_teacher_id) busy.add(lb.co_teacher_id)
    else if (s.co_teacher_id) busy.add(s.co_teacher_id)
  }
  for (const a of assignments || []) {
    if (a.period === period && a.substitute_teacher_id) busy.add(a.substitute_teacher_id)
  }
  // ครูผู้ดูแลกิจกรรม (fixed slots) ณ คาบนี้ — ว่างไม่ได้
  for (const fs of fixedSlots || []) {
    const effective = [fs.period, ...(fs.periods || [])]
    if (fs.day !== dayOfWeek || !effective.includes(period)) continue
    for (const tid of Object.values(fs.class_teachers || {}).flat()) {
      busy.add(tid)
    }
  }
  const key = `${dayOfWeek}-${period}`
  const absent = new Set(absentTeacherIds || [])
  return (teachers || []).filter((t) => (
    !absent.has(t.id)
    && !busy.has(t.id)
    && !(t.unavailable_slots || []).includes(key)
    && !(t.admin_free_slots || []).includes(key)
  ))
}

/**
 * รายการคาบเรียน (STUDY) ของห้อง พร้อมช่วงเวลา — จาก schedule block ของห้องนั้น
 * (fallback schedule_config ถ้าไม่มี block)
 */
export function getClassPeriods(classId, scheduleBlocks, scheduleConfig) {
  if (scheduleBlocks && scheduleBlocks.length > 0) {
    const block = (scheduleBlocks.find((b) => (b.target_classes || []).includes(classId)))
      || scheduleBlocks[0]
    const periods = (block.periods || []).filter((p) => p.type === 'STUDY')
    if (periods.length > 0) {
      return periods.map((p) => ({
        period_no: p.period_no,
        start_time: p.start_time,
        end_time: p.end_time,
      }))
    }
  }
  const cfg = scheduleConfig || {}
  const lunch = new Set(cfg.lunch_periods || [4])
  return Array.from({ length: cfg.periods_per_day || 8 }, (_, i) => i + 1)
    .filter((p) => !lunch.has(p))
    .map((p) => ({ period_no: p, start_time: '', end_time: '' }))
}

/**
 * รายการคาบทั้งหมดของวัน (union จาก schedule blocks, fallback schedule_config)
 * ใช้วาดแถบสถานะรายคาบ — คง type ไว้เพื่อแยก LUNCH/BREAK
 */
export function getDayPeriodList(scheduleBlocks, scheduleConfig) {
  const map = new Map()
  for (const block of scheduleBlocks || []) {
    for (const p of block.periods || []) {
      if (map.has(p.period_no)) continue
      map.set(p.period_no, {
        period_no: p.period_no,
        type: p.type || 'STUDY',
        start_time: p.start_time || '',
        end_time: p.end_time || '',
      })
    }
  }
  if (map.size === 0) {
    const cfg = scheduleConfig || {}
    const lunch = new Set(cfg.lunch_periods || [4])
    for (let i = 1; i <= (cfg.periods_per_day || 8); i++) {
      map.set(i, {
        period_no: i,
        type: lunch.has(i) ? 'LUNCH' : 'STUDY',
        start_time: '',
        end_time: '',
      })
    }
  }
  return [...map.values()].sort((a, b) => a.period_no - b.period_no)
}

/** Resolve the visible subject, class, and room labels for a scheduled slot. */
export function getSlotDisplayDetails(slot, {
  classMap,
  subjectMap,
  roomMap,
  lessonBlockMap,
} = {}) {
  if (!slot) return null
  const lessonBlock = lessonBlockMap?.get ? lessonBlockMap.get(slot.lesson_block_id) : null
  const roomId = slot.room_id || lessonBlock?.room_id || ''
  const room = roomMap?.get ? roomMap.get(roomId) : null
  return {
    subjectName: subjectMap?.get?.(slot.subject_id)?.name || slot.subject_id || '',
    className: classMap?.get?.(slot.class_id)?.name || slot.class_id || '',
    roomName: (typeof room === 'string' ? room : room?.name) || roomId,
  }
}

/** ระยะเวลาของคาบ (นาที) จากช่วงเวลาจริงของ block */
export function getPeriodDurationMinutes(classId, periodNo, scheduleBlocks, scheduleConfig) {
  const periods = getClassPeriods(classId, scheduleBlocks, scheduleConfig)
  const p = periods.find((x) => x.period_no === periodNo)
  if (p && p.start_time && p.end_time) {
    const [sh, sm] = p.start_time.split(':').map(Number)
    const [eh, em] = p.end_time.split(':').map(Number)
    if (!Number.isNaN(sh) && !Number.isNaN(eh)) return Math.max(0, (eh * 60 + em) - (sh * 60 + sm))
  }
  if (scheduleBlocks && scheduleBlocks.length > 0) {
    const block = scheduleBlocks.find((b) => (b.target_classes || []).includes(classId)) || scheduleBlocks[0]
    if (block?.period_duration_mins) return block.period_duration_mins
  }
  return 50
}

/** แปลงช่วงเวลาเป็น label '08:30–09:20' (หรือ '—' ถ้าไม่มี) */
export function formatTimeRange(startTime, endTime) {
  if (!startTime || !endTime) return '—'
  return `${startTime}–${endTime}`
}

/**
 * สร้างกริดรายวัน ต่อห้อง × คาบ — รองรับ 2 ตำแหน่งสอนแทนต่อเซลล์
 * (ครูหลัก role='main' และครูร่วม role='co' สามารถถูกแทนแยกกันได้)
 * rows: [{ classId, className, periods, cells: { [period_no]: cell|null } }]
 * cell = { subjectId, subjectName,
 *          teacherId, teacherName, originalId, originalName, mainIsSubstitute,
 *          coTeacherId, coTeacherName, coOriginalId, coOriginalName, coIsSubstitute,
 *          isSubstitute, start_time, end_time }
 *   - teacherName  = ชื่อที่แสดงของตำแหน่งครูหลัก (ครูแทน หรือครูเดิม)
 *   - coTeacherName = ชื่อที่แสดงของตำแหน่งครูร่วม (ครูแทนร่วม หรือครูร่วมเดิม)
 *   - isSubstitute = มีตำแหน่งใดถูกแทนอย่างน้อยหนึ่ง (ไฮไลต์เซลล์)
 */
export function buildDailyGrid({
  daySlots,
  assignments,
  classes,
  subjects,
  teachers,
  scheduleBlocks,
  scheduleConfig,
  lessonBlockMap,
}) {
  const subjectMap = new Map((subjects || []).map((s) => [s.id, s]))
  const teacherMap = new Map((teachers || []).map((t) => [t.id, t]))
  // assignments แยกตำแหน่ง: `${period}-${classId}` → { main, co }
  const assignMap = new Map()
  for (const a of assignments || []) {
    const key = `${a.period}-${a.class_id}`
    if (!assignMap.has(key)) assignMap.set(key, {})
    assignMap.get(key)[a.role === 'co' ? 'co' : 'main'] = a
  }

  const periodSet = new Set()
  const rows = (classes || []).map((cls) => {
    const periods = getClassPeriods(cls.id, scheduleBlocks, scheduleConfig)
    for (const p of periods) periodSet.add(p.period_no)
    const cells = {}
    for (const p of periods) {
      const slot = daySlots.find((s) => s.class_id === cls.id && s.period === p.period_no)
      if (!slot) {
        cells[p.period_no] = null
        continue
      }
      const lb = lessonBlockMap.get(slot.lesson_block_id)
      const subj = subjectMap.get(slot.subject_id)
      const teacher = teacherMap.get(slot.teacher_id)
      const coTeacherId = lb?.co_teacher_id || slot.co_teacher_id
      const assign = assignMap.get(`${p.period_no}-${cls.id}`) || {}
      const mainAssign = assign.main
      const coAssign = assign.co
      const mainIsSubstitute = !!mainAssign
      const coIsSubstitute = !!coAssign
      const mainPerson = mainAssign ? substitutePerson(mainAssign) : null
      const coPerson = coAssign ? substitutePerson(coAssign) : null
      // ครูร่วมที่รับสอนแทนตำแหน่งครูหลัก (หรือกลับกัน) — แสดงชื่อครั้งเดียว
      const mainEffectiveId = mainPerson ? mainPerson.id : slot.teacher_id
      const coEffectiveId = coPerson ? coPerson.id : coTeacherId
      const coSameAsMain = !!coEffectiveId && mainEffectiveId === coEffectiveId
      const mainOrig = mainAssign ? teacherMap.get(mainAssign.original_teacher_id) : null
      const coOrig = coAssign ? teacherMap.get(coAssign.original_teacher_id) : null
      cells[p.period_no] = {
        subjectId: slot.subject_id,
        subjectName: subj?.name || slot.subject_id,
        teacherId: mainPerson ? mainPerson.id : slot.teacher_id,
        teacherName: mainPerson
          ? substituteDisplayName(mainAssign, teacherMap)
          : (teacher?.name || ''),
        originalId: mainPerson ? mainAssign.original_teacher_id : null,
        originalName: mainPerson
          ? (mainOrig?.name || mainAssign.original_teacher_id)
          : null,
        mainIsSubstitute,
        mainSubstituteKind: mainPerson?.kind || null,
        coTeacherId: coSameAsMain ? null : coEffectiveId,
        coTeacherName: coSameAsMain
          ? null
          : coPerson
            ? substituteDisplayName(coAssign, teacherMap)
            : (coTeacherId ? (teacherMap.get(coTeacherId)?.name || coTeacherId) : null),
        coOriginalId: coPerson ? coAssign.original_teacher_id : null,
        coOriginalName: coPerson
          ? (coOrig?.name || coAssign.original_teacher_id)
          : null,
        coIsSubstitute,
        coSubstituteKind: coPerson?.kind || null,
        isSubstitute: mainIsSubstitute || coIsSubstitute,
        isTraineeSubstitute: mainPerson?.kind === 'trainee' || coPerson?.kind === 'trainee',
        start_time: p.start_time,
        end_time: p.end_time,
      }
    }
    return { classId: cls.id, className: cls.name, periods, cells }
  })
  const periodNos = [...periodSet].sort((a, b) => a - b)
  return { rows, periodNos }
}
