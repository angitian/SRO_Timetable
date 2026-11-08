import { STATUSES } from './traineeAttendance.js'

/**
 * Public share payload for the trainee attendance module.
 *
 * The payload is stored server-side behind a 6-char short code and rendered by
 * the public viewer (/view?tr=CODE). Keep it limited to the fields the printed
 * reports actually use — trainee phone/email/advisor must never leak through
 * the public API.
 */

export const SHARE_PERIODS = [
  { value: 'daily', label: 'รายวัน' },
  { value: 'week', label: 'รายสัปดาห์' },
  { value: 'month', label: 'รายเดือน' },
  { value: 'semester', label: 'รายภาคเรียน' },
]

export function normalizeSharePeriod(type) {
  if (type === 'range' || type === 'student') return 'month'
  if (type === 'dashboard') return 'semester'
  return SHARE_PERIODS.some((p) => p.value === type) ? type : 'month'
}

function cleanText(value) {
  return String(value ?? '').trim()
}

function cleanList(value) {
  if (Array.isArray(value)) return value.map(cleanText).filter(Boolean)
  if (!value) return []
  return String(value).split(/[,;\n]/).map(cleanText).filter(Boolean)
}

function cleanPeriods(value) {
  if (value === '' || value == null) return null
  return Math.max(0, Number(value) || 0)
}

function sanitizeAssignment(assignment = {}) {
  return {
    subjectName: cleanText(assignment.subjectName),
    className: cleanText(assignment.className),
    roomNames: cleanList(assignment.roomNames),
    weeklyPeriods: cleanPeriods(assignment.weeklyPeriods),
  }
}

export function sanitizeTraineeForShare(trainee = {}) {
  const out = {
    id: trainee.id,
    name: cleanText(trainee.name),
    studentCode: cleanText(trainee.studentCode),
    major: cleanText(trainee.major),
    institution: cleanText(trainee.institution),
    mentorNames: cleanList(trainee.mentorNames),
    mentorTeacherName: cleanText(trainee.mentorTeacherName),
    subjectName: cleanText(trainee.subjectName),
    className: cleanText(trainee.className),
    roomName: cleanText(trainee.roomName),
    roomNames: cleanList(trainee.roomNames || trainee.roomName),
    weeklyPeriods: cleanPeriods(trainee.weeklyPeriods),
  }
  if (Array.isArray(trainee.assignments) && trainee.assignments.length > 0) {
    out.assignments = trainee.assignments.map(sanitizeAssignment)
  }
  return out
}

export function sanitizeAttendanceForShare(attendance = {}, traineeIds = []) {
  const allowed = new Set(traineeIds)
  const out = {}
  for (const [dateKey, day] of Object.entries(attendance || {})) {
    if (!day || typeof day !== 'object') continue
    const records = {}
    for (const [traineeId, record] of Object.entries(day)) {
      if (!allowed.has(traineeId)) continue
      if (!STATUSES.includes(record?.status)) continue
      records[traineeId] = {
        status: record.status,
        time: cleanText(record.time),
        note: cleanText(record.note),
      }
    }
    if (Object.keys(records).length > 0) out[dateKey] = records
  }
  return out
}

export function sanitizeReferenceForShare(reference = null) {
  if (!reference) return null
  return {
    timetableTitle: cleanText(reference.timetableTitle),
    academicYear: reference.academicYear ?? null,
    term: reference.term ?? null,
    semesterStart: reference.semesterStart || '',
    semesterEnd: reference.semesterEnd || '',
  }
}

export function buildTraineeSharePayload({
  timetableId,
  title = '',
  timetableTitle = '',
  reference = null,
  trainees = [],
  attendance = {},
  settings = {},
  defaultType = 'month',
  dateKey,
}) {
  const activeTrainees = (trainees || []).filter((t) => !t?.archived)
  const sanitizedTrainees = activeTrainees.map(sanitizeTraineeForShare)
  return {
    v: 1,
    timetableId,
    title: cleanText(title),
    timetableTitle: cleanText(timetableTitle),
    reference: sanitizeReferenceForShare(reference),
    trainees: sanitizedTrainees,
    attendance: sanitizeAttendanceForShare(attendance, sanitizedTrainees.map((t) => t.id)),
    settings: {
      schoolName: cleanText(settings.schoolName),
      termLabel: cleanText(settings.termLabel),
      signatureLeft: cleanText(settings.signatureLeft) || 'ผู้รายงาน',
      signatureRight: cleanText(settings.signatureRight) || 'ผู้ตรวจสอบ',
      includeNotes: settings.includeNotes !== false,
      sortBy: settings.sortBy || 'name',
    },
    defaultType: normalizeSharePeriod(defaultType),
    dateKey,
    sharedAt: new Date().toISOString(),
  }
}
