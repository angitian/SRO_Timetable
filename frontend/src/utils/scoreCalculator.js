/**
 * Timetable Quality Scoring Engine
 *
 * Calculates a 0-100 quality score for a generated timetable based on
 * 3 penalty criteria (deductions from a starting score of 100).
 *
 * Penalties:
 *   1. Teacher Idle Gaps          : -2  points per idle period between first/last teaching period of a day
 *   2. Teacher Consecutive Overload: -3  points per occurrence of 4+ consecutive teaching periods (lunch breaks the run)
 *   3. Afternoon Heavy Subjects    : -1.5 points per heavy subject placed in the last period of the day
 *
 * Pure frontend computation — no API calls needed.
 */

// Heavy subject keywords (Thai). Matched case-insensitively against subject name.
const HEAVY_SUBJECT_KEYWORDS = [
  'คณิต',
  'วิทย์',
  'วิทยาศาสตร์',
  'อังกฤษ',
  'ภาษาอังกฤษ',
]

/**
 * Check whether a subject is "heavy" (requires high concentration).
 * Uses both the `is_heavy` flag from backend AND keyword matching on Thai names.
 *
 * @param {Object} subject - subject object { id, name, is_heavy?, category? }
 * @returns {boolean}
 */
export function isHeavySubject(subject) {
  if (!subject) return false
  if (subject.is_heavy === true) return true
  const name = (subject.name || '').toLowerCase()
  return HEAVY_SUBJECT_KEYWORDS.some((kw) => name.includes(kw.toLowerCase()))
}

/**
 * Build a map of teacher_id -> Set of "day-period" keys where the teacher is teaching.
 * Combines solver-placed slots and user manual placements (resolved via lesson_blocks).
 *
 * @param {Array} slots - solver result slots [{ teacher_id, day, period, ... }]
 * @param {Object} userPlacements - { [lesson_block_id]: [{ day, period }] }
 * @param {Array} lessonBlocks - to resolve teacher_id from lesson_block_id
 * @returns {Map<string, Set<string>>} teacherId -> Set("day-period")
 */
function buildTeacherDayPeriodMap(slots, userPlacements, lessonBlocks) {
  const lbMap = new Map((lessonBlocks || []).map((lb) => [lb.id, lb]))
  const teacherMap = new Map()

  function addSlot(teacherId, day, period) {
    if (!teacherId) return
    const key = `${day}-${period}`
    if (!teacherMap.has(teacherId)) teacherMap.set(teacherId, new Set())
    teacherMap.get(teacherId).add(key)
  }

  for (const s of slots || []) {
    addSlot(s.teacher_id, s.day, s.period)
  }
  for (const [lbId, placements] of Object.entries(userPlacements || {})) {
    const lb = lbMap.get(lbId)
    if (!lb) continue
    for (const p of placements) {
      addSlot(lb.teacher_id, p.day, p.period)
    }
  }
  return teacherMap
}

/**
 * Build a map of (day, period) -> subject_id for all placed slots (solver + user).
 * Used to detect heavy subjects in the last period of the day.
 *
 * @param {Array} slots
 * @param {Object} userPlacements
 * @param {Array} lessonBlocks
 * @returns {Map<string, string>} "day-period" -> subject_id
 */
function buildDayPeriodSubjectMap(slots, userPlacements, lessonBlocks) {
  const lbMap = new Map((lessonBlocks || []).map((lb) => [lb.id, lb]))
  const map = new Map()

  function addSlot(day, period, subjectId) {
    if (!subjectId) return
    map.set(`${day}-${period}`, subjectId)
  }

  for (const s of slots || []) {
    addSlot(s.day, s.period, s.subject_id)
  }
  for (const [lbId, placements] of Object.entries(userPlacements || {})) {
    const lb = lbMap.get(lbId)
    if (!lb) continue
    for (const p of placements) {
      addSlot(p.day, p.period, lb.subject_id)
    }
  }
  return map
}

