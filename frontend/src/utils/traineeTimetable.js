/**
 * Trainee ↔ timetable helpers.
 *
 * Trainee records (from the trainee module) do not carry day/period fields, so
 * a trainee's daily schedule is derived from the master timetable:
 *   - match the trainee's mentor teacher (id or name), and
 *   - match the trainee's assignment subject/class (fields left blank = wildcard).
 *
 * These helpers are shared by the timetable grid and the daily substitute page.
 */
import {
  assignmentsForTrainee,
  mentorNamesForTrainee,
  normalizeText,
} from './traineeAttendance.js'

const PERSON_PREFIX_RE = /^(ครู|อาจารย์|ดร\.|นาย|นางสาว|นาง|น\.ส\.)\s*/u

/** Normalize a person name for comparison (case/space/prefix-insensitive). */
export function normalizePersonName(value) {
  return normalizeText(value).replace(PERSON_PREFIX_RE, '')
}

function cleanText(value) {
  return String(value ?? '').trim()
}

/**
 * Build a lookup index for active trainees.
 * entry = { trainee, mentorIds:Set, mentorNames:Set, assignments[], hasMentor, hasAssignmentDetail }
 */
export function buildTraineeIndex(trainees = [], { classes = [] } = {}) {
  return (trainees || [])
    .filter((t) => t && t.id && !t.archived)
    .map((trainee) => {
      const mentorNames = mentorNamesForTrainee(trainee)
      const assignments = assignmentsForTrainee(trainee, classes).map((a) => ({
        subjectId: a.subjectId || '',
        subjectName: cleanText(a.subjectName),
        classId: a.classId || '',
        className: cleanText(a.className),
        hasDetail: !!(
          a.subjectId || cleanText(a.subjectName)
          || a.classId || cleanText(a.className)
        ),
      }))
      return {
        trainee,
        mentorIds: new Set([trainee.mentorTeacherId].filter(Boolean)),
        mentorNames: new Set(mentorNames.map(normalizePersonName).filter(Boolean)),
        assignments,
        hasMentor: mentorNames.length > 0 || !!trainee.mentorTeacherId,
        hasAssignmentDetail: assignments.some((a) => a.hasDetail),
      }
    })
}

/** Teachers of a slot (main + co, resolving co from the lesson block when needed). */
function slotTeacherIds(slot, lessonBlockMap) {
  if (!slot) return []
  const lb = lessonBlockMap?.get ? lessonBlockMap.get(slot.lesson_block_id) : null
  const coId = lb?.co_teacher_id || slot.co_teacher_id || null
  return [slot.teacher_id, coId].filter(Boolean)
}

/**
 * Teachers of the slot that match this trainee's mentor(s).
 * Empty when the trainee has no mentor or the slot is not the mentor's.
 */
export function matchedMentorTeacherIds(entry, slot, { teacherMap, lessonBlockMap } = {}) {
  if (!entry?.hasMentor) return []
  return slotTeacherIds(slot, lessonBlockMap).filter((id) => {
    if (entry.mentorIds.has(id)) return true
    const name = normalizePersonName(teacherMap?.get ? teacherMap.get(id)?.name : '')
    return !!name && entry.mentorNames.has(name)
  })
}

/**
 * Does this trainee teach at this slot?
 * - mentor set → slot must belong to the mentor
 * - no assignment detail → follows the mentor's whole timetable
 * - assignment detail → at least one assignment matches every filled field
 */
export function traineeMatchesSlot(entry, slot, ctx = {}) {
  if (!entry || !slot) return false
  const { teacherMap, classMap, subjectMap } = ctx

  if (entry.hasMentor) {
    if (matchedMentorTeacherIds(entry, slot, ctx).length === 0) return false
  }
  if (!entry.hasAssignmentDetail) return entry.hasMentor

  const className = normalizeText(classMap?.get ? classMap.get(slot.class_id)?.name : '')
  const subjectName = normalizeText(subjectMap?.get ? subjectMap.get(slot.subject_id)?.name : '')

  return entry.assignments.some((a) => {
    const classOk = a.classId
      ? a.classId === slot.class_id
      : (a.className ? normalizeText(a.className) === className : true)
    const subjectOk = a.subjectId
      ? a.subjectId === slot.subject_id
      : (a.subjectName ? normalizeText(a.subjectName) === subjectName : true)
    return classOk && subjectOk
  })
}

