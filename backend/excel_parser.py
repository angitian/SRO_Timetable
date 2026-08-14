"""Excel import parser with smart auto-mapping for Thai school timetabling.

Uses openpyxl to read .xlsx files and auto-detect column mappings.
"""
from __future__ import annotations

import io
import re
from typing import Any

try:
    from openpyxl import load_workbook
except ImportError:
    load_workbook = None

try:
    from openpyxl import Workbook
except ImportError:
    Workbook = None


# Known labels for auto-mapping (Thai + English)
KNOWN_LABELS: dict[str, list[str]] = {
    "teacher_name": [
        "ชื่อครู", "ครู", "ผู้สอน", "อาจารย์", "ครูผู้สอน", "ชื่อผู้สอน",
        "teacher name", "teacher_name", "teacher", "instructor", "ชื่อครูผู้สอน",
    ],
    "subject": [
        "วิชา", "รายวิชา", "กลุ่มสาระ", "สาระ", "วิชาเรียน", "ชื่อวิชา",
        "subject name", "subject", "course", "course name", "subject_name",
    ],
    "class_name": [
        "ห้อง", "ชั้น", "ห้องเรียน", "ระดับชั้น", "ห้องเรียน", "ชั้นเรียน",
        "class", "classroom", "grade", "room", "section", "class_name",
    ],
    "periods_per_week": [
        "คาบ", "คาบ/สัปดาห์", "จำนวนคาบ", "ชม.", "ชม./สัปดาห์", "คาบสอน",
        "periods", "hours", "per week", "periods per week", "hours per week", "periods_per_week",
    ],
    "is_double": [
        "คาบคู่", "คู่", "double", "double period", "2 periods", "is_double",
    ],
    "room_name": [
        "ห้องเรียนกายภาพ", "ห้องปฏิบัติการ", "สถานที่", "lab",
        "room", "facility", "location", "room_name", "required_facility",
    ],
}


def _normalize(text: str) -> str:
    """Normalize text for comparison: lowercase, strip, remove spaces and underscores."""
    return re.sub(r"[\s_]+", "", text.lower().strip())


def _similarity(a: str, b: str) -> float:
    """Simple similarity score: 0.0 to 1.0 based on substring matching."""
    na = _normalize(a)
    nb = _normalize(b)
    if na == nb:
        return 1.0
    if na in nb or nb in na:
        return 0.9
    # Check partial match
    shorter = min(na, nb, key=len)
    longer = max(na, nb, key=len)
    if len(shorter) >= 3 and shorter in longer:
        return 0.8
    # Character overlap
    common = set(na) & set(nb)
    total = set(na) | set(nb)
    if total:
        return len(common) / len(total) * 0.5
    return 0.0


def auto_map_columns(headers: list[str]) -> dict[str, str | None]:
    """Auto-detect which header maps to which field.

    Returns: { field_name: header_text | None }
    """
    mapping: dict[str, str | None] = {}
    used_headers: set[str] = set()

    for field, labels in KNOWN_LABELS.items():
        best_score = 0.0
        best_header = None

        for header in headers:
            if header in used_headers:
                continue
            for label in labels:
                score = _similarity(header, label)
                if score > best_score:
                    best_score = score
                    best_header = header

        if best_score >= 0.7 and best_header:
            mapping[field] = best_header
            used_headers.add(best_header)
        else:
            mapping[field] = None

    return mapping


def parse_excel(file_bytes: bytes) -> dict[str, Any]:
    """Parse an Excel file and return headers, rows, and auto-mapping.

    Returns: {
        "headers": ["col1", "col2", ...],
        "rows": [["val1", "val2", ...], ...],
        "row_count": int,
        "auto_mapping": { field: header | None },
    }
    """
    if load_workbook is None:
        raise RuntimeError("openpyxl not installed. Run: pip install openpyxl")

    wb = load_workbook(io.BytesIO(file_bytes), data_only=True)
    ws = wb.active

    rows = list(ws.iter_rows(values_only=True))
    if not rows:
        return {"headers": [], "rows": [], "row_count": 0, "auto_mapping": {}}

    # First non-empty row = headers
    headers = [str(c).strip() if c is not None else "" for c in rows[0]]
    data_rows = []
    for row in rows[1:]:
        if all(c is None or str(c).strip() == "" for c in row):
            continue
        data_rows.append([str(c).strip() if c is not None else "" for c in row])

    auto_mapping = auto_map_columns(headers)

    return {
        "headers": headers,
        "rows": data_rows[:5],  # preview first 5 rows
        "all_rows": data_rows,
        "row_count": len(data_rows),
        "auto_mapping": auto_mapping,
    }


