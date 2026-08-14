"""Generate test fixture JSON files for the timetable solver POC.

Run: python generate_fixtures.py
Produces: school_small.json, school_medium.json, school_large.json
"""
from __future__ import annotations

import json
from pathlib import Path

FIXTURES_DIR = Path(__file__).parent / "fixtures"


def build_fixture(
    num_classes: int,
    num_teachers: int,
    num_subjects: int,
    days: int = 5,
    periods: int = 8,
    lunch: list[int] | None = None,
) -> dict:
    if lunch is None:
        lunch = [4]

    teachers = [
        {"id": f"T{i+1}", "name": f"ครู{i+1}", "max_periods_per_week": 22, "min_periods_per_week": 0}
        for i in range(num_teachers)
    ]

    # T4: Make teacher 1 a finance admin with Thursday afternoon free
    teachers[0]["admin_role"] = "finance"
    teachers[0]["admin_free_slots"] = ["4-5", "4-6", "4-7", "4-8", "5-5", "5-6", "5-7", "5-8"]

    # T5: Make teacher 2 a discipline admin — free period 1 and last period each day
    if num_teachers > 1:
        last_p = periods
        teachers[1]["admin_role"] = "discipline"
        teachers[1]["admin_free_slots"] = [
            f"{d}-1" for d in range(1, days + 1)
        ] + [
            f"{d}-{last_p}" for d in range(1, days + 1)
        ]

    rooms = [
        {"id": f"R{i+1}", "name": f"ห้อง {i+1}", "room_type": "classroom"}
        for i in range(num_classes)
    ]

    subjects = [
        {"id": f"S{i+1}", "name": f"วิชา{i+1}", "category": "core"}
        for i in range(num_subjects)
    ]
    # Make one subject PE
    if num_subjects >= 3:
        subjects[2]["category"] = "pe"
    # S2: Mark first 2 subjects as heavy (math, science)
    if num_subjects >= 2:
        subjects[0]["is_heavy"] = True
        subjects[1]["is_heavy"] = True

    classes = [
        {"id": f"C{i+1}", "name": f"ม.{i+1}", "grade_level": min(i + 1, 6)}
        for i in range(num_classes)
    ]

    # Generate lesson blocks: each class gets each subject
    lesson_blocks = []
    lb_counter = 0
    subjects_per_class = min(num_subjects, num_teachers)  # don't exceed teacher capacity

    for c_idx in range(num_classes):
        for s_idx in range(num_subjects):
            # Assign teacher: rotate teachers across classes for same subject
            teacher_idx = (s_idx + c_idx) % num_teachers
            lb_counter += 1
            ppw = 2 if s_idx < 3 else 1  # first 3 subjects get 2 periods/week
            is_double = (s_idx == 0) and (ppw == 2)  # first subject is double period

            lesson_blocks.append({
                "id": f"LB{lb_counter}",
                "subject_id": f"S{s_idx+1}",
                "teacher_id": f"T{teacher_idx+1}",
                "class_id": f"C{c_idx+1}",
                "room_id": f"R{c_idx+1}",
                "periods_per_week": ppw,
                "is_double_period": is_double,
                "is_fixed": False,
                "fixed_day": None,
                "fixed_period": None,
            })

    # Add assembly fixed slot on Monday period 1 for all classes
    fixed_slots = [
        {
            "id": "FS1",
            "name": "ชุมนุมเช้า",
            "slot_type": "assembly",
            "day": 1,
            "period": 1,
            "class_ids": [],
        }
    ]

    # PE hot periods: periods 7 and 8 (afternoon heat)
    pe_hot = ["1-7", "1-8", "2-7", "2-8", "3-7", "3-8", "4-7", "4-8", "5-7", "5-8"]

    schedule_config = {
        "days_per_week": days,
        "periods_per_day": periods,
        "lunch_periods": lunch,
        "assembly_slots": ["1-1"],
        "max_consecutive_teaching": 4,
        "pe_hot_periods": pe_hot,
    }

    return {
        "teachers": teachers,
        "rooms": rooms,
        "subjects": subjects,
        "classes": classes,
        "lesson_blocks": lesson_blocks,
        "fixed_slots": fixed_slots,
        "schedule_config": schedule_config,
        "solver_time_limit_seconds": 2.0,
    }


def main():
    FIXTURES_DIR.mkdir(parents=True, exist_ok=True)

    # Small: 3 classes, 5 teachers, 5 subjects
    small = build_fixture(num_classes=3, num_teachers=5, num_subjects=5)
    (FIXTURES_DIR / "school_small.json").write_text(
        json.dumps(small, indent=2, ensure_ascii=False), encoding="utf-8"
    )
    print(f"small: {len(small['lesson_blocks'])} lesson blocks, "
          f"{len(small['teachers'])} teachers, {len(small['classes'])} classes")

    # Medium: 6 classes, 12 teachers, 8 subjects
    medium = build_fixture(num_classes=6, num_teachers=12, num_subjects=8)
    (FIXTURES_DIR / "school_medium.json").write_text(
        json.dumps(medium, indent=2, ensure_ascii=False), encoding="utf-8"
    )
    print(f"medium: {len(medium['lesson_blocks'])} lesson blocks, "
          f"{len(medium['teachers'])} teachers, {len(medium['classes'])} classes")

    # Large: 12 classes, 25 teachers, 10 subjects
    large = build_fixture(num_classes=12, num_teachers=25, num_subjects=10)
    (FIXTURES_DIR / "school_large.json").write_text(
        json.dumps(large, indent=2, ensure_ascii=False), encoding="utf-8"
    )
    print(f"large: {len(large['lesson_blocks'])} lesson blocks, "
          f"{len(large['teachers'])} teachers, {len(large['classes'])} classes")


if __name__ == "__main__":
    main()