/**
 * Get the sorted list of valid STUDY periods for a given day.
 * Excludes lunch periods.
 *
 * @param {number} day
 * @param {Object} gridConfig - { periodsPerDay, lunchPeriods: number[], daysPerWeek }
 * @returns {number[]}
 */
function getStudyPeriodsForDay(day, gridConfig) {
  const lunchSet = new Set(gridConfig?.lunchPeriods || [])
  const maxPeriod = gridConfig?.periodsPerDay || 7
  const periods = []
  for (let p = 1; p <= maxPeriod; p++) {
    if (!lunchSet.has(p)) periods.push(p)
  }
  return periods
}

/**
 * Calculate teacher idle gaps: number of empty STUDY periods between
 * the first and last teaching period of each day, for each teacher.
 *
 * @param {Map<string, Set<string>>} teacherDayPeriodMap
 * @param {Object} gridConfig
 * @returns {number} total idle gap count across all teachers and days
 */
function calcTeacherGaps(teacherDayPeriodMap, gridConfig) {
  const daysPerWeek = gridConfig?.daysPerWeek || 5
  let totalGaps = 0

  for (const [teacherId, slotKeys] of teacherDayPeriodMap) {
    for (let d = 1; d <= daysPerWeek; d++) {
      const studyPeriods = getStudyPeriodsForDay(d, gridConfig)
      if (studyPeriods.length === 0) continue

      // Find which study periods this teacher is teaching on day d
      const teachingPeriods = studyPeriods.filter((p) => slotKeys.has(`${d}-${p}`))
      if (teachingPeriods.length < 2) continue // no gap possible with 0 or 1 period

      const firstP = teachingPeriods[0]
      const lastP = teachingPeriods[teachingPeriods.length - 1]

      // Count study periods between first and last that are NOT taught
      for (const p of studyPeriods) {
        if (p <= firstP || p >= lastP) continue
        if (!slotKeys.has(`${d}-${p}`)) {
          totalGaps += 1
        }
      }
    }
  }
  return totalGaps
}

/**
 * Calculate teacher consecutive overload: count occurrences where a teacher
 * teaches more than MAX_CONSECUTIVE consecutive STUDY periods in a day
 * (lunch breaks the run).
 *
 * The threshold is mode-aware:
 *   - Fast / Balanced: MAX_CONSECUTIVE = 3 (penalize 4+)
 *   - Deep:            MAX_CONSECUTIVE = 4 (penalize 5+)
 * Deep mode intentionally clusters periods to reduce idle gaps, so teaching
 * 4 consecutive periods is acceptable and should not be penalized.
 *
 * @param {Map<string, Set<string>>} teacherDayPeriodMap
 * @param {Object} gridConfig
 * @param {string} mode - solver preset id ('fast' | 'balanced' | 'deep' | 'custom')
 * @returns {number} total overload occurrence count
 */
function calcTeacherConsecutiveOverload(teacherDayPeriodMap, gridConfig, mode) {
  const daysPerWeek = gridConfig?.daysPerWeek || 5
  const MAX_CONSECUTIVE = mode === 'deep' ? 4 : 3 // threshold: more than N = overload
  let totalOverload = 0

  for (const [teacherId, slotKeys] of teacherDayPeriodMap) {
    for (let d = 1; d <= daysPerWeek; d++) {
      const studyPeriods = getStudyPeriodsForDay(d, gridConfig)
      if (studyPeriods.length === 0) continue

      // Walk through study periods in order, tracking consecutive teaching run.
      // Lunch periods naturally break the run since they're excluded from studyPeriods.
      let currentRun = 0
      for (const p of studyPeriods) {
        if (slotKeys.has(`${d}-${p}`)) {
          currentRun += 1
        } else {
          // End of a run — count overload occurrences
          if (currentRun > MAX_CONSECUTIVE) {
            // Each "excess" period beyond the threshold counts as one overload occurrence.
            // e.g. a run of 5 = 2 occurrences (5 - 3 = 2)
            totalOverload += currentRun - MAX_CONSECUTIVE
          }
          currentRun = 0
        }
      }
      // Handle run that extends to the last study period of the day
      if (currentRun > MAX_CONSECUTIVE) {
        totalOverload += currentRun - MAX_CONSECUTIVE
      }
    }
  }
  return totalOverload
}

