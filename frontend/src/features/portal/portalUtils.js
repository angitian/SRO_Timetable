/**
 * Pure helpers for the portal UI (ปฏิทิน / สถานะกล่อง / ความคืบหน้า / ข้อความเตือน).
 *
 * Kept free of React and DOM so `node --test` can exercise them directly.
 */

export const THAI_MONTHS_SHORT = [
  '', 'ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.',
  'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.',
]

export const THAI_MONTHS_FULL = [
  '', 'มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน',
  'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม',
]

export const DAY_LABELS = ['', 'จันทร์', 'อังคาร', 'พุธ', 'พฤหัสบดี', 'ศุกร์', 'เสาร์', 'อาทิตย์']
export const DAY_SHORT = ['จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส', 'อา']

export const ALLOWED_EXT = ['.pdf', '.docx', '.xlsx', '.zip']
export const MAX_UPLOAD_MB = 25

/** สถานะการส่ง → ป้าย/สี (ตรงกับ 🟩 🟨 🟥) */
export const STATUS_META = {
  submitted: { label: 'ส่งแล้ว', short: 'ส่งแล้ว', dot: '🟩', tone: 'emerald', className: 'bg-emerald-100 text-emerald-800 border-emerald-200' },
  late: { label: 'ส่งช้า', short: 'ส่งช้า', dot: '🟨', tone: 'amber', className: 'bg-amber-100 text-amber-800 border-amber-200' },
  missing: { label: 'ค้างส่ง', short: 'ค้างส่ง', dot: '🟥', tone: 'rose', className: 'bg-rose-100 text-rose-800 border-rose-200' },
  complete: { label: 'ส่งครบ', short: 'ครบ', dot: '🟩', tone: 'emerald', className: 'bg-emerald-100 text-emerald-800 border-emerald-200' },
  partial: { label: 'ยังไม่ครบ', short: 'ไม่ครบ', dot: '🟨', tone: 'amber', className: 'bg-amber-100 text-amber-800 border-amber-200' },
  not_targeted: { label: 'ไม่เกี่ยวข้อง', short: '—', dot: '⬜', tone: 'slate', className: 'bg-slate-100 text-slate-500 border-slate-200' },
}

export function statusMeta(status) {
  return STATUS_META[status] || STATUS_META.missing
}

export function todayISO(now = new Date()) {
  const m = String(now.getMonth() + 1).padStart(2, '0')
  const d = String(now.getDate()).padStart(2, '0')
  return `${now.getFullYear()}-${m}-${d}`
}

/** 'YYYY-MM-DD' → '16 พ.ย. 2569' */
export function formatThaiDate(dateStr) {
  if (!dateStr) return ''
  const [y, m, d] = String(dateStr).slice(0, 10).split('-').map(Number)
  if (!y || !m || !d) return String(dateStr)
  return `${d} ${THAI_MONTHS_SHORT[m] || ''} ${y + 543}`
}

/** 'YYYY-MM-DD HH:MM' → '16 พ.ย. 2569 16:30' */
export function formatThaiDateTime(value) {
  if (!value) return ''
  const raw = String(value).replace('T', ' ')
  const date = raw.slice(0, 10)
  const time = raw.slice(11, 16)
  return `${formatThaiDate(date)}${time ? ` ${time}` : ''}`
}

/** 'YYYY-MM-DD' → 'จันทร์ 16 พ.ย. 2569' */
export function formatThaiDateLong(dateStr) {
  if (!dateStr) return ''
  const date = new Date(`${String(dateStr).slice(0, 10)}T00:00:00`)
  const day = DAY_LABELS[date.getDay() === 0 ? 7 : date.getDay()] || ''
  return `${day} ${formatThaiDate(dateStr)}`
}

/** 'YYYY-MM-DD' → '16 พ.ย. 2569' หรือ '16–18 พ.ย. 2569' */
export function formatDateRange(start, end) {
  if (!end || end === start) return formatThaiDate(start)
  return `${formatThaiDate(start)} – ${formatThaiDate(end)}`
}

