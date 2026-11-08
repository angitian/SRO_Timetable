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
  let res
  try {
    res = await fetch(`${BASE_URL}/api/v1/auth/google/url`)
  } catch {
    throw new Error(`เชื่อมต่อ backend ไม่ได้ (${BASE_URL}) — ตรวจสอบว่า backend รันอยู่`)
  }
  if (res.status === 503) {
    throw new Error('Google login ยังไม่ได้เปิดใช้งาน — backend ยังไม่ตั้ง GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET / JWT_SECRET')
  }
  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    throw new Error(`ไม่สามารถเริ่มการเข้าสู่ระบบได้ (HTTP ${res.status})${detail ? `: ${detail.slice(0, 200)}` : ''}`)
  }
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
export async function saveWorkspaceToCloud({ id, title, academicYear, term, workspace, managerEmails, accessMode }) {
  const res = await fetch(`${BASE_URL}/api/v1/timetables/save-workspace`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({
      id: id || null,
      title,
      academic_year: academicYear,
      term,
      workspace,
      manager_emails: managerEmails ?? null,
      access_mode: accessMode ?? null,
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
 * Share the daily substitute documents (สร้าง/อัปเดตลิงก์ของวันนั้น).
 * Re-sharing the same date reuses the existing short code.
 * @param {{ date: string, payload: object }} body
 * @returns {Promise<{ id: string, short_code: string, share_url: string, date: string }>}
 */
export async function shareSubstituteSchedule({ date, payload }) {
  const res = await fetch(`${BASE_URL}/api/v1/substitutes/share`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ date, payload }),
  })
  if (!res.ok) {
    let detail = `HTTP ${res.status}`
    try {
      const body = await res.json()
      if (body?.detail) detail = body.detail
    } catch { /* ignore */ }
    throw new Error(detail)
  }
  return res.json()
}

/**
 * Public: fetch a shared substitute document set by short code.
 * @param {string} code
 */
export async function fetchSubstituteShare(code) {
  const res = await fetch(`${BASE_URL}/api/v1/substitutes/t/${encodeURIComponent(code)}`)
  if (res.status === 404) throw new Error('ไม่พบลิงก์สอนแทน หรือลิงก์ถูกยกเลิกแล้ว')
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

/**
 * Update the manager_emails list on a workspace — owner only.
 * @param {string} id
 * @param {string[]} emails
 */
export async function updateWorkspaceManagers(id, emails) {
  const res = await fetch(`${BASE_URL}/api/v1/timetables/workspace/${id}/managers`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ manager_emails: emails }),
  })
  if (res.status === 401) throw new Error('กรุณาเข้าสู่ระบบก่อน')
  if (!res.ok) {
    const err = await res.text().catch(() => `HTTP ${res.status}`)
    throw new Error(err)
  }
  return res.json()
}

/**
 * Set the sharing scope of a workspace — owner only.
 * 'team' = everyone in the owner's team; 'private' = owner + manager_emails only.
 * @param {string} id
 * @param {'team'|'private'} mode
 */
export async function updateWorkspaceAccess(id, mode) {
  const res = await fetch(`${BASE_URL}/api/v1/timetables/workspace/${id}/access`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ mode }),
  })
  if (res.status === 401) throw new Error('กรุณาเข้าสู่ระบบก่อน')
  if (res.status === 404) throw new Error('ไม่พบตาราง หรือคุณไม่ใช่เจ้าของ')
  if (!res.ok) {
    const err = await res.text().catch(() => `HTTP ${res.status}`)
    throw new Error(err)
  }
  return res.json()
}

// ── Team sharing (owner adds an email once → all their workspaces shared) ────

async function _readError(res, fallback) {
  try {
    const body = await res.json()
    return body?.detail || fallback
  } catch {
    return fallback
  }
}