def import_with_mapping(
    file_bytes: bytes,
    mapping: dict[str, str],
) -> dict[str, Any]:
    """Import Excel data using the provided column mapping.

    Returns: {
        "teachers": [...],
        "subjects": [...],
        "classes": [...],
        "lesson_blocks": [...],
        "summary": { teachers: int, subjects: int, classes: int, lesson_blocks: int },
    }
    """
    if load_workbook is None:
        raise RuntimeError("openpyxl not installed. Run: pip install openpyxl")

    wb = load_workbook(io.BytesIO(file_bytes), data_only=True)
    ws = wb.active
    rows = list(ws.iter_rows(values_only=True))
    if not rows:
        return {"teachers": [], "subjects": [], "classes": [], "lesson_blocks": [], "summary": {}}

    headers = [str(c).strip() if c is not None else "" for c in rows[0]]
    header_idx = {h: i for i, h in enumerate(headers)}

    teachers_map: dict[str, dict] = {}
    subjects_map: dict[str, dict] = {}
    classes_map: dict[str, dict] = {}
    lesson_blocks: list[dict] = []
    lb_counter = 0

    for row in rows[1:]:
        if all(c is None or str(c).strip() == "" for c in row):
            continue

        def get_val(field):
            header = mapping.get(field)
            if not header or header not in header_idx:
                return ""
            idx = header_idx[header]
            val = row[idx] if idx < len(row) else None
            return str(val).strip() if val is not None else ""

        teacher_name = get_val("teacher_name")
        subject_name = get_val("subject")
        class_name = get_val("class_name")
        ppw_str = get_val("periods_per_week")
        is_double_str = get_val("is_double")
        room_name = get_val("room_name")

        if not teacher_name or not subject_name or not class_name:
            continue

        # Deduplicate teachers
        if teacher_name not in teachers_map:
            tid = f"T{len(teachers_map) + 1}"
            teachers_map[teacher_name] = {
                "id": tid,
                "name": teacher_name,
                "max_periods_per_week": 22,
                "min_periods_per_week": 0,
                "unavailable_slots": [],
                "admin_role": "none",
            }

        # Deduplicate subjects
        if subject_name not in subjects_map:
            sid = f"S{len(subjects_map) + 1}"
            subjects_map[subject_name] = {"id": sid, "name": subject_name, "category": "core", "is_heavy": False}

        # Deduplicate classes
        if class_name not in classes_map:
            cid = f"C{len(classes_map) + 1}"
            # Try to extract grade level from class name (e.g. "ป.1/1" → 1, "ม.2/3" → 8)
            grade = 7
            m = re.match(r"[ปม]\.?\s*(\d+)", class_name)
            if m:
                base = int(m.group(1))
                grade = base if "ป" in class_name else base + 6
            classes_map[class_name] = {"id": cid, "name": class_name, "grade_level": grade}

        # Parse periods_per_week
        try:
            ppw = int(re.search(r"\d+", ppw_str).group()) if ppw_str else 1
        except (AttributeError, ValueError):
            ppw = 1

        is_double = is_double_str.lower() in ("true", "1", "yes", "คู่", "double", "x")

        lb_counter += 1
        class_id = classes_map[class_name]["id"]
        lesson_blocks.append({
            "id": f"LB{lb_counter}",
            "subject_id": subjects_map[subject_name]["id"],
            "teacher_id": teachers_map[teacher_name]["id"],
            "class_id": class_id,
            "room_id": f"R_{class_id}",
            "periods_per_week": ppw,
            "is_double_period": is_double,
            "is_fixed": False,
            "fixed_day": None,
            "fixed_period": None,
        })

    return {
        "teachers": list(teachers_map.values()),
        "subjects": list(subjects_map.values()),
        "classes": list(classes_map.values()),
        "lesson_blocks": lesson_blocks,
        "summary": {
            "teachers": len(teachers_map),
            "subjects": len(subjects_map),
            "classes": len(classes_map),
            "lesson_blocks": len(lesson_blocks),
        },
    }


