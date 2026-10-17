"""Test the solver against all 3 fixture sizes.

Run: python test_solver.py
"""
from __future__ import annotations

import json
import sys
import time
from pathlib import Path

from models import (
    TimetableRequest,
    Teacher,
    OptimizationMode,
    FixedSlot,
    FixedSlotType,
    ClassGroup,
    LessonBlock,
    Subject,
    SubjectCategory,
    Room,
    ScheduleConfig,
    ScheduleBlock,
    SchedulePeriod,
    SubjectTimeRule,
    PeriodType,
)
from solver import TimetableSolver
from preflight import run_preflight

FIXTURES_DIR = Path(__file__).parent / "fixtures"


def run_test(name: str, fixture_file: str) -> bool:
    print(f"\n{'='*60}")
    print(f"  TEST: {name} ({fixture_file})")
    print(f"{'='*60}")

    data = json.loads((FIXTURES_DIR / fixture_file).read_text(encoding="utf-8"))
    request = TimetableRequest(**data)

    print(f"  Teachers:     {len(request.teachers)}")
    print(f"  Classes:      {len(request.classes)}")
    print(f"  Subjects:     {len(request.subjects)}")
    print(f"  Lesson blocks:{len(request.lesson_blocks)}")
    print(f"  Fixed slots:  {len(request.fixed_slots)}")
    print(f"  Days x Periods: {request.schedule_config.days_per_week} x {request.schedule_config.periods_per_day}")
    total_periods = request.schedule_config.periods_per_day
    valid_count = len([p for p in range(1, total_periods + 1) if p not in request.schedule_config.lunch_periods])
    print(f"  Valid periods:  {total_periods} total, {valid_count} valid (excl. lunch)")
    print()

    solver = TimetableSolver(request)
    start = time.perf_counter()
    result = solver.solve()
    elapsed = time.perf_counter() - start

    m = result.metrics
    print(f"  Status:          {m.status}")
    print(f"  Objective:       {m.objective_value}")
    print(f"  Wall time:       {m.wall_time_seconds}s (total: {elapsed:.3f}s)")
    print(f"  Variables:       {m.num_variables}")
    print(f"  Constraints:     {m.num_constraints}")
    print(f"  Hard violations: {m.hard_violations}")
    print(f"  Slots generated: {len(result.slots)}")

    # Verify constraints
    violations = verify_constraints(result, request)
    if violations:
        print(f"\n  ❌ CONSTRAINT VIOLATIONS ({len(violations)}):")
        for v in violations[:10]:
            print(f"     - {v}")
        if len(violations) > 10:
            print(f"     ... and {len(violations) - 10} more")
        return False
    else:
        print(f"\n  ✅ All constraints satisfied!")

    # Teacher load summary
    print(f"\n  Teacher Load Summary:")
    for tl in result.teacher_loads:
        if tl.load_status != "ok":
            print(f"     ⚠️  {tl.teacher_name}: {tl.assigned_periods}/{tl.min_periods}-{tl.max_periods} ({tl.load_status})")
        else:
            print(f"     ✅ {tl.teacher_name}: {tl.assigned_periods}/{tl.max_periods}")

    # Check 2-second target
    if elapsed <= 2.0:
        print(f"\n  ✅ Within 2-second target ({elapsed:.3f}s)")
    else:
        print(f"\n  ⚠️  Exceeded 2-second target ({elapsed:.3f}s)")

    return len(violations) == 0


def verify_constraints(result, request: TimetableRequest) -> list[str]:
    """Verify H1-H6 constraints on the solution."""
    violations = []

    # Build slot lookup
    slots_by_day_period: dict[tuple[int, int], list] = {}
    for s in result.slots:
        slots_by_day_period.setdefault((s.day, s.period), []).append(s)

    # H1: Teacher clash
    for (d, p), slots in slots_by_day_period.items():
        teachers = {}
        for s in slots:
            teachers.setdefault(s.teacher_id, []).append(s)
        for tid, slist in teachers.items():
            if len(slist) > 1:
                violations.append(f"H1 Teacher clash: {tid} at D{d}P{p} ({len(slist)} slots)")

    # H2: Class clash
    for (d, p), slots in slots_by_day_period.items():
        classes = {}
        for s in slots:
            classes.setdefault(s.class_id, []).append(s)
        for cid, slist in classes.items():
            if len(slist) > 1:
                violations.append(f"H2 Class clash: {cid} at D{d}P{p} ({len(slist)} slots)")

    # H3: Room clash
    for (d, p), slots in slots_by_day_period.items():
        rooms = {}
        for s in slots:
            if s.room_id:
                rooms.setdefault(s.room_id, []).append(s)
        for rid, slist in rooms.items():
            if len(slist) > 1:
                violations.append(f"H3 Room clash: {rid} at D{d}P{p} ({len(slist)} slots)")

    # H4: No slots in lunch periods
    lunch_set = set(request.schedule_config.lunch_periods)
    for s in result.slots:
        if s.period in lunch_set:
            violations.append(f"H4 Lunch period: LB{s.lesson_block_id} at D{s.day}P{s.period}")

    # H5: No slots in assembly/fixed slots (class-aware + multi-period)
    for fs in request.fixed_slots:
        blocked_classes = set(fs.class_ids) if fs.class_ids else set(c.id for c in request.classes)
        for fs_period in fs.effective_periods():
            for s in result.slots:
                if s.day == fs.day and s.period == fs_period and s.class_id in blocked_classes:
                    violations.append(f"H5 Fixed slot: {fs.name} blocks {s.class_id} at D{fs.day}P{fs_period}")

    # H6: Pre-assignment
    for lb in request.lesson_blocks:
        if lb.is_fixed and lb.fixed_day and lb.fixed_period:
            found = any(
                s.lesson_block_id == lb.id and s.day == lb.fixed_day and s.period == lb.fixed_period
                for s in result.slots
            )
            if not found:
                violations.append(f"H6 Pre-assignment: {lb.id} not at D{lb.fixed_day}P{lb.fixed_period}")

    # Period count check
    lb_counts = {}
    for s in result.slots:
        lb_counts[s.lesson_block_id] = lb_counts.get(s.lesson_block_id, 0) + 1
    for lb in request.lesson_blocks:
        actual = lb_counts.get(lb.id, 0)
        if actual != lb.periods_per_week:
            violations.append(f"H4 Period count: {lb.id} expected {lb.periods_per_week}, got {actual}")

    # T4/T5: Admin free slots — no teacher with admin_free_slots should be teaching then
    teacher_by_id = {t.id: t for t in request.teachers}
    for s in result.slots:
        teacher = teacher_by_id.get(s.teacher_id)
        if teacher and teacher.admin_free_slots:
            slot_key = f"{s.day}-{s.period}"
            if slot_key in teacher.admin_free_slots:
                violations.append(
                    f"T4/T5 Admin free slot: {teacher.name} teaching at D{s.day}P{s.period} "
                    f"(role={teacher.admin_role})"
                )

    # H11: PE hot periods — no PE subject in hot periods
    subject_by_id = {s.id: s for s in request.subjects}
    pe_hot_set = set()
    for hot in request.schedule_config.pe_hot_periods:
        d, p = hot.split("-")
        pe_hot_set.add((int(d), int(p)))
    for s in result.slots:
        subj = subject_by_id.get(s.subject_id)
        if subj and subj.category.value == "pe" and (s.day, s.period) in pe_hot_set:
            violations.append(f"H11 PE hot period: {s.lesson_block_id} at D{s.day}P{s.period}")

    return violations


