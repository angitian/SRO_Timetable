export const STATUSES = ['present', 'late', 'leave', 'absent']

export const STATUS_META = {
  present: { label: 'ปกติ', chip: 'bg-emerald-50 text-emerald-700 border-emerald-200', dot: 'bg-emerald-500' },
  late: { label: 'สาย', chip: 'bg-amber-50 text-amber-700 border-amber-200', dot: 'bg-amber-500' },
  leave: { label: 'ลา', chip: 'bg-blue-50 text-blue-700 border-blue-200', dot: 'bg-blue-500' },
  absent: { label: 'ขาด', chip: 'bg-rose-50 text-rose-700 border-rose-200', dot: 'bg-rose-500' },
}

export function todayISO(date = new Date()) {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

export function parseDateKey(key) {
  const [y, m, d] = String(key || '').split('-').map(Number)
  return new Date(y, (m || 1) - 1, d || 1)
}

export function formatDateDMY(key) {
  if (!key) return '—'
  const date = parseDateKey(key)
  if (Number.isNaN(date.getTime())) return String(key)
  const dd = String(date.getDate()).padStart(2, '0')
  const mm = String(date.getMonth() + 1).padStart(2, '0')
  const yyyy = date.getFullYear() + 543
  return `${dd}/${mm}/${yyyy}`
}

export function parseDateDMY(value) {
  const text = String(value || '').trim()
  if (!text) return ''
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text
  const match = text.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,4})$/)
  if (!match) return text
  const day = Number(match[1])
  const month = Number(match[2])
  let year = Number(match[3])
  if (year < 100) year += 2500
  if (year < 2400) year += 543
  if (!day || !month || !year) return text
  return `${year - 543}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

export function normalizeTime24(value) {
  const text = String(value || '').trim().replace('.', ':')
  let hour = null
  let minute = 0
  let match = text.match(/^(\d{1,2}):(\d{1,2})$/)
  if (match) {
    hour = Number(match[1])
    minute = Number(match[2])
  } else if (/^\d{1,2}$/.test(text)) {
    hour = Number(text)
  } else if ((match = text.match(/^(\d{1,2})(\d{2})$/))) {
    hour = Number(match[1])
    minute = Number(match[2])
  } else {
    return ''
  }
  if (hour > 23 || minute > 59) return ''
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
}

export function formatThaiDate(key, opts = {}) {
  return formatDateDMY(key)
}

export function formatDateTimeDMY(date = new Date()) {
  const hh = String(date.getHours()).padStart(2, '0')
  const mm = String(date.getMinutes()).padStart(2, '0')
  return `${formatDateDMY(todayISO(date))} ${hh}:${mm}`
}

export function getRange(dateKey, mode = 'day') {
  const base = parseDateKey(dateKey)
  if (mode === 'week') {
    const day = base.getDay() // 0=Sun
    const mondayOffset = (day + 6) % 7
    const start = new Date(base)
    start.setDate(base.getDate() - mondayOffset)
    const end = new Date(start)
    end.setDate(start.getDate() + 6)
    return { start: todayISO(start), end: todayISO(end), mode }
  }
  if (mode === 'month') {
    const start = new Date(base.getFullYear(), base.getMonth(), 1)
    const end = new Date(base.getFullYear(), base.getMonth() + 1, 0)
    return { start: todayISO(start), end: todayISO(end), mode }
  }
  return { start: dateKey, end: dateKey, mode: 'day' }
}

export function dateKeysInRange(range) {
  const out = []
  const start = parseDateKey(range.start)
  const end = parseDateKey(range.end)
  const cursor = new Date(start)
  while (cursor <= end) {
    out.push(todayISO(cursor))
    cursor.setDate(cursor.getDate() + 1)
  }
  return out
}

export function rangeLabel(dateKey, mode = 'day') {
  const range = getRange(dateKey, mode)
  if (mode === 'week' || mode === 'month') return `${formatThaiDate(range.start)} – ${formatThaiDate(range.end)}`
  return formatThaiDate(dateKey)
}

export function semesterRange(reference = {}, now = new Date()) {
  if (reference?.semesterStart && reference?.semesterEnd) {
    return { start: reference.semesterStart, end: reference.semesterEnd, mode: 'semester' }
  }
  const academicYear = Number(reference?.academicYear) || (now.getFullYear() + 543)
  const term = Number(reference?.term) || 2
  const gregorianYear = academicYear - 543
  if (term === 1) {
    return { start: `${gregorianYear}-05-01`, end: `${gregorianYear}-10-31`, mode: 'semester' }
  }
  return { start: `${gregorianYear}-11-01`, end: `${gregorianYear + 1}-03-31`, mode: 'semester' }
}

export function dashboardRange(dateKey, mode = 'semester', reference = {}) {
  if (mode === 'semester') return semesterRange(reference, parseDateKey(dateKey))
  return getRange(dateKey, mode)
}

export function dashboardRangeLabel(dateKey, mode = 'semester', reference = {}) {
  const range = dashboardRange(dateKey, mode, reference)
  if (mode === 'semester') {
    const term = Number(reference?.term) || 2
    const year = Number(reference?.academicYear) || (parseDateKey(dateKey).getFullYear() + 543)
    return `ภาคเรียนที่ ${term}/${year} · ${formatThaiDate(range.start)} – ${formatThaiDate(range.end)}`
  }
  return rangeLabel(dateKey, mode)
}

function bucketStartForDate(dateKey, granularity) {
  if (granularity === 'month') return dateKey.slice(0, 7)
  if (granularity === 'week') {
    const base = parseDateKey(dateKey)
    const mondayOffset = (base.getDay() + 6) % 7
    base.setDate(base.getDate() - mondayOffset)
    return todayISO(base)
  }
  return dateKey
}

function bucketLabel(startKey, granularity) {
  if (granularity === 'month') {
    return parseDateKey(`${startKey}-01`).toLocaleDateString('th-TH', { month: 'short', year: 'numeric' })
  }
  if (granularity === 'week') return `สัปดาห์ ${formatThaiDate(startKey)}`
  return formatThaiDate(startKey)
}

function pct(part, total) {
  return total ? Math.round((part / total) * 100) : 0
}

function groupedStats({ trainees, attendance, range, field, getKeys, emptyLabel = 'ไม่ระบุ' }) {
  const groups = new Map()
  for (const trainee of trainees || []) {
    const keys = getKeys
      ? getKeys(trainee)
      : [String(trainee?.[field] || '').trim() || emptyLabel]
    for (const rawKey of keys.length ? keys : [emptyLabel]) {
      const key = String(rawKey || '').trim() || emptyLabel
      if (!groups.has(key)) groups.set(key, { key, traineeCount: 0, traineeIds: [], trainees: [] })
      const group = groups.get(key)
      group.traineeCount += 1
      group.traineeIds.push(trainee.id)
      group.trainees.push(trainee)
    }
  }
  return [...groups.values()].map((group) => {
    const stats = summarizeRange(attendance, range, group.traineeIds)
    return {
      key: group.key,
      traineeCount: group.traineeCount,
      trainees: group.trainees,
      ...stats,
      attendedRate: pct(stats.present + stats.late, stats.total),
      punctualRate: pct(stats.present, stats.total),
    }
  }).sort((a, b) => b.total - a.total || b.traineeCount - a.traineeCount || a.key.localeCompare(b.key, 'th'))
}

export function buildDashboardStats({ trainees = [], attendance = {}, range }) {
  const activeTrainees = (trainees || []).filter((t) => !t?.archived)
  const traineeIds = new Set(activeTrainees.map((t) => t.id))
  const perTrainee = new Map(activeTrainees.map((t) => [t.id, { trainee: t, ...emptyStats() }]))
  const keys = range ? dateKeysInRange(range) : []
  const granularity = keys.length > 90 ? 'month' : keys.length > 14 ? 'week' : 'day'
  const trend = new Map()
  const recent = []
  let recordedDays = 0

  for (const dateKey of keys) {
    const day = attendance?.[dateKey] || {}
    let dayRecorded = 0
    for (const [traineeId, record] of Object.entries(day)) {
      if (!traineeIds.has(traineeId) || !STATUSES.includes(record?.status)) continue
      const row = perTrainee.get(traineeId)
      if (!row) continue
      row[record.status] += 1
      row.total += 1
      dayRecorded += 1
      recent.push({
        dateKey,
        traineeId,
        traineeName: row.trainee.name,
        status: record.status,
        time: record.time || '',
        note: record.note || '',
      })
    }
    if (dayRecorded) {
      recordedDays += 1
      const bucketKey = bucketStartForDate(dateKey, granularity)
      if (!trend.has(bucketKey)) trend.set(bucketKey, { key: bucketKey, label: bucketLabel(bucketKey, granularity), ...emptyStats() })
      const bucket = trend.get(bucketKey)
      for (const [traineeId, record] of Object.entries(day)) {
        if (!traineeIds.has(traineeId) || !STATUSES.includes(record?.status)) continue
        bucket[record.status] += 1
        bucket.total += 1
      }
    }
  }

  const totals = summarizeRange(attendance, range, [...traineeIds])
  const perTraineeRows = [...perTrainee.values()].map((row) => ({
    ...row,
    attendedRate: pct(row.present + row.late, row.total),
    punctualRate: pct(row.present, row.total),
  }))
  const topLate = perTraineeRows
    .filter((row) => row.late > 0)
    .sort((a, b) => b.late - a.late || b.total - a.total || a.trainee.name.localeCompare(b.trainee.name, 'th'))
    .slice(0, 5)
  const topAbsent = perTraineeRows
    .filter((row) => row.absent > 0)
    .sort((a, b) => b.absent - a.absent || b.total - a.total || a.trainee.name.localeCompare(b.trainee.name, 'th'))
    .slice(0, 5)

  return {
    range,
    traineeCount: activeTrainees.length,
    recordedDays,
    rangeDays: keys.length,
    totals,
    attendedRate: pct(totals.present + totals.late, totals.total),
    punctualRate: pct(totals.present, totals.total),
    granularity,
    trend: [...trend.values()],
    byMajor: groupedStats({ trainees: activeTrainees, attendance, range, field: 'major' }),
    byInstitution: groupedStats({ trainees: activeTrainees, attendance, range, field: 'institution' }),
    byMentor: groupedStats({
      trainees: activeTrainees,
      attendance,
      range,
      getKeys: (t) => mentorNamesForTrainee(t),
      emptyLabel: 'ยังไม่กำหนดพี่เลี้ยง',
    }),
    bySubject: groupedStats({
      trainees: activeTrainees,
      attendance,
      range,
      getKeys: (t) => assignmentsForTrainee(t).map((a) => a.subjectName).filter(Boolean),
      emptyLabel: 'ยังไม่กำหนดวิชา',
    }),
    topLate,
    topAbsent,
    noRecordTrainees: perTraineeRows.filter((row) => row.total === 0).map((row) => row.trainee),
    perTrainee: perTraineeRows,
    recent: recent.sort((a, b) => b.dateKey.localeCompare(a.dateKey)).slice(0, 10),
  }
}

export function buildDashboardCSV(stats) {
  const lines = [
    ['ช่วงเวลา', `${formatDateDMY(stats?.range?.start)} ถึง ${formatDateDMY(stats?.range?.end)}`].map(csvEscape).join(','),
    ['จำนวนนักศึกษา', stats?.traineeCount || 0].map(csvEscape).join(','),
    ['วันที่มีการบันทึก', stats?.recordedDays || 0].map(csvEscape).join(','),
    ['ปกติ', stats?.totals?.present || 0].map(csvEscape).join(','),
    ['สาย', stats?.totals?.late || 0].map(csvEscape).join(','),
    ['ลา', stats?.totals?.leave || 0].map(csvEscape).join(','),
    ['ขาด', stats?.totals?.absent || 0].map(csvEscape).join(','),
    ['อัตรามาปฏิบัติงาน (%)', stats?.attendedRate || 0].map(csvEscape).join(','),
    ['อัตราตรงเวลา (%)', stats?.punctualRate || 0].map(csvEscape).join(','),
    '',
    ['รายคน'].map(csvEscape).join(','),
    ['ชื่อ', 'รหัสนักศึกษา', 'วิชาเอก', 'สถาบัน', 'ครูพี่เลี้ยง', 'ปกติ', 'สาย', 'ลา', 'ขาด', 'รวม', 'มาปฏิบัติงาน%', 'ตรงเวลา%'].map(csvEscape).join(','),
  ]
  for (const row of stats?.perTrainee || []) {
    lines.push([
      row.trainee.name || '', row.trainee.studentCode || '', row.trainee.major || '', row.trainee.institution || '', mentorDisplayLine(row.trainee) || '',
      row.present, row.late, row.leave, row.absent, row.total, row.attendedRate, row.punctualRate,
    ].map(csvEscape).join(','))
  }
  return `\uFEFF${lines.join('\r\n')}`
}

export function emptyStats() {
  return { present: 0, late: 0, leave: 0, absent: 0, total: 0 }
}

export function summarizeDay(attendance, dateKey, traineeIds = null) {
  const stats = emptyStats()
  const day = attendance?.[dateKey] || {}
  const allowed = traineeIds ? new Set(traineeIds) : null
  for (const [traineeId, record] of Object.entries(day)) {
    if (allowed && !allowed.has(traineeId)) continue
    if (STATUSES.includes(record?.status)) {
      stats[record.status] += 1
      stats.total += 1
    }
  }
  return stats
}

export function summarizeRange(attendance, range, traineeIds = null) {
  const stats = emptyStats()
  const allowed = traineeIds ? new Set(traineeIds) : null
  for (const dateKey of dateKeysInRange(range)) {
    const day = attendance?.[dateKey] || {}
    for (const [traineeId, record] of Object.entries(day)) {
      if (allowed && !allowed.has(traineeId)) continue
      if (STATUSES.includes(record?.status)) {
        stats[record.status] += 1
        stats.total += 1
      }
    }
  }
  return stats
}

export function statsForTrainee(attendance, traineeId, range) {
  const stats = emptyStats()
  for (const dateKey of dateKeysInRange(range)) {
    const record = attendance?.[dateKey]?.[traineeId]
    if (record && STATUSES.includes(record.status)) {
      stats[record.status] += 1
      stats.total += 1
    }
  }
  return stats
}

export function historyForTrainee(attendance, traineeId, opts = {}) {
  const onlyNonPresent = opts.onlyNonPresent !== false
  const rows = []
  for (const [dateKey, day] of Object.entries(attendance || {})) {
    const record = day?.[traineeId]
    if (!record) continue
    if (onlyNonPresent && record.status === 'present') continue
    rows.push({ dateKey, ...record })
  }
  return rows.sort((a, b) => b.dateKey.localeCompare(a.dateKey))
}

export function setDailyRecord(attendance, dateKey, traineeId, patch) {
  const next = { ...(attendance || {}) }
  const day = { ...(next[dateKey] || {}) }
  const current = day[traineeId] || {}
  day[traineeId] = {
    ...current,
    ...patch,
    updatedAt: new Date().toISOString(),
  }
  next[dateKey] = day
  return next
}

export function removeDailyRecord(attendance, dateKey, traineeId) {
  const next = { ...(attendance || {}) }
  const day = { ...(next[dateKey] || {}) }
  delete day[traineeId]
  if (Object.keys(day).length === 0) delete next[dateKey]
  else next[dateKey] = day
  return next
}

export function bulkPresent(attendance, dateKey, traineeIds, updatedBy) {
  const next = { ...(attendance || {}) }
  const day = { ...(next[dateKey] || {}) }
  const now = new Date().toISOString()
  for (const traineeId of traineeIds) {
    day[traineeId] = {
      ...(day[traineeId] || {}),
      status: 'present',
      updatedAt: now,
      updatedBy,
    }
  }
  next[dateKey] = day
  return next
}

export function normalizeText(value) {
  return String(value || '').trim().toLowerCase().replace(/\s+/g, ' ')
}

function cleanText(value) {
  return String(value ?? '').trim()
}

function cleanList(value) {
  if (Array.isArray(value)) return value.map(cleanText).filter(Boolean)
  if (!value) return []
  return String(value).split(/[,;\n]/).map(cleanText).filter(Boolean)
}

export function normalizeAssignment(input = {}) {
  const roomNames = cleanList(input.roomNames?.length ? input.roomNames : input.roomName)
  const weeklyPeriods = input.weeklyPeriods === '' || input.weeklyPeriods == null
    ? null
    : Math.max(0, Number(input.weeklyPeriods) || 0)
  return {
    id: input.id || makeTraineeId(),
    subjectId: input.subjectId || '',
    subjectName: cleanText(input.subjectName),
    classId: input.classId || '',
    className: cleanText(input.className),
    roomIds: cleanList(input.roomIds || input.roomId),
    roomNames,
    weeklyPeriods,
  }
}

export function normalizeAssignments(assignments = [], classes = []) {
  const source = Array.isArray(assignments) ? assignments : [assignments]
  return source
    .map((a) => normalizeAssignment(a, classes))
    .filter((a) => a.subjectName || a.className || a.roomNames.length || a.weeklyPeriods != null)
}

export function assignmentsForTrainee(trainee = {}, classes = []) {
  if (Array.isArray(trainee.assignments) && trainee.assignments.length) {
    return normalizeAssignments(trainee.assignments, classes)
  }
  return normalizeAssignments([trainee], classes)
}

export function mentorNamesForTrainee(trainee = {}) {
  return cleanList(trainee.mentorNames?.length ? trainee.mentorNames : trainee.mentorTeacherName)
}

export function mentorDisplayLine(trainee = {}) {
  return mentorNamesForTrainee(trainee).join(', ')
}

export function traineeTeachingLines(trainee = {}, classes = []) {
  return assignmentsForTrainee(trainee, classes).map((a) => [
    a.subjectName || 'ไม่ระบุวิชา',
    a.className ? `(${a.className})` : '',
    a.roomNames.length ? `· ${a.roomNames.join(', ')}` : '',
    a.weeklyPeriods != null ? `· ${a.weeklyPeriods} คาบ` : '',
  ].filter(Boolean).join(' '))
}

export function normalizeTraineeProfile(input = {}, classes = []) {
  const now = new Date().toISOString()
  const weeklyPeriods = input.weeklyPeriods === '' || input.weeklyPeriods == null
    ? null
    : Math.max(0, Number(input.weeklyPeriods) || 0)
  const assignments = normalizeAssignments(
    Array.isArray(input.assignments) && input.assignments.length ? input.assignments : [input],
    classes,
  )
  const first = assignments[0] || {}
  const mentorNames = cleanList(input.mentorNames?.length ? input.mentorNames : input.mentorTeacherName)
  return {
    id: input.id || makeTraineeId(),
    studentCode: cleanText(input.studentCode),
    name: cleanText(input.name),
    major: cleanText(input.major),
    institution: cleanText(input.institution),
    mentorTeacherId: input.mentorTeacherId || '',
    mentorTeacherName: mentorNames[0] || '',
    mentorNames,
    subjectId: first.subjectId || input.subjectId || '',
    subjectName: first.subjectName || cleanText(input.subjectName),
    classId: first.classId || input.classId || '',
    className: first.className || cleanText(input.className),
    roomId: first.roomIds?.[0] || input.roomId || '',
    roomName: first.roomNames?.join(', ') || cleanText(input.roomName),
    weeklyPeriods: first.weeklyPeriods ?? weeklyPeriods,
    assignments,
    phone: cleanText(input.phone),
    email: cleanText(input.email),
    advisorName: cleanText(input.advisorName),
    internshipStart: parseDateDMY(input.internshipStart),
    internshipEnd: parseDateDMY(input.internshipEnd),
    workplace: cleanText(input.workplace),
    department: cleanText(input.department),
    note: cleanText(input.note),
    archived: !!input.archived,
    createdAt: input.createdAt || now,
    updatedAt: now,
  }
}

export function validateTraineeProfile(trainee = {}) {
  const errors = {}
  if (!cleanText(trainee.name)) errors.name = 'ต้องระบุชื่อ-นามสกุล'
  if (trainee.internshipStart && trainee.internshipEnd && trainee.internshipEnd < trainee.internshipStart) {
    errors.internshipEnd = 'วันสิ้นสุดฝึกงานต้องไม่ก่อนวันเริ่ม'
  }
  if (trainee.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanText(trainee.email))) {
    errors.email = 'รูปแบบอีเมลไม่ถูกต้อง'
  }
  if (trainee.weeklyPeriods !== '' && trainee.weeklyPeriods != null) {
    const periods = Number(trainee.weeklyPeriods)
    if (!Number.isFinite(periods) || periods < 0) errors.weeklyPeriods = 'จำนวนคาบต้องเป็นตัวเลขตั้งแต่ 0 ขึ้นไป'
  }
  return errors
}

export function removeTraineeRecords(attendance = {}, traineeId) {
  const next = {}
  for (const [dateKey, day] of Object.entries(attendance || {})) {
    const cleaned = { ...(day || {}) }
    delete cleaned[traineeId]
    if (Object.keys(cleaned).length) next[dateKey] = cleaned
  }
  return next
}

function mergeAssignmentLists(existing = [], incoming = []) {
  const out = [...existing]
  const key = (a) => normalizeText(`${a.subjectName}|${a.className}|${a.roomNames.join(',')}`)
  const seen = new Set(out.map(key))
  for (const a of incoming) {
    if (!seen.has(key(a))) {
      seen.add(key(a))
      out.push(a)
    }
  }
  return out
}

function mergeStringLists(existing = [], incoming = []) {
  const out = [...existing]
  const seen = new Set(out.map(normalizeText))
  for (const value of incoming || []) {
    if (!seen.has(normalizeText(value))) {
      seen.add(normalizeText(value))
      out.push(value)
    }
  }
  return out
}

export function mergeTraineeRows(existing = [], incoming = []) {
  const byCode = new Map()
  const byName = new Map()
  const out = existing.map((t) => ({ ...t, assignments: [...(t.assignments || [])] }))
  for (const t of out) {
    if (t.studentCode) byCode.set(normalizeText(t.studentCode), t)
    byName.set(normalizeText(t.name), t)
  }
  let added = 0
  let updated = 0
  const preserveKeys = new Set(['id', 'assignments', 'createdAt', 'archived'])
  for (const raw of incoming) {
    const row = normalizeTraineeProfile(raw)
    const code = row.studentCode ? normalizeText(row.studentCode) : ''
    const name = normalizeText(row.name)
    const match = (code && byCode.get(code)) || (!code && byName.get(name))
    if (match) {
      const merged = { ...match }
      for (const [key, value] of Object.entries(row)) {
        if (preserveKeys.has(key)) continue
        if (key === 'mentorNames') merged.mentorNames = mergeStringLists(merged.mentorNames || [], value || [])
        else if (value !== '' && value != null) merged[key] = value
      }
      merged.id = match.id
      merged.mentorTeacherName = merged.mentorNames?.[0] || merged.mentorTeacherName || ''
      merged.assignments = mergeAssignmentLists(assignmentsForTrainee(match), row.assignments || [])
      const firstAssignment = merged.assignments[0] || {}
      merged.subjectId = firstAssignment.subjectId || ''
      merged.subjectName = firstAssignment.subjectName || ''
      merged.classId = firstAssignment.classId || ''
      merged.className = firstAssignment.className || ''
      merged.roomId = firstAssignment.roomIds?.[0] || ''
      merged.roomName = firstAssignment.roomNames?.join(', ') || ''
      merged.weeklyPeriods = firstAssignment.weeklyPeriods ?? null
      Object.assign(match, merged)
      updated += 1
    } else {
      out.push(row)
      added += 1
      if (code) byCode.set(code, row)
      byName.set(name, row)
    }
  }
  return { trainees: out, added, updated }
}

export function makeTraineeId() {
  return `tr_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
}

