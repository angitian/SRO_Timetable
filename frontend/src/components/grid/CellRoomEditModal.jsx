import { useState, useMemo, useEffect, useRef } from 'react'
import { X, AlertTriangle, Check, FlaskConical } from 'lucide-react'
import {
  getRoomTypeColor,
  FACILITY_TYPE_LABELS,
  FACILITY_TYPE_ICONS,
} from '../../utils/roomTypes.js'

/**
 * CellRoomEditModal — popover for changing a slot's special room on-the-fly.
 *
 * Props:
 *   slot          — { lesson_block_id, day, period, class_id, room_id, ... }
 *   specialRooms  — array of { id, name, room_type }
 *   allSlots      — all result slots (for conflict detection)
 *   onClose       — () => void
 *   onChange      — (lessonBlockId, newRoomId) => void
 *   classId       — the class ID for computing default room R_{classId}
 */
export default function CellRoomEditModal({
  slot,
  specialRooms = [],
  allSlots = [],
  onClose,
  onChange,
}) {
  const defaultRoomId = slot?.class_id ? `R_${slot.class_id}` : null
  const currentRoomId = slot?.room_id || defaultRoomId
  const isDefault = !currentRoomId || currentRoomId === defaultRoomId || currentRoomId.startsWith('R_')

  const [selectedRoomId, setSelectedRoomId] = useState(isDefault ? null : currentRoomId)
  const modalRef = useRef(null)

  // Conflict detection: check if the selected room is used by another slot at the same (day, period)
  const conflictInfo = useMemo(() => {
    if (!slot || !selectedRoomId) return null
    const conflictingSlots = allSlots.filter(
      (s) =>
        s.lesson_block_id !== slot.lesson_block_id &&
        s.day === slot.day &&
        s.period === slot.period &&
        s.room_id === selectedRoomId,
    )
    if (conflictingSlots.length === 0) return null
    return conflictingSlots[0] // first conflict
  }, [slot, selectedRoomId, allSlots])

  // Close on escape
  useEffect(() => {
    function handleEsc(e) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handleEsc)
    return () => document.removeEventListener('keydown', handleEsc)
  }, [onClose])

  if (!slot) return null

  function handleSave() {
    const finalRoomId = selectedRoomId || defaultRoomId
    onChange(slot.lesson_block_id, finalRoomId)
    onClose()
  }

  const selectedRoom = specialRooms.find((r) => r.id === selectedRoomId)

  return (
    <div
      className="fixed inset-0 bg-black/30 flex items-center justify-center z-[150]"
      onClick={onClose}
    >
      <div
        ref={modalRef}
        className="bg-white rounded-xl shadow-lg p-5 w-full max-w-sm space-y-4"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between">
          <h3 className="font-bold text-gray-900 flex items-center gap-2">
            <FlaskConical className="w-4 h-4 text-indigo-600" />
            เปลี่ยนห้องพิเศษ
          </h3>
          <button onClick={onClose}><X className="w-5 h-5 text-gray-400" /></button>
        </div>

        {/* Slot info */}
        <div className="text-xs text-gray-500 bg-gray-50 rounded-lg px-3 py-2">
          วันที่ {slot.day} · คาบ {slot.period}
        </div>

        {/* Room selection */}
        <div className="space-y-1.5">
          {/* Default classroom */}
          <button
            onClick={() => setSelectedRoomId(null)}
            className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg border text-sm text-left transition-all
              ${selectedRoomId === null
                ? 'border-indigo-500 bg-indigo-50 ring-1 ring-indigo-500'
                : 'border-gray-200 hover:border-gray-300'}`}
          >
            <span className="text-gray-400">🏫</span>
            <span className="flex-1 text-gray-600">ห้องเรียนปกติ (Default)</span>
            {selectedRoomId === null && <Check className="w-4 h-4 text-indigo-600" />}
          </button>

          {/* Special rooms */}
          {specialRooms.length > 0 && (
            <div className="pt-1">
              <div className="text-[10px] font-bold text-gray-400 uppercase tracking-wide px-3 py-1">
                ห้องพิเศษ
              </div>
              {specialRooms.map((room) => {
                const colors = getRoomTypeColor(room.room_type)
                const isSelected = selectedRoomId === room.id
                const icon = FACILITY_TYPE_ICONS[room.room_type] || '🔬'
                const typeLabel = FACILITY_TYPE_LABELS[room.room_type] || room.room_type
                return (
                  <button
                    key={room.id}
                    onClick={() => setSelectedRoomId(room.id)}
                    className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg border text-sm text-left transition-all
                      ${isSelected
                        ? 'border-indigo-500 bg-indigo-50 ring-1 ring-indigo-500'
                        : 'border-gray-200 hover:border-gray-300'}`}
                  >
                    <span className="text-base">{icon}</span>
                    <span className="flex-1 font-medium text-gray-800 truncate">{room.name}</span>
                    {room.room_type && (
                      <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${colors.badge}`}>
                        {typeLabel}
                      </span>
                    )}
                    {isSelected && <Check className="w-4 h-4 text-indigo-600" />}
                  </button>
                )
              })}
            </div>
          )}

          {specialRooms.length === 0 && (
            <p className="text-xs text-gray-400 italic px-3 py-2">
              ยังไม่มีห้องพิเศษ สามารถเพิ่มได้ที่หน้าเตรียมข้อมูล (Step 1)
            </p>
          )}
        </div>

        {/* Conflict warning */}
        {conflictInfo && (
          <div className="flex items-start gap-2 bg-amber-50 border border-amber-300 rounded-lg px-3 py-2">
            <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
            <div className="text-xs text-amber-800">
              <div className="font-bold">⚠️ ห้องนี้ถูกใช้งานในคาบเดียวกัน</div>
              <div className="mt-0.5">
                ห้อง "{selectedRoom?.name}" มีคาบอื่นในวันที่ {conflictInfo.day} คาบ {conflictInfo.period} อยู่แล้ว
              </div>
              <div className="mt-1 text-amber-600">
                หากบันทึก ระบบจะอนุญาตให้ซ้ำ แต่ควรตรวจสอบอีกครั้งหลังจัดตารางใหม่
              </div>
            </div>
          </div>
        )}

        {/* Actions */}
        <div className="flex gap-2 justify-end pt-1">
          <button onClick={onClose} className="btn-secondary text-sm">ยกเลิก</button>
          <button
            onClick={handleSave}
            className="btn-primary text-sm flex items-center gap-1"
          >
            <Check className="w-3.5 h-3.5" />
            บันทึก
          </button>
        </div>
      </div>
    </div>
  )
}
