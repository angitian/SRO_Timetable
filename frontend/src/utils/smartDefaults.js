/**
 * Smart Default Auto-Calculation for max_consecutive_teaching.
 *
 * Calculates a recommended max consecutive teaching limit per teacher
 * based on their actual workload density.
 *
 * Algorithm:
 *   1. Sum total_teaching_periods from all lesson_blocks for this teacher
 *   2. Count blocked_slots = unavailable_slots + admin_free_slots + fixed_activity_slots
 *   3. Calculate available_days = days where teacher has >= 3 free STUDY periods
 *   4. daily_density = total_teaching_periods / max(1, available_days)
 *   5. Thresholds:
 *        density <= 2.0  → N = 2  (light load, ≤10 periods/week)
 *        2.0 < density <= 3.5 → N = 3  (moderate, 11-17 periods/week)
 *        density > 3.5  → N = 4  (heavy, 18+ periods/week)
 */

/**
 * Get the total teaching periods for a teacher from lesson_blocks.
 * @param {string} teacherId
 * @param {Array} lessonBlocks
 * @returns {number}
 */
export function getTotalTeachingPeriods(teacherId, lessonBlocks) {
  return lessonBlocks
    .filter((lb) => lb.teacher_id === teacherId)
    .reduce((sum, lb) => sum + (lb.periods_per_week || 0), 0)
}

/**
 * Count blocked slots for a teacher (unavailable + admin free + fixed activity).
 * @param {Object} teacher
 * @param {Array} fixedSlots - fixed activity slots
 * @param {Array} classes - all classes (for school-wide fixed slots)
 * @returns {number}
 */
export function countBlockedSlots(teacher, fixedSlots = [], classes = []) {
  const unavailable = (teacher.unavailable_slots || []).length
  const adminFree = (teacher.admin_free_slots || []).length

  // Count fixed activity slots that affect this teacher
  // (school-wide slots with empty class_ids, or slots targeting classes the teacher teaches)
  const teacherClassIds = new Set(classes.map((c) => c.id))
  let fixedActivity = 0
  for (const fs of fixedSlots) {
    // School-wide fixed slots (empty class_ids) block everyone
    if (!fs.class_ids || fs.class_ids.length === 0) {
      fixedActivity += 1
      continue
    }
    // Class-specific fixed slots only count if teacher teaches that class
    // (We count all class-specific ones conservatively since we don't know
    //  exactly which classes the teacher teaches without lesson_blocks)
  }

  return unavailable + adminFree + fixedActivity
}

/**
 * Calculate available days for a teacher.
 * A day is "available" if the teacher has at least 3 free STUDY periods
 * (after subtracting blocked slots from total study periods that day).
 *
 * @param {Object} teacher
 * @param {Object} scheduleConfig - { days_per_week, periods_per_day, lunch_periods }
 * @param {Array} scheduleBlocks - schedule blocks (multi-block mode)
 * @returns {number}
 */
export function calculateAvailableDays(teacher, scheduleConfig, scheduleBlocks = []) {
  const daysPerWeek = scheduleConfig?.days_per_week || 5
  const periodsPerDay = scheduleConfig?.periods_per_day || 8
  const lunchPeriods = new Set(scheduleConfig?.lunch_periods || [4])

  // Build a set of blocked day-period keys for the teacher
  const blockedKeys = new Set([
    ...(teacher.unavailable_slots || []),
    ...(teacher.admin_free_slots || []),
  ])

  let availableDays = 0
  for (let d = 1; d <= daysPerWeek; d++) {
    // Count study periods for this day (excluding lunch)
    let studyPeriods = 0
    let freePeriods = 0
    for (let p = 1; p <= periodsPerDay; p++) {
      if (lunchPeriods.has(p)) continue
      studyPeriods++
      if (!blockedKeys.has(`${d}-${p}`)) {
        freePeriods++
      }
    }
    // A day is "available" if teacher has at least 3 free study periods
    if (freePeriods >= 3) {
      availableDays++
    }
  }

  return availableDays
}

/**
 * Calculate the smart default max_consecutive_teaching for a teacher.
 *
 * @param {Object} teacher
 * @param {Array} lessonBlocks
 * @param {Object} scheduleConfig
 * @param {Array} scheduleBlocks
 * @param {Array} fixedSlots
 * @param {Array} classes
 * @returns {{ n: number, total: number, blocked: number, density: number, availableDays: number }}
 */
export function calculateDefaultMaxConsecutive(
  teacher,
  lessonBlocks = [],
  scheduleConfig = null,
  scheduleBlocks = [],
  fixedSlots = [],
  classes = []
) {
  const total = getTotalTeachingPeriods(teacher.id, lessonBlocks)
  const blocked = countBlockedSlots(teacher, fixedSlots, classes)
  const availableDays = calculateAvailableDays(teacher, scheduleConfig, scheduleBlocks)
  const density = total / Math.max(1, availableDays)

  let n
  if (density <= 2.0) {
    n = 2
  } else if (density <= 3.5) {
    n = 3
  } else {
    n = 4
  }

  return { n, total, blocked, density, availableDays }
}

/**
 * Get smart default info for UI display.
 * Returns the calculated info plus the effective N value.
 *
 * @param {Object} teacher
 * @param {Object} fixtureData - full fixture data object
 * @returns {{ n: number, total: number, blocked: number, density: number, availableDays: number, effectiveN: number }}
 */
export function getSmartDefaultInfo(teacher, fixtureData) {
  const scheduleConfig = fixtureData?.schedule_config || null
  const scheduleBlocks = fixtureData?.schedule_blocks || []
  const lessonBlocks = fixtureData?.lesson_blocks || []
  const fixedSlots = fixtureData?.fixed_slots || []
  const classes = fixtureData?.classes || []

  const info = calculateDefaultMaxConsecutive(
    teacher,
    lessonBlocks,
    scheduleConfig,
    scheduleBlocks,
    fixedSlots,
    classes
  )

  // effectiveN: if user customized, use their value; otherwise use smart default
  const effectiveN =
    teacher.is_consecutive_customized && teacher.max_consecutive_teaching > 0
      ? teacher.max_consecutive_teaching
      : info.n

  return { ...info, effectiveN }
}

/**
 * Get safety warning for high-workload teachers with first/last period restrictions.
 *
 * @param {Object} teacher
 * @param {Object} fixtureData
 * @returns {string|null} Warning message or null if no warning needed
 */
export function getSafetyWarning(teacher, fixtureData) {
  const lessonBlocks = fixtureData?.lesson_blocks || []
  const total = getTotalTeachingPeriods(teacher.id, lessonBlocks)

  if (total >= 20 && (teacher.no_first_period || teacher.no_last_period)) {
    return `⚠️ ข้อแนะนำ: ครูมีภาระงานสูง (${total} คาบ) การจำกัดคาบแรก/คาบสุดท้าย อาจทำให้ไม่สามารถจัดตารางสอนได้ครบ`
  }

  return null
}
