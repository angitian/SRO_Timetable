"""Pre-flight validation for TimetableRequest.

Detects data-level conflicts that would provably make the CP-SAT solver
return INFEASIBLE, *before* invoking the solver. Returns a DiagnosticsReport
that explains the root cause in human-readable terms so the frontend can
show actionable messages instead of a bare "INFEASIBLE" status.

The slot-availability logic mirrors `TimetableSolver._is_valid_slot`
(solver.py) so the pre-flight counts match what the solver would actually
allow.
"""
from __future__ import annotations

from typing import Any

from models import (
    ClassCapacityIssue,
    DiagnosticsReport,
    FixedSlotConflict,
    LessonBlock,
    PeriodType,
    RoomOverload,
    ScheduleBlock,
    Teacher,
    TeacherOverload,
    TimetableRequest,
)


# ── Helpers ────────────────────────────────────────────────────────────────

def _time_to_minutes(hhmm: str) -> int:
    parts = hhmm.split(":")
    return int(parts[0]) * 60 + int(parts[1])


def _build_class_to_block(request: TimetableRequest) -> dict[str, str]:
    mapping: dict[str, str] = {}
    for blk in request.schedule_blocks:
        for cid in blk.target_classes:
            mapping[cid] = blk.id
    return mapping


def _build_assembly_and_class_blocks(
    request: TimetableRequest,
) -> tuple[set[tuple[int, int]], dict[str, set[tuple[int, int]]]]:
    """Return (assembly_set, fixed_slots_per_class) from request.fixed_slots."""
    assembly_set: set[tuple[int, int]] = set()
    fixed_slots_per_class: dict[str, set[tuple[int, int]]] = {}
    for fs in request.fixed_slots:
        if not fs.class_ids:
            assembly_set.add((fs.day, fs.period))
        else:
            for cid in fs.class_ids:
                fixed_slots_per_class.setdefault(cid, set()).add((fs.day, fs.period))
    return assembly_set, fixed_slots_per_class


def _valid_periods_for_day(
    blk: ScheduleBlock, day: int
) -> list[int]:
    """Return STUDY period numbers for a given day in a block (per-day aware)."""
    if not blk.apply_to_all_days and blk.periods_by_day:
        day_periods = blk.periods_by_day.get(str(day), blk.periods)
    else:
        day_periods = blk.periods
    return [p.period_no for p in day_periods if p.type == PeriodType.STUDY]


def _lunch_periods_for_day(
    blk: ScheduleBlock, day: int
) -> list[int]:
    if not blk.apply_to_all_days and blk.periods_by_day:
        day_periods = blk.periods_by_day.get(str(day), blk.periods)
    else:
        day_periods = blk.periods
    return [p.period_no for p in day_periods if p.type == PeriodType.LUNCH]


def _lunch_periods_in_window(blk: ScheduleBlock, day: int) -> list[int]:
    """Lunch periods that fall in the 11:00-13:30 window (matches solver)."""
    LUNCH_START = 11 * 60
    LUNCH_END = 13 * 60 + 30
    if not blk.apply_to_all_days and blk.periods_by_day:
        day_periods = blk.periods_by_day.get(str(day), blk.periods)
    else:
        day_periods = blk.periods
    out: list[int] = []
    for p in day_periods:
        if p.type != PeriodType.LUNCH:
            continue
        s = _time_to_minutes(p.start_time)
        e = _time_to_minutes(p.end_time)
        if s >= LUNCH_START and e <= LUNCH_END:
            out.append(p.period_no)
    return out


# ── Per-teacher available slot count ───────────────────────────────────────

