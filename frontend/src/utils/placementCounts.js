/**
 * Single source of truth for "how many periods of each lesson block are
 * placed" — combines solver result slots and manual user placements with
 * position-level deduplication.
 *
 * A user placement at the same (day, period) as an existing solver slot of
 * the same block counts ONCE — pinning a solver slot locks its position, it
 * is not a new period. Placements at new positions add to the count even
 * when the block already has solver slots (the previous block-level dedup
 * in TimetableView skipped them entirely, so manually completing a
 * partially-placed block was never reflected in the banners).
 *
 * Slots whose lesson_block_id is not in lessonBlocks (orphans) are ignored.
 *
 * Used by TimetableView (placed-count banner, unplaced report, class/teacher
 * status pills, unassigned count), PrintStudio (status pills) and
 * UnassignedSidebar (remaining counts) so every surface shows the same
 * numbers.
 */
export function computePlacedCounts(lessonBlocks, resultSlots, userPlacements) {
  const lbById = new Map((lessonBlocks || []).map((lb) => [lb.id, lb]))

  // lesson_block_id → Set of "day-period" positions covered by solver slots
  const solverPositions = new Map()
  for (const s of resultSlots || []) {
    if (!lbById.has(s.lesson_block_id)) continue
    let set = solverPositions.get(s.lesson_block_id)
    if (!set) {
      set = new Set()
      solverPositions.set(s.lesson_block_id, set)
    }
    set.add(`${s.day}-${s.period}`)
  }

  const byBlock = {}
  const byClass = {}
  const byTeacher = {}

  for (const lb of lessonBlocks || []) {
    const positions = new Set(solverPositions.get(lb.id) || [])
    for (const p of userPlacements?.[lb.id] || []) {
      positions.add(`${p.day}-${p.period}`)
    }
    const placed = positions.size
    byBlock[lb.id] = placed
    byClass[lb.class_id] = (byClass[lb.class_id] || 0) + placed
    byTeacher[lb.teacher_id] = (byTeacher[lb.teacher_id] || 0) + placed
    if (lb.co_teacher_id) {
      byTeacher[lb.co_teacher_id] = (byTeacher[lb.co_teacher_id] || 0) + placed
    }
  }

  const totalNeeded = (lessonBlocks || []).reduce(
    (sum, lb) => sum + (lb.periods_per_week || 0),
    0,
  )
  const totalPlaced = Object.values(byBlock).reduce((sum, n) => sum + n, 0)

  return { byBlock, byClass, byTeacher, totalPlaced, totalNeeded }
}