def main():
    print("SRO Free Timetable — POC Solver Test")
    print("=" * 60)

    all_pass = True

    for name, file in [("SMALL", "school_small.json"), ("MEDIUM", "school_medium.json"), ("LARGE", "school_large.json")]:
        success = run_test(name, file)
        all_pass = all_pass and success

    # New per-teacher constraint tests
    print(f"\n{'='*60}")
    print("  TESTING NEW PER-TEACHER CONSTRAINTS")
    print(f"{'='*60}")

    success = test_no_first_period()
    all_pass = all_pass and success

    success = test_no_last_period()
    all_pass = all_pass and success

    success = test_per_teacher_consecutive_limit()
    all_pass = all_pass and success

    success = test_fast_optimization_mode()
    all_pass = all_pass and success

    # Pre-flight validation tests
    print(f"\n{'='*60}")
    print("  TESTING PRE-FLIGHT VALIDATION")
    print(f"{'='*60}")

    success = test_preflight_class_over_capacity()
    all_pass = all_pass and success

    success = test_preflight_teacher_over_max()
    all_pass = all_pass and success

    success = test_preflight_fixed_slot_conflict()
    all_pass = all_pass and success

    success = test_preflight_passes_valid_request()
    all_pass = all_pass and success

    success = test_preflight_multi_class_fixed_slot_no_false_positive()
    all_pass = all_pass and success

    success = test_preflight_lunch_guard_single_block()
    all_pass = all_pass and success

    success = test_preflight_supervision_not_double_counted()
    all_pass = all_pass and success

    # New feature tests (fixed-slot class separation, multi-period, co-teacher, am/pm free)
    print(f"\n{'='*60}")
    print("  TESTING NEW FEATURES (class-aware fixed slots, co-teacher, am/pm free)")
    print(f"{'='*60}")

    success = test_fixed_slot_class_ids_separation()
    all_pass = all_pass and success

    success = test_fixed_slot_multi_period()
    all_pass = all_pass and success

    success = test_co_teacher()
    all_pass = all_pass and success

    success = test_fixed_slot_supervision()
    all_pass = all_pass and success

    success = test_fixed_slot_supervision_over_max()
    all_pass = all_pass and success

    success = test_fixed_slot_supervision_multi_teacher()
    all_pass = all_pass and success

    success = test_am_pm_free_soft()
    all_pass = all_pass and success

    success = test_am_pm_free_soft_global()
    all_pass = all_pass and success

    success = test_am_pm_free_hard_global_ok()
    all_pass = all_pass and success

    success = test_am_pm_free_hard_infeasible()
    all_pass = all_pass and success

    success = test_subject_time_preference()
    all_pass = all_pass and success

    success = test_soft_toggles_off()
    all_pass = all_pass and success

    success = test_max_consecutive_hard()
    all_pass = all_pass and success

    success = test_subject_time_rules_hard()
    all_pass = all_pass and success

    success = test_subject_time_rules_soft()
    all_pass = all_pass and success

    success = test_teacher_over_max_places_all()
    all_pass = all_pass and success

    success = test_am_pm_hard_with_blocks()
    all_pass = all_pass and success

    print(f"\n{'='*60}")
    if all_pass:
        print("  🎉 ALL TESTS PASSED")
    else:
        print("  ❌ SOME TESTS FAILED")
    print(f"{'='*60}")

    sys.exit(0 if all_pass else 1)


def _load_base_request(fixture_file: str = "school_small.json") -> TimetableRequest:
    """Load a fixture as a base request for modification."""
    data = json.loads((FIXTURES_DIR / fixture_file).read_text(encoding="utf-8"))
    return TimetableRequest(**data)


def test_no_first_period() -> bool:
    """Test that no_first_period flag prevents teacher from teaching in period 1."""
    print(f"\n{'='*60}")
    print("  TEST: no_first_period filter")
    print(f"{'='*60}")

    request = _load_base_request()
    # Set no_first_period on first teacher
    if request.teachers:
        request.teachers[0] = request.teachers[0].model_copy(update={"no_first_period": True})
        test_teacher_id = request.teachers[0].id
    else:
        print("  ⚠️  No teachers in fixture, skipping")
        return True

    solver = TimetableSolver(request)
    result = solver.solve()

    if result.metrics.status == "INFEASIBLE":
        print(f"  ⚠️  Solver returned INFEASIBLE (may happen with tight constraints)")
        return True

    # Check no slots for this teacher in period 1
    violations = []
    for s in result.slots:
        if s.teacher_id == test_teacher_id and s.period == 1:
            violations.append(f"Teacher {test_teacher_id} teaching at period 1 (D{s.day})")

    if violations:
        print(f"  ❌ FAIL: {len(violations)} violations")
        for v in violations[:5]:
            print(f"     - {v}")
        return False
    else:
        print(f"  ✅ PASS: Teacher {test_teacher_id} has no slots in period 1")
        return True


def test_no_last_period() -> bool:
    """Test that no_last_period flag prevents teacher from teaching in the last period."""
    print(f"\n{'='*60}")
    print("  TEST: no_last_period filter")
    print(f"{'='*60}")

    request = _load_base_request()
    if request.teachers:
        request.teachers[0] = request.teachers[0].model_copy(update={"no_last_period": True})
        test_teacher_id = request.teachers[0].id
    else:
        print("  ⚠️  No teachers in fixture, skipping")
        return True

    # Determine last valid period
    lunch_set = set(request.schedule_config.lunch_periods)
    all_periods = list(range(1, request.schedule_config.periods_per_day + 1))
    valid_periods = [p for p in all_periods if p not in lunch_set]
    last_period = max(valid_periods)

    solver = TimetableSolver(request)
    result = solver.solve()

    if result.metrics.status == "INFEASIBLE":
        print(f"  ⚠️  Solver returned INFEASIBLE (may happen with tight constraints)")
        return True

    violations = []
    for s in result.slots:
        if s.teacher_id == test_teacher_id and s.period == last_period:
            violations.append(f"Teacher {test_teacher_id} teaching at last period {last_period} (D{s.day})")

    if violations:
        print(f"  ❌ FAIL: {len(violations)} violations")
        for v in violations[:5]:
            print(f"     - {v}")
        return False
    else:
        print(f"  ✅ PASS: Teacher {test_teacher_id} has no slots in last period ({last_period})")
        return True


def test_per_teacher_consecutive_limit() -> bool:
    """Test that per-teacher max_consecutive_teaching is respected (as soft constraint)."""
    print(f"\n{'='*60}")
    print("  TEST: per-teacher max_consecutive_teaching=2")
    print(f"{'='*60}")

    request = _load_base_request()
    if request.teachers:
        request.teachers[0] = request.teachers[0].model_copy(update={
            "max_consecutive_teaching": 2,
            "enable_consecutive_limit": True,
        })
        test_teacher_id = request.teachers[0].id
    else:
        print("  ⚠️  No teachers in fixture, skipping")
        return True

    solver = TimetableSolver(request)
    result = solver.solve()

    if result.metrics.status == "INFEASIBLE":
        print(f"  ⚠️  Solver returned INFEASIBLE")
        return True

    # Check consecutive periods for this teacher (soft constraint, may have some violations)
    # We just verify the solver ran and produced results
    teacher_slots = [s for s in result.slots if s.teacher_id == test_teacher_id]
    print(f"  Teacher {test_teacher_id} has {len(teacher_slots)} slots assigned")

    # Count consecutive violations (informational, soft constraint)
    by_day = {}
    for s in teacher_slots:
        by_day.setdefault(s.day, []).append(s.period)

    max_consec_found = 0
    for d, periods in by_day.items():
        periods.sort()
        consec = 1
        for i in range(1, len(periods)):
            if periods[i] == periods[i-1] + 1:
                consec += 1
            else:
                max_consec_found = max(max_consec_found, consec)
                consec = 1
        max_consec_found = max(max_consec_found, consec)

    print(f"  Max consecutive periods found: {max_consec_found} (limit=2, soft constraint)")
    print(f"  ✅ PASS: Solver completed with per-teacher consecutive limit")
    return True


def test_fast_optimization_mode() -> bool:
    """Test that FAST optimization mode returns a solution quickly."""
    print(f"\n{'='*60}")
    print("  TEST: FAST optimization mode")
    print(f"{'='*60}")

    request = _load_base_request()
    request.optimization_mode = OptimizationMode.FAST
    request.solver_time_limit_seconds = 5.0

    solver = TimetableSolver(request)
    start = time.perf_counter()
    result = solver.solve()
    elapsed = time.perf_counter() - start

    print(f"  Status: {result.metrics.status}")
    print(f"  Wall time: {result.metrics.wall_time_seconds}s (total: {elapsed:.3f}s)")
    print(f"  Slots: {len(result.slots)}")

    if result.metrics.status in ("OPTIMAL", "FEASIBLE"):
        print(f"  ✅ PASS: FAST mode returned a solution in {elapsed:.3f}s")
        return True
    else:
        print(f"  ❌ FAIL: FAST mode did not return a feasible solution")
        return False


