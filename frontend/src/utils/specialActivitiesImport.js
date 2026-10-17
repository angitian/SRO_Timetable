/**
 * Import กิจกรรมพิเศษ (คาบพิเศษ / ล็อกสล็อต) จากไฟล์ xlsx — ทุกอย่างทำฝั่ง browser
 *
 * รูปแบบคอลัมน์ที่รองรับ (ตัวอย่างไฟล์ คาบ.xlsx):
 *   ชื่อกิจกรรม | ช่วงชั้น/ห้อง | วัน | คาบ | จำนวนคาบ | ครูผู้สอน | ตรึงคาบ
 *   ลูกเสือ    | ป.1,ป.2,ป.3 | พุธ | 6,7 |    2     | ลลิล, ... | TRUE
 *
 * Flow:
 *   1. parseSpecialActivitiesExcel(arrayBuffer) → อ่านไฟล์ + ตรวจคอลัมน์ + แปลงแถวเป็น raw rows
 *   2. resolveToFixedSlots(rows, { classes, teachers }) → map เป็น fixed_slots ของ fixtureData
 */

// ── Column auto-detection (normalized substring match เหมือน auto_map_columns ฝั่ง backend) ──

const COLUMN_LABELS = {
  name: [
    'ชื่อกิจกรรม', 'กิจกรรม', 'ชื่อ', 'รายการ', 'activity', 'name', 'activity name',
  ],
  classes: [
    'ช่วงชั้น/ห้อง', 'ช่วงชั้น', 'ห้องที่เกี่ยวข้อง', 'ห้อง', 'ระดับชั้น', 'ชั้น',
    'class', 'classes', 'class_ids', 'classes affected',
  ],
  day: ['วัน', 'วันที่', 'day', 'day_of_week'],
  period: ['คาบ', 'คาบที่', 'period', 'period_num', 'periods'],
  periodCount: ['จำนวนคาบ', 'จำนวนคาบที่ล็อก', 'จำนวน', 'period_count', 'num_periods'],
  teachers: [
    'ครูผู้สอน', 'ครูผู้ดูแล', 'ครูดูแล', 'ครู', 'teachers', 'teacher', 'ครูผู้สอน(คั่นด้วยเครื่องหมายจุลภาค)',
  ],
  fix: ['ตรึงคาบ', 'ล็อกคาบ', 'ตรึง', 'fix', 'fixed', 'fix period'],
}

function normalizeText(s) {
  return String(s || '').toLowerCase().replace(/[\s_]+/g, '').trim()
}

/** หา index คอลัมน์จาก header — exact normalized match ก่อน แล้วค่อย substring */
function detectColumns(headers) {
  const normHeaders = headers.map(normalizeText)
  const idx = {}
  const used = new Set()
  // Pass 1: exact
  for (const [field, labels] of Object.entries(COLUMN_LABELS)) {
    for (const label of labels) {
      const nl = normalizeText(label)
      const i = normHeaders.findIndex((h, j) => !used.has(j) && h === nl)
      if (i >= 0) { idx[field] = i; used.add(i); break }
    }
  }
  // Pass 2: substring (header contains label หรือ label contains header)
  for (const [field, labels] of Object.entries(COLUMN_LABELS)) {
    if (idx[field] !== undefined) continue
    for (const label of labels) {
      const nl = normalizeText(label)
      if (nl.length < 2) continue
      const i = normHeaders.findIndex((h, j) =>
        !used.has(j) && h && (h.includes(nl) || (h.length >= 3 && nl.includes(h)))
      )
      if (i >= 0) { idx[field] = i; used.add(i); break }
    }
  }
  return idx
}

// ── Day parsing (mirror _THAI_DAY_MAP/_EN_DAY_MAP ใน backend/excel_parser.py) ──

const THAI_DAY_MAP = {
  'จันทร์': 1, 'จันทร': 1,
  'อังคาร': 2,
  'พุธ': 3,
  'พฤหัส': 4, 'พฤหัสบดี': 4, 'พฤ': 4,
  'ศุกร์': 5, 'ศุกร': 5,
  'เสาร์': 6, 'เสาร': 6,
  'อาทิตย์': 7, 'อาทิตย': 7,
}
const EN_DAY_MAP = {
  monday: 1, mon: 1, tuesday: 2, tue: 2, wednesday: 3, wed: 3,
  thursday: 4, thu: 4, friday: 5, fri: 5, saturday: 6, sat: 6,
  sunday: 7, sun: 7,
}

