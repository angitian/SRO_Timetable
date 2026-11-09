/**
 * Daily period strip for a teacher / trainee candidate.
 *
 * Green  = teaching (or already substituting)
 * Sky    = supervising a fixed activity
 * Dashed = mentor is absent (trainee is free to cover)
 * Gray   = free
 * ▲      = the substitute period currently selected
 */
import { computePeriodAdjacency, describeAdjacency, unionPeriods } from '../../utils/traineeTimetable.js'
import { createPeriodLabelMap } from '../../utils/periodLabels.js'

export default function DayLoadStrip({
  periods = [],
  teaching,
  duty,
  substitute,
  mentorAbsent,
  markerPeriod = null,
  markerDetail = null,
  periodDetails,
  halves,
}) {
  const blocks = (periods || []).filter((p) => p && p.type !== 'BREAK')
  if (blocks.length === 0) return null
  const periodLabelMap = createPeriodLabelMap(periods)

  const busy = unionPeriods(teaching, duty, substitute)
  const adjacency = computePeriodAdjacency({ periods, markerPeriod, busy, halves })

  return (
    <div className="w-full space-y-0.5">
      <div className="flex w-full items-end gap-1">
        {blocks.map((p) => {
          if (p.type === 'LUNCH') {
            return (
              <div
                key={`lunch-${p.period_no}`}
                className="flex min-w-[48px] flex-[0.7] flex-col items-center gap-0.5"
                title="พักเที่ยง"
                aria-label="พักเที่ยง"
              >
                <span className="text-[9px] leading-tight text-center text-slate-500 break-words">พักเที่ยง</span>
                <div
                  className="h-6 w-full rounded-sm border border-slate-200"
                  style={{ backgroundImage: 'repeating-linear-gradient(135deg, #e2e8f0 0, #e2e8f0 4px, #f8fafc 4px, #f8fafc 8px)' }}
                />
              </div>
            )
          }
          const isTeaching = !!teaching?.has?.(p.period_no)
          const isDuty = !!duty?.has?.(p.period_no)
          const isSubstitute = !!substitute?.has?.(p.period_no)
          const isMentorAbsent = !!mentorAbsent?.has?.(p.period_no)
          const isMarker = markerPeriod != null && p.period_no === markerPeriod
          const state = isTeaching
            ? 'มีสอน'
            : isSubstitute
              ? 'รับสอนแทน'
              : isDuty
                ? 'ดูแลกิจกรรม'
                : isMentorAbsent
                  ? 'ครูพี่เลี้ยงลา'
                  : 'ว่าง'
          const cls = (isTeaching || isSubstitute)
            ? 'bg-emerald-500'
            : isDuty
              ? 'bg-sky-400'
              : isMentorAbsent
                ? 'bg-emerald-100 border border-dashed border-emerald-500'
                : 'bg-slate-100'
          const details = periodDetails?.get?.(p.period_no) || []
          const tooltipLines = [
            `คาบ ${periodLabelMap.get(p.period_no) ?? p.period_no} · ${state}`,
            ...details.flatMap((detail) => [
              detail.subjectName ? `วิชา: ${detail.subjectName}` : '',
              detail.className ? `ชั้น/ห้องเรียน: ${detail.className}` : '',
              detail.roomName ? `ห้องที่ใช้สอน: ${detail.roomName}` : '',
            ]).filter(Boolean),
            isMarker && markerDetail
              ? `สอนแทนที่เลือก: ${[
                  markerDetail.subjectName,
                  markerDetail.className,
                  markerDetail.roomName,
                ].filter(Boolean).join(' · ')}`
              : '',
          ].filter(Boolean)
          return (
            <div
              key={p.period_no}
              className="flex min-w-[16px] flex-1 flex-col items-center gap-0.5"
              title={tooltipLines.join('\n')}
            >
              <span className={`text-[10px] leading-none ${isMarker ? 'text-orange-600 font-bold' : 'text-slate-400'}`}>
                {isMarker ? '▲' : periodLabelMap.get(p.period_no) ?? p.period_no}
              </span>
              <div
                className={`relative h-6 w-full rounded-sm ${cls}
                  ${isSubstitute ? 'ring-1 ring-orange-400' : ''}
                  ${isMarker ? 'ring-2 ring-orange-500 ring-offset-1' : ''}`}
              >
                {isSubstitute && !isMarker && (
                  <span className="absolute inset-0 flex items-center justify-center text-[10px] font-bold text-white">•</span>
                )}
              </div>
            </div>
          )
        })}
      </div>
      {markerPeriod != null && (
        <div className="text-[10px] text-slate-500">
          คาบที่เลือก <b className="text-orange-600">{periodLabelMap.get(markerPeriod) ?? markerPeriod}</b>
          {' · '}
          {describeAdjacency(adjacency)}
        </div>
      )}
    </div>
  )
}

export function DayLoadLegend() {
  const items = [
    ['bg-emerald-500', 'มีสอน'],
    ['bg-sky-400', 'ดูแลกิจกรรม'],
    ['bg-emerald-100 border border-dashed border-emerald-500', 'ครูพี่เลี้ยงลา'],
    ['bg-slate-100', 'ว่าง'],
  ]
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-slate-500">
      {items.map(([cls, label]) => (
        <span key={label} className="inline-flex items-center gap-1">
          <span className={`w-3 h-3 rounded-sm ${cls}`} />
          {label}
        </span>
      ))}
      <span className="inline-flex items-center gap-1">
        <span className="text-orange-600 font-bold">▲</span> คาบที่เลือก
      </span>
      <span className="inline-flex items-center gap-1">
        <span className="w-3 h-3 rounded-sm bg-emerald-500 ring-1 ring-orange-400" /> รับแทนแล้ว
      </span>
      <span className="text-slate-400">ชี้ที่แถบคาบเพื่อดูวิชาและห้อง</span>
    </div>
  )
}