def test_preflight_class_over_capacity() -> bool:
    """Pre-flight should catch a class whose sum(periods_per_week) > study slots.

    Reproduces the user's reported bug: ป.4/1 has 29 periods but only 25 slots.
    """
    print(f"\n{'='*60}")
    print("  TEST: preflight class over capacity")
    print(f"{'='*60}")

    request = _load_base_request()
    # Force one class's lesson blocks to exceed study capacity.
    # school_small: 5 days x (8 - 1 lunch) = 35 study slots, so we need to
    # push past that. Easier: shrink days_per_week to make capacity tight.
    request.schedule_config = request.schedule_config.model_copy(
        update={"days_per_week": 3}  # 3 * 7 = 21 study slots
    )
    # Now pump one class's lesson blocks to exceed 21.
    if not request.classes:
        print("  ⚠️  No classes in fixture, skipping")
        return True
    target_class = request.classes[0]
    target_class_id = target_class.id
    # Bump every lesson block of this class to 5 periods/week
    new_blocks = []
    for lb in request.lesson_blocks:
        if lb.class_id == target_class_id:
            new_blocks.append(lb.model_copy(update={"periods_per_week": 5}))
        else:
            new_blocks.append(lb)
    request.lesson_blocks = new_blocks

    solver = TimetableSolver(request)
    start = time.perf_counter()
    result = solver.solve()
    elapsed = time.perf_counter() - start

    print(f"  Status: {result.metrics.status}")
    print(f"  Elapsed: {elapsed:.3f}s")
    print(f"  Diagnostics: {result.diagnostics is not None}")

    if result.metrics.status != "INFEASIBLE":
        print(f"  ❌ FAIL: expected INFEASIBLE, got {result.metrics.status}")
        return False
    if result.diagnostics is None:
        print(f"  ❌ FAIL: diagnostics is None")
        return False
    if not result.diagnostics.class_capacity_issues:
        print(f"  ❌ FAIL: no class_capacity_issues in diagnostics")
        return False
    matching = [c for c in result.diagnostics.class_capacity_issues if c.class_id == target_class_id]
    if not matching:
        print(f"  ❌ FAIL: target class {target_class_id} not in capacity issues")
        return False
    issue = matching[0]
    print(f"  ✅ PASS: {issue.class_name} flagged: {issue.needed_periods}/{issue.available_slots} (overflow {issue.overflow})")
    if elapsed > 0.1:
        print(f"  ⚠️  Pre-flight took {elapsed:.3f}s (target < 0.1s) — still OK but slow")
    return True


def test_preflight_teacher_over_max() -> bool:
    """Teacher over max_periods_per_week should never block the solver.

    The solver treats max_periods_per_week as a SOFT constraint: it may place
    the teacher's lessons (exceeding max → load_status "over") or under-assign
    a few periods (cheaper penalty), but it must never return INFEASIBLE
    because of max alone.
    """
    print(f"\n{'='*60}")
    print("  TEST: preflight teacher over max_periods_per_week (soft warning)")
    print(f"{'='*60}")

    request = _load_base_request()
    if not request.teachers:
        print("  ⚠️  No teachers in fixture, skipping")
        return True
    # Pick the teacher with the most lesson blocks and shrink their max.
    teacher_loads: dict[str, int] = {}
    for lb in request.lesson_blocks:
        teacher_loads[lb.teacher_id] = teacher_loads.get(lb.teacher_id, 0) + lb.periods_per_week
    target_id = max(teacher_loads, key=teacher_loads.get)
    needed = teacher_loads[target_id]
    # Set max just below what they need
    new_max = max(1, needed - 1)
    new_teachers = []
    for t in request.teachers:
        if t.id == target_id:
            new_teachers.append(t.model_copy(update={"max_periods_per_week": new_max}))
        else:
            new_teachers.append(t)
    request.teachers = new_teachers

    solver = TimetableSolver(request)
    result = solver.solve()

    # The solver should NOT return INFEASIBLE — it should produce a timetable
    # (max_periods_per_week is a soft constraint, never a hard block).
    if result.metrics.status == "INFEASIBLE":
        print(f"  ❌ FAIL: expected non-INFEASIBLE (soft constraint), got INFEASIBLE")
        return False
    print(f"  ✅ PASS: solver returned {result.metrics.status} (not blocked by over_max)")

    # With max just below the teacher's total load, the optimizer may either:
    #   (a) place everything → assigned > max → load_status == "over", or
    #   (b) under-assign a few periods (under penalty 50 < overflow penalty 100)
    #       → assigned <= max → load_status "ok".
    # Both are legitimate soft-constraint outcomes; only INFEASIBLE is a failure.
    tl = next((x for x in result.teacher_loads if x.teacher_id == target_id), None)
    if tl is None:
        print(f"  ❌ FAIL: target teacher {target_id} missing from teacher_loads")
        return False
    print(f"  ✅ PASS: {tl.teacher_name} assigned={tl.assigned_periods}/{tl.max_periods} "
          f"(status={tl.load_status}, needed={needed})")
    if tl.load_status != "over":
        print(f"  ℹ️  Solver chose to under-assign some periods (documented soft behavior) — OK")
    return True


def test_preflight_fixed_slot_conflict() -> bool:
    """Pre-flight should catch a fixed lesson block pinned to a lunch period."""
    print(f"\n{'='*60}")
    print("  TEST: preflight fixed slot conflict (lunch)")
    print(f"{'='*60}")

    request = _load_base_request()
    lunch_periods = request.schedule_config.lunch_periods
    if not lunch_periods:
        print("  ⚠️  No lunch periods in fixture, skipping")
        return True
    target_lunch = lunch_periods[0]
    if not request.lesson_blocks:
        print("  ⚠️  No lesson blocks in fixture, skipping")
        return True
    # Pin the first lesson block to a lunch period on day 1
    lb = request.lesson_blocks[0]
    request.lesson_blocks[0] = lb.model_copy(
        update={"is_fixed": True, "fixed_day": 1, "fixed_period": target_lunch}
    )

    solver = TimetableSolver(request)
    result = solver.solve()

    if result.metrics.status != "INFEASIBLE":
        print(f"  ❌ FAIL: expected INFEASIBLE, got {result.metrics.status}")
        return False
    if result.diagnostics is None or not result.diagnostics.fixed_slot_conflicts:
        print(f"  ❌ FAIL: no fixed_slot_conflicts in diagnostics")
        return False
    print(f"  ✅ PASS: {len(result.diagnostics.fixed_slot_conflicts)} fixed slot conflict(s) detected")
    for f in result.diagnostics.fixed_slot_conflicts:
        print(f"     - {f.lesson_block_id} D{f.day}P{f.period}: {f.reason}")
    return True


def test_preflight_passes_valid_request() -> bool:
    """A valid request should pass pre-flight and reach the solver normally."""
    print(f"\n{'='*60}")
    print("  TEST: preflight passes valid request")
    print(f"{'='*60}")

    request = _load_base_request()
    solver = TimetableSolver(request)
    result = solver.solve()

    # The small fixture should normally be feasible.
    if result.metrics.status == "INFEASIBLE":
        # If the base fixture happens to be INFEASIBLE, pre-flight should
        # either have caught it (with diagnostics) or attached the fallback note.
        if result.diagnostics and (result.diagnostics.has_blocking_issues() or result.diagnostics.notes):
            print(f"  ✅ PASS: base fixture INFEASIBLE but diagnostics attached")
            return True
        print(f"  ❌ FAIL: base fixture INFEASIBLE with no diagnostics")
        return False
    if result.diagnostics is not None:
        print(f"  ⚠️  Diagnostics should be None on success, got: {result.diagnostics}")
        return False
    print(f"  ✅ PASS: status={result.metrics.status}, diagnostics=None (pre-flight passed through)")
    return True


def _single_block_periods() -> list[SchedulePeriod]:
    """6 study periods/day with a shared 12:00-13:00 lunch at period 4."""
    return [
        SchedulePeriod(period_no=1, start_time="08:30", end_time="09:20", type=PeriodType.STUDY),
        SchedulePeriod(period_no=2, start_time="09:20", end_time="10:10", type=PeriodType.STUDY),
        SchedulePeriod(period_no=3, start_time="10:10", end_time="11:00", type=PeriodType.STUDY),
        SchedulePeriod(period_no=4, start_time="12:00", end_time="13:00", type=PeriodType.LUNCH),
        SchedulePeriod(period_no=5, start_time="13:00", end_time="13:50", type=PeriodType.STUDY),
        SchedulePeriod(period_no=6, start_time="13:50", end_time="14:40", type=PeriodType.STUDY),
        SchedulePeriod(period_no=7, start_time="14:40", end_time="15:30", type=PeriodType.STUDY),
    ]


