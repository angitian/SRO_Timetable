/**
 * Generate periods array from block parameters.
 * Auto-calculates start_time/end_time for each period, inserting breaks between study periods.
 *
 * @param {string} startTime - HH:MM format, e.g. "08:30"
 * @param {number} periodDurationMins - e.g. 50
 * @param {number} breakDurationMins - e.g. 10
 * @param {number[]} lunchPeriodNos - 1-indexed period numbers that should be LUNCH type
 * @param {number[]} breakPeriodNos - 1-indexed period numbers that should be BREAK type
 * @returns {Array<{period_no: number, start_time: string, end_time: string, type: string}>}
 */
export function generatePeriods(startTime, periodDurationMins, breakDurationMins, lunchPeriodNos = [], breakPeriodNos = [], lunchDurationMins = 50) {
  const [startH, startM] = startTime.split(':').map(Number)
  let currentMin = startH * 60 + startM

  // We need to figure out how many periods to generate.
  // Total periods = max of lunchPeriodNos and breakPeriodNos, or at least 6
  const maxPeriod = Math.max(6, ...lunchPeriodNos, ...breakPeriodNos)
  const periods = []

  for (let p = 1; p <= maxPeriod; p++) {
    const isLunch = lunchPeriodNos.includes(p)
    const isBreak = breakPeriodNos.includes(p)
    const type = isLunch ? 'LUNCH' : isBreak ? 'BREAK' : 'STUDY'

    // LUNCH uses lunchDurationMins, BREAK uses breakDurationMins, STUDY uses periodDurationMins
    const duration = isLunch ? lunchDurationMins : (isBreak ? breakDurationMins : periodDurationMins)

    const endMin = currentMin + duration
    periods.push({
      period_no: p,
      start_time: minsToHHMM(currentMin),
      end_time: minsToHHMM(endMin),
      type,
    })

    currentMin = endMin

    // Add break after study periods (but not after the last period, lunch, or break)
    if (!isLunch && !isBreak && p < maxPeriod) {
      // Check if next period is a break/lunch — if so, don't add extra break
      const nextIsBreak = breakPeriodNos.includes(p + 1) || lunchPeriodNos.includes(p + 1)
      if (!nextIsBreak) {
        currentMin += breakDurationMins
      }
    }
  }

  return periods
}

function minsToHHMM(mins) {
  const h = Math.floor(mins / 60)
  const m = mins % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

/**
 * Create a default schedule block with auto-generated periods.
 */
export function createDefaultBlock(id, name, opts = {}) {
  const {
    startTime = '08:30',
    periodDurationMins = 50,
    breakDurationMins = 10,
    lunchDurationMins = 50,
    lunchPeriodNos = [4],
    breakPeriodNos = [],
    daysPerWeek = 5,
    targetClasses = [],
  } = opts

  return {
    id,
    name,
    target_classes: targetClasses,
    days_per_week: daysPerWeek,
    start_time: startTime,
    period_duration_mins: periodDurationMins,
    break_duration_mins: breakDurationMins,
    lunch_duration_mins: lunchDurationMins,
    apply_to_all_days: true,
    periods_by_day: {},
    periods: generatePeriods(startTime, periodDurationMins, breakDurationMins, lunchPeriodNos, breakPeriodNos, lunchDurationMins),
  }
}

/**
 * Build class -> block mapping from schedule_blocks.
 */
export function buildClassBlockMap(scheduleBlocks) {
  const map = {}
  for (const block of scheduleBlocks) {
    for (const classId of block.target_classes) {
      map[classId] = block.id
    }
  }
  return map
}
