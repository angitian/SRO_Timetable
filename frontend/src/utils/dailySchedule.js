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

/** สร้าง id สำหรับ assignment ใหม่ */
export function makeAssignmentId() {
  return `ASG_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
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
    if (a.period === period) busy.add(a.substitute_teacher_id)
  }
  // ครูผู้ดูแลกิจกรรม (fixed slots) ณ คาบนี้ — ว่างไม่ได้
  for (const fs of fixedSlots || []) {
    const effective = [fs.period, ...(fs.periods || [])]
    if (fs.day !== dayOfWeek || !effective.includes(period)) continue
    for (const tid of Object.values(fs.class_teachers || {})) {
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
 * สร้างกริดรายวัน ต่อห้อง × คาบ
 * rows: [{ classId, className, periods, cells: { [period_no]: cell|null } }]
 * cell = { subjectId, subjectName, teacherId, teacherName, originalId, originalName,
 *          isSubstitute, coTeacherName, start_time, end_time }
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
  const assignMap = new Map()
  for (const a of assignments || []) assignMap.set(`${a.period}-${a.class_id}`, a)

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
      const assign = assignMap.get(`${p.period_no}-${cls.id}`)
      const isSubstitute = !!assign
      const subTeacher = assign ? teacherMap.get(assign.substitute_teacher_id) : null
      const original = assign ? teacherMap.get(assign.original_teacher_id) : null
      cells[p.period_no] = {
        subjectId: slot.subject_id,
        subjectName: subj?.name || slot.subject_id,
        teacherId: isSubstitute ? assign.substitute_teacher_id : slot.teacher_id,
        teacherName: isSubstitute
          ? (subTeacher?.name || assign.substitute_teacher_id)
          : (teacher?.name || ''),
        originalId: isSubstitute ? assign.original_teacher_id : null,
        originalName: isSubstitute
          ? (original?.name || assign.original_teacher_id)
          : null,
        isSubstitute,
        coTeacherName: coTeacherId ? (teacherMap.get(coTeacherId)?.name || coTeacherId) : null,
        start_time: p.start_time,
        end_time: p.end_time,
      }
    }
    return { classId: cls.id, className: cls.name, periods, cells }
  })
  const periodNos = [...periodSet].sort((a, b) => a - b)
  return { rows, periodNos }
}