export function monthLabel(year, month /* 1-12 */) {
  return `${THAI_MONTHS_FULL[month] || ''} ${year + 543}`
}

export function formatFileSize(bytes) {
  const size = Number(bytes)
  if (!size || size < 0) return '-'
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(0)} KB`
  return `${(size / 1024 / 1024).toFixed(1)} MB`
}

/** จำนวนวันถึงกำหนด (ติดลบ = เลยกำหนด) */
export function daysUntil(dueDatetime, now = new Date()) {
  if (!dueDatetime) return null
  const raw = String(dueDatetime).replace('T', ' ')
  const due = new Date(`${raw.slice(0, 10)}T${raw.slice(11, 16) || '23:59'}:00`)
  if (Number.isNaN(due.getTime())) return null
  const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate())
  return Math.round((startOfDay(due) - startOfDay(now)) / 86400000)
}

/**
 * ป้ายกำหนดส่งของงาน
 * @returns {{ label: string, tone: 'emerald'|'amber'|'rose'|'slate', urgent: boolean }}
 */
export function dueBadge(task, now = new Date()) {
  const due = task?.due_datetime
  if (!due) return { label: '', tone: 'slate', urgent: false }
  const days = daysUntil(due, now)
  const passed = days !== null && days < 0
  if (passed) return { label: `เลยกำหนด ${formatThaiDateTime(due)}`, tone: 'rose', urgent: true }
  if (days === 0) return { label: `ครบกำหนดวันนี้ ${String(due).slice(11, 16)}`, tone: 'rose', urgent: true }
  if (days === 1) return { label: 'ครบกำหนดพรุ่งนี้', tone: 'amber', urgent: true }
  if (days !== null && days <= 3) return { label: `เหลือ ${days} วัน (${formatThaiDateTime(due)})`, tone: 'amber', urgent: true }
  return { label: `กำหนดส่ง ${formatThaiDateTime(due)}`, tone: 'slate', urgent: false }
}

/** ตรวจไฟล์ฝั่ง client ก่อนอัปโหลด (server ตรวจซ้ำเสมอ) */
export function validateFile(file, { maxMb = MAX_UPLOAD_MB, allowedExt = ALLOWED_EXT } = {}) {
  if (!file) return 'กรุณาเลือกไฟล์'
  const name = String(file.name || '')
  const ext = name.slice(name.lastIndexOf('.')).toLowerCase()
  const allowed = (allowedExt || ALLOWED_EXT)
    .map((e) => String(e).trim().toLowerCase())
    .filter(Boolean)
  if (!allowed.includes(ext)) {
    return `ชนิดไฟล์ไม่รองรับ (อนุญาต: ${allowed.join(', ')})`
  }
  if (file.size > maxMb * 1024 * 1024) return `ไฟล์ใหญ่เกิน ${maxMb} MB`
  if (!file.size) return 'ไฟล์ว่าง'
  return null
}

/** กรองตารางสอนแทนให้เหลือเฉพาะคาบที่เกี่ยวกับครูคนนี้ */
export function filterSubstitutionsForTeacher(rows, teacherId) {
  if (!teacherId) return rows || []
  return (rows || []).filter(
    (row) => row.absent_teacher_id === teacherId || row.substitute_id === teacherId,
  )
}

/** '2/3 กล่อง' + เปอร์เซ็นต์ */
export function progressLabel(progress) {
  if (!progress) return ''
  return `${progress.done || 0}/${progress.total || 0} กล่อง`
}

/** ข้อความแจ้งเตือนสำหรับ copy ไปวางในกลุ่ม LINE */
export function reminderText({ task, rows = [], portalUrl }) {
  const names = rows.slice(0, 10).map((row) => row.display_name || row.full_name || row.teacher_id)
  const more = rows.length > 10 ? ` และอีก ${rows.length - 10} คน` : ''
  const due = formatThaiDateTime(task?.due_datetime) || task?.due_datetime || '-'
  return [
    `แจ้งเตือนงาน: ${task?.title || ''}`,
    `กำหนดส่ง: ${due}`,
    `ยังไม่ได้ส่งครบ ${rows.length} คน: ${names.join(', ')}${more}`,
    `ส่งไฟล์ได้ที่: ${portalUrl}`,
  ].join('\n')
}

// ── ปฏิทิน ────────────────────────────────────────────────────────────────

function isoOf(date) {
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${m}-${d}`
}