function parseDayValue(raw) {
  if (!raw) return null
  const s = String(raw).trim()
  const n = parseInt(s, 10)
  if (!Number.isNaN(n) && n >= 1 && n <= 7 && /^\d+$/.test(s)) return n
  const lower = s.toLowerCase()
  for (const [name, num] of Object.entries(THAI_DAY_MAP)) {
    if (s === name || s.startsWith(name)) return num
  }
  for (const [name, num] of Object.entries(EN_DAY_MAP)) {
    if (lower === name || lower.startsWith(name)) return num
  }
  return null
}

// ── Period list parsing ("6" | "6,7" | "5-7") — mirror _parse_period_list ──

export function parsePeriodList(raw) {
  if (!raw) return []
  const out = []
  for (const part of String(raw).replace('และ', ',').split(',')) {
    const p = part.trim()
    if (!p) continue
    if (p.includes('-') || p.includes('–')) {
      const [a, b] = p.split(/[-–]/, 2)
      const lo = parseInt(a, 10)
      const hi = parseInt(b, 10)
      if (!Number.isNaN(lo) && !Number.isNaN(hi)) {
        for (let i = Math.min(lo, hi); i <= Math.max(lo, hi); i++) out.push(i)
      }
    } else {
      const m = p.match(/\d+/)
      if (m) out.push(parseInt(m[0], 10))
    }
  }
  return [...new Set(out)].sort((a, b) => a - b)
}

// ── Grade spec parsing ("ป.1,ป.2,ป.3" | "ป.1-3" | "ม.1,ม.2" | "ทุกห้อง") ──

/** "ป" → +0, "ม" → +6, "อ" → -3 (เทียบ backend _extract_grade_level) */
const GRADE_PREFIX_OFFSET = { 'ป': 0, 'ม': 6, 'อ': -3 }

function tokenToGradeValue(tok, inheritPrefix) {
  const m = String(tok).trim().match(/^([ปมอ])?\.?\s*(\d+)$/)
  if (!m) return null
  const prefix = m[1] || inheritPrefix
  if (!prefix || !(prefix in GRADE_PREFIX_OFFSET)) return null
  return parseInt(m[2], 10) + GRADE_PREFIX_OFFSET[prefix]
}

/**
 * แปลงช่วงชั้นเป็นชุด grade_level
 * Returns { gradeValues: number[], allClasses: bool }
 * allClasses = true เมื่อเขียนว่า ทุกห้อง/all (คำแรกที่เจอให้ทันที)
 */
export function parseGradeSpec(raw) {
  const s = String(raw || '').trim()
  if (!s) return { gradeValues: [], allClasses: true }
  const tokens = s.replace('และ', ',').split(',').map((t) => t.trim()).filter(Boolean)
  for (const t of tokens) {
    if (/^(ทุกห้อง|ทุกห้องเรียน|ทุกชั้น|all|every)$/i.test(t)) {
      return { gradeValues: [], allClasses: true }
    }
  }
  const values = new Set()
  for (const t of tokens) {
    if (/[-–]/.test(t)) {
      const [a, b] = t.split(/[-–]/, 2)
      const prefixA = a.match(/[ปมอ]/)?.[0] || null
      const lo = tokenToGradeValue(a, null)
      const hi = tokenToGradeValue(b, prefixA)
      if (lo !== null && hi !== null) {
        for (let g = Math.min(lo, hi); g <= Math.max(lo, hi); g++) values.add(g)
      }
      continue
    }
    const g = tokenToGradeValue(t, null)
    if (g !== null) values.add(g)
  }
  return { gradeValues: [...values].sort((a, b) => a - b), allClasses: false }
}

// ── slot_type inference จากชื่อกิจกรรม (ตรงกับ SLOT_TYPES / ACTIVITY_PRESETS) ──

function inferSlotType(name) {
  const n = normalizeText(name)
  if (n.includes('ลูกเสือ') || n.includes('เนตรนารี') || n.includes('scout')) return 'scout'
  if (n.includes('โฮมรูม') || n.includes('homeroom') || n.includes('homeroom')) return 'homeroom'
  if (n.includes('ชุมนุม') || n.includes('club')) return 'club'
  if (n.includes('เคารพธงชาติ') || n.includes('รวมชั้น') || n.includes('assembly')) return 'assembly'
  if (n.includes('แนะแนว') || n.includes('guidance')) return 'guidance'
  if (n.includes('รด') || n.includes('rotc')) return 'rotc'
  return 'other'
}

