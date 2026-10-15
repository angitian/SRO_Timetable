/**
 * Grade-level helpers shared across the frontend.
 *
 * class.grade_level convention (matches backend excel_parser.py):
 *   อ.1 = -2, อ.2 = -1, อ.3 = 0
 *   ป.1..ป.6 = 1..6
 *   ม.1..ม.6 = 7..12
 */

export const GRADE_LEVELS = [
  { label: 'อ.1', value: -2 },
  { label: 'อ.2', value: -1 },
  { label: 'อ.3', value: 0 },
  { label: 'ป.1', value: 1 },
  { label: 'ป.2', value: 2 },
  { label: 'ป.3', value: 3 },
  { label: 'ป.4', value: 4 },
  { label: 'ป.5', value: 5 },
  { label: 'ป.6', value: 6 },
  { label: 'ม.1', value: 7 },
  { label: 'ม.2', value: 8 },
  { label: 'ม.3', value: 9 },
  { label: 'ม.4', value: 10 },
  { label: 'ม.5', value: 11 },
  { label: 'ม.6', value: 12 },
]

/** Map grade_level value → label (e.g. 8 → "ม.2"). Returns undefined if unknown. */
export function gradeValueToLabel(value) {
  return GRADE_LEVELS.find((g) => g.value === value)?.label
}

/**
 * Split a Thai class name into grade label + room section.
 * "ป.1/1" → { grade: "ป.1", room: "1" }
 * "ม.6/2" → { grade: "ม.6", room: "2" }
 *
 * Falls back to the whole name as grade when the pattern doesn't match
 * (e.g. "ป.6" without a section) and room = "-".
 */
export function splitThaiClassName(name) {
  const m = String(name || '').match(/^([ปมอ]\.?\s*\d+)\s*\/\s*(.+)$/)
  if (m) return { grade: m[1], room: m[2] }
  return { grade: name, room: '-' }
}

/** Convenience: resolve a class → { grade, room } using name + grade_level. */
export function classGradeRoom(cls) {
  if (!cls) return { grade: '-', room: '-' }
  const { grade, room } = splitThaiClassName(cls.name)
  if (room === '-' && cls.grade_level !== undefined) {
    return { grade: gradeValueToLabel(cls.grade_level) || grade, room }
  }
  return { grade, room }
}
