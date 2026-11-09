import test from 'node:test'
import assert from 'node:assert/strict'
import { getDayPeriodList, isAssignablePeriod } from './src/features/substitute/dailySchedule.js'
import { buildDailyScheduleHTML } from './src/features/substitute/exportDailySchedule.js'

test('daily substitute periods label lunch and breaks without making them assignable', () => {
  const periods = getDayPeriodList([{
    periods: [
      { period_no: 1, type: 'STUDY' },
      { period_no: 2, type: 'LUNCH' },
      { period_no: 3, type: 'STUDY' },
      { period_no: 3.5, type: 'BREAK' },
      { period_no: 4, type: 'STUDY' },
    ],
  }])
  assert.deepEqual(periods.map((period) => period.display_label), ['1', 'พักเที่ยง', '2', 'พัก', '3'])
  assert.equal(isAssignablePeriod(periods, 1), true)
  assert.equal(isAssignablePeriod(periods, 2), false)
  assert.equal(isAssignablePeriod(periods, 3.5), false)
  assert.equal(isAssignablePeriod(periods, 4), true)
})

test('daily substitute export shows the teaching label instead of its slot number', () => {
  const dayPeriods = [
    { period_no: 1, type: 'STUDY' },
    { period_no: 2, type: 'LUNCH' },
    { period_no: 3, type: 'STUDY' },
    { period_no: 4, type: 'STUDY' },
  ]
  const html = buildDailyScheduleHTML({
    dateStr: '2026-11-09',
    dayLabel: 'จันทร์',
    grid: {
      rows: [{
        className: 'ป.1/1',
        periods: [{ period_no: 4, display_label: '3', start_time: '', end_time: '' }],
        cells: { 4: null },
      }],
    },
    dayPeriods,
    assignments: [],
    absences: [],
    teachers: [],
    subjects: [],
    classes: [],
  })
  assert.match(html, /<td class="num">3<\/td>/)
  assert.doesNotMatch(html, /<td class="num">4<\/td>/)
})
