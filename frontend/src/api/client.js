const BASE_URL = 'http://127.0.0.1:8000'

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