# ── Multi-sheet import ──────────────────────────────────────────────────────

CONSTRAINT_LABELS: dict[str, list[str]] = {
    "teacher_name": [
        "ชื่อครู", "ครู", "ผู้สอน", "อาจารย์", "ครูผู้สอน", "ชื่อครูผู้สอน",
        "teacher name", "teacher_name", "teacher", "instructor",
    ],
    "max_periods_per_week": [
        "ภาระสูงสุด", "คาบสูงสุด", "max", "max periods", "max_periods_per_week",
        "max periods per week", "ภาระงานสูงสุด",
    ],
    "min_periods_per_week": [
        "ภาระต่ำสุด", "คาบต่ำสุด", "min", "min periods", "min_periods_per_week",
        "min periods per week", "ภาระงานขั้นต่ำ",
    ],
    "unavailable_slots": [
        "ห้ามสอน", "ช่องห้าม", "ไม่ว่าง", "unavailable", "unavailable_slots",
        "blocked slots", "ไม่สะดวก", "ช่องที่ไม่สะดวก",
    ],
    "admin_role": [
        "บทบาท", "หน้าที่", "ตำแหน่ง", "role", "admin role", "admin_role",
        "บทบาทพิเศษ",
    ],
}

FIXED_SLOT_LABELS: dict[str, list[str]] = {
    "name": [
        "ชื่อ", "กิจกรรม", "activity", "name", "ชื่อกิจกรรม", "รายการ",
    ],
    "day": [
        "วัน", "day", "วันที่", "day_of_week",
    ],
    "period": [
        "คาบ", "period", "คาบที่", "period_num",
    ],
    "class_ids": [
        "ห้อง", "class", "classes", "class_ids", "ห้องที่เกี่ยวข้อง",
        "ระดับชั้น", "classes affected",
    ],
    "slot_type": [
        "ประเภท", "type", "slot_type", "ประเภทกิจกรรม",
    ],
}

_SHEET_ALIASES = {
    "course_mapping": ["course_mapping", "course", "mapping", "การสอน", "ผังครู", "ตารางครู", "course mapping"],
    "teacher_constraints": ["teacher_constraints", "constraints", "เงื่อนไขครู", "teacher constraints", "constraints_teacher"],
    "fixed_slots": ["fixed_slots", "fixed", "fixed slots", "คาบตายตัว", "ล็อกคาบ", "fixed slots", "fixedslots"],
}


def _find_sheet(wb, aliases: list[str]) -> Any:
    """Find a worksheet by normalized name matching."""
    for ws in wb.worksheets:
        title_norm = _normalize(ws.title)
        for alias in aliases:
            if _normalize(alias) == title_norm or _normalize(alias) in title_norm:
                return ws
    return None


def _parse_sheet(ws) -> tuple[list[str], list[list[str]]]:
    """Extract headers and data rows from a worksheet."""
    if ws is None:
        return [], []
    rows = list(ws.iter_rows(values_only=True))
    if not rows:
        return [], []
    headers = [str(c).strip() if c is not None else "" for c in rows[0]]
    data_rows = []
    for row in rows[1:]:
        if all(c is None or str(c).strip() == "" for c in row):
            continue
        data_rows.append([str(c).strip() if c is not None else "" for c in row])
    return headers, data_rows


def _parse_unavailable_slots(raw: str) -> list[str]:
    """Parse comma-separated 'day-period' strings, e.g. '1-5, 2-3' → ['1-5', '2-3']."""
    if not raw:
        return []
    slots = []
    for part in raw.split(","):
        part = part.strip()
        if not part:
            continue
        m = re.match(r"(\d+)\s*[-/]\s*(\d+)", part)
        if m:
            slots.append(f"{m.group(1)}-{m.group(2)}")
        else:
            slots.append(part)
    return slots


