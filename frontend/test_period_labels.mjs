import test from 'node:test'
import assert from 'node:assert/strict'
import { createPeriodLabelMap } from './src/utils/periodLabels.js'

test('numbers study periods continuously across lunch and short breaks', () => {
  const labels = createPeriodLabelMap([
    { period_no: 1, type: 'STUDY' },
    { period_no: 2, type: 'STUDY' },
    { period_no: 3, type: 'LUNCH' },
    { period_no: 4, type: 'STUDY' },
    { period_no: 4.5, type: 'BREAK' },
    { period_no: 5, type: 'STUDY' },
  ])
  assert.deepEqual([...labels.values()], ['1', '2', 'พักเที่ยง', '3', 'พัก', '4'])
})

test('does not count lunch at the beginning or end as a study period', () => {
  const labels = createPeriodLabelMap([
    { period_no: 1, type: 'LUNCH' },
    { period_no: 2, type: 'STUDY' },
    { period_no: 3, type: 'LUNCH' },
  ])
  assert.deepEqual([...labels.values()], ['พักเที่ยง', '1', 'พักเที่ยง'])
})

test('counts all non-break slots continuously when there is no lunch', () => {
  const labels = createPeriodLabelMap([1, 2, 3])
  assert.deepEqual([...labels.values()], ['1', '2', '3'])
})

test('uses legacy lunch period numbers with numeric period lists', () => {
  const labels = createPeriodLabelMap([1, 2, 3, 4, 5], { lunchPeriods: [3] })
  assert.deepEqual([...labels.values()], ['1', '2', 'พักเที่ยง', '3', '4'])
})

test('supports schedule template period_num and period_type fields', () => {
  const labels = createPeriodLabelMap([
    { period_num: 1, period_type: 'teaching' },
    { period_num: 2, period_type: 'lunch' },
    { period_num: 3, period_type: 'teaching' },
  ])
  assert.deepEqual([...labels.values()], ['1', 'พักเที่ยง', '2'])
})

test('deduplicates slot labels without advancing twice for duplicate metadata', () => {
  const labels = createPeriodLabelMap([
    { period_no: 1, type: 'STUDY' },
    { period_no: 1, type: 'STUDY' },
    { period_no: 2, type: 'STUDY' },
  ])
  assert.deepEqual([...labels.entries()], [[1, '1'], [2, '2']])
})

test('prefers lunch metadata when blocks disagree about the same slot', () => {
  const labels = createPeriodLabelMap([
    { period_no: 3, type: 'STUDY' },
    { period_no: 3, type: 'LUNCH' },
    { period_no: 4, type: 'STUDY' },
  ])
  assert.deepEqual([...labels.values()], ['พักเที่ยง', '1'])
})
