import { useState, useMemo, useEffect, Fragment } from 'react'
import {
  Plus, Trash2, ArrowRight, ArrowLeft, Clock, Layers, BookOpen, Coffee,
  UtensilsCrossed, X, Check, ChevronDown, ZoomIn, ZoomOut, Edit2, CalendarHeart, Star, Calendar,
} from 'lucide-react'
import { useApp } from '../context/AppContext.jsx'
import { generatePeriods, createDefaultBlock, buildClassBlockMap, insertBreakPeriod } from '../utils/periods.js'
import { getRoomTypeColor, isSpecialRoomType } from '../utils/roomTypes.js'

const PERIOD_TYPE_CONFIG = {
  STUDY: { label: 'คาบเรียน', icon: BookOpen, color: 'bg-blue-100 text-blue-700 border-blue-300' },
  LUNCH: { label: 'พักเที่ยง', icon: UtensilsCrossed, color: 'bg-orange-100 text-orange-700 border-orange-300' },
  BREAK: { label: 'พัก', icon: Coffee, color: 'bg-gray-100 text-gray-600 border-gray-300' },
}

const DAY_NAMES = ['จันทร์', 'อังคาร', 'พุธ', 'พฤหัสบดี', 'ศุกร์', 'เสาร์']

function recalculateTimes(periods, startTime, periodDuration, breakDuration, lunchDuration) {
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
    if (p.type === 'STUDY' && i < periods.length - 1) {
      const next = periods[i + 1]
      if (next.type === 'STUDY') {
        currentMin += breakDuration
      }
    }
  }
  return result
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
    updateFixtureData({ schedule_blocks: [...scheduleBlocks, newBlock] })
    setActiveBlockId(newId)
  }

  function updateBlock(blockId, updates) {
    const updated = scheduleBlocks.map((b) =>
      b.id === blockId ? { ...b, ...updates } : b
    )
    updateFixtureData({ schedule_blocks: updated })
  }

  function removeBlock(blockId) {
    const idx = scheduleBlocks.findIndex((b) => b.id === blockId)
    const remaining = scheduleBlocks.filter((b) => b.id !== blockId)
    updateFixtureData({ schedule_blocks: remaining })
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
      periods, block.start_time, block.period_duration_mins, block.break_duration_mins, block.lunch_duration_mins
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

    // Build new period list: study periods + 1 lunch inserted at the right position
    const newPeriods = []
    let periodNo = 1
    let studyPlaced = 0
    const lunchAfter = Math.min(studiesBeforeLunch, studyCount)

    for (let i = 0; i < studyCount + 1; i++) {
      if (i === lunchAfter) {
        newPeriods.push({ period_no: periodNo++, start_time: '00:00', end_time: '00:00', type: 'LUNCH' })
      }
      if (studyPlaced < studyCount) {
        newPeriods.push({ period_no: periodNo++, start_time: '00:00', end_time: '00:00', type: 'STUDY' })
        studyPlaced++
      }
    }

    if (usePerDay) {
      const newByDay = {}
      for (const d of days) {
        newByDay[String(d)] = recalculateTimes(
          newPeriods, block.start_time, block.period_duration_mins, block.break_duration_mins, block.lunch_duration_mins
        )
      }
      onUpdate({ periods_by_day: newByDay })
    } else {
      onUpdate({
        periods: recalculateTimes(newPeriods, block.start_time, block.period_duration_mins, block.break_duration_mins, block.lunch_duration_mins)
      })
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
          newBlock.lunch_duration_mins || block.lunch_duration_mins
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
          <label className="font-medium text-gray-600 mb-1 flex items-center gap-1">
            <BookOpen className="w-3.5 h-3.5 text-blue-600" />
            คาบเรียน (คาบ)
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
          />
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
              const gradeLabel = gradeNum <= 0 ? `อ.${Math.abs(gradeNum - 1)}` : gradeNum <= 6 ? `ป.${gradeNum}` : `ม.${gradeNum - 6}`
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

function SpecialActivitiesSection() {
  const { fixtureData, updateFixtureData } = useApp()
  const activities = fixtureData?.fixed_slots || []
  const classes = fixtureData?.classes || []
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState(null)
  const [customPresets, setCustomPresets] = useState(() => loadCustomPresets())

  // Form state
  const [name, setName] = useState('')
  const [slotType, setSlotType] = useState('assembly')
  const [targetGrades, setTargetGrades] = useState([])
  const [fixedDay, setFixedDay] = useState(1)
  const [fixedPeriod, setFixedPeriod] = useState(6)

  // Merge built-in + custom presets (custom first so they're easy to find)
  const allPresets = [...customPresets, ...ACTIVITY_PRESETS]
  const existingPresetNames = new Set(allPresets.map((p) => p.name))
  const canSaveAsPreset = name.trim() && !existingPresetNames.has(name.trim())

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
    setEditingId(null)
    setShowForm(false)
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
    const slot = {
      id: editingId || `FS_${Date.now()}`,
      name: name.trim(),
      slot_type: slotType,
      day: fixedDay,
      period: fixedPeriod,
      class_ids: gradesToClassIds(targetGrades),
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
    setEditingId(act.id)
    setName(act.name)
    setSlotType(act.slot_type || 'assembly')
    setTargetGrades(classIdsToGradeLabels(act.class_ids))
    setFixedDay(act.day || 1)
    setFixedPeriod(act.period || 6)
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
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <CalendarHeart className="w-5 h-5 text-purple-600" />
          <h3 className="font-bold text-gray-900">กิจกรรมพิเศษ (ล็อกสล็อต)</h3>
        </div>
        {!showForm && (
          <button
            onClick={() => setShowForm(true)}
            className="btn-secondary flex items-center gap-1"
          >
            <Plus className="w-4 h-4" />
            เพิ่มกิจกรรม
          </button>
        )}
      </div>

      {activities.length === 0 && !showForm && (
        <p className="text-gray-400 text-center py-4">
          ยังไม่มีกิจกรรมพิเศษ — เพิ่มได้ถ้าต้องการล็อกสล็อตกิจกรรม เช่น ลูกเสือ, โฮมรูม, ชุมนุม
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

          {/* Day + Period */}
          <div className="grid grid-cols-2 gap-3">
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
              <label className="font-medium text-gray-600 mb-1 block">คาบที่</label>
              <input
                type="number" min="1" max="10"
                value={fixedPeriod}
                onChange={(e) => setFixedPeriod(parseInt(e.target.value) || 1)}
                className="w-full border border-gray-300 rounded-lg px-2 py-1.5"
              />
            </div>
          </div>

          {/* Actions */}
          <div className="flex gap-2">
            <button
              onClick={handleSave}
              disabled={!name.trim()}
              className="btn-primary flex items-center gap-1 disabled:opacity-40"
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
            return (
              <div key={act.id} className="flex items-center justify-between bg-gray-50 rounded-lg px-3 py-2 border border-gray-200">
                <div className="flex items-center gap-3 flex-wrap">
                  <div className="font-bold text-gray-900">{act.name}</div>
                  <span className="px-1.5 py-0.5 rounded bg-purple-100 text-purple-700 font-medium text-xs">
                    {SLOT_TYPE_LABELS[act.slot_type] || act.slot_type}
                  </span>
                  <div className="text-gray-500">
                    {DAY_NAMES[(act.day || 1) - 1]} คาบที่ {act.period}
                  </div>
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
    </div>
  )
}
