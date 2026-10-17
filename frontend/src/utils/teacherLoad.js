/**
 * Shared teacher/class load helpers — used by TeacherWorkloadStep (Step 3)
 * and TimetableView (Step 5, unplaced-report panel).
 */

/**
 * Count a teacher's available teaching slots per week AFTER deducting:
 *   - fixed slots (ลูกเสือ/โฮมรูม/ฯลฯ) that apply to classes the teacher teaches
 *   - teacher.unavailable_slots + admin_free_slots
 * Mirrors the backend preflight capacity check. Uses schedule block day-1 as
 * the period reference (falls back to schedule_config).
 */
export function computeTeacherAvailableSlots(teacher, lessonBlocks, scheduleBlocks, fixedSlots, scheduleConfig) {
  if (!teacher) return 0
  const taughtClassIds = new Set(lessonBlocks
    .filter((lb) => lb.teacher_id === teacher.id || lb.co_teacher_id === teacher.id)
    .map((lb) => lb.class_id))

  const { days, dayPeriods } = deriveDayPeriods(scheduleBlocks, scheduleConfig)
  if (dayPeriods.length === 0) return 0

  // Fixed slots per taught class: classId -> Set of "day-period" strings.
  // class_ids empty = assembly-style slot that blocks EVERY class.
  const fixedByClass = new Map()
  for (const fs of fixedSlots || []) {
    const periods = [fs.period, ...(fs.periods || [])]
    const isGlobal = !fs.class_ids || fs.class_ids.length === 0
    const targets = isGlobal ? taughtClassIds : fs.class_ids.filter((cid) => taughtClassIds.has(cid))
    for (const p of periods) {
      const key = `${fs.day}-${p}`
      for (const cid of targets) {
        if (!fixedByClass.has(cid)) fixedByClass.set(cid, new Set())
        fixedByClass.get(cid).add(key)
      }
    }
  }
  const busy = new Set([
    ...(teacher.unavailable_slots || []),
    ...(teacher.admin_free_slots || []),
  ])

  // คาบที่ครูคนนี้เป็นผู้ดูแลกิจกรรม (fixed slot class_teachers) — ว่างไม่ได้
  for (const fs of fixedSlots || []) {
    const supervises = flattenClassTeachers(fs.class_teachers).has(teacher.id)
    if (!supervises) continue
    for (const p of [fs.period, ...(fs.periods || [])]) {
      busy.add(`${fs.day}-${p}`)
    }
  }

  // A slot counts as available when the teacher is free AND at least one class
  // they teach is free there (mirrors the backend preflight: the solver checks
  // per lesson block, so a fixed slot in one class must not block the teacher
  // from teaching their other classes at the same time).
  let available = 0
  for (let d = 1; d <= days; d++) {
    for (const p of dayPeriods) {
      const key = `${d}-${p}`
      if (busy.has(key)) continue
      const anyClassFree = [...taughtClassIds].some((cid) => !fixedByClass.get(cid)?.has(key))
      if (anyClassFree) available++
    }
  }
  return available
}

/**
 * Count a class's available teaching slots per week AFTER deducting fixed
 * slots (ลูกเสือ/โฮมรูม/ฯลฯ) that apply to that class.
 */
export function computeClassAvailableSlots(classId, scheduleBlocks, fixedSlots, scheduleConfig) {
  const { days, dayPeriods } = deriveDayPeriods(scheduleBlocks, scheduleConfig)
  if (dayPeriods.length === 0) return 0

  const blocked = new Set()
  for (const fs of fixedSlots || []) {
    const applies = !fs.class_ids || fs.class_ids.length === 0
      || fs.class_ids.includes(classId)
    if (!applies) continue
    for (const p of [fs.period, ...(fs.periods || [])]) {
      blocked.add(`${fs.day}-${p}`)
    }
  }

  let available = 0
  for (let d = 1; d <= days; d++) {
    for (const p of dayPeriods) {
      if (!blocked.has(`${d}-${p}`)) available++
    }
  }
  return available
}

/** Sum lesson periods per class. */
export function computeNeededPerClass(lessonBlocks) {
  const needed = {}
  for (const lb of lessonBlocks || []) {
    needed[lb.class_id] = (needed[lb.class_id] || 0) + (lb.periods_per_week || 0)
  }
  return needed
}

/** Sum lesson periods per teacher (co-taught counts for both). */
export function computeNeededPerTeacher(lessonBlocks) {
  const needed = {}
  for (const lb of lessonBlocks || []) {
    needed[lb.teacher_id] = (needed[lb.teacher_id] || 0) + (lb.periods_per_week || 0)
    if (lb.co_teacher_id) {
      needed[lb.co_teacher_id] = (needed[lb.co_teacher_id] || 0) + (lb.periods_per_week || 0)
    }
  }
  return needed
}

/**
 * Normalize class_teachers (fixed slot) → { [class_id]: string[] }
 * รองรับข้อมูลเก่าแบบ { class_id: teacher_id } (string) → [teacher_id]
 */
export function normalizeClassTeachers(raw) {
  const normalized = {}
  for (const [classId, teachers] of Object.entries(raw || {})) {
    if (Array.isArray(teachers)) {
      normalized[classId] = teachers.filter((t) => typeof t === 'string' && t.trim())
    } else if (typeof teachers === 'string' && teachers.trim().length > 0) {
      normalized[classId] = [teachers]
    } else {
      normalized[classId] = []
    }
  }
  return normalized
}

/** Flatten ครูผู้ดูแลทั้งหมดของกิจกรรม (list ของ class_teachers) → set ของ teacher_id */
export function flattenClassTeachers(raw) {
  const ids = new Set()
  for (const list of Object.values(normalizeClassTeachers(raw))) {
    for (const tid of list) ids.add(tid)
  }
  return ids
}

/**
 * คาบดูแลกิจกรรม (fixed slots) ต่อครู — จาก fs.class_teachers { class_id: [teacher_id, ...] }
 * คืน { [teacher_id]: count } — นับคาบที่ไม่ซ้ำกันของแต่ละกิจกรรม (effective periods)
 * ครูที่เข้าร่วมกิจกรรมนี้ 1 ครั้ง = 1 คาบ/สัปดาห์ (ไม่คูณจำนวนห้องที่ดูแล)
 */
export function computeFixedSupervision(fixedSlots) {
  const counts = {}
  for (const fs of fixedSlots || []) {
    const unique = new Set([fs.period, ...(fs.periods || [])])
    const seen = new Set()
    for (const tid of flattenClassTeachers(fs.class_teachers)) {
      if (seen.has(tid)) continue
      seen.add(tid)
      counts[tid] = (counts[tid] || 0) + unique.size
    }
  }
  return counts
}

/** Shared: derive (days, study-period numbers per day) from blocks or config. */
function deriveDayPeriods(scheduleBlocks, scheduleConfig) {
  const refBlock = scheduleBlocks?.[0]
  if (refBlock) {
    const dayPeriods = (refBlock.periods || [])
      .filter((p) => p.type === 'STUDY')
      .map((p) => p.period_no)
    return { days: refBlock.days_per_week || 5, dayPeriods }
  }
  const cfg = scheduleConfig || {}
  const lunch = new Set(cfg.lunch_periods || [4])
  const dayPeriods = Array.from({ length: cfg.periods_per_day || 8 }, (_, i) => i + 1)
    .filter((p) => !lunch.has(p))
  return { days: cfg.days_per_week || 5, dayPeriods }
}
