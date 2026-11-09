import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildTraineeIndex,
  computePeriodAdjacency,
  dayTeachingCount,
  describeAdjacency,
  isTraineeMentorAbsent,
  normalizePersonName,
  traineeHasMentor,
  traineeMatchesSlot,
  traineesForSlot,
  unionPeriods,
} from './src/utils/traineeTimetable.js'
import {
  getDayPeriodList,
  getSlotDisplayDetails,
  buildDailyGrid,
  normalizeDailySchedule,
  substituteDisplayName,
  substitutePerson,
} from './src/features/substitute/dailySchedule.js'
import { buildStatsRows } from './src/features/substitute/substituteStats.js'

const teachers = [
  { id: 'T1', name: 'ครูสมชาย' },
  { id: 'T2', name: 'ครูสมหญิง' },
]
const classes = [{ id: 'C1', name: 'ป.1/1' }, { id: 'C2', name: 'ป.1/2' }]
const subjects = [{ id: 'S1', name: 'ภาษาไทย' }, { id: 'S2', name: 'คณิตศาสตร์' }]
const teacherMap = new Map(teachers.map((t) => [t.id, t]))
const classMap = new Map(classes.map((c) => [c.id, c]))
const subjectMap = new Map(subjects.map((s) => [s.id, s]))
const lessonBlockMap = new Map([
  ['LB1', { id: 'LB1', teacher_id: 'T1', co_teacher_id: 'T2' }],
  ['LB2', { id: 'LB2', teacher_id: 'T2', co_teacher_id: null }],
])
const ctx = { teacherMap, classMap, subjectMap, lessonBlockMap }

const slotMain = {
  lesson_block_id: 'LB1', day: 1, period: 2,
  teacher_id: 'T1', class_id: 'C1', subject_id: 'S1',
}
const slotCo = { ...slotMain }
const slotOther = {
  lesson_block_id: 'LB2', day: 1, period: 3,
  teacher_id: 'T2', class_id: 'C2', subject_id: 'S2',
}

function trainee(overrides = {}) {
  return {
    id: 'tr1',
    name: 'นางสาวทดสอบ',
    mentorTeacherId: 'T1',
    mentorNames: ['ครูสมชาย'],
    assignments: [
      { subjectId: 'S1', subjectName: 'ภาษาไทย', classId: 'C1', className: 'ป.1/1' },
    ],
    archived: false,
    ...overrides,
  }
}

test('normalizePersonName strips common Thai prefixes', () => {
  assert.equal(normalizePersonName('ครูสมชาย'), 'สมชาย')
  assert.equal(normalizePersonName('นางสาว ทดสอบ'), 'ทดสอบ')
  assert.equal(normalizePersonName('  ครู  สมหญิง '), 'สมหญิง')
})

test('buildTraineeIndex keeps active trainees and captures mentor/assignment detail', () => {
  const index = buildTraineeIndex([
    trainee(),
    trainee({ id: 'tr2', name: 'เก็บแล้ว', archived: true }),
  ], { classes })
  assert.equal(index.length, 1)
  assert.equal(index[0].trainee.id, 'tr1')
  assert.equal(index[0].hasMentor, true)
  assert.equal(index[0].hasAssignmentDetail, true)
  assert.equal(index[0].mentorIds.has('T1'), true)
  assert.equal(index[0].mentorNames.has('สมชาย'), true)
})

test('traineeMatchesSlot matches mentor by id and assignment class/subject', () => {
  const [entry] = buildTraineeIndex([trainee()], { classes })
  assert.equal(traineeMatchesSlot(entry, slotMain, ctx), true)
  assert.equal(traineeMatchesSlot(entry, slotOther, ctx), false)
})

test('traineeMatchesSlot matches mentor by name even without id', () => {
  const [entry] = buildTraineeIndex([
    trainee({ mentorTeacherId: '', mentorNames: ['สมชาย'] }),
  ], { classes })
  assert.equal(traineeMatchesSlot(entry, slotMain, ctx), true)
})

test('traineeMatchesSlot rejects a slot of a different mentor', () => {
  const [entry] = buildTraineeIndex([
    trainee({ mentorTeacherId: 'T9', mentorNames: ['ครูอื่น'] }),
  ], { classes })
  assert.equal(traineeMatchesSlot(entry, slotMain, ctx), false)
})