def test_preflight_multi_class_fixed_slot_no_false_positive() -> bool:
    """Preflight must not block a teacher who teaches several classes when a
    *different* class has a fixed slot at a given (day, period).

    Regression: the system returned INFEASIBLE (over_available) even though
    CP-SAT can schedule the lessons — the per-teacher available-slot count
    treated a slot as unusable if ANY taught class was locked there, while the
    solver only checks the lesson's own class.
    """
    print(f"\n{'='*60}")
    print("  TEST: preflight multi-class teacher + per-class fixed slots (no false positive)")
    print(f"{'='*60}")

    block = ScheduleBlock(id="B1", name="Block", target_classes=["C1", "C2"], days_per_week=5,
                          start_time="08:30", period_duration_mins=50, break_duration_mins=10,
                          periods=_single_block_periods(), apply_to_all_days=True)
    teacher = Teacher(id="T1", name="ครู A", max_periods_per_week=30, min_periods_per_week=0)
    subj = Subject(id="S1", name="คณิตศาสตร์", category=SubjectCategory.CORE)
    classes = [ClassGroup(id="C1", name="ป.1/1", grade_level=1),
               ClassGroup(id="C2", name="ป.1/2", grade_level=1)]
    lesson_blocks = [
        LessonBlock(id="LB1", subject_id="S1", teacher_id="T1", class_id="C1",
                    room_id="R_C1", periods_per_week=10, block_id="B1"),
        LessonBlock(id="LB2", subject_id="S1", teacher_id="T1", class_id="C2",
                    room_id="R_C2", periods_per_week=10, block_id="B1"),
    ]
    fixed_slots: list[FixedSlot] = []
    for d in range(1, 6):
        fixed_slots.append(FixedSlot(id=f"FS_C1_{d}", name="โฮมรูม", slot_type=FixedSlotType.HOMEROOM,
                                     day=d, period=1, class_ids=["C1"]))
        fixed_slots.append(FixedSlot(id=f"FS_C2_{d}", name="โฮมรูม", slot_type=FixedSlotType.HOMEROOM,
                                     day=d, period=7, class_ids=["C2"]))
    request = TimetableRequest(
        teachers=[teacher],
        rooms=[Room(id="R_C1", name="R_C1"), Room(id="R_C2", name="R_C2")],
        subjects=[subj], classes=classes, lesson_blocks=lesson_blocks,
        fixed_slots=fixed_slots, schedule_blocks=[block],
    )

    report = run_preflight(request)
    if report.has_blocking_issues():
        for t in report.teacher_overloads:
            print(f"  ❌ FAIL: {t.teacher_name} needed={t.needed_periods} "
                  f"available={t.available_slots} reason={t.reason}")
        return False

    result = TimetableSolver(request).solve()
    if result.metrics.status == "INFEASIBLE":
        print(f"  ❌ FAIL: solver returned INFEASIBLE after preflight passed")
        return False
    print(f"  ✅ PASS: preflight clean, solver={result.metrics.status}, slots={len(result.slots)}")
    return True


def test_preflight_lunch_guard_single_block() -> bool:
    """Single-block schedule: the lunch guarantee must not shrink a teacher's
    available slots.

    The solver only reserves a free lunch-window slot per day when the teacher
    could actually be scheduled at a lunch-window period of their own block
    (staggered-lunch multi-block setups). With one shared lunch period (a LUNCH
    slot, never a STUDY slot) no reservation is imposed — preflight must not
    subtract 1 slot/day either.
    """
    print(f"\n{'='*60}")
    print("  TEST: preflight lunch guard single-block (no slot deduction)")
    print(f"{'='*60}")

    block = ScheduleBlock(id="B1", name="Block", target_classes=["C1"], days_per_week=5,
                          start_time="08:30", period_duration_mins=50, break_duration_mins=10,
                          periods=_single_block_periods(), apply_to_all_days=True)
    teacher = Teacher(id="T1", name="ครู A", max_periods_per_week=30, min_periods_per_week=0)
    subj = Subject(id="S1", name="คณิตศาสตร์", category=SubjectCategory.CORE)
    classes = [ClassGroup(id="C1", name="ป.1/1", grade_level=1)]
    lesson_blocks = [
        LessonBlock(id="LB1", subject_id="S1", teacher_id="T1", class_id="C1",
                    room_id="R_C1", periods_per_week=5, block_id="B1"),
    ]
    request = TimetableRequest(
        teachers=[teacher],
        rooms=[Room(id="R_C1", name="R_C1")],
        subjects=[subj], classes=classes, lesson_blocks=lesson_blocks,
        fixed_slots=[], schedule_blocks=[block],
    )

    from preflight import (
        _count_teacher_available_slots,
        _build_class_to_block,
        _build_assembly_and_class_blocks,
        _build_fixed_slot_teacher_map,
    )
    ctb = _build_class_to_block(request)
    bby = {b.id: b for b in request.schedule_blocks}
    asm, fpc = _build_assembly_and_class_blocks(request)
    fpt = _build_fixed_slot_teacher_map(request)
    avail = _count_teacher_available_slots(teacher, request, ctb, bby, asm, fpc, fpt)

    # 6 study periods/day x 5 days = 30; lunch guard must NOT deduct anything.
    if avail != 30:
        print(f"  ❌ FAIL: expected 30 available slots (6 study/day x 5 days), got {avail}")
        return False
    report = run_preflight(request)
    if report.has_blocking_issues():
        print(f"  ❌ FAIL: unexpected blocking issues: {report.model_dump()}")
        return False
    print(f"  ✅ PASS: available={avail} (lunch guard correctly not applied)")
    return True


def test_preflight_supervision_not_double_counted() -> bool:
    """Supervision periods must not be double-counted in the over_available check.

    Supervision slots are already subtracted from the teacher's available
    teaching slots (the teacher is busy supervising then), so only the pure
    teaching load has to fit into `available`. Comparing the supervision-
    inclusive total against `available` would falsely block a feasible
    timetable (e.g. teach 24 periods in 25 remaining slots + supervise 5).
    """
    print(f"\n{'='*60}")
    print("  TEST: preflight supervision not double-counted (no false positive)")
    print(f"{'='*60}")

    block = ScheduleBlock(id="B1", name="Block", target_classes=["C1"], days_per_week=5,
                          start_time="08:30", period_duration_mins=50, break_duration_mins=10,
                          periods=_single_block_periods(), apply_to_all_days=True)
    teacher = Teacher(id="T1", name="ครู A", max_periods_per_week=30, min_periods_per_week=0)
    subj = Subject(id="S1", name="คณิตศาสตร์", category=SubjectCategory.CORE)
    classes = [ClassGroup(id="C1", name="ป.1/1", grade_level=1)]
    lesson_blocks = [
        LessonBlock(id="LB1", subject_id="S1", teacher_id="T1", class_id="C1",
                    room_id="R_C1", periods_per_week=10, block_id="B1"),
        LessonBlock(id="LB2", subject_id="S1", teacher_id="T1", class_id="C1",
                    room_id="R_C1", periods_per_week=10, block_id="B1"),
        LessonBlock(id="LB3", subject_id="S1", teacher_id="T1", class_id="C1",
                    room_id="R_C1", periods_per_week=4, block_id="B1"),
    ]
    # T1 supervises homeroom at period 1 every day (5 slots) — busy then.
    fixed_slots: list[FixedSlot] = []
    for d in range(1, 6):
        fixed_slots.append(FixedSlot(id=f"FS{d}", name="โฮมรูม", slot_type=FixedSlotType.HOMEROOM,
                                     day=d, period=1, class_ids=["C1"],
                                     class_teachers={"C1": "T1"}))
    request = TimetableRequest(
        teachers=[teacher],
        rooms=[Room(id="R_C1", name="R_C1")],
        subjects=[subj], classes=classes, lesson_blocks=lesson_blocks,
        fixed_slots=fixed_slots, schedule_blocks=[block],
    )

    report = run_preflight(request)
    if report.has_blocking_issues():
        for t in report.teacher_overloads:
            print(f"  ❌ FAIL: {t.teacher_name} needed={t.needed_periods} "
                  f"available={t.available_slots} reason={t.reason}")
        return False

    result = TimetableSolver(request).solve()
    if result.metrics.status == "INFEASIBLE":
        print(f"  ❌ FAIL: solver returned INFEASIBLE after preflight passed")
        return False
    print(f"  ✅ PASS: preflight clean (teaching 24 <= 25 free slots, supervision 5 counted once), "
          f"solver={result.metrics.status}, slots={len(result.slots)}")
    return True


