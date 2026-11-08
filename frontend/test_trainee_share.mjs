import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildTraineeSharePayload,
  normalizeSharePeriod,
  sanitizeAttendanceForShare,
  sanitizeTraineeForShare,
} from './src/utils/traineeShare.js'
import { buildReportHTML } from './src/utils/traineeReports.js'

test('normalizeSharePeriod maps legacy report types', () => {
  assert.equal(normalizeSharePeriod('range'), 'month')
  assert.equal(normalizeSharePeriod('student'), 'month')
  assert.equal(normalizeSharePeriod('dashboard'), 'semester')
  assert.equal(normalizeSharePeriod('week'), 'week')
  assert.equal(normalizeSharePeriod('unknown'), 'month')
})

test('sanitizeTraineeForShare keeps report fields and strips private contact data', () => {
  const trainee = {
    id: 't1',
    name: 'นางสาวทดสอบ',
    studentCode: '6501',
    major: 'ไทย',
    institution: 'มช.',
    mentorTeacherName: 'ครูก',
    subjectName: 'ภาษาไทย',
    className: 'ป.1/1',
    roomName: 'ห้อง 1',
    weeklyPeriods: 3,
    phone: '0800000000',
    email: 'trainee@example.com',
    advisorName: 'อาจารย์ที่ปรึกษา',
    note: 'ข้อมูลส่วนตัว',
  }
  const out = sanitizeTraineeForShare(trainee)
  assert.equal(out.name, 'นางสาวทดสอบ')
  assert.equal(out.studentCode, '6501')
  assert.equal(out.phone, undefined)
  assert.equal(out.email, undefined)
  assert.equal(out.advisorName, undefined)
  assert.equal(out.note, undefined)
})

test('sanitizeAttendanceForShare keeps active trainees and known statuses only', () => {
  const out = sanitizeAttendanceForShare({
    '2026-11-02': {
      t1: { status: 'present', time: '08:00', updatedBy: 'user-1' },
      t2: { status: 'late', note: 'รถติด' },
      ghost: { status: 'present' },
      bad: { status: 'unknown' },
    },
  }, ['t1', 't2', 'bad'])
  assert.deepEqual(out, {
    '2026-11-02': {
      t1: { status: 'present', time: '08:00', note: '' },
      t2: { status: 'late', time: '', note: 'รถติด' },
    },
  })
})

test('buildTraineeSharePayload filters archived trainees and trims the reference', () => {
  const payload = buildTraineeSharePayload({
    timetableId: 'ws-1',
    title: 'โมดูล',
    timetableTitle: 'ตาราง',
    reference: {
      timetableTitle: 'ตาราง',
      academicYear: 2569,
      term: 2,
      teachers: [{ id: 'T1', name: 'ครู' }],
      classes: [{ id: 'C1', name: 'ป.1' }],
      capturedAt: '2026-01-01T00:00:00Z',
    },
    trainees: [
      { id: 't1', name: 'หนึ่ง', phone: '0800000000' },
      { id: 't2', name: 'สอง', archived: true },
    ],
    attendance: {
      '2026-11-02': { t1: { status: 'present' }, t2: { status: 'present' } },
    },
    settings: {
      schoolName: 'โรงเรียน',
      termLabel: 'ภาคเรียนที่ 2/2569',
      signatureLeft: 'ผู้รายงาน',
      signatureRight: 'ผู้ตรวจสอบ',
      includeNotes: false,
      sortBy: 'major',
    },
    defaultType: 'range',
    dateKey: '2026-11-02',
  })

  assert.equal(payload.v, 1)
  assert.equal(payload.defaultType, 'month')
  assert.equal(payload.trainees.length, 1)
  assert.equal(payload.trainees[0].phone, undefined)
  assert.deepEqual(payload.reference, {
    timetableTitle: 'ตาราง',
    academicYear: 2569,
    term: 2,
    semesterStart: '',
    semesterEnd: '',
  })
  assert.deepEqual(Object.keys(payload.attendance), ['2026-11-02'])
  assert.deepEqual(Object.keys(payload.attendance['2026-11-02']), ['t1'])
  assert.equal(payload.settings.includeNotes, false)
  assert.equal(payload.settings.sortBy, 'major')
})

test('shared payload renders all four report periods', () => {
  const payload = buildTraineeSharePayload({
    timetableId: 'ws-1',
    title: 'โมดูล',
    reference: { academicYear: 2569, term: 2 },
    trainees: [{ id: 't1', name: 'หนึ่ง', major: 'ไทย' }],
    attendance: { '2026-11-02': { t1: { status: 'present', time: '08:00' } } },
    settings: { schoolName: 'โรงเรียน', termLabel: 'ภาคเรียนที่ 2/2569' },
    defaultType: 'daily',
    dateKey: '2026-11-02',
  })

  for (const type of ['daily', 'week', 'month', 'semester']) {
    const html = buildReportHTML({
      type,
      trainees: payload.trainees,
      attendance: payload.attendance,
      reference: payload.reference,
      settings: { ...payload.settings, dateKey: payload.dateKey },
    })
    assert.match(html, /<!doctype html>/)
    assert.match(html, /หนึ่ง/)
  }
})
