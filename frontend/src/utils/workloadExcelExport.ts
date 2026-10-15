/**
 * Export the teacher workload summary to a multi-sheet Excel workbook via xlsx-js-style.
 * (fork of SheetJS that writes cell styles into the .xlsx file — plain `xlsx` strips them)
 *
 * Sheet 1 "สรุปภาระงานรายครู" — executive/balancing view, 1 row per teacher,
 *                                sorted by workload (มาก → น้อย). Each subject on
 *                                its own line (wrapText), status cell color-coded.
 * Sheet 2 "รายละเอียดรายวิชาและห้อง" — raw flat data, 1 row per subject × room,
 *                                ready for filtering / pivot.
 */
import type { GroupedTeacherWorkload, FlatAssignment } from './workloadGrouping.ts'

export interface WorkloadExcelOptions {
  title?: string
  groups: GroupedTeacherWorkload[]
  detailAssignments: FlatAssignment[]
}

const HEADER_FILL = { patternType: 'solid', fgColor: { rgb: '1E3A8A' } }
const HEADER_FONT = { bold: true, color: { rgb: 'FFFFFF' } }
const CENTER = { horizontal: 'center', vertical: 'middle' }

/** แถบสีสถานะ: แดง = เกิน, ส้ม = ขาด, เขียว = ปกติ */
const STATUS_STYLE: Record<string, { fill: object; font: object }> = {
  over: { fill: { patternType: 'solid', fgColor: { rgb: 'FECACA' } }, font: { bold: true, color: { rgb: 'B91C1C' } } },
  under: { fill: { patternType: 'solid', fgColor: { rgb: 'FED7AA' } }, font: { bold: true, color: { rgb: 'C2410C' } } },
  ok: { fill: { patternType: 'solid', fgColor: { rgb: 'D1FAE5' } }, font: { bold: true, color: { rgb: '166534' } } },
}

function headerCell(v: string) {
  return { v, s: { font: HEADER_FONT, fill: HEADER_FILL, alignment: { ...CENTER, wrapText: true } } }
}

function centerCell(v: unknown) {
  return { v, s: { alignment: CENTER } }
}

/** ความสูงแถวโดยประมาณตามจำนวนบรรทัด (min 18pt) ให้ wrap แสดงครบ */
function rowHeight(lineCount: number): number {
  return Math.max(18, lineCount * 14)
}

export async function exportWorkloadExcel(options: WorkloadExcelOptions): Promise<void> {
  const { title = 'ตารางภาระงานครู', groups, detailAssignments } = options
  const mod = await import('xlsx-js-style')
  const XLSX = (mod as { default?: typeof mod }).default ?? mod

  const wb = XLSX.utils.book_new()

  // ── Sheet 1: สรุปภาระงานรายครู (Executive) ─────────────────────────────
  const sorted = [...groups].sort((a, b) => b.total - a.total)
  const sheet1Header = ['ลำดับ', 'ชื่อ-สกุล ครูผู้สอน', 'กลุ่มสาระฯ', 'รายวิชาและห้องที่สอน', 'ภาระงานจริง (คาบ/สัปดาห์)', 'เกณฑ์ภาระงาน (คาบ)', 'สถานะการเกลี่ยงาน']
  const sheet1Rows: unknown[][] = [sheet1Header.map(headerCell)]
  const sheet1Heights: { hpt: number }[] = [{ hpt: 26 }]

  sorted.forEach((g, i) => {
    const subjectText = g.subjects
      .map((s) => `${s.subjectName} (${s.roomsText}) [${s.totalPeriods} คาบ]`)
      .join('\n') || '—'
    const statusText = g.status === 'over'
      ? `ภาระงานเกิน (+${g.gap})`
      : g.status === 'under'
        ? `ภาระงานขาด (-${-g.gap})`
        : 'ปกติ'
    const lineCount = Math.max(1, subjectText.split('\n').length)
    sheet1Rows.push([
      centerCell(i + 1),
      g.teacherName,
      g.department,
      { v: subjectText, s: { alignment: { vertical: 'top', wrapText: true } } },
      centerCell(g.total),
      centerCell(`${g.effectiveMin}-${g.max}`),
      { v: statusText, s: { ...STATUS_STYLE[g.status], alignment: CENTER } },
    ])
    sheet1Heights.push({ hpt: rowHeight(lineCount) })
  })

  const ws1 = XLSX.utils.aoa_to_sheet(sheet1Rows)
  ws1['!cols'] = [{ wch: 6 }, { wch: 30 }, { wch: 20 }, { wch: 72 }, { wch: 14 }, { wch: 14 }, { wch: 20 }]
  ws1['!rows'] = sheet1Heights
  ws1['!freeze'] = { xSplit: 0, ySplit: 1 }
  XLSX.utils.book_append_sheet(wb, ws1, 'สรุปภาระงานรายครู')

  // ── Sheet 2: รายละเอียดรายวิชาและห้อง (Flat) ───────────────────────────
  const departmentByTeacher = new Map(groups.map((g) => [g.teacherId, g.department]))
  const teacherOrder = new Map(groups.map((g, i) => [g.teacherId, i]))
  const sortedAssignments = [...detailAssignments].sort(
    (a, b) => (teacherOrder.get(a.teacherId) ?? 0) - (teacherOrder.get(b.teacherId) ?? 0) || a.className.localeCompare(b.className, 'th'),
  )

  const sheet2Header = ['ลำดับ', 'ชื่อ-สกุล ครู', 'กลุ่มสาระฯ', 'รหัสวิชา', 'ชื่อวิชา', 'ระดับชั้น', 'ห้อง', 'จำนวนคาบ/สัปดาห์']
  const sheet2Rows: unknown[][] = [sheet2Header.map(headerCell)]

  sortedAssignments.forEach((a, i) => {
    sheet2Rows.push([
      centerCell(i + 1),
      a.teacherName,
      departmentByTeacher.get(a.teacherId) || '—',
      a.subjectId || '-',
      a.subjectName,
      a.grade,
      a.room,
      centerCell(a.periods),
    ])
  })

  const ws2 = XLSX.utils.aoa_to_sheet(sheet2Rows)
  ws2['!cols'] = [{ wch: 6 }, { wch: 30 }, { wch: 20 }, { wch: 16 }, { wch: 30 }, { wch: 12 }, { wch: 12 }, { wch: 16 }]
  ws2['!rows'] = [{ hpt: 26 }]
  ws2['!freeze'] = { xSplit: 0, ySplit: 1 }
  ws2['!autofilter'] = { ref: 'A1:H1' }
  XLSX.utils.book_append_sheet(wb, ws2, 'รายละเอียดรายวิชาและห้อง')

  // ── Download ──────────────────────────────────────────────────────────
  const buffer = XLSX.write(wb, { bookType: 'xlsx', type: 'array' }) as ArrayBuffer
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${(title || 'ตารางภาระงานครู').replace(/[^\w\u0E00-\u0E7F-]+/g, '_')}.xlsx`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}