def _parse_class_ids(raw: str, classes_map: dict[str, dict]) -> list[str]:
    """Parse comma-separated class names or IDs → list of class IDs."""
    if not raw:
        return []
    result = []
    for part in raw.split(","):
        part = part.strip()
        if not part:
            continue
        if part in classes_map:
            result.append(classes_map[part]["id"])
        else:
            result.append(part)
    return result


def import_multi_sheet(
    file_bytes: bytes,
    mapping: dict[str, str] | None = None,
) -> dict[str, Any]:
    """Import Excel data from a multi-sheet workbook.

    Sheets:
      - Course_Mapping (required): teachers, subjects, classes, lesson_blocks
      - Teacher_Constraints (optional): unavailable_slots, max/min periods, admin_role
      - Fixed_Slots (optional): fixed slot definitions

    Returns complete data ready for TimetableRequest.
    """
    if load_workbook is None:
        raise RuntimeError("openpyxl not installed. Run: pip install openpyxl")

    wb = load_workbook(io.BytesIO(file_bytes), data_only=True)

    # ── Sheet 1: Course_Mapping ──────────────────────────────────────────
    ws_course = _find_sheet(wb, _SHEET_ALIASES["course_mapping"]) or wb.active
    headers, data_rows = _parse_sheet(ws_course)

    if mapping is None:
        mapping = auto_map_columns(headers)

    header_idx = {h: i for i, h in enumerate(headers)}

    teachers_map: dict[str, dict] = {}
    subjects_map: dict[str, dict] = {}
    classes_map: dict[str, dict] = {}
    lesson_blocks: list[dict] = []
    lb_counter = 0

    for row in data_rows:
        def get_val(field):
            header = mapping.get(field)
            if not header or header not in header_idx:
                return ""
            idx = header_idx[header]
            val = row[idx] if idx < len(row) else None
            return str(val).strip() if val is not None else ""

        teacher_name = get_val("teacher_name")
        subject_name = get_val("subject")
        class_name = get_val("class_name")
        ppw_str = get_val("periods_per_week")
        is_double_str = get_val("is_double")

        if not teacher_name or not subject_name or not class_name:
            continue

        if teacher_name not in teachers_map:
            tid = f"T{len(teachers_map) + 1}"
            teachers_map[teacher_name] = {
                "id": tid,
                "name": teacher_name,
                "max_periods_per_week": 22,
                "min_periods_per_week": 0,
                "unavailable_slots": [],
                "admin_role": "none",
            }

        if subject_name not in subjects_map:
            sid = f"S{len(subjects_map) + 1}"
            subjects_map[subject_name] = {"id": sid, "name": subject_name, "category": "core", "is_heavy": False}

        if class_name not in classes_map:
            cid = f"C{len(classes_map) + 1}"
            grade = 7
            m = re.match(r"[ปม]\.?\s*(\d+)", class_name)
            if m:
                base = int(m.group(1))
                grade = base if "ป" in class_name else base + 6
            classes_map[class_name] = {"id": cid, "name": class_name, "grade_level": grade}

        try:
            ppw = int(re.search(r"\d+", ppw_str).group()) if ppw_str else 1
        except (AttributeError, ValueError):
            ppw = 1

        is_double = is_double_str.lower() in ("true", "1", "yes", "คู่", "double", "x")

        lb_counter += 1
        class_id = classes_map[class_name]["id"]
        lesson_blocks.append({
            "id": f"LB{lb_counter}",
            "subject_id": subjects_map[subject_name]["id"],
            "teacher_id": teachers_map[teacher_name]["id"],
            "class_id": class_id,
            "room_id": f"R_{class_id}",
            "periods_per_week": ppw,
            "is_double_period": is_double,
            "is_fixed": False,
            "fixed_day": None,
            "fixed_period": None,
        })

    # ── Sheet 2: Teacher_Constraints (optional) ──────────────────────────
    ws_constraints = _find_sheet(wb, _SHEET_ALIASES["teacher_constraints"])
    if ws_constraints is not None:
        c_headers, c_rows = _parse_sheet(ws_constraints)
        c_mapping = auto_map_columns(c_headers)
        # Override with constraint-specific labels
        for field, labels in CONSTRAINT_LABELS.items():
            best_score = 0.0
            best_header = None
            for header in c_headers:
                for label in labels:
                    score = _similarity(header, label)
                    if score > best_score:
                        best_score = score
                        best_header = header
            if best_score >= 0.7 and best_header:
                c_mapping[field] = best_header

        c_header_idx = {h: i for i, h in enumerate(c_headers)}

        for row in c_rows:
            def c_get_val(field):
                header = c_mapping.get(field)
                if not header or header not in c_header_idx:
                    return ""
                idx = c_header_idx[header]
                val = row[idx] if idx < len(row) else None
                return str(val).strip() if val is not None else ""

            t_name = c_get_val("teacher_name")
            if not t_name or t_name not in teachers_map:
                continue

            teacher = teachers_map[t_name]

            max_str = c_get_val("max_periods_per_week")
            if max_str:
                try:
                    teacher["max_periods_per_week"] = int(re.search(r"\d+", max_str).group())
                except (AttributeError, ValueError):
                    pass

            min_str = c_get_val("min_periods_per_week")
            if min_str:
                try:
                    teacher["min_periods_per_week"] = int(re.search(r"\d+", min_str).group())
                except (AttributeError, ValueError):
                    pass

            unavail = c_get_val("unavailable_slots")
            if unavail:
                teacher["unavailable_slots"] = _parse_unavailable_slots(unavail)

            role = c_get_val("admin_role")
            if role:
                role_lower = role.lower().strip()
                role_map = {
                    "finance": ["finance", "การเงิน"],
                    "discipline": ["discipline", "ปกครอง"],
                    "dept_head": ["dept_head", "dept head", "หัวหน้าหมวด", "หัวหน้า"],
                }
                for r_key, r_aliases in role_map.items():
                    if any(a in role_lower for a in r_aliases):
                        teacher["admin_role"] = r_key
                        break

    # ── Sheet 3: Fixed_Slots (optional) ──────────────────────────────────
    fixed_slots: list[dict] = []
    ws_fixed = _find_sheet(wb, _SHEET_ALIASES["fixed_slots"])
    if ws_fixed is not None:
        f_headers, f_rows = _parse_sheet(ws_fixed)
        f_mapping = auto_map_columns(f_headers)
        for field, labels in FIXED_SLOT_LABELS.items():
            best_score = 0.0
            best_header = None
            for header in f_headers:
                for label in labels:
                    score = _similarity(header, label)
                    if score > best_score:
                        best_score = score
                        best_header = header
            if best_score >= 0.7 and best_header:
                f_mapping[field] = best_header

        f_header_idx = {h: i for i, h in enumerate(f_headers)}
        fs_counter = 0

        for row in f_rows:
            def f_get_val(field):
                header = f_mapping.get(field)
                if not header or header not in f_header_idx:
                    return ""
                idx = f_header_idx[header]
                val = row[idx] if idx < len(row) else None
                return str(val).strip() if val is not None else ""

            name = f_get_val("name") or f_get_val("slot_type") or "Fixed Activity"
            day_str = f_get_val("day")
            period_str = f_get_val("period")
            class_ids_raw = f_get_val("class_ids")
            slot_type_raw = f_get_val("slot_type")

            try:
                day = int(re.search(r"\d+", day_str).group()) if day_str else 1
            except (AttributeError, ValueError):
                day = 1
            try:
                period = int(re.search(r"\d+", period_str).group()) if period_str else 1
            except (AttributeError, ValueError):
                period = 1

            slot_type = "activity"
            if slot_type_raw:
                st_lower = slot_type_raw.lower().strip()
                type_map = {
                    "assembly": ["assembly", "ชุมนุม"],
                    "activity": ["activity", "กิจกรรม"],
                    "homeroom": ["homeroom", "โฮมรูม"],
                    "scout": ["scout", "ลูกเสือ"],
                    "club": ["club", "ชมรม"],
                }
                for t_key, t_aliases in type_map.items():
                    if any(a in st_lower for a in t_aliases):
                        slot_type = t_key
                        break

            class_ids = _parse_class_ids(class_ids_raw, classes_map)

            fs_counter += 1
            fixed_slots.append({
                "id": f"FS{fs_counter}",
                "name": name,
                "slot_type": slot_type,
                "day": day,
                "period": period,
                "class_ids": class_ids,
            })

    # Build rooms from classes
    rooms = [
        {"id": f"R_{c['id']}", "name": f"ห้อง {c['name']}", "room_type": "classroom"}
        for c in classes_map.values()
    ]

    return {
        "teachers": list(teachers_map.values()),
        "subjects": list(subjects_map.values()),
        "classes": list(classes_map.values()),
        "rooms": rooms,
        "lesson_blocks": lesson_blocks,
        "fixed_slots": fixed_slots,
        "summary": {
            "teachers": len(teachers_map),
            "subjects": len(subjects_map),
            "classes": len(classes_map),
            "lesson_blocks": len(lesson_blocks),
            "fixed_slots": len(fixed_slots),
        },
    }


