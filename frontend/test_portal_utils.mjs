import test from 'node:test'
import assert from 'node:assert/strict'
import {
  ALLOWED_EXT,
  audienceDetails,
  audienceSummary,
  buildMonthGrid,
  daysUntil,
  dueBadge,
  filterSubstitutionsForTeacher,
  formatDateRange,
  formatFileSize,
  formatThaiDate,
  formatThaiDateTime,
  groupItemsByDate,
  audienceSelectionGroups,
  eventsOnDate,
  filterCalendarItems,
  formatDDMMYYYYBuddhist,
  formatTime24,
  isAudienceMember,
  joinDateTime,
  splitDateTime,
  isValidTime24,
  maskTimeInput,
  portalEntryState,
  progressLabel,
  removeAudienceMember,
  toggleAudienceMember,
  yearOptions,
  reminderText,
  statusMeta,
  validateFile,
} from './src/features/portal/portalUtils.js'

const NOW = new Date('2026-11-15T10:00:00')

test('statusMeta covers slot and task states', () => {
  assert.equal(statusMeta('submitted').dot, '🟩')
  assert.equal(statusMeta('late').dot, '🟨')
  assert.equal(statusMeta('missing').dot, '🟥')
  assert.equal(statusMeta('complete').dot, '🟩')
  assert.equal(statusMeta('partial').dot, '🟨')
  assert.equal(statusMeta('weird').dot, '🟥')
})

test('formats Thai dates in พ.ศ.', () => {
  assert.equal(formatThaiDate('2026-11-16'), '16 พ.ย. 2569')
  assert.equal(formatThaiDateTime('2026-11-16 16:30'), '16 พ.ย. 2569 16:30')
  assert.equal(formatDateRange('2026-11-16', '2026-11-18'), '16 พ.ย. 2569 – 18 พ.ย. 2569')
  assert.equal(formatDateRange('2026-11-16', '2026-11-16'), '16 พ.ย. 2569')
  assert.equal(formatThaiDate(''), '')
})

test('daysUntil counts calendar days', () => {
  assert.equal(daysUntil('2026-11-15 23:59', NOW), 0)
  assert.equal(daysUntil('2026-11-16 08:00', NOW), 1)
  assert.equal(daysUntil('2026-11-14 08:00', NOW), -1)
  assert.equal(daysUntil('', NOW), null)
})

test('dueBadge flags urgent and overdue tasks', () => {
  assert.equal(dueBadge({ due_datetime: '2026-11-14 16:30' }, NOW).tone, 'rose')
  assert.match(dueBadge({ due_datetime: '2026-11-14 16:30' }, NOW).label, /เลยกำหนด/)
  assert.equal(dueBadge({ due_datetime: '2026-11-15 16:30' }, NOW).urgent, true)
  assert.equal(dueBadge({ due_datetime: '2026-11-16 16:30' }, NOW).label, 'ครบกำหนดพรุ่งนี้')
  assert.match(dueBadge({ due_datetime: '2026-11-18 16:30' }, NOW).label, /เหลือ 3 วัน/)
  assert.equal(dueBadge({ due_datetime: '2026-12-01 16:30' }, NOW).tone, 'slate')
})

test('validateFile respects per-slot extension and size', () => {
  assert.equal(validateFile(null), 'กรุณาเลือกไฟล์')
  assert.match(validateFile({ name: 'a.exe', size: 10 }), /ชนิดไฟล์ไม่รองรับ/)
  assert.equal(validateFile({ name: 'a.pdf', size: 10 }), null)
  assert.match(validateFile({ name: 'a.pdf', size: 26 * 1024 * 1024 }), /ใหญ่เกิน 25 MB/)
  // slot that only allows PDF
  assert.match(
    validateFile({ name: 'a.docx', size: 10 }, { allowedExt: ['.pdf'] }),
    /อนุญาต: \.pdf/,
  )
  assert.equal(validateFile({ name: 'a.pdf', size: 10 }, { allowedExt: ['.pdf'], maxMb: 5 }), null)
  assert.match(validateFile({ name: 'a.pdf', size: 0 }), /ไฟล์ว่าง/)
  assert.deepEqual(ALLOWED_EXT, ['.pdf', '.docx', '.xlsx', '.zip'])
})

test('formatFileSize is human readable', () => {
  assert.equal(formatFileSize(900), '900 B')
  assert.equal(formatFileSize(2048), '2 KB')
  assert.equal(formatFileSize(5 * 1024 * 1024), '5.0 MB')
  assert.equal(formatFileSize(0), '-')
})

