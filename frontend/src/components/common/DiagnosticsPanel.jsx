import { PinOff } from 'lucide-react'

const DAY_NAMES = ['', 'จันทร์', 'อังคาร', 'พุธ', 'พฤหัสบดี', 'ศุกร์', 'เสาร์', 'อาทิตย์']

const REASON_LABELS = {
  teacher_unavailable: 'ครูถูกล็อก/ไม่ว่างคาบนี้ (ตรวจคาบล็อกหรือเงื่อนไขคาบแรกของครูที่หน้า 3)',
  assembly: 'ชนกิจกรรมทุกห้อง (เช่น โฮมรูม/ลูกเสือ/ชุมนุม)',
  class_blocked: 'ชนกิจกรรมเฉพาะห้องเรียนนั้น',
  lunch: 'ตรงคาบพักเที่ยง',
  no_pair_slot: 'คาบคู่ไม่มีคาบต่อเนื่องให้วาง',
  supervisor_unavailable: 'ครูผู้ดูแลกิจกรรมถูกล็อกคาบนี้ (ไปปลดล็อกครูที่หน้า 3)',
}

const OVERLOAD_REASON_LABELS = {
  over_max: (t) => `เกิน max ${t.max_periods_per_week}`,
  over_available: (t) => `ช่องว่างมีแค่ ${t.available_slots}`,
  under_min: (t) => `ต่ำกว่า min ${t.min_periods_per_week}`,
  am_pm_hard: () => 'โหมด Hard "ว่างเช้า+บ่าย": ต้องสำรองว่าง 2 คาบ/วัน — ลดภาระครู หรือเปลี่ยนเป็น Soft',
}

// Reason codes from backend UnplacedSlotInfo — ordered so the most useful
// "near-miss" explanations surface first (class_occupied is the default
// blocker and least informative).
const UNPLACED_REASON_LABELS = {
  teacher_supervising: 'ครูต้องดูแลกิจกรรมคาบนี้',
  teacher_unavailable: 'ครูถูกล็อก/ไม่ว่างคาบนี้',
  teacher_busy: 'ครูสอนคลาสอื่นคาบนี้',
  class_activity: 'ห้องมีกิจกรรม/คาบพิเศษคาบนี้',
  room_busy: 'ห้องสอนถูกใช้คาบอื่น',
  class_occupied: 'ห้องมีคาบอื่นอยู่แล้ว',
}
const UNPLACED_REASON_ORDER = [
  'teacher_supervising',
  'teacher_unavailable',
  'teacher_busy',
  'class_activity',
  'room_busy',
  'class_occupied',
]

/**
 * Shared panel rendering the backend diagnostics report in readable Thai.
 * Used by the Step-4 error card and the Step-5 error banner so every
 * blocking category (incl. fixed_slot_conflicts / room_overloads) is visible.
 *
 * Props:
 *  - diagnostics: errorResponse.diagnostics
 *  - fixtureData: for resolving lesson_block_id → subject/class names and
 *    fixed-slot ids → activity names
 *  - onUnpinConflicts(conflicts): optional — shows a button to unpin the
 *    pinned lesson slots that conflict (reason ≠ supervisor_unavailable)
 */
