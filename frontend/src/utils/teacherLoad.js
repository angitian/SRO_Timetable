/**
 * Shared teacher/class load helpers — used by TeacherWorkloadStep (Step 3)
 * and TimetableView (Step 5, unplaced-report panel).
 */

/**
 * Resolve which schedule blocks a teacher teaches in (via their classes).
 * Returns the matching block objects, or [] in legacy mode (no blocks /
 * teacher has no lessons yet).
 */
export function getTeacherBlocks(teacher, lessonBlocks, scheduleBlocks) {
  if (!teacher || !scheduleBlocks?.length) return []
  const taughtClassIds = new Set(
    (lessonBlocks || [])
      .filter((lb) => lb.teacher_id === teacher.id || lb.co_teacher_id === teacher.id)
      .map((lb) => lb.class_id),
  )
  return scheduleBlocks.filter(
    (b) => (b.target_classes || []).some((cid) => taughtClassIds.has(cid)),
  )
}

/**
 * Union of period numbers across the blocks a teacher teaches in (or the
 * shared schedule_config fallback in legacy mode).
 *
 * Returns:
 *  - days:        max days_per_week across the blocks
 *  - allPeriodNos: sorted union of every period_no used (STUDY+LUNCH+BREAK)
 *  - studySet:    period_nos that are STUDY in at least one block
 *  - lunchSet:    period_nos that are LUNCH in at least one block
 *  - multiBlock:  true when the teacher teaches in more than one block
 *
 * Period numbers may be decimals (e.g. 3.5 for inserted short breaks) — they
 * are used verbatim in 'day-period' lock keys so they match the backend's
 * canonical slot_key().
 */
/** Period list for a block on a given day — mirrors backend
 *  utils.get_periods_for_block_on_day (per-day variation aware). */
function periodsForBlockOnDay(blk, day) {
  if (blk && blk.apply_to_all_days === false && blk.periods_by_day) {
    return blk.periods_by_day[String(day)] || blk.periods || []
  }
  return blk?.periods || []
}

export function deriveTeacherPeriodSet(teacher, lessonBlocks, scheduleBlocks, scheduleConfig) {
  const blocks = getTeacherBlocks(teacher, lessonBlocks, scheduleBlocks)
  if (blocks.length === 0) {
    // Legacy single-grid mode (also used when the teacher has no lessons yet
    // but blocks exist — fall back to the first block's structure).
    const refBlock = scheduleBlocks?.[0]
    if (refBlock) {
      const dayPeriods = refBlock.periods || []
      const allPeriodNos = dayPeriods.map((p) => p.period_no)
      const studySet = new Set(dayPeriods.filter((p) => p.type === 'STUDY').map((p) => p.period_no))
      const lunchSet = new Set(dayPeriods.filter((p) => p.type === 'LUNCH').map((p) => p.period_no))
      const days = refBlock.days_per_week || 5
      const studySetByDay = {}
      for (let d = 1; d <= days; d++) {
        studySetByDay[d] = new Set(
          periodsForBlockOnDay(refBlock, d)
            .filter((p) => p.type === 'STUDY')
            .map((p) => p.period_no),
        )
      }
      return {
        days,
        allPeriodNos: [...new Set(allPeriodNos)].sort((a, b) => a - b),
        studySet,
        lunchSet,
        studySetByDay,
        multiBlock: false,
      }
    }
    const lunch = new Set(scheduleConfig?.lunch_periods || [4])
    const allPeriodNos = Array.from(
      { length: scheduleConfig?.periods_per_day || 8 },
      (_, i) => i + 1,
    )
    const studySet = new Set(allPeriodNos.filter((p) => !lunch.has(p)))
    const days = scheduleConfig?.days_per_week || 5
    const studySetByDay = {}
    for (let d = 1; d <= days; d++) studySetByDay[d] = new Set(studySet)
    return {
      days,
      allPeriodNos,
      studySet,
      lunchSet: lunch,
      studySetByDay,
      multiBlock: false,
    }
  }

  const allPeriodNos = new Set()
  const studySet = new Set()
  const lunchSet = new Set()
  const studySetByDay = {}
  let days = 5
  const collect = (periods) => {
    for (const p of periods || []) {
      allPeriodNos.add(p.period_no)
      if (p.type === 'STUDY') studySet.add(p.period_no)
      else if (p.type === 'LUNCH') lunchSet.add(p.period_no)
    }
  }
  for (const b of blocks) {
    days = Math.max(days, b.days_per_week || 5)
    collect(b.periods)
    // Per-day period variations (apply_to_all_days=false)
    for (const dayPeriods of Object.values(b.periods_by_day || {})) {
      collect(dayPeriods)
    }
  }
  // Per-day STUDY sets (union across the teacher's blocks) — needed so the
  // lock grid only makes cells clickable on days where the period actually
  // exists as a study period (prevents no-op locks like clicking the "last"
  // column on a day that ends earlier in a per-day-variation block).
  for (let d = 1; d <= days; d++) {
    const set = new Set()
    for (const b of blocks) {
      if (d > (b.days_per_week || 5)) continue
      for (const p of periodsForBlockOnDay(b, d)) {
        if (p.type === 'STUDY') set.add(p.period_no)
      }
    }
    studySetByDay[d] = set
  }
  return {
    days,
    allPeriodNos: [...allPeriodNos].sort((a, b) => a - b),
    studySet,
    lunchSet,
    studySetByDay,
    multiBlock: blocks.length > 1,
  }
}

