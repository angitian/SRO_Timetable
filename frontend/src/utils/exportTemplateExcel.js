/**
 * Excel Export — ฟอร์แมตเดียวกับเทมเพลตนำเข้าของหน้า 1 (Round-trip safe)
 *
 * ไฟล์ที่สร้างจะสามารถนำกลับเข้า import ผ่านหน้า 1 ได้ทั้งแบบด่วน
 * (POST /api/import/excel/import-minimum) และแบบสมบูรณ์
 * (POST /api/import/excel/import) — ครู/วิชา/ห้อง/คาบ/คาบแล็บ/เงื่อนไข/กิจกรรม ครบถ้วน
 *
 * หัวคอลัมน์/ชื่อชีท คัดลอกเป๊ะจาก backend/excel_parser.py:
 *   - MIN_TEMPLATE_HEADERS (บรรทัด 883) == FULL_COURSE_HEADERS (บรรทัด 1154)
 *   - FULL_CONSTRAINT_HEADERS (บรรทัด 1162)
 *   - FULL_FIXED_HEADERS (บรรทัด 1168)
 *
 * สิ่งสำคัญที่ทำให้ round-trip ได้:
 *   - คอลัมน์ "คาบคู่" เขียน "คู่"/"ไม่ใช่" (ไม่ใช่ "ใช่") เพราะ import_multi_sheet
 *     บรรทัด 660 ยอมรับเฉพาะ "คู่" ไม่ยอมรับ "ใช่"
 *   - กลุ่ม (ครู+วิชา+ห้อง) ที่มี block ปกติ + block แล็บ → รวม 1 แถว
 *     (คาบ/สัปดาห์ = ปกติ+แล็บ, คาบแล็บ = แล็บ) เพื่อให้ import แยกออกเป็น 2 blocks คืน
 *     (parser ใช้ has_lab = lab_periods > 0 and special_room_name and lab_periods < ppw)
 *   - block แล็บเดี่ยว → คาบแล็บ = ppw (ไม่ < ppw → ไม่ split → กลายเป็น block ห้องแล็บคืน)
 *   - ชื่อชีท Course_Mapping/Teacher_Constraints/Fixed_Slots ตรง _SHEET_ALIASES
 *
 * Public API:
 *   exportQuickTemplateExcel(data) → Promise<void>  (downloads .xlsx, 1 sheet)
 *   exportFullTemplateExcel(data, opts, filename) → Promise<void>  (multi-sheet)
 */

// ── Headers (คัดลอกจาก backend/excel_parser.py) ───────────────────────────
// MIN_TEMPLATE_HEADERS == FULL_COURSE_HEADERS (เหมือนกันทุกตัว)
const COURSE_HEADERS = [
  'ชื่อครู',
  'วิชา',
  'ห้องเรียน',
  'คาบ/สัปดาห์',
  'คาบคู่ (ใช่/ไม่ใช่)',
  'ห้องปฏิบัติการ',
  'คาบแล็บ',
]

const CONSTRAINT_HEADERS = [
  'ชื่อครู',
  'ภาระงานสูงสุด',
  'ภาระงานขั้นต่ำ',
  'ห้ามสอน',
  'บทบาทพิเศษ',
]

const FIXED_HEADERS = [
  'ชื่อกิจกรรม',
  'วัน',
  'คาบที่',
  'ห้องที่เกี่ยวข้อง',
  'ประเภท',
]

// ── admin_role mapping (ตรงกับ parser role_map บรรทัด 771-779) ────────────
const ADMIN_ROLE_TO_THAI = {
  none: '',
  finance: 'การเงิน',
  discipline: 'ปกครอง',
  dept_head: 'หัวหน้าหมวด',
}

// ── slot_type ที่ parser type_map รู้จัก (บรรทัด 823-829) ─────────────────
// หากไม่อยู่ในรายการนี้ parser จะ fallback เป็น "activity"
const KNOWN_SLOT_TYPES = new Set(['assembly', 'activity', 'homeroom', 'scout', 'club'])

// ── Helpers ────────────────────────────────────────────────────────────────

function safeFilename(name, fallback) {
  const safe = (name || '').replace(/[^\w\u0E00-\u0E7F-]+/g, '_').replace(/^_+|_+$/g, '')
  return safe || fallback
}

function todayStr() {
  return new Date().toISOString().slice(0, 10)
}

/**
 * Trigger browser download of a workbook buffer.
 */
