import { createContext, useContext, useReducer, useCallback, useEffect } from 'react'
import { generateFromFile, generateTimetable } from '../api/client.js'
import { cacheTimetable, getCachedTimetable } from '../utils/cache.js'

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
  // userPlacements: { [lesson_block_id]: [{ day, period }] }
  // Tracks lesson blocks the user manually dragged onto the grid (📌 pre-assigned).
  userPlacements: {},
}

function reducer(state, action) {
  switch (action.type) {
    case 'SET_FIXTURE':
      return { ...state, selectedFixture: action.payload }
    case 'SET_FIXTURE_DATA':
      return { ...state, fixtureData: action.payload, isLoadingFixture: false, isDirty: false }
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
    case 'SET_FIXTURE_DATA_DIRECT':
      return { ...state, fixtureData: action.payload, isLoadingFixture: false, selectedFixture: 'custom', isDirty: true }
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
      const lb = state.fixtureData?.lesson_blocks?.find((b) => b.id === lessonBlockId)
      const solverPlaced =
        state.result?.slots?.filter((s) => s.lesson_block_id === lessonBlockId).length || 0
      const totalPlaced = existing.length + solverPlaced
      if (lb && totalPlaced >= (lb.periods_per_week || 0)) {
        return state // already fully placed
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
    case 'RESTORE_PLACEMENTS':
      return { ...state, userPlacements: action.payload }
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
  useEffect(() => {
    const CACHE_KEYS = ['timetable_custom', 'timetable_primary_mock', 'timetable_large', 'timetable_medium', 'timetable_small']
    let restored = false
    ;(async () => {
      for (const key of CACHE_KEYS) {
        try {
          const cached = await getCachedTimetable(key)
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
          // Cache read failed, continue
        }
      }
    })()
  }, [])

  const runSolver = useCallback(async (options = {}) => {
    const { preAssignments = null } = options
    dispatch({ type: 'SET_GENERATING', payload: true })
    try {
      if (!state.fixtureData) {
        const data = await fetch(`/fixtures/school_${state.selectedFixture}.json`).then((r) => r.json())
        dispatch({ type: 'SET_FIXTURE_DATA', payload: data })
      }
      let result
      if (state.selectedFixture === 'custom' && state.fixtureData) {
        // Build payload, optionally injecting user pre-assignments as fixed_slots
        let payload = { ...state.fixtureData, optimization_mode: state.optimizationMode }
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
        result = await generateTimetable(payload)
      } else {
        result = await generateFromFile(FIXTURE_PATHS[state.selectedFixture])
      }
      dispatch({ type: 'SET_RESULT', payload: result })
      const cacheKey = `timetable_${state.selectedFixture}`
      try {
        await cacheTimetable(cacheKey, { result, fixtureData: state.fixtureData, version: 1 })
        dispatch({ type: 'SET_CACHE_INFO', payload: { cacheKey, lastSync: Date.now() } })
      } catch (e) {
        // Caching failed silently
      }
    } catch (err) {
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
  }, [state.selectedFixture, state.fixtureData, state.optimizationMode])

  const setStep = useCallback((step) => {
    dispatch({ type: 'SET_STEP', payload: step })
  }, [])

  const setGridFilter = useCallback((filter) => {
    dispatch({ type: 'SET_GRID_FILTER', payload: filter })
  }, [])

  const setOptimizationMode = useCallback((mode) => {
    dispatch({ type: 'SET_OPTIMIZATION_MODE', payload: mode })
  }, [])

  const setFixtureDataDirect = useCallback((data) => {
    dispatch({ type: 'SET_FIXTURE_DATA_DIRECT', payload: data })
  }, [])

  const updateFixtureData = useCallback((partial) => {
    dispatch({ type: 'UPDATE_FIXTURE_DATA', payload: partial })
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
      } catch (e) { /* ignore */ }
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
      } catch (e) { /* ignore */ }
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
        clearResult,
        setFixtureDataDirect,
        updateFixtureData,
        placeLessonBlock,
        removePlacement,
        clearPlacements,
        clearAllSlots,
        clearByTeacher,
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
