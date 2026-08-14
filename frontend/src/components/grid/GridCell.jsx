import { useState } from 'react'
import { getSubjectColor } from '../../utils/subjectColors.js'

// Class-based colors for teacher mode (different classes get different colors)
const CLASS_COLORS = [
  { bg: 'bg-blue-100',    border: 'border-blue-400',    text: 'text-blue-800' },
  { bg: 'bg-rose-100',    border: 'border-rose-400',    text: 'text-rose-800' },
  { bg: 'bg-teal-100',    border: 'border-teal-400',    text: 'text-teal-800' },
  { bg: 'bg-amber-100',   border: 'border-amber-400',   text: 'text-amber-800' },
  { bg: 'bg-purple-100',  border: 'border-purple-400',  text: 'text-purple-800' },
  { bg: 'bg-cyan-100',    border: 'border-cyan-400',    text: 'text-cyan-800' },
  { bg: 'bg-orange-100',  border: 'border-orange-400',  text: 'text-orange-800' },
  { bg: 'bg-green-100',   border: 'border-green-400',   text: 'text-green-800' },
  { bg: 'bg-pink-100',    border: 'border-pink-400',    text: 'text-pink-800' },
  { bg: 'bg-indigo-100',  border: 'border-indigo-400',  text: 'text-indigo-800' },
  { bg: 'bg-lime-100',    border: 'border-lime-400',    text: 'text-lime-800' },
  { bg: 'bg-violet-100',  border: 'border-violet-400',  text: 'text-violet-800' },
]

export function getClassColors(classId, classColorMap) {
  if (!classId) return CLASS_COLORS[0]
  const idx = classColorMap?.[classId]
  if (idx != null) return CLASS_COLORS[idx % CLASS_COLORS.length]
  return CLASS_COLORS[0]
}

