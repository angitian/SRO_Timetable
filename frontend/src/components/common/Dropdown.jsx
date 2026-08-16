import { useState, useRef, useEffect } from 'react'
import { ChevronDown } from 'lucide-react'

/**
 * Reusable dropdown menu component.
 *
 * Eliminates the repeated pattern of:
 *   - toggle button with chevron
 *   - fixed inset overlay for outside-click close
 *   - absolute positioned menu panel
 *
 * Props:
 *   - trigger: ReactNode | (({ open, toggle }) => ReactNode)
 *       Custom trigger content. If provided, overrides label/chevron.
 *   - label: string (used with default trigger button)
 *   - triggerClassName: string (applied to default trigger button)
 *   - disabled: boolean
 *   - menuClassName: string (applied to the menu panel)
 *   - align: 'left' | 'right' (default 'left')
 *   - width: string (CSS width for menu, default 'w-72')
 *   - children: ({ close }) => ReactNode  — menu content; call close() to dismiss
 *   - onOpenChange: (open: boolean) => void
 */
export default function Dropdown({
  trigger = null,
  label = '',
  triggerClassName = '',
  disabled = false,
  menuClassName = '',
  align = 'left',
  width = 'w-72',
  children,
  onOpenChange,
}) {
  const [open, setOpen] = useState(false)
  const containerRef = useRef(null)

  // Close on outside click
  useEffect(() => {
    if (!open) return
    function handleClick(e) {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [open])

  // Close on Escape
  useEffect(() => {
    if (!open) return
    function handleEsc(e) {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('keydown', handleEsc)
    return () => document.removeEventListener('keydown', handleEsc)
  }, [open])

  // Notify parent of open state changes
  useEffect(() => {
    onOpenChange?.(open)
  }, [open, onOpenChange])

  const toggle = () => {
    if (!disabled) setOpen((prev) => !prev)
  }
  const close = () => setOpen(false)

  const alignClass = align === 'right' ? 'right-0' : 'left-0'

  return (
    <div className="relative" ref={containerRef}>
      {trigger ? (
        typeof trigger === 'function' ? (
          trigger({ open, toggle })
        ) : (
          <div onClick={toggle}>{trigger}</div>
        )
      ) : (
        <button
          onClick={toggle}
          disabled={disabled}
          className={triggerClassName}
          type="button"
        >
          {label}
          <ChevronDown
            className={`w-3 h-3 text-gray-500 transition-transform shrink-0 ${open ? 'rotate-180' : ''}`}
          />
        </button>
      )}

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={close} />
          <div
            className={`absolute ${alignClass} top-full mt-1 z-50 ${width} bg-white rounded-xl shadow-xl border border-gray-200 overflow-hidden ${menuClassName}`}
          >
            {typeof children === 'function' ? children({ close }) : children}
          </div>
        </>
      )}
    </div>
  )
}