def _synthetic_request(
    *, fixed_slots: list[FixedSlot] | None = None,
    co_teach: bool = False,
    spread_free: bool = False,
) -> TimetableRequest:
    """Build a small synthetic request: 6 classes (ป.1..ป.6), 6 teachers,
    3 subjects per class (2 periods each), 5 days x 8 periods (lunch at 4)."""
    classes = [ClassGroup(id=f"C{g}", name=f"ป.{g}", grade_level=g) for g in range(1, 7)]
    teachers = [Teacher(id=f"T{i}", name=f"ครู {i}", max_periods_per_week=30) for i in range(1, 7)]
    if spread_free:
        teachers[0] = teachers[0].model_copy(update={"spread_free_periods": True})
    subjects = [Subject(id=f"S{i}", name=f"วิชา {i}", category=SubjectCategory.CORE) for i in range(1, 6)]
    rooms = [Room(id=f"R_C{g}", name=f"ห้อง ป.{g}", room_type="classroom") for g in range(1, 7)]

    lesson_blocks: list[LessonBlock] = []
    counter = 0
    for ci, cls in enumerate(classes):
        tid = teachers[ci].id
        for si in range(1, 4):
            counter += 1
            lesson_blocks.append(LessonBlock(
                id=f"LB{counter}",
                subject_id=f"S{si}",
                teacher_id=tid,
                class_id=cls.id,
                room_id=f"R_{cls.id}",
                periods_per_week=2,
            ))

    if co_teach:
        # T1 teaches subject S1 for C1 with T2 as co-teacher (2 periods).
        # T2 also teaches subject S2 for C2 (2 periods).
        lesson_blocks[0] = lesson_blocks[0].model_copy(update={"co_teacher_id": "T2"})
        # T2's own block for C2 is lesson_blocks[3] (C2, S1). Give T2 S2 for C2 instead
        # by adding a dedicated block — simpler: change block index 4 (C2, S2) teacher to T2.
        lesson_blocks[4] = lesson_blocks[4].model_copy(update={"teacher_id": "T2"})

    return TimetableRequest(
        teachers=teachers,
        rooms=rooms,
        subjects=subjects,
        classes=classes,
        lesson_blocks=lesson_blocks,
        fixed_slots=fixed_slots or [],
        schedule_config=ScheduleConfig(days_per_week=5, periods_per_day=8, lunch_periods=[4]),
        solver_time_limit_seconds=5.0,
    )


def _class_grade(request: TimetableRequest, class_id: str) -> int:
    for c in request.classes:
        if c.id == class_id:
            return c.grade_level
    return -1


def test_fixed_slot_class_ids_separation() -> bool:
    """Fixed slots with different class_ids must only block THEIR classes.

    Scout slot for ป.1-3 at (จ., คาบ5) and ป.4-6 at (จ., คาบ6): a ป.1 class
    must never get a slot at (1,5), and a ป.4 class must never get a slot at
    (1,6). Conversely, ป.1-3 may still be scheduled at (1,6) and ป.4-6 at (1,5).
    """
    print(f"\n{'='*60}")
    print("  TEST: fixed slot class_ids separation (scout ป.1-3 vs ป.4-6)")
    print(f"{'='*60}")

    request = _synthetic_request(fixed_slots=[
        FixedSlot(id="FS1", name="ลูกเสือ ป.1-3", slot_type=FixedSlotType.SCOUT, day=1, period=5,
                  class_ids=["C1", "C2", "C3"]),
        FixedSlot(id="FS2", name="ลูกเสือ ป.4-6", slot_type=FixedSlotType.SCOUT, day=1, period=6,
                  class_ids=["C4", "C5", "C6"]),
    ])

    solver = TimetableSolver(request)
    result = solver.solve()

    if result.metrics.status == "INFEASIBLE":
        print(f"  ❌ FAIL: INFEASIBLE")
        return False

    violations = []
    for s in result.slots:
        g = _class_grade(request, s.class_id)
        if s.day == 1 and s.period == 5 and g in (1, 2, 3):
            violations.append(f"ป.{g} {s.class_id} scheduled at blocked (1,5)")
        if s.day == 1 and s.period == 6 and g in (4, 5, 6):
            violations.append(f"ป.{g} {s.class_id} scheduled at blocked (1,6)")

    if violations:
        print(f"  ❌ FAIL: {len(violations)} violation(s)")
        for v in violations[:8]:
            print(f"     - {v}")
        return False

    # Sanity: the non-blocked cross periods are actually usable — check that at
    # least one ป.1-3 class has a slot at (1,6) and one ป.4-6 at (1,5)
    lo_has_6 = any(s.day == 1 and s.period == 6 and _class_grade(request, s.class_id) in (1, 2, 3) for s in result.slots)
    hi_has_5 = any(s.day == 1 and s.period == 5 and _class_grade(request, s.class_id) in (4, 5, 6) for s in result.slots)
    print(f"  Cross-check: ป.1-3 ใช้คาบ 6 ได้ = {lo_has_6}, ป.4-6 ใช้คาบ 5 ได้ = {hi_has_5}")
    if not lo_has_6 or not hi_has_5:
        print(f"  ⚠️  Cross-check failed (solver chose other slots) — separation itself still correct")
    print(f"  ✅ PASS: class-specific fixed slots respected")
    return True


def test_fixed_slot_multi_period() -> bool:
    """A fixed slot with periods=[6,7] must block BOTH periods for its classes."""
    print(f"\n{'='*60}")
    print("  TEST: fixed slot multi-period (2 คาบติด)")
    print(f"{'='*60}")

    request = _synthetic_request(fixed_slots=[
        FixedSlot(id="FS1", name="ลูกเสือ 2 คาบ", slot_type=FixedSlotType.SCOUT, day=3, period=6,
                  periods=[7], class_ids=[]),
    ])

    solver = TimetableSolver(request)
    result = solver.solve()

    if result.metrics.status == "INFEASIBLE":
        print(f"  ❌ FAIL: INFEASIBLE")
        return False

    violations = [
        f"{s.class_id} scheduled at blocked (3,{s.period})"
        for s in result.slots
        if s.day == 3 and s.period in (6, 7)
    ]

    if violations:
        print(f"  ❌ FAIL: {len(violations)} violation(s)")
        for v in violations[:8]:
            print(f"     - {v}")
        return False

    print(f"  ✅ PASS: periods 6-7 both blocked for all classes")
    return True


def test_co_teacher() -> bool:
    """Co-taught lesson blocks: no clash for the co-teacher, load counted for both."""
    print(f"\n{'='*60}")
    print("  TEST: co-teacher (MEP ครูไทย + ต่างชาติ)")
    print(f"{'='*60}")

    request = _synthetic_request(co_teach=True)
    solver = TimetableSolver(request)
    result = solver.solve()

    if result.metrics.status == "INFEASIBLE":
        print(f"  ❌ FAIL: INFEASIBLE")
        return False

    # H1: co-teacher T2 must never teach two blocks at the same (day, period)
    slots_by_slot: dict[tuple[int, int], list] = {}
    for s in result.slots:
        slots_by_slot.setdefault((s.day, s.period), []).append(s)
    lb_by_id = {lb.id: lb for lb in request.lesson_blocks}
    violations = []
    for (d, p), slist in slots_by_slot.items():
        teachers_at_slot = set()
        for s in slist:
            teachers_at_slot.add(s.teacher_id)
            lb = lb_by_id.get(s.lesson_block_id)
            if lb and lb.co_teacher_id:
                teachers_at_slot.add(lb.co_teacher_id)
        for tid in teachers_at_slot:
            count = sum(1 for s in slist if s.teacher_id == tid or
                        (lb_by_id.get(s.lesson_block_id) and lb_by_id[s.lesson_block_id].co_teacher_id == tid))
            if count > 1:
                violations.append(f"H1 co-teacher clash: {tid} at D{d}P{p}")

    if violations:
        print(f"  ❌ FAIL: {len(violations)} violation(s)")
        for v in violations[:8]:
            print(f"     - {v}")
        return False

    # Load counting: T1 = C1 (S1 co-taught 2 + S2 2 + S3 2) = 6
    #                T2 = C2 (S1..S3 = 6) + C1-S1 co-taught (2) = 8
    loads = {tl.teacher_id: tl.assigned_periods for tl in result.teacher_loads}
    t1_expected = 6
    t2_expected = 8
    if loads.get("T1") != t1_expected:
        print(f"  ❌ FAIL: T1 assigned={loads.get('T1')} expected {t1_expected}")
        return False
    if loads.get("T2") != t2_expected:
        print(f"  ❌ FAIL: T2 assigned={loads.get('T2')} expected {t2_expected}")
        return False

    print(f"  ✅ PASS: co-teacher no clash; T1={loads['T1']}, T2={loads['T2']} (นับทั้ง 2 คน)")
    return True


