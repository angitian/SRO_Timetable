import { getPlacementBlockReason, checkResultAgainstLocks } from './src/utils/teacherLoad.js'

const fixtureData = {
  teachers: [
    { id: 'T1', name: 'ครูหนึ่ง', unavailable_slots: ['4-7'], admin_free_slots: [] },
    { id: 'T2', name: 'ครูสอง', unavailable_slots: [], admin_free_slots: [] },
  ],
  subjects: [{ id: 'S1', name: 'คณิต' }, { id: 'S2', name: 'ไทย' }],
  classes: [{ id: 'C1', name: 'ป.2/2' }, { id: 'C2', name: 'ป.2/1' }],
  lesson_blocks: [
    { id: 'LB1', subject_id: 'S1', class_id: 'C1', teacher_id: 'T1', room_id: 'R1', periods_per_week: 1 },
    { id: 'LB2', subject_id: 'S2', class_id: 'C2', teacher_id: 'T2', periods_per_week: 1 },
  ],
  fixed_slots: [
    { id: 'F1', day: 2, period: 7, name: 'ศักยภาพ', class_ids: [], class_teachers: { C1: ['T1'] } },
    { id: 'F2', day: 3, period: 6, name: 'ลูกเสือ', class_ids: ['C1'], class_teachers: {} },
  ],
  schedule_config: { days_per_week: 5, periods_per_day: 8, lunch_periods: [4] },
}
const lb1 = fixtureData.lesson_blocks[0]
const ctx = { resultSlots: [], userPlacements: {}, fixtureData }

let pass = 0, fail = 0
const check = (name, cond) => { cond ? pass++ : (fail++, console.log('FAIL:', name)) }

let r = getPlacementBlockReason(lb1, 2, 7, ctx)
check('supervising blocked', r?.type === 'teacher_supervising')
r = getPlacementBlockReason(lb1, 3, 6, ctx)
check('class activity blocked', r?.type === 'class_activity')
r = getPlacementBlockReason(lb1, 4, 7, ctx)
check('locked slot blocked', r?.type === 'teacher_unavailable')
r = getPlacementBlockReason(lb1, 1, 1, ctx)
check('free slot allowed', r === null)
const ctx2 = { ...ctx, resultSlots: [{ lesson_block_id: 'LB2', teacher_id: 'T1', day: 5, period: 3, class_id: 'C2', room_id: 'R2' }] }
r = getPlacementBlockReason(lb1, 5, 3, ctx2)
check('teacher busy blocked', r?.type === 'teacher_busy')
const ctx3 = { ...ctx, resultSlots: [{ lesson_block_id: 'LB2', teacher_id: 'T2', day: 5, period: 4, class_id: 'C1', room_id: 'R9' }] }
r = getPlacementBlockReason(lb1, 5, 4, ctx3)
check('class occupied blocked', r?.type === 'class_occupied')
const ctx4 = { ...ctx, userPlacements: { LB2: [{ day: 1, period: 2 }] } }
r = getPlacementBlockReason(lb1, 1, 2, ctx4)
check('other-teacher pin ok', r === null)
const res = { slots: [], metrics: { status: 'OPTIMAL' } }
let viol = checkResultAgainstLocks(res, fixtureData, { LB1: [{ day: 4, period: 7 }] })
check('manual pin violation detected', viol.length === 1 && viol[0].teacherName === 'ครูหนึ่ง')
viol = checkResultAgainstLocks({ slots: [{ lesson_block_id: 'LB1', teacher_id: 'T1', day: 4, period: 7, class_id: 'C1' }], metrics: {} }, fixtureData)
check('solver slot violation detected', viol.length === 1)
viol = checkResultAgainstLocks({ slots: [{ lesson_block_id: 'LB1', teacher_id: 'T1', day: 1, period: 1, class_id: 'C1' }], metrics: {} }, fixtureData)
check('clean result no violation', viol.length === 0)

console.log(`${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