async function downloadWorkbook(wb, filename) {
  const buffer = await wb.xlsx.writeBuffer()
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

/**
 * Auto-size columns based on header + data row lengths.
 */
function autoSizeColumns(ws, headers, rows) {
  for (let c = 0; c < headers.length; c++) {
    let maxLen = String(headers[c] || '').length
    for (const row of rows) {
      const v = row[c] != null ? String(row[c]) : ''
      if (v.length > maxLen) maxLen = v.length
    }
    ws.getColumn(c + 1).width = Math.max(maxLen + 4, 10)
  }
}

/**
 * Style header row: bold + light fill + thin border.
 */
function styleHeaderRow(ws, headers) {
  const row = ws.getRow(1)
  for (let c = 1; c <= headers.length; c++) {
    const cell = row.getCell(c)
    cell.font = { name: 'TH Sarabun New', size: 12, bold: true, color: { argb: 'FF1F2937' } }
    cell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFE2E8F0' },
    }
    cell.alignment = { horizontal: 'center', vertical: 'middle' }
    cell.border = {
      top: { style: 'thin', color: { argb: 'FFD1D5DB' } },
      bottom: { style: 'thin', color: { argb: 'FFD1D5DB' } },
      left: { style: 'thin', color: { argb: 'FFD1D5DB' } },
      right: { style: 'thin', color: { argb: 'FFD1D5DB' } },
    }
  }
  row.height = 22
}

/**
 * Apply TH Sarabun New font to all data cells.
 */
function styleDataRows(ws, headers, rows, startRow = 2) {
  for (let i = 0; i < rows.length; i++) {
    const row = ws.getRow(startRow + i)
    for (let c = 1; c <= headers.length; c++) {
      const cell = row.getCell(c)
      cell.font = { name: 'TH Sarabun New', size: 12, color: { argb: 'FF1F2937' } }
      cell.alignment = { vertical: 'middle', wrapText: true }
    }
  }
}

/**
 * Build a lookup of special rooms by id → name.
 */
function buildSpecialRoomNameMap(specialRooms) {
  const map = new Map()
  for (const sr of specialRooms || []) {
    if (sr.id) map.set(sr.id, sr.name || '')
    if (sr.name) map.set(sr.name, sr.name)
  }
  return map
}

/**
 * Resolve the lab room name for a lesson block.
 * Order: lb.special_room_name → match lb.room_id with special_rooms →
 *        match lb.room_id pattern "SR_*"
 */
function resolveLabRoomName(lb, specialRoomNameMap, specialRooms) {
  if (lb.special_room_name) return lb.special_room_name
  if (lb.room_id && specialRoomNameMap.has(lb.room_id)) {
    return specialRoomNameMap.get(lb.room_id)
  }
  // Check if room_id corresponds to a special room (not a regular classroom R_<classId>)
  if (lb.room_id && specialRooms) {
    const sr = specialRooms.find((r) => r.id === lb.room_id)
    if (sr) return sr.name || ''
  }
  return ''
}

/**
 * Group lesson_blocks by (subject_id, teacher_id, class_id) so that
 * a normal block + its lab block can be merged into a single row
 * (which the import parser will split back into 2 blocks).
 *
 * Returns: Map<groupKey, { teacherId, subjectId, classId, blocks: [...] }>
 */
function groupLessonBlocks(lessonBlocks) {
  const groups = new Map()
  for (const lb of lessonBlocks || []) {
    const key = `${lb.subject_id}||${lb.teacher_id}||${lb.class_id}`
    if (!groups.has(key)) {
      groups.set(key, {
        teacherId: lb.teacher_id,
        subjectId: lb.subject_id,
        classId: lb.class_id,
        blocks: [],
      })
    }
    groups.get(key).blocks.push(lb)
  }
  return groups
}

/**
 * Build the Course_Mapping rows from fixtureData.
 *
 * Strategy per group:
 *   - 1 block, no lab room → row: ppw, "ไม่ใช่", "", ""
 *   - 1 block, has lab room → row: ppw, "คู่"/"ไม่ใช่", labName, ppw
 *     (lab_periods == ppw → parser won't split → returns single lab block)
 *   - 2 blocks (1 normal + 1 lab) → merged row:
 *       ppw = normal_ppw + lab_ppw, labName = lab.name, lab_periods = lab_ppw
 *     (parser splits back into normal + lab blocks)
 *   - >2 blocks or other combos → emit one row per block (best-effort,
 *     may not round-trip perfectly but data is preserved)
 */