/**
 * Fetch the caller's own team + the teams they belong to (requires JWT).
 * @returns {Promise<{ owner_id: string, owner_email: string, owner_name: string,
 *   members: {email:string,name:string|null,picture:string|null,status:string,added_at:string}[],
 *   memberships: {owner_id:string,owner_email:string,owner_name:string}[] }>}
 */
export async function fetchTeam() {
  const res = await fetch(`${BASE_URL}/api/v1/team`, { headers: authHeaders() })
  if (res.status === 401 || res.status === 403) throw new Error('กรุณาเข้าสู่ระบบก่อนจัดการทีม')
  if (!res.ok) throw new Error('โหลดข้อมูลทีมไม่สำเร็จ')
  return res.json()
}

/**
 * Add an email to the caller's team.
 * @param {string} email
 */
export async function addTeamMember(email, defaultWorkspaceRole = 'editor', defaultTraineeRole = 'none') {
  const res = await fetch(`${BASE_URL}/api/v1/team/members`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({
      email,
      default_workspace_role: defaultWorkspaceRole,
      default_trainee_role: defaultTraineeRole,
    }),
  })
  if (!res.ok) throw new Error(await _readError(res, `เพิ่มผู้ใช้ไม่สำเร็จ (HTTP ${res.status})`))
  return res.json()
}

/** Update a team member's default workspace/trainee roles (team owner only). */
export async function updateTeamMemberRoles(email, defaultWorkspaceRole, defaultTraineeRole) {
  const res = await fetch(`${BASE_URL}/api/v1/team/members/${encodeURIComponent(email)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({
      default_workspace_role: defaultWorkspaceRole,
      default_trainee_role: defaultTraineeRole,
    }),
  })
  if (!res.ok) throw new Error(await _readError(res, `แก้สิทธิ์ผู้ใช้ไม่สำเร็จ (HTTP ${res.status})`))
  return res.json()
}

/**
 * Remove an email from the caller's team.
 * @param {string} email
 */
export async function removeTeamMember(email) {
  const res = await fetch(`${BASE_URL}/api/v1/team/members/${encodeURIComponent(email)}`, {
    method: 'DELETE',
    headers: authHeaders(),
  })
  if (!res.ok) throw new Error(await _readError(res, `ถอดผู้ใช้ไม่สำเร็จ (HTTP ${res.status})`))
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

// ── Workspace roles ────────────────────────────────────────────────────────

export async function fetchWorkspaceMembers(id) {
  const res = await fetch(`${BASE_URL}/api/v1/timetables/workspace/${id}/members`, {
    headers: authHeaders(),
  })
  if (res.status === 404) throw new Error('ไม่พบ workspace หรือไม่มีสิทธิ์เข้าถึง')
  if (!res.ok) throw new Error(await _readError(res, `โหลดสมาชิกไม่สำเร็จ (HTTP ${res.status})`))
  return res.json()
}

export async function saveWorkspaceMembers(id, members) {
  const res = await fetch(`${BASE_URL}/api/v1/timetables/workspace/${id}/members`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ members }),
  })
  if (!res.ok) throw new Error(await _readError(res, `บันทึกสมาชิกไม่สำเร็จ (HTTP ${res.status})`))
  return res.json()
}

// ── Trainee attendance module ─────────────────────────────────────────────

export async function listMyTraineeWorkspaces() {
  const res = await fetch(`${BASE_URL}/api/v1/trainees/mine`, { headers: authHeaders() })
  if (res.status === 401 || res.status === 403) throw new Error('กรุณาเข้าสู่ระบบเพื่อใช้โมดูลนักศึกษา')
  if (!res.ok) throw new Error(await _readError(res, `โหลดรายการโมดูลไม่สำเร็จ (HTTP ${res.status})`))
  return res.json()
}

export async function fetchTraineeWorkspace(timetableId) {
  const res = await fetch(`${BASE_URL}/api/v1/trainees/${encodeURIComponent(timetableId)}`, {
    headers: authHeaders(),
  })
  if (res.status === 404) throw new Error('ไม่พบโมดูลนักศึกษา หรือไม่มีสิทธิ์เข้าถึง')
  if (res.status === 403) throw new Error(await _readError(res, 'ต้องเข้าสู่ระบบหรือมีสิทธิ์จึงจะใช้โมดูลนี้'))
  if (!res.ok) throw new Error(await _readError(res, `โหลดข้อมูลไม่สำเร็จ (HTTP ${res.status})`))
  return res.json()
}

export async function saveTraineeWorkspace(timetableId, data, baseVersion) {
  const res = await fetch(`${BASE_URL}/api/v1/trainees/${encodeURIComponent(timetableId)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ data, base_version: baseVersion }),
  })
  if (res.status === 409) {
    let payload = null
    try { payload = await res.json() } catch { /* ignore */ }
    const err = new Error(payload?.detail?.message || 'ข้อมูลถูกแก้ไขโดยผู้ใช้อื่น')
    err.status = 409
    err.current = payload?.detail?.current || null
    throw err
  }
  if (!res.ok) throw new Error(await _readError(res, `บันทึกไม่สำเร็จ (HTTP ${res.status})`))
  return res.json()
}

