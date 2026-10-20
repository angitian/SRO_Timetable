import { createContext, useContext, useReducer, useCallback, useEffect, useRef } from 'react'
import {
  generateTimetable,
  loginWithGoogle,
  fetchMe,
  clearAuthToken,
  getAuthToken,
  fetchMySchedules,
  saveWorkspaceToCloud,
  fetchCloudWorkspace,
  deleteCloudWorkspace,
  mergeGuestWorkspaces,
  getUserId,
} from '../api/client.js'
import { cacheTimetable, getCachedTimetable, getCachedMeta, clearCache } from '../utils/cache.js'
import { resolveSolverParams } from '../utils/scoreCalculator.js'
import {
  listSnapshots,
  loadSnapshot,
  saveSnapshot as vmSaveSnapshot,
  deleteSnapshot as vmDeleteSnapshot,
  exportToFile,
  importFromFile,
  buildSnapshot,
  generateLabel,
} from '../utils/versionManager.js'

const AppContext = createContext(null)

const initialState = {
  selectedFixture: 'small',
  fixtureData: null,
  isLoadingFixture: false,
  isGenerating: false,
  result: null,
  error: null,
  errorResponse: null, // full TimetableResponse payload when 422 INFEASIBLE
  activeStep: 0,
  isDirty: false,
  gridFilter: { class: null, teacher: null },
  cacheKey: null,
  lastSync: null,
  // Hint of the most recent cached timetable (IndexedDB) so the landing page
  // can offer a "ทำงานต่อ" card WITHOUT auto-jumping the user to step 5.
  cacheHint: null, // { cacheKey, lastCachedAt }
  optimizationMode: 'BALANCED',
  solverPreset: 'balanced',
  solverCustomTime: 60, // seconds — used when solverPreset === 'custom'
  solverCustomMode: 'BALANCED', // 'BALANCED' | 'DEEP' — used when solverPreset === 'custom'
  // userPlacements: { [lesson_block_id]: [{ day, period }] }
  // Tracks lesson blocks the user manually dragged onto the grid (📌 pre-assigned).
  userPlacements: {},
  // substitutes: [{ id, day, period, class_id, subject_id, original_teacher_id, substitute_teacher_id }]
  // Manual "สอนแทน" overrides applied AFTER generation (display-level only).
  substitutes: [],
  // dailySchedules: { "YYYY-MM-DD": { date, dayOfWeek, absentTeacherIds, note, assignments[] } }
  // ตารางสอนแทนรายวัน — layer แยกจากตารางหลัก ไม่ปนกับ substitutes/result
  dailySchedules: {},
  // ── Snapshot versioning ──
  snapshots: [], // metadata list for dropdown
  activeSnapshotId: null, // currently loaded snapshot id
  activeSnapshotLabel: null, // display label
  isSnapshotDirty: false, // unsaved changes since last snapshot save
  lastSnapshotSaveAt: null, // timestamp for "saved X ago" display
  // ── Auth (Google OAuth, optional) ──
  user: null, // { id, email, name, picture } or null when logged out
  authToken: null, // JWT string or null
  // ── Cloud workspaces ──
  cloudWorkspaces: [], // list of cloud-saved workspaces (metadata)
  activeCloudWorkspaceId: null, // currently loaded cloud workspace id
  cloudSyncing: false, // true while saving/loading from cloud
}