/**
 * ตารางเดือน 6 สัปดาห์ เริ่มวันจันทร์
 * @returns {Array<Array<{iso, day, inMonth, isToday, weekday}>>}
 */
export function buildMonthGrid(year, month /* 1-12 */, today = todayISO()) {
  const first = new Date(year, month - 1, 1)
  const jsDay = first.getDay() === 0 ? 7 : first.getDay()   // 1 = จันทร์
  const offset = jsDay - 1
  const weeks = []
  for (let w = 0; w < 6; w++) {
    const days = []
    for (let d = 0; d < 7; d++) {
      const date = new Date(year, month - 1, 1 - offset + w * 7 + d)
      const iso = isoOf(date)
      days.push({
        iso,
        day: date.getDate(),
        inMonth: date.getMonth() === month - 1,
        isToday: iso === today,
        weekday: d,
      })
    }
    weeks.push(days)
  }
  return weeks
}

/**
 * จัดกลุ่มรายการปฏิทินตามวัน (กิจกรรมหลายวันจะปรากฏทุกวันในช่วง)
 * @returns {Record<string, Array<object>>}
 */
export function groupItemsByDate(items = []) {
  const out = {}
  for (const item of items) {
    const start = item.date
    if (!start) continue
    const end = item.end_date && item.end_date > start ? item.end_date : start
    let cursor = new Date(`${start}T00:00:00`)
    const last = new Date(`${end}T00:00:00`)
    let guard = 0
    while (cursor <= last && guard < 60) {
      const iso = isoOf(cursor)
      out[iso] = out[iso] || []
      out[iso].push(item)
      cursor = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate() + 1)
      guard += 1
    }
  }
  return out
}

/** สรุปผู้เข้าร่วมสำหรับแสดงผล ("กลุ่มสาระ วิทยาศาสตร์ · ครู 3 คน") */
export function audienceSummary(audience) {
  if (!audience) return ''
  if (audience.is_all) return 'ทุกคน'
  return audience.summary || 'ยังไม่ระบุ'
}

/** รายการผู้เข้าร่วมแบบละเอียด (ใช้ใน bottom sheet) */
export function audienceDetails(audience) {
  if (!audience) return []
  if (audience.is_all) return [{ kind: 'all', label: 'ครูทุกคนในโรงเรียน' }]
  const rows = []
  for (const dept of audience.depts || []) {
    rows.push({ kind: 'dept', label: `กลุ่มสาระ ${dept}` })
  }
  for (const cls of audience.classes || []) {
    rows.push({ kind: 'class', label: `ห้อง ${cls.name || cls.class_id}` })
  }
  for (const teacher of audience.teachers || []) {
    rows.push({ kind: 'teacher', label: teacher.display_name || teacher.teacher_id })
  }
  return rows
}

/** เก็บชื่อครูที่เลือกไว้ใช้ครั้งต่อไป (per portal) */
export function teacherStorageKey(code) {
  return `sro_portal_teacher_${code || 'default'}`
}

export function readStoredTeacher(code) {
  try {
    return localStorage.getItem(teacherStorageKey(code)) || ''
  } catch {
    return ''
  }
}

export function writeStoredTeacher(code, teacherId) {
  try {
    if (teacherId) localStorage.setItem(teacherStorageKey(code), teacherId)
    else localStorage.removeItem(teacherStorageKey(code))
  } catch {
    /* private mode */
  }
}

// ── Portal entry (จาก workspace ที่ยังอยู่ในเบราว์เซอร์) ───────────────────

export const PENDING_PORTAL_KEY = 'sro_pending_portal'