export async function fetchTraineeMembers(timetableId) {
  const res = await fetch(`${BASE_URL}/api/v1/trainees/${encodeURIComponent(timetableId)}/members`, {
    headers: authHeaders(),
  })
  if (!res.ok) throw new Error(await _readError(res, `โหลดสิทธิ์ไม่สำเร็จ (HTTP ${res.status})`))
  return res.json()
}

export async function saveTraineeMembers(timetableId, members, accessMode = null) {
  const res = await fetch(`${BASE_URL}/api/v1/trainees/${encodeURIComponent(timetableId)}/members`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ members, access_mode: accessMode }),
  })
  if (!res.ok) throw new Error(await _readError(res, `บันทึกสิทธิ์ไม่สำเร็จ (HTTP ${res.status})`))
  return res.json()
}

// ── Trainee public summary share (/view?tr=CODE) ───────────────────────────

export async function fetchTraineeShare(timetableId) {
  const res = await fetch(`${BASE_URL}/api/v1/trainees/${encodeURIComponent(timetableId)}/share`, {
    headers: authHeaders(),
  })
  if (!res.ok) throw new Error(await _readError(res, `โหลดลิงก์แชร์ไม่สำเร็จ (HTTP ${res.status})`))
  return res.json()
}

export async function shareTraineeSummary(timetableId, payload) {
  const res = await fetch(`${BASE_URL}/api/v1/trainees/${encodeURIComponent(timetableId)}/share`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ payload }),
  })
  if (res.status === 404) throw new Error('ยังไม่มีข้อมูลโมดูลบนคลาวด์ — บันทึกข้อมูลก่อนแชร์')
  if (res.status === 403) throw new Error('ต้องเข้าสู่ระบบและมีสิทธิ์แก้ไขโมดูล')
  if (!res.ok) throw new Error(await _readError(res, `สร้างลิงก์แชร์ไม่สำเร็จ (HTTP ${res.status})`))
  return res.json()
}

export async function deleteTraineeShare(timetableId) {
  const res = await fetch(`${BASE_URL}/api/v1/trainees/${encodeURIComponent(timetableId)}/share`, {
    method: 'DELETE',
    headers: authHeaders(),
  })
  if (!res.ok) throw new Error(await _readError(res, `ยกเลิกลิงก์ไม่สำเร็จ (HTTP ${res.status})`))
  return res.json()
}

export async function fetchPublicTraineeShare(code) {
  const res = await fetch(`${BASE_URL}/api/v1/trainees/share/${encodeURIComponent(code)}`)
  if (res.status === 404) throw new Error('ไม่พบลิงก์แชร์ผลสรุป หรือลิงก์ถูกยกเลิกแล้ว')
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
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