export default function GridCell({
  slot,
  slots,
  subject,
  teacher,
  classGroup,
  classColorMap,
  colorMode = 'subject',
  isLunch,
  isFixed,          // 🔒 locked fixed slot (assembly/homeroom/etc.) — not draggable
  isPreAssigned,    // 📌 user manually placed — not draggable by solver
  fixedSlotName,    // name to display for fixed slots (e.g. "โฮมรูม")
  isDragTarget,
  dragTargetInfo,   // { valid, reason } from TimetableGrid validation
  isDraggable,
  conflicts = [],
  onDragStart,
  onDragEnd,
  onDragOver,
  onDrop,
}) {
  const [showTooltip, setShowTooltip] = useState(false)

  // ── Lunch break cell ──────────────────────────────────────────────
  if (isLunch) {
    return (
      <div className="bg-gray-100 border border-gray-200 rounded-lg p-2 min-h-[80px] flex items-center justify-center">
        <span className="text-sm font-semibold text-gray-400">พักเที่ยง</span>
      </div>
    )
  }

  // ── Fixed slot (🔒 locked activity) ───────────────────────────────
  if (isFixed) {
    return (
      <div
        className="bg-gray-200 border-2 border-gray-400 border-dashed rounded-lg p-2 min-h-[80px] flex flex-col items-center justify-center cursor-not-allowed"
        onDragOver={(e) => e.preventDefault()} // block drops on fixed slots
      >
        <div className="text-xs sm:text-sm font-bold text-gray-600 truncate w-full text-center">
          {fixedSlotName || 'บล็อกกิจกรรม'}
        </div>
        <span className="mt-1 inline-flex items-center gap-0.5 text-[10px] font-semibold text-gray-500 bg-gray-300 rounded-full px-2 py-0.5">
          🔒 บล็อกกิจกรรม
        </span>
      </div>
    )
  }

  // ── Multi-slot mode (teacher view): multiple class entries in one cell ──
  if (slots && slots.length > 0) {
    return (
      <div
        onDragOver={onDragOver}
        onDrop={onDrop}
        onMouseEnter={() => setShowTooltip(true)}
        onMouseLeave={() => setShowTooltip(false)}
        className={`bg-white border rounded-lg p-1.5 min-h-[80px] flex flex-col transition-all overflow-hidden
          ${isDragTarget ? 'border-green-400 bg-green-50 border-2' : 'border-gray-200'}`}
      >
        <div className="flex-1 flex flex-col gap-0.5 min-h-0">
          {slots.map((s, i) => {
            const sColors = colorMode === 'class'
              ? getClassColors(s.class_id, classColorMap)
              : getSubjectColor(s.subjectName || s.subject_id, s.subjectCategory)
            return (
              <div
                key={i}
                draggable={isDraggable}
                onDragStart={(e) => onDragStart?.(e, s)}
                onDragEnd={onDragEnd}
                className={`${sColors.bg} ${sColors.border} border rounded px-1.5 py-0.5 cursor-grab hover:shadow-sm transition-all flex-1 flex items-center min-h-0`}
              >
                <div className={`text-xs sm:text-sm font-bold ${sColors.text} truncate w-full`}>
                  {s.className || s.class_id} · {s.subjectName || s.subject_id}
                </div>
              </div>
            )
          })}
        </div>
        {showTooltip && slots.length > 0 && (
          <div className="absolute z-20 bottom-full left-1/2 -translate-x-1/2 mb-1
            bg-gray-900 text-white text-xs rounded-lg px-3 py-2 whitespace-nowrap shadow-lg
            pointer-events-none">
            {slots.map((s, i) => (
              <div key={i}>{s.className || s.class_id} · {s.subjectName || s.subject_id}</div>
            ))}
          </div>
        )}
      </div>
    )
  }

  // ── Empty cell (drop target for sidebar drag) ─────────────────────
  if (!slot) {
    const isBlocked = isDragTarget && dragTargetInfo?.valid === false
    const isValid = isDragTarget && !isBlocked
    return (
      <div
        className={`bg-white border rounded-lg p-2 min-h-[80px] transition-colors relative
          ${isValid
            ? 'border-emerald-500 bg-emerald-50 border-2 border-dashed'
            : isBlocked
              ? 'border-amber-500 bg-amber-50 border-2'
              : 'border-gray-100 hover:border-gray-300'}`}
        onDragOver={onDragOver}
        onDrop={onDrop}
      >
        {isValid && (
          <div className="absolute inset-0 flex items-center justify-center p-1 pointer-events-none">
            <span className="text-[11px] text-emerald-700 font-semibold text-center leading-tight">
              วางในคาบนี้
            </span>
          </div>
        )}
        {isBlocked && (
          <div className="absolute inset-0 flex items-center justify-center p-1 pointer-events-none">
            <span className="text-[10px] text-amber-700 font-medium text-center leading-tight">
              ⚠️ {dragTargetInfo?.reason}
            </span>
          </div>
        )}
      </div>
    )
  }

  // ── Filled cell (solver-placed or user pre-assigned) ──────────────
  const category = subject?.category || 'core'
  const subjColors = getSubjectColor(subject?.name || slot.subject_id, category)
  const clsColors = getClassColors(classGroup?.id || slot.class_id, classColorMap)
  const colors = colorMode === 'class' ? clsColors : subjColors
  const hasConflict = conflicts.length > 0
  const showPreAssignedBadge = isPreAssigned
  const isBlockedTarget = isDragTarget && dragTargetInfo?.valid === false

  return (
    <div
      draggable={isDraggable && !isPreAssigned}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragOver={onDragOver}
      onDrop={onDrop}
      onMouseEnter={() => setShowTooltip(true)}
      onMouseLeave={() => setShowTooltip(false)}
      className={`relative ${colors.bg} ${colors.border} border rounded-lg p-2 min-h-[80px] transition-all
        ${isDraggable && !isPreAssigned ? 'cursor-grab hover:shadow-md' : 'cursor-default'}
        ${isDragTarget && !isBlockedTarget ? 'ring-2 ring-emerald-500 ring-offset-1' : ''}
        ${isBlockedTarget ? 'ring-2 ring-amber-500 ring-offset-1' : ''}
        ${hasConflict ? 'ring-2 ring-red-400' : ''}`}
    >
      <div className={`text-base sm:text-lg font-bold leading-tight ${colors.text} truncate`}>
        {subject?.name || slot.subject_id}
        {hasConflict && <span className="ml-1 text-red-500">⚠</span>}
      </div>
      <div className="text-xs sm:text-sm font-semibold text-slate-600 truncate mt-0.5">
        {teacher?.name || slot.teacher_id}
      </div>
      <div className="text-xs sm:text-sm text-slate-500 truncate">
        {classGroup?.name || slot.class_id}
      </div>

      {/* 📌 Pre-assigned badge */}
      {showPreAssignedBadge && (
        <span className="absolute top-1 right-1 inline-flex items-center text-[10px] font-semibold text-gray-700 bg-white/80 rounded-full px-1.5 py-0.5 leading-tight shadow-sm">
          📌
        </span>
      )}

      {/* Blocked reason overlay during sidebar drag */}
      {isBlockedTarget && (
        <div className="absolute inset-0 bg-amber-50/90 rounded-lg flex items-center justify-center p-1 pointer-events-none">
          <span className="text-[10px] text-amber-700 font-medium text-center leading-tight">
            ⚠️ {dragTargetInfo?.reason}
          </span>
        </div>
      )}

      {showTooltip && (
        <div className="absolute z-20 bottom-full left-1/2 -translate-x-1/2 mb-1
          bg-gray-900 text-white text-xs rounded-lg px-3 py-2 whitespace-nowrap shadow-lg
          pointer-events-none">
          <div>{subject?.name || slot.subject_id}</div>
          <div className="text-gray-300">{teacher?.name || slot.teacher_id}</div>
          <div className="text-gray-300">{classGroup?.name || slot.class_id}</div>
          {showPreAssignedBadge && (
            <div className="text-amber-300 mt-1">📌 วางด้วยมือ</div>
          )}
          {hasConflict && (
            <div className="text-red-300 mt-1">⚠ {conflicts.join(', ')}</div>
          )}
        </div>
      )}
    </div>
  )
}