test('filterSubstitutionsForTeacher keeps only my periods', () => {
  const rows = [
    { id: '1', absent_teacher_id: 'T1', substitute_id: 'T2' },
    { id: '2', absent_teacher_id: 'T3', substitute_id: 'T4' },
  ]
  assert.deepEqual(filterSubstitutionsForTeacher(rows, 'T2').map((r) => r.id), ['1'])
  assert.equal(filterSubstitutionsForTeacher(rows, '').length, 2)
})

test('progressLabel shows boxes done', () => {
  assert.equal(progressLabel({ done: 2, total: 3 }), '2/3 กล่อง')
  assert.equal(progressLabel(null), '')
})

test('audienceSummary and details describe who attends', () => {
  assert.equal(audienceSummary({ is_all: true }), 'ทุกคน')
  const resolved = {
    is_all: false,
    summary: 'กลุ่มสาระ วิทยาศาสตร์ · ครู 2 คน',
    depts: ['วิทยาศาสตร์'],
    classes: [{ class_id: 'C1', name: 'ม.2/1' }],
    teachers: [{ teacher_id: 'T1', display_name: 'ครูสมชาย' }],
  }
  assert.equal(audienceSummary(resolved), 'กลุ่มสาระ วิทยาศาสตร์ · ครู 2 คน')
  const details = audienceDetails(resolved)
  assert.deepEqual(details.map((d) => d.kind), ['dept', 'class', 'teacher'])
  assert.equal(details[1].label, 'ห้อง ม.2/1')
  assert.deepEqual(audienceDetails({ is_all: true }), [{ kind: 'all', label: 'ครูทุกคนในโรงเรียน' }])
})

test('reminderText builds a LINE-ready message for tasks', () => {
  const text = reminderText({
    task: { title: 'ส่งแผนการสอน', due_datetime: '2026-11-20 16:30' },
    rows: [{ display_name: 'ครูนภา' }, { display_name: 'ครูสมชาย' }],
    portalUrl: 'https://school.example/portal?w=ABC123',
  })
  assert.match(text, /ส่งแผนการสอน/)
  assert.match(text, /20 พ.ย. 2569 16:30/)
  assert.match(text, /ยังไม่ได้ส่งครบ 2 คน: ครูนภา, ครูสมชาย/)
  assert.match(text, /portal\?w=ABC123/)
})

// ── Calendar ───────────────────────────────────────────────────────────────

test('buildMonthGrid starts on Monday and has 6 weeks', () => {
  const weeks = buildMonthGrid(2026, 11, '2026-11-15')  // พ.ย. 2569
  assert.equal(weeks.length, 6)
  assert.equal(weeks[0].length, 7)
  // 1 Nov 2026 is a Sunday → grid starts Mon 26 Oct
  assert.equal(weeks[0][0].iso, '2026-10-26')
  assert.equal(weeks[0][0].inMonth, false)
  const today = weeks.flat().find((d) => d.isToday)
  assert.equal(today.iso, '2026-11-15')
  assert.equal(today.day, 15)
})

test('buildMonthGrid marks days inside the month', () => {
  const days = buildMonthGrid(2026, 11, '2026-11-15').flat()
  const firstOfMonth = days.find((d) => d.iso === '2026-11-01')
  assert.equal(firstOfMonth.inMonth, true)
})

test('groupItemsByDate expands multi-day events', () => {
  const items = [
    { kind: 'event', id: 'E1', title: 'ค่าย', date: '2026-11-16', end_date: '2026-11-18' },
    { kind: 'task', id: 'T1', title: 'ส่งงาน', date: '2026-11-17' },
  ]
  const map = groupItemsByDate(items)
  assert.deepEqual(Object.keys(map).sort(), ['2026-11-16', '2026-11-17', '2026-11-18'])
  assert.equal(map['2026-11-17'].length, 2)
  assert.equal(map['2026-11-18'][0].id, 'E1')
})

test('groupItemsByDate ignores items without a date', () => {
  assert.deepEqual(groupItemsByDate([{ kind: 'event', id: 'X' }]), {})
})

// ── Portal entry state ─────────────────────────────────────────────────────

