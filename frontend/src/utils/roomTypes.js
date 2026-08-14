/**
 * Room type definitions and color mapping.
 * Centralized so all pages (DataIngestion, ScheduleBlocks, etc.) share consistent colors.
 */

export const ROOM_TYPES = ['ห้องปกติ', 'MEP', 'EP', 'Gifted', 'IAP', 'อื่นๆ']

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
