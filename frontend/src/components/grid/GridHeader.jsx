import { createPeriodLabelMap, getPeriodDisplayLabel } from '../../utils/periodLabels.js'

/**
 * Reusable timetable grid header row.
 *
 * Renders the "วัน \ คาบ" corner cell and one header cell per period,
 * with lunch/break periods styled distinctly.
 *
 * Props:
 *   - periodList: number[] — period numbers to render (supports decimals for breaks)
 *   - periodColsTemplate: string — CSS grid template for period columns
 *   - lunchSet: Set<number> — lunch period numbers
 *   - breakSet: Set<number> — break period numbers
 */
export default function GridHeader({
  periodList,
  periodColsTemplate,
  lunchSet,
  breakSet,
  periodLabelMap,
}) {
  const labelMap = periodLabelMap || createPeriodLabelMap(periodList, {
    lunchPeriods: lunchSet,
    breakPeriods: breakSet,
  })
  return (
    <div
      className="grid gap-2.5 mb-2"
      style={{ gridTemplateColumns: `100px ${periodColsTemplate}` }}
    >
      <div className="text-xs font-bold text-gray-400 flex items-center justify-center">
        วัน \ คาบ
      </div>
      {periodList.map((p) => {
        const isLunch = lunchSet.has(p)
        const isBreak = breakSet.has(p)
        const label = getPeriodDisplayLabel(p, labelMap)
        const bgClass = isLunch
          ? 'bg-gray-200 text-gray-400'
          : isBreak
          ? 'bg-gray-100 text-gray-400'
          : 'text-gray-700'
        return (
          <div
            key={p}
            className={`text-center text-base font-bold py-2 rounded leading-tight ${isLunch ? 'min-w-[48px] break-words' : ''} ${bgClass}`}
          >
            {label}
          </div>
        )
      })}
    </div>
  )
}