test('portalEntryState opens directly when a short code exists', () => {
  const res = portalEntryState({
    workspace: { kind: 'cloud', id: 'w1', shortCode: 'ABC123' },
    user: null,
  })
  assert.equal(res.state, 'open')
  assert.equal(res.shortCode, 'ABC123')
})

test('portalEntryState finds the code in the cloud list', () => {
  const res = portalEntryState({
    workspace: { kind: 'cloud', id: 'w1' },
    user: { id: 'u1' },
    cloudWorkspaces: [{ id: 'w1', short_code: 'XYZ789' }],
  })
  assert.equal(res.state, 'open')
  assert.equal(res.shortCode, 'XYZ789')
})

test('portalEntryState asks for login before saving a local workspace', () => {
  const local = { kind: 'local', id: 'snap1', title: 'ตารางฉบับร่าง v3.0' }
  assert.equal(portalEntryState({ workspace: local, user: null }).state, 'need_login')
  assert.equal(portalEntryState({ workspace: local, user: { id: 'u1' } }).state, 'save_then_open')
})

test('portalEntryState returns none without a workspace', () => {
  assert.equal(portalEntryState({ workspace: null, user: { id: 'u1' } }).state, 'none')
  assert.equal(portalEntryState({}).state, 'none')
})

// ── เวลา 24 ชม. ───────────────────────────────────────────────────────────

test('maskTimeInput inserts the colon automatically', () => {
  assert.equal(maskTimeInput('1530'), '15:30')
  assert.equal(maskTimeInput('15'), '15')
  assert.equal(maskTimeInput('15:3'), '15:3')
  assert.equal(maskTimeInput('15300'), '15:30')
  assert.equal(maskTimeInput('abc'), '')
})

test('formatTime24 normalizes and validates', () => {
  assert.equal(formatTime24('1530'), '15:30')
  assert.equal(formatTime24('930'), '09:30')
  assert.equal(formatTime24('9:5'), '')      // ต้องมี 2 หลักของนาที
  assert.equal(formatTime24('24:00'), '')
  assert.equal(formatTime24('12:60'), '')
  assert.equal(formatTime24(''), '')
  assert.equal(isValidTime24('08:00'), true)
  assert.equal(isValidTime24('8:00'), true)
  assert.equal(isValidTime24('25:00'), false)
})

test('formatDDMMYYYYBuddhist renders พ.ศ.', () => {
  assert.equal(formatDDMMYYYYBuddhist('2026-11-16'), '16/11/2569')
  assert.equal(formatDDMMYYYYBuddhist(''), '')
})

// ── Audience selection ────────────────────────────────────────────────────

test('toggleAudienceMember adds and removes', () => {
  let members = []
  members = toggleAudienceMember(members, 'dept', 'คณิตศาสตร์')
  assert.deepEqual(members, [{ member_kind: 'dept', member_id: 'คณิตศาสตร์' }])
  assert.equal(isAudienceMember(members, 'dept', 'คณิตศาสตร์'), true)
  members = toggleAudienceMember(members, 'dept', 'คณิตศาสตร์')
  assert.deepEqual(members, [])
})

test('removeAudienceMember removes only the target', () => {
  const members = [
    { member_kind: 'teacher', member_id: 'T1' },
    { member_kind: 'teacher', member_id: 'T2' },
    { member_kind: 'class', member_id: 'C1' },
  ]
  const next = removeAudienceMember(members, 'teacher', 'T1')
  assert.deepEqual(next.map((m) => m.member_id), ['T2', 'C1'])
})

test('audienceSelectionGroups resolves labels', () => {
  const groups = audienceSelectionGroups(
    [
      { member_kind: 'dept', member_id: 'วิทยาศาสตร์' },
      { member_kind: 'class', member_id: 'C1' },
      { member_kind: 'teacher', member_id: 'T1' },
      { member_kind: 'teacher', member_id: 'GHOST' },
    ],
    [{ teacher_id: 'T1', display_name: 'ครูสมชาย', dept: 'คณิตศาสตร์' }],
    [{ class_id: 'C1', name: 'ม.2/1' }],
  )
  assert.equal(groups.depts[0].label, 'วิทยาศาสตร์')
  assert.equal(groups.classes[0].label, 'ม.2/1')
  assert.equal(groups.teachers[0].label, 'ครูสมชาย')
  assert.equal(groups.teachers[0].dept, 'คณิตศาสตร์')
  assert.equal(groups.teachers[1].label, 'GHOST')   // ไม่พบครู → ใช้ id
})

