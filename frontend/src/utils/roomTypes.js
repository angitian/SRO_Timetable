/**
 * Room type definitions and color mapping.
 * Centralized so all pages (DataIngestion, ScheduleBlocks, etc.) share consistent colors.
 */

export const ROOM_TYPES = ['ห้องปกติ', 'MEP', 'EP', 'Gifted', 'IAP', 'อื่นๆ']

/**
 * Special facility room types (labs, computer rooms, music rooms, etc.)
 * Used by SpecialRoomsManager and RoomSelector for facility classification.
 */
export const FACILITY_TYPES = [
  'lab',           // ห้องแล็บ/วิทยาศาสตร์
  'computer',      // ห้องคอมพิวเตอร์
  'music',         // ห้องดนตรี
  'audiovisual',   // ห้องโสตทัศนศึกษา
  'art',           // ห้องศิลปะ
  'language',      // ห้องภาษา
  'homeeconomics', // ห้องคหกรรม
  'workshop',      // ห้องช่าง/งานช่าง
  'other',         // อื่นๆ
]

/**
 * Thai display labels for facility types.
 */
export const FACILITY_TYPE_LABELS = {
  lab: 'ห้องแล็บ/วิทยาศาสตร์',
  computer: 'ห้องคอมพิวเตอร์',
  music: 'ห้องดนตรี',
  audiovisual: 'ห้องโสตทัศนศึกษา',
  art: 'ห้องศิลปะ',
  language: 'ห้องภาษา',
  homeeconomics: 'ห้องคหกรรม',
  workshop: 'ห้องช่าง',
  other: 'อื่นๆ',
}

/**
 * Emoji icons for facility types (for badges and display).
 */
export const FACILITY_TYPE_ICONS = {
  lab: '🔬',
  computer: '💻',
  music: '🎵',
  audiovisual: '📽️',
  art: '🎨',
  language: '🗣️',
  homeeconomics: '🍳',
  workshop: '🔧',
  other: '🏟️',
}

/**
 * Color scheme per room type.
 * Each entry has:
 *   - selected:   classes for selected/active state (solid bg)
 *   - unselected: classes for default state (light bg + border)
 *   - badge:      classes for the small room-type label badge
 *   - chip:       classes for the class chip in lists
 *   - dot:        classes for a small color dot indicator
 */
