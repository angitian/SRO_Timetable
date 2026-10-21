import { useState, useMemo, useEffect, useRef, Fragment } from 'react'
import {
  Plus, Trash2, ArrowRight, ArrowLeft, Clock, Layers, BookOpen, Coffee,
  UtensilsCrossed, X, Check, ChevronDown, ZoomIn, ZoomOut, Edit2, CalendarHeart, Star, Calendar,
  AlertTriangle, Users, Upload, FileSpreadsheet, Download, HelpCircle,
} from 'lucide-react'
import { useApp } from '../context/AppContext.jsx'
import { generatePeriods, createDefaultBlock, buildClassBlockMap, insertBreakPeriod } from '../utils/periods.js'
import { getRoomTypeColor, isSpecialRoomType } from '../utils/roomTypes.js'
import { normalizeClassTeachers } from '../utils/teacherLoad.js'
import { parseSpecialActivitiesExcel, resolveToFixedSlots } from '../utils/specialActivitiesImport.js'
import { gradeLevelToLabel } from '../utils/gradeLabels.js'

const PERIOD_TYPE_CONFIG = {
  STUDY: { label: 'คาบเรียน', icon: BookOpen, color: 'bg-blue-100 text-blue-700 border-blue-300' },
  LUNCH: { label: 'พักเที่ยง', icon: UtensilsCrossed, color: 'bg-orange-100 text-orange-700 border-orange-300' },
  BREAK: { label: 'พัก', icon: Coffee, color: 'bg-gray-100 text-gray-600 border-gray-300' },
}

const DAY_NAMES = ['จันทร์', 'อังคาร', 'พุธ', 'พฤหัสบดี', 'ศุกร์', 'เสาร์']

/**
 * Keep schedule_config in sync with the schedule blocks so components that
 * read schedule_config (teacher unavailable grid, smart defaults, facility
 * grid) reflect the block structure the user actually built.
 */
function syncScheduleConfigFromBlocks(blocks, cfg) {
  const ref = blocks?.[0]
  if (!ref) return cfg
  const dayPeriods = ref.periods || []
  const maxPeriod = Math.max(1, ...dayPeriods.map((p) => Math.floor(p.period_no)))
  const lunch = dayPeriods.filter((p) => p.type === 'LUNCH').map((p) => Math.floor(p.period_no))
  return {
    ...(cfg || {}),
    periods_per_day: maxPeriod,
    lunch_periods: lunch.length ? lunch : (cfg?.lunch_periods || [4]),
    days_per_week: ref.days_per_week || cfg?.days_per_week || 5,
  }
}

function recalculateTimes(periods, startTime, periodDuration, breakDuration, lunchDuration, autoShortBreak = true) {
  const [h, m] = startTime.split(':').map(Number)
  let currentMin = h * 60 + m
  const result = []
  for (let i = 0; i < periods.length; i++) {
    const p = periods[i]
    const duration = p.type === 'STUDY' ? periodDuration
      : p.type === 'LUNCH' ? (lunchDuration || periodDuration)
      : breakDuration
    const startMin = currentMin
    const endMin = currentMin + duration
    result.push({
      ...p,
      start_time: `${String(Math.floor(startMin / 60)).padStart(2, '0')}:${String(startMin % 60).padStart(2, '0')}`,
      end_time: `${String(Math.floor(endMin / 60)).padStart(2, '0')}:${String(endMin % 60).padStart(2, '0')}`,
    })
    currentMin = endMin
    // Add break after STUDY periods (not after last, LUNCH, or BREAK)
    // — เว้นเฉพาะเมื่อเปิด auto_short_break (มิฉะนั้นคาบเรียนติดกัน)
    if (p.type === 'STUDY' && i < periods.length - 1 && autoShortBreak) {
      const next = periods[i + 1]
      if (next.type === 'STUDY') {
        currentMin += breakDuration
      }
    }
  }
  return result
}

/**
 * สร้างลำดับคาบเรียน + พักเที่ยง
 * @param {number} studyCount จำนวนคาบเรียน (ไม่รวมพักเที่ยง)
 * @param {number} lunchAfter จำนวนคาบเรียนก่อนพักเที่ยง (0 = ไม่มีพักเที่ยง)
 */
function buildPeriodSequence(studyCount, lunchAfter) {
  const newPeriods = []
  let periodNo = 1
  let studyPlaced = 0
  const total = lunchAfter > 0 ? studyCount + 1 : studyCount
  for (let i = 0; i < total; i++) {
    if (lunchAfter > 0 && i === lunchAfter) {
      newPeriods.push({ period_no: periodNo++, start_time: '00:00', end_time: '00:00', type: 'LUNCH' })
    }
    if (studyPlaced < studyCount) {
      newPeriods.push({ period_no: periodNo++, start_time: '00:00', end_time: '00:00', type: 'STUDY' })
      studyPlaced++
    }
  }
  return newPeriods
}

