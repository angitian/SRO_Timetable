/**
 * API client for the portal module (กิจกรรมโรงเรียน + งานส่งไฟล์).
 *
 * Public endpoints need no auth — the workspace short code is the key.
 * Admin endpoints send the usual auth headers (Bearer JWT from Google login).
 */
import { BASE_URL } from './config.js'
import { authHeaders } from './client.js'

async function parseError(res) {
  let detail = `HTTP ${res.status}`
  try {
    const body = await res.json()
    if (body?.detail) detail = typeof body.detail === 'string' ? body.detail : JSON.stringify(body.detail)
  } catch {
    /* non-JSON body */
  }
  return new Error(detail)
}

async function getJson(path) {
  const res = await fetch(`${BASE_URL}${path}`)
  if (!res.ok) throw await parseError(res)
  return res.json()
}

async function getJsonAuth(path) {
  const res = await fetch(`${BASE_URL}${path}`, { headers: authHeaders() })
  if (!res.ok) throw await parseError(res)
  return res.json()
}

async function sendJson(method, path, body) {
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  if (!res.ok) throw await parseError(res)
  return res.json()
}

function query(params) {
  const usable = Object.entries(params || {}).filter(([, v]) => v !== undefined && v !== null && v !== '')
  if (!usable.length) return ''
  return `?${new URLSearchParams(usable.map(([k, v]) => [k, String(v)])).toString()}`
}

const base = (code) => `/api/v1/portal/${encodeURIComponent(code)}`

// ── Public ──────────────────────────────────────────────────────────────────

export function fetchPortal(code) {
  return getJson(base(code))
}

export function fetchPortalCalendar(code, { from, to, teacherId } = {}) {
  return getJson(`${base(code)}/calendar${query({ from, to, teacher_id: teacherId })}`)
}

export function fetchPortalEvent(code, eventId, teacherId) {
  return getJson(`${base(code)}/events/${encodeURIComponent(eventId)}${query({ teacher_id: teacherId })}`)
}

export function fetchPortalTasks(code, teacherId) {
  return getJson(`${base(code)}/tasks${query({ teacher_id: teacherId })}`)
}

export function fetchPortalSubstitutions(code, date) {
  return getJson(`${base(code)}/substitutions${query({ date })}`)
}

export function fetchPortalSubmissions(code, teacherId) {
  return getJson(`${base(code)}/submissions${query({ teacher_id: teacherId })}`)
}

export function fetchPortalNotifications(code, teacherId, limit = 60) {
  return getJson(`${base(code)}/notifications${query({ teacher_id: teacherId, limit })}`)
}

export function markPortalNotificationRead(code, notificationId, teacherId) {
  return sendJson(
    'POST',
    `${base(code)}/notifications/${encodeURIComponent(notificationId)}/read${query({ teacher_id: teacherId })}`,
  )
}

export function markAllPortalNotificationsRead(code, teacherId) {
  return sendJson('POST', `${base(code)}/notifications/read-all${query({ teacher_id: teacherId })}`)
}

/**
 * Upload one slot with progress reporting.
 * `fetch` has no upload progress event, so this uses XMLHttpRequest.
 *
 * @returns {{ promise: Promise<object>, abort: () => void }}
 */
export function uploadPortalSubmission({
  code, teacherId, taskId, slotId, pin, file, note = '', onProgress,
}) {
  const xhr = new XMLHttpRequest()
  const promise = new Promise((resolve, reject) => {
    const form = new FormData()
    form.append('teacher_id', teacherId)
    form.append('task_id', taskId)
    form.append('slot_id', slotId)
    form.append('pin', pin)
    if (note) form.append('note', note)
    form.append('file', file)

    xhr.open('POST', `${BASE_URL}${base(code)}/submissions`)
    Object.entries(authHeaders()).forEach(([k, v]) => xhr.setRequestHeader(k, v))
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && onProgress) {
        onProgress(Math.round((event.loaded / event.total) * 100))
      }
    }
    xhr.onload = () => {
      let body = null
      try {
        body = JSON.parse(xhr.responseText)
      } catch {
        body = null
      }
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(body)
      } else {
        const detail = body?.detail || `อัปโหลดไม่สำเร็จ (HTTP ${xhr.status})`
        reject(new Error(typeof detail === 'string' ? detail : JSON.stringify(detail)))
      }
    }
    xhr.onerror = () => reject(new Error('เชื่อมต่อเซิร์ฟเวอร์ไม่ได้'))
    xhr.onabort = () => reject(new Error('ยกเลิกการอัปโหลด'))
    xhr.send(form)
  })
  return { promise, abort: () => xhr.abort() }
}

