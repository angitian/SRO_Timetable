/**
 * Teacher workload grouping helpers for the "ตรวจสอบตามครู" tab.
 *
 * Converts flat assignments (1 row = teacher × subject × class) into
 * 1-row-per-teacher grouped data with subject badges + workload status,
 * ready for both the on-screen table and the Excel export.
 */

export interface FlatAssignment {
  teacherId: string
  subjectId: string // รหัสวิชา (subject.id); '' for fixed-slot activities
  subjectName: string
  classId: string
  className: string // e.g. "ป.1/1"
  grade: string // e.g. "ป.1"
  room: string // e.g. "1"
  periods: number
  isActivity?: boolean
}

export interface GroupedSubject {
  subjectId: string
  subjectName: string
  rooms: string[]
  roomCount: number
  roomsText: string
  badgeText: string
  totalPeriods: number
}

export type WorkloadStatus = 'under' | 'ok' | 'over'

export interface GroupedTeacherWorkload {
  teacherId: string
  teacherName: string
  department: string
  subjects: GroupedSubject[]
  total: number
  effectiveMin: number
  max: number
  status: WorkloadStatus
  statusText: string // "[ ขาด X คาบ ]" | "[ พอดีเกณฑ์ ]" | "[ เกิน X คาบ ]"
  gap: number // negative = underload, positive = overload
}

export interface TeacherInfo {
  id: string
  name: string
  min_periods_per_week?: number
  max_periods_per_week?: number
}

export interface ClassInfo {
  id: string
  name: string
  grade_level?: number
}

export interface SubjectInfo {
  id: string
  name: string
  category?: string
}

export interface BuildGroupedWorkloadInput {
  assignments: FlatAssignment[]
  teachers: TeacherInfo[]
  classes: ClassInfo[]
  subjectMap: Map<string, SubjectInfo>
  defaultMaxPeriods?: number
}

/** subject.category → กลุ่มสาระการเรียนรู้ label (ยังไม่มี field department จริงในระบบ) */
export const CATEGORY_DEPARTMENT: Record<string, string> = {
  core: 'วิชาหลัก',
  pe: 'สุขศึกษาและพลศึกษา',
  art: 'ศิลปะ',
  music: 'ดนตรีและนาฏศิลป์',
  lab: 'วิทยาศาสตร์และเทคโนโลยี',
  admin: 'กิจกรรมพัฒนาผู้เรียน',
}

const DEFAULT_MAX_PERIODS = 22
const UNDERLOAD_RATIO = 0.75

function departmentLabel(category?: string): string {
  if (!category) return '—'
  return CATEGORY_DEPARTMENT[category] || category
}

/** Parse the leading integer of a room section ("1/2" → 1, "2" → 2). */
function sectionOf(className: string): number {
  const m = String(className).match(/(?:^|\/)\s*(\d+)/)
  return m ? parseInt(m[1], 10) : 0
}

/**
 * Build the "rooms" display text for a subject's class list.
 * Consecutive rooms (no gap in the school's own class list) → range "ป.1/1-ป.3/2 รวม 6 ห้อง".
 * Non-consecutive → comma list "ป.1/1, ป.1/2". Single room → "ป.1/1".
 */
export function buildRoomsText(rooms: string[], classes: ClassInfo[]): string {
  if (rooms.length === 0) return ''
  if (rooms.length === 1) return rooms[0]

  const classMap = new Map(classes.map((c) => [c.name, c]))
  const ordered = [...classes].sort(
    (a, b) => (a.grade_level || 0) - (b.grade_level || 0) || sectionOf(a.name) - sectionOf(b.name),
  )
  const sortedRooms = [...rooms].sort(
    (a, b) => (classMap.get(a)?.grade_level || 0) - (classMap.get(b)?.grade_level || 0) || sectionOf(a) - sectionOf(b),
  )

  const first = sortedRooms[0]
  const last = sortedRooms[sortedRooms.length - 1]
  const idxFirst = ordered.findIndex((c) => c.name === first)
  const idxLast = ordered.findIndex((c) => c.name === last)
  const consecutive = idxFirst >= 0 && idxLast > idxFirst && idxLast - idxFirst + 1 === sortedRooms.length

  if (consecutive) return `${first}-${last} รวม ${sortedRooms.length} ห้อง`
  return sortedRooms.join(', ')
}

/** Subject badge text, e.g. "วิทยาการคอมฯ (ป.1/1-ป.3/2 รวม 6 ห้อง) • 6 คาบ". */
export function subjectBadgeText(subject: GroupedSubject): string {
  return `${subject.subjectName} (${subject.roomsText}) • ${subject.totalPeriods} คาบ`
}

