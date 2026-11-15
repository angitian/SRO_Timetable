/**
 * เลือกงานที่จะเปิดอัตโนมัติเมื่อโหลดแอป
 *
 * กติกา:
 *  - preference คือ "งานที่ผู้ใช้เลือกล่าสุด" (ไม่ใช่แค่งานที่แก้ล่าสุด)
 *  - ถ้า preference เป็น cloud → ใช้ cloud เท่านั้น (กัน snapshot เก่าในเครื่องทับงานที่ทีมแก้บนคลาวด์)
 *  - ถ้า preference เป็น cloud แต่ยังไม่ login → โหลด local ไปก่อน แต่ "ไม่ทับ preference"
 *  - ถ้า preference ชี้งานที่ถูกลบแล้ว → ล้าง preference แล้วใช้ newest
 */

export const WORKSPACE_PREFERENCE_KEY = 'sro_last_workspace'

function newest(items) {
  return [...items].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))[0] || null
}

/**
 * @param {object} input
 * @param {{kind: 'local'|'cloud', id: string}|null} input.preference
 * @param {Array<{kind: 'local', id: string, updatedAt?: number}>} input.localItems
 * @param {Array<{kind: 'cloud', id: string, updatedAt?: number}>} input.cloudItems
 * @param {boolean} input.user  true = login แล้ว
 * @returns {{target: {kind: string, id: string}|null, keepPreference: boolean, needsLogin: boolean}}
 */
export function pickAutoOpenTarget({ preference = null, localItems = [], cloudItems = [], user = false } = {}) {
  const locals = localItems || []
  const clouds = user ? (cloudItems || []) : []

  if (preference?.kind === 'cloud') {
    const match = clouds.find((item) => item.id === preference.id)
    if (match) return { target: { kind: 'cloud', id: match.id }, keepPreference: true, needsLogin: false }
    if (!user) {
      // ยังไม่รู้ว่า cloud ยังมีอยู่ไหม — ใช้ local ไปก่อนแต่ห้ามทับ preference
      const fallback = newest(locals)
      return {
        target: fallback ? { kind: 'local', id: fallback.id } : null,
        keepPreference: true,
        needsLogin: true,
      }
    }
    // login แล้วแต่ไม่พบ record → ถูกลบไปแล้ว ล้าง preference
    const fallback = newest([...locals, ...clouds])
    return {
      target: fallback ? { kind: fallback.kind, id: fallback.id } : null,
      keepPreference: false,
      needsLogin: false,
    }
  }

  if (preference?.kind === 'local') {
    const match = locals.find((item) => item.id === preference.id)
    if (match) return { target: { kind: 'local', id: match.id }, keepPreference: true, needsLogin: false }
    const fallback = newest([...locals, ...clouds])
    return {
      target: fallback ? { kind: fallback.kind, id: fallback.id } : null,
      keepPreference: false,
      needsLogin: false,
    }
  }

  const fallback = newest([...locals, ...clouds])
  return {
    target: fallback ? { kind: fallback.kind, id: fallback.id } : null,
    keepPreference: false,
    needsLogin: false,
  }
}
