import { createContext, useContext, useReducer, useCallback, useEffect, useRef } from 'react'
import { generateTimetable } from '../api/client.js'
import { cacheTimetable, getCachedTimetable, clearCache } from '../utils/cache.js'
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
  optimizationMode: 'BALANCED',
  solverPreset: 'balanced',
  // userPlacements: { [lesson_block_id]: [{ day, period }] }
  // Tracks lesson blocks the user manually dragged onto the grid (📌 pre-assigned).
  userPlacements: {},
  // ── Snapshot versioning ──
  snapshots: [], // metadata list for dropdown
  activeSnapshotId: null, // currently loaded snapshot id
  activeSnapshotLabel: null, // display label
  isSnapshotDirty: false, // unsaved changes since last snapshot save
  lastSnapshotSaveAt: null, // timestamp for "saved X ago" display
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
        error: null,
        errorResponse: null,
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
        error: null,
        errorResponse: null,
        cacheKey: null,
        lastSync: null,
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
    case 'CLEAR_RESULT':
      return { ...state, result: null, error: null, errorResponse: null, cacheKey: null, lastSync: null }
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
      return {
        ...state,
        userPlacements: {},
        result: null,
        error: null,
        errorResponse: null,
        cacheKey: null,
        lastSync: null,
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
    case 'RESTORE_FROM_CACHE':
      return {
        ...state,
        result: action.payload.result,
        fixtureData: action.payload.fixtureData,
        selectedFixture: action.payload.selectedFixture,
        cacheKey: action.payload.cacheKey,
        lastSync: action.payload.lastSync,
        isLoadingFixture: false,
        isDirty: false,
        activeStep: 5,
      }
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
        selectedFixture: action.payload.fixtureName || 'custom',
        solverPreset: action.payload.solverPreset || state.solverPreset,
        activeSnapshotId: action.payload.id,
        activeSnapshotLabel: action.payload.label,
        isSnapshotDirty: false,
        isDirty: false,
        lastSnapshotSaveAt: action.payload.updatedAt || Date.now(),
        error: null,
        errorResponse: null,
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
    // ── Slot-level editing ───────────────────────────────────────────
    case 'MOVE_SLOT': {
      // payload: { lessonBlockId, newDay, newPeriod }
      const { lessonBlockId, newDay, newPeriod } = action.payload
      if (!state.result?.slots) return state
      const newSlots = state.result.slots.map((s) =>
        s.lesson_block_id === lessonBlockId
          ? { ...s, day: newDay, period: newPeriod }
          : s,
      )
      return {
        ...state,
        result: { ...state.result, slots: newSlots },
        isDirty: true,
        isSnapshotDirty: true,
      }
    }
    case 'DELETE_SLOT': {
      // payload: { lessonBlockId } — removes all slots for this lesson block
      if (!state.result?.slots) return state
      const newSlots = state.result.slots.filter(
        (s) => s.lesson_block_id !== action.payload.lessonBlockId,
      )
      return {
        ...state,
        result: { ...state.result, slots: newSlots },
        isDirty: true,
        isSnapshotDirty: true,
      }
    }
    case 'LOCK_SLOT': {
      // payload: { day, period, name } — add to fixed_slots
      if (!state.fixtureData) return state
      const existing = state.fixtureData.fixed_slots || []
      const exists = existing.some((fs) => fs.day === action.payload.day && fs.period === action.payload.period)
      if (exists) return state
      const newFixed = [...existing, { day: action.payload.day, period: action.payload.period, name: action.payload.name || 'ล็อกคาบ' }]
      return {
        ...state,
        fixtureData: { ...state.fixtureData, fixed_slots: newFixed },
        isDirty: true,
        isSnapshotDirty: true,
      }
    }
    case 'UNLOCK_SLOT': {
      // payload: { day, period } — remove from fixed_slots
      if (!state.fixtureData?.fixed_slots) return state
      const newFixed = state.fixtureData.fixed_slots.filter(
        (fs) => !(fs.day === action.payload.day && fs.period === action.payload.period),
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

  // Restore from cache on mount (page refresh)
  // Only restore if cached data has schedule_blocks (new format)
  // Guard: if the user starts a new session (create new / upload file) before
  // the async cache restore completes, skip the restore to avoid overriding
  // the new data with stale cache.
  const skipCacheRestoreRef = useRef(false)
  useEffect(() => {
    const CACHE_KEYS = ['timetable_custom', 'timetable_primary_mock', 'timetable_large', 'timetable_medium', 'timetable_small']
    let restored = false
    ;(async () => {
      for (const key of CACHE_KEYS) {
        try {
          const cached = await getCachedTimetable(key)
          // Abort if user already started a new session while we were reading cache
          if (skipCacheRestoreRef.current) {
            restored = true
            break
          }
          if (cached?.result && cached?.fixtureData && cached.fixtureData.schedule_blocks) {
            const fixtureName = key.replace('timetable_', '')
            dispatch({
              type: 'RESTORE_FROM_CACHE',
              payload: {
                result: cached.result,
                fixtureData: cached.fixtureData,
                selectedFixture: fixtureName,
                cacheKey: key,
                lastSync: cached._cachedAt,
              },
            })
            restored = true
            break
          }
        } catch (e) {
          // Cache read failed — best-effort, continue to next cache key
          console.warn('[AppContext] Cache restore failed for key:', e.message)
        }
      }
    })()
  }, [])

  const runSolver = useCallback(async (options = {}) => {
    const { preAssignments = null } = options
    // Resolve time limit + optimization mode from the selected preset
    const { timeLimitSeconds, optimizationMode } = resolveSolverParams(
      state.solverPreset,
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
        await cacheTimetable(cacheKey, { result, fixtureData: currentFixtureData, version: 1 })
        dispatch({ type: 'SET_CACHE_INFO', payload: { cacheKey, lastSync: Date.now() } })
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
  const moveSlot = useCallback((lessonBlockId, newDay, newPeriod) => {
    dispatch({ type: 'MOVE_SLOT', payload: { lessonBlockId, newDay, newPeriod } })
  }, [])

  const deleteSlot = useCallback((lessonBlockId) => {
    dispatch({ type: 'DELETE_SLOT', payload: { lessonBlockId } })
  }, [])

  const lockSlot = useCallback((day, period, name) => {
    dispatch({ type: 'LOCK_SLOT', payload: { day, period, name } })
  }, [])

  const unlockSlot = useCallback((day, period) => {
    dispatch({ type: 'UNLOCK_SLOT', payload: { day, period } })
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
      solverPreset: state.solverPreset,
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
  }, [state.selectedFixture, state.fixtureData, state.result, state.userPlacements, state.solverPreset, state.snapshots.length, state.activeSnapshotId, state.lastSnapshotSaveAt])

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
      solverPreset: state.solverPreset,
    })
    if (!snap) return
    exportToFile(snap)
  }, [state.activeSnapshotLabel, state.selectedFixture, state.fixtureData, state.result, state.userPlacements, state.solverPreset])

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
        solverPreset: state.solverPreset,
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
  }, [state.isSnapshotDirty, state.activeSnapshotId, state.activeSnapshotLabel, state.selectedFixture, state.fixtureData, state.result, state.userPlacements, state.solverPreset, state.lastSnapshotSaveAt])

  // Persist userPlacements to localStorage
  useEffect(() => {
    if (state.fixtureData && state.selectedFixture) {
      const key = `placements_${state.selectedFixture}`
      try {
        if (Object.keys(state.userPlacements).length > 0) {
          localStorage.setItem(key, JSON.stringify(state.userPlacements))
        } else {
          localStorage.removeItem(key)
        }
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

  return (
    <AppContext.Provider
      value={{
        ...state,
        selectFixture,
        runSolver,
        setStep,
        setGridFilter,
        setOptimizationMode,
        setSolverPreset,
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