function reducer(state, action) {
  switch (action.type) {
    case 'SET_FIXTURE':
      return { ...state, selectedFixture: action.payload }
    case 'SET_FIXTURE_DATA':
      return {
        ...state,
        fixtureData: action.payload
          ? { ...action.payload, special_rooms: action.payload.special_rooms || [] }
          : action.payload,
        isLoadingFixture: false,
        isDirty: false,
        // ล้าง result/placements เก่าเมื่อเปลี่ยน fixture
        result: null,
        userPlacements: {},
        substitutes: [],
        dailySchedules: {},
        error: null,
        errorResponse: null,
        cacheHint: null,
      }
    case 'SET_LOADING_FIXTURE':
      return { ...state, isLoadingFixture: action.payload }
    case 'SET_GENERATING':
      return { ...state, isGenerating: action.payload }
    case 'SET_RESULT':
      return { ...state, result: action.payload, isGenerating: false, error: null, errorResponse: null, isDirty: false, activeStep: 5 }
    case 'SET_ERROR':
      return { ...state, error: action.payload.message, errorResponse: action.payload.response || null, isGenerating: false }
    case 'SET_STEP':
      return { ...state, activeStep: action.payload }
    case 'SET_GRID_FILTER':
      return { ...state, gridFilter: action.payload }
    case 'SET_OPTIMIZATION_MODE':
      return { ...state, optimizationMode: action.payload }
    case 'SET_SOLVER_PRESET':
      return { ...state, solverPreset: action.payload }
    case 'SET_SOLVER_CUSTOM_TIME':
      return { ...state, solverCustomTime: action.payload }
    case 'SET_SOLVER_CUSTOM_MODE':
      return { ...state, solverCustomMode: action.payload }
    case 'SET_FIXTURE_DATA_DIRECT':
      return {
        ...state,
        fixtureData: action.payload
          ? { ...action.payload, special_rooms: action.payload.special_rooms || [] }
          : action.payload,
        isLoadingFixture: false,
        selectedFixture: 'custom',
        isDirty: true,
        // ล้าง state เก่าทั้งหมดเมื่ออัปโหลดไฟล์ใหม่/สร้างใหม่
        result: null,
        userPlacements: {},
        substitutes: [],
        dailySchedules: {},
        error: null,
        errorResponse: null,
        cacheKey: null,
        lastSync: null,
        cacheHint: null,
      }
    case 'UPDATE_FIXTURE_DATA':
      return { ...state, fixtureData: { ...state.fixtureData, ...action.payload }, isDirty: true }
    case 'SET_DIRTY':
      return { ...state, isDirty: action.payload }
    case 'SET_CACHE_INFO':
      return { ...state, cacheKey: action.payload.cacheKey, lastSync: action.payload.lastSync }
    case 'PLACE_LESSON_BLOCK': {
      // payload: { lessonBlockId, day, period }
      const { lessonBlockId, day, period } = action.payload
      const existing = state.userPlacements[lessonBlockId] || []
      // Avoid duplicate placements at the same (day, period)
      if (existing.some((p) => p.day === day && p.period === period)) {
        return state
      }
      // Guard: don't exceed periods_per_week for this lesson block
      // — but skip the guard if a solver slot already exists at this (day, period),
      // because pinning an existing solver slot doesn't consume a new period.
      const lb = state.fixtureData?.lesson_blocks?.find((b) => b.id === lessonBlockId)
      const solverSlotAtTarget = (state.result?.slots || []).some(
        (s) => s.lesson_block_id === lessonBlockId && s.day === day && s.period === period,
      )
      if (!solverSlotAtTarget) {
        const solverPlaced =
          state.result?.slots?.filter((s) => s.lesson_block_id === lessonBlockId).length || 0
        const totalPlaced = existing.length + solverPlaced
        if (lb && totalPlaced >= (lb.periods_per_week || 0)) {
          return state // already fully placed
        }
      }
      return {
        ...state,
        userPlacements: {
          ...state.userPlacements,
          [lessonBlockId]: [...existing, { day, period }],
        },
      }
    }
    case 'REMOVE_PLACEMENT': {
      // payload: { lessonBlockId, day, period }
      const { lessonBlockId, day, period } = action.payload
      const existing = state.userPlacements[lessonBlockId] || []
      const filtered = existing.filter((p) => !(p.day === day && p.period === period))
      const newUserPlacements = { ...state.userPlacements }
      if (filtered.length === 0) {
        delete newUserPlacements[lessonBlockId]
      } else {
        newUserPlacements[lessonBlockId] = filtered
      }
      return { ...state, userPlacements: newUserPlacements }
    }
    case 'CLEAR_PLACEMENTS':
      return { ...state, userPlacements: {} }
    case 'SET_SUBSTITUTE': {
      // payload: { day, period, class_id, subject_id, original_teacher_id, substitute_teacher_id }
      // Upsert per (day, period, class_id) — one substitute per slot.
      const subs = state.substitutes || []
      const existingIdx = subs.findIndex(
        (s) => s.day === action.payload.day && s.period === action.payload.period && s.class_id === action.payload.class_id
      )
      const entry = {
        id: existingIdx >= 0 ? subs[existingIdx].id : `SUB_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        ...action.payload,
      }
      const next = existingIdx >= 0
        ? subs.map((s, i) => (i === existingIdx ? entry : s))
        : [...subs, entry]
      return { ...state, substitutes: next, isSnapshotDirty: true }
    }
    case 'REMOVE_SUBSTITUTE':
      return {
        ...state,
        substitutes: (state.substitutes || []).filter((s) => s.id !== action.payload.id),
        isSnapshotDirty: true,
      }
    case 'CLEAR_SUBSTITUTES':
      return { ...state, substitutes: [], isSnapshotDirty: true }
    case 'RESTORE_SUBSTITUTES':
      return { ...state, substitutes: Array.isArray(action.payload) ? action.payload : [] }
    case 'SET_DAILY_SCHEDULE': {
      // payload: full DailySchedule object (upsert ตาม date)
      const date = action.payload?.date
      if (!date) return state
      return {
        ...state,
        dailySchedules: { ...state.dailySchedules, [date]: action.payload },
      }
    }
    case 'REMOVE_DAILY_SCHEDULE': {
      // payload: { date }
      const next = { ...state.dailySchedules }
      delete next[action.payload.date]
      return { ...state, dailySchedules: next }
    }
    case 'RESTORE_DAILY_SCHEDULES':
      return { ...state, dailySchedules: (action.payload && typeof action.payload === 'object') ? action.payload : {} }
    case 'CLEAR_RESULT':
      // Keep cacheKey so the result-cache effect (below) can delete the stale
      // IndexedDB entry — otherwise "ทำงานต่อ" would resurrect the old result.
      // cacheHint is cleared so the resume card disappears in this session too.
      return { ...state, result: null, error: null, errorResponse: null, lastSync: null, cacheHint: null }
    case 'RESTORE_PLACEMENTS': {
      // Filter out placements whose lesson_block_id no longer exists in the
      // current fixtureData. This prevents stale placements from a previous
      // session (e.g. after uploading a new Excel file) from being restored
      // and merging with the new solver output, which caused duplicate slots.
      const validLbIds = new Set(
        (state.fixtureData?.lesson_blocks || []).map((lb) => lb.id),
      )
      const filteredPlacements = {}
      for (const [lbId, placements] of Object.entries(action.payload || {})) {
        if (validLbIds.has(lbId)) filteredPlacements[lbId] = placements
      }
      return { ...state, userPlacements: filteredPlacements }
    }
    case 'CLEAR_ALL_SLOTS':
      // Keep cacheKey so the result-cache effect can delete the stale entry.
      return {
        ...state,
        userPlacements: {},
        result: null,
        error: null,
        errorResponse: null,
        lastSync: null,
        cacheHint: null,
      }
    case 'CLEAR_BY_TEACHER': {
      const { teacherId, lessonBlocks } = action.payload
      const ids = new Set(
        (lessonBlocks || []).filter((lb) => lb.teacher_id === teacherId).map((lb) => lb.id),
      )
      const newUP = {}
      for (const [lbId, p] of Object.entries(state.userPlacements || {})) {
        if (!ids.has(lbId)) newUP[lbId] = p
      }
      const newSlots = state.result?.slots
        ? state.result.slots.filter((s) => s.teacher_id !== teacherId)
        : []
      return {
        ...state,
        userPlacements: newUP,
        result: state.result ? { ...state.result, slots: newSlots } : null,
      }
    }
    case 'PIN_BY_TEACHER': {
      const { teacherId } = action.payload
      const newUP = { ...state.userPlacements }
      for (const slot of (state.result?.slots || [])) {
        if (slot.teacher_id === teacherId) {
          const existing = newUP[slot.lesson_block_id] || []
          if (!existing.some((p) => p.day === slot.day && p.period === slot.period)) {
            newUP[slot.lesson_block_id] = [...existing, { day: slot.day, period: slot.period }]
          }
        }
      }
      return { ...state, userPlacements: newUP }
    }
    case 'UNPIN_BY_TEACHER': {
      const { teacherId, lessonBlocks } = action.payload
      const ids = new Set(
        (lessonBlocks || []).filter((lb) => lb.teacher_id === teacherId).map((lb) => lb.id),
      )
      const newUP = {}
      for (const [lbId, p] of Object.entries(state.userPlacements || {})) {
        if (!ids.has(lbId)) newUP[lbId] = p
      }
      return { ...state, userPlacements: newUP }
    }
    case 'PIN_BY_CLASS': {
      const { classId } = action.payload
      const newUP = { ...state.userPlacements }
      for (const slot of (state.result?.slots || [])) {
        if (slot.class_id === classId) {
          const existing = newUP[slot.lesson_block_id] || []
          if (!existing.some((p) => p.day === slot.day && p.period === slot.period)) {
            newUP[slot.lesson_block_id] = [...existing, { day: slot.day, period: slot.period }]
          }
        }
      }
      return { ...state, userPlacements: newUP }
    }
    case 'UNPIN_BY_CLASS': {
      const { classId, lessonBlocks } = action.payload
      const ids = new Set(
        (lessonBlocks || []).filter((lb) => lb.class_id === classId).map((lb) => lb.id),
      )
      const newUP = {}
      for (const [lbId, p] of Object.entries(state.userPlacements || {})) {
        if (!ids.has(lbId)) newUP[lbId] = p
      }
      return { ...state, userPlacements: newUP }
    }
    case 'PIN_ALL_SOLVER_SLOTS': {
      const newUP = { ...state.userPlacements }
      for (const slot of (state.result?.slots || [])) {
        const existing = newUP[slot.lesson_block_id] || []
        if (!existing.some((p) => p.day === slot.day && p.period === slot.period)) {
          newUP[slot.lesson_block_id] = [...existing, { day: slot.day, period: slot.period }]
        }
      }
      return { ...state, userPlacements: newUP }
    }
    case 'CLEAR_BY_CLASS': {
      const { classId, lessonBlocks } = action.payload
      const ids = new Set(
        (lessonBlocks || []).filter((lb) => lb.class_id === classId).map((lb) => lb.id),
      )
      const newUP = {}
      for (const [lbId, p] of Object.entries(state.userPlacements || {})) {
        if (!ids.has(lbId)) newUP[lbId] = p
      }
      const newSlots = state.result?.slots
        ? state.result.slots.filter((s) => s.class_id !== classId)
        : []
      return {
        ...state,
        userPlacements: newUP,
        result: state.result ? { ...state.result, slots: newSlots } : null,
      }
    }
    case 'CLEAR_SOLVER_ONLY': {
      // Keep only solver slots whose lesson_block_id is in userPlacements (pinned)
      const pinnedIds = new Set(Object.keys(state.userPlacements || {}))
      const newSlots = state.result?.slots
        ? state.result.slots.filter((s) => pinnedIds.has(s.lesson_block_id))
        : []
      return {
        ...state,
        result: state.result ? { ...state.result, slots: newSlots } : null,
      }
    }
    case 'RESTORE_FROM_CACHE': {
      // Restore the full workspace atomically (result + manual placements +
      // substitutes + daily schedules) in ONE dispatch — like LOAD_SNAPSHOT.
      // Restoring placements via the localStorage effect instead would race:
      // the persist effect runs first, sees empty userPlacements and wipes
      // the saved key before the restore effect reads it.
      const validLbIds = new Set(
        (action.payload.fixtureData?.lesson_blocks || []).map((lb) => lb.id),
      )
      const filteredPlacements = {}
      for (const [lbId, placements] of Object.entries(action.payload.userPlacements || {})) {
        if (validLbIds.has(lbId)) filteredPlacements[lbId] = placements
      }
      return {
        ...state,
        result: action.payload.result,
        fixtureData: action.payload.fixtureData,
        userPlacements: filteredPlacements,
        substitutes: Array.isArray(action.payload.substitutes) ? action.payload.substitutes : [],
        dailySchedules: (action.payload.dailySchedules && typeof action.payload.dailySchedules === 'object') ? action.payload.dailySchedules : {},
        selectedFixture: action.payload.selectedFixture,
        cacheKey: action.payload.cacheKey,
        lastSync: action.payload.lastSync,
        isLoadingFixture: false,
        isDirty: false,
        activeStep: 5,
      }
    }
    case 'SET_CACHE_HINT':
      return { ...state, cacheHint: action.payload }
    // ── Snapshot versioning ──────────────────────────────────────────
    case 'SET_SNAPSHOTS':
      return { ...state, snapshots: action.payload }
    case 'LOAD_SNAPSHOT':
      return {
        ...state,
        fixtureData: action.payload.fixtureData
          ? { ...action.payload.fixtureData, special_rooms: action.payload.fixtureData.special_rooms || [] }
          : null,
        result: action.payload.result,
        userPlacements: action.payload.userPlacements || {},
        substitutes: action.payload.substitutes || [],
        selectedFixture: action.payload.fixtureName || 'custom',
        solverPreset: action.payload.solverPreset || state.solverPreset,
        solverCustomTime: action.payload.solverCustomTime ?? state.solverCustomTime,
        solverCustomMode: action.payload.solverCustomMode || state.solverCustomMode,
        activeSnapshotId: action.payload.id,
        activeSnapshotLabel: action.payload.label,
        isSnapshotDirty: false,
        isDirty: false,
        lastSnapshotSaveAt: action.payload.updatedAt || Date.now(),
        error: null,
        errorResponse: null,
        cacheHint: null,
        cacheKey: `timetable_${action.payload.fixtureName || 'custom'}`,
        activeStep: 5,
      }
    case 'SET_ACTIVE_SNAPSHOT':
      return {
        ...state,
        activeSnapshotId: action.payload.id,
        activeSnapshotLabel: action.payload.label,
        isSnapshotDirty: false,
        lastSnapshotSaveAt: Date.now(),
      }
    case 'MARK_SNAPSHOT_DIRTY':
      return { ...state, isSnapshotDirty: true }
    case 'MARK_SNAPSHOT_SAVED':
      return { ...state, isSnapshotDirty: false, lastSnapshotSaveAt: Date.now() }
    case 'ADD_SNAPSHOT_TO_LIST': {
      const exists = state.snapshots.some((s) => s.id === action.payload.id)
      const next = exists
        ? state.snapshots.map((s) => (s.id === action.payload.id ? action.payload : s))
        : [action.payload, ...state.snapshots]
      return { ...state, snapshots: next }
    }
    case 'REMOVE_SNAPSHOT_FROM_LIST':
      return {
        ...state,
        snapshots: state.snapshots.filter((s) => s.id !== action.payload),
        activeSnapshotId: state.activeSnapshotId === action.payload ? null : state.activeSnapshotId,
        activeSnapshotLabel: state.activeSnapshotId === action.payload ? null : state.activeSnapshotLabel,
      }
    // ── Auth ─────────────────────────────────────────────────────────
    case 'SET_USER':
      return { ...state, user: action.payload, authToken: action.payload ? state.authToken : null }
    case 'SET_AUTH_TOKEN':
      return { ...state, authToken: action.payload }
    case 'LOGOUT':
      return { ...state, user: null, authToken: null, cloudWorkspaces: [], activeCloudWorkspaceId: null }
    // ── Cloud workspaces ─────────────────────────────────────────────
    case 'SET_CLOUD_WORKSPACES':
      return { ...state, cloudWorkspaces: action.payload }
    case 'SET_CLOUD_SYNCING':
      return { ...state, cloudSyncing: action.payload }
    case 'LOAD_CLOUD_WORKSPACE': {
      const ws = action.payload
      return {
        ...state,
        fixtureData: ws.fixtureData || null,
        result: ws.result || null,
        userPlacements: ws.userPlacements || {},
        substitutes: ws.substitutes || [],
        solverPreset: ws.solverPreset || 'balanced',
        solverCustomTime: ws.solverCustomTime ?? 60,
        solverCustomMode: ws.solverCustomMode || 'BALANCED',
        activeCloudWorkspaceId: action.payload._cloudId || null,
        // Reset local snapshot tracking — cloud workspace is separate
        activeSnapshotId: null,
        activeSnapshotLabel: null,
        isSnapshotDirty: false,
        isDirty: false,
        error: null,
        errorResponse: null,
        cacheHint: null,
        // Cloud workspaces don't carry a fixture name — track under the
        // current fixture's cache key only when there IS a result, so the
        // result-cache effect keeps "ทำงานต่อ" in sync without clobbering a
        // solved local cache when loading a data-only workspace.
        ...(ws.result ? { cacheKey: `timetable_${state.selectedFixture || 'custom'}` } : {}),
        // Jump to step 5 if we have a result, else step 1
        activeStep: ws.result ? 5 : 1,
      }
    }
    case 'CLEAR_CLOUD_WORKSPACE':
      return { ...state, activeCloudWorkspaceId: null }
    // ── Slot-level editing ───────────────────────────────────────────
    case 'MOVE_SLOT': {
      // payload: { lessonBlockId, day, period, newDay, newPeriod } — moves
      // ONLY the slot at the source (day, period). Double-period blocks emit
      // one slot per period (p, p+1), so moving one period must not drag the
      // block's other slots along (the old code mapped every slot of the
      // lesson_block_id to the new position, stacking duplicates in one cell
      // and leaving the source cell empty).
      const { lessonBlockId, day, period, newDay, newPeriod } = action.payload
      if (!state.result?.slots) return state
      let moved = false
      const newSlots = state.result.slots.map((s) => {
        if (moved) return s
        if (s.lesson_block_id !== lessonBlockId) return s
        // Exact source match (day/period both provided)
        if (day != null && period != null && !(s.day === day && s.period === period)) return s
        moved = true
        return { ...s, day: newDay, period: newPeriod }
      })
      if (!moved && state.result.slots.some((s) => s.lesson_block_id === lessonBlockId)) {
        // Backward-compat fallback: caller didn't specify the source position —
        // move the first slot of the block.
        let done = false
        return {
          ...state,
          result: {
            ...state.result,
            slots: state.result.slots.map((s) => {
              if (done || s.lesson_block_id !== lessonBlockId) return s
              done = true
              return { ...s, day: newDay, period: newPeriod }
            }),
          },
          isDirty: true,
          isSnapshotDirty: true,
        }
      }
      return {
        ...state,
        result: { ...state.result, slots: newSlots },
        isDirty: true,
        isSnapshotDirty: true,
      }
    }
    case 'DELETE_SLOT': {
      // payload: { lessonBlockId, day, period } — removes the specific
      // slot at (day, period). If day/period are omitted, removes all
      // slots for this lesson block (kept for backward compatibility).
      if (!state.result?.slots) return state
      const { lessonBlockId, day, period } = action.payload
      const newSlots = state.result.slots.filter((s) => {
        if (s.lesson_block_id !== lessonBlockId) return true
        if (day != null && period != null) {
          // Remove only the specific slot at this day/period
          return !(s.day === day && s.period === period)
        }
        // Legacy: remove all slots for this block
        return false
      })
      return {
        ...state,
        result: { ...state.result, slots: newSlots },
        isDirty: true,
        isSnapshotDirty: true,
      }
    }
    case 'LOCK_SLOT': {
      // payload: { day, period, name, classId } — add to fixed_slots
      // classId present → lock only that class; absent → lock for all classes
      if (!state.fixtureData) return state
      const existing = state.fixtureData.fixed_slots || []
      const class_ids = action.payload.classId ? [action.payload.classId] : []
      const exists = existing.some((fs) =>
        fs.day === action.payload.day &&
        fs.period === action.payload.period &&
        (class_ids.length === 0
          ? (!fs.class_ids || fs.class_ids.length === 0)
          : (fs.class_ids || []).some((c) => class_ids.includes(c)))
      )
      if (exists) return state
      const newFixed = [...existing, {
        day: action.payload.day,
        period: action.payload.period,
        name: action.payload.name || 'ล็อกคาบ',
        ...(class_ids.length > 0 ? { class_ids } : {}),
      }]
      return {
        ...state,
        fixtureData: { ...state.fixtureData, fixed_slots: newFixed },
        isDirty: true,
        isSnapshotDirty: true,
      }
    }
    case 'UNLOCK_SLOT': {
      // payload: { day, period, classId } — remove matching fixed_slots
      // classId present → remove only the lock for that class; absent → all-class locks
      if (!state.fixtureData?.fixed_slots) return state
      const class_ids = action.payload.classId ? [action.payload.classId] : []
      const newFixed = state.fixtureData.fixed_slots.filter(
        (fs) => !(fs.day === action.payload.day && fs.period === action.payload.period &&
          (class_ids.length === 0
            ? (!fs.class_ids || fs.class_ids.length === 0)
            : (fs.class_ids || []).some((c) => class_ids.includes(c))))
      )
      return {
        ...state,
        fixtureData: { ...state.fixtureData, fixed_slots: newFixed },
        isDirty: true,
        isSnapshotDirty: true,
      }
    }
    // ── Special rooms (facilities) management ──────────────────────
    case 'ADD_SPECIAL_ROOM': {
      // payload: { id, name, room_type }
      if (!state.fixtureData) return state
      const newRoom = action.payload
      const existingSpecial = state.fixtureData.special_rooms || []
      // Dedupe by name (case-insensitive)
      if (existingSpecial.some((r) => r.name.toLowerCase() === newRoom.name.toLowerCase())) {
        return state
      }
      const existingRooms = state.fixtureData.rooms || []
      return {
        ...state,
        fixtureData: {
          ...state.fixtureData,
          special_rooms: [...existingSpecial, newRoom],
          rooms: [...existingRooms, newRoom],
        },
        isDirty: true,
        isSnapshotDirty: true,
      }
    }
    case 'UPDATE_SPECIAL_ROOM': {
      // payload: { id, name, room_type }
      if (!state.fixtureData?.special_rooms) return state
      const { id, name, room_type } = action.payload
      const updateFn = (r) => (r.id === id ? { ...r, name: name ?? r.name, room_type: room_type ?? r.room_type } : r)
      return {
        ...state,
        fixtureData: {
          ...state.fixtureData,
          special_rooms: state.fixtureData.special_rooms.map(updateFn),
          rooms: (state.fixtureData.rooms || []).map(updateFn),
        },
        isDirty: true,
        isSnapshotDirty: true,
      }
    }
    case 'DELETE_SPECIAL_ROOM': {
      // payload: { id } — remove from special_rooms + rooms, clear lesson_block room_id
      if (!state.fixtureData?.special_rooms) return state
      const { id } = action.payload
      const lessonBlocks = (state.fixtureData.lesson_blocks || []).map((lb) =>
        lb.room_id === id ? { ...lb, room_id: `R_${lb.class_id}` } : lb,
      )
      return {
        ...state,
        fixtureData: {
          ...state.fixtureData,
          special_rooms: state.fixtureData.special_rooms.filter((r) => r.id !== id),
          rooms: (state.fixtureData.rooms || []).filter((r) => r.id !== id),
          lesson_blocks: lessonBlocks,
        },
        isDirty: true,
        isSnapshotDirty: true,
      }
    }
    case 'SET_LESSON_BLOCK_ROOM': {
      // payload: { lessonBlockId, roomId } — set room_id on a single lesson block
      if (!state.fixtureData?.lesson_blocks) return state
      const { lessonBlockId, roomId } = action.payload
      const lessonBlocks = state.fixtureData.lesson_blocks.map((lb) =>
        lb.id === lessonBlockId ? { ...lb, room_id: roomId } : lb,
      )
      return {
        ...state,
        fixtureData: { ...state.fixtureData, lesson_blocks: lessonBlocks },
        isDirty: true,
        isSnapshotDirty: true,
      }
    }
    case 'CHANGE_SLOT_ROOM': {
      // payload: { lessonBlockId, newRoomId } — update room_id on lesson block AND result slots
      if (!state.fixtureData) return state
      const { lessonBlockId, newRoomId } = action.payload
      const lessonBlocks = (state.fixtureData.lesson_blocks || []).map((lb) =>
        lb.id === lessonBlockId ? { ...lb, room_id: newRoomId } : lb,
      )
      let newResult = state.result
      if (state.result?.slots) {
        const newSlots = state.result.slots.map((s) =>
          s.lesson_block_id === lessonBlockId ? { ...s, room_id: newRoomId } : s,
        )
        newResult = { ...state.result, slots: newSlots }
      }
      return {
        ...state,
        fixtureData: { ...state.fixtureData, lesson_blocks: lessonBlocks },
        result: newResult,
        isDirty: true,
        isSnapshotDirty: true,
      }
    }
    case 'SPLIT_LESSON_BLOCKS_FOR_LAB': {
      // payload: { classIds: string[], subjectId: string, labPeriods: number, labRoomId: string }
      // For each class_id + subject_id:
      //   - Find original lesson block (room_id starts with R_)
      //   - If labPeriods > 0: create new lab block + reduce original
      //   - If labPeriods === 0: merge lab block back into original (un-split)
      if (!state.fixtureData?.lesson_blocks) return state
      const { classIds, subjectId, labPeriods, labRoomId } = action.payload
      const classIdSet = new Set(classIds)
      let lessonBlocks = [...state.fixtureData.lesson_blocks]
      let nextIdNum = lessonBlocks.length + 1

      for (const classId of classIdSet) {
        // Find the normal (classroom) block for this class+subject
        const normalIdx = lessonBlocks.findIndex(
          (lb) => lb.class_id === classId && lb.subject_id === subjectId && lb.room_id && lb.room_id.startsWith('R_'),
        )
        // Find existing lab block for this class+subject
        const labIdx = lessonBlocks.findIndex(
          (lb) => lb.class_id === classId && lb.subject_id === subjectId && lb.room_id && !lb.room_id.startsWith('R_'),
        )

        if (normalIdx === -1) continue // no normal block to split

        const normalBlock = lessonBlocks[normalIdx]
        const totalPeriods = normalBlock.periods_per_week + (labIdx !== -1 ? lessonBlocks[labIdx].periods_per_week : 0)

        if (labPeriods > 0 && labPeriods < totalPeriods) {
          // Split: normal = total - lab, lab = labPeriods
          const newNormalPeriods = totalPeriods - labPeriods
          lessonBlocks[normalIdx] = { ...normalBlock, periods_per_week: newNormalPeriods }

          if (labIdx !== -1) {
            // Update existing lab block
            lessonBlocks[labIdx] = {
              ...lessonBlocks[labIdx],
              periods_per_week: labPeriods,
              room_id: labRoomId,
            }
          } else {
            // Create new lab block
            lessonBlocks.push({
              id: `LB${nextIdNum++}`,
              subject_id: subjectId,
              teacher_id: normalBlock.teacher_id,
              class_id: classId,
              room_id: labRoomId,
              periods_per_week: labPeriods,
              is_double_period: normalBlock.is_double_period,
              is_fixed: false,
              fixed_day: null,
              fixed_period: null,
            })
          }
        } else if (labPeriods === 0) {
          // Un-split: merge lab back into normal, remove lab block
          if (labIdx !== -1) {
            const labPeriodsToMerge = lessonBlocks[labIdx].periods_per_week
            lessonBlocks[normalIdx] = {
              ...normalBlock,
              periods_per_week: normalBlock.periods_per_week + labPeriodsToMerge,
            }
            lessonBlocks = lessonBlocks.filter((_, i) => i !== labIdx)
          }
        }
      }

      return {
        ...state,
        fixtureData: { ...state.fixtureData, lesson_blocks: lessonBlocks },
        isDirty: true,
        isSnapshotDirty: true,
      }
    }
    default:
      return state
  }
}

const FIXTURE_PATHS = {
  small: 'E:\\project\\time table\\backend\\fixtures\\school_small.json',
  medium: 'E:\\project\\time table\\backend\\fixtures\\school_medium.json',
  large: 'E:\\project\\time table\\backend\\fixtures\\school_large.json',
  primary_mock: 'E:\\project\\time table\\backend\\fixtures\\school_primary_mock.json',
}

export function AppProvider({ children }) {
  const [state, dispatch] = useReducer(reducer, initialState)

  const selectFixture = useCallback((size) => {
    dispatch({ type: 'SET_FIXTURE', payload: size })
    dispatch({ type: 'SET_LOADING_FIXTURE', payload: true })
    fetch(`/fixtures/school_${size}.json`)
      .then((r) => {
        if (!r.ok) throw new Error('Fixture not found')
        return r.json()
      })
      .then((data) => dispatch({ type: 'SET_FIXTURE_DATA', payload: data }))
      .catch(() => {
        dispatch({ type: 'SET_FIXTURE_DATA', payload: null })
        dispatch({ type: 'SET_LOADING_FIXTURE', payload: false })
      })
  }, [])

  // Note: No auto-load fixture on mount — new flow starts from landing page

  // Read lightweight cache meta on mount (page refresh) and store a hint so
  // the landing page can offer a "ทำงานต่อ" card. We deliberately do NOT
  // auto-jump the user to step 5 — they choose whether to resume.
  // Guard: if the user starts a new session (create new / upload file) before
  // the async meta read completes, skip it to avoid stale hints.
  const skipCacheRestoreRef = useRef(false)
  useEffect(() => {
    const CACHE_KEYS = ['timetable_custom', 'timetable_primary_mock', 'timetable_large', 'timetable_medium', 'timetable_small']
    let best = null
    ;(async () => {
      for (const key of CACHE_KEYS) {
        try {
          // Abort if user already started a new session while we were reading cache
          if (skipCacheRestoreRef.current) break
          const meta = await getCachedMeta(key)
          if (meta?.lastSync && (!best || meta.lastSync > best.lastCachedAt)) {
            best = { cacheKey: key, lastCachedAt: meta.lastSync }
          }
        } catch (e) {
          // Cache read failed — best-effort, continue to next cache key
          console.warn('[AppContext] Cache meta read failed:', e.message)
        }
      }
      if (best && !skipCacheRestoreRef.current) {
        dispatch({ type: 'SET_CACHE_HINT', payload: best })
      }
    })()
  }, [])

  const runSolver = useCallback(async (options = {}) => {
    const { preAssignments = null } = options
    // Resolve time limit + optimization mode from the selected preset
    const { timeLimitSeconds, optimizationMode } = resolveSolverParams(
      state.solverPreset,
      state.solverCustomTime,
      state.solverCustomMode,
    )
    // Keep optimizationMode in sync for any legacy consumers
    if (state.optimizationMode !== optimizationMode) {
      dispatch({ type: 'SET_OPTIMIZATION_MODE', payload: optimizationMode })
    }
    dispatch({ type: 'SET_GENERATING', payload: true })
    try {
      // Resolve fixture data: use state if available, otherwise fetch from static fixtures.
      // Use a local variable so we don't depend on stale closure state after dispatch.
      let currentFixtureData = state.fixtureData
      if (!currentFixtureData) {
        currentFixtureData = await fetch(`/fixtures/school_${state.selectedFixture}.json`).then((r) => r.json())
        dispatch({ type: 'SET_FIXTURE_DATA', payload: currentFixtureData })
      }

      // Always use generateTimetable (POST /generate) so that the preset's
      // time limit and optimization mode are sent to the backend.
      // The legacy generateFromFile path ignored these parameters.
      let payload = {
        ...currentFixtureData,
        optimization_mode: optimizationMode,
        solver_time_limit_seconds: timeLimitSeconds,
      }
      if (preAssignments && Object.keys(preAssignments).length > 0) {
        payload = {
          ...payload,
          lesson_blocks: payload.lesson_blocks.map((lb) => {
            const placements = preAssignments[lb.id]
            if (!placements || placements.length === 0) return lb
            return {
              ...lb,
              is_fixed: true,
              fixed_slots: placements.map((p) => ({ day: p.day, period: p.period })),
            }
          }),
        }
      }
      const result = await generateTimetable(payload)
      dispatch({ type: 'SET_RESULT', payload: result })
      const cacheKey = `timetable_${state.selectedFixture}`
      try {
        // Cache the full workspace (result + manual placements + substitutes +
        // daily schedules) so resumeFromCache can restore everything atomically
        // — the same way LOAD_SNAPSHOT does — instead of relying on the
        // localStorage restore effect (which races with the persist effect).
        await cacheTimetable(cacheKey, {
          result,
          fixtureData: currentFixtureData,
          userPlacements: preAssignments || state.userPlacements,
          substitutes: state.substitutes,
          dailySchedules: state.dailySchedules,
          version: 1,
        })
        dispatch({ type: 'SET_CACHE_INFO', payload: { cacheKey, lastSync: Date.now() } })
        // Keep the landing page "ทำงานต่อ" card fresh without needing a refresh
        dispatch({ type: 'SET_CACHE_HINT', payload: { cacheKey, lastCachedAt: Date.now() } })
      } catch (e) {
        // Caching is best-effort — don't block the result on cache failure
        console.warn('[AppContext] Cache write failed:', e.message)
      }
    } catch (err) {
      // Log the error so it's visible in dev tools (prevents silent cache fallback
      // from hiding real backend errors like validation failures).
      console.error('[runSolver] Backend error:', err.message, err.payload || '')
      const cacheKey = `timetable_${state.selectedFixture}`
      try {
        const cached = await getCachedTimetable(cacheKey)
        if (cached?.result) {
          dispatch({ type: 'SET_RESULT', payload: cached.result })
          if (cached.fixtureData && !state.fixtureData) {
            dispatch({ type: 'SET_FIXTURE_DATA', payload: cached.fixtureData })
          }
          dispatch({ type: 'SET_CACHE_INFO', payload: { cacheKey, lastSync: cached._cachedAt } })
        } else {
          // err.payload holds the full TimetableResponse (with diagnostics)
          // when the backend returned 422 INFEASIBLE.
          dispatch({
            type: 'SET_ERROR',
            payload: { message: err.message, response: err.payload || null },
          })
        }
      } catch (e) {
        dispatch({
          type: 'SET_ERROR',
          payload: { message: err.message, response: err.payload || null },
        })
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.selectedFixture, state.fixtureData, state.solverPreset])

  // Resume the most recently cached workspace from IndexedDB (landing page
  // "ทำงานต่อ" card). Loads the full payload and jumps to step 5.
  const resumeFromCache = useCallback(async (cacheKey) => {
    if (!cacheKey) return { ok: false, error: 'ไม่มีข้อมูลงานเก่า' }
    try {
      const cached = await getCachedTimetable(cacheKey)
      if (!cached?.result || !cached?.fixtureData) {
        return { ok: false, error: 'ไม่พบข้อมูลงานเก่าในเครื่องนี้' }
      }
      skipCacheRestoreRef.current = true
      const fixtureName = cacheKey.replace('timetable_', '')
      // localStorage is written synchronously on every change, so it is always
      // at least as fresh as the debounced IndexedDB cache — prefer it when
      // present, fall back to the cache payload otherwise.
      const readLocal = (key, fallback) => {
        try {
          const raw = localStorage.getItem(key)
          return raw !== null ? JSON.parse(raw) : fallback
        } catch (e) {
          return fallback
        }
      }
      dispatch({
        type: 'RESTORE_FROM_CACHE',
        payload: {
          result: cached.result,
          fixtureData: cached.fixtureData,
          userPlacements: readLocal(`placements_${fixtureName}`, cached.userPlacements || {}),
          substitutes: readLocal(`substitutes_${fixtureName}`, cached.substitutes || []),
          dailySchedules: readLocal(`daily_schedules_${fixtureName}`, cached.dailySchedules || {}),
          selectedFixture: fixtureName,
          cacheKey,
          lastSync: cached._cachedAt,
        },
      })
      return { ok: true }
    } catch (e) {
      console.warn('[AppContext] resumeFromCache failed:', e.message)
      return { ok: false, error: 'อ่านข้อมูลจากเครื่องไม่สำเร็จ' }
    }
  }, [])

  // ── Auto-resume last workspace on load ───────────────────────────────
  // After a refresh/reopen, if a recent cached workspace exists, jump
  // straight into the timetable step (step 5) instead of parking on the
  // landing page. Runs ONCE per session (autoResumedRef); skipCacheRestoreRef
  // guards the "user started a new session (upload/import)" path.
  const autoResumedRef = useRef(false)
  useEffect(() => {
    if (!state.cacheHint || autoResumedRef.current) return
    if (state.activeStep !== 0 || state.fixtureData) return
    autoResumedRef.current = true
    resumeFromCache(state.cacheHint.cacheKey).then((r) => {
      if (!r.ok) autoResumedRef.current = false
    })
  }, [state.cacheHint, state.activeStep, state.fixtureData, resumeFromCache])

  const setStep = useCallback((step) => {
    dispatch({ type: 'SET_STEP', payload: step })
  }, [])

  const setGridFilter = useCallback((filter) => {
    dispatch({ type: 'SET_GRID_FILTER', payload: filter })
  }, [])

  const setOptimizationMode = useCallback((mode) => {
    dispatch({ type: 'SET_OPTIMIZATION_MODE', payload: mode })
  }, [])

  const setSolverPreset = useCallback((preset) => {
    dispatch({ type: 'SET_SOLVER_PRESET', payload: preset })
  }, [])

  const setSolverCustomTime = useCallback((seconds) => {
    dispatch({ type: 'SET_SOLVER_CUSTOM_TIME', payload: seconds })
  }, [])

  const setSolverCustomMode = useCallback((mode) => {
    dispatch({ type: 'SET_SOLVER_CUSTOM_MODE', payload: mode })
  }, [])

  const setFixtureDataDirect = useCallback((data) => {
    // ล้าง cache เก่าใน IndexedDB ก่อนตั้งค่าใหม่ เพื่อไม่ให้ cache restore
    // useEffect โหลดตารางเก่ากลับมาทับข้อมูลใหม่ที่เพิ่งอัปโหลด
    skipCacheRestoreRef.current = true
    clearCache().catch((e) => console.warn('[AppContext] Cache clear failed:', e.message))
    // ล้าง localStorage placements_* ทุก key เพื่อกัน RESTORE_PLACEMENTS
    // useEffect ดึง placement เก่ากลับมาทับข้อมูลใหม่หลังอัปโหลด Excel ใหม่
    try {
      const keysToRemove = []
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i)
        if (key && key.startsWith('placements_')) keysToRemove.push(key)
      }
      keysToRemove.forEach((key) => localStorage.removeItem(key))
    } catch (e) {
      console.warn('[AppContext] localStorage placements clear failed:', e.message)
    }
    dispatch({ type: 'SET_FIXTURE_DATA_DIRECT', payload: data })
  }, [])

  const updateFixtureData = useCallback((partial) => {
    dispatch({ type: 'UPDATE_FIXTURE_DATA', payload: partial })
  }, [])

  // Set isDirty flag directly (used to suppress the "regenerate" banner when
  // a change does not affect existing placements, e.g. inserting a short break).
  const setIsDirty = useCallback((value) => {
    dispatch({ type: 'SET_DIRTY', payload: value })
  }, [])

  const clearResult = useCallback(() => {
    dispatch({ type: 'CLEAR_RESULT' })
  }, [])

  const placeLessonBlock = useCallback((lessonBlockId, day, period) => {
    dispatch({ type: 'PLACE_LESSON_BLOCK', payload: { lessonBlockId, day, period } })
  }, [])

  const removePlacement = useCallback((lessonBlockId, day, period) => {
    dispatch({ type: 'REMOVE_PLACEMENT', payload: { lessonBlockId, day, period } })
  }, [])

  const clearPlacements = useCallback(() => {
    dispatch({ type: 'CLEAR_PLACEMENTS' })
  }, [])

  const clearAllSlots = useCallback(() => {
    dispatch({ type: 'CLEAR_ALL_SLOTS' })
  }, [])

  const clearByTeacher = useCallback((teacherId) => {
    dispatch({
      type: 'CLEAR_BY_TEACHER',
      payload: { teacherId, lessonBlocks: state.fixtureData?.lesson_blocks || [] },
    })
  }, [state.fixtureData])

  // ── Batch pin/unpin actions ─────────────────────────────────────────
  const pinByTeacher = useCallback((teacherId) => {
    dispatch({ type: 'PIN_BY_TEACHER', payload: { teacherId } })
  }, [])

  const unpinByTeacher = useCallback((teacherId) => {
    dispatch({
      type: 'UNPIN_BY_TEACHER',
      payload: { teacherId, lessonBlocks: state.fixtureData?.lesson_blocks || [] },
    })
  }, [state.fixtureData])

  const pinByClass = useCallback((classId) => {
    dispatch({ type: 'PIN_BY_CLASS', payload: { classId } })
  }, [])

  const unpinByClass = useCallback((classId) => {
    dispatch({
      type: 'UNPIN_BY_CLASS',
      payload: { classId, lessonBlocks: state.fixtureData?.lesson_blocks || [] },
    })
  }, [state.fixtureData])

  const pinAllSolverSlots = useCallback(() => {
    dispatch({ type: 'PIN_ALL_SOLVER_SLOTS' })
  }, [])

  const unpinAll = useCallback(() => {
    dispatch({ type: 'CLEAR_PLACEMENTS' })
  }, [])

  const clearByClass = useCallback((classId) => {
    dispatch({
      type: 'CLEAR_BY_CLASS',
      payload: { classId, lessonBlocks: state.fixtureData?.lesson_blocks || [] },
    })
  }, [state.fixtureData])

  const clearSolverOnly = useCallback(() => {
    dispatch({ type: 'CLEAR_SOLVER_ONLY' })
  }, [])

  // ── Slot-level editing actions ──────────────────────────────────────
  const moveSlot = useCallback((lessonBlockId, day, period, newDay, newPeriod) => {
    dispatch({
      type: 'MOVE_SLOT',
      payload: { lessonBlockId, day, period, newDay, newPeriod },
    })
  }, [])

  const deleteSlot = useCallback((lessonBlockId, day, period) => {
    dispatch({ type: 'DELETE_SLOT', payload: { lessonBlockId, day, period } })
  }, [])

  const lockSlot = useCallback((day, period, name, classId) => {
    dispatch({ type: 'LOCK_SLOT', payload: { day, period, name, classId } })
  }, [])

  const unlockSlot = useCallback((day, period, classId) => {
    dispatch({ type: 'UNLOCK_SLOT', payload: { day, period, classId } })
  }, [])

  // ── Substitute (สอนแทน) actions ──────────────────────────────────
  const setSubstitute = useCallback((data) => {
    dispatch({ type: 'SET_SUBSTITUTE', payload: data })
  }, [])
  const removeSubstitute = useCallback((id) => {
    dispatch({ type: 'REMOVE_SUBSTITUTE', payload: { id } })
  }, [])
  const clearSubstitutes = useCallback(() => {
    dispatch({ type: 'CLEAR_SUBSTITUTES' })
  }, [])

  // ── Daily substitute schedule (สอนแทนรายวัน) actions ────────────────
  const setDailySchedule = useCallback((schedule) => {
    dispatch({ type: 'SET_DAILY_SCHEDULE', payload: schedule })
  }, [])
  const removeDailySchedule = useCallback((date) => {
    dispatch({ type: 'REMOVE_DAILY_SCHEDULE', payload: { date } })
  }, [])

  // ── Special rooms (facilities) actions ──────────────────────────
  const addSpecialRoom = useCallback((room) => {
    dispatch({ type: 'ADD_SPECIAL_ROOM', payload: room })
  }, [])

  const updateSpecialRoom = useCallback((id, updates) => {
    dispatch({ type: 'UPDATE_SPECIAL_ROOM', payload: { id, ...updates } })
  }, [])

  const deleteSpecialRoom = useCallback((id) => {
    dispatch({ type: 'DELETE_SPECIAL_ROOM', payload: { id } })
  }, [])

  const setLessonBlockRoom = useCallback((lessonBlockId, roomId) => {
    dispatch({ type: 'SET_LESSON_BLOCK_ROOM', payload: { lessonBlockId, roomId } })
  }, [])

  const changeSlotRoom = useCallback((lessonBlockId, newRoomId) => {
    dispatch({ type: 'CHANGE_SLOT_ROOM', payload: { lessonBlockId, newRoomId } })
  }, [])

  const splitLessonBlocksForLab = useCallback((classIds, subjectId, labPeriods, labRoomId) => {
    dispatch({ type: 'SPLIT_LESSON_BLOCKS_FOR_LAB', payload: { classIds, subjectId, labPeriods, labRoomId } })
  }, [])

  // ── Snapshot versioning actions ─────────────────────────────────────
  // Load snapshot list on mount
  useEffect(() => {
    const snaps = listSnapshots()
    dispatch({ type: 'SET_SNAPSHOTS', payload: snaps })
  }, [])

  const doSaveSnapshot = useCallback((label, opts = {}) => {
    const snap = buildSnapshot({
      label: label || generateLabel(state.snapshots.length),
      status: opts.status || 'draft',
      fixtureName: state.selectedFixture,
      fixtureData: state.fixtureData,
      result: state.result,
      userPlacements: state.userPlacements,
      substitutes: state.substitutes,
      solverPreset: state.solverPreset,
      solverCustomTime: state.solverCustomTime,
      solverCustomMode: state.solverCustomMode,
      description: opts.description || '',
    })
    // If we have an active snapshot, update it instead of creating new
    if (opts.updateExisting && state.activeSnapshotId) {
      snap.id = state.activeSnapshotId
      snap.createdAt = state.lastSnapshotSaveAt || Date.now()
    }
    const result = vmSaveSnapshot(snap)
    if (result.ok) {
      dispatch({ type: 'ADD_SNAPSHOT_TO_LIST', payload: listSnapshots().find((s) => s.id === snap.id) })
      dispatch({ type: 'SET_ACTIVE_SNAPSHOT', payload: { id: snap.id, label: snap.label } })
    }
    return result
  }, [state.selectedFixture, state.fixtureData, state.result, state.userPlacements, state.substitutes, state.solverPreset, state.solverCustomTime, state.solverCustomMode, state.snapshots.length, state.activeSnapshotId, state.lastSnapshotSaveAt])

  const doLoadSnapshot = useCallback((id) => {
    const snap = loadSnapshot(id)
    if (!snap) return { ok: false, error: 'ไม่พบ snapshot' }
    dispatch({ type: 'LOAD_SNAPSHOT', payload: snap })
    return { ok: true }
  }, [])

  const doDeleteSnapshot = useCallback((id) => {
    const ok = vmDeleteSnapshot(id)
    if (ok) dispatch({ type: 'REMOVE_SNAPSHOT_FROM_LIST', payload: id })
    return ok
  }, [])

  const doExportSnapshot = useCallback((id) => {
    const snap = id ? loadSnapshot(id) : buildSnapshot({
      label: state.activeSnapshotLabel || 'ตารางปัจจุบัน',
      fixtureName: state.selectedFixture,
      fixtureData: state.fixtureData,
      result: state.result,
      userPlacements: state.userPlacements,
      substitutes: state.substitutes,
      solverPreset: state.solverPreset,
      solverCustomTime: state.solverCustomTime,
      solverCustomMode: state.solverCustomMode,
    })
    if (!snap) return
    exportToFile(snap)
  }, [state.activeSnapshotLabel, state.selectedFixture, state.fixtureData, state.result, state.userPlacements, state.substitutes, state.solverPreset, state.solverCustomTime, state.solverCustomMode])

  const doImportSnapshot = useCallback(async (file) => {
    try {
      const snap = await importFromFile(file)
      const result = vmSaveSnapshot(snap)
      if (result.ok) {
        // ล้าง cache เก่าก่อนโหลด snapshot ใหม่ เพื่อไม่ให้ cache restore
        // useEffect โหลดตารางเก่ากลับมาทับ snapshot ที่เพิ่งโหลด
        skipCacheRestoreRef.current = true
        clearCache().catch((e) => console.warn('[AppContext] Cache clear failed:', e.message))
        // ล้าง localStorage placements_* เช่นกัน เพราะ snapshot มี userPlacements
        // ของตัวเอง และ RESTORE_PLACEMENTS useEffect อาจทับด้วยของเก่า
        try {
          const keysToRemove = []
          for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i)
            if (key && key.startsWith('placements_')) keysToRemove.push(key)
          }
          keysToRemove.forEach((key) => localStorage.removeItem(key))
        } catch (e) {
          console.warn('[AppContext] localStorage placements clear failed:', e.message)
        }
        dispatch({ type: 'ADD_SNAPSHOT_TO_LIST', payload: listSnapshots().find((s) => s.id === snap.id) })
        dispatch({ type: 'LOAD_SNAPSHOT', payload: snap })
        return { ok: true }
      }
      return result
    } catch (e) {
      return { ok: false, error: e.message }
    }
  }, [])

  // ── Auto-save (debounced) ───────────────────────────────────────────
  const autoSaveTimerRef = useRef(null)
  useEffect(() => {
    if (!state.isSnapshotDirty || !state.activeSnapshotId) return
    if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current)
    autoSaveTimerRef.current = setTimeout(() => {
      const snap = buildSnapshot({
        label: state.activeSnapshotLabel || 'ตารางฉบับร่าง',
        fixtureName: state.selectedFixture,
        fixtureData: state.fixtureData,
        result: state.result,
        userPlacements: state.userPlacements,
      substitutes: state.substitutes,
        solverPreset: state.solverPreset,
        solverCustomTime: state.solverCustomTime,
        solverCustomMode: state.solverCustomMode,
      })
      snap.id = state.activeSnapshotId
      snap.createdAt = state.lastSnapshotSaveAt || Date.now()
      const result = vmSaveSnapshot(snap)
      if (result.ok) {
        dispatch({ type: 'MARK_SNAPSHOT_SAVED' })
      }
    }, 2000)
    return () => {
      if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current)
    }
  }, [state.isSnapshotDirty, state.activeSnapshotId, state.activeSnapshotLabel, state.selectedFixture, state.fixtureData, state.result, state.userPlacements, state.substitutes, state.solverPreset, state.solverCustomTime, state.solverCustomMode, state.lastSnapshotSaveAt])

  // Persist userPlacements to localStorage
  useEffect(() => {
    if (state.fixtureData && state.selectedFixture) {
      const key = `placements_${state.selectedFixture}`
      try {
        // Write a sentinel ('{}') instead of removing the key so resume can
        // distinguish "user cleared placements" from "never saved" — without
        // it a missing key would fall back to stale cache data.
        localStorage.setItem(key, JSON.stringify(state.userPlacements || {}))
      } catch (e) {
        // localStorage quota exceeded or unavailable — best-effort
        console.warn('[AppContext] placements persist failed:', e.message)
      }
    }
  }, [state.userPlacements, state.selectedFixture, state.fixtureData])

  // Restore userPlacements when fixture loads
  useEffect(() => {
    if (state.fixtureData && state.selectedFixture) {
      const key = `placements_${state.selectedFixture}`
      try {
        const saved = localStorage.getItem(key)
        if (saved) {
          dispatch({ type: 'RESTORE_PLACEMENTS', payload: JSON.parse(saved) })
        }
      } catch (e) {
        console.warn('[AppContext] placements restore failed:', e.message)
      }
    }
  }, [state.fixtureData?.schedule_blocks, state.selectedFixture])

  // Persist substitutes (สอนแทน) to localStorage
  useEffect(() => {
    if (state.fixtureData && state.selectedFixture) {
      const key = `substitutes_${state.selectedFixture}`
      try {
        localStorage.setItem(key, JSON.stringify(state.substitutes || []))
      } catch (e) {
        console.warn('[AppContext] substitutes persist failed:', e.message)
      }
    }
  }, [state.substitutes, state.selectedFixture, state.fixtureData])

  // Restore substitutes when fixture loads
  useEffect(() => {
    if (state.fixtureData && state.selectedFixture) {
      const key = `substitutes_${state.selectedFixture}`
      try {
        const saved = localStorage.getItem(key)
        if (saved) {
          dispatch({ type: 'RESTORE_SUBSTITUTES', payload: JSON.parse(saved) })
        }
      } catch (e) {
        console.warn('[AppContext] substitutes restore failed:', e.message)
      }
    }
  }, [state.fixtureData?.schedule_blocks, state.selectedFixture])

  // ── Persist result edits (manual moves/deletes) to the offline cache ──
  // The IndexedDB cache is what auto-resume / "ทำงานต่อ" restores after a
  // reload. It used to be written ONLY inside runSolver, so manual slot edits
  // (MOVE_SLOT / DELETE_SLOT / clear actions / room changes) were lost on the
  // next session — the cache still held the original solver output. This
  // debounced effect writes the CURRENT workspace (result + manual placements
  // + substitutes + daily schedules) back to the cache whenever any of them
  // changes, and removes the cache entry when the result is cleared so the
  // resume path never resurrects a deleted timetable.
  const resultCacheTimerRef = useRef(null)
  useEffect(() => {
    if (!state.cacheKey) return
    if (resultCacheTimerRef.current) clearTimeout(resultCacheTimerRef.current)
    if (!state.result) {
      clearCache(state.cacheKey).catch((e) => {
        console.warn('[AppContext] result cache clear failed:', e.message)
      })
      return
    }
    const writeNow = () => {
      if (resultCacheTimerRef.current) {
        clearTimeout(resultCacheTimerRef.current)
        resultCacheTimerRef.current = null
      }
      cacheTimetable(state.cacheKey, {
        result: state.result,
        fixtureData: state.fixtureData,
        userPlacements: state.userPlacements,
        substitutes: state.substitutes,
        dailySchedules: state.dailySchedules,
        version: 1,
      })
        .then(() => {
          dispatch({ type: 'SET_CACHE_HINT', payload: { cacheKey: state.cacheKey, lastCachedAt: Date.now() } })
        })
        .catch((e) => {
          console.warn('[AppContext] result cache write failed:', e.message)
        })
    }
    // Flush the pending write if the page is closing/reloading — otherwise a
    // debounced write still waiting in the timer is dropped and the cache
    // keeps a stale workspace for the next session.
    const flushOnHide = () => writeNow()
    window.addEventListener('pagehide', flushOnHide)
    resultCacheTimerRef.current = setTimeout(writeNow, 400)
    return () => {
      if (resultCacheTimerRef.current) clearTimeout(resultCacheTimerRef.current)
      window.removeEventListener('pagehide', flushOnHide)
    }
  }, [state.result, state.cacheKey, state.fixtureData, state.userPlacements, state.substitutes, state.dailySchedules])

  // ── Daily schedules (สอนแทนรายวัน) persistence — localStorage ───────
  const dailyStorageKey = state.selectedFixture ? `daily_schedules_${state.selectedFixture}` : null

  useEffect(() => {
    if (!dailyStorageKey) return
    try {
      localStorage.setItem(dailyStorageKey, JSON.stringify(state.dailySchedules || {}))
    } catch (e) {
      console.warn('[AppContext] dailySchedules persist failed:', e.message)
    }
  }, [state.dailySchedules, dailyStorageKey])

  // Restore daily schedules when fixture loads
  useEffect(() => {
    if (state.fixtureData && state.selectedFixture) {
      const key = `daily_schedules_${state.selectedFixture}`
      try {
        const saved = localStorage.getItem(key)
        if (saved) {
          dispatch({ type: 'RESTORE_DAILY_SCHEDULES', payload: JSON.parse(saved) })
        }
      } catch (e) {
        console.warn('[AppContext] dailySchedules restore failed:', e.message)
      }
    }
  }, [state.fixtureData?.schedule_blocks, state.selectedFixture])

  // ── Auth actions (Google OAuth, optional) ───────────────────────────
  const doLogin = useCallback(async () => {
    try {
      await loginWithGoogle()
    } catch (e) {
      console.error('[AppContext] login failed:', e.message)
    }
  }, [])

  const doLogout = useCallback(() => {
    clearAuthToken()
    dispatch({ type: 'LOGOUT' })
  }, [])

  const doRefreshMe = useCallback(async () => {
    const token = getAuthToken()
    if (!token) return
    dispatch({ type: 'SET_AUTH_TOKEN', payload: token })
    try {
      const user = await fetchMe()
      dispatch({ type: 'SET_USER', payload: user })
    } catch {
      clearAuthToken()
      dispatch({ type: 'LOGOUT' })
    }
  }, [])

  // Restore auth on mount
  useEffect(() => {
    doRefreshMe()
  }, [doRefreshMe])

  // ── Cloud workspace actions ─────────────────────────────────────────
  const doListCloudWorkspaces = useCallback(async () => {
    try {
      const records = await fetchMySchedules()
      const workspaces = records
        .filter((r) => r.workspace)
        .map((r) => ({
          id: r.id,
          title: r.title,
          academic_year: r.academic_year,
          term: r.term,
          updated_at: r.updated_at,
          created_at: r.created_at,
        }))
      dispatch({ type: 'SET_CLOUD_WORKSPACES', payload: workspaces })
      return workspaces
    } catch (e) {
      console.error('[AppContext] listCloudWorkspaces failed:', e.message)
      return []
    }
  }, [])

  const doSaveToCloud = useCallback(async (label) => {
    dispatch({ type: 'SET_CLOUD_SYNCING', payload: true })
    try {
      const workspace = {
        fixtureData: state.fixtureData,
        result: state.result,
        userPlacements: state.userPlacements,
      substitutes: state.substitutes,
        solverPreset: state.solverPreset,
        solverCustomTime: state.solverCustomTime,
        solverCustomMode: state.solverCustomMode,
        optimizationMode: state.optimizationMode,
      }
      const result = await saveWorkspaceToCloud({
        id: state.activeCloudWorkspaceId || null,
        title: label || state.activeSnapshotLabel || 'ตารางของฉัน',
        academicYear: 2569,
        term: 1,
        workspace,
      })
      dispatch({ type: 'SET_CLOUD_SYNCING', payload: false })
      await doListCloudWorkspaces()
      return { ok: true, id: result.id, title: result.title }
    } catch (e) {
      dispatch({ type: 'SET_CLOUD_SYNCING', payload: false })
      return { ok: false, error: e.message }
    }
  }, [state.fixtureData, state.result, state.userPlacements, state.substitutes, state.solverPreset, state.optimizationMode, state.activeCloudWorkspaceId, state.activeSnapshotLabel, doListCloudWorkspaces])

  const doLoadFromCloud = useCallback(async (id) => {
    dispatch({ type: 'SET_CLOUD_SYNCING', payload: true })
    try {
      const record = await fetchCloudWorkspace(id)
      const ws = record.workspace || {}
      dispatch({
        type: 'LOAD_CLOUD_WORKSPACE',
        payload: { ...ws, _cloudId: id },
      })
      dispatch({ type: 'SET_CLOUD_SYNCING', payload: false })
      return { ok: true }
    } catch (e) {
      dispatch({ type: 'SET_CLOUD_SYNCING', payload: false })
      return { ok: false, error: e.message }
    }
  }, [])

  const doDeleteFromCloud = useCallback(async (id) => {
    try {
      await deleteCloudWorkspace(id)
      await doListCloudWorkspaces()
      return { ok: true }
    } catch (e) {
      return { ok: false, error: e.message }
    }
  }, [doListCloudWorkspaces])

  return (
    <AppContext.Provider
      value={{
        ...state,
        selectFixture,
        runSolver,
        resumeFromCache,
        setStep,
        setGridFilter,
        setOptimizationMode,
        setSolverPreset,
        setSolverCustomTime,
        setSolverCustomMode,
        clearResult,
        setFixtureDataDirect,
        updateFixtureData,
        setIsDirty,
        placeLessonBlock,
        removePlacement,
        clearPlacements,
        clearAllSlots,
        clearByTeacher,
        // Batch pin/unpin/clear actions
        pinByTeacher,
        unpinByTeacher,
        pinByClass,
        unpinByClass,
        pinAllSolverSlots,
        unpinAll,
        clearByClass,
        clearSolverOnly,
        // Slot-level editing
        moveSlot,
        deleteSlot,
        lockSlot,
        unlockSlot,
        // Substitute (สอนแทน)
        setSubstitute,
        removeSubstitute,
        clearSubstitutes,
        // Daily substitute schedule (สอนแทนรายวัน)
        dailySchedules: state.dailySchedules,
        setDailySchedule,
        removeDailySchedule,
        // Special rooms (facilities)
        addSpecialRoom,
        updateSpecialRoom,
        deleteSpecialRoom,
        setLessonBlockRoom,
        changeSlotRoom,
        splitLessonBlocksForLab,
        // Snapshot versioning
        saveSnapshot: doSaveSnapshot,
        loadSnapshot: doLoadSnapshot,
        deleteSnapshot: doDeleteSnapshot,
        exportSnapshot: doExportSnapshot,
        importSnapshot: doImportSnapshot,
        // Auth
        login: doLogin,
        logout: doLogout,
        refreshMe: doRefreshMe,
        // Cloud workspaces
        listCloudWorkspaces: doListCloudWorkspaces,
        saveToCloud: doSaveToCloud,
        loadFromCloud: doLoadFromCloud,
        deleteFromCloud: doDeleteFromCloud,
      }}
    >
      {children}
    </AppContext.Provider>
  )
}

export function useApp() {
  const ctx = useContext(AppContext)
  if (!ctx) throw new Error('useApp must be used within AppProvider')
  return ctx
}