# ── Minimum Template: Generation & Import ───────────────────────────────────

MIN_TEMPLATE_HEADERS = ["ชื่อครู", "วิชา", "ห้องเรียน", "คาบ/สัปดาห์", "คาบคู่ (ใช่/ไม่ใช่)"]

MIN_TEMPLATE_EXAMPLES = [
    ["อ.สมชาย ใจดี", "คณิตศาสตร์", "ป.1/1", "5", "ไม่ใช่"],
    ["อ.สมหญิง รักเรียน", "ภาษาไทย", "ป.1/1", "5", "ไม่ใช่"],
    ["อ.วิชัย สอนเก่ง", "วิทยาศาสตร์", "ป.1/2", "4", "ใช่"],
]


def generate_minimum_template() -> bytes:
    """Generate a minimum-data Excel template (1 sheet flat table) as bytes."""
    if Workbook is None:
        raise RuntimeError("openpyxl not installed. Run: pip install openpyxl")

    wb = Workbook()
    ws = wb.active
    ws.title = "Course_Mapping"

    # Write headers
    ws.append(MIN_TEMPLATE_HEADERS)

    # Write example rows
    for row in MIN_TEMPLATE_EXAMPLES:
        ws.append(row)

    # Auto-size columns
    for col_idx, header in enumerate(MIN_TEMPLATE_HEADERS, 1):
        max_len = len(header)
        for ex_row in MIN_TEMPLATE_EXAMPLES:
            if col_idx - 1 < len(ex_row):
                max_len = max(max_len, len(str(ex_row[col_idx - 1])))
        ws.column_dimensions[chr(64 + col_idx)].width = max_len + 4

    buf = io.BytesIO()
    wb.save(buf)
    buf.seek(0)
    return buf.read()