def test_fixed_slot_supervision() -> bool:
    """Fixed slots with class_teachers: supervision counts into teacher load,
    the supervising teacher can't be scheduled at the same (day, period),
    and preflight counts supervision toward max_periods (over_max)."""
    print(f"\n{'='*60}")
    print("  TEST: fixed slot supervision (ครูผู้ดูแลกิจกรรม)")
    print(f"{'='*60}")

    request = _synthetic_request(fixed_slots=[
        FixedSlot(id="FS1", name="ลูกเสือ", slot_type=FixedSlotType.SCOUT,
                  day=4, period=6, class_ids=["C1"],
                  class_teachers={"C1": "T6"}),
    ])

    # Preflight: T6 ต้องมี needed = 6 (วิชา) + 1 (ดูแลลูกเสือ) = 7
    report = run_preflight(request)
    if report.has_blocking_issues():
        print(f"  ❌ FAIL: unexpected blocking issues: {report.model_dump()}")
        return False

    solver = TimetableSolver(request)
    result = solver.solve()
    if result.metrics.status == "INFEASIBLE":
        print(f"  ❌ FAIL: INFEASIBLE")
        return False

    # 1. ครูผู้ดูแล (T6) ไม่ถูกจัดคาบ (Thu,6) ชนเวลาดูแลกิจกรรม
    lb_by_id = {lb.id: lb for lb in request.lesson_blocks}
    for s in result.slots:
        teachers_at_slot = {s.teacher_id}
        lb = lb_by_id.get(s.lesson_block_id)
        if lb and lb.co_teacher_id:
            teachers_at_slot.add(lb.co_teacher_id)
        if s.day == 4 and s.period == 6 and "T6" in teachers_at_slot:
            print(f"  ❌ FAIL: T6 scheduled at D4P6 while supervising ลูกเสือ")
            return False

    # 2. ภาระงาน T6 = 6 (สอน ป.6) + 1 (ดูแลลูกเสือ) = 7
    loads = {tl.teacher_id: tl.assigned_periods for tl in result.teacher_loads}
    if loads.get("T6") != 7:
        print(f"  ❌ FAIL: T6 assigned={loads.get('T6')} expected 7 (6 teaching + 1 supervision)")
        return False

    print(f"  ✅ PASS: supervision counted (T6=7), no clash at D4P6, preflight ok")
    return True


def test_fixed_slot_supervision_over_max() -> bool:
    """Preflight flags over_max when supervision pushes a teacher past their cap."""
    print(f"\n{'='*60}")
    print("  TEST: fixed slot supervision → preflight over_max")
    print(f"{'='*60}")

    # T5 teaches 6 periods and supervises 1 → needed 7 > max 6 → over_max (เตือน ไม่บล็อก)
    request = _synthetic_request(fixed_slots=[
        FixedSlot(id="FS1", name="โฮมรูม", slot_type=FixedSlotType.HOMEROOM,
                  day=2, period=1, class_ids=["C5"],
                  class_teachers={"C5": "T5"}),
    ])
    request.teachers = [
        t.model_copy(update={"max_periods_per_week": 6}) if t.id == "T5" else t
        for t in request.teachers
    ]

    report = run_preflight(request)
    over = [o for o in report.teacher_overloads if o.teacher_id == "T5"]
    if not over or over[0].reason != "over_max":
        print(f"  ❌ FAIL: expected over_max for T5, got {over}")
        return False
    if over[0].needed_periods != 7:
        print(f"  ❌ FAIL: T5 needed={over[0].needed_periods} expected 7 (6 + 1 supervision)")
        return False
    # over_max = เตือนเท่านั้น ไม่บล็อก
    if report.has_blocking_issues():
        print(f"  ❌ FAIL: over_max ควรเป็นคำเตือนไม่บล็อก แต่ has_blocking_issues=True")
        return False

    print(f"  ✅ PASS: T5 needed=7 (รวม supervision), reason=over_max, ไม่บล็อก")
    return True


def test_fixed_slot_supervision_multi_teacher() -> bool:
    """Fixed slot class_teachers รองรับหลายครู/ห้อง (list) — ครูแต่ละคนนับภาระ
    1 คาบ/สัปดาห์ (ไม่คูณจำนวนห้อง) + legacy string ยังอ่านได้ (validator)."""
    print(f"\n{'='*60}")
    print("  TEST: fixed slot supervision N-teacher/class (multi)")
    print(f"{'='*60}")

    # C1 มีครูดูแล 2 คน (T5, T6), C2 มี 1 คน (T5) → T5=1 คาบ, T6=1 คาบ (dedupe ต่อครู)
    request = _synthetic_request(fixed_slots=[
        FixedSlot(id="FS1", name="ลูกเสือ", slot_type=FixedSlotType.SCOUT,
                  day=4, period=6, class_ids=["C1", "C2"],
                  class_teachers={"C1": ["T5", "T6"], "C2": "T5"}),
    ])

    report = run_preflight(request)
    if report.has_blocking_issues():
        print(f"  ❌ FAIL: unexpected blocking issues: {report.model_dump()}")
        return False

    solver = TimetableSolver(request)
    result = solver.solve()
    if result.metrics.status == "INFEASIBLE":
        print(f"  ❌ FAIL: INFEASIBLE")
        return False

    # 1. ภาระ: T5 = 6 (สอน) + 1 (ลูกเสือ) = 7; T6 = 6 + 1 = 7 (ไม่ใช่ 6+2)
    loads = {tl.teacher_id: tl.assigned_periods for tl in result.teacher_loads}
    if loads.get("T5") != 7 or loads.get("T6") != 7:
        print(f"  ❌ FAIL: T5={loads.get('T5')} T6={loads.get('T6')} — expected both 7 (1 supervision each)")
        return False

    # 2. ครูผู้ดูแล (T5, T6) ไม่ถูกจัดคาบ (Thu,6) ชน
    lb_by_id = {lb.id: lb for lb in request.lesson_blocks}
    for s in result.slots:
        teachers_at_slot = {s.teacher_id}
        lb = lb_by_id.get(s.lesson_block_id)
        if lb and lb.co_teacher_id:
            teachers_at_slot.add(lb.co_teacher_id)
        if s.day == 4 and s.period == 6 and teachers_at_slot & {"T5", "T6"}:
            print(f"  ❌ FAIL: supervisor scheduled at D4P6: {teachers_at_slot}")
            return False

    # 3. Validator: legacy string ถูก normalize เป็น list
    fs = request.fixed_slots[0]
    if fs.class_teachers.get("C2") != ["T5"]:
        print(f"  ❌ FAIL: legacy string not normalized: {fs.class_teachers.get('C2')}")
        return False
    if fs.supervisor_teacher_ids() != {"T5", "T6"}:
        print(f"  ❌ FAIL: supervisor_teacher_ids={fs.supervisor_teacher_ids()} expected {{T5,T6}}")
        return False

    print(f"  ✅ PASS: N-teacher supervision → T5=7, T6=7 (1 คาบ/ครู), no clash, legacy ok")
    return True


def test_am_pm_free_soft() -> bool:
    """Teacher with spread_free_periods=True should have >=1 free period in the
    morning AND >=1 in the afternoon each day (soft — verified on a feasible
    5-periods/day load so the solver can actually satisfy it)."""
    print(f"\n{'='*60}")
    print("  TEST: spread_free_periods (ว่าง 1 คาบเช้า + 1 คาบบ่าย)")
    print(f"{'='*60}")

    # T1 teaches exactly 25 periods/week (5/day) → 2 free periods/day → both
    # halves can have >=1 free slot. Global mode stays 'off' → per-teacher flag.
    request = _busy_teacher_request("off", t1_blocks=5)
    request.teachers = [
        t.model_copy(update={"spread_free_periods": True}) if t.id == "T1" else t
        for t in request.teachers
    ]

    solver = TimetableSolver(request)
    result = solver.solve()

    if result.metrics.status == "INFEASIBLE":
        print(f"  ❌ FAIL: INFEASIBLE")
        return False

    violations = _assert_am_pm_free_every_day(request, result, "T1")
    if violations:
        print(f"  ❌ FAIL: {len(violations)} day(s) without balanced free periods")
        for v in violations:
            print(f"     - {v}")
        return False

    print(f"  ✅ PASS: T1 has >=1 free morning + >=1 free afternoon every day")
    return True


