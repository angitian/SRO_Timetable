import { useCallback, useEffect, useRef, useState } from 'react'
import { fetchTraineeWorkspace, saveTraineeWorkspace } from '../api/client.js'
import {
  emptyTraineeData,
  readTraineeCache,
  writeTraineeCache,
} from '../utils/traineeAttendance.js'

/**
 * Load/save a trainee module with a local-first cache and debounced cloud sync.
 *
 * - local workspace: cache only, no cloud calls
 * - cloud module: fetch server, keep local cache for offline, use base_version
 *   for optimistic concurrency; a 409 surfaces a conflict object for the UI.
 */
export default function useTraineeWorkspace(timetableId, {
  cloudEnabled = false,
  canEdit = false,
  initialReference = null,
} = {}) {
  const [data, setData] = useState(() => emptyTraineeData(initialReference))
  const [version, setVersion] = useState(0)
  const [role, setRole] = useState(canEdit ? 'owner' : 'viewer')
  const [canEditNow, setCanEditNow] = useState(!!canEdit)
  const [loading, setLoading] = useState(!!timetableId)
  const [syncState, setSyncState] = useState('idle') // idle | saving | saved | offline | error | conflict
  const [error, setError] = useState('')
  const [conflict, setConflict] = useState(null)

  const dataRef = useRef(data)
  const versionRef = useRef(version)
  const dirtyRef = useRef(false)
  const canEditRef = useRef(canEditNow)
  const saveTimerRef = useRef(null)
  const mountedRef = useRef(true)

  useEffect(() => {
    dataRef.current = data
  }, [data])
  useEffect(() => {
    versionRef.current = version
  }, [version])
  useEffect(() => {
    canEditRef.current = canEditNow
  }, [canEditNow])

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    }
  }, [])

  const persistCache = useCallback((nextData, nextVersion, dirty) => {
    if (!timetableId) return
    writeTraineeCache(timetableId, {
      data: nextData,
      version: nextVersion,
      dirty,
      updatedAt: Date.now(),
    })
  }, [timetableId])

  const applyServer = useCallback((server) => {
    const nextData = server.data && Object.keys(server.data).length > 0
      ? server.data
      : emptyTraineeData(initialReference)
    setData(nextData)
    dataRef.current = nextData
    setVersion(server.version || 0)
    versionRef.current = server.version || 0
    setRole(server.my_trainee_role || 'none')
    setCanEditNow(!!server.can_edit_trainees)
    canEditRef.current = !!server.can_edit_trainees
    dirtyRef.current = false
    persistCache(nextData, server.version || 0, false)
  }, [initialReference, persistCache])

  const saveNow = useCallback(async (overrideData = null) => {
    if (!timetableId) return { ok: false }
    const payload = overrideData || dataRef.current
    if (!cloudEnabled) {
      persistCache(payload, versionRef.current, false)
      dirtyRef.current = false
      if (mountedRef.current) setSyncState('saved')
      return { ok: true, local: true }
    }
    if (!canEditRef.current) return { ok: false, error: 'read-only' }
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current)
      saveTimerRef.current = null
    }
    if (mountedRef.current) {
      setSyncState('saving')
      setError('')
    }
    try {
      const saved = await saveTraineeWorkspace(timetableId, payload, versionRef.current)
      if (!mountedRef.current) return { ok: true }
      setVersion(saved.version || 0)
      versionRef.current = saved.version || 0
      setRole(saved.my_trainee_role || role)
      setCanEditNow(!!saved.can_edit_trainees)
      canEditRef.current = !!saved.can_edit_trainees
      dirtyRef.current = false
      setSyncState('saved')
      setConflict(null)
      persistCache(payload, saved.version || 0, false)
      return { ok: true, saved }
    } catch (e) {
      if (!mountedRef.current) return { ok: false }
      if (e.status === 409) {
        setConflict(e.current || null)
        setSyncState('conflict')
        setError(e.message || 'ข้อมูลถูกแก้ไขโดยผู้ใช้อื่น')
      } else {
        setError(e.message || 'บันทึกไม่สำเร็จ')
        setSyncState(navigator.onLine ? 'error' : 'offline')
        persistCache(payload, versionRef.current, true)
      }
      return { ok: false, error: e.message, conflict: e.status === 409 }
    }
  }, [cloudEnabled, persistCache, role, timetableId])

  const scheduleSave = useCallback((nextData) => {
    if (!cloudEnabled || !canEditRef.current) return
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    saveTimerRef.current = setTimeout(() => {
      saveTimerRef.current = null
      saveNow(nextData)
    }, 900)
  }, [cloudEnabled, saveNow])

  const mutate = useCallback((updater) => {
    if (!canEditRef.current) return false
    setData((prev) => {
      const next = typeof updater === 'function' ? updater(prev) : updater
      dataRef.current = next
      dirtyRef.current = cloudEnabled
      persistCache(next, versionRef.current, cloudEnabled)
      scheduleSave(next)
      return next
    })
    return true
  }, [cloudEnabled, persistCache, scheduleSave])

  useEffect(() => {
    if (!timetableId) {
      setLoading(false)
      return
    }
    let cancelled = false
    setLoading(true)
    setError('')
    setConflict(null)
    setSyncState('idle')

    const cached = readTraineeCache(timetableId)
    if (cached) {
      setData(cached.data)
      dataRef.current = cached.data
      setVersion(cached.version || 0)
      versionRef.current = cached.version || 0
      dirtyRef.current = !!cached.dirty
    } else {
      const empty = emptyTraineeData(initialReference)
      setData(empty)
      dataRef.current = empty
      setVersion(0)
      versionRef.current = 0
      dirtyRef.current = false
    }

    if (!cloudEnabled) {
      setCanEditNow(!!canEdit)
      canEditRef.current = !!canEdit
      setRole(canEdit ? 'owner' : 'viewer')
      setLoading(false)
      setSyncState(cached?.dirty ? 'saved' : 'idle')
      return () => { cancelled = true }
    }

    fetchTraineeWorkspace(timetableId)
      .then((server) => {
        if (cancelled) return
        setRole(server.my_trainee_role || 'none')
        setCanEditNow(!!server.can_edit_trainees)
        canEditRef.current = !!server.can_edit_trainees

        if (cached?.dirty) {
          if (cached.version === (server.version || 0)) {
            // Local unsynced edits on the same base version — keep local.
            setSyncState('offline')
          } else {
            // Both changed: let the user choose.
            setConflict(server)
            setSyncState('conflict')
            setError('พบข้อมูลใหม่จากคลาวด์และมีการแก้ไขในเครื่อง')
          }
        } else if (cached && cached.version > (server.version || 0)) {
          setSyncState('offline')
        } else {
          applyServer(server)
          setSyncState('saved')
        }
      })
      .catch((e) => {
        if (cancelled) return
        setError(e.message || 'โหลดข้อมูลไม่สำเร็จ')
        setSyncState(cached ? 'offline' : 'error')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => { cancelled = true }
  }, [timetableId, cloudEnabled, canEdit, initialReference, applyServer])

  useEffect(() => {
    const retry = () => {
      if (dirtyRef.current && canEditRef.current) saveNow()
    }
    window.addEventListener('online', retry)
    return () => window.removeEventListener('online', retry)
  }, [saveNow])

  // Push any dirty local cache after the initial server check completes.
  useEffect(() => {
    if (loading || !cloudEnabled) return
    if (dirtyRef.current && canEditRef.current && !conflict) {
      const timer = setTimeout(() => saveNow(), 300)
      return () => clearTimeout(timer)
    }
  }, [loading, cloudEnabled, conflict, saveNow])

  const useServerCopy = useCallback(() => {
    if (!conflict) return
    applyServer(conflict)
    setConflict(null)
    setError('')
    setSyncState('saved')
  }, [conflict, applyServer])

  const overwriteServer = useCallback(() => {
    if (!conflict) return
    const base = conflict.version || 0
    setVersion(base)
    versionRef.current = base
    setConflict(null)
    setError('')
    setTimeout(() => saveNow(dataRef.current), 0)
  }, [conflict, saveNow])

  return {
    data,
    version,
    role,
    canEdit: canEditNow,
    loading,
    syncState,
    error,
    conflict,
    mutate,
    saveNow,
    useServerCopy,
    overwriteServer,
    setError,
  }
}