/**
 * ตัดสินว่ากด "พอร์ทัล" แล้วควรทำอะไร
 *   'open'           → มี short_code แล้ว เปิดหน้าตรวจงานได้เลย
 *   'save_then_open' → งาน local + login แล้ว → บันทึกขึ้นคลาวด์ก่อนแล้วเปิด
 *   'need_login'     → งาน local + ยังไม่ login → ต้อง login ก่อน
 *   'none'           → ยังไม่มีงานที่เปิดอยู่
 */
export function portalEntryState({ workspace, user, cloudWorkspaces = [] } = {}) {
  if (!workspace) return { state: 'none', shortCode: '' }
  const shortCode =
    workspace.shortCode ||
    cloudWorkspaces.find((w) => w.id === workspace.id)?.short_code ||
    ''
  if (shortCode) return { state: 'open', shortCode }
  if (workspace.kind === 'local') {
    return user ? { state: 'save_then_open', shortCode: '' } : { state: 'need_login', shortCode: '' }
  }
  return { state: 'none', shortCode: '' }
}

export function markPendingPortal() {
  try { sessionStorage.setItem(PENDING_PORTAL_KEY, '1') } catch { /* private mode */ }
}

export function readPendingPortal() {
  try { return sessionStorage.getItem(PENDING_PORTAL_KEY) === '1' } catch { return false }
}

export function clearPendingPortal() {
  try { sessionStorage.removeItem(PENDING_PORTAL_KEY) } catch { /* private mode */ }
}

// ── เวลา 24 ชม. ───────────────────────────────────────────────────────────

/** พิมพ์เลข → ใส่ ':' อัตโนมัติหลัง 2 หลัก (รองรับการพิมพ์ระหว่างทาง) */
export function maskTimeInput(text) {
  const digits = String(text || '').replace(/\D/g, '').slice(0, 4)
  if (digits.length <= 2) return digits
  return `${digits.slice(0, 2)}:${digits.slice(2)}`
}