export function buildReference(fixtureData, meta = {}) {
  const teachers = (fixtureData?.teachers || []).map((t) => ({ id: t.id, name: t.name }))
  const subjects = (fixtureData?.subjects || []).map((s) => ({ id: s.id, name: s.name }))
  const classes = (fixtureData?.classes || []).map((c) => ({ id: c.id, name: c.name, gradeLevel: c.grade_level }))
  const rooms = (fixtureData?.rooms || []).map((r) => ({ id: r.id, name: r.name, roomType: r.room_type }))
  const lessonBlocks = (fixtureData?.lesson_blocks || []).map((lb) => ({
    id: lb.id,
    teacherId: lb.teacher_id,
    subjectId: lb.subject_id,
    classId: lb.class_id,
    roomId: lb.room_id,
    periodsPerWeek: lb.periods_per_week || 0,
  }))
  return {
    timetableTitle: meta.title || '',
    academicYear: meta.academicYear || 2569,
    term: meta.term || 2,
    teachers,
    subjects,
    classes,
    rooms,
    lessonBlocks,
    capturedAt: new Date().toISOString(),
  }
}

export function emptyTraineeData(reference) {
  return {
    schemaVersion: 1,
    reference: reference || null,
    trainees: [],
    attendance: {},
  }
}

export function csvEscape(value) {
  const text = String(value ?? '')
  if (/[",\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`
  return text
}

export function buildSummaryCSV({ trainees, attendance, range, reference }) {
  const headers = [
    'ลำดับ', 'รหัสนักศึกษา', 'ชื่อ-นามสกุล', 'วิชาเอก', 'สถาบัน',
    'ครูพี่เลี้ยง', 'วิชา/ชั้น', 'ห้อง', 'เบอร์โทร', 'อีเมล', 'อาจารย์นิเทศ',
    'เริ่มฝึก', 'สิ้นสุดฝึก', 'หน่วยงาน', 'แผนก', 'หมายเหตุ',
    'ปกติ', 'สาย', 'ลา', 'ขาด', 'รวม',
  ]
  const lines = [headers.map(csvEscape).join(',')]
  trainees.forEach((t, index) => {
    const stats = statsForTrainee(attendance, t.id, range)
    lines.push([
      index + 1, t.studentCode || '', t.name || '', t.major || '', t.institution || '',
      mentorDisplayLine(t) || '', [t.subjectName, t.className].filter(Boolean).join(' / '), t.roomName || '',
      t.phone || '', t.email || '', t.advisorName || '', formatDateDMY(t.internshipStart) || '', formatDateDMY(t.internshipEnd) || '',
      t.workplace || '', t.department || '', t.note || '',
      stats.present, stats.late, stats.leave, stats.absent, stats.total,
    ].map(csvEscape).join(','))
  })
  const total = summarizeRange(attendance, range, trainees.map((t) => t.id))
  const totalRow = Array(headers.length).fill('')
  totalRow[2] = 'รวม'
  totalRow[16] = total.present
  totalRow[17] = total.late
  totalRow[18] = total.leave
  totalRow[19] = total.absent
  totalRow[20] = total.total
  lines.push(totalRow.map(csvEscape).join(','))
  return `\uFEFF${lines.join('\r\n')}`
}

export function downloadText(filename, text, mime = 'text/csv;charset=utf-8') {
  const blob = new Blob([text], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

export function traineeCacheKey(timetableId) {
  return `sro_trainee_data_v1_${timetableId}`
}

export function readTraineeCache(timetableId) {
  try {
    const raw = localStorage.getItem(traineeCacheKey(timetableId))
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return null
    return {
      data: parsed.data || emptyTraineeData(),
      version: Number(parsed.version || 0),
      dirty: !!parsed.dirty,
      updatedAt: parsed.updatedAt || 0,
    }
  } catch {
    return null
  }
}

export function writeTraineeCache(timetableId, payload) {
  try {
    localStorage.setItem(traineeCacheKey(timetableId), JSON.stringify(payload))
    return true
  } catch {
    return false
  }
}

export function countAttendanceRecords(attendance) {
  let count = 0
  for (const day of Object.values(attendance || {})) {
    if (day && typeof day === 'object') count += Object.keys(day).length
  }
  return count
}

export function traineeDisplayLine(t) {
  const teaching = traineeTeachingLines(t)
  const parts = [
    mentorDisplayLine(t) ? `พี่เลี้ยง: ${mentorDisplayLine(t)}` : '',
    teaching.join(' | '),
  ].filter(Boolean)
  return parts.join(' · ')
}
