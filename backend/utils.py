"""Shared utility helpers used across solver, preflight, and excel_parser.

Centralizes common operations (time parsing, period filtering, row getters)
to eliminate duplication and ensure consistent behavior.
"""
from __future__ import annotations

from typing import Any, Callable, Iterable

from models import PeriodType, ScheduleBlock


# ── Time helpers ────────────────────────────────────────────────────────────

def time_to_minutes(hhmm: str) -> int:
    """Convert 'HH:MM' to minutes from midnight.

    Raises ValueError if the format is invalid.
    """
    parts = hhmm.split(":")
    if len(parts) != 2:
        raise ValueError(f"Invalid time format: {hhmm!r} (expected 'HH:MM')")
    return int(parts[0]) * 60 + int(parts[1])


def time_intervals_overlap(
    start1: int, end1: int, start2: int, end2: int
) -> bool:
    """Return True if [start1, end1) overlaps [start2, end2)."""
    return max(start1, start2) < min(end1, end2)


# ── Period helpers ──────────────────────────────────────────────────────────

def get_periods_for_block_on_day(blk: ScheduleBlock, day: int) -> list:
    """Return the period list for a block on a given day (per-day aware)."""
    if not blk.apply_to_all_days and blk.periods_by_day:
        return blk.periods_by_day.get(str(day), blk.periods)
    return blk.periods


def filter_periods_by_type(
    periods: Iterable, period_type: PeriodType
) -> list:
    """Return period numbers matching the given PeriodType."""
    return [p.period_no for p in periods if p.type == period_type]


def filter_study_periods(periods: Iterable) -> list:
    """Shortcut: return STUDY period numbers."""
    return filter_periods_by_type(periods, PeriodType.STUDY)


def filter_lunch_periods(periods: Iterable) -> list:
    """Shortcut: return LUNCH period numbers."""
    return filter_periods_by_type(periods, PeriodType.LUNCH)


# ── Lunch window ────────────────────────────────────────────────────────────

LUNCH_WINDOW_START = 11 * 60   # 11:00
LUNCH_WINDOW_END = 13 * 60 + 30  # 13:30


def is_in_lunch_window(start_min: int, end_min: int) -> bool:
    """Check if a time interval falls within the lunch window (11:00-13:30)."""
    return start_min >= LUNCH_WINDOW_START and end_min <= LUNCH_WINDOW_END


# ── Slot string helpers ─────────────────────────────────────────────────────

def slot_key(day: int, period) -> str:
    """Canonical 'day-period' key matching the frontend's `${day}-${period}`.

    period_no may be a float (multi-block SchedulePeriod.period_no, e.g. 3.5
    for inserted short breaks). Whole floats are rendered without '.0' so a
    lock sent as '3-5' matches solver-generated keys — without this, every
    teacher unavailable/admin-free lock was silently ignored in multi-block
    mode because '3-5.0' != '3-5'.
    """
    p = period
    if isinstance(p, float) and p.is_integer():
        p = int(p)
    return f"{day}-{p}"


def parse_day_period(slot_str: str) -> tuple[int, int] | None:
    """Parse 'day-period' string (e.g. '1-7') into (day, period) tuple.

    Returns None if the format is invalid.
    """
    parts = slot_str.split("-")
    if len(parts) != 2:
        return None
    try:
        return int(parts[0]), int(parts[1])
    except ValueError:
        return None


# ── Excel row getter factory ────────────────────────────────────────────────

def make_row_getter(
    mapping: dict[str, str | None],
    header_idx: dict[str, int],
) -> Callable[[tuple, str], str]:
    """Create a closure that extracts a field value from a worksheet row.

    Usage:
        get_val = make_row_getter(mapping, header_idx)
        teacher_name = get_val(row, "teacher_name")
    """
    def get_val(row: tuple, field: str) -> str:
        header = mapping.get(field)
        if not header or header not in header_idx:
            return ""
        idx = header_idx[header]
        val = row[idx] if idx < len(row) else None
        if val is None:
            return ""
        return str(val).strip()

    return get_val


# ── Entity deduplication ────────────────────────────────────────────────────

def deduplicate_entity(
    entity_map: dict[str, str],
    entity_name: str,
    prefix: str,
    extra_fields: dict[str, Any] | None = None,
) -> str:
    """Return existing ID for entity_name or create a new one.

    Mutates entity_map in place: { name -> id }.
    """
    if entity_name in entity_map:
        return entity_map[entity_name]
    new_id = f"{prefix}{len(entity_map) + 1}"
    entity_map[entity_name] = new_id
    return new_id


# ── Safe integer parsing ────────────────────────────────────────────────────

import re as _re


def safe_extract_int(text: str, default: int = 0) -> int:
    """Extract the first integer from a string using regex.

    Returns `default` if the string is empty, None, or contains no digits.
    """
    if not text:
        return default
    match = _re.search(r"\d+", str(text))
    if match is None:
        return default
    try:
        return int(match.group())
    except ValueError:
        return default
