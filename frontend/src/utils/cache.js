/**
 * Lightweight IndexedDB wrapper for offline caching of timetable data.
 * Uses the native IndexedDB API (no external dependency).
 */

const DB_NAME = 'sro-timetable'
const DB_VERSION = 1
const STORE_TIMETABLE = 'timetable'
const STORE_META = 'meta'

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onerror = () => reject(req.error)
    req.onsuccess = () => resolve(req.result)
    req.onupgradeneeded = (e) => {
      const db = e.target.result
      if (!db.objectStoreNames.contains(STORE_TIMETABLE)) {
        db.createObjectStore(STORE_TIMETABLE, { keyPath: 'key' })
      }
      if (!db.objectStoreNames.contains(STORE_META)) {
        db.createObjectStore(STORE_META, { keyPath: 'key' })
      }
    }
  })
}

async function get(store, key) {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readonly')
    const req = tx.objectStore(store).get(key)
    req.onerror = () => reject(req.error)
    req.onsuccess = () => resolve(req.result?.value ?? null)
  })
}

async function set(store, key, value) {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite')
    tx.objectStore(store).put({ key, value })
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

async function remove(store, key) {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite')
    tx.objectStore(store).delete(key)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

// ── Public API ──────────────────────────────────────────────────────────────

export async function cacheTimetable(key, data) {
  const payload = {
    ...data,
    _cachedAt: Date.now(),
  }
  await set(STORE_TIMETABLE, key, payload)
  await set(STORE_META, key, { version: data.version || 1, lastSync: Date.now() })
}

export async function getCachedTimetable(key) {
  return get(STORE_TIMETABLE, key)
}

export async function getCachedMeta(key) {
  return get(STORE_META, key)
}

export async function clearCache(key) {
  if (key) {
    await remove(STORE_TIMETABLE, key)
    await remove(STORE_META, key)
  } else {
    // Clear all
    const db = await openDB()
    for (const store of [STORE_TIMETABLE, STORE_META]) {
      await new Promise((resolve, reject) => {
        const tx = db.transaction(store, 'readwrite')
        tx.objectStore(store).clear()
        tx.oncomplete = () => resolve()
        tx.onerror = () => reject(tx.error)
      })
    }
  }
}

export function isOnline() {
  return navigator.onLine
}

export function formatLastSync(timestamp) {
  if (!timestamp) return 'ไม่ที่ทราบ'
  const date = new Date(timestamp)
  const now = new Date()
  const diff = now - date
  if (diff < 60000) return 'เมื่อสักครู่'
  if (diff < 3600000) return `${Math.floor(diff / 60000)} นาทีที่แล้ว`
  if (diff < 86400000) return `${Math.floor(diff / 3600000)} ชม.ที่แล้ว`
  return date.toLocaleDateString('th-TH', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
}
