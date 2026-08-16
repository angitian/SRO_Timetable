import { useState, useMemo, useRef, useEffect } from 'react'
import { FlaskConical, Plus, Search, Check } from 'lucide-react'
import {
  getRoomTypeColor,
  FACILITY_TYPE_LABELS,
  FACILITY_TYPE_ICONS,
} from '../../utils/roomTypes.js'

/**
 * RoomSelector — reusable dropdown for selecting a special room (facility).
 *
 * Props:
 *   value        — current room_id (null/undefined = default classroom)
 *   onChange     — (roomId | null) => void
 *   specialRooms — array of { id, name, room_type }
 *   classId      — current class ID (used to compute default room_id R_{classId})
 *   onCreateNew  — (name) => void  — optional callback to create a new special room on-the-fly
 *   label        — field label (default: "ห้องปฏิบัติการ (ถ้ามี)")
 *   compact      — boolean, render smaller for inline use
 */
export default function RoomSelector({
  value,
  onChange,
  specialRooms = [],
  classId,
  onCreateNew,
  label = 'ห้องปฏิบัติการ (ถ้ามี)',
  compact = false,
}) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [showCreateInput, setShowCreateInput] = useState(false)
  const [newRoomName, setNewRoomName] = useState('')
  const containerRef = useRef(null)

  const defaultRoomId = classId ? `R_${classId}` : null
  const isDefault = !value || value === defaultRoomId || value.startsWith('R_')

  const filteredRooms = useMemo(() => {
    if (!search.trim()) return specialRooms
    const q = search.toLowerCase()
    return specialRooms.filter(
      (r) => r.name.toLowerCase().includes(q) || (r.room_type || '').toLowerCase().includes(q),
    )
  }, [specialRooms, search])

  // Close dropdown on outside click
  useEffect(() => {
    if (!open) return
    function handleClick(e) {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setOpen(false)
        setShowCreateInput(false)
        setNewRoomName('')
        setSearch('')
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [open])

  function handleSelect(roomId) {
    onChange(roomId)
    setOpen(false)
    setSearch('')
    setShowCreateInput(false)
    setNewRoomName('')
  }

  function handleCreateNew() {
    const name = newRoomName.trim()
    if (!name) return
    if (onCreateNew) {
      onCreateNew(name)
    }
    // After creating, the parent should add the room and we can select it.
    // For simplicity, we close the dropdown; the user can re-open to select.
    // A better UX would auto-select, but that requires the new room's ID which
    // is generated inside the reducer. We pass the name back and let the
    // parent handle selection if desired.
    setOpen(false)
    setShowCreateInput(false)
    setNewRoomName('')
    setSearch('')
  }

  const selectedRoom = specialRooms.find((r) => r.id === value)

  return (
    <div ref={containerRef} className="relative">
      {label && (
        <label className={`block font-medium text-gray-700 ${compact ? 'text-xs mb-0.5' : 'text-sm mb-1'}`}>
          {label}
        </label>
      )}
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className={`w-full flex items-center justify-between border border-gray-300 rounded-lg px-3 py-2 text-sm
          bg-white hover:border-indigo-400 transition-colors text-left
          ${compact ? 'py-1.5 text-xs' : ''}`}
      >
        <span className="flex items-center gap-2 truncate">
          {isDefault ? (
            <>
              <span className="text-gray-400">🏫</span>
              <span className="text-gray-500">ห้องเรียนปกติ (Default)</span>
            </>
          ) : selectedRoom ? (
            <>
              <span className="text-indigo-600">{FACILITY_TYPE_ICONS[selectedRoom.room_type] || '🔬'}</span>
              <span className="font-medium text-gray-800 truncate">{selectedRoom.name}</span>
              {selectedRoom.room_type && (
                <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${getRoomTypeColor(selectedRoom.room_type).badge}`}>
                  {FACILITY_TYPE_LABELS[selectedRoom.room_type] || selectedRoom.room_type}
                </span>
              )}
            </>
          ) : (
            <span className="text-gray-400">— เลือกห้อง —</span>
          )}
        </span>
        <span className="text-gray-400 text-xs">▾</span>
      </button>

      {open && (
        <div className="absolute z-50 mt-1 w-full bg-white border border-gray-200 rounded-lg shadow-lg max-h-72 overflow-hidden flex flex-col">
          {/* Search */}
          {specialRooms.length > 5 && (
            <div className="p-2 border-b border-gray-100">
              <div className="relative">
                <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="ค้นหาห้อง..."
                  className="w-full pl-7 pr-2 py-1.5 text-xs border border-gray-200 rounded-md focus:ring-1 focus:ring-indigo-500"
                  autoFocus
                />
              </div>
            </div>
          )}

          {/* Options list */}
          <div className="overflow-y-auto flex-1">
            {/* Default classroom option */}
            <button
              type="button"
              onClick={() => handleSelect(defaultRoomId)}
              className={`w-full flex items-center gap-2 px-3 py-2 text-sm text-left hover:bg-gray-50 transition-colors
                ${isDefault ? 'bg-indigo-50' : ''}`}
            >
              <span className="text-gray-400">🏫</span>
              <span className="flex-1 text-gray-600">ห้องเรียนปกติ (Default)</span>
              {isDefault && <Check className="w-4 h-4 text-indigo-600" />}
            </button>

            {/* Special rooms */}
            {filteredRooms.length > 0 && (
              <div className="border-t border-gray-100">
                <div className="px-3 py-1 text-[10px] font-bold text-gray-400 uppercase tracking-wide">
                  ห้องพิเศษ
                </div>
                {filteredRooms.map((room) => {
                  const colors = getRoomTypeColor(room.room_type)
                  const isSelected = value === room.id
                  const icon = FACILITY_TYPE_ICONS[room.room_type] || '🔬'
                  const typeLabel = FACILITY_TYPE_LABELS[room.room_type] || room.room_type
                  return (
                    <button
                      key={room.id}
                      type="button"
                      onClick={() => handleSelect(room.id)}
                      className={`w-full flex items-center gap-2 px-3 py-2 text-sm text-left hover:bg-gray-50 transition-colors
                        ${isSelected ? 'bg-indigo-50' : ''}`}
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

            {filteredRooms.length === 0 && search && (
              <div className="px-3 py-4 text-xs text-gray-400 text-center">
                ไม่พบห้องที่ตรงกับ "{search}"
              </div>
            )}
          </div>

          {/* Create new room on-the-fly */}
          {onCreateNew && (
            <div className="border-t border-gray-100">
              {showCreateInput ? (
                <div className="flex items-center gap-1.5 p-2">
                  <input
                    type="text"
                    value={newRoomName}
                    onChange={(e) => setNewRoomName(e.target.value)}
                    placeholder="ชื่อห้องใหม่..."
                    className="flex-1 px-2 py-1.5 text-xs border border-gray-300 rounded-md focus:ring-1 focus:ring-indigo-500"
                    autoFocus
                    onKeyDown={(e) => { if (e.key === 'Enter') handleCreateNew() }}
                  />
                  <button
                    type="button"
                    onClick={handleCreateNew}
                    disabled={!newRoomName.trim()}
                    className="text-xs px-2 py-1.5 bg-indigo-600 text-white rounded-md font-medium hover:bg-indigo-700 disabled:opacity-50"
                  >
                    สร้าง
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setShowCreateInput(true)}
                  className="w-full flex items-center gap-2 px-3 py-2 text-sm text-left text-indigo-600 hover:bg-indigo-50 transition-colors font-medium"
                >
                  <Plus className="w-4 h-4" />
                  เพิ่มห้องใหม่...
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