function buildCourseRows(fixtureData) {
  const {
    teachers = [],
    subjects = [],
    classes = [],
    lesson_blocks = [],
    special_rooms = [],
  } = fixtureData

  const teacherMap = new Map((teachers || []).map((t) => [t.id, t.name || '']))
  const subjectMap = new Map((subjects || []).map((s) => [s.id, s.name || '']))
  const classMap = new Map((classes || []).map((c) => [c.id, c.name || '']))
  const specialRoomNameMap = buildSpecialRoomNameMap(special_rooms)

  const groups = groupLessonBlocks(lesson_blocks)
  const rows = []
  const teachersWithBlocks = new Set()

  for (const [, group] of groups) {
    const teacherName = teacherMap.get(group.teacherId) || ''
    const subjectName = subjectMap.get(group.subjectId) || ''
    const className = classMap.get(group.classId) || ''
    if (!teacherName || !subjectName || !className) continue
    teachersWithBlocks.add(group.teacherId)

    const blocks = group.blocks
    // Identify lab blocks (those with a special_room_name or room_id matching a special room)
    const annotated = blocks.map((lb) => {
      const labName = resolveLabRoomName(lb, specialRoomNameMap, special_rooms)
      return { lb, isLab: !!labName, labName }
    })

    const labBlocks = annotated.filter((b) => b.isLab)
    const normalBlocks = annotated.filter((b) => !b.isLab)

    if (blocks.length === 1) {
      // Single block: lab or normal
      const { lb, isLab, labName } = annotated[0]
      const ppw = lb.periods_per_week || 0
      const isDouble = lb.is_double_period ? 'คู่' : 'ไม่ใช่'
      if (isLab) {
        // lab_periods == ppw → parser: has_lab = lab_periods < ppw → false → no split
        // → single block with lab room_id (preserved)
        rows.push([teacherName, subjectName, className, String(ppw), isDouble, labName, String(ppw)])
      } else {
        rows.push([teacherName, subjectName, className, String(ppw), isDouble, '', ''])
      }
    } else if (normalBlocks.length === 1 && labBlocks.length === 1) {
      // Perfect round-trip case: 1 normal + 1 lab → merge
      const normal = normalBlocks[0].lb
      const lab = labBlocks[0].lb
      const labName = labBlocks[0].labName
      const normalPpw = normal.periods_per_week || 0
      const labPpw = lab.periods_per_week || 0
      const totalPpw = normalPpw + labPpw
      // is_double: take from normal block (lab inherits same flag on import)
      const isDouble = (normal.is_double_period || lab.is_double_period) ? 'คู่' : 'ไม่ใช่'
      rows.push([
        teacherName,
        subjectName,
        className,
        String(totalPpw),
        isDouble,
        labName,
        String(labPpw),
      ])
    } else {
      // Complex case (multiple normal or multiple lab): emit one row per block.
      // Round-trip may not be perfect but data is preserved.
      for (const { lb, isLab, labName } of annotated) {
        const ppw = lb.periods_per_week || 0
        const isDouble = lb.is_double_period ? 'คู่' : 'ไม่ใช่'
        if (isLab) {
          rows.push([teacherName, subjectName, className, String(ppw), isDouble, labName, String(ppw)])
        } else {
          rows.push([teacherName, subjectName, className, String(ppw), isDouble, '', ''])
        }
      }
    }
  }

  // Append teacher-only rows (teachers with no lesson_blocks) — minimum import
  // supports this (line 1008-1010); full import will skip them (line 618) but
  // we still emit them so the data isn't lost on quick-import round-trip.
  for (const teacher of teachers || []) {
    if (!teachersWithBlocks.has(teacher.id)) {
      rows.push([teacher.name || '', '', '', '', '', '', ''])
    }
  }

  return rows
}

/**
 * Build Teacher_Constraints rows (one per teacher).
 */
function buildConstraintRows(fixtureData) {
  const { teachers = [] } = fixtureData
  const rows = []
  for (const t of teachers || []) {
    const maxPpw = t.max_periods_per_week != null ? t.max_periods_per_week : 30
    const minPpw = t.min_periods_per_week != null ? t.min_periods_per_week : 0
    // Prefer unavailable_slots; fall back to admin_free_slots so the column
    // isn't empty for admin-role teachers (fixture uses admin_free_slots).
    const blocked = (t.unavailable_slots && t.unavailable_slots.length > 0)
      ? t.unavailable_slots
      : (t.admin_free_slots || [])
    const blockedStr = (blocked || []).join(', ')
    const roleThai = ADMIN_ROLE_TO_THAI[t.admin_role] || ''
    rows.push([
      t.name || '',
      String(maxPpw),
      String(minPpw),
      blockedStr,
      roleThai,
    ])
  }
  return rows
}

