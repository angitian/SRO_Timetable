/**
 * Snapshot Version Manager
 *
 * Manages timetable workspace snapshots in localStorage.
 * Each snapshot captures the full workspace state (fixtureData + result +
 * userPlacements + solverPreset) so it can be restored later.
 *
 * Also provides JSON file export/import for backup & transfer.
 */

const STORAGE_KEY = 'sro_snapshots'
const SCHEMA_VERSION = 1

// ── localStorage size guard ────────────────────────────────────────────────
// Most browsers cap localStorage at ~5MB. We leave a safety margin.
const MAX_SNAPSHOT_BYTES = 4_500_000

/**
 * Estimate the byte size of a snapshot (UTF-16 → ~2 bytes per char).
 */
function estimateBytes(snapshot) {
  try {
    return JSON.stringify(snapshot).length * 2
  } catch {
    return 0
  }
}

// ── Snapshot list (metadata only) ──────────────────────────────────────────

/**
 * Read the snapshot index from localStorage.
 * Returns an array of snapshot metadata objects (without the heavy payload).
 */
export function listSnapshots() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const all = JSON.parse(raw)
    if (!Array.isArray(all)) return []
    // Return lightweight metadata for the dropdown
    return all
      .map((s) => ({
        id: s.id,
        label: s.label,
        status: s.status,
        version: s.version,
        fixtureName: s.fixtureName,
        solverPreset: s.solverPreset,
        description: s.description,
        createdAt: s.createdAt,
        updatedAt: s.updatedAt,
        bytes: s._bytes || estimateBytes(s),
      }))
      .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
  } catch (e) {
    console.error('[versionManager] listSnapshots failed:', e)
    return []
  }
}

/**
 * Read the full snapshot index (with payloads) from localStorage.
 * @returns {Array} full snapshot objects
 */
function readAllSnapshots() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const all = JSON.parse(raw)
    return Array.isArray(all) ? all : []
  } catch (e) {
    console.error('[versionManager] readAllSnapshots failed:', e)
    return []
  }
}

function writeAllSnapshots(snapshots) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshots))
    return true
  } catch (e) {
    console.error('[versionManager] writeAllSnapshots failed (quota?):', e)
    return false
  }
}

// ── Single snapshot CRUD ───────────────────────────────────────────────────

/**
 * Build a snapshot object from the current workspace state.
 */
export function buildSnapshot({ label, status, fixtureName, fixtureData, result, userPlacements, solverPreset, description, version }) {
  const now = Date.now()
  const snap = {
    id: `snap_${now}_${Math.random().toString(36).slice(2, 8)}`,
    schemaVersion: SCHEMA_VERSION,
    label: label || 'ตารางไม่มีชื่อ',
    status: status || 'draft',
    version: version || 1,
    fixtureName: fixtureName || 'custom',
    fixtureData: fixtureData || null,
    result: result || null,
    userPlacements: userPlacements || {},
    solverPreset: solverPreset || 'balanced',
    description: description || '',
    createdAt: now,
    updatedAt: now,
  }
  snap._bytes = estimateBytes(snap)
  return snap
}

/**
 * Save (or update) a snapshot in localStorage.
 * If `id` is provided and exists, updates it. Otherwise creates a new one.
 *
 * @returns {{ ok: boolean, snapshot?: object, error?: string }}
 */
export function saveSnapshot(snapshot) {
  if (!snapshot || !snapshot.id) {
    return { ok: false, error: 'snapshot missing id' }
  }
  const bytes = estimateBytes(snapshot)
  if (bytes > MAX_SNAPSHOT_BYTES) {
    return {
      ok: false,
      error: `ขนาด snapshot ใหญ่เกินไป (${(bytes / 1024 / 1024).toFixed(1)} MB) — กรุณาใช้ Export JSON แทน`,
    }
  }
  snapshot._bytes = bytes
  snapshot.updatedAt = Date.now()

  const all = readAllSnapshots()
  const idx = all.findIndex((s) => s.id === snapshot.id)
  if (idx >= 0) {
    // Preserve createdAt on update
    snapshot.createdAt = all[idx].createdAt
    all[idx] = snapshot
  } else {
    all.push(snapshot)
  }

  const ok = writeAllSnapshots(all)
  return ok
    ? { ok: true, snapshot }
    : { ok: false, error: 'ไม่สามารถบันทึกได้ — localStorage เต็ม (quota exceeded)' }
}