/**
 * Calculate afternoon heavy subjects: count heavy subjects placed in the
 * last STUDY period of the day, across all days.
 *
 * @param {Map<string, string>} dayPeriodSubjectMap - "day-period" -> subject_id
 * @param {Array} subjects - subject list [{ id, name, is_heavy? }]
 * @param {Object} gridConfig
 * @returns {number} total count of heavy subjects in last period
 */
function calcAfternoonHeavy(dayPeriodSubjectMap, subjects, gridConfig) {
  const daysPerWeek = gridConfig?.daysPerWeek || 5
  const subjectMap = new Map((subjects || []).map((s) => [s.id, s]))
  let totalHeavy = 0

  for (let d = 1; d <= daysPerWeek; d++) {
    const studyPeriods = getStudyPeriodsForDay(d, gridConfig)
    if (studyPeriods.length === 0) continue
    const lastPeriod = studyPeriods[studyPeriods.length - 1]
    const subjectId = dayPeriodSubjectMap.get(`${d}-${lastPeriod}`)
    if (!subjectId) continue
    const subject = subjectMap.get(subjectId)
    if (isHeavySubject(subject)) {
      totalHeavy += 1
    }
  }
  return totalHeavy
}

/**
 * Calculate the overall timetable quality score (0-100).
 *
 * @param {Object} params
 * @param {Array}  params.slots         - solver result slots
 * @param {Object} params.userPlacements - { [lesson_block_id]: [{ day, period }] }
 * @param {Array}  params.teachers      - teacher list
 * @param {Array}  params.classes       - class list
 * @param {Array}  params.subjects      - subject list
 * @param {Array}  params.lessonBlocks  - lesson block list
 * @param {Object} params.gridConfig    - { periodsPerDay, lunchPeriods, daysPerWeek }
 * @param {string} [params.mode]        - solver preset id ('fast' | 'balanced' | 'deep' | 'custom')
 * @returns {{ totalScore: number, level: string, levelLabel: string, breakdown: Object }}
 */
export function calculateTimetableQualityScore({
  slots = [],
  userPlacements = {},
  teachers = [],
  classes = [],
  subjects = [],
  lessonBlocks = [],
  gridConfig = { periodsPerDay: 7, lunchPeriods: [4], daysPerWeek: 5 },
  mode = 'balanced',
}) {
  // Build derived maps once
  const teacherDayPeriodMap = buildTeacherDayPeriodMap(slots, userPlacements, lessonBlocks)
  const dayPeriodSubjectMap = buildDayPeriodSubjectMap(slots, userPlacements, lessonBlocks)

  // Compute each penalty criterion
  const gapCount = calcTeacherGaps(teacherDayPeriodMap, gridConfig)
  const overloadCount = calcTeacherConsecutiveOverload(teacherDayPeriodMap, gridConfig, mode)
  const heavyCount = calcAfternoonHeavy(dayPeriodSubjectMap, subjects, gridConfig)

  const gapPenalty = gapCount * 2
  const overloadPenalty = overloadCount * 3
  const heavyPenalty = heavyCount * 1.5

  const totalPenalty = gapPenalty + overloadPenalty + heavyPenalty
  const totalScore = Math.max(0, Math.min(100, Math.round(100 - totalPenalty)))

  const level = totalScore >= 90 ? 'excellent' : totalScore >= 75 ? 'good' : 'fair'
  const levelLabel = totalScore >= 90 ? 'ดีเยี่ยม' : totalScore >= 75 ? 'ดี' : 'พอใช้'

  return {
    totalScore,
    level,
    levelLabel,
    breakdown: {
      teacherGaps: { count: gapCount, penalty: gapPenalty },
      teacherConsecutiveOverload: { count: overloadCount, penalty: overloadPenalty },
      afternoonHeavy: { count: heavyCount, penalty: heavyPenalty },
    },
  }
}