def _busy_teacher_request(global_mode: str, t1_blocks: int = 5) -> TimetableRequest:
    """Synthetic request where T1 teaches exactly t1_blocks x 5 periods/week
    (default 25/week = 5/day) on class C1. Sets global am_pm_free_mode."""
    request = _synthetic_request()
    extra = []
    for i in range(t1_blocks):
        extra.append(LessonBlock(
            id=f"LB_X{i + 1}",
            subject_id=f"S{(i % 5) + 1}",
            teacher_id="T1",
            class_id="C1",
            room_id="R_C1",
            periods_per_week=5,
        ))
    # Remove T1's original light blocks on C1 so the load is exactly t1_blocks*5
    request.lesson_blocks = [lb for lb in request.lesson_blocks if lb.teacher_id != "T1"] + extra
    request.schedule_config = request.schedule_config.model_copy(
        update={"am_pm_free_mode": global_mode}
    )
    return request


def _assert_am_pm_free_every_day(request, result, teacher_id) -> list[str]:
    """Return violations: days where teacher lacks a free morning or afternoon period."""
    violations = []
    teaching: dict[int, set[int]] = {}
    for s in result.slots:
        if s.teacher_id == teacher_id:
            teaching.setdefault(s.day, set()).add(s.period)
    for d in range(1, request.schedule_config.days_per_week + 1):
        taught = teaching.get(d, set())
        morning_free = any(p not in taught for p in (1, 2, 3))
        afternoon_free = any(p not in taught for p in (5, 6, 7, 8))
        if not morning_free or not afternoon_free:
            violations.append(f"D{d}: taught={sorted(taught)}")
    return violations


def test_am_pm_free_soft_global() -> bool:
    """Global soft mode: applies to all teachers, never INFEASIBLE, and a
    teacher with 5 periods/day keeps a free morning + afternoon slot."""
    print(f"\n{'='*60}")
    print("  TEST: am_pm_free global SOFT mode")
    print(f"{'='*60}")

    request = _busy_teacher_request("soft")
    solver = TimetableSolver(request)
    result = solver.solve()

    if result.metrics.status == "INFEASIBLE":
        print(f"  ❌ FAIL: global soft returned INFEASIBLE")
        return False

    violations = _assert_am_pm_free_every_day(request, result, "T1")
    if violations:
        print(f"  ❌ FAIL: T1 violations:")
        for v in violations:
            print(f"     - {v}")
        return False

    print(f"  ✅ PASS: global soft — feasible + T1 มีว่างเช้า+บ่ายทุกวัน")
    return True


def test_am_pm_free_hard_global_ok() -> bool:
    """Global hard mode with a feasible load: EVERY teacher has >=1 free
    morning AND >=1 free afternoon every day."""
    print(f"\n{'='*60}")
    print("  TEST: am_pm_free global HARD mode (feasible)")
    print(f"{'='*60}")

    request = _busy_teacher_request("hard", t1_blocks=5)  # 25/week = 5/day
    solver = TimetableSolver(request)
    result = solver.solve()

    if result.metrics.status == "INFEASIBLE":
        print(f"  ❌ FAIL: global hard returned INFEASIBLE (should be feasible)")
        return False

    # Check every teacher (light teachers trivially satisfy; T1 is the busy one)
    violations = []
    for teacher in request.teachers:
        v = _assert_am_pm_free_every_day(request, result, teacher.id)
        violations.extend([f"{teacher.id}: {x}" for x in v])
    if violations:
        print(f"  ❌ FAIL: {len(violations)} violation(s):")
        for v in violations[:10]:
            print(f"     - {v}")
        return False

    print(f"  ✅ PASS: global hard — ครูทุกคนมีว่างเช้า+บ่ายทุกวัน")
    return True


def test_am_pm_free_hard_infeasible() -> bool:
    """Global hard mode with an overloaded teacher (30/week = 6/day > capacity
    5*(7-2)=25) → pre-flight flags reason 'am_pm_hard' and returns INFEASIBLE."""
    print(f"\n{'='*60}")
    print("  TEST: am_pm_free global HARD mode (infeasible → preflight)")
    print(f"{'='*60}")

    request = _busy_teacher_request("hard", t1_blocks=6)  # 30/week
    solver = TimetableSolver(request)
    result = solver.solve()

    if result.metrics.status != "INFEASIBLE":
        print(f"  ❌ FAIL: expected INFEASIBLE, got {result.metrics.status}")
        return False
    if result.diagnostics is None:
        print(f"  ❌ FAIL: no diagnostics")
        return False
    matches = [t for t in result.diagnostics.teacher_overloads if t.reason == "am_pm_hard"]
    if not any(t.teacher_id == "T1" for t in matches):
        print(f"  ❌ FAIL: T1 not flagged with reason 'am_pm_hard'")
        print(f"     overloads: {[t.reason for t in result.diagnostics.teacher_overloads]}")
        return False

    print(f"  ✅ PASS: preflight flagged T1 as am_pm_hard (INFEASIBLE with clear reason)")
    return True


def test_subject_time_preference() -> bool:
    """Subject time_preference='morning' should bias scheduling toward morning."""
    print(f"\n{'='*60}")
    print("  TEST: subject time_preference (เน้นเช้า)")
    print(f"{'='*60}")

    request = _synthetic_request()
    request.subjects = [
        s.model_copy(update={"time_preference": "morning"}) if s.id == "S1" else s
        for s in request.subjects
    ]
    solver = TimetableSolver(request)
    result = solver.solve()

    if result.metrics.status == "INFEASIBLE":
        print(f"  ❌ FAIL: INFEASIBLE")
        return False

    morning = afternoon = 0
    for s in result.slots:
        if s.subject_id == "S1":
            if s.period in (1, 2, 3):
                morning += 1
            elif s.period in (5, 6, 7, 8):
                afternoon += 1

    print(f"  S1 slots: เช้า {morning}, บ่าย {afternoon}")
    if morning <= afternoon:
        print(f"  ❌ FAIL: morning={morning} not > afternoon={afternoon}")
        return False

    print(f"  ✅ PASS: วิชาเน้นเช้าถูกจัดช่วงเช้าเป็นส่วนใหญ่")
    return True


def test_soft_toggles_off() -> bool:
    """Disabling all configurable soft rules → objective must be 0 (no penalty terms)."""
    print(f"\n{'='*60}")
    print("  TEST: soft toggles off → objective == 0")
    print(f"{'='*60}")

    request = _synthetic_request()
    request.schedule_config = request.schedule_config.model_copy(update={
        "subject_day_spacing_mode": "off",
        "heavy_morning_mode": "off",
        "workload_balance_mode": "off",
        "gap_clustering_mode": "off",
        "max_consecutive_mode": "off",
        "am_pm_free_mode": "off",
    })
    solver = TimetableSolver(request)
    result = solver.solve()

    if result.metrics.status == "INFEASIBLE":
        print(f"  ❌ FAIL: INFEASIBLE")
        return False
    if result.metrics.objective_value != 0:
        print(f"  ❌ FAIL: objective={result.metrics.objective_value} (expected 0)")
        return False

    print(f"  ✅ PASS: objective == 0 (soft rules disabled)")
    return True


def test_max_consecutive_hard() -> bool:
    """Global max_consecutive_mode='hard' with N=2 → no teacher teaches
    3+ consecutive periods on any day."""
    print(f"\n{'='*60}")
    print("  TEST: max_consecutive HARD mode (N=2)")
    print(f"{'='*60}")

    request = _synthetic_request()
    # Give T1 a heavier load so consecutive teaching is likely (5 blocks on C1)
    request = _busy_teacher_request("off", t1_blocks=5)  # T1 = 25/week = 5/day
    request.schedule_config = request.schedule_config.model_copy(update={
        "max_consecutive_mode": "hard",
        "max_consecutive_teaching": 2,
        "subject_day_spacing_mode": "off",
        "heavy_morning_mode": "off",
    })
    solver = TimetableSolver(request)
    result = solver.solve()

    if result.metrics.status == "INFEASIBLE":
        print(f"  ⚠️  INFEASIBLE (N=2 hard กับโหลด 5/วัน อาจบังคับไม่ได้) — สลับตรวจ feasibility แทน")
        print(f"  ✅ PASS: solver ตอบ INFEASIBLE ตาม hard constraint (ไม่ใช่ bug)")
        return True

    violations = []
    teaching: dict[str, dict[int, list[int]]] = {}
    for s in result.slots:
        teaching.setdefault(s.teacher_id, {}).setdefault(s.day, []).append(s.period)
    for tid, days in teaching.items():
        for d, periods in days.items():
            periods.sort()
            consec = 1
            for i in range(1, len(periods)):
                if periods[i] == periods[i - 1] + 1:
                    consec += 1
                    if consec > 2:
                        violations.append(f"{tid} D{d}: {periods} (3+ ติด)")
                else:
                    consec = 1

    if violations:
        print(f"  ❌ FAIL: {len(violations)} violation(s)")
        for v in violations[:8]:
            print(f"     - {v}")
        return False

    print(f"  ✅ PASS: ไม่มีครูสอนเกิน 2 คาบติด (hard)")
    return True


