import { BASE_URL } from './config.js'

export async function generateTimetable(requestData) {
  const res = await fetch(`${BASE_URL}/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(requestData),
  })
  if (!res.ok) {
    // Backend returns a full TimetableResponse (with diagnostics) on 422.
    // Try to parse it so callers can show actionable error messages.
    let payload = null
    try {
      payload = await res.json()
    } catch {
      const err = await res.text()
      throw new Error(err)
    }
    const error = new Error(
      payload?.metrics?.status
        ? `Solver คืนสถานะ ${payload.metrics.status}`
        : `HTTP ${res.status}`,
    )
    error.payload = payload
    throw error
  }
  return res.json()
}

export async function generateFromFile(filePath) {
  const res = await fetch(
    `${BASE_URL}/generate/from-file?file_path=${encodeURIComponent(filePath)}`,
    { method: 'POST' },
  )
  if (!res.ok) {
    const err = await res.text()
    throw new Error(err)
  }
  return res.json()
}

export async function healthCheck() {
  const res = await fetch(`${BASE_URL}/health`)
  if (!res.ok) throw new Error('Server unreachable')
  return res.json()
}

// ── Schedule Config ─────────────────────────────────────────────────────────

export async function listSchedules() {
  const res = await fetch(`${BASE_URL}/api/schedules`)
  if (!res.ok) throw new Error('Failed to fetch schedules')
  return res.json()
}

export async function getSchedule(id) {
  const res = await fetch(`${BASE_URL}/api/schedules/${id}`)
  if (!res.ok) throw new Error('Schedule not found')
  return res.json()
}

export async function createSchedule(template) {
  const res = await fetch(`${BASE_URL}/api/schedules`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(template),
  })
  if (!res.ok) throw new Error('Failed to create schedule')
  return res.json()
}

export async function updateSchedule(id, template) {
  const res = await fetch(`${BASE_URL}/api/schedules/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(template),
  })
  if (!res.ok) throw new Error('Failed to update schedule')
  return res.json()
}

export async function deleteSchedule(id) {
  const res = await fetch(`${BASE_URL}/api/schedules/${id}`, {
    method: 'DELETE',
  })
  if (!res.ok) throw new Error('Failed to delete schedule')
  return res.json()
}

// ── Timetable sharing (D1-backed short links) ───────────────────────────────

const USER_ID_KEY = 'sro_user_id'
const AUTH_TOKEN_KEY = 'sro_auth_token'

/**
 * Return a stable per-device user id (generated once, stored in localStorage).
 * Sent as the `X-User-Id` header on protected timetables endpoints.
 */
export function getUserId() {
  let id = localStorage.getItem(USER_ID_KEY)
  if (!id) {
    id = (crypto?.randomUUID?.() || `anon_${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`)
    localStorage.setItem(USER_ID_KEY, id)
  }
  return id
}

// ── Auth token management ───────────────────────────────────────────────────

export function getAuthToken() {
  return localStorage.getItem(AUTH_TOKEN_KEY)
}

export function setAuthToken(token) {
  if (token) localStorage.setItem(AUTH_TOKEN_KEY, token)
  else localStorage.removeItem(AUTH_TOKEN_KEY)
}

export function clearAuthToken() {
  localStorage.removeItem(AUTH_TOKEN_KEY)
}

/**
 * Build auth headers for API requests.
 * Prefers Bearer JWT (logged-in user) over X-User-Id (guest device id).
 */
export function authHeaders() {
  const token = getAuthToken()
  if (token) return { Authorization: `Bearer ${token}` }
  return { 'X-User-Id': getUserId() }
}

/**
 * Check if the user is logged in (has a JWT token).
 */
export function isLoggedIn() {
  return !!getAuthToken()
}

/**
 * Solve a TimetableRequest on the backend, persist the result, and return a
 * 6-char short_code + shareable URL.
 *
 * @param {{ title: string, academicYear: number, term: number, config: object, isPublic?: boolean }} payload
 * @returns {Promise<{ id: string, short_code: string, share_url: string, title: string, academic_year: number, term: number }>}
 */
export async function generateAndSaveTimetable({ title, academicYear, term, config, isPublic = true }) {
  const res = await fetch(`${BASE_URL}/api/v1/timetables/generate-and-save`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title, academic_year: academicYear, term, config, is_public: isPublic }),
  })
  // 422 = solver returned INFEASIBLE — backend sends a full TimetableResponse.
  if (res.status === 422) {
    let payload = null
    try { payload = await res.json() } catch { /* ignore */ }
    const err = new Error(payload?.metrics?.status ? `Solver คืนสถานะ ${payload.metrics.status}` : `HTTP ${res.status}`)
    err.payload = payload
    throw err
  }
  if (!res.ok) {
    const err = await res.text().catch(() => `HTTP ${res.status}`)
    throw new Error(err)
  }
  return res.json()
}

/**
 * Persist a pre-solved / manually-edited timetable WITHOUT re-running the
 * solver. The frontend sends the exact slots currently displayed so the
 * public viewer matches the printed page 1:1. Avoids the INFEASIBLE failure
 * mode that arises when locking user-edited placements and re-solving.
 *
 * @param {{ title: string, academicYear: number, term: number, config: object, result: object, isPublic?: boolean }} payload
 * @returns {Promise<{ id: string, short_code: string, share_url: string, title: string, academic_year: number, term: number }>}
 */