// ── Admin: school events ───────────────────────────────────────────────────

export function fetchAdminEvents(code) {
  return getJsonAuth(`${base(code)}/admin/events`)
}

export function createAdminEvent(code, payload) {
  return sendJson('POST', `${base(code)}/admin/events`, payload)
}

export function updateAdminEvent(code, eventId, payload) {
  return sendJson('PUT', `${base(code)}/admin/events/${encodeURIComponent(eventId)}`, payload)
}

export function deleteAdminEvent(code, eventId) {
  return sendJson('DELETE', `${base(code)}/admin/events/${encodeURIComponent(eventId)}`)
}

// ── Admin: submission tasks ────────────────────────────────────────────────

export function fetchAdminTasks(code) {
  return getJsonAuth(`${base(code)}/admin/tasks`)
}

export function createAdminTask(code, payload) {
  return sendJson('POST', `${base(code)}/admin/tasks`, payload)
}

export function updateAdminTask(code, taskId, payload) {
  return sendJson('PUT', `${base(code)}/admin/tasks/${encodeURIComponent(taskId)}`, payload)
}

export function deleteAdminTask(code, taskId) {
  return sendJson('DELETE', `${base(code)}/admin/tasks/${encodeURIComponent(taskId)}`)
}

export function fetchAdminTaskMatrix(code, taskId, includeAll = false) {
  return getJsonAuth(
    `${base(code)}/admin/tasks/${encodeURIComponent(taskId)}/matrix${query({ include_all: includeAll })}`,
  )
}

export function adminTaskRemind(code, taskId, { sendWebhook = true, copyOnly = false } = {}) {
  return sendJson('POST', `${base(code)}/admin/tasks/${encodeURIComponent(taskId)}/remind`, {
    send_webhook: sendWebhook,
    copy_only: copyOnly,
  })
}

// ── Admin: teachers ────────────────────────────────────────────────────────

export function fetchAdminTeachers(code, autoSync = true) {
  return getJsonAuth(`${base(code)}/admin/teachers${query({ auto_sync: autoSync })}`)
}

export function syncAdminTeachers(code, includeTrainees = false) {
  return sendJson('POST', `${base(code)}/admin/teachers/sync${query({ include_trainees: includeTrainees })}`)
}

export function inferAdminDepts(code) {
  return sendJson('POST', `${base(code)}/admin/teachers/infer-depts`)
}

export function updateAdminTeacher(code, teacherId, payload) {
  return sendJson('PUT', `${base(code)}/admin/teachers/${encodeURIComponent(teacherId)}`, payload)
}

export function resetAdminPin(code, teacherId, pin = null) {
  return sendJson('POST', `${base(code)}/admin/teachers/${encodeURIComponent(teacherId)}/pin`, { pin })
}

// ── Admin: config / Drive ──────────────────────────────────────────────────

export function fetchAdminConfig(code) {
  return getJsonAuth(`${base(code)}/admin/config`)
}

export function updateAdminConfig(code, payload) {
  return sendJson('PUT', `${base(code)}/admin/config`, payload)
}

export function fetchAdminDriveStatus(code) {
  return getJsonAuth(`${base(code)}/admin/drive/status`)
}

export function connectAdminDrive(code) {
  return sendJson('POST', `${base(code)}/admin/drive/connect`)
}

export function disconnectAdminDrive(code) {
  return sendJson('POST', `${base(code)}/admin/drive/disconnect`)
}

/** Download an authenticated file (xlsx/zip) and save it with `filename`. */
export async function downloadAdminFile(code, path, filename) {
  const res = await fetch(`${BASE_URL}${base(code)}${path}`, { headers: authHeaders() })
  if (!res.ok) throw await parseError(res)
  const blob = await res.blob()
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(url)
}