def _extract_grade_level(class_name: str) -> int:
    """Extract grade level from Thai class name. e.g. 'ป.1/1' -> 1, 'ม.2/3' -> 8, 'อ.1/1' -> -2."""
    m = re.match(r"[ปมอ]\.?\s*(\d+)", class_name)
    if not m:
        return 7  # default
    base = int(m.group(1))
    if class_name.startswith("อ"):
        return base - 3  # อ.1 -> -2, อ.2 -> -1, อ.3 -> 0
    if class_name.startswith("ป"):
        return base  # ป.1 -> 1 ... ป.6 -> 6
    if class_name.startswith("ม"):
        return base + 6  # ม.1 -> 7 ... ม.6 -> 12
    return 7


def import_minimum_template(file_bytes: bytes) -> dict[str, Any]:
    """Import a minimum-data Excel template (1 sheet flat table).

    Columns: ชื่อครู, วิชา, ห้องเรียน, คาบ/สัปดาห์, คาบคู่ (ใช่/ไม่ใช่)

    Graceful handling: rows with empty วิชา or ห้องเรียน still import the teacher.
    """
    if load_workbook is None:
        raise RuntimeError("openpyxl not installed. Run: pip install openpyxl")

    wb = load_workbook(io.BytesIO(file_bytes), data_only=True)
    ws = wb.active

    rows = list(ws.iter_rows(values_only=True))
    if not rows:
        return {"teachers": [], "subjects": [], "classes": [], "rooms": [], "lesson_blocks": [], "summary": {}}

    headers = [str(c).strip() if c is not None else "" for c in rows[0]]
    header_idx = {h: i for i, h in enumerate(headers)}

    # Find columns by matching against known labels
    teacher_col = _find_header_idx(header_idx, KNOWN_LABELS["teacher_name"])
    subject_col = _find_header_idx(header_idx, KNOWN_LABELS["subject"])
    class_col = _find_header_idx(header_idx, KNOWN_LABELS["class_name"])
    ppw_col = _find_header_idx(header_idx, KNOWN_LABELS["periods_per_week"])
    double_col = _find_header_idx(header_idx, KNOWN_LABELS["is_double"])

    teachers_map: dict[str, dict] = {}
    subjects_map: dict[str, dict] = {}
    classes_map: dict[str, dict] = {}
    lesson_blocks: list[dict] = []
    lb_counter = 0
    teacher_only_count = 0

    for row in rows[1:]:
        if all(c is None or str(c).strip() == "" for c in row):
            continue

        def get_val(col):
            if col is None or col >= len(row):
                return ""
            val = row[col]
            return str(val).strip() if val is not None else ""

        teacher_name = get_val(teacher_col)
        subject_name = get_val(subject_col)
        class_name = get_val(class_col)
        ppw_str = get_val(ppw_col)
        is_double_str = get_val(double_col)

        if not teacher_name:
            continue

        # Always dedup teacher
        if teacher_name not in teachers_map:
            tid = f"T{len(teachers_map) + 1}"
            teachers_map[teacher_name] = {
                "id": tid,
                "name": teacher_name,
                "max_periods_per_week": 22,
                "min_periods_per_week": 0,
                "unavailable_slots": [],
                "admin_role": "none",
            }

        # Skip lesson_block creation if subject or class is empty
        if not subject_name or not class_name:
            teacher_only_count += 1
            continue

        if subject_name not in subjects_map:
            sid = f"S{len(subjects_map) + 1}"
            subjects_map[subject_name] = {"id": sid, "name": subject_name, "category": "core", "is_heavy": False}

        if class_name not in classes_map:
            cid = f"C{len(classes_map) + 1}"
            grade = _extract_grade_level(class_name)
            classes_map[class_name] = {"id": cid, "name": class_name, "grade_level": grade}

        try:
            ppw = int(re.search(r"\d+", ppw_str).group()) if ppw_str else 1
        except (AttributeError, ValueError):
            ppw = 1

        is_double = is_double_str.lower() in ("true", "1", "yes", "คู่", "double", "x", "ใช่")

        lb_counter += 1
        class_id = classes_map[class_name]["id"]
        lesson_blocks.append({
            "id": f"LB{lb_counter}",
            "subject_id": subjects_map[subject_name]["id"],
            "teacher_id": teachers_map[teacher_name]["id"],
            "class_id": class_id,
            "room_id": f"R_{class_id}",
            "periods_per_week": ppw,
            "is_double_period": is_double,
            "is_fixed": False,
            "fixed_day": None,
            "fixed_period": None,
        })

    rooms = [
        {"id": f"R_{c['id']}", "name": f"ห้อง {c['name']}", "room_type": "classroom"}
        for c in classes_map.values()
    ]

    return {
        "teachers": list(teachers_map.values()),
        "subjects": list(subjects_map.values()),
        "classes": list(classes_map.values()),
        "rooms": rooms,
        "lesson_blocks": lesson_blocks,
        "summary": {
            "teachers": len(teachers_map),
            "subjects": len(subjects_map),
            "classes": len(classes_map),
            "lesson_blocks": len(lesson_blocks),
            "teacher_only": teacher_only_count,
        },
    }