function parseBoolCell(raw) {
  if (raw === undefined || raw === null || String(raw).trim() === '') return null
  if (typeof raw === 'boolean') return raw
  const s = normalizeText(raw)
  if (['true', '1', 'yes', 'y', 'ใช่', 'ตรึง', 'x', 'v'].includes(s)) return true
  if (['false', '0', 'no', 'n', 'ไม่ใช่', 'ไม่ตรึง', ''].includes(s)) return false
  return null
}

// ── Excel cell helpers ──

function cellToRaw(v) {
  if (v === null || v === undefined) return ''
  if (typeof v === 'object') {
    if (Array.isArray(v.richText)) return v.richText.map((rt) => rt.text || '').join('')
    if (v.text !== undefined) return v.text
    if (v.result !== undefined) return cellToRaw(v.result)
    return ''
  }
  return v
}

function cellToString(v) {
  return String(cellToRaw(v)).trim()
}

/**
 * อ่านไฟล์ xlsx (ArrayBuffer) แล้วแปลงแต่ละแถวเป็น raw activity row
 * Returns { rows: Array, warnings: string[], detectedHeaders: string[] }
 *   rows: { rowIndex, name, slotType, day, periods, gradeValues, allClasses,
 *           teacherNames, isFixed, skippedReason?, error? }
 */
export async function parseSpecialActivitiesExcel(arrayBuffer) {
  const ExcelJS = await import('exceljs')
  const Workbook = ExcelJS.default?.Workbook || ExcelJS.Workbook
  const wb = new Workbook()
  await wb.xlsx.load(arrayBuffer)
  const ws = wb.worksheets[0]
  if (!ws || ws.rowCount === 0) {
    throw new Error('ไฟล์ว่างเปล่า หรือไม่พบชีท')
  }

  // หา header row — ลอง row 1 ก่อน; ถ้า detect ไม่ได้ ให้ลอง row 2 (เผื่อมี title row)
  let headerRowNo = 1
  let headers = []
  let colIdx = {}
  for (const candidate of [1, 2]) {
    const row = ws.getRow(candidate)
    headers = []
    for (let c = 1; c <= ws.columnCount; c++) {
      headers.push(cellToString(row.getCell(c).value))
    }
    colIdx = detectColumns(headers)
    if (colIdx.name !== undefined && (colIdx.day !== undefined || colIdx.period !== undefined)) {
      headerRowNo = candidate
      break
    }
  }

  if (colIdx.name === undefined || colIdx.day === undefined || colIdx.period === undefined) {
    throw new Error(
      `ไม่พบคอลัมน์ที่จำเป็น (ต้องมี: ชื่อกิจกรรม, วัน, คาบ) — headers ที่เจอ: ${headers.filter(Boolean).join(', ') || 'ไม่มี'}`
    )
  }

  const getVal = (values, field) =>
    colIdx[field] !== undefined ? (values[colIdx[field]] ?? '') : ''

  const rows = []
  const warnings = []

  for (let r = headerRowNo + 1; r <= ws.rowCount; r++) {
    const row = ws.getRow(r)
    const values = []
    let allEmpty = true
    for (let c = 0; c < headers.length; c++) {
      const raw = cellToRaw(row.getCell(c + 1).value)
      values.push(raw)
      if (String(raw).trim() !== '') allEmpty = false
    }
    if (allEmpty) continue

    const name = cellToString(getVal(values, 'name'))
    const classesRaw = cellToString(getVal(values, 'classes'))
    const dayRaw = cellToString(getVal(values, 'day'))
    const periodRaw = cellToString(getVal(values, 'period'))
    const countRaw = cellToString(getVal(values, 'periodCount'))
    const teachersRaw = cellToString(getVal(values, 'teachers'))
    const isFixed = parseBoolCell(getVal(values, 'fix')) ?? true // ค่าว่าง = ตรึง (default ของระบบ)

    const base = { rowIndex: r, name, classesRaw, dayRaw, periodRaw, teachersRaw, isFixed }

    if (!name) {
      rows.push({ ...base, error: 'ไม่มีชื่อกิจกรรม' })
      continue
    }
    if (!isFixed) {
      rows.push({ ...base, skippedReason: 'ตรึงคาบ = ไม่ใช่ → ข้าม (ระบบรองรับเฉพาะกิจกรรมตรึงคาบ)' })
      continue
    }
    const day = parseDayValue(dayRaw)
    if (day === null) {
      rows.push({ ...base, error: `อ่านวันไม่ได้: "${dayRaw}"` })
      continue
    }
    let periods = parsePeriodList(periodRaw)
    const count = parseInt(countRaw, 10)
    if (!Number.isNaN(count) && count > periods.length && periods.length > 0) {
      // เช่น คาบ "6" + จำนวนคาบ 3 → ขยายเป็น [6,7,8]
      const last = periods[periods.length - 1]
      const missing = count - periods.length
      for (let j = 1; j <= missing; j++) periods.push(last + j)
      periods = [...new Set(periods)].sort((a, b) => a - b)
    }
    if (periods.length === 0) {
      rows.push({ ...base, error: `ไม่พบ/อ่านคาบไม่ได้: "${periodRaw}"` })
      continue
    }

    const { gradeValues, allClasses } = parseGradeSpec(classesRaw)
    const teacherNames = teachersRaw
      .split(/[,，;、]/).map((t) => t.trim()).filter(Boolean)

    rows.push({
      ...base,
      slotType: inferSlotType(name),
      day,
      periods,
      gradeValues,
      allClasses,
      teacherNames,
    })
  }

  return { rows, warnings, detectedHeaders: headers }
}

