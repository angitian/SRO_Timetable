// Centralized subject color utility — hybrid approach:
// 1. Keyword matching (Thai/English) on subject name → color group
// 2. Fallback to subject.category (core/pe/art/music/lab/admin)
//
// Shared by VerificationStep and GridCell for visual consistency.

// Category-based fallback colors (matches SubjectCategory enum in backend).
const CATEGORY_COLORS = {
  core:   { bg: 'bg-blue-100',    border: 'border-blue-300',    text: 'text-blue-800' },
  pe:     { bg: 'bg-green-100',   border: 'border-green-300',   text: 'text-green-800' },
  art:    { bg: 'bg-yellow-100',  border: 'border-yellow-300',  text: 'text-yellow-800' },
  music:  { bg: 'bg-purple-100',  border: 'border-purple-300',  text: 'text-purple-800' },
  lab:    { bg: 'bg-violet-100',  border: 'border-violet-300',  text: 'text-violet-800' },
  admin:  { bg: 'bg-gray-100',    border: 'border-gray-300',    text: 'text-gray-800' },
}

const DEFAULT_COLOR = { bg: 'bg-slate-100', border: 'border-slate-300', text: 'text-slate-700' }

// Keyword-based color groups (checked in order).
// Foreign languages checked before Thai to avoid ภาษา collision.
const KEYWORD_GROUPS = [
  {
    // Foreign languages
    re: /อังกฤษ|จีน|ญี่ปุ่น|เยอรมัน|ฝรั่งเศส|เกาหลี|ภาษาต่างประเทศ|english|chinese|mandarin|japanese/,
    color: { bg: 'bg-emerald-50', border: 'border-emerald-200', text: 'text-emerald-700' },
  },
  {
    // Thai / Social / History / Religion / Citizenship
    re: /ภาษาไทย|ไทย|สังคม|ประวัติ|ศาสนา|พลเมือง/,
    color: { bg: 'bg-blue-50', border: 'border-blue-200', text: 'text-blue-700' },
  },
  {
    // Math / Science / Technology / Computing
    re: /คณิต|วิทย์|วิทยาศาสตร์|เทคโนโลยี|คอมพิวเตอร์|stem|ict/,
    color: { bg: 'bg-amber-50', border: 'border-amber-200', text: 'text-amber-800' },
  },
  {
    // Health / PE / Art / Music / Career / Agriculture
    re: /สุขศึกษา|พละ|พลศึกษา|ศิลปะ|ดนตรี|การงาน|เกษตร/,
    color: { bg: 'bg-purple-50', border: 'border-purple-200', text: 'text-purple-700' },
  },
  {
    // Elective / Club / Activity / Guidance
    re: /เลือก|ชุมนุม|กิจกรรม|แนะแนว|homeroom/,
    color: { bg: 'bg-slate-100', border: 'border-slate-200', text: 'text-slate-700' },
  },
]

/**
 * Get Tailwind color classes for a subject.
 * Hybrid: keyword matching on name first, then category fallback.
 *
 * @param {string} name - Subject name (Thai or English)
 * @param {string} [category] - Subject category: core|pe|art|music|lab|admin
 * @returns {{bg: string, border: string, text: string}} Tailwind class strings
 */
export function getSubjectColor(name, category) {
  const n = (name || '').toLowerCase()

  // 1. Keyword matching
  for (const group of KEYWORD_GROUPS) {
    if (group.re.test(n)) {
      return group.color
    }
  }

  // 2. Category fallback
  if (category && CATEGORY_COLORS[category.toLowerCase()]) {
    return CATEGORY_COLORS[category.toLowerCase()]
  }

  return DEFAULT_COLOR
}

export { CATEGORY_COLORS, DEFAULT_COLOR }
