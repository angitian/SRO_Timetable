/** คัดลอกข้อความลงคลิปบอร์ด (มี fallback สำหรับเบราว์เซอร์ที่บล็อก clipboard API) */
export function copyText(text) {
  try {
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(text)
      return true
    }
  } catch { /* fall through */ }
  try {
    const area = document.createElement('textarea')
    area.value = text
    area.style.position = 'fixed'
    area.style.opacity = '0'
    document.body.appendChild(area)
    area.select()
    document.execCommand('copy')
    area.remove()
    return true
  } catch {
    return false
  }
}