export default function ScheduleBlocksStep() {
  const { fixtureData, updateFixtureData, setIsDirty, setStep } = useApp()
  const [fontSize, setFontSize] = useState(1) // 0=sm, 1=md, 2=lg
  const [activeBlockId, setActiveBlockId] = useState(null)
  const fontScale = [0.85, 1, 1.25][fontSize]

  const scheduleBlocks = fixtureData?.schedule_blocks || []
  const classes = fixtureData?.classes || []

  // Keep activeBlockId in sync with scheduleBlocks array
  useEffect(() => {
    if (scheduleBlocks.length === 0) {
      if (activeBlockId !== null) setActiveBlockId(null)
      return
    }
    const exists = scheduleBlocks.some((b) => b.id === activeBlockId)
    if (!exists) {
      setActiveBlockId(scheduleBlocks[0].id)
    }
  }, [scheduleBlocks, activeBlockId])

  function addBlock() {
    const newId = `block_${Date.now()}`
    const periodsPerDay = fixtureData?.schedule_config?.periods_per_day || 8
    const newBlock = createDefaultBlock(newId, `ตารางเรียน ${scheduleBlocks.length + 1}`, {
      lunchPeriodNos: [4],
      totalPeriods: periodsPerDay,
    })
    const nextBlocks = [...scheduleBlocks, newBlock]
    updateFixtureData({
      schedule_blocks: nextBlocks,
      schedule_config: syncScheduleConfigFromBlocks(nextBlocks, fixtureData?.schedule_config),
    })
    setActiveBlockId(newId)
  }

  function updateBlock(blockId, updates) {
    const nextBlocks = scheduleBlocks.map((b) =>
      b.id === blockId ? { ...b, ...updates } : b
    )
    updateFixtureData({
      schedule_blocks: nextBlocks,
      schedule_config: syncScheduleConfigFromBlocks(nextBlocks, fixtureData?.schedule_config),
    })
  }

  function removeBlock(blockId) {
    const idx = scheduleBlocks.findIndex((b) => b.id === blockId)
    const remaining = scheduleBlocks.filter((b) => b.id !== blockId)
    updateFixtureData({
      schedule_blocks: remaining,
      schedule_config: syncScheduleConfigFromBlocks(remaining, fixtureData?.schedule_config),
    })
    // Select a new active block if we're removing the active one
    if (blockId === activeBlockId) {
      if (remaining.length === 0) {
        setActiveBlockId(null)
      } else {
        // Prefer the previous index, fallback to first
        const newIdx = Math.max(0, idx - 1)
        setActiveBlockId(remaining[newIdx].id)
      }
    }
  }

  const classBlockMap = useMemo(() => buildClassBlockMap(scheduleBlocks), [scheduleBlocks])
  const unmappedClasses = classes.filter((c) => !classBlockMap[c.id])

  const classesByGrade = useMemo(() => {
    const map = {}
    for (const c of classes) {
      const key = c.grade_level || 0
      if (!map[key]) map[key] = []
      map[key].push(c)
    }
    return Object.entries(map).sort((a, b) => a[0] - b[0])
  }, [classes])

  const activeBlock = scheduleBlocks.find((b) => b.id === activeBlockId)
  const activeIndex = activeBlock ? scheduleBlocks.findIndex((b) => b.id === activeBlock.id) : -1

  return (
    <div className="space-y-6 pb-24" style={{ fontSize: `${fontScale}rem` }}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Layers className="w-6 h-6 text-blue-600" />
          <h2 className="font-bold text-gray-900" style={{ fontSize: '1.25rem' }}>สร้าง Schedule Block</h2>
        </div>
        {/* Font size toggle */}
        <div className="flex items-center gap-0.5 bg-gray-100 rounded-lg p-0.5">
          <button
            onClick={() => setFontSize(Math.max(0, fontSize - 1))}
            disabled={fontSize === 0}
            className="p-1 rounded text-gray-500 hover:text-gray-700 disabled:opacity-30"
          >
            <ZoomOut className="w-4 h-4" />
          </button>
          <span className="text-gray-500 px-1">{['S', 'M', 'L'][fontSize]}</span>
          <button
            onClick={() => setFontSize(Math.min(2, fontSize + 1))}
            disabled={fontSize === 2}
            className="p-1 rounded text-gray-500 hover:text-gray-700 disabled:opacity-30"
          >
            <ZoomIn className="w-4 h-4" />
          </button>
        </div>
      </div>

      {scheduleBlocks.length === 0 && (
        <div className="card text-center py-12 text-gray-400 space-y-4">
          <Layers className="w-12 h-12 mx-auto opacity-30" />
          <p>ยังไม่มี Schedule Block — กดปุ่มด้านล่างเพื่อเริ่มสร้างบล็อกตารางเรียน</p>
          <button
            onClick={addBlock}
            className="btn-primary inline-flex items-center gap-1.5"
          >
            <Plus className="w-4 h-4" />
            เพิ่มบล็อกตารางเรียน
          </button>
        </div>
      )}

      {scheduleBlocks.length > 0 && (
        <>
          {/* Tab Bar */}
          <div className="flex items-center gap-1 overflow-x-auto pb-1 border-b border-gray-200">
            {scheduleBlocks.map((block, idx) => {
              const isActive = block.id === activeBlockId
              const roomCount = block.target_classes?.length || 0
              return (
                <button
                  key={block.id}
                  onClick={() => setActiveBlockId(block.id)}
                  aria-selected={isActive}
                  role="tab"
                  className={`flex items-center gap-1.5 px-3 py-2 rounded-t-lg font-medium whitespace-nowrap transition-colors border-b-2 -mb-px
                    ${isActive
                      ? 'bg-blue-600 text-white border-blue-600'
                      : 'bg-gray-100 text-gray-600 hover:bg-gray-200 border-transparent'
                    }`}
                >
                  <span className="flex items-center gap-1">
                    <span className={`w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold
                      ${isActive ? 'bg-white/20' : 'bg-blue-100 text-blue-700'}`}>
                      {idx + 1}
                    </span>
                    {block.name}
                  </span>
                  <span className={`text-xs px-1.5 py-0.5 rounded-full font-medium
                    ${isActive ? 'bg-white/20' : 'bg-gray-200 text-gray-600'}`}>
                    {roomCount} ห้อง
                  </span>
                </button>
              )
            })}
            {/* Add Tab Button */}
            <button
              onClick={addBlock}
              className="flex items-center gap-1.5 px-3 py-2 rounded-t-lg font-medium whitespace-nowrap text-blue-600 hover:bg-blue-50 border-b-2 border-transparent transition-colors"
              title="เพิ่มบล็อกตาราง"
            >
              <Plus className="w-4 h-4" />
              เพิ่มบล็อกตาราง
            </button>
          </div>

          {/* Active Tab Content */}
          {activeBlock && (
            <BlockCard
              key={activeBlock.id}
              block={activeBlock}
              index={activeIndex}
              classes={classes}
              classesByGrade={classesByGrade}
              classBlockMap={classBlockMap}
              fontSize={fontSize}
              onUpdate={(updates) => updateBlock(activeBlock.id, updates)}
              onRemove={() => removeBlock(activeBlock.id)}
              onInsertBreak={() => setIsDirty(false)}
            />
          )}
        </>
      )}

      {unmappedClasses.length > 0 && classes.length > 0 && (
        <div className="text-amber-600 bg-amber-50 border border-amber-200 rounded-lg px-4 py-2">
          ⚠ ห้องเรียนที่ยังไม่ผูกกับบล็อก: {unmappedClasses.map((c) => c.name).join(', ')}
        </div>
      )}

      <SpecialActivitiesSection />

      {/* Sticky Global Wizard Footer */}
      <div className="fixed bottom-0 left-0 right-0 z-50 bg-white/95 backdrop-blur border-t border-gray-200 shadow-lg px-4 sm:px-6 lg:px-8 py-3">
        <div className="max-w-7xl mx-auto flex items-center justify-between gap-4">
          <button
            onClick={() => setStep(1)}
            className="btn-secondary text-sm flex items-center gap-1.5 shrink-0"
          >
            <ArrowLeft className="w-4 h-4" />
            กลับ
          </button>
          <div className="hidden sm:flex items-center gap-2 text-sm min-w-0">
            <Clock className="w-4 h-4 text-blue-500 shrink-0" />
            <span className="text-gray-700 font-medium truncate">
              บล็อกตารางเรียน {scheduleBlocks.length} บล็อก
            </span>
          </div>
          {scheduleBlocks.length > 0 ? (
            <button
              onClick={() => setStep(3)}
              className="flex items-center gap-2 px-6 py-2.5 bg-blue-600 text-white rounded-xl font-bold text-sm hover:bg-blue-700 transition-colors shadow-md whitespace-nowrap shrink-0"
            >
              ถัดไป: กรอกภาระงานครู
              <ArrowRight className="w-4 h-4" />
            </button>
          ) : (
            <button
              disabled
              className="flex items-center gap-2 px-6 py-2.5 bg-blue-600 text-white rounded-xl font-bold text-sm hover:bg-blue-700 transition-colors shadow-md whitespace-nowrap opacity-50 cursor-not-allowed shrink-0"
            >
              ถัดไป: กรอกภาระงานครู
              <ArrowRight className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Block Card ──────────────────────────────────────────────────────────────

function BlockCard({ block, index, classes, classesByGrade, classBlockMap, fontSize, onUpdate, onRemove, onInsertBreak }) {
  const [showAddMenuForDay, setShowAddMenuForDay] = useState(null)

  // Cell min-width and icon size scale with fontSize, but text size is inherited from wrapper
  const cellMinW = ['min-w-[48px]', 'min-w-[60px]', 'min-w-[80px]'][fontSize]
  const dayW = ['w-16', 'w-20', 'w-24'][fontSize]
  const addW = ['w-12', 'w-16', 'w-20'][fontSize]
  const iconSz = ['w-2.5 h-2.5', 'w-3 h-3', 'w-4 h-4'][fontSize]

  const usePerDay = !block.apply_to_all_days
  const days = Array.from({ length: block.days_per_week }, (_, i) => i + 1)

  function getPeriodsForDay(d) {
    if (usePerDay) {
      return block.periods_by_day?.[String(d)] || []
    }
    return block.periods
  }

  function setPeriodsForDay(d, periods) {
    const recalculated = recalculateTimes(
      periods, block.start_time, block.period_duration_mins, block.break_duration_mins, block.lunch_duration_mins,
      block.auto_short_break !== false,
    )
    if (usePerDay) {
      onUpdate({ periods_by_day: { ...block.periods_by_day, [String(d)]: recalculated } })
    } else {
      onUpdate({ periods: recalculated })
    }
  }

  function regenerateFromStudyCount(studyCount) {
    // Find existing lunch position (in terms of study periods before it)
    const refPeriods = getPeriodsForDay(1)
    const lunchStudyIdx = refPeriods.findIndex((p) => p.type === 'LUNCH')
    const studiesBeforeLunch = lunchStudyIdx >= 0
      ? refPeriods.slice(0, lunchStudyIdx).filter((p) => p.type === 'STUDY').length
      : Math.min(4, studyCount) // default: lunch after 4th study period

    const lunchAfter = Math.min(studiesBeforeLunch, studyCount)
    const newPeriods = buildPeriodSequence(studyCount, lunchAfter)

    if (usePerDay) {
      const newByDay = {}
      for (const d of days) {
        newByDay[String(d)] = recalculateTimes(
          newPeriods, block.start_time, block.period_duration_mins, block.break_duration_mins, block.lunch_duration_mins,
          block.auto_short_break !== false,
        )
      }
      onUpdate({ periods_by_day: newByDay })
    } else {
      onUpdate({
        periods: recalculateTimes(newPeriods, block.start_time, block.period_duration_mins, block.break_duration_mins, block.lunch_duration_mins, block.auto_short_break !== false)
      })
    }
  }

  // เปลี่ยนตำแหน่งพักเที่ยง (lunchAfter = จำนวนคาบเรียนก่อนพักเที่ยง; 0 = ไม่มีพักเที่ยง)
  function handleLunchPositionChange(lunchAfter) {
    const applyToDay = (dayPeriods) => {
      const studyCount = dayPeriods.filter((p) => p.type === 'STUDY').length
      return recalculateTimes(
        buildPeriodSequence(studyCount, lunchAfter),
        block.start_time, block.period_duration_mins, block.break_duration_mins, block.lunch_duration_mins,
        block.auto_short_break !== false,
      )
    }
    if (usePerDay) {
      const byDay = {}
      for (const d of days) {
        byDay[String(d)] = applyToDay(getPeriodsForDay(d))
      }
      onUpdate({ periods_by_day: byDay })
    } else {
      onUpdate({ periods: applyToDay(block.periods) })
    }
  }

  function toggleApplyToAll() {
    if (block.apply_to_all_days) {
      const periodsByDay = {}
      for (const d of days) {
        periodsByDay[String(d)] = [...block.periods]
      }
      onUpdate({ apply_to_all_days: false, periods_by_day: periodsByDay })
    } else {
      const dayPeriods = block.periods_by_day?.['1'] || block.periods
      onUpdate({ apply_to_all_days: true, periods_by_day: {}, periods: dayPeriods })
    }
  }

  function togglePeriodType(d, periodNo) {
    const periods = getPeriodsForDay(d)
    const updated = periods.map((p) => {
      if (p.period_no === periodNo) {
        const nextType = p.type === 'STUDY' ? 'LUNCH' : p.type === 'LUNCH' ? 'BREAK' : 'STUDY'
        return { ...p, type: nextType }
      }
      return p
    })
    setPeriodsForDay(d, updated)
  }

  function addPeriod(d, type) {
    setShowAddMenuForDay(null)
    const periods = getPeriodsForDay(d)
    const maxPeriod = Math.max(0, ...periods.map((p) => p.period_no))
    const newPeriodNo = maxPeriod + 1
    const newPeriod = {
      period_no: newPeriodNo,
      start_time: '00:00',
      end_time: '00:00',
      type,
    }
    setPeriodsForDay(d, [...periods, newPeriod])
  }

  // Insert a short BREAK between two periods using a decimal period_no
  // (e.g. between 3 and 4 → 3.5) so existing STUDY/LUNCH period_no values
  // are preserved → placements/slots stay valid → no need to re-schedule.
  function insertBreak(d, afterPeriodNo) {
    const periods = getPeriodsForDay(d)
    const merged = insertBreakPeriod(periods, afterPeriodNo)
    setPeriodsForDay(d, merged)
    // Suppress the "regenerate" banner: inserting a BREAK does not shift
    // any existing STUDY period_no, so prior placements remain valid.
    onInsertBreak?.()
  }

  function removePeriod(d, periodNo) {
    const periods = getPeriodsForDay(d)
    if (periods.length <= 1) return
    setPeriodsForDay(d, periods.filter((p) => p.period_no !== periodNo))
  }

  function toggleTargetClass(classId) {
    const target = block.target_classes.includes(classId)
      ? block.target_classes.filter((c) => c !== classId)
      : [...block.target_classes, classId]
    onUpdate({ target_classes: target })
  }

  function selectAllInGrade(gradeClasses) {
    const gradeIds = gradeClasses.map((c) => c.id)
    const current = new Set(block.target_classes)
    const allSelected = gradeIds.every((id) => current.has(id))
    if (allSelected) {
      onUpdate({ target_classes: block.target_classes.filter((id) => !gradeIds.includes(id)) })
    } else {
      const merged = new Set([...block.target_classes, ...gradeIds])
      onUpdate({ target_classes: Array.from(merged) })
    }
  }

  function selectAll() {
    onUpdate({ target_classes: classes.map((c) => c.id) })
  }

  function deselectAll() {
    onUpdate({ target_classes: [] })
  }

  function handleConfigChange(updates) {
    const newBlock = { ...block, ...updates }
    for (const d of days) {
      const periods = usePerDay
        ? (newBlock.periods_by_day?.[String(d)] || [])
        : newBlock.periods
      if (periods.length > 0) {
        const recalculated = recalculateTimes(
          periods, newBlock.start_time || block.start_time,
          newBlock.period_duration_mins || block.period_duration_mins,
          newBlock.break_duration_mins || block.break_duration_mins,
          newBlock.lunch_duration_mins || block.lunch_duration_mins,
          newBlock.auto_short_break !== false,
        )
        if (usePerDay) {
          updates.periods_by_day = { ...(updates.periods_by_day || newBlock.periods_by_day), [String(d)]: recalculated }
        } else {
          updates.periods = recalculated
        }
      }
    }
    onUpdate(updates)
  }

  return (
    <div className="card space-y-4">
      {/* Block header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="w-7 h-7 bg-blue-600 text-white rounded-full flex items-center justify-center font-bold">
            {index + 1}
          </span>
          <input
            type="text"
            value={block.name}
            onChange={(e) => onUpdate({ name: e.target.value })}
            className="font-bold text-gray-900 bg-transparent border-b border-dashed border-gray-300 hover:border-blue-400 focus:border-blue-500 outline-none px-1 rounded"
            placeholder="ชื่อตารางเรียน"
          />
          <Edit2 className="w-3.5 h-3.5 text-gray-400" />
        </div>
        <button
          onClick={onRemove}
          className="text-red-500 hover:text-red-700"
        >
          <Trash2 className="w-4 h-4" />
        </button>
      </div>

      {/* Config inputs */}
      <div className="grid grid-cols-2 sm:grid-cols-6 gap-3">
        <div>
          <label className="font-medium text-gray-600 mb-1 flex items-center gap-1">
            <Clock className="w-3.5 h-3.5 text-gray-400" />
            เวลาเริ่มคาบแรก
          </label>
          <input
            type="time"
            value={block.start_time}
            onChange={(e) => handleConfigChange({ start_time: e.target.value })}
            className="w-full border border-gray-300 rounded-lg px-2 py-1.5"
          />
        </div>
        <div>
          <label className="font-medium text-gray-600 mb-1 flex items-center gap-1" title="จำนวนคาบเรียนต่อวัน (ไม่รวมพักเที่ยง)">
            <BookOpen className="w-3.5 h-3.5 text-blue-600" />
            คาบเรียน/วัน
          </label>
          <input
            type="number" min="1" max="15"
            value={(() => {
              const dp = getPeriodsForDay(1)
              return dp.filter((p) => p.type === 'STUDY').length
            })()}
            onChange={(e) => {
              const studyCount = parseInt(e.target.value) || 1
              regenerateFromStudyCount(studyCount)
            }}
            className="w-full border border-gray-300 rounded-lg px-2 py-1.5"
            title="จำนวนคาบเรียนต่อวัน (ไม่รวมพักเที่ยง)"
          />
          <p className="text-[10px] text-gray-400 mt-0.5">ไม่รวมพักเที่ยง</p>
        </div>
        <div>
          <label className="font-medium text-gray-600 mb-1 flex items-center gap-1">
            <Clock className="w-3.5 h-3.5 text-gray-400" />
            ความยาวคาบ (นาที)
          </label>
          <input
            type="number" min="10" max="120"
            value={block.period_duration_mins}
            onChange={(e) => handleConfigChange({ period_duration_mins: parseInt(e.target.value) || 50 })}
            className="w-full border border-gray-300 rounded-lg px-2 py-1.5"
          />
        </div>
        <div>
          <label className="font-medium text-gray-600 mb-1 flex items-center gap-1">
            <UtensilsCrossed className="w-3.5 h-3.5 text-orange-600" />
            พักเที่ยง (นาที)
          </label>
          <input
            type="number" min="10" max="120"
            value={block.lunch_duration_mins || 50}
            onChange={(e) => handleConfigChange({ lunch_duration_mins: parseInt(e.target.value) || 50 })}
            className="w-full border border-gray-300 rounded-lg px-2 py-1.5"
          />
          <select
            value={(() => {
              const dp = getPeriodsForDay(1)
              const idx = dp.findIndex((p) => p.type === 'LUNCH')
              return idx >= 0 ? dp.slice(0, idx).filter((p) => p.type === 'STUDY').length : 0
            })()}
            onChange={(e) => handleLunchPositionChange(parseInt(e.target.value) || 0)}
            className="w-full border border-gray-300 rounded-lg px-2 py-1.5 mt-1"
            title="ตำแหน่งพักเที่ยง — หลังคาบเรียนที่เท่าไร"
          >
            <option value={0}>ไม่มีพักเที่ยง</option>
            {Array.from({ length: (getPeriodsForDay(1).filter((p) => p.type === 'STUDY').length) }, (_, i) => i + 1).map((n) => (
              <option key={n} value={n}>พักเที่ยงหลังคาบที่ {n}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="font-medium text-gray-600 mb-1 flex items-center gap-1">
            <Coffee className="w-3.5 h-3.5 text-gray-600" />
            พักสั้น (นาที)
          </label>
          <input
            type="number" min="5" max="60"
            value={block.break_duration_mins}
            onChange={(e) => handleConfigChange({ break_duration_mins: parseInt(e.target.value) || 10 })}
            className="w-full border border-gray-300 rounded-lg px-2 py-1.5"
          />
          <label className="flex items-center gap-1.5 mt-1.5 cursor-pointer text-xs text-gray-500 hover:text-gray-700" title="ปิด = คาบเรียนติดกัน (08:30–09:20, 09:20–10:10...) ไม่เว้นช่องพักสั้น">
            <input
              type="checkbox"
              checked={block.auto_short_break !== false}
              onChange={(e) => handleConfigChange({ auto_short_break: e.target.checked })}
              className="w-3.5 h-3.5 rounded text-blue-600"
            />
            เว้นพักสั้นระหว่างคาบอัตโนมัติ
          </label>
        </div>
        <div>
          <label className="font-medium text-gray-600 mb-1 flex items-center gap-1">
            <Calendar className="w-3.5 h-3.5 text-gray-400" />
            จำนวนวัน/สัปดาห์
          </label>
          <select
            value={block.days_per_week}
            onChange={(e) => onUpdate({ days_per_week: parseInt(e.target.value) })}
            className="w-full border border-gray-300 rounded-lg px-2 py-1.5"
          >
            {[5, 6].map((d) => <option key={d} value={d}>{d} วัน</option>)}
          </select>
        </div>
      </div>

      {/* Apply to all days toggle */}
      <div className="flex items-center gap-3 bg-gray-50 rounded-lg px-3 py-2">
        <label className="flex items-center gap-2 cursor-pointer font-medium text-gray-700">
          <input
            type="checkbox"
            checked={block.apply_to_all_days}
            onChange={toggleApplyToAll}
            className="w-4 h-4 rounded text-blue-600"
          />
          ใช้โครงสร้างนี้กับทุกวัน (Apply to All Days)
        </label>
      </div>

      {/* Multi-day Time Grid — rows=days, cols=periods */}
      <div>
        <label className="font-medium text-gray-700 mb-2 flex items-center gap-1.5">
          <Clock className="w-4 h-4 text-gray-500" />
          ตารางคาบเรียน (คลิกเพื่อสลับประเภท)
        </label>
        <div className="overflow-x-auto">
          {/* Shared time header (when apply_to_all_days) */}
          {block.apply_to_all_days && (() => {
            const refPeriods = getPeriodsForDay(1)
            return (
              <div className="flex items-stretch gap-1.5 mb-1">
                <div className={`${dayW} shrink-0`} />
                {refPeriods.map((p) => {
                  const isBr = p.type === 'BREAK'
                  const flexClass = isBr ? 'flex-[0.18]' : 'flex-1'
                  const minWClass = isBr ? 'min-w-[28px]' : cellMinW
                  const label = isBr ? 'พัก' : `${p.start_time} - ${p.end_time}`
                  return (
                    <div key={p.period_no} className={`${flexClass} ${minWClass} text-center text-gray-500 font-medium py-1`}>
                      {label}
                    </div>
                  )
                })}
                <div className={`${addW} shrink-0`} />
              </div>
            )
          })()}

          {days.map((d) => {
            const dayPeriods = getPeriodsForDay(d)
            return (
              <div key={d}>
                {/* Per-day time header (when not apply_to_all_days) */}
                {!block.apply_to_all_days && (
                  <div className="flex items-stretch gap-1.5 mb-0.5">
                    <div className={`${dayW} shrink-0`} />
                    {dayPeriods.map((p) => {
                      const isBr = p.type === 'BREAK'
                      const flexClass = isBr ? 'flex-[0.18]' : 'flex-1'
                      const minWClass = isBr ? 'min-w-[28px]' : cellMinW
                      const label = isBr ? 'พัก' : `${p.start_time} - ${p.end_time}`
                      return (
                        <div key={p.period_no} className={`${flexClass} ${minWClass} text-center text-gray-500 font-medium py-1`}>
                          {label}
                        </div>
                      )
                    })}
                    <div className={`${addW} shrink-0`} />
                  </div>
                )}

                <div className="flex items-stretch gap-1.5 mb-1.5">
                  {/* Day label — fixed width on left */}
                  <div className={`${dayW} shrink-0 flex items-center justify-center font-bold text-gray-600 bg-gray-50 rounded-md py-2`}>
                    <div className="text-center">
                      {DAY_NAMES[d - 1]}
                    </div>
                  </div>

                  {/* Period cells — horizontal row, with thin "insert break" divider between cells */}
                  {dayPeriods.map((p, idx) => {
                    const config = PERIOD_TYPE_CONFIG[p.type] || PERIOD_TYPE_CONFIG.STUDY
                    const Icon = config.icon
                    const showInsertBefore = idx > 0
                    const isBreakCell = p.type === 'BREAK'
                    const cellFlex = isBreakCell ? 'flex-[0.18]' : 'flex-1'
                    const cellPadding = isBreakCell ? 'p-0.5' : 'px-1.5 py-1.5'
                    return (
                      <Fragment key={p.period_no}>
                        {showInsertBefore && (
                          <button
                            onClick={() => insertBreak(d, dayPeriods[idx - 1].period_no)}
                            className="shrink-0 w-2 sm:w-3 self-stretch flex items-center justify-center text-gray-300 hover:text-blue-600 transition-colors group"
                            title="แทรกพักสั้นระหว่างคาบ"
                          >
                            <span className="opacity-0 group-hover:opacity-100 transition-opacity flex flex-col items-center">
                              <Coffee className={fontSize === 0 ? 'w-2 h-2' : 'w-2.5 h-2.5'} />
                              <Plus className={fontSize === 0 ? 'w-1.5 h-1.5 -mt-0.5' : 'w-2 h-2 -mt-1'} />
                            </span>
                          </button>
                        )}
                        <div
                          className={`relative ${cellFlex} ${isBreakCell ? 'min-w-[28px]' : cellMinW} ${cellPadding} rounded-lg font-medium border-2 transition-all ${config.color}`}
                          title={`${p.start_time} - ${p.end_time}`}
                        >
                          <button
                            onClick={() => togglePeriodType(d, p.period_no)}
                            className="flex flex-col items-center w-full"
                          >
                            <div className="flex items-center gap-1">
                              {isBreakCell ? (
                                <Coffee className={fontSize === 0 ? 'w-2.5 h-2.5' : fontSize === 1 ? 'w-3 h-3' : 'w-3.5 h-3.5'} />
                              ) : (
                                <>
                                  <Icon className={iconSz} />
                                  <span className="font-bold">{p.period_no}</span>
                                </>
                              )}
                            </div>
                          </button>
                          {dayPeriods.length > 1 && (
                            <button
                              onClick={() => removePeriod(d, p.period_no)}
                              className={`absolute -top-1 -right-1 ${isBreakCell ? 'w-3.5 h-3.5' : 'w-5 h-5'} bg-red-500 text-white rounded-full flex items-center justify-center hover:bg-red-600 transition-colors`}
                              title="ลบคาบนี้"
                            >
                              <X className={isBreakCell ? 'w-2 h-2' : 'w-3 h-3'} />
                            </button>
                          )}
                        </div>
                      </Fragment>
                    )
                  })}

                  {/* Add period dropdown */}
                  <div className={`relative shrink-0 ${addW}`}>
                    <button
                      onClick={() => setShowAddMenuForDay(showAddMenuForDay === d ? null : d)}
                      className="w-full h-full min-h-[36px] px-1.5 py-1.5 rounded-lg font-medium border-2 border-dashed border-gray-300 text-gray-400 hover:border-blue-400 hover:text-blue-600 transition-all flex items-center justify-center gap-1"
                    >
                      <Plus className={fontSize === 0 ? 'w-3 h-3' : 'w-3.5 h-3.5'} />
                      <ChevronDown className={fontSize === 0 ? 'w-2.5 h-2.5' : 'w-3 h-3'} />
                    </button>
                    {showAddMenuForDay === d && (
                      <div className="absolute top-full left-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg z-10 py-1 min-w-[120px]">
                        <button
                          onClick={() => addPeriod(d, 'STUDY')}
                          className="flex items-center gap-2 px-3 py-1.5 hover:bg-blue-50 w-full text-left"
                        >
                          <BookOpen className="w-3 h-3 text-blue-600" />
                          คาบเรียน
                        </button>
                        <button
                          onClick={() => addPeriod(d, 'LUNCH')}
                          className="flex items-center gap-2 px-3 py-1.5 hover:bg-orange-50 w-full text-left"
                        >
                          <UtensilsCrossed className="w-3 h-3 text-orange-600" />
                          พักเที่ยง
                        </button>
                        <button
                          onClick={() => addPeriod(d, 'BREAK')}
                          className="flex items-center gap-2 px-3 py-1.5 hover:bg-gray-50 w-full text-left"
                        >
                          <Coffee className="w-3 h-3 text-gray-600" />
                          พักสั้น
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* Classroom Multi-Select */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <label className="font-medium text-gray-700">
            ห้องเรียนที่ใช้ตารางนี้ — คลิกชั้นเพื่อเลือกทั้งชั้น หรือคลิกห้องเพื่อเลือกทีละห้อง
          </label>
          {classes.length > 0 && (
            <div className="flex gap-2">
              <button
                onClick={selectAll}
                className="text-blue-600 hover:text-blue-700 font-medium"
              >
                เลือกทั้งหมด
              </button>
              <span className="text-gray-300">|</span>
              <button
                onClick={deselectAll}
                className="text-gray-500 hover:text-gray-700"
              >
                ยกเลิกเลือก
              </button>
            </div>
          )}
        </div>
        {classes.length === 0 ? (
          <p className="text-gray-400">
            ยังไม่มีห้องเรียน — กลับไปเพิ่มได้ในขั้นตอน "เตรียมข้อมูล"
          </p>
        ) : (
          <div className="space-y-1.5">
            {classesByGrade.map(([gradeKey, gradeClasses]) => {
              const gradeNum = parseInt(gradeKey)
              const gradeLabel = gradeLevelToLabel(gradeNum)
              const allSelected = gradeClasses.every((c) => block.target_classes.includes(c.id))
              return (
                <div key={gradeKey} className="flex items-center gap-2 flex-wrap">
                  <button
                    onClick={() => selectAllInGrade(gradeClasses)}
                    className={`font-medium px-2 py-1 rounded shrink-0 ${allSelected ? 'bg-blue-100 text-blue-700' : 'text-gray-500 hover:bg-gray-100'}`}
                  >
                    {allSelected ? '✓ ' : ''}{gradeLabel}
                  </button>
                  <span className="text-gray-400 shrink-0">({gradeClasses.length} ห้อง)</span>
                  {gradeClasses.map((c) => {
                    const isSelected = block.target_classes.includes(c.id)
                    const mappedBlock = classBlockMap[c.id]
                    const isMappedToOther = mappedBlock && mappedBlock !== block.id
                    const colors = getRoomTypeColor(c.room_type)
                    const isSpecial = isSpecialRoomType(c.room_type)
                    return (
                      <label
                        key={c.id}
                        className={`flex items-center gap-1 px-2.5 py-1 rounded-lg font-medium border-2 cursor-pointer transition-all
                          ${isSelected
                            ? colors.selected
                            : isMappedToOther
                            ? 'bg-gray-50 text-gray-300 border-gray-100 cursor-not-allowed'
                            : colors.unselected
                          }`}
                      >
                        <input
                          type="checkbox"
                          checked={isSelected}
                          disabled={isMappedToOther}
                          onChange={() => toggleTargetClass(c.id)}
                          className="hidden"
                        />
                        {c.name}
                        {isSpecial && (
                          <span className={`ml-1 px-1 rounded ${isSelected ? 'bg-white/20' : colors.badge}`}>
                            {c.room_type}
                          </span>
                        )}
                        {isSelected && <Check className="w-3 h-3 inline" />}
                      </label>
                    )
                  })}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

// ── Special Activities Section ───────────────────────────────────────────────

const ACTIVITY_PRESETS = [
  { name: 'ลูกเสือ-เนตรนารี', slot_type: 'scout' },
  { name: 'โฮมรูม', slot_type: 'homeroom' },
  { name: 'ชุมนุม', slot_type: 'club' },
  { name: 'แนะแนว', slot_type: 'guidance' },
  { name: 'เคารพธงชาติ', slot_type: 'assembly' },
]

const CUSTOM_PRESETS_KEY = 'custom_activity_presets'

function loadCustomPresets() {
  try {
    const raw = localStorage.getItem(CUSTOM_PRESETS_KEY)
    return raw ? JSON.parse(raw) : []
  } catch { return [] }
}

function saveCustomPresets(presets) {
  try {
    localStorage.setItem(CUSTOM_PRESETS_KEY, JSON.stringify(presets))
  } catch { /* ignore */ }
}

const SLOT_TYPES = [
  { value: 'assembly', label: 'เคารพธงชาติ/ชุมนุมเช้า' },
  { value: 'homeroom', label: 'โฮมรูม' },
  { value: 'club', label: 'ชุมนุม' },
  { value: 'scout', label: 'ลูกเสือ-เนตรนารี' },
  { value: 'guidance', label: 'แนะแนว' },
  { value: 'rotc', label: 'รด.' },
  { value: 'other', label: 'อื่น ๆ' },
]

const SLOT_TYPE_LABELS = Object.fromEntries(SLOT_TYPES.map((s) => [s.value, s.label]))

const GRADE_LEVELS = [
  { label: 'อ.1', value: -2 },
  { label: 'อ.2', value: -1 },
  { label: 'อ.3', value: 0 },
  { label: 'ป.1', value: 1 },
  { label: 'ป.2', value: 2 },
  { label: 'ป.3', value: 3 },
  { label: 'ป.4', value: 4 },
  { label: 'ป.5', value: 5 },
  { label: 'ป.6', value: 6 },
  { label: 'ม.1', value: 7 },
  { label: 'ม.2', value: 8 },
  { label: 'ม.3', value: 9 },
  { label: 'ม.4', value: 10 },
  { label: 'ม.5', value: 11 },
  { label: 'ม.6', value: 12 },
]

const ALL_GRADE_LABELS = GRADE_LEVELS.map((g) => g.label)

function gradeLabelToValue(label) {
  return GRADE_LEVELS.find((g) => g.label === label)?.value
}

function gradeValueToLabel(value) {
  return GRADE_LEVELS.find((g) => g.value === value)?.label
}

// ── Duplicate fixed-slot detection (คาบซ้ำในกิจกรรมพิเศษ) ──────────────────

function effectivePeriodsOf(slot) {
  return [slot.period, ...(slot.periods || [])].sort((a, b) => a - b)
}

function periodsOverlap(a, b) {
  return a.some((p) => b.includes(p))
}

function classesOverlap(aIds, bIds) {
  // Empty class_ids = ทุกชั้น → ทับทุกอย่าง
  if (!aIds || aIds.length === 0) return true
  if (!bIds || bIds.length === 0) return true
  return aIds.some((c) => bIds.includes(c))
}

/**
 * Return existing activities that overlap the candidate slot:
 * same day + shared period(s) + overlapping classes.
 * excludeId — skip the activity being edited.
 */
function computeSlotConflicts(candidate, activities, excludeId) {
  const candPeriods = effectivePeriodsOf(candidate)
  const candIds = candidate.class_ids || []
  const conflicts = []
  for (const act of activities || []) {
    if (excludeId && act.id === excludeId) continue
    if (act.day !== candidate.day) continue
    const actPeriods = effectivePeriodsOf(act)
    if (!periodsOverlap(candPeriods, actPeriods)) continue
    if (!classesOverlap(candIds, act.class_ids || [])) continue
    conflicts.push({ act, periods: actPeriods.filter((p) => candPeriods.includes(p)) })
  }
  return conflicts
}

function SpecialActivitiesSection() {
  const { fixtureData, updateFixtureData } = useApp()
  const activities = fixtureData?.fixed_slots || []
  const classes = fixtureData?.classes || []
  const teachers = fixtureData?.teachers || []
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState(null)
  const [customPresets, setCustomPresets] = useState(() => loadCustomPresets())

  // Form state
  const [name, setName] = useState('')
  const [slotType, setSlotType] = useState('assembly')
  const [targetGrades, setTargetGrades] = useState([])
  const [fixedDay, setFixedDay] = useState(1)
  const [fixedPeriod, setFixedPeriod] = useState(6)      // first period of the range
  const [periodCount, setPeriodCount] = useState(1)      // number of consecutive periods
  const [extraPeriods, setExtraPeriods] = useState([])   // additional non-consecutive periods
  // ครูผู้ดูแลกิจกรรมรายชั้น: { [class_id]: [teacher_id, ...] } — N ครู/ห้อง
  const [classTeachers, setClassTeachers] = useState({})
  const [showAssignModal, setShowAssignModal] = useState(false)

  // ── Excel import (คาบพิเศษจากไฟล์ xlsx) ──
  const fileInputRef = useRef(null)
  const [importBusy, setImportBusy] = useState(false)
  const [importPreview, setImportPreview] = useState(null) // { slots, warnings, fileName, totalRows, error? }
  const [importNotice, setImportNotice] = useState(null)
  const [showImportHelp, setShowImportHelp] = useState(false)

  async function handleImportFile(e) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setImportBusy(true)
    setImportNotice(null)
    try {
      const buf = await file.arrayBuffer()
      const { rows } = await parseSpecialActivitiesExcel(buf)
      const { slots, warnings } = resolveToFixedSlots(rows, { classes, teachers })
      setImportPreview({ slots, warnings, fileName: file.name, totalRows: rows.length })
    } catch (err) {
      setImportPreview({ slots: [], warnings: [err.message || 'อ่านไฟล์ไม่สำเร็จ'], fileName: file.name, totalRows: 0, error: true })
    }
    setImportBusy(false)
  }

  function confirmImport() {
    const n = importPreview?.slots?.length || 0
    if (n === 0) return
    updateFixtureData({ fixed_slots: [...activities, ...importPreview.slots] })
    setImportPreview(null)
    setImportNotice(`นำเข้าแล้ว ${n} กิจกรรมจาก ${importPreview.fileName}`)
  }

  // Effective periods for the form: contiguous range + extra selections
  function getEffectivePeriods() {
    const range = []
    for (let i = 0; i < periodCount; i++) range.push(fixedPeriod + i)
    return [...new Set([...range, ...extraPeriods])].sort((a, b) => a - b)
  }

  // Convert a saved activity's periods back into form state (range + extras)
  function periodsToForm(first, periods) {
    const sorted = (periods || []).slice().sort((a, b) => a - b)
    let count = 1
    while (sorted.includes(first + count)) count++
    const inRange = new Set(Array.from({ length: count }, (_, i) => first + i))
    const extra = sorted.filter((p) => !inRange.has(p) && p !== first)
    return { count, extra }
  }

  function formatPeriodsText(periods) {
    const sorted = periods.slice().sort((a, b) => a - b)
    if (sorted.length === 1) return `คาบที่ ${sorted[0]}`
    const parts = []
    let start = sorted[0]
    let prev = sorted[0]
    for (let i = 1; i <= sorted.length; i++) {
      if (i < sorted.length && sorted[i] === prev + 1) {
        prev = sorted[i]
        continue
      }
      parts.push(start === prev ? `${start}` : `${start}-${prev}`)
      if (i < sorted.length) {
        start = sorted[i]
        prev = sorted[i]
      }
    }
    return `คาบที่ ${parts.join(', ')}`
  }

  // Merge built-in + custom presets (custom first so they're easy to find)
  const allPresets = [...customPresets, ...ACTIVITY_PRESETS]
  const existingPresetNames = new Set(allPresets.map((p) => p.name))
  const canSaveAsPreset = name.trim() && !existingPresetNames.has(name.trim())

  // ── Duplicate detection: คาบซ้ำกับกิจกรรมเดิม ──
  const formConflicts = useMemo(() => {
    const effective = getEffectivePeriods()
    if (effective.length === 0) return []
    const draft = {
      day: fixedDay,
      period: effective[0],
      periods: effective.slice(1),
      class_ids: gradesToClassIds(targetGrades),
    }
    return computeSlotConflicts(draft, activities, editingId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fixedDay, fixedPeriod, periodCount, extraPeriods, targetGrades, classes, activities, editingId])

  // Conflicts among EXISTING activities (for list badges)
  const listConflicts = useMemo(() => {
    const map = {}
    for (const a of activities) {
      map[a.id] = computeSlotConflicts(a, activities, a.id)
    }
    return map
  }, [activities])

  // ครูผู้ดูแลคนเดียวกันถูกเลือกให้ดูแลกิจกรรมที่ชน (วัน+คาบ) กันเอง → เตือน
  const supervisorConflictTeachers = useMemo(() => {
    const effective = getEffectivePeriods()
    if (effective.length === 0 || Object.keys(classTeachers).length === 0) return []
    const periodSet = new Set(effective)
    const clashTeachers = new Set()
    for (const a of activities) {
      if (editingId && a.id === editingId) continue
      if (a.day !== fixedDay) continue
      const aPeriods = new Set([a.period, ...(a.periods || [])])
      if (![...periodSet].some((p) => aPeriods.has(p))) continue
      const otherCT = normalizeClassTeachers(a.class_teachers || {})
      for (const [cid, tids] of Object.entries(classTeachers)) {
        for (const tid of tids) {
          if ((otherCT[cid] || []).includes(tid)) clashTeachers.add(tid)
        }
      }
    }
    return [...clashTeachers]
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fixedDay, fixedPeriod, periodCount, extraPeriods, classTeachers, activities, editingId])

  // ── เตือนห้องที่ใช้คาบเต็ม: เพิ่มกิจกรรมนี้แล้วจะจัดตารางไม่ได้ (capacity) ──
  const capacityWarnings = useMemo(() => {
    const effective = getEffectivePeriods()
    if (effective.length === 0) return []
    const blocks = fixtureData?.schedule_blocks || []
    const lbs = fixtureData?.lesson_blocks || []
    const warnings = []
    for (const c of targetClassesForTeachers()) {
      const blk = blocks.find((b) => (b.target_classes || []).includes(c.id)) || blocks[0]
      if (!blk) continue
      const studyPerDay = (blk.periods || []).filter((p) => p.type === 'STUDY').length
      const studyTotal = studyPerDay * (blk.days_per_week || 5)
      // ช่องที่กิจกรรมเดิม (ไม่นับตัวที่กำลังแก้) ล็อกห้องนี้
      const lockedCells = new Set()
      for (const a of activities) {
        if (editingId && a.id === editingId) continue
        if (a.class_ids && a.class_ids.length > 0 && !a.class_ids.includes(c.id)) continue
        for (const p of [a.period, ...(a.periods || [])]) lockedCells.add(`${a.day}-${p}`)
      }
      const available = studyTotal - lockedCells.size - effective.length
      const needed = lbs
        .filter((lb) => lb.class_id === c.id)
        .reduce((s, lb) => s + (lb.periods_per_week || 0), 0)
      if (needed > available) {
        warnings.push({
          classId: c.id,
          className: c.name,
          needed,
          available,
          overflow: needed - available,
        })
      }
    }
    return warnings
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fixedDay, fixedPeriod, periodCount, extraPeriods, targetGrades, activities, editingId, fixtureData])

  // ── เตือนชื่อกิจกรรมตรงกับวิชาใน Excel (นับแยก: คาบเรียน + คาบล็อก) ──
  const subjectDuplicateWarning = useMemo(() => {
    if (!name.trim()) return null
    const normalize = (s) => String(s || '').trim().toLowerCase().replace(/[\s_]+/g, '')
    const target = normalize(name)
    const subjects = fixtureData?.subjects || []
    const hit = subjects.find((s) => normalize(s.name) === target)
    return hit ? hit.name : null
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name, fixtureData?.subjects])

  function handleSavePreset() {
    const trimmed = name.trim()
    if (!trimmed) return
    const newPreset = { name: trimmed, slot_type: slotType, custom: true }
    const updated = [...customPresets, newPreset]
    setCustomPresets(updated)
    saveCustomPresets(updated)
  }

  function handleDeletePreset(presetName) {
    const updated = customPresets.filter((p) => p.name !== presetName)
    setCustomPresets(updated)
    saveCustomPresets(updated)
  }

  function resetForm() {
    setName('')
    setSlotType('assembly')
    setTargetGrades([])
    setFixedDay(1)
    setFixedPeriod(6)
    setPeriodCount(1)
    setExtraPeriods([])
    setClassTeachers({})
    setEditingId(null)
    setShowForm(false)
  }

  // ชั้นที่กิจกรรมนี้ล็อก (class_ids) — ใช้แสดงรายการเลือกครูผู้ดูแลรายชั้น
  function targetClassIds() {
    return gradesToClassIds(targetGrades)
  }
  function targetClassesForTeachers() {
    const ids = targetClassIds()
    // ถ้าไม่เลือกระดับชั้น = ทุกห้อง
    const list = ids.length > 0 ? classes.filter((c) => ids.includes(c.id)) : classes
    return list
  }
  // ── batch: เพิ่มครูหลายคนให้หลายห้องพร้อมกัน (dedupe ต่อห้อง) ──
  function addTeachersToRooms(teacherIds, roomIds) {
    setClassTeachers((prev) => {
      const next = { ...prev }
      for (const roomId of roomIds) {
        const cur = normalizeClassTeachers(next)[roomId] || []
        const merged = [...new Set([...cur, ...teacherIds])]
        next[roomId] = merged
      }
      return next
    })
  }
  function addTeacherToRoom(roomId, teacherId) {
    addTeachersToRooms([teacherId], [roomId])
  }
  function removeTeacherFromRoom(roomId, teacherId) {
    setClassTeachers((prev) => {
      const next = { ...prev }
      const cur = normalizeClassTeachers(next)[roomId] || []
      next[roomId] = cur.filter((t) => t !== teacherId)
      return next
    })
  }
  function clearAllClassTeachers() {
    setClassTeachers({})
  }

  // Resolve selected grade labels → class_ids (empty = all classes)
  function gradesToClassIds(labels) {
    if (!labels || labels.length === 0) return []
    const gradeValues = new Set(
      labels.map(gradeLabelToValue).filter((v) => v !== undefined)
    )
    return classes
      .filter((c) => gradeValues.has(c.grade_level))
      .map((c) => c.id)
  }

  // Reverse-map class_ids → grade labels (deduplicated)
  function classIdsToGradeLabels(ids) {
    if (!ids || ids.length === 0) return []
    const idSet = new Set(ids)
    const gradeValues = new Set(
      classes.filter((c) => idSet.has(c.id)).map((c) => c.grade_level)
    )
    return GRADE_LEVELS
      .filter((g) => gradeValues.has(g.value))
      .map((g) => g.label)
  }

  function handleSave() {
    if (!name.trim()) return
    const effective = getEffectivePeriods()
    if (effective.length === 0) return
    const slot = {
      id: editingId || `FS_${Date.now()}`,
      name: name.trim(),
      slot_type: slotType,
      day: fixedDay,
      period: effective[0],
      periods: effective.slice(1),
      class_ids: gradesToClassIds(targetGrades),
      class_teachers: { ...classTeachers },
    }
    if (editingId) {
      updateFixtureData({
        fixed_slots: activities.map((a) => (a.id === editingId ? slot : a)),
      })
    } else {
      updateFixtureData({ fixed_slots: [...activities, slot] })
    }
    resetForm()
  }

  function handleEdit(act) {
    const { count, extra } = periodsToForm(act.period, act.periods)
    setEditingId(act.id)
    setName(act.name)
    setSlotType(act.slot_type || 'assembly')
    setTargetGrades(classIdsToGradeLabels(act.class_ids))
    setFixedDay(act.day || 1)
    setFixedPeriod(act.period || 6)
    setPeriodCount(count)
    setExtraPeriods(extra)
    setClassTeachers(normalizeClassTeachers(act.class_teachers || {}))
    setShowForm(true)
  }

  function handleRemove(id) {
    updateFixtureData({ fixed_slots: activities.filter((a) => a.id !== id) })
  }

  function toggleGrade(label) {
    setTargetGrades((prev) =>
      prev.includes(label) ? prev.filter((g) => g !== label) : [...prev, label]
    )
  }

  return (
    <div className="card space-y-3">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <CalendarHeart className="w-5 h-5 text-purple-600" />
          <h3 className="font-bold text-gray-900">กิจกรรมพิเศษ (ล็อกสล็อต)</h3>
          <button
            onClick={() => setShowImportHelp((v) => !v)}
            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold
              text-purple-600 hover:bg-purple-50 transition-colors"
            title="ดูวิธีเตรียมไฟล์ Excel คาบพิเศษ"
          >
            <HelpCircle className="w-4 h-4" />
            วิธีใช้งาน
            <ChevronDown className={`w-3.5 h-3.5 transition-transform ${showImportHelp ? 'rotate-180' : ''}`} />
          </button>
        </div>
        {!showForm && (
          <div className="flex items-center gap-2 flex-wrap">
            <a
              href="/samples/ตัวอย่างคาบพิเศษ.xlsx"
              download
              className="btn-secondary flex items-center gap-1"
              title="ดาวน์โหลดไฟล์ Excel ตัวอย่างคาบพิเศษ — ผ่านการจัดตารางแล้ว ใช้เป็นแนวทางหรือแก้ไขเป็นกิจกรรมของโรงเรียนคุณ"
            >
              <Download className="w-4 h-4" />
              ไฟล์ตัวอย่าง
            </a>
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={importBusy}
              className="btn-secondary flex items-center gap-1 disabled:opacity-50"
              title="อัปโหลดไฟล์ Excel คาบพิเศษ — คอลัมน์: ชื่อกิจกรรม, ช่วงชั้น/ห้อง, วัน, คาบ, จำนวนคาบ, ครูผู้สอน, ตรึงคาบ"
            >
              <Upload className="w-4 h-4" />
              {importBusy ? 'กำลังอ่านไฟล์…' : 'อัปโหลดจาก Excel'}
            </button>
            <button
              onClick={() => setShowForm(true)}
              className="btn-secondary flex items-center gap-1"
            >
              <Plus className="w-4 h-4" />
              เพิ่มกิจกรรม
            </button>
          </div>
        )}
        <input
          ref={fileInputRef}
          type="file"
          accept=".xlsx"
          className="hidden"
          onChange={handleImportFile}
        />
      </div>

      {showImportHelp && (
        <div className="text-xs bg-purple-50/70 border border-purple-200 rounded-lg p-3 space-y-2.5">
          <p className="font-bold text-purple-800">
            วิธีเตรียมไฟล์ Excel คาบพิเศษ — 1 ชีท แถวแรกเป็นหัวคอลัมน์ (ระบบอ่านคอลัมน์ตามชื่อ ไม่สนลำดับ)
          </p>
          <div className="overflow-x-auto">
            <table className="min-w-full border border-purple-200 bg-white rounded">
              <thead className="bg-purple-100 text-purple-800">
                <tr>
                  <th className="px-2 py-1 text-left font-semibold">คอลัมน์</th>
                  <th className="px-2 py-1 text-left font-semibold whitespace-nowrap">จำเป็น</th>
                  <th className="px-2 py-1 text-left font-semibold">รูปแบบ + ตัวอย่าง</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-purple-100 text-gray-700">
                <tr><td className="px-2 py-1 font-medium">ชื่อกิจกรรม</td><td className="px-2 py-1 text-red-600">จำเป็น</td><td className="px-2 py-1">เช่น ลูกเสือ, บูรณาการ, ศักยภาพ, อาชีพ, โฮมรูม</td></tr>
                <tr><td className="px-2 py-1 font-medium">ช่วงชั้น/ห้อง</td><td className="px-2 py-1 text-gray-400">—</td><td className="px-2 py-1">ป.1,ป.2,ป.3 / ม.1-3 / ทุกห้อง (ว่าง = ทุกห้อง)</td></tr>
                <tr><td className="px-2 py-1 font-medium">วัน</td><td className="px-2 py-1 text-red-600">จำเป็น</td><td className="px-2 py-1">จันทร์–ศุกร์ หรือเลข 1–5 (จันทร์ = 1)</td></tr>
                <tr><td className="px-2 py-1 font-medium">คาบ</td><td className="px-2 py-1 text-red-600">จำเป็น</td><td className="px-2 py-1">คาบเดียว "6" / หลายคาบ "6,7" / ช่วง "5-7"</td></tr>
                <tr><td className="px-2 py-1 font-medium">จำนวนคาบ</td><td className="px-2 py-1 text-gray-400">—</td><td className="px-2 py-1">ใช้ขยายคาบอัตโนมัติ เช่น คาบ "6" + จำนวน 2 → ล็อกคาบ 6,7</td></tr>
                <tr><td className="px-2 py-1 font-medium">ครูผู้สอน</td><td className="px-2 py-1 text-gray-400">—</td><td className="px-2 py-1">หลายชื่อคั่นด้วยคอมม่า เช่น อ.สมชาย ใจดี, อ.สมหญิง รักเรียน</td></tr>
                <tr><td className="px-2 py-1 font-medium">ตรึงคาบ</td><td className="px-2 py-1 text-gray-400">—</td><td className="px-2 py-1">ว่าง/TRUE = ตรึง · FALSE = ข้ามแถว (ระบบรองรับเฉพาะกิจกรรมตรึงคาบ)</td></tr>
              </tbody>
            </table>
          </div>
          <ul className="list-disc pl-4 space-y-0.5 text-gray-600">
            <li>ชื่อชั้น/ชื่อครู ต้องตรงกับข้อมูลที่นำเข้าในขั้นตอนก่อนหน้า — ชื่อที่ไม่พบจะถูกข้าม พร้อมแจ้งเตือนในหน้าพรีวิว</li>
            <li>คาบพิเศษจะล็อกช่องในตาราง = ลดช่องว่างของห้อง — ถ้าห้องใช้คาบเต็มแล้ว ระบบจะเตือนก่อนบันทึก</li>
            <li>กิจกรรมที่คาบซ้ำกับกิจกรรมเดิมจะเตือนและบันทึกไม่ได้จนกว่าจะแก้</li>
            <li>ลองดาวน์โหลด "ไฟล์ตัวอย่าง" แล้วแก้ไขข้อมูลเป็นกิจกรรมของโรงเรียนคุณได้เลย</li>
          </ul>
        </div>
      )}

      {importNotice && (
        <div className="flex items-center justify-between gap-2 text-xs bg-green-50 border border-green-200 text-green-700 rounded-lg px-3 py-2">
          <span className="flex items-center gap-1.5">
            <Check className="w-3.5 h-3.5" /> {importNotice}
          </span>
          <button onClick={() => setImportNotice(null)} className="text-green-500 hover:text-green-700" aria-label="ปิด">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {activities.length === 0 && !showForm && (
        <p className="text-gray-400 text-center py-4">
          ยังไม่มีกิจกรรมพิเศษ — เพิ่มเองหรืออัปโหลดจาก Excel (กด "วิธีใช้งาน" เพื่อดูรูปแบบไฟล์ หรือโหลด "ไฟล์ตัวอย่าง" เป็นแนวทาง) เช่น ลูกเสือ, โฮมรูม, ชุมนุม
        </p>
      )}

      {showForm && (
        <div className="space-y-3 bg-purple-50/50 rounded-lg p-4 border border-purple-200">
          {/* Name + presets */}
          <div>
            <label className="font-medium text-gray-600 mb-1 block">ชื่อกิจกรรม</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="เช่น ลูกเสือ-เนตรนารี"
              className="w-full border border-gray-300 rounded-lg px-2 py-1.5"
            />
            <div className="flex gap-1.5 flex-wrap mt-2 items-center">
              {allPresets.map((p) => (
                <div key={p.name} className="relative group">
                  <button
                    onClick={() => { setName(p.name); setSlotType(p.slot_type) }}
                    className={`px-2 py-1 rounded-md border font-medium transition-colors
                      ${p.custom
                        ? 'bg-purple-50 border-purple-300 text-purple-700 hover:bg-purple-100'
                        : 'bg-white border-gray-200 hover:border-purple-400 hover:bg-purple-50'
                      }`}
                  >
                    {p.name}
                  </button>
                  {p.custom && (
                    <button
                      onClick={() => handleDeletePreset(p.name)}
                      className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-red-500 text-white
                        text-[10px] leading-none flex items-center justify-center opacity-0 group-hover:opacity-100
                        transition-opacity hover:bg-red-600"
                      title="ลบ preset"
                    >
                      ×
                    </button>
                  )}
                </div>
              ))}
              {canSaveAsPreset && (
                <button
                  onClick={handleSavePreset}
                  className="px-2 py-1 rounded-md bg-amber-50 border border-amber-300 text-amber-700
                    hover:bg-amber-100 font-medium text-xs flex items-center gap-1"
                  title="บันทึกชื่อนี้เป็น preset ให้ใช้ซ้ำ"
                >
                  <Star className="w-3 h-3" />
                  บันทึกเป็น preset
                </button>
              )}
            </div>
          </div>

          {/* Slot type selector */}
          <div>
            <label className="font-medium text-gray-600 mb-1 block">ประเภทกิจกรรม</label>
            <select
              value={slotType}
              onChange={(e) => setSlotType(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-2 py-1.5"
            >
              {SLOT_TYPES.map((s) => (
                <option key={s.value} value={s.value}>{s.label}</option>
              ))}
            </select>
          </div>

          {/* Target grades */}
          <div>
            <label className="font-medium text-gray-600 mb-1 block">
              ระดับชั้นที่เกี่ยวข้อง
              <span className="ml-1.5 text-xs font-normal text-gray-400">
                (ไม่เลือก = ทุกห้อง)
              </span>
            </label>
            <div className="flex gap-1 flex-wrap">
              {ALL_GRADE_LABELS.map((g) => (
                <button
                  key={g}
                  onClick={() => toggleGrade(g)}
                  className={`px-2 py-1 rounded-md font-medium border transition-all
                    ${targetGrades.includes(g)
                      ? 'bg-purple-600 text-white border-purple-600'
                      : 'bg-white text-gray-600 border-gray-200 hover:border-purple-300'
                    }`}
                >
                  {g}
                </button>
              ))}
            </div>
          </div>

          {/* ครูผู้ดูแลกิจกรรม (รายชั้น, N ครู/ห้อง) — นับเข้างานครู */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="font-medium text-gray-600 block">
                ครูผู้ดูแลรายชั้น
                <span className="ml-1.5 text-xs font-normal text-gray-400">
                  (หลายคน/ห้องได้ — ทุกคนนับภาระ 1 คาบ/สัปดาห์ ไม่คูณจำนวนห้อง; กันครูไม่ให้ถูกจัดคาบชน)
                </span>
              </label>
              <div className="flex items-center gap-1.5 shrink-0 ml-2">
                <button
                  type="button"
                  onClick={() => setShowAssignModal(true)}
                  disabled={targetClassesForTeachers().length === 0}
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-semibold
                    bg-emerald-600 text-white hover:bg-emerald-700 transition-colors disabled:opacity-40"
                >
                  <Users className="w-3.5 h-3.5" /> จัดสรรครู
                </button>
                {Object.keys(classTeachers).length > 0 && (
                  <button
                    type="button"
                    onClick={clearAllClassTeachers}
                    className="px-2 py-1 rounded-lg text-xs font-semibold text-red-500 border border-red-200 hover:bg-red-50 transition-colors"
                    title="ล้างครูผู้ดูแลทั้งหมดของกิจกรรมนี้"
                  >
                    ล้างทั้งหมด
                  </button>
                )}
              </div>
            </div>
            {targetClassesForTeachers().length === 0 ? (
              <p className="text-xs text-gray-400 italic">ยังไม่มีห้องเรียนในระบบ</p>
            ) : (
              <div>
                {/* สรุปต่อครู: ครูก → N ห้อง */}
                {Object.keys(classTeachers).length > 0 ? (
                  <div className="flex flex-wrap gap-1.5 mb-2">
                    {(() => {
                      const perTeacher = {}
                      for (const [cid, tids] of Object.entries(classTeachers)) {
                        for (const tid of tids) {
                          if (!perTeacher[tid]) perTeacher[tid] = []
                          perTeacher[tid].push(cid)
                        }
                      }
                      return Object.entries(perTeacher).map(([tid, cids]) => (
                        <span key={tid} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full
                          bg-emerald-50 border border-emerald-200 text-emerald-700 text-xs font-medium">
                          {teachers.find((t) => t.id === tid)?.name || tid}
                          <span className="text-[10px] text-emerald-500">({cids.length} ห้อง)</span>
                        </span>
                      ))
                    })()}
                  </div>
                ) : (
                  <p className="text-xs text-gray-400 italic mb-2">ยังไม่มีครูผู้ดูแล — กด "จัดสรรครู" เพื่อเลือกหลายห้องหลายชั้นพร้อมกัน</p>
                )}
                {/* สรุปรายห้องแบบ compact */}
                <div className="max-h-40 overflow-y-auto border border-gray-200 rounded-lg bg-white divide-y divide-gray-100">
                  {targetClassesForTeachers().map((c) => {
                    const tids = classTeachers[c.id] || []
                    return (
                      <div key={c.id} className="flex items-center gap-2 px-2 py-1">
                        <span className="text-sm text-gray-700 w-24 shrink-0">{c.name}</span>
                        {tids.length === 0 ? (
                          <span className="text-xs text-gray-300 italic">—</span>
                        ) : (
                          <div className="flex flex-wrap gap-1">
                            {tids.map((tid) => (
                              <span key={tid} className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full
                                bg-emerald-50 border border-emerald-200 text-emerald-700 text-xs">
                                {teachers.find((t) => t.id === tid)?.name || tid}
                                <button
                                  type="button"
                                  onClick={() => removeTeacherFromRoom(c.id, tid)}
                                  className="text-emerald-400 hover:text-red-500 transition-colors"
                                  title="ลบครูออกจากห้องนี้"
                                >
                                  ×
                                </button>
                              </span>
                            ))}
                          </div>
                        )}
                        <select
                          value=""
                          onChange={(e) => { if (e.target.value) addTeacherToRoom(c.id, e.target.value) }}
                          className="ml-auto shrink-0 border border-gray-300 rounded-lg px-1.5 py-0.5 text-xs"
                          title="เพิ่มครูเดี่ยวให้ห้องนี้"
                        >
                          <option value="">+ เพิ่มครูห้องนี้</option>
                          {teachers.map((t) => (
                            <option key={t.id} value={t.id}>{t.name}</option>
                          ))}
                        </select>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}
          </div>

          {/* Modal จัดสรรครูดูแลกิจกรรม */}
          <TeacherAssignmentModal
            isOpen={showAssignModal}
            onClose={() => setShowAssignModal(false)}
            classes={targetClassesForTeachers()}
            teachers={teachers}
            classTeachers={classTeachers}
            addTeachersToRooms={addTeachersToRooms}
            addTeacherToRoom={addTeacherToRoom}
            removeTeacherFromRoom={removeTeacherFromRoom}
          />

          {/* Day + Period(s) */}
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="font-medium text-gray-600 mb-1 block">วัน</label>
              <select
                value={fixedDay}
                onChange={(e) => setFixedDay(parseInt(e.target.value))}
                className="w-full border border-gray-300 rounded-lg px-2 py-1.5"
              >
                {DAY_NAMES.map((d, i) => (
                  <option key={i} value={i + 1}>{d}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="font-medium text-gray-600 mb-1 block">คาบเริ่ม</label>
              <input
                type="number" min="1" max="10"
                value={fixedPeriod}
                onChange={(e) => setFixedPeriod(parseInt(e.target.value) || 1)}
                className="w-full border border-gray-300 rounded-lg px-2 py-1.5"
              />
            </div>
            <div>
              <label className="font-medium text-gray-600 mb-1 block">จำนวนคาบติด</label>
              <input
                type="number" min="1" max="10"
                value={periodCount}
                onChange={(e) => setPeriodCount(Math.max(1, parseInt(e.target.value) || 1))}
                className="w-full border border-gray-300 rounded-lg px-2 py-1.5"
              />
            </div>
          </div>

          {/* Non-consecutive extra periods */}
          <div>
            <label className="font-medium text-gray-600 mb-1 block flex items-center gap-1.5">
              เพิ่มคาบเฉพาะ (ไม่ติดกัน)
              <span className="text-xs font-normal text-gray-400">— ติ๊กเพิ่มคาบอื่นในวันเดียวกัน</span>
            </label>
            <div className="flex gap-1 flex-wrap">
              {Array.from({ length: 10 }, (_, i) => i + 1).map((p) => {
                const inRange = p >= fixedPeriod && p < fixedPeriod + periodCount
                const isSelected = extraPeriods.includes(p)
                return (
                  <button
                    key={p}
                    type="button"
                    disabled={inRange}
                    onClick={() => {
                      setExtraPeriods((prev) =>
                        isSelected ? prev.filter((x) => x !== p) : [...prev, p].sort((a, b) => a - b)
                      )
                    }}
                    className={`px-2 py-1 rounded-md font-medium border transition-all
                      ${inRange
                        ? 'bg-gray-100 text-gray-300 border-gray-100 cursor-not-allowed'
                        : isSelected
                          ? 'bg-purple-600 text-white border-purple-600'
                          : 'bg-white text-gray-600 border-gray-200 hover:border-purple-300'
                      }`}
                  >
                    คาบ {p}
                  </button>
                )
              })}
            </div>
            <p className="text-xs text-gray-400 mt-1">
              กิจกรรมนี้จะล็อกทั้งหมด {getEffectivePeriods().length} คาบ: {formatPeriodsText(getEffectivePeriods())}
            </p>
          </div>

          {/* Duplicate warning */}
          {formConflicts.length > 0 && (
            <div className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2 space-y-0.5">
              <div className="font-bold flex items-center gap-1">
                <AlertTriangle className="w-3.5 h-3.5" /> คาบซ้ำกับกิจกรรมที่มีอยู่ — ยังบันทึกไม่ได้
              </div>
              <ul className="list-disc pl-5">
                {formConflicts.map((c, i) => (
                  <li key={i}>
                    {c.act.name} ({DAY_NAMES[(c.act.day || 1) - 1]} {formatPeriodsText(c.periods)})
                  </li>
                ))}
              </ul>
              <p>เปลี่ยนวัน/คาบ/ระดับชั้น หรือลบกิจกรรมเดิมก่อนบันทึก</p>
            </div>
          )}

          {/* Supervisor clash warning */}
          {supervisorConflictTeachers.length > 0 && (
            <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 space-y-0.5">
              <div className="font-bold flex items-center gap-1">
                <AlertTriangle className="w-3.5 h-3.5" /> ครูผู้ดูแลติดคาบกิจกรรมอื่นในเวลาเดียวกัน
              </div>
              <ul className="list-disc pl-5">
                {supervisorConflictTeachers.map((tid) => (
                  <li key={tid}>
                    {teachers.find((t) => t.id === tid)?.name || tid} ถูกเลือกดูแลกิจกรรมที่วัน/คาบซ้ำกับกิจกรรมเดิม —
                    ระบบจะกันครูคนนี้ไม่ให้สอนคาบนั้น และภาระงานจะนับซ้ำ
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Capacity warning: ห้องใช้คาบเต็มแล้ว */}
          {capacityWarnings.length > 0 && (
            <div className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2 space-y-0.5">
              <div className="font-bold flex items-center gap-1">
                <AlertTriangle className="w-3.5 h-3.5" /> ห้องต่อไปนี้ใช้คาบเต็มแล้ว — เพิ่มกิจกรรมนี้จะจัดตารางไม่ได้
              </div>
              <ul className="list-disc pl-5">
                {capacityWarnings.slice(0, 8).map((w) => (
                  <li key={w.classId}>
                    {w.className} — ต้องการ {w.needed} คาบ/สัปดาห์ แต่มีช่องเหลือ {w.available} (เกิน {w.overflow})
                  </li>
                ))}
              </ul>
              {capacityWarnings.length > 8 && (
                <p>และอีก {capacityWarnings.length - 8} ห้อง…</p>
              )}
              <p className="text-[11px] text-red-500">แนะนำ: ลดคาบวิชาใน Excel ก่อน หรืออย่าเพิ่มคาบพิเศษให้ห้องที่เต็ม (คาบพิเศษล็อกช่อง = ลดช่องว่างลงอีก)</p>
            </div>
          )}

          {/* Duplicate subject warning: วิชาใน Excel + คาบพิเศษ */}
          {subjectDuplicateWarning && (
            <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 space-y-0.5">
              <div className="font-bold flex items-center gap-1">
                <AlertTriangle className="w-3.5 h-3.5" /> วิชา "{subjectDuplicateWarning}" มีอยู่ในรายวิชา (Excel) แล้ว
              </div>
              <p>
                การเพิ่มคาบพิเศษนี้จะนับแยกจากคาบเรียนใน Excel (คาบเรียนยังต้องวาง + คาบนี้ล็อกช่องเพิ่ม) —
                ถ้าไม่ใช่เจตนาให้มีทั้ง 2 อย่าง กรุณาลบออกข้างใดข้างหนึ่ง เพื่อกันห้องใช้คาบเกิน
              </p>
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-2">
            <button
              onClick={handleSave}
              disabled={!name.trim() || formConflicts.length > 0}
              className="btn-primary flex items-center gap-1 disabled:opacity-40"
              title={formConflicts.length > 0 ? 'คาบซ้ำกับกิจกรรมเดิม — แก้ก่อนบันทึก' : undefined}
            >
              <Check className="w-4 h-4" />
              {editingId ? 'บันทึก' : 'เพิ่มกิจกรรม'}
            </button>
            <button onClick={resetForm} className="btn-secondary">
              ยกเลิก
            </button>
          </div>
        </div>
      )}

      {/* Activity list */}
      {activities.length > 0 && (
        <div className="space-y-2">
          {activities.map((act) => {
            const grades = classIdsToGradeLabels(act.class_ids)
            const conflicts = listConflicts[act.id] || []
            return (
              <div key={act.id} className="flex items-center justify-between bg-gray-50 rounded-lg px-3 py-2 border border-gray-200">
                <div className="flex items-center gap-3 flex-wrap">
                  <div className="font-bold text-gray-900">{act.name}</div>
                  <span className="px-1.5 py-0.5 rounded bg-purple-100 text-purple-700 font-medium text-xs">
                    {SLOT_TYPE_LABELS[act.slot_type] || act.slot_type}
                  </span>
                  <div className="text-gray-500">
                    {DAY_NAMES[(act.day || 1) - 1]} {formatPeriodsText([act.period, ...(act.periods || [])])}
                  </div>
                  {conflicts.length > 0 && (
                    <span
                      className="px-1.5 py-0.5 rounded bg-red-100 text-red-700 font-medium text-[10px]"
                      title={conflicts.map((c) => `${c.act.name} (${DAY_NAMES[(c.act.day || 1) - 1]} ${formatPeriodsText(c.periods)})`).join(', ')}
                    >
                      ⚠ ซ้ำกับ {conflicts.map((c) => c.act.name).join(', ')}
                    </span>
                  )}
                  {grades.length > 0 ? (
                    <div className="flex gap-1">
                      {grades.map((g) => (
                        <span key={g} className="px-1.5 py-0.5 rounded bg-purple-100 text-purple-700 font-medium">
                          {g}
                        </span>
                      ))}
                    </div>
                  ) : (
                    <span className="px-1.5 py-0.5 rounded bg-gray-200 text-gray-600 font-medium text-xs">
                      ทุกห้อง
                    </span>
                  )}
                  {/* ครูผู้ดูแลรายชั้น (N ครู/ห้อง) */}
                  {Object.keys(act.class_teachers || {}).length > 0 && (
                    (() => {
                      const ct = normalizeClassTeachers(act.class_teachers || {})
                      const roomCount = Object.keys(ct).length
                      const teacherCount = new Set(Object.values(ct).flat()).size
                      const tooltip = Object.entries(ct)
                        .map(([cid, tids]) =>
                          `${classes.find((c) => c.id === cid)?.name || cid}: ${tids.map((t) => teachers.find((x) => x.id === t)?.name || t).join(', ')}`
                        )
                        .join('\n')
                      return (
                        <span
                          className="px-1.5 py-0.5 rounded bg-emerald-50 border border-emerald-200 text-emerald-700 font-medium text-[10px]"
                          title={tooltip}
                        >
                          ดูแล {roomCount} ชั้น · {teacherCount} ครู (1 คาบ/ครู/สัปดาห์)
                        </span>
                      )
                    })()
                  )}
                </div>
                <div className="flex gap-1">
                  <button onClick={() => handleEdit(act)} className="text-gray-400 hover:text-blue-600">
                    <Edit2 className="w-4 h-4" />
                  </button>
                  <button onClick={() => handleRemove(act.id)} className="text-gray-400 hover:text-red-600">
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Import Preview Modal */}
      {importPreview && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setImportPreview(null)} />
          <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[85vh] overflow-y-auto">
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200 sticky top-0 bg-white rounded-t-2xl z-10">
              <div className="flex items-center gap-2">
                <FileSpreadsheet className="w-5 h-5 text-purple-600" />
                <h3 className="text-lg font-bold text-gray-900">นำเข้าคาบพิเศษจาก Excel</h3>
                <span className="text-xs text-gray-400 truncate max-w-[200px]">{importPreview.fileName}</span>
              </div>
              <button onClick={() => setImportPreview(null)} className="p-1.5 rounded-lg text-gray-400 hover:bg-gray-100 hover:text-gray-600" aria-label="ปิด">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="px-5 py-4 space-y-4">
              {importPreview.error ? (
                <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2 flex items-start gap-2">
                  <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
                  <div>{importPreview.warnings[0]}</div>
                </div>
              ) : (
                <>
                  {/* Preview table */}
                  {importPreview.slots.length > 0 ? (
                    <div className="overflow-x-auto border border-gray-200 rounded-lg">
                      <table className="min-w-full text-xs">
                        <thead className="bg-gray-50">
                          <tr>
                            <th className="px-3 py-2 text-left font-semibold text-gray-600">กิจกรรม</th>
                            <th className="px-3 py-2 text-left font-semibold text-gray-600">ประเภท</th>
                            <th className="px-3 py-2 text-left font-semibold text-gray-600">ชั้น</th>
                            <th className="px-3 py-2 text-left font-semibold text-gray-600">วัน</th>
                            <th className="px-3 py-2 text-left font-semibold text-gray-600">คาบ</th>
                            <th className="px-3 py-2 text-left font-semibold text-gray-600">ครูดูแล</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                          {importPreview.slots.map((s) => {
                            const gradeLabels = classIdsToGradeLabels(s.class_ids)
                            const teacherCount = new Set(Object.values(s.class_teachers || {}).flat()).size
                            return (
                              <tr key={s.id} className="hover:bg-gray-50">
                                <td className="px-3 py-2 font-medium text-gray-900">{s.name}</td>
                                <td className="px-3 py-2 text-gray-600">{SLOT_TYPE_LABELS[s.slot_type] || s.slot_type}</td>
                                <td className="px-3 py-2">
                                  {gradeLabels.length > 0 ? (
                                    <span className="text-purple-700">{gradeLabels.join(', ')}</span>
                                  ) : (
                                    <span className="text-gray-500">ทุกห้อง</span>
                                  )}
                                </td>
                                <td className="px-3 py-2 text-gray-600">{DAY_NAMES[(s.day || 1) - 1]}</td>
                                <td className="px-3 py-2 text-gray-600">
                                  {formatPeriodsText([s.period, ...(s.periods || [])])}
                                </td>
                                <td className="px-3 py-2 text-emerald-700">
                                  {teacherCount > 0 ? `${teacherCount} คน` : '—'}
                                </td>
                              </tr>
                            )
                          })}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <p className="text-sm text-gray-500 text-center py-4">ไม่มีกิจกรรมที่นำเข้าได้</p>
                  )}

                  {/* Warnings */}
                  {importPreview.warnings.length > 0 && (
                    <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 space-y-0.5">
                      <div className="font-bold flex items-center gap-1">
                        <AlertTriangle className="w-3.5 h-3.5" /> คำเตือน ({importPreview.warnings.length})
                      </div>
                      <ul className="list-disc pl-5 space-y-0.5 max-h-32 overflow-y-auto">
                        {importPreview.warnings.map((w, i) => (
                          <li key={i}>{w}</li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {/* Actions */}
                  <div className="flex items-center gap-2">
                    <button
                      onClick={confirmImport}
                      disabled={importPreview.slots.length === 0}
                      className="btn-primary flex items-center gap-1.5 disabled:opacity-40"
                    >
                      <Check className="w-4 h-4" />
                      นำเข้า {importPreview.slots.length} กิจกรรม
                    </button>
                    <button onClick={() => setImportPreview(null)} className="btn-secondary">
                      ยกเลิก
                    </button>
                    <span className="ml-auto text-xs text-gray-400">
                      {importPreview.slots.length}/{importPreview.totalRows} แถวนำเข้าได้
                    </span>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

/* ═══════════════════════════ Modal จัดสรรครูดูแลกิจกรรม ═══════════════════════════
 * 4 ขั้นตอน: A) เลือกห้อง/ชั้น  B) ค้นหา/ติ๊กครูหลายคน  C) เพิ่ม batch
 *            D) ตารางปรับรายห้อง (badge × ลบ + เพิ่มเดี่ยว)
 * ครูทุกคนที่เข้าร่วมกิจกรรมนี้ นับภาระ 1 คาบ/สัปดาห์ (ไม่คูณจำนวนห้อง)
 */
function TeacherAssignmentModal({
  isOpen,
  onClose,
  classes,          // ห้องที่อยู่ในขอบเขตกิจกรรมนี้
  teachers,         // ครูทั้งหมด
  classTeachers,    // { [class_id]: string[] } — ปัจจุบัน
  addTeachersToRooms,
  addTeacherToRoom,
  removeTeacherFromRoom,
}) {
  const [selectedRooms, setSelectedRooms] = useState(() => new Set())
  const [selectedTeachers, setSelectedTeachers] = useState(() => new Set())
  const [search, setSearch] = useState('')
  const [typeFilter, setTypeFilter] = useState('all')

  // เปิด modal → เลือกห้องทั้งหมดในขอบเขตเป็นค่าเริ่มต้น
  useEffect(() => {
    if (isOpen) {
      setSelectedRooms(new Set(classes.map((c) => c.id)))
      setSelectedTeachers(new Set())
      setSearch('')
      setTypeFilter('all')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen])

  const gradeGroups = useMemo(() => {
    const map = {}
    for (const c of classes) {
      if (!map[c.grade_level]) map[c.grade_level] = []
      map[c.grade_level].push(c)
    }
    return Object.entries(map).sort((a, b) => Number(a[0]) - Number(b[0]))
  }, [classes])

  if (!isOpen) return null

  const filteredTeachers = teachers.filter((t) => {
    if (typeFilter !== 'all' && t.teacher_type !== typeFilter) return false
    const q = search.trim().toLowerCase()
    if (q && !(t.name || '').toLowerCase().includes(q) && !(t.id || '').toLowerCase().includes(q)) return false
    return true
  })

  const toggleRoom = (id) => {
    setSelectedRooms((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }
  const toggleGrade = (gradeClasses) => {
    const ids = gradeClasses.map((c) => c.id)
    const allSelected = ids.every((id) => selectedRooms.has(id))
    setSelectedRooms((prev) => {
      const next = new Set(prev)
      for (const id of ids) {
        if (allSelected) next.delete(id)
        else next.add(id)
      }
      return next
    })
  }
  const toggleTeacher = (id) => {
    setSelectedTeachers((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }
  const handleBulkAdd = () => {
    if (selectedTeachers.size === 0 || selectedRooms.size === 0) return
    addTeachersToRooms([...selectedTeachers], [...selectedRooms])
    setSelectedTeachers(new Set())
  }

  const selectedRoomCount = selectedRooms.size
  const selectedTeacherCount = selectedTeachers.size
  const teacherTypeOptions = [
    { value: 'all', label: 'ทุกประเภท' },
    { value: 'regular', label: 'ครูประจำ' },
    { value: 'special', label: 'ครูพิเศษ' },
    { value: 'foreign', label: 'ครูต่างชาติ' },
    { value: 'trainee', label: 'นศ.ฝึกสอน' },
  ]

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[88vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200 sticky top-0 bg-white rounded-t-2xl z-10">
          <div className="flex items-center gap-2">
            <Users className="w-5 h-5 text-emerald-600" />
            <h3 className="text-lg font-bold text-gray-900">จัดสรรครูดูแลกิจกรรม</h3>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg text-gray-400 hover:bg-gray-100 hover:text-gray-600" aria-label="ปิด">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="px-5 py-4 space-y-5">
          {/* A. เลือกห้อง/ชั้น */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <div className="text-sm font-bold text-gray-700">
                1. เลือกห้อง / ชั้น
                <span className="ml-2 text-xs font-normal text-gray-400">({selectedRoomCount}/{classes.length} ห้อง)</span>
              </div>
              <div className="flex gap-1.5">
                <button onClick={() => setSelectedRooms(new Set(classes.map((c) => c.id)))} className="px-2 py-0.5 rounded-md text-xs font-semibold bg-blue-50 text-blue-700 hover:bg-blue-100 transition-colors">
                  เลือกทั้งหมด
                </button>
                <button onClick={() => setSelectedRooms(new Set())} className="px-2 py-0.5 rounded-md text-xs font-semibold bg-gray-100 text-gray-600 hover:bg-gray-200 transition-colors">
                  ล้าง
                </button>
              </div>
            </div>
            <div className="space-y-1.5 max-h-44 overflow-y-auto border border-gray-200 rounded-lg p-2">
              {gradeGroups.map(([grade, gradeClasses]) => {
                const allSelected = gradeClasses.every((c) => selectedRooms.has(c.id))
                return (
                  <div key={grade}>
                    <div className="flex items-center gap-1.5 mb-1">
                      <button
                        onClick={() => toggleGrade(gradeClasses)}
                        className={`px-2 py-0.5 rounded-md text-[11px] font-bold transition-colors
                          ${allSelected ? 'bg-blue-600 text-white' : 'bg-blue-50 text-blue-700 hover:bg-blue-100'}`}
                      >
                        ป.{grade} ทั้งหมด
                      </button>
                    </div>
                    <div className="flex flex-wrap gap-1 pl-1">
                      {gradeClasses.map((c) => (
                        <button
                          key={c.id}
                          onClick={() => toggleRoom(c.id)}
                          className={`px-2 py-0.5 rounded-md text-xs font-medium border transition-all
                            ${selectedRooms.has(c.id)
                              ? 'bg-blue-600 text-white border-blue-600'
                              : 'bg-white text-gray-600 border-gray-200 hover:border-blue-300'}`}
                        >
                          {c.name}
                        </button>
                      ))}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>

          {/* B + C. ติ๊กครูหลายคน → เพิ่ม batch */}
          <div>
            <div className="text-sm font-bold text-gray-700 mb-1.5">
              2. เลือกครู (หลายคนได้) → เพิ่มให้ห้องที่เลือกพร้อมกัน
            </div>
            <div className="flex gap-2 mb-2">
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="ค้นหาชื่อครู / รหัสครู…"
                className="flex-1 border border-gray-300 rounded-lg px-2 py-1.5 text-sm"
              />
              <select
                value={typeFilter}
                onChange={(e) => setTypeFilter(e.target.value)}
                className="border border-gray-300 rounded-lg px-2 py-1.5 text-sm"
              >
                {teacherTypeOptions.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </div>
            <div className="max-h-44 overflow-y-auto border border-gray-200 rounded-lg divide-y divide-gray-100">
              {filteredTeachers.length === 0 && (
                <div className="px-3 py-4 text-xs text-gray-400 italic text-center">ไม่พบครูที่ตรงเงื่อนไข</div>
              )}
              {filteredTeachers.map((t) => {
                const on = selectedTeachers.has(t.id)
                return (
                  <label key={t.id} className={`flex items-center gap-2 px-3 py-1.5 cursor-pointer transition-colors ${on ? 'bg-emerald-50' : 'hover:bg-gray-50'}`}>
                    <input
                      type="checkbox"
                      checked={on}
                      onChange={() => toggleTeacher(t.id)}
                      className="w-4 h-4 rounded text-emerald-600"
                    />
                    <span className="text-sm font-medium text-gray-800">{t.name}</span>
                    <span className="ml-auto text-[10px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-500">
                      {teacherTypeOptions.find((o) => o.value === t.teacher_type)?.label || t.teacher_type || 'ครู'}
                    </span>
                  </label>
                )
              })}
            </div>
            <button
              onClick={handleBulkAdd}
              disabled={selectedTeachers.size === 0 || selectedRooms.size === 0}
              className="mt-2 w-full px-4 py-2.5 rounded-lg text-sm font-bold text-white bg-emerald-600 hover:bg-emerald-700
                transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              เพิ่มครู {selectedTeacherCount} คนที่เลือก ให้กับ {selectedRoomCount} ห้องที่เลือกพร้อมกัน
            </button>
            <p className="text-[11px] text-gray-400 mt-1.5">
              * ครูทุกคนที่เข้าร่วมกิจกรรมนี้ นับภาระ <b>1 คาบ/สัปดาห์</b> (ไม่คูณจำนวนห้อง) — เพิ่มซ้ำจะไม่ซ้ำกัน
            </p>
          </div>

          {/* D. ตารางปรับรายห้อง */}
          <div>
            <div className="text-sm font-bold text-gray-700 mb-1.5">3. ปรับรายห้อง (เพิ่ม/ลบครูเดี่ยว)</div>
            <div className="max-h-56 overflow-y-auto border border-gray-200 rounded-lg divide-y divide-gray-100">
              {classes.map((c) => {
                const tids = normalizeClassTeachers(classTeachers)[c.id] || []
                return (
                  <div key={c.id} className="flex items-center gap-2 px-3 py-1.5">
                    <span className="text-sm text-gray-700 w-24 shrink-0">{c.name}</span>
                    {tids.length === 0 ? (
                      <span className="text-xs text-gray-300 italic">— ไม่มีครูผู้ดูแล —</span>
                    ) : (
                      <div className="flex flex-wrap gap-1">
                        {tids.map((tid) => (
                          <span key={tid} className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full
                            bg-emerald-50 border border-emerald-200 text-emerald-700 text-xs">
                            {teachers.find((t) => t.id === tid)?.name || tid}
                            <button
                              type="button"
                              onClick={() => removeTeacherFromRoom(c.id, tid)}
                              className="text-emerald-400 hover:text-red-500 transition-colors"
                              title="ลบครูออกจากห้องนี้"
                            >
                              ×
                            </button>
                          </span>
                        ))}
                      </div>
                    )}
                    <select
                      value=""
                      onChange={(e) => { if (e.target.value) addTeacherToRoom(c.id, e.target.value) }}
                      className="ml-auto shrink-0 border border-gray-300 rounded-lg px-1.5 py-0.5 text-xs"
                      title="เพิ่มครูเดี่ยวให้ห้องนี้"
                    >
                      <option value="">+ เพิ่มครูห้องนี้</option>
                      {teachers.map((t) => (
                        <option key={t.id} value={t.id}>{t.name}</option>
                      ))}
                    </select>
                  </div>
                )
              })}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-gray-200 sticky bottom-0 bg-white rounded-b-2xl">
          <button
            onClick={onClose}
            className="w-full px-4 py-2.5 text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-xl transition-colors"
          >
            เสร็จสิ้น (บันทึกเมื่อกด "เพิ่มกิจกรรม/บันทึก" ในฟอร์ม)
          </button>
        </div>
      </div>
    </div>
  )
}