export const ROOM_TYPE_COLORS = {
  'ห้องปกติ': {
    selected: 'bg-blue-600 text-white border-blue-600',
    unselected: 'bg-white border-gray-200 text-gray-600 hover:border-blue-300',
    badge: 'bg-blue-100 text-blue-700',
    chip: 'bg-gray-100 text-gray-700',
    dot: 'bg-blue-500',
  },
  MEP: {
    selected: 'bg-emerald-600 text-white border-emerald-600',
    unselected: 'bg-emerald-50 border-emerald-200 text-emerald-700 hover:border-emerald-400',
    badge: 'bg-emerald-100 text-emerald-700',
    chip: 'bg-emerald-100 text-emerald-700',
    dot: 'bg-emerald-500',
  },
  EP: {
    selected: 'bg-amber-600 text-white border-amber-600',
    unselected: 'bg-amber-50 border-amber-200 text-amber-700 hover:border-amber-400',
    badge: 'bg-amber-100 text-amber-700',
    chip: 'bg-amber-100 text-amber-700',
    dot: 'bg-amber-500',
  },
  Gifted: {
    selected: 'bg-purple-600 text-white border-purple-600',
    unselected: 'bg-purple-50 border-purple-200 text-purple-700 hover:border-purple-400',
    badge: 'bg-purple-100 text-purple-700',
    chip: 'bg-purple-100 text-purple-700',
    dot: 'bg-purple-500',
  },
  IAP: {
    selected: 'bg-rose-600 text-white border-rose-600',
    unselected: 'bg-rose-50 border-rose-200 text-rose-700 hover:border-rose-400',
    badge: 'bg-rose-100 text-rose-700',
    chip: 'bg-rose-100 text-rose-700',
    dot: 'bg-rose-500',
  },
  'อื่นๆ': {
    selected: 'bg-teal-600 text-white border-teal-600',
    unselected: 'bg-teal-50 border-teal-200 text-teal-700 hover:border-teal-400',
    badge: 'bg-teal-100 text-teal-700',
    chip: 'bg-teal-100 text-teal-700',
    dot: 'bg-teal-500',
  },
  // ── Facility (special room) types ──
  lab: {
    selected: 'bg-indigo-600 text-white border-indigo-600',
    unselected: 'bg-indigo-50 border-indigo-200 text-indigo-700 hover:border-indigo-400',
    badge: 'bg-indigo-100 text-indigo-700',
    chip: 'bg-indigo-100 text-indigo-700',
    dot: 'bg-indigo-500',
  },
  computer: {
    selected: 'bg-cyan-600 text-white border-cyan-600',
    unselected: 'bg-cyan-50 border-cyan-200 text-cyan-700 hover:border-cyan-400',
    badge: 'bg-cyan-100 text-cyan-700',
    chip: 'bg-cyan-100 text-cyan-700',
    dot: 'bg-cyan-500',
  },
  music: {
    selected: 'bg-pink-600 text-white border-pink-600',
    unselected: 'bg-pink-50 border-pink-200 text-pink-700 hover:border-pink-400',
    badge: 'bg-pink-100 text-pink-700',
    chip: 'bg-pink-100 text-pink-700',
    dot: 'bg-pink-500',
  },
  audiovisual: {
    selected: 'bg-orange-600 text-white border-orange-600',
    unselected: 'bg-orange-50 border-orange-200 text-orange-700 hover:border-orange-400',
    badge: 'bg-orange-100 text-orange-700',
    chip: 'bg-orange-100 text-orange-700',
    dot: 'bg-orange-500',
  },
  art: {
    selected: 'bg-fuchsia-600 text-white border-fuchsia-600',
    unselected: 'bg-fuchsia-50 border-fuchsia-200 text-fuchsia-700 hover:border-fuchsia-400',
    badge: 'bg-fuchsia-100 text-fuchsia-700',
    chip: 'bg-fuchsia-100 text-fuchsia-700',
    dot: 'bg-fuchsia-500',
  },
  language: {
    selected: 'bg-lime-600 text-white border-lime-600',
    unselected: 'bg-lime-50 border-lime-200 text-lime-700 hover:border-lime-400',
    badge: 'bg-lime-100 text-lime-700',
    chip: 'bg-lime-100 text-lime-700',
    dot: 'bg-lime-500',
  },
  homeeconomics: {
    selected: 'bg-yellow-600 text-white border-yellow-600',
    unselected: 'bg-yellow-50 border-yellow-200 text-yellow-700 hover:border-yellow-400',
    badge: 'bg-yellow-100 text-yellow-700',
    chip: 'bg-yellow-100 text-yellow-700',
    dot: 'bg-yellow-500',
  },
  workshop: {
    selected: 'bg-stone-600 text-white border-stone-600',
    unselected: 'bg-stone-50 border-stone-200 text-stone-700 hover:border-stone-400',
    badge: 'bg-stone-100 text-stone-700',
    chip: 'bg-stone-100 text-stone-700',
    dot: 'bg-stone-500',
  },
  other: {
    selected: 'bg-slate-600 text-white border-slate-600',
    unselected: 'bg-slate-50 border-slate-200 text-slate-700 hover:border-slate-400',
    badge: 'bg-slate-100 text-slate-700',
    chip: 'bg-slate-100 text-slate-700',
    dot: 'bg-slate-500',
  },
}

// Fallback color for unknown room types (e.g. custom types entered via "อื่นๆ")
const FALLBACK_COLOR = ROOM_TYPE_COLORS['อื่นๆ']

// Aliases: treat these as "ห้องปกติ" (normal)
const NORMAL_ALIASES = ['ห้องปกติ', 'classroom', 'normal', '', null, undefined]

/**
 * Get the color object for a given room type.
 * Falls back to the "อื่นๆ" color for unknown/custom types.
 * Treats 'classroom' and empty values as 'ห้องปกติ'.
 */
export function getRoomTypeColor(roomType) {
  if (NORMAL_ALIASES.includes(roomType)) {
    return ROOM_TYPE_COLORS['ห้องปกติ']
  }
  return ROOM_TYPE_COLORS[roomType] || FALLBACK_COLOR
}

/**
 * Check if a room type is a "special" (non-normal) type.
 */
export function isSpecialRoomType(roomType) {
  return !NORMAL_ALIASES.includes(roomType)
}