test('mentor-only trainee follows the mentor whole timetable', () => {
  const [entry] = buildTraineeIndex([
    trainee({ assignments: [], subjectId: '', className: '' }),
  ], { classes })
  assert.equal(entry.hasAssignmentDetail, false)
  assert.equal(traineeMatchesSlot(entry, slotMain, ctx), true)
  // co-teacher slot belongs to the same mentor pair
  assert.equal(traineeMatchesSlot(entry, slotCo, ctx), true)
  assert.equal(traineeMatchesSlot(entry, slotOther, ctx), false)
})

test('mentor-less trainee matches by class/subject only', () => {
  const [entry] = buildTraineeIndex([
    trainee({ mentorTeacherId: '', mentorNames: [] }),
  ], { classes })
  assert.equal(traineeMatchesSlot(entry, slotMain, ctx), true)
  assert.equal(traineeMatchesSlot(entry, slotOther, ctx), false)
})

test('mentor-less trainee without assignment detail never matches', () => {
  const [entry] = buildTraineeIndex([
    trainee({ mentorTeacherId: '', mentorNames: [], assignments: [], subjectId: '', className: '' }),
  ], { classes })
  assert.equal(entry.hasMentor, false)
  assert.equal(entry.hasAssignmentDetail, false)
  assert.equal(traineeMatchesSlot(entry, slotMain, ctx), false)
})

test('missing assignment dimension acts as a wildcard', () => {
  const [entry] = buildTraineeIndex([
    trainee({ assignments: [{ subjectId: 'S1', subjectName: 'ภาษาไทย' }] }),
  ], { classes })
  assert.equal(traineeMatchesSlot(entry, slotMain, ctx), true)
  assert.equal(traineeMatchesSlot(entry, slotOther, ctx), false)
})

test('traineesForSlot dedupes names and honours onlyMentorId', () => {
  const index = buildTraineeIndex([
    trainee(),
    trainee({ id: 'tr3', name: 'นางสาวทดสอบ' }),
  ], { classes })
  assert.deepEqual(traineesForSlot(index, slotMain, ctx), ['นางสาวทดสอบ'])
  assert.deepEqual(traineesForSlot(index, slotMain, ctx, { onlyMentorId: 'T1' }), ['นางสาวทดสอบ'])
  assert.deepEqual(traineesForSlot(index, slotMain, ctx, { onlyMentorId: 'T2' }), [])
})

test('traineeHasMentor works by id and normalized name', () => {
  const [entry] = buildTraineeIndex([trainee()], { classes })
  assert.equal(traineeHasMentor(entry, 'T1', 'ครูสมชาย'), true)
  assert.equal(traineeHasMentor(entry, '', 'สมชาย'), true)
  assert.equal(traineeHasMentor(entry, 'T2', 'ครูสมหญิง'), false)
})

test('isTraineeMentorAbsent only counts the matched mentor absence and range', () => {
  const [entry] = buildTraineeIndex([trainee()], { classes })
  const halves = { morning: new Set([1, 2, 3]), afternoon: new Set([5, 6, 7, 8]) }
  const absenceMap = new Map([['T1', { teacherId: 'T1', periodRange: 'morning' }]])
  assert.equal(isTraineeMentorAbsent(entry, { ...slotMain, period: 2 }, {
    absenceMap, halves, lessonBlockMap, teacherMap,
  }), true)
  assert.equal(isTraineeMentorAbsent(entry, { ...slotMain, period: 5 }, {
    absenceMap, halves, lessonBlockMap, teacherMap,
  }), false)
  // Absence of the co-teacher is not the trainee's mentor → not mentorAbsent
  const otherAbsence = new Map([['T2', { teacherId: 'T2', periodRange: 'all' }]])
  assert.equal(isTraineeMentorAbsent(entry, slotMain, {
    absenceMap: otherAbsence, halves, lessonBlockMap, teacherMap,
  }), false)
})