test('eventsOnDate includes multi-day events', () => {
  const events = [
    { id: 'E1', event_date: '2026-11-16', end_date: '2026-11-18' },
    { id: 'E2', event_date: '2026-11-17' },
  ]
  assert.deepEqual(eventsOnDate(events, '2026-11-17').map((e) => e.id), ['E1', 'E2'])
  assert.deepEqual(eventsOnDate(events, '2026-11-18').map((e) => e.id), ['E1'])
  assert.deepEqual(eventsOnDate(events, '2026-11-19'), [])
})

// ── กรองปฏิทินตามครู ─────────────────────────────────────────────────────

test('filterCalendarItems returns everything without a teacher', () => {
  const items = [{ id: 'E1', i_attend: true }, { id: 'E2', i_attend: false }]
  assert.equal(filterCalendarItems(items, { onlyMine: true }).length, 2)
  assert.equal(filterCalendarItems(items, { teacherId: '', onlyMine: true }).length, 2)
})

test('filterCalendarItems returns everything when onlyMine is off', () => {
  const items = [{ id: 'E1', i_attend: true }, { id: 'E2', i_attend: false }]
  assert.equal(filterCalendarItems(items, { teacherId: 'T1', onlyMine: false }).length, 2)
})

test('filterCalendarItems keeps only events the teacher attends', () => {
  const items = [
    { id: 'E1', kind: 'event', i_attend: true },
    { id: 'E2', kind: 'event', i_attend: false },
    { id: 'K1', kind: 'task', i_attend: true },
  ]
  const filtered = filterCalendarItems(items, { teacherId: 'T1', onlyMine: true })
  assert.deepEqual(filtered.map((item) => item.id), ['E1', 'K1'])
})

test('filterCalendarItems drops class-only events and does not mutate input', () => {
  const items = [
    { id: 'E1', i_attend: false },
    { id: 'E2', i_attend: true },
  ]
  const snapshot = JSON.stringify(items)
  const filtered = filterCalendarItems(items, { teacherId: 'T1', onlyMine: true })
  assert.deepEqual(filtered.map((item) => item.id), ['E2'])
  assert.equal(JSON.stringify(items), snapshot)
})

// ── ตัวเลือกปีในปฏิทิน ────────────────────────────────────────────────────

test('yearOptions covers current year ± span', () => {
  const now = new Date('2026-11-15T00:00:00')
  const years = yearOptions(2026, { now })
  assert.equal(years.length, 11)
  assert.equal(years[0], 2021)
  assert.equal(years[years.length - 1], 2031)
})

test('yearOptions keeps an out-of-range displayed year', () => {
  const now = new Date('2026-11-15T00:00:00')
  const years = yearOptions(2015, { now })
  assert.ok(years.includes(2015))
  assert.ok(years.includes(2026))
  assert.deepEqual([...years].sort((a, b) => a - b), years)
})

test('yearOptions has no duplicates and handles a missing year', () => {
  const now = new Date('2026-11-15T00:00:00')
  const years = yearOptions(2026, { now })
  assert.equal(new Set(years).size, years.length)
  assert.equal(yearOptions(null, { now }).length, 11)
})

// ── แยก/รวม วันที่+เวลา ──────────────────────────────────────────────────

test('splitDateTime handles space and T separators', () => {
  assert.deepEqual(splitDateTime('2026-11-16 16:30'), { date: '2026-11-16', time: '16:30' })
  assert.deepEqual(splitDateTime('2026-11-16T08:05'), { date: '2026-11-16', time: '08:05' })
  assert.deepEqual(splitDateTime(''), { date: '', time: '' })
  assert.deepEqual(splitDateTime(null), { date: '', time: '' })
})

test('joinDateTime composes and normalizes time', () => {
  assert.equal(joinDateTime('2026-11-16', '16:30'), '2026-11-16 16:30')
  assert.equal(joinDateTime('2026-11-16', '930'), '2026-11-16 09:30')
  assert.equal(joinDateTime('2026-11-16', ''), '2026-11-16 00:00')
  assert.equal(joinDateTime('2026-11-16', '', { fallbackTime: '23:59' }), '2026-11-16 23:59')
  assert.equal(joinDateTime('', '16:30'), null)
})

test('splitDateTime round-trips through joinDateTime', () => {
  const original = '2026-11-16 16:30'
  const { date, time } = splitDateTime(original)
  assert.equal(joinDateTime(date, time), original)
})