def _count_teacher_available_slots(
    teacher: Teacher,
    request: TimetableRequest,
    class_to_block: dict[str, str],
    block_by_id: dict[str, ScheduleBlock],
    assembly_set: set[tuple[int, int]],
    fixed_slots_per_class: dict[str, set[tuple[int, int]]],
) -> int:
    """Count net available teaching slots for a teacher across the week.

    Mirrors TimetableSolver._is_valid_slot: a (day, period) is unavailable
    if it hits any of:
      - teacher.unavailable_slots
      - teacher.admin_free_slots
      - no_first_period and p == 1
      - no_last_period and p == max valid period of that day
      - PE hot period (skipped here — subject-specific, not teacher-level)
      - assembly / class-specific fixed slot for *any* class the teacher teaches

    Lunch guarantee (multi-block): reserve >= 1 lunch slot per day in the
    11:00-13:30 window for each block the teacher teaches in.
    """
    # Classes this teacher teaches (so we know which fixed slots apply)
    taught_class_ids: set[str] = set()
    for lb in request.lesson_blocks:
        if lb.teacher_id == teacher.id:
            taught_class_ids.add(lb.class_id)

    unavailable = set(teacher.unavailable_slots)
    admin_free = set(teacher.admin_free_slots)

    # Determine days
    if request.schedule_blocks:
        days = list(range(1, request.schedule_blocks[0].days_per_week + 1))
    else:
        days = list(range(1, request.schedule_config.days_per_week + 1))

    total = 0
    for d in days:
        # Collect valid study periods across all blocks the teacher touches
        day_study_periods: set[tuple[str, int]] = set()  # (block_id, period_no)
        teacher_blocks: set[str] = set()
        for cid in taught_class_ids:
            bid = class_to_block.get(cid)
            if not bid:
                continue
            teacher_blocks.add(bid)

        if teacher_blocks:
            for bid in teacher_blocks:
                blk = block_by_id.get(bid)
                if not blk:
                    continue
                for p in _valid_periods_for_day(blk, d):
                    day_study_periods.add((bid, p))
        else:
            # Legacy single-block mode
            lunch_set = set(request.schedule_config.lunch_periods)
            all_periods = list(range(1, request.schedule_config.periods_per_day + 1))
            for p in all_periods:
                if p not in lunch_set:
                    day_study_periods.add(("_legacy", p))

        if not day_study_periods:
            continue

        # Determine "last period" for no_last_period check per block
        # We use the max period number seen in this day across teacher's blocks
        max_period_this_day = max(p for _, p in day_study_periods)

        # Count usable slots
        day_usable = 0
        for (bid, p) in day_study_periods:
            key = f"{d}-{p}"
            if key in unavailable or key in admin_free:
                continue
            if teacher.no_first_period and p == 1:
                continue
            if teacher.no_last_period and p == max_period_this_day:
                continue
            # Assembly blocks everyone
            if (d, p) in assembly_set:
                continue
            # Class-specific fixed slot: if ANY class the teacher teaches
            # is blocked at (d, p), the teacher can't teach then
            blocked_by_class = False
            for cid in taught_class_ids:
                cls_blocks = fixed_slots_per_class.get(cid, set())
                if (d, p) in cls_blocks:
                    blocked_by_class = True
                    break
            if blocked_by_class:
                continue
            day_usable += 1

        # Lunch guarantee: reserve >= 1 lunch slot per day in window
        # across all blocks the teacher teaches in
        if teacher_blocks:
            lunch_slots_in_window: set[tuple[str, int]] = set()
            for bid in teacher_blocks:
                blk = block_by_id.get(bid)
                if not blk:
                    continue
                for lp in _lunch_periods_in_window(blk, d):
                    lunch_slots_in_window.add((bid, lp))
            # Reserve 1 slot per day if any lunch-window slot exists
            if lunch_slots_in_window and day_usable > 0:
                day_usable -= 1

        total += day_usable

    return total


# ── Main entry point ───────────────────────────────────────────────────────