test('computePeriodAdjacency treats lunch as a boundary', () => {
  const periods = [
    { period_no: 1, type: 'STUDY' },
    { period_no: 2, type: 'STUDY' },
    { period_no: 3, type: 'STUDY' },
    { period_no: 4, type: 'LUNCH' },
    { period_no: 5, type: 'STUDY' },
    { period_no: 6, type: 'STUDY' },
    { period_no: 7, type: 'STUDY' },
  ]
  const halves = { morning: new Set([1, 2, 3]), afternoon: new Set([5, 6, 7]) }
  const adj = computePeriodAdjacency({
    periods, markerPeriod: 5, busy: new Set([3, 6]), halves,
  })
  assert.equal(adj.before, false)
  assert.equal(adj.after, true)

  const adj2 = computePeriodAdjacency({
    periods, markerPeriod: 6, busy: new Set([5]), halves,
  })
  assert.equal(adj2.before, true)
  assert.equal(adj2.after, false)
})

test('unionPeriods merges sets without duplicates', () => {
  assert.deepEqual([...unionPeriods(new Set([1, 2]), new Set([2, 3]))].sort(), [1, 2, 3])
})

test('dayTeachingCount and describeAdjacency summarize the strip', () => {
  assert.equal(dayTeachingCount(new Set([1, 2]), new Set([2, 3])), 3)
  assert.equal(describeAdjacency({ before: true, after: true }), 'ติดคาบก่อนและถัดไป')
  assert.equal(describeAdjacency({ before: true, after: false }), 'ติดคาบก่อน')
  assert.equal(describeAdjacency({ before: false, after: true }), 'ติดคาบถัดไป')
  assert.equal(describeAdjacency({}), 'ไม่ติดคาบอื่น')
})

test('substitutePerson resolves teacher and trainee assignments', () => {
  assert.deepEqual(
    substitutePerson({ substitute_teacher_id: 'T1', substitute_name: 'ครูสมชาย', substitute_kind: 'teacher' }),
    { kind: 'teacher', id: 'T1', name: 'ครูสมชาย' },
  )
  assert.deepEqual(
    substitutePerson({ substitute_trainee_id: 'tr1', substitute_name: 'นางสาวทดสอบ', substitute_kind: 'trainee' }),
    { kind: 'trainee', id: 'tr1', name: 'นางสาวทดสอบ' },
  )
  assert.equal(substitutePerson({ period: 1 }), null)
})

test('substituteDisplayName falls back to teacherMap and adds trainee suffix', () => {
  assert.equal(
    substituteDisplayName({ substitute_teacher_id: 'T1' }, new Map([['T1', { name: 'ครูสมชาย' }]])),
    'ครูสมชาย',
  )
  // PDF/Excel summary paths use a plain id→name map
  assert.equal(
    substituteDisplayName({ substitute_teacher_id: 'T1' }, new Map([['T1', 'ครูสมชาย']])),
    'ครูสมชาย',
  )
  assert.equal(
    substituteDisplayName(
      { substitute_trainee_id: 'tr1', substitute_name: 'นางสาวทดสอบ' },
      new Map(),
      { withKind: true },
    ),
    'นางสาวทดสอบ (นศ.ฝึกสอน)',
  )
})

test('normalizeDailySchedule backfills substitute kind/name', () => {
  const legacy = normalizeDailySchedule({
    assignments: [{ substitute_teacher_id: 'T1' }],
  })
  assert.equal(legacy.assignments[0].substitute_kind, 'teacher')
  assert.equal(legacy.assignments[0].substitute_name, '')

  const traineeAssign = normalizeDailySchedule({
    assignments: [{ substitute_trainee_id: 'tr1', substitute_name: 'นางสาวทดสอบ' }],
  })
  assert.equal(traineeAssign.assignments[0].substitute_kind, 'trainee')
  assert.equal(traineeAssign.assignments[0].substitute_name, 'นางสาวทดสอบ')
})

test('getDayPeriodList falls back to schedule_config and marks lunch', () => {
  const list = getDayPeriodList(null, { periods_per_day: 5, lunch_periods: [3] })
  assert.deepEqual(list.map((p) => p.period_no), [1, 2, 3, 4, 5])
  assert.equal(list[2].type, 'LUNCH')
  assert.equal(list[0].type, 'STUDY')
})

