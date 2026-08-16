"""Schedule config storage with JSON file persistence and preset templates."""
from __future__ import annotations

import json
import uuid
from pathlib import Path

from models import ScheduleTemplate, PeriodDefinition, SpecialDay, GradeActivity

DATA_DIR = Path(__file__).parent / "data"
SCHEDULES_FILE = DATA_DIR / "schedules.json"

PRESETS: list[dict] = [
    {
        "id": "preset_matayom_8",
        "name": "มัธยม 8 คาบ (พักคาบ 4)",
        "description": "5 วัน × 8 คาบ, พักเที่ยงคาบ 4",
        "days_per_week": 5,
        "periods_per_day": 8,
        "lunch_periods": [4],
        "period_definitions": [
            {"period_num": 1, "start_time": "08:30", "end_time": "09:20", "period_type": "teaching"},
            {"period_num": 2, "start_time": "09:20", "end_time": "10:10", "period_type": "teaching"},
            {"period_num": 3, "start_time": "10:10", "end_time": "11:00", "period_type": "teaching"},
            {"period_num": 4, "start_time": "11:00", "end_time": "11:50", "period_type": "lunch", "label": "พักเที่ยง"},
            {"period_num": 5, "start_time": "12:30", "end_time": "13:20", "period_type": "teaching"},
            {"period_num": 6, "start_time": "13:20", "end_time": "14:10", "period_type": "teaching"},
            {"period_num": 7, "start_time": "14:10", "end_time": "15:00", "period_type": "teaching"},
            {"period_num": 8, "start_time": "15:00", "end_time": "15:50", "period_type": "teaching"},
        ],
        "grade_levels": [7, 8, 9, 10, 11, 12],
        "special_days": [],
        "grade_activities": [],
        "is_preset": True,
        "is_active": True,
    },
    {
        "id": "preset_matayom_7",
        "name": "มัธยม 7 คาบ (พักคาบ 4)",
        "description": "5 วัน × 7 คาบ, พักเที่ยงคาบ 4",
        "days_per_week": 5,
        "periods_per_day": 7,
        "lunch_periods": [4],
        "period_definitions": [
            {"period_num": 1, "start_time": "08:30", "end_time": "09:25", "period_type": "teaching"},
            {"period_num": 2, "start_time": "09:25", "end_time": "10:20", "period_type": "teaching"},
            {"period_num": 3, "start_time": "10:20", "end_time": "11:15", "period_type": "teaching"},
            {"period_num": 4, "start_time": "11:15", "end_time": "12:00", "period_type": "lunch", "label": "พักเที่ยง"},
            {"period_num": 5, "start_time": "12:30", "end_time": "13:25", "period_type": "teaching"},
            {"period_num": 6, "start_time": "13:25", "end_time": "14:20", "period_type": "teaching"},
            {"period_num": 7, "start_time": "14:20", "end_time": "15:15", "period_type": "teaching"},
        ],
        "grade_levels": [7, 8, 9, 10, 11, 12],
        "special_days": [],
        "grade_activities": [],
        "is_preset": True,
        "is_active": True,
    },
    {
        "id": "preset_prathom_5",
        "name": "ประถม 5 คาบ (พักคาบ 3)",
        "description": "5 วัน × 5 คาบ, พักเที่ยงคาบ 3",
        "days_per_week": 5,
        "periods_per_day": 5,
        "lunch_periods": [3],
        "period_definitions": [
            {"period_num": 1, "start_time": "08:30", "end_time": "09:30", "period_type": "teaching"},
            {"period_num": 2, "start_time": "09:30", "end_time": "10:30", "period_type": "teaching"},
            {"period_num": 3, "start_time": "10:30", "end_time": "11:15", "period_type": "lunch", "label": "พักเที่ยง"},
            {"period_num": 4, "start_time": "12:00", "end_time": "13:00", "period_type": "teaching"},
            {"period_num": 5, "start_time": "13:00", "end_time": "14:00", "period_type": "teaching"},
        ],
        "grade_levels": [1, 2, 3, 4, 5, 6],
        "special_days": [],
        "grade_activities": [],
        "is_preset": True,
        "is_active": True,
    },
]


def _ensure_data_dir():
    DATA_DIR.mkdir(parents=True, exist_ok=True)


def _load_all() -> list[dict]:
    _ensure_data_dir()
    if not SCHEDULES_FILE.exists():
        # Initialize with presets
        SCHEDULES_FILE.write_text(
            json.dumps(PRESETS, indent=2, ensure_ascii=False), encoding="utf-8"
        )
    try:
        return json.loads(SCHEDULES_FILE.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        # Corrupted store — fall back to presets to keep the service alive
        return list(PRESETS)


def _save_all(schedules: list[dict]):
    """Atomically persist schedules (write-temp + rename) to avoid torn writes."""
    _ensure_data_dir()
    tmp = SCHEDULES_FILE.with_suffix(".json.tmp")
    tmp.write_text(
        json.dumps(schedules, indent=2, ensure_ascii=False), encoding="utf-8"
    )
    tmp.replace(SCHEDULES_FILE)


def list_schedules() -> list[ScheduleTemplate]:
    data = _load_all()
    return [ScheduleTemplate(**d) for d in data]


def get_schedule(schedule_id: str) -> ScheduleTemplate | None:
    data = _load_all()
    for d in data:
        if d.get("id") == schedule_id:
            return ScheduleTemplate(**d)
    return None


def create_schedule(template: ScheduleTemplate) -> ScheduleTemplate:
    data = _load_all()
    existing_ids = {d.get("id") for d in data}
    new_id = f"sch_{uuid.uuid4().hex[:8]}"
    while new_id in existing_ids:
        new_id = f"sch_{uuid.uuid4().hex[:8]}"
    template.id = new_id
    data.append(template.model_dump())
    _save_all(data)
    return template


def update_schedule(schedule_id: str, template: ScheduleTemplate) -> ScheduleTemplate | None:
    data = _load_all()
    for i, d in enumerate(data):
        if d.get("id") == schedule_id:
            template.id = schedule_id
            data[i] = template.model_dump()
            _save_all(data)
            return template
    return None


def delete_schedule(schedule_id: str) -> bool:
    data = _load_all()
    before = len(data)
    data = [d for d in data if d.get("id") != schedule_id]
    if len(data) < before:
        _save_all(data)
        return True
    return False