/**
 * แปลง raw rows → fixed_slots ของ fixtureData
 * classes/teachers: จาก fixtureData (ใช้ resolve grade→class_id, ชื่อครู→teacher_id)
 * Returns { slots: FixedSlot[], warnings: string[] }
 */
export function resolveToFixedSlots(rows, { classes = [], teachers = [] }) {
  const slots = []
  const warnings = []
  const teacherIdByName = new Map()
  for (const t of teachers) {
    const key = normalizeText(t.name)
    if (key && !teacherIdByName.has(key)) teacherIdByName.set(key, t.id)
  }

  let i = 0
  for (const r of rows) {
    i++
    if (r.error) {
      warnings.push(`แถว ${r.rowIndex} "${r.name || '(ว่าง)'}": ${r.error} → ข้าม`)
      continue
    }
    if (r.skippedReason) {
      warnings.push(`แถว ${r.rowIndex} "${r.name}": ${r.skippedReason}`)
      continue
    }
    // backend FixedSlot: day 1–5 (จันทร์–ศุกร์), period 1–10
    if (r.day > 5) {
      warnings.push(`แถว ${r.rowIndex} "${r.name}": วัน "${r.dayRaw}" อยู่นอกช่วงจันทร์–ศุกร์ → ข้าม`)
      continue
    }
    if (r.periods.some((p) => p < 1 || p > 10)) {
      warnings.push(`แถว ${r.rowIndex} "${r.name}": คาบ "${r.periodRaw}" อยู่นอกช่วง 1–10 → ข้าม`)
      continue
    }

    // grade → class_ids (ว่าง = ทุกห้อง เฉพาะเมื่อเขียน ทุกห้อง เท่านั้น)
    let classIds
    if (r.allClasses) {
      classIds = []
    } else {
      const gradeSet = new Set(r.gradeValues)
      classIds = classes.filter((c) => gradeSet.has(c.grade_level)).map((c) => c.id)
      if (classIds.length === 0) {
        warnings.push(
          `แถว ${r.rowIndex} "${r.name}": ไม่พบห้องของชั้น "${r.classesRaw}" ในระบบ → ข้าม (สร้างห้องเรียนใน Step 1 ก่อน)`
        )
        continue
      }
    }

    // ชื่อครู → teacher_id (ข้ามชื่อที่ไม่รู้จัก + เตือน)
    const tids = []
    const unknown = []
    for (const tn of r.teacherNames || []) {
      const tid = teacherIdByName.get(normalizeText(tn))
      if (tid) {
        if (!tids.includes(tid)) tids.push(tid)
      } else {
        unknown.push(tn)
      }
    }
    if (unknown.length) {
      warnings.push(`แถว ${r.rowIndex} "${r.name}": ไม่พบครูชื่อ "${unknown.join(', ')}" → ข้ามชื่อเหล่านี้`)
    }

    // ครูผู้ดูแลรายชั้น: ครูทุกคนในรายการดูแลทุกห้องในช่วงชั้น
    // (ระบบนับภาระ 1 คาบ/สัปดาห์/ครู/กิจกรรม ไม่คูณจำนวนห้อง + solver กันครูชนเวลาอยู่แล้ว)
    const targetCids = classIds.length > 0 ? classIds : classes.map((c) => c.id)
    const class_teachers = {}
    for (const cid of targetCids) {
      class_teachers[cid] = [...tids]
    }

    slots.push({
      id: `FS_${Date.now()}_${i}`,
      name: r.name,
      slot_type: r.slotType,
      day: r.day,
      period: r.periods[0],
      periods: r.periods.slice(1),
      class_ids: classIds,
      class_teachers,
    })
  }

  return { slots, warnings }
}