/**
 * Load a full snapshot by id (including payload).
 * @param {string} id
 * @returns {object|null}
 */
export function loadSnapshot(id) {
  const all = readAllSnapshots()
  return all.find((s) => s.id === id) || null
}

/**
 * Delete a snapshot by id.
 * @returns {boolean}
 */
export function deleteSnapshot(id) {
  const all = readAllSnapshots()
  const filtered = all.filter((s) => s.id !== id)
  if (filtered.length === all.length) return false
  return writeAllSnapshots(filtered)
}

/**
 * Update only the metadata of a snapshot (label, status, description)
 * without touching the payload.
 */
export function updateSnapshotMeta(id, meta) {
  const all = readAllSnapshots()
  const idx = all.findIndex((s) => s.id === id)
  if (idx < 0) return false
  all[idx] = { ...all[idx], ...meta, updatedAt: Date.now() }
  return writeAllSnapshots(all)
}

// ── JSON File Export / Import ──────────────────────────────────────────────

/**
 * Trigger a browser download of a snapshot as a .json file.
 */
export function exportToFile(snapshot) {
  if (!snapshot) return
  // Strip internal fields
  const { _bytes, ...clean } = snapshot
  const json = JSON.stringify(clean, null, 2)
  const blob = new Blob([json], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  const safeLabel = (snapshot.label || 'timetable').replace(/[^\w\u0E00-\u0E7F-]+/g, '_')
  a.href = url
  a.download = `${safeLabel}_${new Date(snapshot.updatedAt || Date.now()).toISOString().slice(0, 10)}.json`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

/**
 * Read a .json file from a File object and return the snapshot inside.
 * @param {File} file
 * @returns {Promise<object>}
 */
export function importFromFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result)
        if (!data.fixtureData && !data.result) {
          reject(new Error('ไฟล์ไม่ใช่ snapshot ที่ถูกต้อง (ไม่มี fixtureData หรือ result)'))
          return
        }
        // Ensure required fields
        const snapshot = {
          id: data.id || `snap_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          schemaVersion: data.schemaVersion || SCHEMA_VERSION,
          label: data.label || 'นำเข้าจากไฟล์',
          status: data.status || 'draft',
          version: data.version || 1,
          fixtureName: data.fixtureName || 'custom',
          fixtureData: data.fixtureData || null,
          result: data.result || null,
          userPlacements: data.userPlacements || {},
          solverPreset: data.solverPreset || 'balanced',
          description: data.description || '',
          createdAt: data.createdAt || Date.now(),
          updatedAt: Date.now(),
        }
        resolve(snapshot)
      } catch (e) {
        reject(new Error('ไม่สามารถอ่านไฟล์ JSON ได้: ' + e.message))
      }
    }
    reader.onerror = () => reject(new Error('อ่านไฟล์ไม่สำเร็จ'))
    reader.readAsText(file)
  })
}

// ── Helpers ────────────────────────────────────────────────────────────────

/**
 * Format a timestamp for display in the dropdown.
 */
export function formatSnapshotDate(ts) {
  if (!ts) return 'ไม่ทราบ'
  const date = new Date(ts)
  const now = new Date()
  const diff = now - date
  if (diff < 60000) return 'เมื่อสักครู่'
  if (diff < 3600000) return `${Math.floor(diff / 60000)} นาทีที่แล้ว`
  if (diff < 86400000) return `${Math.floor(diff / 3600000)} ชม.ที่แล้ว`
  return date.toLocaleDateString('th-TH', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
}

/**
 * Generate a default label for a new snapshot based on existing count.
 */
export function generateLabel(existingCount) {
  return `ตารางฉบับร่าง v${existingCount + 1}.0`
}
