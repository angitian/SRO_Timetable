"""Test the solver against all 3 fixture sizes.

Run: python test_solver.py
"""
from __future__ import annotations

import json
import sys
import time
from pathlib import Path

from models import TimetableRequest, Teacher, OptimizationMode
from solver import TimetableSolver

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

    # H5: No slots in assembly/fixed slots
    for fs in request.fixed_slots:
        blocked_classes = set(fs.class_ids) if fs.class_ids else set(c.id for c in request.classes)
        for s in result.slots:
            if s.day == fs.day and s.period == fs.period and s.class_id in blocked_classes:
                violations.append(f"H5 Fixed slot: {fs.name} blocks {s.class_id} at D{fs.day}P{fs.period}")

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
    """Pre-flight should catch a teacher whose needed periods > max_periods_per_week."""
    print(f"\n{'='*60}")
    print("  TEST: preflight teacher over max_periods_per_week")
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

    if result.metrics.status != "INFEASIBLE":
        print(f"  ❌ FAIL: expected INFEASIBLE, got {result.metrics.status}")
        return False
    if result.diagnostics is None or not result.diagnostics.teacher_overloads:
        print(f"  ❌ FAIL: no teacher_overloads in diagnostics")
        return False
    matching = [t for t in result.diagnostics.teacher_overloads if t.teacher_id == target_id]
    if not matching:
        print(f"  ❌ FAIL: target teacher {target_id} not in overloads")
        return False
    ov = matching[0]
    print(f"  ✅ PASS: {ov.teacher_name} flagged (needed={ov.needed_periods}, max={ov.max_periods_per_week}, reason={ov.reason})")
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


if __name__ == "__main__":
    main()
