export function createPeriodLabelMap(periods = [], {
  lunchPeriods = [],
  breakPeriods = [],
} = {}) {
  const lunchSet = new Set(lunchPeriods)
  const breakSet = new Set(breakPeriods)
  const normalized = new Map()
  for (const period of periods) {
    const entry = typeof period === 'number'
      ? { periodNo: period, type: '' }
      : {
          periodNo: period.period_no ?? period.period_num,
          type: String(period.type ?? period.period_type ?? '').toUpperCase(),
        }
    if (!Number.isFinite(entry.periodNo)) continue
    const current = normalized.get(entry.periodNo)
    const priority = (type) => type === 'LUNCH' ? 2 : type === 'BREAK' ? 1 : 0
    if (!current || priority(entry.type) > priority(current.type)) {
      normalized.set(entry.periodNo, entry)
    }
  }
  const ordered = [...normalized.values()]
    .map((period) => {
      const isLunch = period.type === 'LUNCH' || lunchSet.has(period.periodNo)
      const isBreak = !isLunch && (period.type === 'BREAK' || breakSet.has(period.periodNo))
      return {
        ...period,
        type: isLunch ? 'LUNCH' : isBreak ? 'BREAK' : 'STUDY',
      }
    })
    .sort((a, b) => a.periodNo - b.periodNo)

  const labels = new Map()
  let studyNumber = 0
  for (const { periodNo, type } of ordered) {
    const label = type === 'LUNCH' ? 'พักเที่ยง' : type === 'BREAK' ? 'พัก' : String(++studyNumber)
    labels.set(periodNo, label)
  }
  return labels
}

export function getPeriodDisplayLabel(periodNo, labelMap) {
  return labelMap?.get(periodNo) ?? periodNo
}
