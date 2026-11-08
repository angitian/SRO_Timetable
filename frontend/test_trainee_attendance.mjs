import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildDashboardCSV, buildDashboardStats, buildReference, buildSummaryCSV,
  bulkPresent, countAttendanceRecords, dashboardRange, dashboardRangeLabel,
  getRange, historyForTrainee, mentorDisplayLine, mergeTraineeRows,
  normalizeTraineeProfile, rangeLabel, removeDailyRecord, removeTraineeRecords,
  setDailyRecord, statsForTrainee, traineeTeachingLines,
  summarizeDay, summarizeRange, todayISO, validateTraineeProfile,
} from './src/utils/traineeAttendance.js'
import {
  TRAINEE_TEMPLATE_EXAMPLE_ROW, TRAINEE_TEMPLATE_HEADERS,
  buildTraineeTemplateData,
} from './src/utils/traineeExcelTemplate.js'

const attendance = {
  '2026-11-02': {
    t1: { status: 'present' },
    t2: { status: 'late', note: 'รถติด' },
  },
  '2026-11-03': {
    t1: { status: 'leave', note: 'ลาป่วย' },
    t2: { status: 'absent' },
  },
  '2026-11-04': {
    t1: { status: 'present' },
  },
}

test('week range starts Monday and ends Sunday', () => {
  const range = getRange('2026-11-04', 'week')
  assert.equal(range.start, '2026-11-02')
  assert.equal(range.end, '2026-11-08')
})

test('month range covers calendar month', () => {
  const range = getRange('2026-11-04', 'month')
  assert.equal(range.start, '2026-11-01')
  assert.equal(range.end, '2026-11-30')
})

test('semester range uses the reference term and academic year', () => {
  const range = getRange('2026-11-04', 'semester', { academicYear: 2569, term: 2 })
  assert.deepEqual(range, { start: '2026-11-01', end: '2027-03-31', mode: 'semester' })
  assert.match(rangeLabel('2026-11-04', 'semester', { academicYear: 2569, term: 2 }), /ภาคเรียนที่ 2\/2569/)
})

test('day summary only counts recorded statuses', () => {
  const stats = summarizeDay(attendance, '2026-11-02', ['t1', 't2', 't3'])
  assert.deepEqual(stats, { present: 1, late: 1, leave: 0, absent: 0, total: 2 })
})

test('range summary aggregates records', () => {
  const stats = summarizeRange(attendance, getRange('2026-11-04', 'week'), ['t1', 't2'])
  assert.equal(stats.present, 2)
  assert.equal(stats.late, 1)
  assert.equal(stats.leave, 1)
  assert.equal(stats.absent, 1)
  assert.equal(stats.total, 5)
})

test('per-trainee stats and history exclude present', () => {
  const stats = statsForTrainee(attendance, 't1', getRange('2026-11-04', 'week'))
  assert.deepEqual(stats, { present: 2, late: 0, leave: 1, absent: 0, total: 3 })
  const history = historyForTrainee(attendance, 't1')
  assert.equal(history.length, 1)
  assert.equal(history[0].status, 'leave')
})

test('set/remove daily record does not mutate input', () => {
  const next = setDailyRecord(attendance, '2026-11-05', 't1', { status: 'present' })
  assert.equal(attendance['2026-11-05'], undefined)
  assert.equal(next['2026-11-05'].t1.status, 'present')
  const removed = removeDailyRecord(next, '2026-11-05', 't1')
  assert.equal(removed['2026-11-05'], undefined)
})

test('bulk present creates records for all trainees', () => {
  const next = bulkPresent({}, '2026-11-04', ['a', 'b'], 'u1')
  assert.equal(next['2026-11-04'].a.status, 'present')
  assert.equal(next['2026-11-04'].b.updatedBy, 'u1')
  assert.equal(countAttendanceRecords(next), 2)
})

test('merge dedupes by student code then name', () => {
  const existing = [{ id: '1', studentCode: '6501', name: 'ก' }, { id: '2', name: 'ข' }]
  const incoming = [
    { id: 'new1', studentCode: '6501', name: 'ก.', major: 'ไทย' },
    { id: 'new2', name: 'ข', major: 'อังกฤษ' },
    { id: 'new3', name: 'ค' },
  ]
  const result = mergeTraineeRows(existing, incoming)
  assert.equal(result.trainees.length, 3)
  assert.equal(result.updated, 2)
  assert.equal(result.added, 1)
  assert.equal(result.trainees[0].major, 'ไทย')
})

