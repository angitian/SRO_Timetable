import { useState } from 'react'
import { Coffee } from 'lucide-react'
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
  coTeacher,        // second teacher (co-teaching, e.g. MEP Thai + foreign)
  substitute,       // substitute teacher object (สอนแทน) — shows instead of teacher
  substituteOriginalName, // original teacher name when substituted
  classGroup,
  classColorMap,
  colorMode = 'subject',
  isLunch,
  isBreak,          // ☕ short break (inserted BREAK with decimal period_no) — not draggable
  isFixed,          // 🔒 locked fixed slot (assembly/homeroom/etc.) — not draggable
  isPreAssigned,    // 📌 user manually placed — not draggable by solver
  fixedSlotName,    // name to display for fixed slots (e.g. "โฮมรูม")
  fixedSlotTeacherName, // supervising teacher name for this class's fixed slot (ถ้ามี)
  isDragTarget,
  dragTargetInfo,   // { valid, reason } from TimetableGrid validation
  isDraggable,
  conflicts = [],
  roomName,         // special room name (if slot uses a special room)
  onDragStart,
  onDragEnd,
  onDragOver,
  onDrop,
  onContextMenu,
  // ── Interactive block editing ──
  onRemoveSlot,     // () => void — called when ❌ clicked
  onTogglePin,      // () => void — called when 📌 clicked
  onTogglePinSlot,  // (slot) => void — called when 📌 clicked in multi-slot (teacher) mode
}) {
  const [showTooltip, setShowTooltip] = useState(false)

  // ── Lunch break cell ──────────────────────────────────────────────
  if (isLunch) {
    return (
      <div
        className="bg-gray-100 border border-gray-200 rounded-lg p-2 min-h-[80px] flex items-center justify-center"
        onContextMenu={onContextMenu}
      >
        <span className="text-sm font-semibold text-gray-400">พักเที่ยง</span>
      </div>
    )
  }

  // ── Short break cell (inserted BREAK, e.g. period_no 3.5) ─────────
  // Same height as a regular cell, but the column is narrower (controlled
  // by grid-template-columns in TimetableGrid) so it reads as a "divider".
  if (isBreak) {
    return (
      <div
        className="bg-gray-50 border border-gray-200 rounded-lg p-0.5 min-h-[80px] flex items-center justify-center"
        onContextMenu={onContextMenu}
        title="พักสั้น"
      >
        <Coffee className="w-3 h-3 text-gray-400" />
      </div>
    )
  }

  // ── Fixed slot (🔒 locked activity) ───────────────────────────────
  if (isFixed) {
    return (
      <div
        className="bg-gray-200 border-2 border-gray-400 border-dashed rounded-lg p-2 min-h-[80px] flex flex-col items-center justify-center cursor-not-allowed"
        onDragOver={(e) => e.preventDefault()} // block drops on fixed slots
        onContextMenu={onContextMenu}
      >
        <div className="text-xs sm:text-sm font-bold text-gray-600 truncate w-full text-center">
          {fixedSlotName || 'บล็อกกิจกรรม'}
        </div>
        {fixedSlotTeacherName && (
          <div className="text-[10px] font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-full px-1.5 py-0.5 truncate w-full text-center">
            ดูแล: {fixedSlotTeacherName}
          </div>
        )}
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
        onContextMenu={onContextMenu}
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
                className={`group/sub relative ${sColors.bg} ${sColors.border} border rounded px-1.5 py-0.5
                  cursor-grab hover:shadow-sm transition-all flex-1 flex items-center min-h-0
                  ${s.isPreAssigned ? 'ring-1 ring-green-400' : ''}`}
              >
                <div className={`text-xs sm:text-sm font-bold ${sColors.text} truncate w-full pr-4`}>
                  {s.isPreAssigned && <span className="mr-0.5">📌</span>}
                  {s.isSubstitute && <span className="mr-0.5">🔁</span>}
                  {s.className || s.class_id} · {s.subjectName || s.subject_id}
                  {s.isSubstitute && <span className="ml-1 text-[9px] text-orange-600 bg-orange-100 rounded px-1">สอนแทน</span>}
                </div>
                {s.coTeacherName && (
                  <div className="text-[10px] font-medium text-slate-500 truncate w-full leading-tight">
                    👥 {s.mainTeacherName || s.teacher_id} + {s.coTeacherName}
                  </div>
                )}
                {onTogglePinSlot && (
                  <button
                    onClick={(e) => { e.stopPropagation(); onTogglePinSlot(s) }}
                    className={`absolute right-0.5 top-0.5 w-4 h-4 rounded-full transition-colors
                      flex items-center justify-center text-[10px] shadow-sm
                      ${s.isPreAssigned
                        ? 'bg-green-500 text-white hover:bg-green-600'
                        : 'bg-white/80 text-gray-400 hover:bg-gray-200 hover:text-gray-700 opacity-0 group-hover/sub:opacity-100'}`}
                    title={s.isPreAssigned ? 'ปลดล็อกหมุด' : 'ปักหมุด (ล็อกตำแหน่ง)'}
                  >
                    📌
                  </button>
                )}
              </div>
            )
          })}
        </div>
        {showTooltip && slots.length > 0 && (
          <div className="absolute z-20 bottom-full left-1/2 -translate-x-1/2 mb-1
            bg-gray-900 text-white text-xs rounded-lg px-3 py-2 whitespace-nowrap shadow-lg
            pointer-events-none">
            {slots.map((s, i) => (
              <div key={i}>
                {s.className || s.class_id} · {s.subjectName || s.subject_id}
                {s.coTeacherName && (
                  <span className="text-slate-400"> — {s.mainTeacherName || s.teacher_id} + {s.coTeacherName}</span>
                )}
              </div>
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
        onContextMenu={onContextMenu}
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
  const isBlockedTarget = isDragTarget && dragTargetInfo?.valid === false

  return (
    <div
      draggable={isDraggable && !isPreAssigned}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragOver={onDragOver}
      onDrop={onDrop}
      onContextMenu={onContextMenu}
      onMouseEnter={() => setShowTooltip(true)}
      onMouseLeave={() => setShowTooltip(false)}
      className={`group relative ${colors.bg} ${colors.border} border rounded-lg p-2 min-h-[80px] transition-all
        ${isDraggable && !isPreAssigned ? 'cursor-grab hover:shadow-md' : 'cursor-default'}
        ${isDragTarget && !isBlockedTarget ? 'ring-2 ring-emerald-500 ring-offset-1' : ''}
        ${isBlockedTarget ? 'ring-2 ring-amber-500 ring-offset-1' : ''}
        ${hasConflict ? 'ring-2 ring-red-400' : ''}`}
    >
      <div className={`text-base sm:text-lg font-bold leading-tight ${colors.text} truncate pr-6`}>
        {subject?.name || slot.subject_id}
        {hasConflict && <span className="ml-1 text-red-500">⚠</span>}
      </div>
      <div className="flex items-baseline gap-1 mt-0.5 min-w-0">
        <span className="text-xs sm:text-sm font-semibold text-slate-600 truncate">
          {substitute ? (substitute.name || substitute.id) : (teacher?.name || slot.teacher_id)}
          {!substitute && coTeacher && (
            <span className="text-slate-500"> + {coTeacher.name || coTeacher.id}</span>
          )}
          {substitute && substituteOriginalName && (
            <span className="text-slate-400 font-normal"> (แทน {substituteOriginalName})</span>
          )}
        </span>
        <span className="text-xs sm:text-sm text-slate-500 truncate ml-auto shrink-0">
          {classGroup?.name || slot.class_id}
        </span>
      </div>
      {substitute && (
        <div className="mt-0.5">
          <span className="inline-block text-[10px] text-orange-700 bg-orange-100 px-1 py-0.5 rounded font-bold border border-orange-200">
            🔁 สอนแทน
          </span>
        </div>
      )}
      {/* 🔬 Special room badge (if slot uses a special room, not default classroom) */}
      {roomName && (
        <div className="mt-0.5">
          <span className="inline-block text-[10px] text-indigo-700 bg-indigo-50 px-1 py-0.5 rounded font-medium border border-indigo-200">
            🔬 {roomName}
          </span>
        </div>
      )}

      {/* ❌ Remove button (top-right) — visible on hover */}
      {onRemoveSlot && (
        <button
          onClick={(e) => { e.stopPropagation(); onRemoveSlot() }}
          className="absolute top-1 right-1 w-5 h-5 rounded-full bg-white/80 text-gray-600
            hover:bg-red-500 hover:text-white transition-colors flex items-center justify-center
            text-xs font-bold shadow-sm opacity-0 group-hover:opacity-100"
          title="นำออกจากตาราง"
        >
          ✕
        </button>
      )}

      {/* 📌 Pin toggle (bottom-right) */}
      {onTogglePin && (
        <button
          onClick={(e) => { e.stopPropagation(); onTogglePin() }}
          className={`absolute bottom-1 right-1 w-5 h-5 rounded-full transition-colors
            flex items-center justify-center text-xs shadow-sm
            ${isPreAssigned
              ? 'bg-green-500 text-white hover:bg-green-600'
              : 'bg-white/80 text-gray-400 hover:bg-gray-200 hover:text-gray-700 opacity-0 group-hover:opacity-100'}`}
          title={isPreAssigned ? 'ปลดล็อกหมุด' : 'ปักหมุด (ล็อกตำแหน่ง)'}
        >
          📌
        </button>
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
          <div className="text-gray-300">
            {teacher?.name || slot.teacher_id}
            {coTeacher && <span> + {coTeacher.name || coTeacher.id}</span>}
          </div>
          <div className="text-gray-300">{classGroup?.name || slot.class_id}</div>
          {roomName && (
            <div className="text-indigo-300 mt-0.5">🔬 {roomName}</div>
          )}
          {isPreAssigned && (
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