export async function saveTimetableResult({ title, academicYear, term, config, result, isPublic = true }) {
  const res = await fetch(`${BASE_URL}/api/v1/timetables/save-result`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title, academic_year: academicYear, term, config, result, is_public: isPublic }),
  })
  if (!res.ok) {
    let payload = null
    try { payload = await res.json() } catch { /* ignore */ }
    const err = new Error(payload?.detail || `HTTP ${res.status}`)
    err.payload = payload
    throw err
  }
  return res.json()
}

/**
 * Public: fetch a stored timetable by its 6-char short code.
 * @param {string} shortCode
 * @returns {Promise<object>} TimetableRecord (config + result parsed)
 */
export async function fetchTimetableByShortCode(shortCode) {
  const res = await fetch(`${BASE_URL}/api/v1/timetables/t/${encodeURIComponent(shortCode)}`)
  if (!res.ok) {
    const err = await res.text().catch(() => `HTTP ${res.status}`)
    throw new Error(err)
  }
  return res.json()
}

/**
 * Protected: list all timetables owned by the current user (X-User-Id).
 * @returns {Promise<object[]>} TimetableRecord[]
 */
export async function fetchMySchedules() {
  const res = await fetch(`${BASE_URL}/api/v1/timetables/my-schedules`, {
    headers: authHeaders(),
  })
  if (res.status === 401) throw new Error('กรุณาเข้าสู่ระบบเพื่อดูตารางของคุณ')
  if (!res.ok) throw new Error('Failed to fetch my schedules')
  return res.json()
}

/**
 * Protected: link an existing guest-created short_code to the current user.
 * @param {string} shortCode
 * @returns {Promise<object>} updated TimetableRecord
 */
export async function claimTimetable(shortCode) {
  const res = await fetch(`${BASE_URL}/api/v1/timetables/claim`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ short_code: shortCode }),
  })
  if (res.status === 401) throw new Error('กรุณาเข้าสู่ระบบเพื่อ claim ตาราง')
  if (!res.ok) {
    const err = await res.text().catch(() => `HTTP ${res.status}`)
    throw new Error(err)
  }
  return res.json()
}

// ── Auth (Google OAuth) ─────────────────────────────────────────────────────

/**
 * Redirect the browser to the Google OAuth consent screen.
 * The backend handles the callback and redirects back to /auth/callback.
 */
export async function loginWithGoogle() {
  const res = await fetch(`${BASE_URL}/api/v1/auth/google/url`)
  if (res.status === 503) throw new Error('Google login ยังไม่ได้เปิดใช้งาน')
  if (!res.ok) throw new Error('ไม่สามารถเริ่มการเข้าสู่ระบบได้')
  const { url } = await res.json()
  window.location.href = url
}

/**
 * Fetch the current user's profile (requires JWT).
 * @returns {Promise<{ id: string, email: string, name: string, picture: string|null }>}
 */
export async function fetchMe() {
  const token = getAuthToken()
  if (!token) return null
  const res = await fetch(`${BASE_URL}/api/v1/auth/me`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (res.status === 401) {
    // Token expired or invalid — clear it
    clearAuthToken()
    return null
  }
  if (!res.ok) return null
  return res.json()
}

// ── Workspace save/load (private, owner-scoped) ─────────────────────────────

/**
 * Save the full workspace to the cloud (no re-solve).
 * @param {{ id?: string, title: string, academicYear: number, term: number, workspace: object }} payload
 * @returns {Promise<{ id: string, title: string, updated_at: string }>}
 */
export async function saveWorkspaceToCloud({ id, title, academicYear, term, workspace }) {
  const res = await fetch(`${BASE_URL}/api/v1/timetables/save-workspace`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({
      id: id || null,
      title,
      academic_year: academicYear,
      term,
      workspace,
    }),
  })
  if (res.status === 401) throw new Error('กรุณาเข้าสู่ระบบเพื่อบันทึกขึ้นคลาวด์')
  if (!res.ok) {
    const err = await res.text().catch(() => `HTTP ${res.status}`)
    throw new Error(err)
  }
  return res.json()
}

/**
 * Fetch a private workspace by id (must be owned by the caller).
 * @param {string} id
 * @returns {Promise<object>} TimetableRecord with workspace field
 */
export async function fetchCloudWorkspace(id) {
  const res = await fetch(`${BASE_URL}/api/v1/timetables/workspace/${id}`, {
    headers: authHeaders(),
  })
  if (res.status === 404) throw new Error('ไม่พบตาราง หรือไม่ใช่ของคุณ')
  if (res.status === 401) throw new Error('กรุณาเข้าสู่ระบบเพื่อโหลดตารางจากคลาวด์')
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

/**
 * Delete a private workspace (must be owned by the caller).
 * @param {string} id
 */
export async function deleteCloudWorkspace(id) {
  const res = await fetch(`${BASE_URL}/api/v1/timetables/workspace/${id}`, {
    method: 'DELETE',
    headers: authHeaders(),
  })
  if (!res.ok) throw new Error('ลบไม่สำเร็จ')
  return res.json()
}

/**
 * Merge guest-created records (saved with device id) into the logged-in user.
 * @param {string} deviceId
 * @returns {Promise<{ ok: boolean, merged: number }>}
 */
export async function mergeGuestWorkspaces(deviceId) {
  const res = await fetch(`${BASE_URL}/api/v1/timetables/merge-guest`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ device_id: deviceId }),
  })
  if (res.status === 403) throw new Error('ต้องเข้าสู่ระบบก่อนจึงจะรวมข้อมูลได้')
  if (!res.ok) throw new Error('รวมข้อมูลไม่สำเร็จ')
  return res.json()
}