def _find_header_idx(header_idx: dict[str, int], labels: list[str]) -> int | None:
    """Find the column index matching any of the known labels."""
    norm_idx = {_normalize(h): i for h, i in header_idx.items()}
    for label in labels:
        nl = _normalize(label)
        if nl in norm_idx:
            return norm_idx[nl]
    # Fuzzy match
    best_score = 0.0
    best_idx = None
    for h, i in header_idx.items():
        for label in labels:
            score = _similarity(h, label)
            if score > best_score:
                best_score = score
                best_idx = i
    if best_score >= 0.7:
        return best_idx
    return None


# ── Full Multi-Sheet Template Generation ─────────────────────────────────────

FULL_COURSE_HEADERS = ["ชื่อครู", "วิชา", "ห้องเรียน", "คาบ/สัปดาห์", "คาบคู่ (ใช่/ไม่ใช่)"]
FULL_COURSE_EXAMPLES = [
    ["อ.สมชาย ใจดี", "คณิตศาสตร์", "ป.1/1", "5", "ไม่ใช่"],
    ["อ.สมหญิง รักเรียน", "ภาษาไทย", "ป.1/1", "5", "ไม่ใช่"],
    ["อ.วิชัย สอนเก่ง", "วิทยาศาสตร์", "ป.1/2", "4", "ใช่"],
    ["อ.สมชาย ใจดี", "คณิตศาสตร์", "ป.1/2", "5", "ไม่ใช่"],
]