/** '1530' | '15:30' | '930' → '15:30' | '09:30' (คืน '' ถ้าไม่ถูกต้อง) */
export function formatTime24(value) {
  const raw = String(value || '').trim()
  if (!raw) return ''
  const match = raw.match(/^(\d{1,2}):?(\d{2})$/)
  if (!match) return ''
  const hours = Number(match[1])
  const minutes = Number(match[2])
  if (hours > 23 || minutes > 59) return ''
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`
}

export function isValidTime24(value) {
  return formatTime24(value) !== ''
}

/** '2026-11-16' → '16/11/2569' (พ.ศ.) — ใช้กับ DateField */
export function formatDDMMYYYYBuddhist(dateStr) {
  if (!dateStr) return ''
  const [y, m, d] = String(dateStr).slice(0, 10).split('-').map(Number)
  if (!y || !m || !d) return String(dateStr)
  return `${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')}/${y + 543}`
}

// ── Audience selection ────────────────────────────────────────────────────

export function isAudienceMember(members, kind, id) {
  return (members || []).some((m) => m.member_kind === kind && m.member_id === id)
}

/** เพิ่ม/ถอดสมาชิกหนึ่งรายการ แล้วคืน array ใหม่ */
export function toggleAudienceMember(members, kind, id) {
  const list = members || []
  return isAudienceMember(list, kind, id)
    ? list.filter((m) => !(m.member_kind === kind && m.member_id === id))
    : [...list, { member_kind: kind, member_id: id }]
}

export function removeAudienceMember(members, kind, id) {
  return (members || []).filter((m) => !(m.member_kind === kind && m.member_id === id))
}

/** จัดกลุ่มผู้เข้าร่วมที่เลือกไว้ สำหรับแผงด้านขวา (พร้อมชื่อที่อ่านออก) */
export function audienceSelectionGroups(audience, teachers = [], classes = []) {
  const teacherById = new Map(teachers.map((t) => [t.teacher_id, t]))
  const classById = new Map(classes.map((c) => [c.class_id, c]))
  const out = { depts: [], classes: [], teachers: [] }
  for (const member of audience || []) {
    const id = member.member_id
    if (member.member_kind === 'dept') {
      out.depts.push({ id, label: id })
    } else if (member.member_kind === 'class') {
      out.classes.push({ id, label: classById.get(id)?.name || id })
    } else if (member.member_kind === 'teacher') {
      const teacher = teacherById.get(id)
      out.teachers.push({
        id,
        label: teacher?.display_name || teacher?.full_name || id,
        dept: teacher?.dept || '',
      })
    }
  }
  return out
}

/** กิจกรรมที่เกิดขึ้นในวันนั้น (รองรับหลายวัน) */
export function eventsOnDate(events, iso) {
  if (!iso) return []
  return (events || []).filter((event) => {
    const start = event.event_date
    if (!start) return false
    const end = event.end_date && event.end_date > start ? event.end_date : start
    return iso >= start && iso <= end
  })
}

/** กรองรายการปฏิทินให้เหลือเฉพาะที่ครูคนนี้เกี่ยวข้อง (อิงธง i_attend จาก backend) */
export function filterCalendarItems(items, { teacherId, onlyMine } = {}) {
  const list = items || []
  if (!teacherId || onlyMine === false) return list
  return list.filter((item) => item?.i_attend === true)
}

/** รายชื่อปี (ค.ศ.) สำหรับ dropdown — ครอบปีปัจจุบัน ±span และปีที่กำลังแสดงอยู่เสมอ */
export function yearOptions(year, { span = 5, now = new Date() } = {}) {
  const base = now.getFullYear()
  const years = new Set()
  for (let offset = -span; offset <= span; offset += 1) years.add(base + offset)
  if (Number(year)) years.add(Number(year))
  return [...years].sort((a, b) => a - b)
}

/** '2026-11-16 16:30' | '2026-11-16T16:30' → { date: '2026-11-16', time: '16:30' } */
export function splitDateTime(value) {
  const raw = String(value || '').replace('T', ' ').trim()
  if (!raw) return { date: '', time: '' }
  return { date: raw.slice(0, 10), time: raw.slice(11, 16) }
}

/** ประกอบกลับเป็น 'YYYY-MM-DD HH:MM' (คืน null ถ้าไม่มีวันที่) */
export function joinDateTime(date, time, { fallbackTime = '00:00' } = {}) {
  if (!date) return null
  const safeTime = formatTime24(time) || fallbackTime
  return `${String(date).slice(0, 10)} ${safeTime}`
}

/**
 * แยกรหัสโฟลเดอร์จากลิงก์ Google Drive (ตรรกะเดียวกับ backend drive_client)
 * @returns {{folderId: string, driveId: string|null} | {error: string}}
 */
export function parseDriveFolderLink(url) {
  const raw = String(url || '').trim()
  if (!raw) return { error: 'ลิงก์โฟลเดอร์ว่าง' }
  if (raw.includes('/file/d/')) return { error: 'ลิงก์นี้เป็นไฟล์ ไม่ใช่โฟลเดอร์' }

  const parts = raw.split('?')[0].replace(/\/+$/, '').split('/').filter(Boolean)
  const foldersIndex = parts.indexOf('folders')
  if (foldersIndex !== -1 && parts[foldersIndex + 1]) {
    return { folderId: parts[foldersIndex + 1], driveId: null }
  }
  if (parts.includes('open')) {
    const query = raw.split('?')[1] || ''
    const id = new URLSearchParams(query).get('id')
    if (id) return { folderId: id, driveId: null }
  }
  const driveIndex = parts.indexOf('drive')
  if (driveIndex !== -1) {
    const tail = parts.slice(driveIndex + 1).filter((part) => part !== 'u' && !/^\d+$/.test(part))
    if (tail.length) return { folderId: tail[0], driveId: tail[0] }
  }
  return { error: 'ไม่พบรหัสโฟลเดอร์ในลิงก์ (ตัวอย่าง: .../drive/folders/<ID>)' }
}
