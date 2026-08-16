import { useState } from 'react'
import { Plus, Edit2, Trash2, Check, X, FlaskConical } from 'lucide-react'
import { useApp } from '../../context/AppContext.jsx'
import {
  FACILITY_TYPES,
  FACILITY_TYPE_LABELS,
  FACILITY_TYPE_ICONS,
  getRoomTypeColor,
} from '../../utils/roomTypes.js'

/**
 * SpecialRoomsManager — CRUD table for special rooms (labs, music rooms, etc.)
 *
 * Reads from / writes to fixtureData.special_rooms via AppContext actions:
 *   addSpecialRoom, updateSpecialRoom, deleteSpecialRoom
 */
export default function SpecialRoomsManager() {
  const { fixtureData, addSpecialRoom, updateSpecialRoom, deleteSpecialRoom } = useApp()
  const specialRooms = fixtureData?.special_rooms || []
  const lessonBlocks = fixtureData?.lesson_blocks || []

  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState(null)
  const [formData, setFormData] = useState({ name: '', room_type: 'lab' })
  const [customType, setCustomType] = useState('')
  const [deleteConfirmId, setDeleteConfirmId] = useState(null)

  function handleStartAdd() {
    setEditingId(null)
    setFormData({ name: '', room_type: 'lab' })
    setCustomType('')
    setShowForm(true)
  }

  function handleStartEdit(room) {
    setEditingId(room.id)
    const isKnown = FACILITY_TYPES.includes(room.room_type)
    setFormData({
      name: room.name,
      room_type: isKnown ? room.room_type : 'other',
    })
    setCustomType(isKnown ? '' : room.room_type)
    setShowForm(true)
  }

  function handleSave() {
    const name = formData.name.trim()
    if (!name) return
    const finalType = formData.room_type === 'other'
      ? (customType.trim() || 'other')
      : formData.room_type

    if (editingId) {
      updateSpecialRoom(editingId, { name, room_type: finalType })
    } else {
      const newId = `SR_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
      addSpecialRoom({ id: newId, name, room_type: finalType })
    }
    setShowForm(false)
    setEditingId(null)
  }

  function handleDelete(roomId) {
    deleteSpecialRoom(roomId)
    setDeleteConfirmId(null)
  }

  // Count how many lesson blocks use each special room
  const usageCount = {}
  for (const lb of lessonBlocks) {
    if (lb.room_id && lb.room_id.startsWith('SR_')) {
      usageCount[lb.room_id] = (usageCount[lb.room_id] || 0) + 1
    }
  }

  return (
    <div className="space-y-3">
      {/* Header + Add button */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <FlaskConical className="w-4 h-4 text-indigo-600" />
          <span className="text-sm font-bold text-gray-700">
            ห้องพิเศษ ({specialRooms.length})
          </span>
        </div>
        <button
          onClick={handleStartAdd}
          className="flex items-center gap-1 text-xs px-2.5 py-1.5 bg-indigo-600 text-white rounded-lg font-medium hover:bg-indigo-700 transition-colors"
        >
          <Plus className="w-3.5 h-3.5" />
          เพิ่มห้องพิเศษ
        </button>
      </div>

      {/* Rooms list */}
      {specialRooms.length === 0 && !showForm && (
        <p className="text-xs text-gray-400 italic py-2">
          ยังไม่มีห้องพิเศษ เช่น ห้องวิทยาศาสตร์ ห้องคอมพิวเตอร์ ห้องดนตรี — กด "เพิ่มห้องพิเศษ" เพื่อสร้าง
        </p>
      )}

      {specialRooms.length > 0 && (
        <div className="space-y-1.5">
          {specialRooms.map((room) => {
            const colors = getRoomTypeColor(room.room_type)
            const count = usageCount[room.id] || 0
            const isConfirming = deleteConfirmId === room.id
            const icon = FACILITY_TYPE_ICONS[room.room_type] || FACILITY_TYPE_ICONS.other
            const typeLabel = FACILITY_TYPE_LABELS[room.room_type] || room.room_type || 'อื่นๆ'
            return (
              <div
                key={room.id}
                className={`flex items-center gap-2 px-3 py-2 rounded-lg border ${colors.unselected}`}
              >
                <span className="text-base">{icon}</span>
                <span className="flex-1 text-sm font-medium text-gray-800 truncate">
                  {room.name}
                </span>
                <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${colors.badge}`}>
                  {typeLabel}
                </span>
                {count > 0 && (
                  <span className="text-[10px] text-gray-500">
                    ใช้ {count} คาบ
                  </span>
                )}
                {!isConfirming ? (
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => handleStartEdit(room)}
                      className="text-gray-400 hover:text-blue-600 transition-colors"
                      title="แก้ไข"
                    >
                      <Edit2 className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => setDeleteConfirmId(room.id)}
                      className="text-gray-400 hover:text-red-600 transition-colors"
                      title="ลบ"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ) : (
                  <div className="flex items-center gap-1">
                    <span className="text-[10px] text-red-600">ยืนยัน?</span>
                    <button
                      onClick={() => handleDelete(room.id)}
                      className="text-red-600 hover:text-red-700 font-bold"
                      title="ยืนยันลบ"
                    >
                      <Check className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => setDeleteConfirmId(null)}
                      className="text-gray-400 hover:text-gray-600"
                      title="ยกเลิก"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* Inline Add/Edit form */}
      {showForm && (
        <div className="border border-indigo-200 rounded-lg p-3 bg-indigo-50/50 space-y-2.5">
          <div>
            <label className="text-xs font-medium text-gray-600 mb-1 block">ชื่อห้องพิเศษ</label>
            <input
              type="text"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              placeholder="เช่น ห้องวิทยาศาสตร์, ห้องคอมพิวเตอร์, ห้องดนตรี"
              className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
              autoFocus
              onKeyDown={(e) => { if (e.key === 'Enter') handleSave() }}
            />
          </div>
          <div>
            <label className="text-xs font-medium text-gray-600 mb-1 block">ประเภทห้อง</label>
            <div className="flex gap-1.5 flex-wrap">
              {FACILITY_TYPES.map((t) => {
                const colors = getRoomTypeColor(t)
                const icon = FACILITY_TYPE_ICONS[t] || '🏟️'
                const label = FACILITY_TYPE_LABELS[t] || t
                return (
                  <button
                    key={t}
                    onClick={() => setFormData({ ...formData, room_type: t })}
                    className={`text-xs px-2 py-1 rounded-md font-medium border transition-all flex items-center gap-1
                      ${formData.room_type === t ? colors.selected : colors.unselected}`}
                  >
                    <span>{icon}</span>
                    {label}
                  </button>
                )
              })}
              {formData.room_type === 'other' && (
                <input
                  type="text"
                  value={customType}
                  onChange={(e) => setCustomType(e.target.value)}
                  placeholder="ระบุประเภท"
                  className="border border-gray-300 rounded-md px-2 py-1 text-xs w-28"
                />
              )}
            </div>
          </div>
          <div className="flex gap-2 justify-end pt-1">
            <button
              onClick={() => { setShowForm(false); setEditingId(null) }}
              className="btn-secondary text-xs"
            >
              ยกเลิก
            </button>
            <button
              onClick={handleSave}
              disabled={!formData.name.trim()}
              className="btn-primary text-xs flex items-center gap-1 disabled:opacity-50"
            >
              <Check className="w-3.5 h-3.5" />
              {editingId ? 'บันทึก' : 'เพิ่ม'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
