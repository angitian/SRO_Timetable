import { useEffect, useRef } from 'react'
import { Trash2, Lock, Unlock, Move, Plus, FlaskConical } from 'lucide-react'

/**
 * Right-click context menu for grid cells.
 *
 * Props:
 *   menu       — { x, y, cellType, slot, day, period, classId } | null
 *   onClose    — () => void
 *   onDeleteSlot      — (lessonBlockId) => void
 *   onRemovePlacement — (lessonBlockId, day, period) => void
 *   onLockSlot        — (day, period) => void
 *   onUnlockSlot      — (day, period) => void
 *   onChangeRoom      — (slot) => void  — opens room edit modal
 */
export default function CellContextMenu({
  menu,
  onClose,
  onDeleteSlot,
  onRemovePlacement,
  onLockSlot,
  onUnlockSlot,
  onChangeRoom,
}) {
  const menuRef = useRef(null)

  // Close on outside click or escape
  useEffect(() => {
    if (!menu) return
    function handleClick(e) {
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        onClose()
      }
    }
    function handleEsc(e) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('mousedown', handleClick)
    document.addEventListener('keydown', handleEsc)
    return () => {
      document.removeEventListener('mousedown', handleClick)
      document.removeEventListener('keydown', handleEsc)
    }
  }, [menu, onClose])

  if (!menu) return null

  const { x, y, cellType, slot, day, period } = menu

  // Adjust position to keep menu on screen
  const menuWidth = 220
  const menuHeight = 200
  const adjustedX = Math.min(x, window.innerWidth - menuWidth - 10)
  const adjustedY = Math.min(y, window.innerHeight - menuHeight - 10)

  function handleAction(fn, ...args) {
    fn?.(...args)
    onClose()
  }

  // Build menu items based on cell type
  const items = []

  if (cellType === 'solver') {
    // 🚀 Solver-placed slot
    items.push({
      icon: Move,
      label: 'ย้าย (ลากไปช่องอื่น)',
      desc: 'ใช้การลากเพื่อย้ายคาบนี้',
      disabled: true, // hint — actual move is via drag
      onClick: null,
    })
    if (onChangeRoom) {
      items.push({
        icon: FlaskConical,
        label: 'เปลี่ยนห้องพิเศษ',
        desc: 'สลับหรือเปลี่ยนห้องปฏิบัติการ',
        onClick: () => handleAction(onChangeRoom, slot),
      })
    }
    items.push({
      icon: Trash2,
      label: 'ลบคาบนี้',
      desc: 'นำคาบนี้ออกจากตาราง',
      danger: true,
      onClick: () => handleAction(onDeleteSlot, slot?.lesson_block_id),
    })
    items.push({
      icon: Lock,
      label: 'ล็อกคาบนี้',
      desc: 'แปลงเป็นกิจกรรมล็อก 🔒',
      onClick: () => handleAction(onLockSlot, day, period),
    })
  } else if (cellType === 'placement') {
    // 📌 User placement
    items.push({
      icon: Move,
      label: 'ย้าย (ลากไปช่องอื่น)',
      desc: 'ใช้การลากเพื่อย้าย',
      disabled: true,
      onClick: null,
    })
    if (onChangeRoom) {
      items.push({
        icon: FlaskConical,
        label: 'เปลี่ยนห้องพิเศษ',
        desc: 'สลับหรือเปลี่ยนห้องปฏิบัติการ',
        onClick: () => handleAction(onChangeRoom, slot),
      })
    }
    items.push({
      icon: Trash2,
      label: 'ลบการล็อกนี้',
      desc: 'นำ 📌 ออก กลับคลังวิชา',
      danger: true,
      onClick: () => handleAction(onRemovePlacement, slot?.lesson_block_id, day, period),
    })
  } else if (cellType === 'fixed') {
    // 🔒 Fixed slot
    items.push({
      icon: Unlock,
      label: 'ปลดล็อก',
      desc: 'นำ 🔒 ออก ช่องนี้จะว่าง',
      onClick: () => handleAction(onUnlockSlot, day, period),
    })
  } else if (cellType === 'empty') {
    // Empty cell
    items.push({
      icon: Lock,
      label: 'ล็อกคาบนี้',
      desc: 'เพิ่มกิจกรรมล็อก 🔒 ในช่องนี้',
      onClick: () => handleAction(onLockSlot, day, period),
    })
  }

  return (
    <div
      ref={menuRef}
      className="fixed z-[200] bg-white rounded-xl shadow-2xl border border-gray-200 overflow-hidden py-1"
      style={{ left: adjustedX, top: adjustedY, width: menuWidth }}
      onContextMenu={(e) => e.preventDefault()}
    >
      {/* Header */}
      <div className="px-3 py-2 border-b border-gray-100 text-xs text-gray-400">
        คาบที่ {day} · วัน{['จันทร์','อังคาร','พุธ','พฤหัส','ศุกร์','เสาร์','อาทิตย์'][day - 1] || day} · คาบ {period}
      </div>

      {/* Menu items */}
      {items.map((item, i) => {
        const Icon = item.icon
        return (
          <button
            key={i}
            disabled={item.disabled}
            onClick={item.onClick}
            className={`w-full flex items-start gap-3 px-3 py-2.5 text-sm text-left transition-colors
              disabled:opacity-40 disabled:cursor-not-allowed
              ${item.danger
                ? 'text-red-700 hover:bg-red-50'
                : item.disabled
                  ? 'text-gray-400'
                  : 'text-gray-800 hover:bg-gray-50'}`}
          >
            <Icon className="w-4 h-4 mt-0.5 shrink-0" />
            <div className="min-w-0 flex-1">
              <div className="font-semibold">{item.label}</div>
              {item.desc && <div className="text-xs text-gray-400 mt-0.5">{item.desc}</div>}
            </div>
          </button>
        )
      })}

      {items.length === 0 && (
        <div className="px-3 py-4 text-sm text-gray-400 text-center">ไม่มีการกระทำที่ใช้ได้</div>
      )}
    </div>
  )
}
