import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'vite'
import React from 'react'
import { renderToString } from 'react-dom/server'

/**
 * Regression: selecting a period in the daily substitute tab renders the
 * candidate list (with DayLoadStrip). DailyTab must receive `dayHalves`;
 * referencing it without destructuring caused "dayHalves is not defined"
 * and a white screen.
 */
test('DailyTab renders candidates after selecting a period', async () => {
  const server = await createServer({
    server: { middlewareMode: true },
    appType: 'custom',
    logLevel: 'error',
  })
  try {
    const mod = await server.ssrLoadModule('/src/features/substitute/SubstituteCenterPage.jsx')
    const DailyTab = mod.DailyTab
    assert.equal(typeof DailyTab, 'function')

    const html = renderToString(React.createElement(DailyTab, {
      dateStr: '2026-11-09',
      setDateStr: () => {},
      dayOfWeek: 1,
      teachers: [{ id: 'T1', name: 'ครู ก' }],
      subjectMap: new Map([['S1', { id: 'S1', name: 'ภาษาไทย' }]]),
      classMap: new Map([['C1', { id: 'C1', name: 'ป.1/1' }]]),
      teacherMap: new Map([['T1', { id: 'T1', name: 'ครู ก' }]]),
      slotsForTeacher: () => [],
      dayHalves: {
        morning: new Set([1, 2, 3]),
        afternoon: new Set([5, 6, 7, 8]),
      },
      absences: [],
      selectedAbsenceIdx: null,
      setSelectedAbsenceIdx: () => {},
      removeAbsence: () => {},
      onOpenAbsenceDialog: () => {},
      onEditAbsence: () => {},
      selectedSlot: {
        period: 1,
        classId: 'C1',
        subjectId: 'S1',
        teacherId: 'T1',
        role: 'main',
      },
      selectedSlotDetail: {
        subjectName: 'ภาษาไทย',
        className: 'ป.1/1',
        roomName: 'ห้องภาษาไทย',
      },
      setSelectedSlot: () => {},
      freeTeacherRows: [{
        teacher: { id: 'T1', name: 'ครู ก' },
        basePeriodsPerWeek: 10,
        subPeriodsThisWeek: 0,
        totalLoad: 10,
        isCoTeacher: false,
      }],
      freeTraineeRows: [],
      traineeCount: 0,
      traineesLoading: false,
      traineesError: '',
      onGoTrainees: () => {},
      dayPeriods: [
        { period_no: 1, type: 'STUDY' },
        { period_no: 2, type: 'STUDY' },
      ],
      teacherDayMap: new Map([
        ['T1', {
          teaching: new Set([1]),
          duty: new Set(),
          substitute: new Set(),
          details: new Map([[
            1,
            [{ subjectName: 'คณิตศาสตร์', className: 'ป.1/2', roomName: 'ห้องคณิตศาสตร์' }],
          ]]),
        }],
      ]),
      traineeDayMap: new Map(),
      assignSubstitute: () => {},
      assignTraineeSubstitute: () => {},
      assignmentStatus: () => ({ main: null, co: null }),
      assignments: [],
      removeAssignment: () => {},
      note: '',
      handleNoteChange: () => {},
      summary: {
        totalPeriods: 1,
        absentTeacherCount: 0,
        absentPositionCount: 0,
        assignedCount: 0,
        uncoveredCount: 0,
        staleAssignmentCount: 0,
        coHintCount: 0,
      },
      onShowResult: () => {},
      confirmDeleteDate: false,
      setConfirmDeleteDate: () => {},
      handleDeleteDate: () => {},
      readOnly: false,
      staleCount: 0,
      onClearStale: () => {},
      onOpenPrintStudio: () => {},
    }))

    assert.match(html, /ครู ก/)
    assert.match(html, /คาบที่เลือก/)
    assert.match(html, /ชี้ที่แถบคาบเพื่อดูวิชาและห้อง/)
    assert.match(html, /วิชา: คณิตศาสตร์/)
    assert.match(html, /ชั้น\/ห้องเรียน: ป\.1\/2/)
    assert.match(html, /ห้องที่ใช้สอน: ห้องคณิตศาสตร์/)
    assert.match(html, /สอนแทนที่เลือก: ภาษาไทย · ป\.1\/1 · ห้องภาษาไทย/)
    const namePosition = html.indexOf('ครู ก')
    const workloadPosition = html.indexOf('ภาระ ')
    const stripPosition = html.indexOf('title="คาบ 1')
    const buttonPosition = html.indexOf('>ให้สอนแทน</button>')
    assert.ok(
      namePosition < workloadPosition
      && workloadPosition < stripPosition
      && stripPosition < buttonPosition,
      'the period strip should follow name/workload and precede the substitute button',
    )
  } finally {
    await server.close()
  }
})
