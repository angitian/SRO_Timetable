/**
 * Grade level → Thai label, matching the codebase convention:
 *   grade 1-6   → ป.N   (ประถม)
 *   grade 7-12  → ม.N-6 (มัธยม; grade 7 = ม.1)
 *   grade <= 0  → อ.|N-1| (อนุบาล; grade 0 = อ.1, -1 = อ.2, -2 = อ.3)
 */
export function gradeLevelToLabel(v) {
  const g = Number(v)
  if (Number.isNaN(g)) return String(v)
  // อ.N = N - 3 (อ.1 = -2, อ.2 = -1, อ.3 = 0) — matches backend
  // excel_parser._extract_grade_level and specialActivitiesImport
  if (g <= 0) return `อ.${g + 3}`
  if (g <= 6) return `ป.${g}`
  return `ม.${g - 6}`
}