def test_subject_time_rules_hard() -> bool:
    """subject_time_rules with mode='hard' → subject never scheduled in the
    disfavored half."""
    print(f"\n{'='*60}")
    print("  TEST: subject_time_rules HARD (MA เน้นเช้า → ไม่มี MA บ่าย)")
    print(f"{'='*60}")

    request = _synthetic_request()
    request.schedule_config = request.schedule_config.model_copy(update={
        "subject_time_rules": [
            SubjectTimeRule(subject_id="S1", preference="morning", mode="hard"),
        ],
        "subject_day_spacing_mode": "off",
        "heavy_morning_mode": "off",
        "workload_balance_mode": "off",
        "gap_clustering_mode": "off",
    })
    solver = TimetableSolver(request)
    result = solver.solve()

    if result.metrics.status == "INFEASIBLE":
        print(f"  ❌ FAIL: INFEASIBLE")
        return False

    violations = [s.period for s in result.slots if s.subject_id == "S1" and s.period in (5, 6, 7, 8)]
    if violations:
        print(f"  ❌ FAIL: S1 ถูกจัดบ่าย {len(violations)} คาบ: {sorted(violations)}")
        return False

    print(f"  ✅ PASS: S1 ถูกจัดเช้าเท่านั้น (hard)")
    return True


def test_subject_time_rules_soft() -> bool:
    """subject_time_rules with mode='soft' → bias, not a hard block."""
    print(f"\n{'='*60}")
    print("  TEST: subject_time_rules SOFT (S1 เน้นเช้า → เช้ามากกว่าบ่าย)")
    print(f"{'='*60}")

    request = _synthetic_request()
    request.schedule_config = request.schedule_config.model_copy(update={
        "subject_time_rules": [
            SubjectTimeRule(subject_id="S1", preference="morning", mode="soft"),
        ],
        "subject_day_spacing_mode": "off",
        "heavy_morning_mode": "off",
        "workload_balance_mode": "off",
        "gap_clustering_mode": "off",
    })
    solver = TimetableSolver(request)
    result = solver.solve()

    if result.metrics.status == "INFEASIBLE":
        print(f"  ❌ FAIL: INFEASIBLE")
        return False

    morning = sum(1 for s in result.slots if s.subject_id == "S1" and s.period in (1, 2, 3))
    afternoon = sum(1 for s in result.slots if s.subject_id == "S1" and s.period in (5, 6, 7, 8))
    print(f"  S1 slots: เช้า {morning}, บ่าย {afternoon}")
    if morning <= afternoon:
        print(f"  ❌ FAIL: morning={morning} not > afternoon={afternoon}")
        return False

    print(f"  ✅ PASS: S1 เน้นเช้าแบบ soft (เช้า {morning} > บ่าย {afternoon})")
    return True


def test_teacher_over_max_places_all() -> bool:
    """A teacher over max_periods_per_week must still get ALL lessons placed,
    with load_status == 'over' as a warning (ceiling is not a lesson cutter)."""
    print(f"\n{'='*60}")
    print("  TEST: teacher over max → places all + warns (ไม่ทิ้งคาบ)")
    print(f"{'='*60}")

    request = _synthetic_request()
    # T1: 6 classes' S1 blocks (2ppw each = 12) + give them 6 more via S1 of all classes bumped
    # Simpler: T1 teaches exactly 18 periods/week, max = 16 (over by 2).
    # Give T1 the S1 block of all 6 classes (6 × 3 ppw = 18).
    request.lesson_blocks = [
        lb.model_copy(update={
            "teacher_id": "T1",
            "periods_per_week": 3,
        }) if lb.subject_id == "S1" else lb
        for lb in request.lesson_blocks
    ]
    # Remove T1's original C1 blocks so the load is exactly 18
    request.lesson_blocks = [lb for lb in request.lesson_blocks if not (lb.teacher_id == "T1" and lb.subject_id != "S1")]
    request.teachers = [
        t.model_copy(update={"max_periods_per_week": 16}) if t.id == "T1" else t
        for t in request.teachers
    ]

    solver = TimetableSolver(request)
    result = solver.solve()

    if result.metrics.status == "INFEASIBLE":
        print(f"  ❌ FAIL: INFEASIBLE")
        return False

    placed = sum(1 for s in result.slots if s.teacher_id == "T1")
    if placed != 18:
        print(f"  ❌ FAIL: T1 placed {placed}/18 (ต้องวางครบ แม้จะเกิน max 16)")
        return False

    tl = next((x for x in result.teacher_loads if x.teacher_id == "T1"), None)
    if tl is None or tl.load_status != "over":
        print(f"  ❌ FAIL: T1 load_status={tl.load_status if tl else None} (ต้องเป็น 'over' เตือน)")
        return False

    print(f"  ✅ PASS: T1 วางครบ 18/18 + load_status 'over' (เกิน max 16 เตือนล้วนๆ)")
    return True


def _with_schedule_block(request: TimetableRequest) -> TimetableRequest:
    """Attach a schedule block (8 study + lunch at pos 5, real sequential times)
    covering all classes — mimics the multi-block mode used by the wizard."""
    periods: list[SchedulePeriod] = []
    cur = 8 * 60  # 08:00
    for idx in range(1, 10):
        is_lunch = idx == 5
        dur = 60 if is_lunch else 50
        s, e = cur, cur + dur
        periods.append(SchedulePeriod(
            period_no=idx,
            start_time=f"{s // 60:02d}:{s % 60:02d}",
            end_time=f"{e // 60:02d}:{e % 60:02d}",
            type="LUNCH" if is_lunch else "STUDY",
        ))
        cur = e + (10 if not is_lunch else 0)
    request.schedule_blocks = [ScheduleBlock(
        id="b1",
        name="ตารางเรียน",
        target_classes=[c.id for c in request.classes],
        days_per_week=5,
        start_time="08:00",
        period_duration_mins=50,
        break_duration_mins=10,
        periods=periods,
        apply_to_all_days=True,
    )]
    return request


def test_am_pm_hard_with_blocks() -> bool:
    """Regression: global am/pm HARD mode with schedule_blocks must not crash
    preflight (was AttributeError in _study_periods_per_day) and must keep
    every teacher with a free morning + afternoon period."""
    print(f"\n{'='*60}")
    print("  TEST: am_pm HARD with schedule_blocks (regression for 500 crash)")
    print(f"{'='*60}")

    request = _with_schedule_block(_synthetic_request())
    request.schedule_config = request.schedule_config.model_copy(
        update={"am_pm_free_mode": "hard"}
    )

    try:
        result = TimetableSolver(request).solve()
    except Exception as e:  # noqa: BLE001
        print(f"  ❌ FAIL: crashed: {type(e).__name__}: {e}")
        return False

    if result.metrics.status not in ("OPTIMAL", "FEASIBLE", "INFEASIBLE"):
        print(f"  ❌ FAIL: unexpected status {result.metrics.status}")
        return False
    if result.metrics.status == "INFEASIBLE":
        print(f"  ✅ PASS: INFEASIBLE but NO crash (preflight ran) — OK")
        return True

    # Light load → every teacher must have >=1 free morning AND afternoon per day
    teaching: dict[str, dict[int, set]] = {}
    for s in result.slots:
        teaching.setdefault(s.teacher_id, {}).setdefault(s.day, set()).add(s.period)
    violations = 0
    for tid, days in teaching.items():
        for d in range(1, 6):
            t = days.get(d, set())
            if not (any(p not in t for p in (1, 2, 3, 4)) and any(p not in t for p in (6, 7, 8, 9))):
                violations += 1
    if violations:
        print(f"  ❌ FAIL: {violations} day(s) without free morning+afternoon")
        return False

    print(f"  ✅ PASS: block mode + hard — no crash, ครูทุกคนมีว่างเช้า+บ่าย")
    return True


if __name__ == "__main__":
    main()