FULL_CONSTRAINT_HEADERS = ["ชื่อครู", "ภาระงานสูงสุด", "ภาระงานขั้นต่ำ", "ห้ามสอน", "บทบาทพิเศษ"]
FULL_CONSTRAINT_EXAMPLES = [
    ["อ.สมชาย ใจดี", "22", "0", "1-7, 2-7", ""],
    ["อ.สมหญิง รักเรียน", "20", "0", "", "การเงิน"],
]

FULL_FIXED_HEADERS = ["ชื่อกิจกรรม", "วัน", "คาบที่", "ห้องที่เกี่ยวข้อง", "ประเภท"]
FULL_FIXED_EXAMPLES = [
    ["เคารพธงชาติ", "1", "1", "", "assembly"],
    ["ลูกเสือ-เนตรนารี", "3", "6", "ป.1, ป.2, ป.3", "scout"],
]


def generate_full_template() -> bytes:
    """Generate a full multi-sheet Excel template as bytes.

    Sheets:
      - Course_Mapping: teacher/subject/class/lesson assignments
      - Teacher_Constraints: unavailable slots, max/min periods, admin role
      - Fixed_Slots: fixed activity slots
    """
    if Workbook is None:
        raise RuntimeError("openpyxl not installed. Run: pip install openpyxl")

    wb = Workbook()

    # Sheet 1: Course_Mapping
    ws1 = wb.active
    ws1.title = "Course_Mapping"
    ws1.append(FULL_COURSE_HEADERS)
    for row in FULL_COURSE_EXAMPLES:
        ws1.append(row)
    _auto_size(ws1, FULL_COURSE_HEADERS, FULL_COURSE_EXAMPLES)

    # Sheet 2: Teacher_Constraints
    ws2 = wb.create_sheet("Teacher_Constraints")
    ws2.append(FULL_CONSTRAINT_HEADERS)
    for row in FULL_CONSTRAINT_EXAMPLES:
        ws2.append(row)
    _auto_size(ws2, FULL_CONSTRAINT_HEADERS, FULL_CONSTRAINT_EXAMPLES)

    # Sheet 3: Fixed_Slots
    ws3 = wb.create_sheet("Fixed_Slots")
    ws3.append(FULL_FIXED_HEADERS)
    for row in FULL_FIXED_EXAMPLES:
        ws3.append(row)
    _auto_size(ws3, FULL_FIXED_HEADERS, FULL_FIXED_EXAMPLES)

    buf = io.BytesIO()
    wb.save(buf)
    buf.seek(0)
    return buf.read()


def _auto_size(ws, headers, examples):
    """Auto-size columns in a worksheet based on headers and example data."""
    for col_idx, header in enumerate(headers, 1):
        max_len = len(header)
        for ex_row in examples:
            if col_idx - 1 < len(ex_row):
                max_len = max(max_len, len(str(ex_row[col_idx - 1])))
        ws.column_dimensions[chr(64 + col_idx)].width = max_len + 4
