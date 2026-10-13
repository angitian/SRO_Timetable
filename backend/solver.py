from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import Any

from ortools.sat.python import cp_model

from models import (
    PeriodType,
    ScheduledSlot,
    SolverMetrics,
    TeacherLoadSummary,
    TimetableRequest,
    TimetableResponse,
)
from utils import (
    time_to_minutes as _time_to_minutes,
    time_intervals_overlap,
    parse_day_period,
    get_periods_for_block_on_day,
    filter_study_periods,
    filter_lunch_periods,
)


class _FirstSolutionCallback(cp_model.CpSolverSolutionCallback):
    """Callback that stops the search after the first feasible solution is found.

    Used in FAST optimization mode for quick response (< 0.5s target).
    """

    def __init__(self):
        super().__init__()

    def on_solution_callback(self):
        self.stop_search()


@dataclass
class SlotVar:
    """Wraps a boolean decision variable for a (lesson_block_idx, day, period)."""
    lb_idx: int
    day: int
    period: int
    var: cp_model.BoolVar


class TimetableSolver:
    """OR-Tools CP-SAT solver for school timetabling.

    Phase 1: H1-H6, Pre-assignment, Teaching Load bounds, penalty-weighted objective.
    Phase 2: H7 (teacher unavailable), H8 (double-period continuity), H11 (PE thermal),
             S3 (max consecutive teaching — soft), T4/T5 (admin teacher free slots).
    """

    def __init__(self, request: TimetableRequest):
        self.req = request
        self.model = cp_model.CpModel()
        self.solver = cp_model.CpSolver()

        # ── Index helpers ───────────────────────────────────────────────
        self.lb_list = request.lesson_blocks
        self.teacher_by_id = {t.id: t for t in request.teachers}
        self.subject_by_id = {s.id: s for s in request.subjects}
        self.class_by_id = {c.id: c for c in request.classes}

        # ── Multi-block support ─────────────────────────────────────────
        # If schedule_blocks provided, use them; otherwise fall back to legacy schedule_config
        self.use_blocks = bool(request.schedule_blocks)
        self.class_to_block: dict[str, str] = {}
        self.block_by_id: dict[str, Any] = {}
        # block_period_times: (block_id, period_no) -> (start_min, end_min)
        self.block_period_times: dict[tuple[str, int], tuple[int, int]] = {}
        # Global period -> (block_id, start_min, end_min) mapping for legacy compat
        self.period_time_map: dict[tuple[str, int], tuple[int, int]] = {}

        # Per-day period support: valid_periods_by_day and lunch_set_by_day
        self.valid_periods_by_day: dict[int, list[int]] = {}
        self.lunch_set_by_day: dict[int, set[int]] = {}
        self.period_time_map_by_day: dict[tuple[str, int, int], tuple[int, int]] = {}

        if self.use_blocks:
            self._build_block_mappings(request)
        else:
            self._build_legacy_mappings(request)

        # Auto-assign block_id to lesson blocks if not set
        for lb in self.lb_list:
            if not lb.block_id and lb.class_id in self.class_to_block:
                lb.block_id = self.class_to_block[lb.class_id]

        self._build_fixed_slot_maps(request)
        self._build_pe_hot_set(request)

        # ── Decision variables ──────────────────────────────────────────
        self.x: dict[tuple[int, int, int], cp_model.BoolVar] = {}
        self.pair: dict[tuple[int, int, int], cp_model.BoolVar] = {}

        self._penalty_terms: list[tuple[cp_model.LinearExpr, int]] = []
        self._num_constraints = 0

    # ── Initialization helpers (extracted from __init__) ───────────────

    def _build_block_mappings(self, request: TimetableRequest) -> None:
        """Build block/class/period mappings when schedule_blocks is provided."""
        if not request.schedule_blocks:
            raise ValueError("use_blocks is True but schedule_blocks is empty")

        for blk in request.schedule_blocks:
            self.block_by_id[blk.id] = blk
            for cid in blk.target_classes:
                self.class_to_block[cid] = blk.id
            for p in blk.periods:
                self.block_period_times[(blk.id, p.period_no)] = (
                    _time_to_minutes(p.start_time),
                    _time_to_minutes(p.end_time),
                )

        first_block = request.schedule_blocks[0]
        self.days = list(range(1, first_block.days_per_week + 1))

        any_per_day = any(not blk.apply_to_all_days for blk in request.schedule_blocks)
        if any_per_day:
            self._build_per_day_period_maps(request)
        else:
            self.valid_periods = filter_study_periods(first_block.periods)
            self.lunch_set = set(filter_lunch_periods(first_block.periods))

        # Build period_time_map for each block
        for blk in request.schedule_blocks:
            for p in blk.periods:
                self.period_time_map[(blk.id, p.period_no)] = (
                    _time_to_minutes(p.start_time),
                    _time_to_minutes(p.end_time),
                )

    def _build_per_day_period_maps(self, request: TimetableRequest) -> None:
        """Build per-day valid periods, lunch sets, and time maps."""
        for d in self.days:
            day_valid: set[int] = set()
            day_lunch: set[int] = set()
            for blk in request.schedule_blocks:
                day_periods = get_periods_for_block_on_day(blk, d)
                for p in day_periods:
                    if p.type == PeriodType.STUDY:
                        day_valid.add(p.period_no)
                    elif p.type == PeriodType.LUNCH:
                        day_lunch.add(p.period_no)
                    self.period_time_map_by_day[(blk.id, d, p.period_no)] = (
                        _time_to_minutes(p.start_time),
                        _time_to_minutes(p.end_time),
                    )
            self.valid_periods_by_day[d] = sorted(day_valid)
            self.lunch_set_by_day[d] = day_lunch
        # Flat valid_periods = union of all days' valid periods (for compat)
        self.valid_periods = sorted(set().union(*[set(v) for v in self.valid_periods_by_day.values()]))
        self.lunch_set = set().union(*[set(v) for v in self.lunch_set_by_day.values()])

    def _build_legacy_mappings(self, request: TimetableRequest) -> None:
        """Build period mappings for legacy single-block mode."""
        self.days = list(range(1, request.schedule_config.days_per_week + 1))
        all_periods = list(range(1, request.schedule_config.periods_per_day + 1))
        self.lunch_set = set(request.schedule_config.lunch_periods)
        self.valid_periods = [p for p in all_periods if p not in self.lunch_set]

    def _build_fixed_slot_maps(self, request: TimetableRequest) -> None:
        """Build assembly_set and fixed_slots_per_class from request.fixed_slots.

        Supports multi-period fixed slots (fs.periods) — every effective period
        is registered. Class-specific slots (class_ids non-empty) are mapped per
        class; empty class_ids block ALL classes (assembly-style).

        Also builds fixed_slots_per_teacher from fs.class_teachers so a
        supervising teacher can't be double-booked at the same real time.
        """
        self.assembly_set: set[tuple[int, int]] = set()
        for fs in request.fixed_slots:
            if not fs.class_ids:
                for p in fs.effective_periods():
                    self.assembly_set.add((fs.day, p))
        self.fixed_slots_per_class: dict[str, set[tuple[int, int]]] = {}
        for fs in request.fixed_slots:
            for cid in fs.class_ids:
                for p in fs.effective_periods():
                    self.fixed_slots_per_class.setdefault(cid, set()).add((fs.day, p))
        # ครูผู้ดูแลกิจกรรม: ห้ามถูกจัดคาบอื่นชนเวลาที่ดูแลกิจกรรม
        self.fixed_slots_per_teacher: dict[str, set[tuple[int, int]]] = {}
        for fs in request.fixed_slots:
            for tid in fs.supervisor_teacher_ids():
                for p in fs.effective_periods():
                    self.fixed_slots_per_teacher.setdefault(tid, set()).add((fs.day, p))

    def _build_pe_hot_set(self, request: TimetableRequest) -> None:
        """Build pe_hot_set from schedule_config (legacy mode only)."""
        self.pe_hot_set: set[tuple[int, int]] = set()
        if not self.use_blocks:
            for s in request.schedule_config.pe_hot_periods:
                parsed = parse_day_period(s)
                if parsed is not None:
                    d, p = parsed
                    self.pe_hot_set.add((d, p))

    # ── Helpers ───────────────────────────────────────────────────────────

    def _build_teacher_lb_map(self) -> dict[str, list[int]]:
        """Map every teacher (main teacher_id AND co_teacher_id) to the lesson
        block indices they participate in. Co-taught blocks appear under both
        teachers so clashes, workload bounds, and load summaries count both."""
        teacher_lbs: dict[str, list[int]] = {}
        for i, lb in enumerate(self.lb_list):
            teacher_lbs.setdefault(lb.teacher_id, []).append(i)
            if lb.co_teacher_id:
                teacher_lbs.setdefault(lb.co_teacher_id, []).append(i)
        return teacher_lbs

    def _is_blocked_for_class(self, class_id: str, d: int, p: int) -> bool:
        if (d, p) in self.assembly_set:
            return True
        cls_blocks = self.fixed_slots_per_class.get(class_id, set())
        return (d, p) in cls_blocks

    def _is_teacher_unavailable(self, teacher_id: str, d: int, p: int) -> bool:
        teacher = self.teacher_by_id.get(teacher_id)
        if not teacher:
            return False
        if f"{d}-{p}" in teacher.unavailable_slots:
            return True
        # T4: admin free slots are also unavailable for teaching
        if f"{d}-{p}" in teacher.admin_free_slots:
            return True
        return False

    def _is_pe_hot(self, lb_idx: int, d: int, p: int) -> bool:
        lb = self.lb_list[lb_idx]
        subj = self.subject_by_id.get(lb.subject_id)
        if subj and subj.category.value == "pe":
            return (d, p) in self.pe_hot_set
        return False

    def _is_first_period_blocked(self, teacher_id: str, p: int) -> bool:
        """Check if teacher has no_first_period flag and p is the first period (1)."""
        teacher = self.teacher_by_id.get(teacher_id)
        if not teacher:
            return False
        return teacher.no_first_period and p == 1

    def _is_last_period_blocked(self, teacher_id: str, d: int, p: int) -> bool:
        """Check if teacher has no_last_period flag and p is the last valid period of the day."""
        teacher = self.teacher_by_id.get(teacher_id)
        if not teacher:
            return False
        if not teacher.no_last_period:
            return False
        day_periods = self._get_valid_periods_for_day(d)
        if not day_periods:
            return False
        return p == max(day_periods)

    def _is_teacher_hard_blocked(self, teacher_id: str, d: int, p: int) -> bool:
        """Hard availability filters for one teacher: unavailable/admin-free
        slots, no_first_period / no_last_period preferences, and fixed-slot
        supervision duty (ครูผู้ดูแลกิจกรรม)."""
        if self._is_teacher_unavailable(teacher_id, d, p):
            return True
        if self._is_first_period_blocked(teacher_id, p):
            return True
        if self._is_last_period_blocked(teacher_id, d, p):
            return True
        if (d, p) in self.fixed_slots_per_teacher.get(teacher_id, set()):
            return True
        return False

    def _is_valid_slot(self, lb_idx: int, d: int, p: int) -> bool:
        lb = self.lb_list[lb_idx]
        if self._is_blocked_for_class(lb.class_id, d, p):
            return False
        # Main teacher AND co-teacher must both be available
        if self._is_teacher_hard_blocked(lb.teacher_id, d, p):
            return False
        if lb.co_teacher_id and self._is_teacher_hard_blocked(lb.co_teacher_id, d, p):
            return False
        if self._is_pe_hot(lb_idx, d, p):
            return False
        return True

    # ── Variable creation ─────────────────────────────────────────────────

    def _create_variables(self) -> None:
        for i, lb in enumerate(self.lb_list):
            if lb.is_double_period:
                self._create_double_period_vars(i, lb)
                # If periods_per_week is odd, also create single-period vars
                # so the remaining 1 period can be scheduled as a single slot
                if lb.periods_per_week % 2 == 1:
                    self._create_single_period_vars(i, lb)
            else:
                self._create_single_period_vars(i, lb)

    def _get_valid_periods_for_day(self, d: int) -> list[int]:
        """Return valid STUDY periods for a given day, accounting for per-day variation."""
        if self.valid_periods_by_day:
            return self.valid_periods_by_day.get(d, [])
        return self.valid_periods

    def _create_single_period_vars(self, i: int, lb: Any) -> None:
        for d in self.days:
            day_periods = self._get_valid_periods_for_day(d)
            for p in day_periods:
                if self._is_valid_slot(i, d, p):
                    self.x[(i, d, p)] = self.model.NewBoolVar(f"x_{i}_{d}_{p}")

    def _create_double_period_vars(self, i: int, lb: Any) -> None:
        """For double periods, create pair variables covering (p, p+1)."""
        for d in self.days:
            day_periods = self._get_valid_periods_for_day(d)
            day_periods_set = set(day_periods)
            for p in day_periods:
                if p + 1 not in day_periods_set:
                    continue
                if not self._is_valid_slot(i, d, p):
                    continue
                if not self._is_valid_slot(i, d, p + 1):
                    continue
                self.pair[(i, d, p)] = self.model.NewBoolVar(f"pair_{i}_{d}_{p}")

    # ── Hard constraints ──────────────────────────────────────────────────

    def _add_hard_constraints(self) -> None:
        self._add_h1_teacher_clash()
        self._add_h2_class_clash()
        self._add_h3_room_clash()
        self._add_h4_period_count()
        self._add_h5_max_per_day()
        self._add_h6_pre_assignment()
        self._add_teaching_load_bounds()
        self._add_t5_discipline_free_slots()
        if self.use_blocks:
            self._add_teacher_lunch_guarantee()

    def _get_all_active_vars_for_lb(self, i: int) -> list[cp_model.BoolVar]:
        """Return all decision variables (single + pair-derived) for lesson block i."""
        vars_list = list(self.x.get((i, d, p)) for (ii, d, p) in self.x if ii == i)
        vars_list = [v for v in vars_list if v is not None]
        # For double periods, each pair var represents 2 periods
        pair_vars = [v for (ii, d, p), v in self.pair.items() if ii == i]
        return vars_list + pair_vars

    def _add_h1_teacher_clash(self) -> None:
        """No teacher teaches two lesson blocks at the same (day, period).

        Co-taught blocks count for both the main teacher and the co-teacher,
        so neither can be double-booked at the same real time.

        In multi-block mode, checks real time interval overlap across blocks.
        """
        teacher_lbs = self._build_teacher_lb_map()

        if not self.use_blocks:
            # Legacy: same day-period check (uses shared clash helper)
            self._add_entity_clash_constraint(teacher_lbs)
            return

        # Multi-block: check time overlap between any two lesson blocks of the same teacher
        # For each pair of lesson blocks (i, j) with same teacher, for each day,
        # if their time intervals overlap, they can't both be scheduled at that day-period
        for teacher_id, lb_indices in teacher_lbs.items():
            for idx_a in range(len(lb_indices)):
                for idx_b in range(idx_a + 1, len(lb_indices)):
                    i = lb_indices[idx_a]
                    j = lb_indices[idx_b]
                    lb_i = self.lb_list[i]
                    lb_j = self.lb_list[j]
                    block_i = lb_i.block_id
                    block_j = lb_j.block_id
                    if not block_i or not block_j:
                        continue
                    for d in self.days:
                        day_periods_i = self._get_valid_periods_for_day(d)
                        day_periods_j = self._get_valid_periods_for_day(d)
                        for p_i in day_periods_i:
                            for p_j in day_periods_j:
                                # Use per-day time map if available, else fallback
                                time_i = self.period_time_map_by_day.get((block_i, d, p_i)) or self.period_time_map.get((block_i, p_i))
                                time_j = self.period_time_map_by_day.get((block_j, d, p_j)) or self.period_time_map.get((block_j, p_j))
                                if not time_i or not time_j:
                                    continue
                                # Check overlap using shared helper
                                if time_intervals_overlap(time_i[0], time_i[1], time_j[0], time_j[1]):
                                    # These slots overlap in real time → can't both be active
                                    vars_i = self._get_vars_for_lb_at_slot(i, d, p_i)
                                    vars_j = self._get_vars_for_lb_at_slot(j, d, p_j)
                                    if vars_i and vars_j:
                                        self.model.Add(sum(vars_i) + sum(vars_j) <= 1)
                                        self._num_constraints += 1

    def _add_entity_clash_constraint(
        self,
        entity_lbs: dict[str, list[int]],
    ) -> None:
        """Generic clash constraint: no two lesson blocks in the same entity
        (teacher/class/room) are active at the same (day, period).

        Used by H1 (legacy mode), H2 (class), and H3 (room).
        """
        for d in self.days:
            day_periods = self._get_valid_periods_for_day(d)
            for p in day_periods:
                for entity_id, lb_indices in entity_lbs.items():
                    active = []
                    for i in lb_indices:
                        if (i, d, p) in self.x:
                            active.append(self.x[(i, d, p)])
                        if (i, d, p) in self.pair:
                            active.append(self.pair[(i, d, p)])
                        if (i, d, p - 1) in self.pair:
                            active.append(self.pair[(i, d, p - 1)])
                    if len(active) > 1:
                        self.model.Add(sum(active) <= 1)
                        self._num_constraints += 1

    def _add_h2_class_clash(self) -> None:
        """No class has two lesson blocks at the same (day, period)."""
        class_lbs: dict[str, list[int]] = {}
        for i, lb in enumerate(self.lb_list):
            class_lbs.setdefault(lb.class_id, []).append(i)
        self._add_entity_clash_constraint(class_lbs)

    def _add_h3_room_clash(self) -> None:
        """No room hosts two lesson blocks at the same (day, period)."""
        room_lbs: dict[str, list[int]] = {}
        for i, lb in enumerate(self.lb_list):
            if lb.room_id:
                room_lbs.setdefault(lb.room_id, []).append(i)
        self._add_entity_clash_constraint(room_lbs)

    def _add_h4_period_count(self) -> None:
        """Each lesson block should be scheduled exactly periods_per_week times.

        Uses a SOFT constraint (<= with penalty for under-assignment) so that
        when a class has more lesson periods than available slots, the solver
        still produces a partial timetable instead of going INFEASIBLE. The
        penalty encourages the solver to place as many periods as possible.
        """
        for i, lb in enumerate(self.lb_list):
            if lb.is_double_period:
                pair_vars = [v for (ii, d, p), v in self.pair.items() if ii == i]
                single_vars = [v for (ii, d, p), v in self.x.items() if ii == i]
                if pair_vars and single_vars:
                    # Mixed: pairs (2 periods each) + singles (1 period each)
                    total = sum(pair_vars) * 2 + sum(single_vars)
                    self.model.Add(total <= lb.periods_per_week)
                    self._num_constraints += 1
                    # Penalize under-assignment
                    under = self.model.NewIntVar(0, lb.periods_per_week, f"under_{i}")
                    self.model.Add(total + under == lb.periods_per_week)
                    self._penalty_terms.append((under, 50))
                elif pair_vars:
                    total = sum(pair_vars) * 2
                    self.model.Add(total <= lb.periods_per_week)
                    self._num_constraints += 1
                    under = self.model.NewIntVar(0, lb.periods_per_week, f"under_{i}")
                    self.model.Add(total + under == lb.periods_per_week)
                    self._penalty_terms.append((under, 50))
                elif single_vars:
                    total = sum(single_vars)
                    self.model.Add(total <= lb.periods_per_week)
                    self._num_constraints += 1
                    under = self.model.NewIntVar(0, lb.periods_per_week, f"under_{i}")
                    self.model.Add(total + under == lb.periods_per_week)
                    self._penalty_terms.append((under, 50))
            else:
                single_vars = [v for (ii, d, p), v in self.x.items() if ii == i]
                if single_vars:
                    total = sum(single_vars)
                    self.model.Add(total <= lb.periods_per_week)
                    self._num_constraints += 1
                    under = self.model.NewIntVar(0, lb.periods_per_week, f"under_{i}")
                    self.model.Add(total + under == lb.periods_per_week)
                    self._penalty_terms.append((under, 50))

    def _add_h5_max_per_day(self) -> None:
        """Limit periods per day per lesson block (spread across days)."""
        days_per_week = len(self.days)
        for i, lb in enumerate(self.lb_list):
            if lb.is_double_period:
                for d in self.days:
                    day_pairs = [v for (ii, dd, p), v in self.pair.items() if ii == i and dd == d]
                    day_singles = [v for (ii, dd, p), v in self.x.items() if ii == i and dd == d]
                    # max 1 pair + 1 single per day (3 periods max)
                    if day_pairs:
                        self.model.Add(sum(day_pairs) <= 1)
                        self._num_constraints += 1
                    if day_pairs and day_singles:
                        # If a pair is scheduled, allow at most 1 single that day
                        self.model.Add(sum(day_singles) <= 1)
                        self._num_constraints += 1
            else:
                max_per_day = max(1, math.ceil(lb.periods_per_week / days_per_week))
                max_per_day = min(max_per_day, 2)
                for d in self.days:
                    day_vars = [v for (ii, dd, p), v in self.x.items() if ii == i and dd == d]
                    if day_vars:
                        self.model.Add(sum(day_vars) <= max_per_day)
                        self._num_constraints += 1

    def _add_h6_pre_assignment(self) -> None:
        """Fix lesson blocks with is_fixed=True to their specified day/period.

        Supports two pre-assignment modes:
        - Multi-slot: lb.fixed_slots (list of {day, period}) — pins each slot
        - Legacy single-slot: lb.fixed_day / lb.fixed_period (one slot only)
        """
        for i, lb in enumerate(self.lb_list):
            if not lb.is_fixed:
                continue

            # Collect all pre-assigned (day, period) pairs
            pre_assigned: list[tuple[int, int]] = []
            if lb.fixed_slots:
                for fs in lb.fixed_slots:
                    pre_assigned.append((fs.day, fs.period))
            elif lb.fixed_day is not None and lb.fixed_period is not None:
                pre_assigned.append((lb.fixed_day, lb.fixed_period))

            for (d, p) in pre_assigned:
                if lb.is_double_period:
                    if (i, d, p) in self.pair:
                        self.model.Add(self.pair[(i, d, p)] == 1)
                        self._num_constraints += 1
                else:
                    if (i, d, p) in self.x:
                        self.model.Add(self.x[(i, d, p)] == 1)
                        self._num_constraints += 1

    def _add_teaching_load_bounds(self) -> None:
        """Teacher total assigned periods within [min, max].

        max_periods_per_week is a WARNING ceiling (soft, low weight 10): the
        solver places ALL of the teacher's lessons even when the total exceeds
        the ceiling, then flags load_status == "over" so the user sees the
        warning. It never silently drops lessons to stay under the ceiling.

        min_periods_per_week remains a hard constraint (a guaranteed minimum).

        Co-taught lesson blocks count toward BOTH teachers' bounds.
        """
        teacher_lbs = self._build_teacher_lb_map()

        for teacher in self.req.teachers:
            lb_indices = teacher_lbs.get(teacher.id, [])
            if not lb_indices:
                continue
            terms = []
            for i in lb_indices:
                for (ii, d, p), v in self.x.items():
                    if ii == i:
                        terms.append(v)
                for (ii, d, p), v in self.pair.items():
                    if ii == i:
                        terms.append(v * 2)  # each pair = 2 periods
            if not terms:
                continue
            total = sum(terms)
            if teacher.max_periods_per_week > 0:
                # max_periods_per_week is a WARNING ceiling, NOT a lesson cutter:
                # overflow carries a small penalty (10) that is always cheaper
                # than under-assigning a period (50), so the solver places ALL
                # of the teacher's lessons first and only then prefers staying
                # within the ceiling. load_status == "over" warns the user.
                overflow = self.model.NewIntVar(
                    0, 50, f"teacher_over_{teacher.id}"
                )
                self.model.Add(total <= teacher.max_periods_per_week + overflow)
                self._num_constraints += 1
                self._penalty_terms.append((overflow, 10))
            if teacher.min_periods_per_week > 0:
                self.model.Add(total >= teacher.min_periods_per_week)
                self._num_constraints += 1

    # ── Soft constraints (Phase 2) ────────────────────────────────────────

    def _get_vars_for_lb_at_slot(self, i: int, d: int, p: int) -> list[cp_model.BoolVar]:
        """Get all decision variables for lesson block i at day d, period p."""
        result = []
        if (i, d, p) in self.x:
            result.append(self.x[(i, d, p)])
        if (i, d, p) in self.pair:
            result.append(self.pair[(i, d, p)])
        if (i, d, p - 1) in self.pair:
            result.append(self.pair[(i, d, p - 1)])
        return result

    def _add_teacher_lunch_guarantee(self) -> None:
        """Every teacher must have at least 1 free slot in the 11:00-13:30 range each day.

        For each day, for each teacher, at least one LUNCH period in any block
        must be free (no teaching assignment).
        """
        LUNCH_WINDOW_START = 11 * 60  # 11:00
        LUNCH_WINDOW_END = 13 * 60 + 30  # 13:30

        # Find all periods across all blocks that fall in the lunch window
        # Support per-day periods: lunch_periods_by_block_day[(block_id, day)] = [period_nos]
        lunch_periods_by_block: dict[str, list[int]] = {}
        lunch_periods_by_block_day: dict[tuple[str, int], list[int]] = {}
        for blk in self.req.schedule_blocks:
            for p in blk.periods:
                start_min = _time_to_minutes(p.start_time)
                end_min = _time_to_minutes(p.end_time)
                if start_min >= LUNCH_WINDOW_START and end_min <= LUNCH_WINDOW_END:
                    lunch_periods_by_block.setdefault(blk.id, []).append(p.period_no)
            # Per-day lunch periods
            if not blk.apply_to_all_days and blk.periods_by_day:
                for day_str, day_periods in blk.periods_by_day.items():
                    d = int(day_str)
                    for p in day_periods:
                        start_min = _time_to_minutes(p.start_time)
                        end_min = _time_to_minutes(p.end_time)
                        if start_min >= LUNCH_WINDOW_START and end_min <= LUNCH_WINDOW_END:
                            lunch_periods_by_block_day.setdefault((blk.id, d), []).append(p.period_no)

        if not lunch_periods_by_block and not lunch_periods_by_block_day:
            return

        teacher_lbs = self._build_teacher_lb_map()

        for teacher_id, lb_indices in teacher_lbs.items():
            for d in self.days:
                # Collect all teaching vars at lunch periods across all blocks
                lunch_teaching_vars = []
                for i in lb_indices:
                    lb = self.lb_list[i]
                    block_id = lb.block_id
                    if not block_id:
                        continue
                    # Use per-day lunch periods if available, else fallback to block-level
                    lunch_ps = lunch_periods_by_block_day.get((block_id, d), [])
                    if not lunch_ps:
                        lunch_ps = lunch_periods_by_block.get(block_id, [])
                    for p in lunch_ps:
                        lunch_teaching_vars.extend(self._get_vars_for_lb_at_slot(i, d, p))

                if lunch_teaching_vars:
                    # At least one lunch slot must be free → sum of teaching vars < total lunch slots
                    # Or equivalently: not all lunch slots are occupied
                    # We need at least 1 free → sum <= len(lunch_teaching_vars) - 1
                    # But this is too strict if teacher teaches in multiple blocks.
                    # Instead: for each block the teacher teaches in, at least 1 lunch period free
                    # Simpler: sum of all lunch teaching vars <= total_lunch_slots - 1
                    total_lunch_slots = sum(
                        len(ps) for ps in lunch_periods_by_block.values()
                    )
                    # Only apply if teacher has lesson blocks in blocks with lunch periods
                    teacher_blocks = set()
                    for i in lb_indices:
                        bid = self.lb_list[i].block_id
                        if bid and bid in lunch_periods_by_block:
                            teacher_blocks.add(bid)
                    if teacher_blocks:
                        slots_in_teacher_blocks = sum(
                            len(lunch_periods_by_block[bid]) for bid in teacher_blocks
                        )
                        if slots_in_teacher_blocks > 0:
                            self.model.Add(sum(lunch_teaching_vars) <= slots_in_teacher_blocks - 1)
                            self._num_constraints += 1

    def _add_t5_discipline_free_slots(self) -> None:
        """T5: Discipline teacher must be free during period 1 (morning) and last period.

        This is handled as a hard constraint by adding those slots to the
        teacher's unavailable list during variable creation (via admin_free_slots).
        Here we just count it for reporting.
        """
        for teacher in self.req.teachers:
            if teacher.admin_role.value == "discipline":
                self._num_constraints += 1

    def _add_s3_max_consecutive_teaching(self) -> None:
        """Max consecutive teaching constraint.

        Per-teacher configuration: uses teacher.max_consecutive_teaching if > 0,
        otherwise falls back to global schedule_config.max_consecutive_teaching
        (in BOTH legacy and multi-block modes).
        mode:
          - off: skip entirely
          - soft: penalize excess (weight 100) — skips teachers with
                  enable_consecutive_limit == False
          - hard: hard constraint — no teacher teaches more than N consecutive
                  periods
        """
        mode = self._rule_mode("max_consecutive_mode")
        if mode == "off":
            return
        is_hard = mode == "hard"
        global_max_consec = self.req.schedule_config.max_consecutive_teaching

        teacher_lbs = self._build_teacher_lb_map()

        PENALTY = 100

        for d in self.days:
            for teacher_id, lb_indices in teacher_lbs.items():
                teacher = self.teacher_by_id.get(teacher_id)
                if not teacher:
                    continue
                # In soft mode, respect per-teacher opt-out
                if not is_hard and not teacher.enable_consecutive_limit:
                    continue
                # Determine per-teacher max consecutive
                max_consec = teacher.max_consecutive_teaching if teacher.max_consecutive_teaching > 0 else global_max_consec
                if max_consec <= 0:
                    continue

                # Build "teacher is teaching at period p" indicator
                period_indicators: dict[int, list[cp_model.LinearExpr]] = {}
                for p in self.valid_periods:
                    active = []
                    for i in lb_indices:
                        if (i, d, p) in self.x:
                            active.append(self.x[(i, d, p)])
                        if (i, d, p) in self.pair:
                            active.append(self.pair[(i, d, p)])
                        if (i, d, p - 1) in self.pair:
                            active.append(self.pair[(i, d, p - 1)])
                    if active:
                        period_indicators[p] = active

                if not period_indicators:
                    continue

                # Check windows of max_consec+1 consecutive periods
                sorted_periods = sorted(period_indicators.keys())
                for idx in range(len(sorted_periods) - max_consec):
                    window = sorted_periods[idx: idx + max_consec + 1]
                    if all(window[j + 1] == window[j] + 1 for j in range(len(window) - 1)):
                        window_sum = sum(sum(period_indicators[p]) for p in window)
                        if is_hard:
                            self.model.Add(window_sum <= max_consec)
                            self._num_constraints += 1
                        else:
                            excess = self.model.NewIntVar(0, max_consec + 1, f"excess_{teacher_id}_{d}_{idx}")
                            self.model.Add(window_sum <= max_consec + excess)
                            self._penalty_terms.append((excess, PENALTY))

    def _add_s1_subject_day_spacing(self) -> None:
        """S1: Prefer not scheduling same lesson block on consecutive days.

        soft: penalty; hard: hard constraint (same subject never at the same
        period on consecutive days); off: skip.
        """
        mode = self._rule_mode("subject_day_spacing_mode", "enable_subject_day_spacing")
        if mode == "off":
            return
        is_hard = mode == "hard"
        PENALTY = 5
        for i, lb in enumerate(self.lb_list):
            if lb.periods_per_week < 2:
                continue
            for d_idx in range(len(self.days) - 1):
                d1 = self.days[d_idx]
                d2 = self.days[d_idx + 1]
                for p in self.valid_periods:
                    v1 = self.x.get((i, d1, p))
                    v2 = self.x.get((i, d2, p))
                    if v1 is not None and v2 is not None:
                        if is_hard:
                            self.model.Add(v1 + v2 <= 1)
                            self._num_constraints += 1
                        else:
                            # Penalize both being active on consecutive days same period
                            both = self.model.NewBoolVar(f"s1_{i}_{d1}_{d2}_{p}")
                            self.model.AddBoolAnd([v1, v2]).OnlyEnforceIf(both)
                            self.model.AddBoolOr([v1.Not(), v2.Not()]).OnlyEnforceIf(both.Not())
                            self._penalty_terms.append((both, PENALTY))

    def _add_elastic_workload_balance(self) -> None:
        """Elastic Daily Workload Balancing: spread teaching load evenly across days.

        For each teacher, compute avg_daily_load = total_teaching_periods / days_per_week.
        Target range = [floor(avg - 1), ceil(avg + 1)].
        Penalize days where total teaching periods fall outside this range.
        """
        if self._rule_mode("workload_balance_mode", "enable_workload_balance") == "off":
            return
        days_per_week = len(self.days)
        if days_per_week <= 1:
            return

        teacher_lbs = self._build_teacher_lb_map()

        PENALTY = 5

        for teacher_id, lb_indices in teacher_lbs.items():
            # Calculate total teaching periods for this teacher
            total_periods = 0
            for i in lb_indices:
                lb = self.lb_list[i]
                total_periods += lb.periods_per_week

            if total_periods <= 0:
                continue

            avg_daily_load = total_periods / days_per_week
            target_low = math.floor(avg_daily_load - 1)
            target_high = math.ceil(avg_daily_load + 1)

            # Clamp target range to valid bounds
            target_low = max(0, target_low)
            if target_high < target_low:
                target_high = target_low

            for d in self.days:
                # Sum all teaching variables for this teacher on this day
                day_terms = []
                for i in lb_indices:
                    for (ii, dd, p), v in self.x.items():
                        if ii == i and dd == d:
                            day_terms.append(v)
                    for (ii, dd, p), v in self.pair.items():
                        if ii == i and dd == d:
                            day_terms.append(v * 2)  # each pair = 2 periods

                if not day_terms:
                    continue

                day_total = sum(day_terms)

                # Penalize if below target_low
                if target_low > 0:
                    under = self.model.NewIntVar(0, target_low, f"wl_under_{teacher_id}_{d}")
                    self.model.Add(target_low - day_total <= under)
                    self._penalty_terms.append((under, PENALTY))

                # Penalize if above target_high
                over = self.model.NewIntVar(0, total_periods, f"wl_over_{teacher_id}_{d}")
                self.model.Add(day_total - target_high <= over)
                self._penalty_terms.append((over, PENALTY))

    def _add_s2_cognitive_load_morning(self) -> None:
        """S2: Prefer heavy subjects in morning periods (1-3).

        soft: penalty (mode-aware weight); hard: heavy subjects must be in the
        morning (afternoon vars forced to 0); off: skip.
        """
        mode = self._rule_mode("heavy_morning_mode", "enable_heavy_morning")
        if mode == "off":
            return
        is_hard = mode == "hard"
        from models import OptimizationMode
        is_deep = self.req.optimization_mode == OptimizationMode.DEEP
        morning_periods = {p for p in self.valid_periods if p <= 3}
        afternoon_periods = {p for p in self.valid_periods if p > 3}
        # Reduced from 3 to 1: still nudges heavy subjects toward morning,
        # but no longer strong enough to push everything into periods 1-3
        # and starve period 7 (the last period of the day).
        PENALTY = 10 if is_deep else 1

        for i, lb in enumerate(self.lb_list):
            subj = self.subject_by_id.get(lb.subject_id)
            if not subj or not subj.is_heavy:
                continue
            if is_hard:
                # Force heavy subjects into morning only
                for (ii, d, p), v in self.x.items():
                    if ii == i and p in afternoon_periods:
                        self.model.Add(v == 0)
                        self._num_constraints += 1
                for (ii, d, p), v in self.pair.items():
                    if ii == i and p in afternoon_periods:
                        self.model.Add(v == 0)
                        self._num_constraints += 1
            else:
                # Penalize heavy subjects in afternoon
                for (ii, d, p), v in self.x.items():
                    if ii == i and p in afternoon_periods:
                        self._penalty_terms.append((v, PENALTY))
                for (ii, d, p), v in self.pair.items():
                    if ii == i and p in afternoon_periods:
                        self._penalty_terms.append((v, PENALTY))

    def _add_soft_spread_preference(self) -> None:
        """Soft: prefer not scheduling lesson blocks in the last period of the day.

        Disabled: this penalty made the solver avoid period 7 (the last period)
        across the board, which caused period 7 to be left empty for almost
        every class and teacher even when the data fit naturally. The
        cognitive-load penalty (S2) already nudges heavy subjects toward the
        morning, which is enough to keep the day balanced without starving
        the last period.
        """
        return

    def _add_teacher_gap_penalty(self) -> None:
        """DEEP-only: Penalize idle gaps in a teacher's daily schedule.

        For each teacher, each day, count transitions between "teaching" and
        "not teaching" among consecutive STUDY periods. Each transition
        represents the start or end of an idle gap. Penalizing transitions
        encourages the solver to cluster a teacher's periods together
        (smoother daily schedule with fewer holes).

        Penalty weight = 3 per transition.
        """
        if self._rule_mode("gap_clustering_mode", "enable_gap_clustering") == "off":
            return
        from models import OptimizationMode
        if self.req.optimization_mode != OptimizationMode.DEEP:
            return

        PENALTY = 3
        teacher_lbs = self._build_teacher_lb_map()

        for d in self.days:
            day_periods = self._get_valid_periods_for_day(d)
            if len(day_periods) < 2:
                continue
            sorted_periods = sorted(day_periods)
            for teacher_id, lb_indices in teacher_lbs.items():
                # Build "teacher is teaching at period p" indicator for each period
                indicators: dict[int, list] = {}
                for p in sorted_periods:
                    active = []
                    for i in lb_indices:
                        if (i, d, p) in self.x:
                            active.append(self.x[(i, d, p)])
                        if (i, d, p) in self.pair:
                            active.append(self.pair[(i, d, p)])
                        if (i, d, p - 1) in self.pair:
                            active.append(self.pair[(i, d, p - 1)])
                    if active:
                        indicators[p] = active

                if len(indicators) < 2:
                    continue

                # For each consecutive pair of study periods, penalize
                # transitions (teaching then not teaching, or vice versa).
                for idx in range(len(sorted_periods) - 1):
                    p1 = sorted_periods[idx]
                    p2 = sorted_periods[idx + 1]
                    ind1 = indicators.get(p1)
                    ind2 = indicators.get(p2)
                    # Skip if neither period has any teaching vars
                    if not ind1 and not ind2:
                        continue
                    # teaches_p1 = 1 if teacher teaches at p1, else 0
                    if ind1:
                        teaches1 = self.model.NewBoolVar(f"tg1_{teacher_id}_{d}_{p1}")
                        self.model.AddBoolOr(ind1 + [teaches1.Not()]).OnlyEnforceIf(teaches1)
                        self.model.AddBoolAnd([v.Not() for v in ind1]).OnlyEnforceIf(teaches1.Not())
                    else:
                        teaches1 = self.model.NewConstant(0)
                    if ind2:
                        teaches2 = self.model.NewBoolVar(f"tg2_{teacher_id}_{d}_{p2}")
                        self.model.AddBoolOr(ind2 + [teaches2.Not()]).OnlyEnforceIf(teaches2)
                        self.model.AddBoolAnd([v.Not() for v in ind2]).OnlyEnforceIf(teaches2.Not())
                    else:
                        teaches2 = self.model.NewConstant(0)

                    # transition = |teaches1 - teaches2|
                    transition = self.model.NewBoolVar(f"tgt_{teacher_id}_{d}_{p1}_{p2}")
                    self.model.AddAbsEquality(transition, teaches1 - teaches2)
                    self._penalty_terms.append((transition, PENALTY))

    def _effective_am_pm_mode(self, teacher) -> str:
        """Resolve the am/pm-free mode for a teacher.

        Global schedule_config.am_pm_free_mode ('off'|'soft'|'hard') applies to
        ALL teachers; when global is 'off', per-teacher spread_free_periods
        opts that teacher into SOFT mode (backward compat).
        """
        global_mode = getattr(self.req.schedule_config, "am_pm_free_mode", "off")
        if global_mode in ("soft", "hard"):
            return global_mode
        if teacher and teacher.spread_free_periods:
            return "soft"
        return "off"

    def _rule_mode(self, mode_field: str, legacy_bool: str | None = None) -> str:
        """Resolve a per-rule mode ('off'|'soft'|'hard') from schedule_config.

        Prefers the new mode field; falls back to the legacy bool field
        (True → soft, False → off) for backward compat with old fixtures/UI.
        """
        v = getattr(self.req.schedule_config, mode_field, None)
        if v in ("soft", "hard", "off"):
            return v
        if legacy_bool is not None:
            b = getattr(self.req.schedule_config, legacy_bool, True)
            return "soft" if b else "off"
        return "soft"

    def _add_am_pm_free(self) -> None:
        """Global/per-teacher '1 free morning + 1 free afternoon' per day.

        Morning/afternoon are split by the lunch period(s) of that day
        (periods before the first lunch = morning, after the last lunch =
        afternoon). Falls back to splitting study periods in half when a day
        has no lunch period.

        soft mode: penalty (50) when a half has zero free periods — never
                  makes the model infeasible.
        hard mode: hard constraint that each half has >=1 free period; a busy
                  teacher that cannot spare 2 free periods/day will make the
                  model infeasible (pre-flight reports who).
        """
        PENALTY = 50
        teacher_lbs = self._build_teacher_lb_map()

        for d in self.days:
            day_periods = sorted(self._get_valid_periods_for_day(d))
            if len(day_periods) < 2:
                continue
            lunch_ps = sorted(
                self.lunch_set_by_day.get(d, set())
                if self.lunch_set_by_day else self.lunch_set
            )
            if lunch_ps:
                morning = [p for p in day_periods if p < lunch_ps[0]]
                afternoon = [p for p in day_periods if p > lunch_ps[-1]]
            else:
                mid = len(day_periods) // 2
                morning = day_periods[:mid]
                afternoon = day_periods[mid:]
            if not morning or not afternoon:
                continue

            for teacher_id, lb_indices in teacher_lbs.items():
                teacher = self.teacher_by_id.get(teacher_id)
                if not teacher:
                    continue
                mode = self._effective_am_pm_mode(teacher)
                if mode == "off":
                    continue
                is_hard = mode == "hard"
                for half_key, half_periods in (("am", morning), ("pm", afternoon)):
                    teaches: list[cp_model.BoolVar] = []
                    for p in half_periods:
                        vars_at_p = []
                        for i in lb_indices:
                            vars_at_p.extend(self._get_vars_for_lb_at_slot(i, d, p))
                        if vars_at_p:
                            teach_p = self.model.NewBoolVar(f"{half_key}_{teacher_id}_{d}_{p}")
                            self.model.AddBoolOr(vars_at_p).OnlyEnforceIf(teach_p)
                            self.model.AddBoolAnd([v.Not() for v in vars_at_p]).OnlyEnforceIf(teach_p.Not())
                            teaches.append(teach_p)
                    if not teaches:
                        continue  # no teaching possible in this half → nothing to enforce
                    if is_hard:
                        # At least one free period in this half (not all taught)
                        self.model.Add(sum(teaches) <= len(teaches) - 1)
                        self._num_constraints += 1
                    else:
                        # Penalize when every period in this half is taught
                        all_taught = self.model.NewBoolVar(f"{half_key}_all_{teacher_id}_{d}")
                        self.model.AddBoolAnd(teaches).OnlyEnforceIf(all_taught)
                        self.model.AddBoolOr([t.Not() for t in teaches]).OnlyEnforceIf(all_taught.Not())
                        self._penalty_terms.append((all_taught, PENALTY))

    def _add_subject_time_preference(self) -> None:
        """Soft/hard: honor subject time preferences.

        Primary source: schedule_config.subject_time_rules (วิชาเฉพาะช่วงเวลา):
          { subject_id, preference: morning|afternoon, mode: soft|hard|off }
        soft → penalty when scheduled in the disfavored half;
        hard → subject can only be scheduled in the preferred half.

        Fallback (rules empty, backward compat): subject.time_preference
        field on the Subject model, treated as soft.
        """
        PENALTY = 8
        rules = getattr(self.req.schedule_config, "subject_time_rules", None) or []
        if rules:
            effective: list[tuple[str, str, str]] = []
            for r in rules:
                if r.mode in ("soft", "hard"):
                    effective.append((r.subject_id, r.preference, r.mode))
        else:
            # Legacy: derive from subject.time_preference (soft)
            effective = []
            for subj in self.req.subjects:
                pref = getattr(subj, "time_preference", "any")
                if pref in ("morning", "afternoon"):
                    effective.append((subj.id, pref, "soft"))
        if not effective:
            return

        for (subj_id, pref, mode) in effective:
            is_hard = mode == "hard"
            for i, lb in enumerate(self.lb_list):
                if lb.subject_id != subj_id:
                    continue
                for d in self.days:
                    day_periods = sorted(self._get_valid_periods_for_day(d))
                    if len(day_periods) < 2:
                        continue
                    lunch_ps = sorted(
                        self.lunch_set_by_day.get(d, set())
                        if self.lunch_set_by_day else self.lunch_set
                    )
                    if lunch_ps:
                        morning = set(p for p in day_periods if p < lunch_ps[0])
                        afternoon = set(p for p in day_periods if p > lunch_ps[-1])
                    else:
                        mid = len(day_periods) // 2
                        morning = set(day_periods[:mid])
                        afternoon = set(day_periods[mid:])
                    disfavored = afternoon if pref == "morning" else morning
                    for (ii, dd, p), v in self.x.items():
                        if ii == i and dd == d and p in disfavored:
                            if is_hard:
                                self.model.Add(v == 0)
                                self._num_constraints += 1
                            else:
                                self._penalty_terms.append((v, PENALTY))
                    for (ii, dd, p), v in self.pair.items():
                        if ii == i and dd == d and p in disfavored:
                            if is_hard:
                                self.model.Add(v == 0)
                                self._num_constraints += 1
                            else:
                                self._penalty_terms.append((v, PENALTY))

    # ── Objective ──────────────────────────────────────────────────────────

    def _add_objective(self) -> None:
        """Penalty-weighted objective function."""
        # _add_soft_spread_preference() disabled — see method docstring.
        self._add_s1_subject_day_spacing()
        self._add_s2_cognitive_load_morning()
        self._add_s3_max_consecutive_teaching()
        self._add_elastic_workload_balance()
        self._add_teacher_gap_penalty()
        self._add_am_pm_free()
        self._add_subject_time_preference()

        if self._penalty_terms:
            obj = sum(expr * weight for expr, weight in self._penalty_terms)
            self.model.Minimize(obj)

    # ── Solve ──────────────────────────────────────────────────────────────

    def solve(self) -> TimetableResponse:
        # Pre-flight validation: catch data-level conflicts (e.g. class over
        # capacity, teacher over max load, fixed slot collisions) before
        # invoking CP-SAT, so we can return a human-readable DiagnosticsReport
        # instead of a bare INFEASIBLE.
        from preflight import run_preflight
        from models import DiagnosticsReport

        diagnostics = run_preflight(self.req)
        if diagnostics.has_blocking_issues():
            return TimetableResponse(
                slots=[],
                teacher_loads=[],
                metrics=SolverMetrics(
                    status="INFEASIBLE",
                    objective_value=0.0,
                    wall_time_seconds=0.0,
                    num_variables=0,
                    num_constraints=0,
                    hard_violations=-1,
                    soft_violations=0,
                ),
                diagnostics=diagnostics,
            )

        self._create_variables()
        self._add_hard_constraints()
        self._add_objective()

        self.solver.parameters.max_time_in_seconds = self.req.solver_time_limit_seconds
        self.solver.parameters.num_search_workers = 8

        # FAST mode: stop at first feasible solution
        # BALANCED mode: let solver run full time limit for optimization
        from models import OptimizationMode

        callback = None
        if self.req.optimization_mode == OptimizationMode.FAST:
            callback = _FirstSolutionCallback()
            self.solver.parameters.enumerate_all_solutions = False

        status = self.solver.Solve(self.model, callback)

        status_map = {
            cp_model.OPTIMAL: "OPTIMAL",
            cp_model.FEASIBLE: "FEASIBLE",
            cp_model.INFEASIBLE: "INFEASIBLE",
            cp_model.UNKNOWN: "UNKNOWN",
        }
        status_str = status_map.get(status, "UNKNOWN")

        slots: list[ScheduledSlot] = []
        teacher_loads: list[TeacherLoadSummary] = []

        if status in (cp_model.OPTIMAL, cp_model.FEASIBLE):
            slots = self._extract_slots()
            teacher_loads = self._compute_teacher_loads(slots)

        hard_violations = 0 if status in (cp_model.OPTIMAL, cp_model.FEASIBLE) else -1

        metrics = SolverMetrics(
            status=status_str,
            objective_value=self.solver.ObjectiveValue() if status in (cp_model.OPTIMAL, cp_model.FEASIBLE) else 0,
            wall_time_seconds=round(self.solver.WallTime(), 4),
            num_variables=len(self.x) + len(self.pair),
            num_constraints=self._num_constraints,
            hard_violations=hard_violations,
            soft_violations=0,
        )

        # If solver still returned INFEASIBLE despite passing pre-flight,
        # attach a fallback diagnostics note so the user gets a hint.
        # Merge any pre-flight notes (e.g. hard-rule hints) so they surface.
        post_diagnostics: DiagnosticsReport | None = None
        if status_str == "INFEASIBLE":
            preflight_notes = list(diagnostics.notes or [])
            post_diagnostics = DiagnosticsReport(
                notes=preflight_notes + [
                    "Pre-flight ไม่พบสาเหตุชัด แต่ solver ยังคืน INFEASIBLE — "
                    "อาจเป็นความขัดแย้งซับซ้อนระหว่าง hard constraints "
                    "(เช่น ครูหลายคนแยกกันดูพอ แต่รวมในวันเดียวกันแล้วไม่พอ) "
                    "กรุณาตรวจข้อมูลซ้ำหรือผ่อนข้อจำกัด"
                ]
            )

        return TimetableResponse(
            slots=slots,
            teacher_loads=teacher_loads,
            metrics=metrics,
            diagnostics=post_diagnostics,
        )

    def _extract_slots(self) -> list[ScheduledSlot]:
        slots: list[ScheduledSlot] = []
        for (i, d, p), v in self.x.items():
            if self.solver.Value(v) == 1:
                lb = self.lb_list[i]
                slots.append(ScheduledSlot(
                    lesson_block_id=lb.id,
                    day=d,
                    period=p,
                    subject_id=lb.subject_id,
                    teacher_id=lb.teacher_id,
                    class_id=lb.class_id,
                    room_id=lb.room_id,
                ))
        for (i, d, p), v in self.pair.items():
            if self.solver.Value(v) == 1:
                lb = self.lb_list[i]
                for pp in (p, p + 1):
                    slots.append(ScheduledSlot(
                        lesson_block_id=lb.id,
                        day=d,
                        period=pp,
                        subject_id=lb.subject_id,
                        teacher_id=lb.teacher_id,
                        class_id=lb.class_id,
                        room_id=lb.room_id,
                    ))
        slots.sort(key=lambda s: (s.day, s.period, s.class_id, s.lesson_block_id))
        return slots

    def _compute_teacher_loads(self, slots: list[ScheduledSlot]) -> list[TeacherLoadSummary]:
        # Count each slot for the main teacher AND the co-teacher (if any), so
        # co-taught periods (e.g. MEP Thai+foreign) count toward both workloads.
        lb_by_id = {lb.id: lb for lb in self.lb_list}
        counts: dict[str, int] = {}
        for s in slots:
            counts[s.teacher_id] = counts.get(s.teacher_id, 0) + 1
            lb = lb_by_id.get(s.lesson_block_id)
            if lb and lb.co_teacher_id:
                counts[lb.co_teacher_id] = counts.get(lb.co_teacher_id, 0) + 1

        # คาบดูแลกิจกรรม (fixed slots) นับเข้างานครูผู้ดูแล — เป็นภาระคงที่ (ไม่ใช่ตัวแปร solver)
        for fs in self.req.fixed_slots:
            supervision_periods = len(fs.effective_periods())
            for tid in fs.supervisor_teacher_ids():
                counts[tid] = counts.get(tid, 0) + supervision_periods

        result: list[TeacherLoadSummary] = []
        for teacher in self.req.teachers:
            assigned = counts.get(teacher.id, 0)
            if assigned > teacher.max_periods_per_week:
                status = "over"
            elif assigned < teacher.min_periods_per_week:
                status = "under"
            else:
                status = "ok"
            result.append(TeacherLoadSummary(
                teacher_id=teacher.id,
                teacher_name=teacher.name,
                assigned_periods=assigned,
                max_periods=teacher.max_periods_per_week,
                min_periods=teacher.min_periods_per_week,
                load_status=status,
            ))
        return result