function computeStatus(total: number, effectiveMin: number, max: number): { status: WorkloadStatus; statusText: string; gap: number } {
  if (total > max) {
    const gap = total - max
    return { status: 'over', statusText: `[ เกิน ${gap} คาบ ]`, gap }
  }
  if (total < effectiveMin) {
    const gap = total - effectiveMin
    return { status: 'under', statusText: `[ ขาด ${effectiveMin - total} คาบ ]`, gap }
  }
  return { status: 'ok', statusText: '[ พอดีเกณฑ์ ]', gap: 0 }
}

/** กลุ่มสาระฯ ของครู = หมวดวิชาที่มีคาบรวมสูงสุด (tie → ตัวแรกที่เจอ) */
function departmentOfTeacher(teacherId: string, assignments: FlatAssignment[], subjectMap: Map<string, SubjectInfo>): string {
  const deptPeriods: Record<string, number> = {}
  const firstSeen: string[] = []
  for (const a of assignments) {
    if (a.teacherId !== teacherId) continue
    const category = subjectMap.get(a.subjectId)?.category
    if (!category) continue
    if (!(category in deptPeriods)) firstSeen.push(category)
    deptPeriods[category] = (deptPeriods[category] || 0) + a.periods
  }
  if (firstSeen.length === 0) return '—'
  firstSeen.sort((a, b) => (deptPeriods[b] || 0) - (deptPeriods[a] || 0))
  return departmentLabel(firstSeen[0])
}

/**
 * Build 1-row-per-teacher workload groups from flat assignments.
 * Totals include co-teachers and fixed-slot duties (caller provides rows already merged).
 */
export function buildGroupedWorkload(input: BuildGroupedWorkloadInput): GroupedTeacherWorkload[] {
  const { assignments, teachers, classes, subjectMap, defaultMaxPeriods } = input
  const byTeacher = new Map<string, FlatAssignment[]>()
  for (const a of assignments) {
    if (!byTeacher.has(a.teacherId)) byTeacher.set(a.teacherId, [])
    byTeacher.get(a.teacherId)!.push(a)
  }

  const groups: GroupedTeacherWorkload[] = []
  for (const t of teachers) {
    const teacherAssignments = byTeacher.get(t.id) || []
    const max = t.max_periods_per_week || defaultMaxPeriods || DEFAULT_MAX_PERIODS
    const min = t.min_periods_per_week && t.min_periods_per_week > 0
      ? t.min_periods_per_week
      : Math.round(max * UNDERLOAD_RATIO)
    const effectiveMin = Math.min(min, max)

    // group assignments by subject (key: subjectId, fallback subjectName for activities)
    const subjectMapByKey = new Map<string, { subjectId: string; subjectName: string; roomPeriods: Map<string, number> }>()
    for (const a of teacherAssignments) {
      const key = a.subjectId || a.subjectName
      let entry = subjectMapByKey.get(key)
      if (!entry) {
        entry = { subjectId: a.subjectId, subjectName: a.subjectName, roomPeriods: new Map() }
        subjectMapByKey.set(key, entry)
      }
      entry.roomPeriods.set(a.className, (entry.roomPeriods.get(a.className) || 0) + a.periods)
    }

    const subjects: GroupedSubject[] = Array.from(subjectMapByKey.values())
      .map((entry) => {
        const rooms = Array.from(entry.roomPeriods.keys())
        const totalPeriods = Array.from(entry.roomPeriods.values()).reduce((s, v) => s + v, 0)
        const roomsText = buildRoomsText(rooms, classes)
        const subject: GroupedSubject = {
          subjectId: entry.subjectId,
          subjectName: entry.subjectName,
          rooms,
          roomCount: rooms.length,
          roomsText,
          totalPeriods,
          badgeText: '',
        }
        subject.badgeText = subjectBadgeText(subject)
        return subject
      })
      .sort((a, b) => a.subjectName.localeCompare(b.subjectName, 'th'))

    const total = subjects.reduce((s, x) => s + x.totalPeriods, 0)
    const { status, statusText, gap } = computeStatus(total, effectiveMin, max)

    groups.push({
      teacherId: t.id,
      teacherName: t.name,
      department: departmentOfTeacher(t.id, teacherAssignments, subjectMap),
      subjects,
      total,
      effectiveMin,
      max,
      status,
      statusText,
      gap,
    })
  }

  groups.sort((a, b) => a.teacherName.localeCompare(b.teacherName, 'th'))
  return groups
}