export default function DiagnosticsPanel({ diagnostics, fixtureData, onUnpinConflicts }) {
  if (!diagnostics) return null

  const lbs = fixtureData?.lesson_blocks || []
  const subjects = fixtureData?.subjects || []
  const classes = fixtureData?.classes || []
  const fixedSlots = fixtureData?.fixed_slots || []
  const teachers = fixtureData?.teachers || []

  const describeConflict = (c) => {
    const lb = lbs.find((b) => b.id === c.lesson_block_id)
    const dayLabel = DAY_NAMES[c.day] || `วัน${c.day}`
    const where = `${dayLabel} คาบ${c.period}`
    const reason = REASON_LABELS[c.reason] || c.reason
    if (lb) {
      const subjName = subjects.find((s) => s.id === lb.subject_id)?.name || lb.subject_id
      const className = classes.find((k) => k.id === lb.class_id)?.name || lb.class_id
      const tName = teachers.find((t) => t.id === lb.teacher_id)?.name || ''
      return `${subjName} (${className}${tName ? `, ${tName}` : ''}) — ${where}: ${reason}`
    }
    const fs = fixedSlots.find((f) => f.id === c.lesson_block_id)
    if (fs) {
      return `กิจกรรม ${fs.name} — ${where}: ${reason}`
    }
    return `${c.lesson_block_id} — ${where}: ${reason}`
  }

  // Conflicts that can be resolved by unpinning a pinned lesson slot —
  // supervisor_unavailable refers to a fixed activity, not a pinned lesson.
  const unpinnable = (diagnostics.fixed_slot_conflicts || []).filter(
    (c) => c.reason !== 'supervisor_unavailable',
  )

  const sections = [
    {
      key: 'class_capacity_issues',
      title: 'ห้องที่คาบเรียนเกินช่องว่าง:',
      items: (diagnostics.class_capacity_issues || []).map((c) => ({
        id: c.class_id,
        text: `${c.class_name}: ${c.needed_periods}/${c.available_slots} คาบ (เกิน ${c.overflow} คาบ)`,
      })),
    },
    {
      key: 'teacher_overloads',
      title: 'ครูที่ภาระงานเกินขีดจำกัด:',
      items: (diagnostics.teacher_overloads || []).map((t) => ({
        id: t.teacher_id,
        text: `${t.teacher_name}: ต้องสอน ${t.needed_periods} คาบ (${(OVERLOAD_REASON_LABELS[t.reason] || ((x) => x.reason))(t)})`,
      })),
    },
    {
      key: 'room_overloads',
      title: 'ห้องเฉพาะที่ไม่พอ:',
      items: (diagnostics.room_overloads || []).map((r) => ({
        id: r.room_id,
        text: `${r.room_name}: ต้องใช้ ${r.needed_periods} คาบ (ช่องว่าง ${r.available_slots})`,
      })),
    },
    {
      key: 'fixed_slot_conflicts',
      title: 'คาบที่ปักหมุด/ล็อกไว้ขัดกับข้อจำกัด:',
      items: (diagnostics.fixed_slot_conflicts || []).map((c, i) => ({
        id: `fc-${i}`,
        text: describeConflict(c),
      })),
    },
    {
      key: 'hard_rule_issues',
      title: 'เงื่อนไข Hard ที่จัดไม่ได้:',
      items: (diagnostics.hard_rule_issues || []).map((h, i) => ({ id: `hr-${i}`, text: h })),
    },
  ].filter((s) => s.items.length > 0)

  // Unplaced lesson blocks — each entry explains which candidate slots were
  // rejected and why. Prefer "near-miss" slots (blocked by something other
  // than class_occupied) since those reveal the real constraint.
  const unplacedItems = (diagnostics.unplaced_blocks || []).map((ub) => {
    const lb = lbs.find((b) => b.id === ub.lesson_block_id)
    const subjName = lb ? subjects.find((s) => s.id === lb.subject_id)?.name || lb.subject_id : ub.lesson_block_id
    const className = lb ? classes.find((c) => c.id === lb.class_id)?.name || lb.class_id : ''
    const tName = lb ? teachers.find((t) => t.id === lb.teacher_id)?.name || '' : ''
    const title = `${subjName}${className ? ` (${className}${tName ? `, ${tName}` : ''})` : ''} — เหลือ ${ub.missing_periods} คาบ`

    const fmtSlot = (s) => `${DAY_NAMES[s.day] || `วัน${s.day}`} คาบ${s.period}`
    const lines = []
    if (ub.open_slots?.length) {
      lines.push(`ช่องว่างที่ถูกกฎ (วางเองได้): ${ub.open_slots.slice(0, 8).map(fmtSlot).join(', ')}`)
    }
    // Surface near-misses first: slots blocked by a reason other than
    // class_occupied explain the actual constraint.
    const interesting = (ub.blocked_slots || [])
      .filter((s) => s.reasons?.some((r) => r !== 'class_occupied'))
      .slice(0, 6)
    for (const s of interesting) {
      const ordered = [...(s.reasons || [])].sort(
        (a, b) => UNPLACED_REASON_ORDER.indexOf(a) - UNPLACED_REASON_ORDER.indexOf(b),
      )
      const label = ordered.map((r) => UNPLACED_REASON_LABELS[r] || r).join(' + ')
      lines.push(`${fmtSlot(s)} — ${label}`)
    }
    if (!ub.open_slots?.length && !interesting.length) {
      lines.push('ไม่มีช่องว่างที่ถูกกฎเลย — ต้องลดคาบหรือผ่อนข้อจำกัด')
    } else if (!ub.open_slots?.length) {
      lines.push('(ช่องอื่นที่เหลือติดคาบเรียนของห้องอยู่แล้วทั้งหมด)')
    }
    return { id: ub.lesson_block_id, title, lines }
  })

  if (!sections.length && !unplacedItems.length && !(diagnostics.notes || []).length) return null

  return (
    <div className="space-y-2 mt-2 text-xs">
      {sections.map((s) => (
        <div key={s.key}>
          <div className="font-semibold underline">{s.title}</div>
          <ul className="list-disc pl-5 mt-1 space-y-0.5">
            {s.items.map((it) => <li key={it.id}>{it.text}</li>)}
          </ul>
        </div>
      ))}
      {unplacedItems.length > 0 && (
        <div>
          <div className="font-semibold underline">คาบที่วางไม่ได้ (เหตุผลรายช่อง):</div>
          <div className="mt-1 space-y-1.5">
            {unplacedItems.map((u) => (
              <div key={u.id}>
                <div className="font-medium">{u.title}</div>
                <ul className="list-disc pl-5 space-y-0.5">
                  {u.lines.map((l, i) => <li key={i}>{l}</li>)}
                </ul>
              </div>
            ))}
          </div>
        </div>
      )}
      {onUnpinConflicts && unpinnable.length > 0 && (
        <button
          onClick={() => onUnpinConflicts(unpinnable)}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold
            bg-purple-600 text-white hover:bg-purple-700 transition-colors"
          title="เอาคาบที่ปักหมุดขัดกับข้อจำกัดออก แล้วจัดตารางใหม่"
        >
          <PinOff className="w-3.5 h-3.5" />
          ปลดปักหมุด {unpinnable.length} คาบที่ขัดแย้ง
        </button>
      )}
      {(diagnostics.notes || []).length > 0 && (
        <div className="italic text-gray-600">
          {diagnostics.notes.map((n, i) => <div key={i}>{n}</div>)}
        </div>
      )}
    </div>
  )
}