test('reference is built from fixture without mutating it', () => {
  const fixture = {
    teachers: [{ id: 'T1', name: 'ครู' }],
    subjects: [{ id: 'S1', name: 'ไทย' }],
    classes: [{ id: 'C1', name: 'ป.1', grade_level: 1 }],
    rooms: [{ id: 'R1', name: 'ห้อง 1', room_type: 'classroom' }],
    lesson_blocks: [{ id: 'L1', teacher_id: 'T1', subject_id: 'S1', class_id: 'C1', room_id: 'R1', periods_per_week: 3 }],
  }
  const ref = buildReference(fixture, { title: 'งาน', academicYear: 2569, term: 2 })
  assert.equal(ref.teachers[0].name, 'ครู')
  assert.equal(ref.lessonBlocks[0].periodsPerWeek, 3)
  assert.equal(fixture.teachers.length, 1)
})

test('CSV has BOM, summary columns, and escapes commas', () => {
  const trainees = [{ id: 't1', name: 'ก, ข', major: 'ไทย' }]
  const csv = buildSummaryCSV({ trainees, attendance, range: getRange('2026-11-04', 'week'), reference: null })
  assert.ok(csv.startsWith('\uFEFF'))
  assert.ok(csv.includes('"ก, ข"'))
  assert.ok(csv.includes('ปกติ'))
})

test('todayISO returns local YYYY-MM-DD', () => {
  assert.match(todayISO(new Date(2026, 10, 4)), /^2026-11-04$/)
})

test('template data includes headers, example row, and guide sheet', () => {
  const data = buildTraineeTemplateData()
  assert.deepEqual(data.trainees[0], TRAINEE_TEMPLATE_HEADERS)
  assert.equal(data.trainees.length, 3)
  assert.match(TRAINEE_TEMPLATE_EXAMPLE_ROW[0], /^EXAMPLE/)
  assert.equal(data.trainees[2][0], 'EXAMPLE-01')
  assert.equal(data.trainees[2][5], 'คณิตศาสตร์')
  assert.ok(data.guide.length >= 10)
  assert.equal(data.guide[0][0], 'คอลัมน์ในไฟล์')
})

test('semester range crosses Buddhist academic year for term 2', () => {
  const range = dashboardRange('2026-11-04', 'semester', { academicYear: 2569, term: 2 })
  assert.equal(range.start, '2026-11-01')
  assert.equal(range.end, '2027-03-31')
  const term1 = dashboardRange('2026-06-15', 'semester', { academicYear: 2569, term: 1 })
  assert.equal(term1.start, '2026-05-01')
  assert.equal(term1.end, '2026-10-31')
  assert.match(dashboardRangeLabel('2026-11-04', 'semester', { academicYear: 2569, term: 2 }), /ภาคเรียนที่ 2\/2569/)
})

test('dashboard stats aggregate rates, grouping, top lists, and recent activity', () => {
  const trainees = [
    { id: 't1', name: 'หนึ่ง', major: 'ไทย', institution: 'มช.', mentorTeacherName: 'ครูก' },
    { id: 't2', name: 'สอง', major: 'ไทย', institution: 'มช.', mentorTeacherName: 'ครูข' },
    { id: 't3', name: 'สาม', major: 'อังกฤษ', institution: 'ราชภัฏ', mentorTeacherName: 'ครูก' },
  ]
  const range = getRange('2026-11-04', 'week')
  const stats = buildDashboardStats({ trainees, attendance, range })
  assert.equal(stats.traineeCount, 3)
  assert.equal(stats.recordedDays, 3)
  assert.equal(stats.totals.total, 5)
  assert.equal(stats.attendedRate, 60)
  assert.equal(stats.punctualRate, 40)
  assert.equal(stats.byMajor.find((g) => g.key === 'ไทย').traineeCount, 2)
  assert.equal(stats.byMentor.find((g) => g.key === 'ครูก').total, 3)
  assert.equal(stats.topLate[0].trainee.id, 't2')
  assert.equal(stats.topAbsent[0].trainee.id, 't2')
  assert.equal(stats.noRecordTrainees[0].id, 't3')
  assert.equal(stats.recent[0].dateKey, '2026-11-04')
})

test('dashboard CSV includes KPI and per-trainee rows', () => {
  const stats = buildDashboardStats({
    trainees: [{ id: 't1', name: 'หนึ่ง' }],
    attendance,
    range: getRange('2026-11-04', 'week'),
  })
  const csv = buildDashboardCSV(stats)
  assert.ok(csv.startsWith('\uFEFF'))
  assert.ok(csv.includes('อัตรามาปฏิบัติงาน'))
  assert.ok(csv.includes('หนึ่ง'))
})