test('getDayPeriodList unions schedule block periods', () => {
  const list = getDayPeriodList([
    {
      periods: [
        { period_no: 1, type: 'STUDY', start_time: '08:00', end_time: '08:50' },
        { period_no: 1.5, type: 'BREAK', start_time: '08:50', end_time: '09:00' },
        { period_no: 2, type: 'STUDY', start_time: '09:00', end_time: '09:50' },
      ],
    },
  ], {})
  assert.deepEqual(list.map((p) => p.period_no), [1, 1.5, 2])
  assert.equal(list[1].type, 'BREAK')
})

test('getSlotDisplayDetails resolves subject, class, and physical room names', () => {
  const detail = getSlotDisplayDetails({
    lesson_block_id: 'LB1',
    subject_id: 'S1',
    class_id: 'C1',
    room_id: 'R_LAB',
  }, {
    subjectMap,
    classMap,
    roomMap: new Map([['R_LAB', { id: 'R_LAB', name: 'ห้องวิทยาศาสตร์' }]]),
    lessonBlockMap,
  })
  assert.deepEqual(detail, {
    subjectName: 'ภาษาไทย',
    className: 'ป.1/1',
    roomName: 'ห้องวิทยาศาสตร์',
  })
})

test('buildStatsRows appends trainee substitute rows with base 0', () => {
  const rows = buildStatsRows({
    teachers,
    baseLoads: {
      T1: { periodsPerWeek: 10, minutesPerWeek: 500 },
      T2: { periodsPerWeek: 8, minutesPerWeek: 400 },
    },
    subStats: {
      T1: { periods: 2, minutes: 100, name: 'ครูสมชาย', kind: 'teacher' },
      tr1: { periods: 3, minutes: 150, name: 'นางสาวทดสอบ', kind: 'trainee' },
    },
  })
  assert.equal(rows.length, 3)
  const traineeRow = rows.find((r) => r.teacherId === 'tr1')
  assert.equal(traineeRow.personKind, 'trainee')
  assert.equal(traineeRow.basePeriodsPerWeek, 0)
  assert.equal(traineeRow.subPeriods, 3)
  assert.equal(traineeRow.totalPeriods, 3)
  assert.equal(rows[0].teacherId, 'tr1')
})

test('buildDailyGrid marks trainee substitutes and suppresses duplicate co-teacher', () => {
  const gridClasses = [{ id: 'C1', name: 'ป.1/1' }]
  const gridSubjects = [{ id: 'S1', name: 'ภาษาไทย' }]
  const gridTeachers = [
    { id: 'T1', name: 'ครูสมชาย' },
    { id: 'T2', name: 'ครูสมหญิง' },
  ]
  const lb = { id: 'LB1', teacher_id: 'T1', co_teacher_id: 'T2' }
  const lbMap = new Map([['LB1', lb]])
  const daySlots = [{
    lesson_block_id: 'LB1', day: 1, period: 1,
    teacher_id: 'T1', class_id: 'C1', subject_id: 'S1',
  }]
  const base = {
    daySlots, classes: gridClasses, subjects: gridSubjects, teachers: gridTeachers,
    scheduleBlocks: null,
    scheduleConfig: { periods_per_day: 1, lunch_periods: [] },
    lessonBlockMap: lbMap,
  }

  const traineeGrid = buildDailyGrid({
    ...base,
    assignments: [{
      period: 1, class_id: 'C1', role: 'main',
      original_teacher_id: 'T1',
      substitute_trainee_id: 'tr1',
      substitute_name: 'นางสาวทดสอบ',
      substitute_kind: 'trainee',
    }],
  })
  const traineeCell = traineeGrid.rows[0].cells[1]
  assert.equal(traineeCell.teacherName, 'นางสาวทดสอบ')
  assert.equal(traineeCell.mainSubstituteKind, 'trainee')
  assert.equal(traineeCell.isTraineeSubstitute, true)

  // Co-teacher T2 covers the absent main teacher T1 → show T2 once
  const coGrid = buildDailyGrid({
    ...base,
    assignments: [{
      period: 1, class_id: 'C1', role: 'main',
      original_teacher_id: 'T1',
      substitute_teacher_id: 'T2',
      substitute_name: 'ครูสมหญิง',
      substitute_kind: 'teacher',
    }],
  })
  const coCell = coGrid.rows[0].cells[1]
  assert.equal(coCell.teacherName, 'ครูสมหญิง')
  assert.equal(coCell.coTeacherName, null)
})