def run_preflight(request: TimetableRequest) -> DiagnosticsReport:
    """Run all pre-flight checks and return a DiagnosticsReport."""
    report = DiagnosticsReport()

    teacher_by_id = {t.id: t for t in request.teachers}
    class_by_id = {c.id: c for c in request.classes}
    room_by_id = {r.id: r for r in request.rooms}
    block_by_id = {b.id: b for b in request.schedule_blocks}
    class_to_block = _build_class_to_block(request)
    assembly_set, fixed_slots_per_class = _build_assembly_and_class_blocks(request)

    # ── 1. Class capacity ────────────────────────────────────────────────
    # For each class: sum(periods_per_week) of its lesson blocks must be
    # <= (study periods per day * days_per_week) - fixed activity slots
    # affecting that class.
    class_needed: dict[str, int] = {}
    for lb in request.lesson_blocks:
        class_needed[lb.class_id] = class_needed.get(lb.class_id, 0) + lb.periods_per_week

    for cid, needed in class_needed.items():
        cls = class_by_id.get(cid)
        if not cls:
            continue
        bid = class_to_block.get(cid)
        if bid and block_by_id.get(bid):
            blk = block_by_id[bid]
            days = blk.days_per_week
            # Use day 1 as representative for study period count when
            # apply_to_all_days; otherwise sum across days
            if blk.apply_to_all_days:
                study_per_day = len(_valid_periods_for_day(blk, 1))
                study_total = study_per_day * days
            else:
                study_total = sum(len(_valid_periods_for_day(blk, d)) for d in range(1, days + 1))
        else:
            # Legacy
            days = request.schedule_config.days_per_week
            lunch_set = set(request.schedule_config.lunch_periods)
            study_per_day = len([p for p in range(1, request.schedule_config.periods_per_day + 1) if p not in lunch_set])
            study_total = study_per_day * days

        # Subtract fixed activity slots affecting this class
        cls_fixed = len(fixed_slots_per_class.get(cid, set()))
        # Assembly affects every class
        assembly_count = len(assembly_set)
        available = study_total - cls_fixed - assembly_count
        if needed > available:
            report.class_capacity_issues.append(
                ClassCapacityIssue(
                    class_id=cid,
                    class_name=cls.name,
                    needed_periods=needed,
                    available_slots=available,
                    overflow=needed - available,
                )
            )

    # ── 2. Teacher overloads ─────────────────────────────────────────────
    teacher_needed: dict[str, int] = {}
    for lb in request.lesson_blocks:
        teacher_needed[lb.teacher_id] = teacher_needed.get(lb.teacher_id, 0) + lb.periods_per_week

    for teacher in request.teachers:
        needed = teacher_needed.get(teacher.id, 0)
        if needed == 0:
            continue
        available = _count_teacher_available_slots(
            teacher, request, class_to_block, block_by_id, assembly_set, fixed_slots_per_class
        )
        reason = ""
        if teacher.max_periods_per_week > 0 and needed > teacher.max_periods_per_week:
            reason = "over_max"
        elif needed > available:
            reason = "over_available"
        elif teacher.min_periods_per_week > 0 and needed < teacher.min_periods_per_week:
            reason = "under_min"
        if reason:
            report.teacher_overloads.append(
                TeacherOverload(
                    teacher_id=teacher.id,
                    teacher_name=teacher.name,
                    needed_periods=needed,
                    available_slots=available,
                    max_periods_per_week=teacher.max_periods_per_week,
                    min_periods_per_week=teacher.min_periods_per_week,
                    reason=reason,
                )
            )

    # ── 3. Room overloads ────────────────────────────────────────────────
    room_needed: dict[str, int] = {}
    for lb in request.lesson_blocks:
        if lb.room_id:
            room_needed[lb.room_id] = room_needed.get(lb.room_id, 0) + lb.periods_per_week

    for rid, needed in room_needed.items():
        room = room_by_id.get(rid)
        # Available slots for a room = study periods * days (room is shared
        # across all classes that use it; same H3 logic as solver).
        if request.schedule_blocks:
            blk = request.schedule_blocks[0]
            days = blk.days_per_week
            if blk.apply_to_all_days:
                study_per_day = len(_valid_periods_for_day(blk, 1))
            else:
                study_per_day = max(
                    (len(_valid_periods_for_day(blk, d)) for d in range(1, days + 1)),
                    default=0,
                )
            available = study_per_day * days
        else:
            days = request.schedule_config.days_per_week
            lunch_set = set(request.schedule_config.lunch_periods)
            study_per_day = len([p for p in range(1, request.schedule_config.periods_per_day + 1) if p not in lunch_set])
            available = study_per_day * days
        # Subtract assembly (room can't be used during assembly)
        available -= len(assembly_set)
        if needed > available:
            report.room_overloads.append(
                RoomOverload(
                    room_id=rid,
                    room_name=room.name if room else rid,
                    needed_periods=needed,
                    available_slots=available,
                )
            )

    # ── 4. Fixed (pre-assigned) lesson block conflicts ───────────────────
    for lb in request.lesson_blocks:
        if not lb.is_fixed:
            continue
        if lb.fixed_day is None or lb.fixed_period is None:
            continue
        d, p = lb.fixed_day, lb.fixed_period
        teacher = teacher_by_id.get(lb.teacher_id)
        # Teacher unavailable?
        if teacher:
            key = f"{d}-{p}"
            if key in teacher.unavailable_slots or key in teacher.admin_free_slots:
                report.fixed_slot_conflicts.append(
                    FixedSlotConflict(
                        lesson_block_id=lb.id,
                        day=d,
                        period=p,
                        reason="teacher_unavailable",
                    )
                )
                continue
            if teacher.no_first_period and p == 1:
                report.fixed_slot_conflicts.append(
                    FixedSlotConflict(
                        lesson_block_id=lb.id, day=d, period=p, reason="teacher_unavailable",
                    )
                )
                continue
        # Assembly?
        if (d, p) in assembly_set:
            report.fixed_slot_conflicts.append(
                FixedSlotConflict(
                    lesson_block_id=lb.id, day=d, period=p, reason="assembly",
                )
            )
            continue
        # Class-specific fixed slot collision
        cls_blocks = fixed_slots_per_class.get(lb.class_id, set())
        if (d, p) in cls_blocks:
            report.fixed_slot_conflicts.append(
                FixedSlotConflict(
                    lesson_block_id=lb.id, day=d, period=p, reason="class_blocked",
                )
            )
            continue
        # Lunch period?
        bid = lb.block_id or class_to_block.get(lb.class_id)
        if bid and block_by_id.get(bid):
            blk = block_by_id[bid]
            lunch_ps = set(_lunch_periods_for_day(blk, d))
            if p in lunch_ps:
                report.fixed_slot_conflicts.append(
                    FixedSlotConflict(
                        lesson_block_id=lb.id, day=d, period=p, reason="lunch",
                    )
                )
                continue
            # Double-period needs p+1 to also be a valid study period
            if lb.is_double_period:
                valid_ps = set(_valid_periods_for_day(blk, d))
                if (p + 1) not in valid_ps:
                    report.fixed_slot_conflicts.append(
                        FixedSlotConflict(
                            lesson_block_id=lb.id, day=d, period=p, reason="no_pair_slot",
                        )
                    )
                    continue
        else:
            # Legacy
            lunch_set = set(request.schedule_config.lunch_periods)
            if p in lunch_set:
                report.fixed_slot_conflicts.append(
                    FixedSlotConflict(
                        lesson_block_id=lb.id, day=d, period=p, reason="lunch",
                    )
                )
                continue

    return report