/**
 * Names of trainees teaching at a slot (deduped).
 * `onlyMentorId` restricts mentor-backed trainees to that teacher's grid.
 */
export function traineesForSlot(index = [], slot, ctx = {}, { onlyMentorId = null } = {}) {
  const names = new Set()
  for (const entry of index || []) {
    if (!traineeMatchesSlot(entry, slot, ctx)) continue
    if (onlyMentorId && entry.hasMentor) {
      if (!matchedMentorTeacherIds(entry, slot, ctx).includes(onlyMentorId)) continue
    }
    const name = entry.trainee?.name
    if (name) names.add(name)
  }
  return [...names]
}

/** Is `teacherId` / `teacherName` one of this trainee's mentors? */
export function traineeHasMentor(entry, teacherId, teacherName) {
  if (!entry?.hasMentor) return false
  if (teacherId && entry.mentorIds.has(teacherId)) return true
  const name = normalizePersonName(teacherName)
  return !!name && entry.mentorNames.has(name)
}

function periodInRange(period, range, halves) {
  if (!range || range === 'all' || !halves) return true
  if (range === 'morning') return halves.morning?.has(period) ?? true
  if (range === 'afternoon') return halves.afternoon?.has(period) ?? true
  return true
}

/**
 * Is the trainee's mentor absent at this slot?
 * - mentor-backed trainee → only the matched mentor's absence counts
 * - mentor-less trainee → the slot's main teacher is the reference
 */
export function isTraineeMentorAbsent(entry, slot, {
  absenceMap, halves, lessonBlockMap, teacherMap,
} = {}) {
  if (!absenceMap || !slot) return false
  const ids = entry?.hasMentor
    ? matchedMentorTeacherIds(entry, slot, { teacherMap, lessonBlockMap })
    : [slot.teacher_id].filter(Boolean)
  return ids.some((id) => {
    const absence = absenceMap.get(id)
    return !!absence && periodInRange(slot.period, absence.periodRange, halves)
  })
}

/** Union of period sets (teaching + substitute). */
export function unionPeriods(...sets) {
  const out = new Set()
  for (const set of sets) {
    for (const p of set || []) out.add(p)
  }
  return out
}

/** จำนวนคาบที่สอนจริงในวันนั้น (teaching + substitute, ไม่นับ duty) */
export function dayTeachingCount(teaching, substitute) {
  return unionPeriods(teaching, substitute).size
}

/** ข้อความบอกว่าคาบที่เลือกติดกับคาบอื่นหรือไม่ */
export function describeAdjacency({ before, after } = {}) {
  if (before && after) return 'ติดคาบก่อนและถัดไป'
  if (before) return 'ติดคาบก่อน'
  if (after) return 'ติดคาบถัดไป'
  return 'ไม่ติดคาบอื่น'
}

/**
 * Adjacency of the selected substitute period to other busy periods.
 * Uses the real ordered period list (BREAK/LUNCH removed) and requires both
 * periods to be in the same morning/afternoon half so lunch is a boundary.
 */
export function computePeriodAdjacency({ periods = [], markerPeriod = null, busy, halves } = {}) {
  const list = (periods || [])
    .filter((p) => p && p.type !== 'BREAK' && p.type !== 'LUNCH')
    .map((p) => p.period_no)
  const idx = list.indexOf(markerPeriod)
  const prev = idx > 0 ? list[idx - 1] : null
  const next = idx >= 0 && idx < list.length - 1 ? list[idx + 1] : null
  const sameHalf = (a, b) => {
    if (!halves) return true
    return (halves.morning?.has(a) && halves.morning?.has(b))
      || (halves.afternoon?.has(a) && halves.afternoon?.has(b))
  }
  const busySet = busy instanceof Set ? busy : new Set(busy || [])
  return {
    prevPeriod: prev,
    nextPeriod: next,
    before: prev != null && sameHalf(prev, markerPeriod) && busySet.has(prev),
    after: next != null && sameHalf(next, markerPeriod) && busySet.has(next),
  }
}