// ── Solver Presets ──────────────────────────────────────────────────────────

export const SOLVER_PRESETS = {
  FAST: {
    id: 'fast',
    icon: '⚡',
    name: 'เร็ว (Fast)',
    shortName: 'เร็ว',
    timeLimit: 15,
    description: 'ใช้เวลา ~15 วินาที เน้นได้ตารางครบ ไม่คำนึงถึงการเกลี่ยคาบ',
    optimizeGaps: false,
  },
  BALANCED: {
    id: 'balanced',
    icon: '🎯',
    name: 'สมดุล (Balanced)',
    shortName: 'สมดุล',
    timeLimit: 60,
    description: 'ใช้เวลา ~60 วินาที แนะนำ: ตารางสมดุล ลดคาบว่างครู',
    optimizeGaps: true,
  },
  DEEP: {
    id: 'deep',
    icon: '💎',
    name: 'ประณีต (Deep)',
    shortName: 'ประณีต',
    timeLimit: 120,
    description: 'ใช้เวลา ~2 นาที คุณภาพสูงสุด เหมาะกับตารางที่ช่องว่างน้อย (คาบพิเศษล็อกเยอะ)',
    optimizeGaps: true,
  },
  CUSTOM: {
    id: 'custom',
    icon: '⏱️',
    name: 'กำหนดเวลาเอง (Custom)',
    shortName: 'กำหนดเอง',
    timeLimit: 60,
    description: 'ปรับเวลาเอง 15–600 วินาที + เลือกโหมด สมดุล/ประณีต (สำหรับโรงเรียนใหญ่ เงื่อนไขเยอะ)',
    optimizeGaps: true,
  },
}

/**
 * Get the preset object by id.
 * @param {string} id - preset id ('fast' | 'balanced' | 'deep' | 'custom')
 * @returns {Object} preset object
 */
export function getPreset(id) {
  const key = (id || 'balanced').toUpperCase()
  return SOLVER_PRESETS[key] || SOLVER_PRESETS.BALANCED
}

// Limits for the "กำหนดเวลาเอง" preset (must stay within the backend cap,
// models.py: solver_time_limit_seconds le=600).
export const CUSTOM_TIME_MIN = 15
export const CUSTOM_TIME_MAX = 600
export const CUSTOM_TIME_STEP = 15

/**
 * Resolve the effective time limit and optimization mode for a given preset.
 *
 * @param {string} presetId - 'fast' | 'balanced' | 'deep' | 'custom'
 * @param {number} [customTimeLimit] - seconds, only used when presetId === 'custom'
 * @param {string} [customMode] - 'BALANCED' | 'DEEP', only when presetId === 'custom'
 * @returns {{ timeLimitSeconds: number, optimizationMode: 'BALANCED'|'DEEP' }}
 */
export function resolveSolverParams(presetId, customTimeLimit, customMode) {
  if (presetId === 'custom') {
    const t = Number(customTimeLimit)
    const timeLimitSeconds = Number.isFinite(t)
      ? Math.min(CUSTOM_TIME_MAX, Math.max(CUSTOM_TIME_MIN, t))
      : CUSTOM_TIME_MIN
    return {
      timeLimitSeconds,
      optimizationMode: customMode === 'DEEP' ? 'DEEP' : 'BALANCED',
    }
  }
  const preset = getPreset(presetId)
  const timeLimitSeconds = preset.timeLimit
  // 'fast' preset intentionally uses BALANCED mode: backend FAST stops at the
  // first feasible solution which may leave periods unplaced on dense data
  // (period count is a soft constraint), while BALANCED keeps optimizing.
  const optimizationMode =
    preset.id === 'deep' ? 'DEEP'
    : 'BALANCED'
  return { timeLimitSeconds, optimizationMode }
}