test('trainee profile normalization and validation cover new fields', () => {
  const t = normalizeTraineeProfile({
    name: '  ชื่อทดสอบ  ',
    studentCode: ' 6503 ',
    phone: '0801',
    email: 'test@example.com',
    internshipStart: '2026-11-01',
    internshipEnd: '2026-10-01',
    weeklyPeriods: '3',
    note: '  note ',
  })
  assert.equal(t.name, 'ชื่อทดสอบ')
  assert.equal(t.studentCode, '6503')
  assert.equal(t.weeklyPeriods, 3)
  assert.equal(t.note, 'note')
  const errors = validateTraineeProfile(t)
  assert.equal(errors.internshipEnd, 'วันสิ้นสุดฝึกงานต้องไม่ก่อนวันเริ่ม')
  assert.equal(validateTraineeProfile({ name: '', email: 'bad' }).name, 'ต้องระบุชื่อ-นามสกุล')
})

test('removeTraineeRecords removes only that trainee from attendance', () => {
  const cleaned = removeTraineeRecords(attendance, 't1')
  assert.equal(cleaned['2026-11-02'].t1, undefined)
  assert.equal(cleaned['2026-11-02'].t2.status, 'late')
  assert.equal(cleaned['2026-11-03'].t1, undefined)
  assert.equal(cleaned['2026-11-03'].t2.status, 'absent')
})

test('template includes extended trainee columns', () => {
  const data = buildTraineeTemplateData()
  assert.equal(data.trainees[0].length, 17)
  assert.ok(data.trainees[0].includes('อาจารย์นิเทศ'))
  assert.ok(data.trainees[0].includes('วันเริ่มฝึกงาน'))
})

test('manual class name stays manual and teaching line excludes identity fields', () => {
  const classes = [{ id: 'C1', name: 'ป.1/1' }]
  const t = normalizeTraineeProfile({
    name: 'ทดสอบ', major: 'ประถมศึกษา', institution: 'มหาวิทยาลัยเชียงใหม่',
    assignments: [{ subjectName: 'ภาษาไทย', className: 'ป.1/1', roomNames: ['ห้อง ป.1/1'], weeklyPeriods: 2 }],
  }, classes)
  assert.equal(t.assignments[0].weeklyPeriods, 2)
  assert.equal(traineeTeachingLines(t)[0], 'ภาษาไทย (ป.1/1) · ห้อง ป.1/1 · 2 คาบ')
})

test('duplicate studentCode rows append assignments', () => {
  const merged = mergeTraineeRows([], [
    { studentCode: '6501', name: 'A', subjectName: 'ภาษาไทย', className: 'ป.1/1', roomName: 'ห้อง ป.1/1' },
    { studentCode: '6501', name: 'A', subjectName: 'คณิต', className: 'ป.1/1', roomName: 'ห้อง ป.1/1' },
  ])
  assert.equal(merged.trainees.length, 1)
  assert.equal(merged.trainees[0].assignments.length, 2)
  assert.equal(merged.trainees[0].assignments[1].subjectName, 'คณิต')
})

test('multi mentors normalize and group independently', () => {
  const t = normalizeTraineeProfile({ name: 'A', mentorTeacherName: 'ครูหนึ่ง; ครูสอง' })
  assert.deepEqual(t.mentorNames, ['ครูหนึ่ง', 'ครูสอง'])
  assert.equal(mentorDisplayLine(t), 'ครูหนึ่ง, ครูสอง')
  const stats = buildDashboardStats({
    trainees: [t],
    attendance: { '2026-11-02': { [t.id]: { status: 'present' } } },
    range: getRange('2026-11-02', 'week'),
  })
  assert.equal(stats.byMentor.length, 2)
  assert.equal(stats.byMentor[0].trainees[0].id, t.id)
})

test('dashboard groups by subjects from assignments', () => {
  const t = normalizeTraineeProfile({
    name: 'A',
    assignments: [
      { subjectName: 'ภาษาไทย', roomNames: ['ห้อง ป.1/1'] },
      { subjectName: 'คณิต', roomNames: ['ห้อง ป.2/1'] },
    ],
  })
  const stats = buildDashboardStats({
    trainees: [t],
    attendance: { '2026-11-02': { [t.id]: { status: 'late' } } },
    range: getRange('2026-11-02', 'week'),
  })
  assert.deepEqual(stats.bySubject.map((row) => row.key).sort(), ['คณิต', 'ภาษาไทย'])
})
