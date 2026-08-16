import { useState, useCallback, useRef, useEffect } from 'react'

/**
 * Toast notification hook with automatic cleanup.
 *
 * Returns:
 *   - toast: { type, msg } | null
 *   - showToast(type, msg): display a toast for `duration` ms (default 3000)
 *   - clearToast(): manually dismiss
 *
 * The timeout is tracked in a ref and cleared on unmount to prevent
 * memory leaks and state updates on unmounted components.
 */
export default function useToast(duration = 3000) {
  const [toast, setToast] = useState(null)
  const timerRef = useRef(null)

  const clearToast = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
    setToast(null)
  }, [])

  const showToast = useCallback((type, msg) => {
    if (timerRef.current) clearTimeout(timerRef.current)
    setToast({ type, msg })
    timerRef.current = setTimeout(() => {
      setToast(null)
      timerRef.current = null
    }, duration)
  }, [duration])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [])

  return { toast, showToast, clearToast }
}