/**
 * Count a teacher's available teaching slots per week AFTER deducting:
 *   - fixed slots (ลูกเสือ/โฮมรูม/ฯลฯ) that apply to classes the teacher teaches
 *   - teacher.unavailable_slots + admin_free_slots
 * Mirrors the backend preflight capacity check. Uses the union of STUDY
 * periods across the teacher's own blocks (falls back to schedule_config).
 */
export function computeTeacherAvailableSlots(teacher, lessonBlocks, scheduleBlocks, fixedSlots, scheduleConfig) {
  if (!teacher) return 0
  const taughtClassIds = new Set(lessonBlocks
    .filter((lb) => lb.teacher_id === teacher.id || lb.co_teacher_id === teacher.id)
    .map((lb) => lb.class_id))

  const { days, studySet } = deriveTeacherPeriodSet(teacher, lessonBlocks, scheduleBlocks, scheduleConfig)
  const dayPeriods = [...studySet]
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
 * ครูคนนี้เป็นผู้ดูแล fixed slot นี้หรือไม่ — ตรวจว่า teacherId อยู่ใน
 * fs.class_teachers (ห้องใดห้องหนึ่ง) ใช้กรองคาบพิเศษในตารางสอนครู:
 * โชว์กิจกรรมเฉพาะครูที่ดูแล ไม่ใช่ทุกครูที่สอนห้องนั้น
 */
export function teacherSupervisesFixedSlot(fs, teacherId) {
  return flattenClassTeachers(fs?.class_teachers).has(teacherId)
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

/**
 * Pre-generation sanity checks for teacher locks — mirrors the backend
 * preflight blocking conditions. Returns an array of issues:
 *   { teacherId, teacherName, type, message }
 *   type: 'over_available' | 'supervisor_lock' | 'pinned_lock'
 * These are the three conditions that make the solver fail (422 INFEASIBLE)
 * or make a lock look ineffective, so surfacing them BEFORE the user presses
 * "จัดตาราง" explains "ทำไมล็อกแล้วไม่ทำงาน/จัดไม่ได้".
 */
export function checkTeacherLockIssues(fixtureData, userPlacements = {}) {
  const issues = []
  if (!fixtureData) return issues
  const teachers = fixtureData.teachers || []
  const lessonBlocks = fixtureData.lesson_blocks || []
  const fixedSlots = fixtureData.fixed_slots || []
  const teacherById = new Map(teachers.map((t) => [t.id, t]))

  // needed periods per teacher (main + co-teacher), mirrors preflight
  const needed = {}
  for (const lb of lessonBlocks) {
    needed[lb.teacher_id] = (needed[lb.teacher_id] || 0) + (lb.periods_per_week || 0)
    if (lb.co_teacher_id) {
      needed[lb.co_teacher_id] = (needed[lb.co_teacher_id] || 0) + (lb.periods_per_week || 0)
    }
  }
  const supervision = computeFixedSupervision(fixedSlots)

  // Slots each teacher supervises (fixed-slot duties) — locking these would
  // produce a supervisor_unavailable conflict on the backend.
  const supervisorSlots = new Map() // teacherId -> [{ fs, p }]
  for (const fs of fixedSlots) {
    for (const tid of flattenClassTeachers(fs.class_teachers)) {
      for (const p of [fs.period, ...(fs.periods || [])]) {
        if (!supervisorSlots.has(tid)) supervisorSlots.set(tid, [])
        supervisorSlots.get(tid).push({ fs, p })
      }
    }
  }

  // Pinned placements / is_fixed lesson blocks → (day, period) per teacher.
  const pinned = new Map() // teacherId -> [{ day, period, lbId }]
  for (const [lbId, placements] of Object.entries(userPlacements || {})) {
    const lb = lessonBlocks.find((x) => x.id === lbId)
    if (!lb) continue
    for (const p of placements || []) {
      if (!pinned.has(lb.teacher_id)) pinned.set(lb.teacher_id, [])
      pinned.get(lb.teacher_id).push({ day: p.day, period: p.period, lbId })
      if (lb.co_teacher_id) {
        if (!pinned.has(lb.co_teacher_id)) pinned.set(lb.co_teacher_id, [])
        pinned.get(lb.co_teacher_id).push({ day: p.day, period: p.period, lbId })
      }
    }
  }
  for (const lb of lessonBlocks) {
    if (!lb.is_fixed) continue
    const fixedPts = (lb.fixed_slots?.length ? lb.fixed_slots : [{ day: lb.fixed_day, period: lb.fixed_period }])
      .filter((x) => x && x.day != null && x.period != null)
    for (const fp of fixedPts) {
      if (!pinned.has(lb.teacher_id)) pinned.set(lb.teacher_id, [])
      pinned.get(lb.teacher_id).push({ day: fp.day, period: fp.period, lbId: lb.id })
      if (lb.co_teacher_id) {
        if (!pinned.has(lb.co_teacher_id)) pinned.set(lb.co_teacher_id, [])
        pinned.get(lb.co_teacher_id).push({ day: fp.day, period: fp.period, lbId: lb.id })
      }
    }
  }

  const DAY_NAMES = ['', 'จันทร์', 'อังคาร', 'พุธ', 'พฤหัสบดี', 'ศุกร์', 'เสาร์', 'อาทิตย์']
  const fmt = (d, p) => `${DAY_NAMES[d] || `วัน${d}`} คาบ${p}`

  for (const t of teachers) {
    const unavailable = new Set(t.unavailable_slots || [])
    const adminFree = new Set(t.admin_free_slots || [])
    const locked = new Set([...unavailable, ...adminFree])

    // over_available: teaching load (minus supervision) > remaining slots
    const teachingNeeded = (needed[t.id] || 0) - (supervision[t.id] || 0)
    if (teachingNeeded > 0) {
      const available = computeTeacherAvailableSlots(
        t, lessonBlocks, fixtureData.schedule_blocks || [], fixedSlots, fixtureData.schedule_config,
      )
      if (teachingNeeded > available) {
        issues.push({
          teacherId: t.id,
          teacherName: t.name,
          type: 'over_available',
          message: `ครู ${t.name} ต้องสอน ${teachingNeeded} คาบ แต่เหลือช่องว่างเพียง ${available} คาบหลังหักล็อก/กิจกรรม — ลดคาบสอนหรือปลดล็อกบางส่วน`,
        })
      }
    }

    // supervisor_lock: locked a slot that is the teacher's own supervision duty
    for (const duty of supervisorSlots.get(t.id) || []) {
      const key = `${duty.fs.day}-${duty.p}`
      if (unavailable.has(key)) {
        issues.push({
          teacherId: t.id,
          teacherName: t.name,
          type: 'supervisor_lock',
          message: `ครู ${t.name} ล็อกคาบ ${fmt(duty.fs.day, duty.p)} ซึ่งเป็นคาบที่ตัวเองดูแลกิจกรรม "${duty.fs.name}" — จัดไม่ได้ กรุณาปลดล็อกหรือเปลี่ยนผู้ดูแล`,
        })
      }
    }

    // pinned_lock: locked a slot with a pinned/pre-assigned lesson
    for (const pin of pinned.get(t.id) || []) {
      const key = `${pin.day}-${pin.period}`
      if (locked.has(key)) {
        issues.push({
          teacherId: t.id,
          teacherName: t.name,
          type: 'pinned_lock',
          message: `ครู ${t.name} ล็อกคาบ ${fmt(pin.day, pin.period)} แต่มีการปักหมุดวิชาไว้ที่คาบเดียวกัน — กรุณาปลดล็อกหรือย้ายปักหมุด`,
        })
      }
    }
  }
  return issues
}

/** class_ids sentinel values that mean "every class" (assembly). */
const ALL_CLASSES_SENTINELS = new Set(['ทุกห้อง', 'ทุกห้องเรียน', 'ทุกชั้น', 'all', 'every'])

function isAssemblyClassIds(classIds) {
  const ids = (classIds || []).filter((c) => c != null && String(c).trim() !== '')
  if (ids.length === 0) return true
  return ids.every((c) => ALL_CLASSES_SENTINELS.has(String(c).trim().toLowerCase()))
}

/**
 * Cells in a teacher's lock grid that are ALREADY blocked school-wide —
 * users shouldn't mark them "don't want to teach" (ห้ามปัก):
 *
 *   key "day-period" -> {
 *     kind:  'pinned' | 'supervision' | 'assembly' | 'class-full' | 'class-partial'
 *     label: ชื่อกิจกรรม หรือ "วิชา (ห้อง)" สำหรับช่องปักหมุด
 *     title: tooltip อธิบาย
 *   }
 *
 * Sources:
 *  - pinned:      userPlacements + lesson_blocks.is_fixed (ครูคนนี้ main/co)
 *                 → ล็อกชนปักหมุด = fixed_slot_conflicts → INFEASIBLE
 *  - supervision: fixed_slots[].class_teachers มีครูคนนี้ (คาบดูแลกิจกรรม)
 *  - assembly:    fixed_slots ที่ class_ids ว่าง หรือ "ทุกห้อง" (บล็อกทุกชั้น)
 *  - class-full:  กิจกรรมเฉพาะห้องที่ครอบคลุม "ทุกห้องที่ครูสอน"
 *  - class-partial: กิจกรรมเฉพาะบางห้องที่ครูสอน (ยังสอนห้องอื่นได้ → ล็อกได้)
 */
export function deriveTeacherBlockedCells(teacher, fixtureData, userPlacements = {}) {
  const cells = new Map()
  if (!teacher || !fixtureData) return cells

  const lessonBlocks = fixtureData.lesson_blocks || []
  const fixedSlots = fixtureData.fixed_slots || []
  const subjectById = new Map((fixtureData.subjects || []).map((s) => [s.id, s]))
  const classById = new Map((fixtureData.classes || []).map((c) => [c.id, c]))

  const taughtClassIds = new Set(
    lessonBlocks
      .filter((lb) => lb.teacher_id === teacher.id || lb.co_teacher_id === teacher.id)
      .map((lb) => lb.class_id),
  )

  // Only mark cells that actually exist on this teacher's grid.
  const { allPeriodNos, days, studySetByDay } = deriveTeacherPeriodSet(
    teacher, lessonBlocks, fixtureData.schedule_blocks || [], fixtureData.schedule_config,
  )
  const periodSet = new Set(allPeriodNos)

  // ── Fixed slots (คาบพิเศษ / คาบล็อกกิจกรรม) ──
  for (const fs of fixedSlots) {
    const dayStudy = studySetByDay?.[fs.day]
    const effPeriods = [fs.period, ...(fs.periods || [])]
      .filter((p) => periodSet.has(p) && (dayStudy ? dayStudy.has(p) : true))
    if (!effPeriods.length || fs.day > days) continue
    const supervises = flattenClassTeachers(fs.class_teachers).has(teacher.id)
    const rawIds = (fs.class_ids || []).filter((c) => c != null && String(c).trim() !== '')
    const assembly = isAssemblyClassIds(fs.class_ids)
    const matchedClasses = rawIds.filter((cid) => taughtClassIds.has(cid))

    for (const p of effPeriods) {
      const key = `${fs.day}-${p}`
      if (cells.has(key)) continue
      if (supervises) {
        cells.set(key, {
          kind: 'supervision',
          label: fs.name,
          title: `คาบดูแลกิจกรรม: ${fs.name} — ครูคนนี้ยุ่งอยู่แล้ว ไม่ต้องล็อก`,
        })
      } else if (assembly) {
        cells.set(key, {
          kind: 'assembly',
          label: fs.name,
          title: `กิจกรรมทุกห้อง: ${fs.name} — ถูกบล็อกทั้งโรงเรียนอยู่แล้ว ไม่ต้องล็อก`,
        })
      } else if (matchedClasses.length > 0) {
        const allTaughtBlocked = taughtClassIds.size > 0 && matchedClasses.length >= taughtClassIds.size
        cells.set(key, {
          kind: allTaughtBlocked ? 'class-full' : 'class-partial',
          label: fs.name,
          title: allTaughtBlocked
            ? `กิจกรรม: ${fs.name} — ห้องที่ครูสอนถูกบล็อกทั้งหมด ไม่ต้องล็อก`
            : `กิจกรรม: ${fs.name} — บล็อกเฉพาะบางห้องที่ครูสอน (ยังสอนห้องอื่นได้ แต่ล็อกช่องนี้ก็ได้)`,
        })
      }
    }
  }

  // ── Pinned lessons (คาบที่ปักหมุดไว้) ──
  // userPlacements { lbId: [{day, period}] } + lesson_blocks.is_fixed
  const pinned = [] // { day, period, lb }
  for (const [lbId, placements] of Object.entries(userPlacements || {})) {
    const lb = lessonBlocks.find((x) => x.id === lbId)
    if (!lb) continue
    for (const p of placements || []) {
      pinned.push({ day: p.day, period: p.period, lb })
    }
  }
  for (const lb of lessonBlocks) {
    if (!lb.is_fixed) continue
    const pts = (lb.fixed_slots?.length ? lb.fixed_slots : [{ day: lb.fixed_day, period: lb.fixed_period }])
      .filter((x) => x && x.day != null && x.period != null)
    for (const fp of pts) pinned.push({ day: fp.day, period: fp.period, lb })
  }

  for (const pin of pinned) {
    const lb = pin.lb
    const isMine = lb.teacher_id === teacher.id || lb.co_teacher_id === teacher.id
    if (!isMine || !periodSet.has(pin.period) || pin.day > days) continue
    const dayStudy = studySetByDay?.[pin.day]
    if (dayStudy && !dayStudy.has(pin.period)) continue
    const key = `${pin.day}-${pin.period}`
    if (cells.has(key)) continue
    const subj = subjectById.get(lb.subject_id)?.name || lb.subject_id
    const cls = classById.get(lb.class_id)?.name || lb.class_id
    cells.set(key, {
      kind: 'pinned',
      label: `${subj} (${cls})`,
      title: `ปักหมุดไว้: ${subj} ${cls} — ล็อกไม่ได้ (จะชนกันแล้วจัดตารางไม่ได้) ปลดปักหมุดที่หน้า 5`,
    })
  }

  return cells
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

/**
 * Detect slots in a solver RESULT that violate the CURRENT teacher locks.
 *
 * A correctly-generated result can never contain these — the solver removes
 * locked slots from the decision space entirely. Any hit therefore means the
 * displayed timetable is STALE (generated before the lock, or restored from
 * an old cache). Step 5 shows this as an explicit "ตารางไม่ตรงล็อก" banner.
 *
 * Checks the hard restrictions mirrored by the backend:
 *   unavailable_slots / admin_free_slots / no_first_period / no_last_period
 * for BOTH the lesson's main teacher and co-teacher.
 *
 * @param result TimetableResponse — checked against `result.slots`
 * @param fixtureData current fixture data (teachers' locks live here)
 * @param userPlacements optional { [lessonBlockId]: [{day,period}] } — manual
 *   placements/pins are merged in as pseudo-slots so a pin that violates a
 *   lock is flagged the same way a stale solver slot is.
 * @returns Array of { teacherName, day, period, subjectName, className, lockType }
 */
export function checkResultAgainstLocks(result, fixtureData, userPlacements = null) {
  const violations = []
  const slots = [...(result?.slots || [])]
  const lbByIdEarly = new Map((fixtureData?.lesson_blocks || []).map((b) => [b.id, b]))
  for (const [lbId, places] of Object.entries(userPlacements || {})) {
    const lb = lbByIdEarly.get(lbId)
    for (const p of places || []) {
      slots.push({
        lesson_block_id: lbId,
        day: p.day,
        period: p.period,
        teacher_id: lb?.teacher_id,
        co_teacher_id: lb?.co_teacher_id,
        class_id: lb?.class_id,
        subject_id: lb?.subject_id,
      })
    }
  }
  if (!slots.length || !fixtureData) return violations

  const lbById = new Map((fixtureData.lesson_blocks || []).map((b) => [b.id, b]))
  const teacherById = new Map((fixtureData.teachers || []).map((t) => [t.id, t]))
  const subjectById = new Map((fixtureData.subjects || []).map((s) => [s.id, s]))
  const classById = new Map((fixtureData.classes || []).map((c) => [c.id, c]))

  // class → block (for per-day 'last period' resolution)
  const classBlockMap = {}
  for (const b of fixtureData.schedule_blocks || []) {
    for (const cid of b.target_classes || []) classBlockMap[cid] = b
  }
  const lastPeriodCache = new Map()
  const lastStudyPeriodOfDay = (classId, day) => {
    const key = `${classId}|${day}`
    if (lastPeriodCache.has(key)) return lastPeriodCache.get(key)
    const blk = classBlockMap[classId]
    let periods
    if (blk) {
      periods = periodsForBlockOnDay(blk, day)
        .filter((p) => p.type === 'STUDY')
        .map((p) => p.period_no)
    } else {
      const cfg = fixtureData.schedule_config || {}
      const lunch = new Set(cfg.lunch_periods || [4])
      periods = Array.from({ length: cfg.periods_per_day || 8 }, (_, i) => i + 1)
        .filter((p) => !lunch.has(p))
    }
    const last = periods.length ? Math.max(...periods) : null
    lastPeriodCache.set(key, last)
    return last
  }

  const DAY_NAMES = ['', 'จันทร์', 'อังคาร', 'พุธ', 'พฤหัสบดี', 'ศุกร์', 'เสาร์', 'อาทิตย์']

  for (const s of slots) {
    const lb = lbById.get(s.lesson_block_id)
    const involved = new Set()
    if (lb?.teacher_id) involved.add(lb.teacher_id)
    if (lb?.co_teacher_id) involved.add(lb.co_teacher_id)
    if (s.teacher_id) involved.add(s.teacher_id)
    if (s.co_teacher_id) involved.add(s.co_teacher_id)
    for (const tid of involved) {
      const t = teacherById.get(tid)
      if (!t) continue
      // JS renders 7.0 as '7' — matches backend slot_key() normalization
      const key = `${s.day}-${s.period}`
      let lockType = null
      if ((t.unavailable_slots || []).includes(key)) lockType = 'ล็อกไม่ต้องการสอน'
      else if ((t.admin_free_slots || []).includes(key)) lockType = 'หน้าที่บริหาร'
      else if (t.no_first_period && s.period === 1) lockType = 'ห้ามสอนคาบแรก'
      else if (t.no_last_period && s.period === lastStudyPeriodOfDay(s.class_id, s.day)) {
        lockType = 'ห้ามสอนคาบสุดท้าย'
      }
      if (lockType) {
        violations.push({
          teacherName: t.name,
          day: s.day,
          dayName: DAY_NAMES[s.day] || `วัน${s.day}`,
          period: s.period,
          subjectName: subjectById.get(s.subject_id)?.name || s.subject_id,
          className: classById.get(s.class_id)?.name || s.class_id,
          lockType,
        })
      }
    }
  }
  return violations
}

const DAY_NAMES = ['', 'จันทร์', 'อังคาร', 'พุธ', 'พฤหัสบดี', 'ศุกร์', 'เสาร์', 'อาทิตย์']

/**
 * Validate a manual placement (drag & drop on Step 5) against the same hard
 * rules the solver enforces. Returns null when the slot is legal, or
 * { type, message } explaining the first blocking rule found.
 *
 * Checked rules (mirrors solver._is_teacher_hard_blocked / _is_blocked_for_class
 * plus the entity clashes):
 *   - teacher_busy        ครู (หรือครูร่วม) สอนคลาสอื่นอยู่คาบนี้แล้ว
 *   - teacher_supervising ครูต้องดูแลกิจกรรมคาบนี้ (fixed_slots.class_teachers)
 *   - teacher_unavailable ครูถูกล็อก unavailable/admin_free/no_first/no_last
 *   - class_activity      ห้องเรียนถูกกิจกรรมบล็อกคาบนี้ (fixed_slots.class_ids)
 *   - class_occupied      ห้องเรียนมีคาบอื่นอยู่แล้วคาบนี้
 *   - room_busy           ห้องสอน (room_id) ถูกใช้โดยคาบอื่นคาบนี้
 *
 * @param lessonBlock  the block being dropped
 * @param day          1-5
 * @param period       period number
 * @param ctx          { resultSlots, userPlacements, fixtureData }
 * @returns null | { type: string, message: string }
 */
export function getPlacementBlockReason(lessonBlock, day, period, ctx = {}) {
  const { resultSlots = [], userPlacements = {}, fixtureData } = ctx
  if (!lessonBlock || !fixtureData) return null

  const teacherIds = [lessonBlock.teacher_id, lessonBlock.co_teacher_id].filter(Boolean)
  const teacherById = new Map((fixtureData.teachers || []).map((t) => [t.id, t]))
  const lbById = new Map((fixtureData.lesson_blocks || []).map((b) => [b.id, b]))
  const classById = new Map((fixtureData.classes || []).map((c) => [c.id, c]))
  const subjectById = new Map((fixtureData.subjects || []).map((s) => [s.id, s]))
  const teacherName = (tid) => teacherById.get(tid)?.name || tid
  const className = classById.get(lessonBlock.class_id)?.name || lessonBlock.class_id
  const subjName = subjectById.get(lessonBlock.subject_id)?.name || lessonBlock.subject_id
  const where = `${DAY_NAMES[day] || `วัน${day}`} คาบ${period}`
  const slotKey = `${day}-${period}`

  // ── 1) teacher already teaching / class occupied / room busy at this slot
  //    (solver slots + manual placements, excluding this block's own pins at
  //    other positions — its pins at THIS position are deduped by the reducer)
  const placed = []
  for (const s of resultSlots) {
    if (s.lesson_block_id === lessonBlock.id) continue
    placed.push({ day: s.day, period: s.period, teacher_id: s.teacher_id, co_teacher_id: s.co_teacher_id, class_id: s.class_id, room_id: s.room_id })
  }
  for (const [lbId, places] of Object.entries(userPlacements || {})) {
    if (lbId === lessonBlock.id) continue
    const plb = lbById.get(lbId)
    for (const p of places || []) {
      placed.push({ day: p.day, period: p.period, teacher_id: plb?.teacher_id, co_teacher_id: plb?.co_teacher_id, class_id: plb?.class_id, room_id: plb?.room_id })
    }
  }
  for (const s of placed) {
    if (s.day !== day || s.period !== period) continue
    if (teacherIds.includes(s.teacher_id) || (s.co_teacher_id && teacherIds.includes(s.co_teacher_id))) {
      return {
        type: 'teacher_busy',
        message: `${teacherName(teacherIds[0])} สอนคลาสอื่นอยู่แล้วที่ ${where}`,
      }
    }
    if (s.class_id === lessonBlock.class_id) {
      return { type: 'class_occupied', message: `ห้อง ${className} มีคาบอื่นอยู่แล้วที่ ${where}` }
    }
    if (lessonBlock.room_id && s.room_id && s.room_id === lessonBlock.room_id) {
      return { type: 'room_busy', message: `ห้องสอน (${lessonBlock.room_id}) ถูกใช้โดยคาบอื่นที่ ${where}` }
    }
  }

  // ── 2) teacher supervising an activity at this slot (fixed_slots.class_teachers)
  for (const fs of fixtureData.fixed_slots || []) {
    if (fs.day !== day) continue
    const periods = [fs.period, ...(fs.periods || [])]
    if (!periods.includes(period)) continue
    const supervising = new Set()
    for (const tids of Object.values(fs.class_teachers || {})) {
      for (const tid of tids || []) supervising.add(tid)
    }
    const hit = teacherIds.find((tid) => supervising.has(tid))
    if (hit) {
      return {
        type: 'teacher_supervising',
        message: `${teacherName(hit)} ต้องดูแลกิจกรรม "${fs.name}" ที่ ${where}`,
      }
    }
  }

  // ── 3) teacher unavailable / admin / no-first / no-last
  for (const tid of teacherIds) {
    const t = teacherById.get(tid)
    if (!t) continue
    if ((t.unavailable_slots || []).includes(slotKey) || (t.admin_free_slots || []).includes(slotKey)) {
      return {
        type: 'teacher_unavailable',
        message: `${teacherName(tid)} ถูกล็อกไม่ให้สอน ${where}`,
      }
    }
    if (t.no_first_period && period === 1) {
      return { type: 'teacher_unavailable', message: `${teacherName(tid)} ไม่สอนคาบแรกของวัน` }
    }
    if (t.no_last_period) {
      const last = lastStudyPeriodForClass(fixtureData, lessonBlock.class_id, day)
      if (last != null && period === last) {
        return { type: 'teacher_unavailable', message: `${teacherName(tid)} ไม่สอนคาบสุดท้ายของวัน` }
      }
    }
  }

  // ── 4) class blocked by an activity (fixed_slots.class_ids / assembly)
  for (const fs of fixtureData.fixed_slots || []) {
    if (fs.day !== day) continue
    const periods = [fs.period, ...(fs.periods || [])]
    if (!periods.includes(period)) continue
    const cids = (fs.class_ids || []).filter(
      (c) => !isSentinelAllClasses(c),
    )
    if (cids.length === 0 || cids.includes(lessonBlock.class_id)) {
      return {
        type: 'class_activity',
        message: `ห้อง ${className} มีกิจกรรม "${fs.name}" ที่ ${where}`,
      }
    }
  }

  return null
}

function isSentinelAllClasses(id) {
  return ['ทุกห้อง', 'ทุกห้องเรียน', 'ทุกชั้น', 'all', 'every'].includes(
    String(id).trim().toLowerCase(),
  )
}

/**
 * Last STUDY period of `day` for `classId` — mirrors backend
 * _get_valid_periods_for_day so no_last_period checks the same boundary the
 * solver uses (per-day schedules can end on different period numbers).
 */
function lastStudyPeriodForClass(fixtureData, classId, day) {
  const blk = (fixtureData.schedule_blocks || []).find(
    (b) => (b.target_classes || []).includes(classId),
  )
  let periods
  if (blk) {
    const dayPeriods =
      !blk.apply_to_all_days && blk.periods_by_day?.[String(day)]
        ? blk.periods_by_day[String(day)]
        : blk.periods || []
    periods = dayPeriods.filter((p) => p.type === 'STUDY').map((p) => p.period_no)
  } else {
    const cfg = fixtureData.schedule_config || {}
    const lunch = new Set(cfg.lunch_periods || [4])
    periods = Array.from({ length: cfg.periods_per_day || 8 }, (_, i) => i + 1)
      .filter((p) => !lunch.has(p))
  }
  return periods.length ? Math.max(...periods) : null
}
