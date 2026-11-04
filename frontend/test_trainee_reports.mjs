import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildDailyReportHTML,
  buildDashboardReportHTML,
  buildRangeSummaryHTML,
  buildReportCSV,
  buildReportHTML,
  buildStudentReportHTML,
  defaultOrientation,
  escapeHTML,
  resolveReportRange,
} from './src/utils/traineeReports.js'

const trainees = [
  { id: 't1', name: 'หนึ่ง <script>', studentCode: '6501', major: 'ไทย', institution: 'มช.', mentorTeacherName: 'ครูก', subjectName: 'ภาษาไทย', className: 'ป.1/1', roomName: 'ห้อง 1', weeklyPeriods: 3 },
  { id: 't2', name: 'สอง', studentCode: '6502', major: 'อังกฤษ', institution: 'ราชภัฏ', mentorTeacherName: 'ครูข', subjectName: 'อังกฤษ', className: 'ป.2/1', roomName: 'ห้อง 2', weeklyPeriods: 2 },
]
const attendance = {
  '2026-11-02': {
    t1: { status: 'present', time: '08:00' },
    t2: { status: 'late', time: '08:15', note: 'รถติด' },
  },
  '2026-11-03': {
    t1: { status: 'leave', note: 'ลาป่วย' },
  },
}

test('escapeHTML escapes user content', () => {
  assert.equal(escapeHTML('<b>"x" & y</b>'), '&lt;b&gt;&quot;x&quot; &amp; y&lt;/b&gt;')
})

test('daily report contains summary, escaped name, status and orientation', () => {
  const html = buildDailyReportHTML({
    trainees,
    attendance,
    settings: { dateKey: '2026-11-02', schoolName: '<School>', orientation: 'landscape' },
  })
  assert.match(html, /@page \{ size: A4 landscape/)
  assert.match(html, /&lt;School&gt;/)
  assert.match(html, /หนึ่ง &lt;script&gt;/)
  assert.match(html, /สาย/)
  assert.match(html, /รถติด/)
})

test('range report contains totals and attendance percentage', () => {
  const html = buildRangeSummaryHTML({
    trainees,
    attendance,
    settings: { dateKey: '2026-11-02', rangeMode: 'week', orientation: 'landscape' },
  })
  assert.match(html, /สรุปการลงเวลาปฏิบัติงาน/)
  assert.match(html, /รวมทั้งสิ้น/)
  assert.match(html, /67%/)
})

test('student report contains profile and non-present history', () => {
  const html = buildStudentReportHTML({
    trainees,
    attendance,
    settings: { dateKey: '2026-11-02', rangeMode: 'week', studentId: 't1', orientation: 'portrait' },
  })
  assert.match(html, /@page \{ size: A4 portrait/)
  assert.match(html, /6501/)
  assert.match(html, /ลาป่วย/)
  assert.doesNotMatch(html, /08:00/)
})

test('dashboard report contains KPI and trend table', () => {
  const html = buildDashboardReportHTML({
    trainees,
    attendance,
    settings: { dateKey: '2026-11-02', rangeMode: 'week', orientation: 'portrait' },
  })
  assert.match(html, /สรุปภาพรวมการลงเวลาปฏิบัติงาน/)
  assert.match(html, /นักศึกษาทั้งหมด/)
  assert.match(html, /แนวโน้มการลงเวลา/)
  assert.match(html, /แยกตามครูพี่เลี้ยง/)
})

test('report dispatcher and default orientation work', () => {
  assert.equal(defaultOrientation('daily'), 'landscape')
  assert.equal(defaultOrientation('student'), 'portrait')
  const html = buildReportHTML({
    type: 'student',
    trainees,
    attendance,
    settings: { dateKey: '2026-11-02', rangeMode: 'week', studentId: 't1' },
  })
  assert.match(html, /รายงานประวัตินักศึกษา/)
})

test('report range and CSV resolve by type', () => {
  const range = resolveReportRange('daily', { dateKey: '2026-11-04' })
  assert.deepEqual(range, { start: '2026-11-04', end: '2026-11-04', mode: 'day' })
  const csv = buildReportCSV({
    type: 'range',
    trainees,
    attendance,
    settings: { dateKey: '2026-11-02', rangeMode: 'week' },
  })
  assert.ok(csv.startsWith('\uFEFF'))
  assert.ok(csv.includes('หนึ่ง <script>'))
})