/**
 * Build Fixed_Slots rows (one per fixed activity).
 * class_ids → resolve to class names joined by ", ".
 */
function buildFixedRows(fixtureData) {
  const { fixed_slots = [], classes = [] } = fixtureData
  const classMap = new Map((classes || []).map((c) => [c.id, c.name || '']))
  const rows = []
  for (const fs of fixed_slots || []) {
    const name = fs.name || 'กิจกรรม'
    const day = fs.day != null ? String(fs.day) : ''
    const period = fs.period != null ? String(fs.period) : ''
    const classIds = fs.class_ids || []
    const classNames = classIds
      .map((id) => classMap.get(id) || '')
      .filter(Boolean)
      .join(', ')
    // Use raw slot_type if known by parser, else fall back to "activity"
    const slotType = fs.slot_type && KNOWN_SLOT_TYPES.has(fs.slot_type)
      ? fs.slot_type
      : (fs.slot_type || 'activity')
    rows.push([name, day, period, classNames, slotType])
  }
  return rows
}

/**
 * Add a styled sheet with headers + rows.
 */
function addStyledSheet(wb, sheetName, headers, rows) {
  const ws = wb.addWorksheet(sheetName, { views: [{ showGridLines: false }] })
  ws.addRow(headers)
  for (const row of rows) ws.addRow(row)
  styleHeaderRow(ws, headers)
  styleDataRows(ws, headers, rows)
  autoSizeColumns(ws, headers, rows)
  return ws
}

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * Export a quick (minimum) template — 1 sheet `Course_Mapping`.
 * Round-trips through POST /api/import/excel/import-minimum.
 *
 * @param {Object} fixtureData — full fixture data from AppContext
 * @param {string} [label] — snapshot label for filename
 * @returns {Promise<void>}
 */
export async function exportQuickTemplateExcel(fixtureData, label) {
  const ExcelJS = await import('exceljs')
  const Workbook = ExcelJS.default?.Workbook || ExcelJS.Workbook
  const wb = new Workbook()
  wb.creator = 'ระบบจัดตารางสอนอัตโนมัติ'
  wb.created = new Date()

  const rows = buildCourseRows(fixtureData)
  // First (active) sheet must be Course_Mapping for minimum import
  addStyledSheet(wb, 'Course_Mapping', COURSE_HEADERS, rows)

  const safeLabel = safeFilename(label, 'ตารางสอน')
  const filename = `${safeLabel}_นำเข้าด่วน_${todayStr()}.xlsx`
  await downloadWorkbook(wb, filename)
}

/**
 * Export a full multi-sheet template — Course_Mapping (always) +
 * optional Teacher_Constraints + Fixed_Slots.
 * Round-trips through POST /api/import/excel/import.
 *
 * @param {Object} fixtureData — full fixture data from AppContext
 * @param {Object} opts
 * @param {boolean} [opts.includeConstraints=true]
 * @param {boolean} [opts.includeFixedSlots=true]
 * @param {string} [filename] — user-provided filename (without extension)
 * @returns {Promise<void>}
 */
export async function exportFullTemplateExcel(fixtureData, opts = {}, filename) {
  const { includeConstraints = true, includeFixedSlots = true } = opts
  const ExcelJS = await import('exceljs')
  const Workbook = ExcelJS.default?.Workbook || ExcelJS.Workbook
  const wb = new Workbook()
  wb.creator = 'ระบบจัดตารางสอนอัตโนมัติ'
  wb.created = new Date()

  // Sheet 1: Course_Mapping (always, must be first/active)
  const courseRows = buildCourseRows(fixtureData)
  addStyledSheet(wb, 'Course_Mapping', COURSE_HEADERS, courseRows)

  // Sheet 2: Teacher_Constraints (optional)
  if (includeConstraints) {
    const constraintRows = buildConstraintRows(fixtureData)
    addStyledSheet(wb, 'Teacher_Constraints', CONSTRAINT_HEADERS, constraintRows)
  }

  // Sheet 3: Fixed_Slots (optional)
  if (includeFixedSlots) {
    const fixedRows = buildFixedRows(fixtureData)
    addStyledSheet(wb, 'Fixed_Slots', FIXED_HEADERS, fixedRows)
  }

  const safeName = safeFilename(filename, 'ตารางสอน')
  const finalFilename = `${safeName}_${todayStr()}.xlsx`
  await downloadWorkbook(wb, finalFilename)
}
