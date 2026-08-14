"""
Generate Primary School Mock Data (Excel & JSON) for Timetable Constraint Solver Test.

School: โรงเรียนประถมศึกษาอนุบาลมิตรภาพ (สพฐ. ขนาดกลาง-ใหญ่)
- 12 classrooms (ป.1/1 – ป.6/2)
- 25 teachers
- 10 subjects + 3 fixed activities
- 3 special facilities (COMPUTER_LAB, SCIENCE_LAB, GYM_FIELD)

Outputs:
  1. school_primary_mock.json  — for FastAPI/OR-Tools
  2. mock_primary_school.xlsx  — 3 tabs (Course_Mapping, Teacher_Constraints, Fixed_Slots)
"""
from __future__ import annotations

import json
from pathlib import Path

import pandas as pd
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter

# ── Constants ───────────────────────────────────────────────────────────────

DAYS = 5          # Mon–Fri
PERIODS = 7       # 6 teaching + 1 lunch (period 4)
LUNCH_PERIOD = 4
TEACHING_PERIODS = [1, 2, 3, 5, 6, 7]  # skip period 4 (lunch)

OUTPUT_DIR = Path(__file__).parent
FIXTURES_DIR = OUTPUT_DIR / "fixtures"

# ── Subjects ────────────────────────────────────────────────────────────────

SUBJECTS = [
    {"id": "MA", "name": "คณิตศาสตร์",            "category": "core",  "is_heavy": True},
    {"id": "TH", "name": "ภาษาไทย",               "category": "core",  "is_heavy": True},
    {"id": "SC", "name": "วิทยาศาสตร์และเทคโนโลยี", "category": "lab",   "is_heavy": False},
    {"id": "EN", "name": "ภาษาอังกฤษ",             "category": "core",  "is_heavy": False},
    {"id": "SO", "name": "สังคมศึกษา",             "category": "core",  "is_heavy": False},
    {"id": "HI", "name": "ประวัติศาสตร์",           "category": "core",  "is_heavy": False},
    {"id": "PE", "name": "สุขศึกษาและพลศึกษา",     "category": "pe",    "is_heavy": False},
    {"id": "AR", "name": "ศิลปะ ดนตรี นาฏศิลป์",    "category": "art",   "is_heavy": False},
    {"id": "WE", "name": "การงานอาชีพ",             "category": "art",   "is_heavy": False},
    {"id": "EN_CO", "name": "ภาษาอังกฤษ (Co-Teaching)", "category": "core", "is_heavy": False},
    {"id": "ICT", "name": "คอมพิวเตอร์",            "category": "lab",   "is_heavy": False},
]

SUBJECT_PERIODS = {
    "MA": 5, "TH": 5, "SC": 2, "EN": 3, "EN_CO": 1,
    "SO": 2, "HI": 1, "PE": 2, "AR": 2, "WE": 1, "ICT": 1,
}

SUBJECT_DOUBLE = {"SC": True, "AR": True, "ICT": False}  # subjects with double periods

SUBJECT_FACILITY = {
    "SC": "SCIENCE_LAB",   # SC uses lab for the double period
    "PE": "GYM_FIELD",
    "ICT": "COMPUTER_LAB",
}

# ── Classes ─────────────────────────────────────────────────────────────────

CLASSES = []
for grade in range(1, 7):
    for sec in [1, 2]:
        cid = f"P{grade}{sec}"
        name = f"ป.{grade}/{sec}"
        CLASSES.append({"id": cid, "name": name, "grade_level": grade})

# ── Rooms ───────────────────────────────────────────────────────────────────

ROOMS = []
for c in CLASSES:
    ROOMS.append({"id": f"R_{c['id']}", "name": f"ห้อง {c['name']}", "room_type": "classroom"})
ROOMS.append({"id": "COMPUTER_LAB", "name": "ห้องคอมพิวเตอร์", "room_type": "computer_lab"})
ROOMS.append({"id": "SCIENCE_LAB",  "name": "ห้องปฏิบัติการวิทย์", "room_type": "science_lab"})
ROOMS.append({"id": "GYM_FIELD",    "name": "สนามพละ", "room_type": "gym"})

CLASS_ROOM_MAP = {c["id"]: f"R_{c['id']}" for c in CLASSES}

# ── Teachers ────────────────────────────────────────────────────────────────

TEACHER_NAMES = {
    "T01": "ครูสมหญิง", "T02": "ครูมานี", "T03": "ครูประยูร", "T04": "ครูวิภา",
    "T05": "ครูสมชาย", "T06": "ครูมาลี",
    "T07": "ครูนิดา", "T08": "ครูอนุชา", "T09": "ครูพิศมัย", "T10": "ครูจันทรา",
    "T11": "ครูสมศักดิ์", "T12": "ครูอำนาจ", "T13": "ครูนพดล",
    "T14": "ครูเจมส์ (Native)", "T15": "ครูแอน (English)", "T16": "ครูหยุน (Chinese)",
    "T17": "ครูกิตติ (PE)", "T18": "ครูสมพร (PE)",
    "T19": "ครูนภา (Art)", "T20": "ครูเกษม (Music)", "T21": "ครูรุ่งนภา (Work)",
    "T22": "ครูอนันต์ (ICT)", "T23": "ครูศรีสุดา (ICT)",
    "T24": "ครูประเสริฐ (Finance)",
    "T25": "ครูบุญรอด (Discipline)",
}

# Teacher assignments: which teacher teaches which subject to which class(es)
# Format: (teacher_id, subject_id, [class_ids], periods_override)

# T01-T06: ประจำชั้น ป.1-ป.3 (สอน ไทย+คณิต+สังคม ในห้องประจำชั้น)
HOMEROOM_ASSIGNMENTS = [
    # T01: ป.1/1
    ("T01", "TH", ["P11"], 5),
    ("T01", "MA", ["P11"], 5),
    ("T01", "SO", ["P11"], 2),
    ("T01", "HI", ["P11"], 1),
    # T02: ป.1/2
    ("T02", "TH", ["P12"], 5),
    ("T02", "MA", ["P12"], 5),
    ("T02", "SO", ["P12"], 2),
    ("T02", "HI", ["P12"], 1),
    # T03: ป.2/1
    ("T03", "TH", ["P21"], 5),
    ("T03", "MA", ["P21"], 5),
    ("T03", "SO", ["P21"], 2),
    ("T03", "HI", ["P21"], 1),
    # T04: ป.2/2
    ("T04", "TH", ["P22"], 5),
    ("T04", "MA", ["P22"], 5),
    ("T04", "SO", ["P22"], 2),
    ("T04", "HI", ["P22"], 1),
    # T05: ป.3/1
    ("T05", "TH", ["P31"], 5),
    ("T05", "MA", ["P31"], 5),
    ("T05", "SO", ["P31"], 2),
    ("T05", "HI", ["P31"], 1),
    # T06: ป.3/2
    ("T06", "TH", ["P32"], 5),
    ("T06", "MA", ["P32"], 5),
    ("T06", "SO", ["P32"], 2),
    ("T06", "HI", ["P32"], 1),
]

# T07-T10: คณิต-วิทย์ ป.4-ป.6 (เดินสอน 3-4 ห้อง)
MATH_SCI_ASSIGNMENTS = [
    # T07: ป.4/1 + ป.4/2
    ("T07", "MA", ["P41", "P42"], 5),
    ("T07", "SC", ["P41", "P42"], 2),
    # T08: ป.5/1 + ป.5/2
    ("T08", "MA", ["P51", "P52"], 5),
    ("T08", "SC", ["P51", "P52"], 2),
    # T09: ป.6/1 + ป.6/2
    ("T09", "MA", ["P61", "P62"], 5),
    ("T09", "SC", ["P61", "P62"], 2),
]

# T11-T13: ไทย-สังคม ป.4-ป.6
THAI_SOC_ASSIGNMENTS = [
    # T11: ป.4
    ("T11", "TH", ["P41", "P42"], 5),
    ("T11", "SO", ["P41", "P42"], 2),
    ("T11", "HI", ["P41", "P42"], 1),
    # T12: ป.5
    ("T12", "TH", ["P51", "P52"], 5),
    ("T12", "SO", ["P51", "P52"], 2),
    ("T12", "HI", ["P51", "P52"], 1),
    # T13: ป.6
    ("T13", "TH", ["P61", "P62"], 5),
    ("T13", "SO", ["P61", "P62"], 2),
    ("T13", "HI", ["P61", "P62"], 1),
]

# T14-T16: ภาษาต่างประเทศ
ENGLISH_ASSIGNMENTS = [
    # T15: English ป.1-ป.3 + ป.4
    ("T15", "EN", ["P11", "P12", "P21", "P22", "P31", "P32"], 3),
    # T14: English ป.5-ป.6 (native speaker)
    ("T14", "EN", ["P51", "P52", "P61", "P62"], 3),
    # T16: English ป.4 (Chinese teacher also covers some English)
    ("T16", "EN", ["P41", "P42"], 3),
    # Co-Teaching: T14 (native) + T15 (Thai) — 1 period/week per class ป.4-ป.6
    ("T14", "EN_CO", ["P41", "P42", "P51", "P52", "P61", "P62"], 1),
]

# T17-T18: PE (all 12 classes, 2 periods each)
PE_ASSIGNMENTS = [
    ("T17", "PE", ["P11", "P12", "P21", "P22", "P31", "P32"], 2),
    ("T18", "PE", ["P41", "P42", "P51", "P52", "P61", "P62"], 2),
]

# T19-T21: Art/Music/Work
ART_ASSIGNMENTS = [
    ("T19", "AR", ["P11", "P12", "P21", "P22", "P31", "P32"], 2),
    ("T20", "AR", ["P41", "P42", "P51", "P52", "P61", "P62"], 2),
    ("T21", "WE", ["P11", "P12", "P21", "P22", "P31", "P32", "P41", "P42", "P51", "P52", "P61", "P62"], 1),
]

# T22-T23: ICT (uses COMPUTER_LAB)
ICT_ASSIGNMENTS = [
    ("T22", "ICT", ["P11", "P12", "P21", "P22", "P31", "P32"], 1),  # ICT for lower grades
    ("T23", "ICT", ["P41", "P42", "P51", "P52", "P61", "P62"], 1),  # ICT for upper grades
]

# T24: Finance — also teaches some WE
# T25: Discipline — also teaches some SO

ALL_ASSIGNMENTS = (
    HOMEROOM_ASSIGNMENTS
    + MATH_SCI_ASSIGNMENTS
    + THAI_SOC_ASSIGNMENTS
    + ENGLISH_ASSIGNMENTS
    + PE_ASSIGNMENTS
    + ART_ASSIGNMENTS
    + ICT_ASSIGNMENTS
)

# ── Teacher constraints ─────────────────────────────────────────────────────

def build_teachers() -> list[dict]:
    teachers = []
    for tid, tname in TEACHER_NAMES.items():
        t = {
            "id": tid,
            "name": tname,
            "max_periods_per_week": 22,
            "min_periods_per_week": 0,
            "unavailable_slots": [],
            "admin_role": "none",
            "admin_free_slots": [],
        }

        # T24: Finance — unavailable Thu P5-P6, Fri P5-P6
        if tid == "T24":
            t["admin_role"] = "finance"
            t["unavailable_slots"] = ["4-5", "4-6", "5-5", "5-6"]
            t["admin_free_slots"] = ["4-5", "4-6", "5-5", "5-6"]
            t["max_periods_per_week"] = 18  # reduced for admin duties

        # T25: Discipline — unavailable P1 + P6 every day
        if tid == "T25":
            t["admin_role"] = "discipline"
            unavail = []
            for d in range(1, 6):
                unavail.append(f"{d}-1")
                unavail.append(f"{d}-6")
            t["unavailable_slots"] = unavail
            t["admin_free_slots"] = unavail
            t["max_periods_per_week"] = 16

        teachers.append(t)
    return teachers


# ── Lesson blocks ───────────────────────────────────────────────────────────

def build_lesson_blocks() -> list[dict]:
    blocks = []
    counter = 0
    for tid, subj_id, class_ids, ppw in ALL_ASSIGNMENTS:
        is_double = SUBJECT_DOUBLE.get(subj_id, False)
        facility = SUBJECT_FACILITY.get(subj_id)
        for cid in class_ids:
            counter += 1
            room_id = facility if facility else CLASS_ROOM_MAP[cid]
            blocks.append({
                "id": f"LB{counter:03d}",
                "subject_id": subj_id,
                "teacher_id": tid,
                "class_id": cid,
                "room_id": room_id,
                "periods_per_week": ppw,
                "is_double_period": is_double,
                "is_fixed": False,
                "fixed_day": None,
                "fixed_period": None,
            })
    return blocks


# ── Fixed slots ─────────────────────────────────────────────────────────────

FIXED_SLOTS = [
    {"id": "FS1", "name": "โฮมรูม",       "slot_type": "homeroom", "day": 1, "period": 1, "class_ids": []},
    {"id": "FS2", "name": "ลูกเสือ-เนตรนารี", "slot_type": "scout",    "day": 3, "period": 6, "class_ids": []},
    {"id": "FS3", "name": "ชุมนุม",       "slot_type": "club",     "day": 5, "period": 6, "class_ids": []},
]


# ── Schedule config ─────────────────────────────────────────────────────────

SCHEDULE_CONFIG = {
    "days_per_week": 5,
    "periods_per_day": 7,
    "lunch_periods": [4],
    "assembly_slots": ["1-1"],
    "max_consecutive_teaching": 4,
    "pe_hot_periods": [],
}


# ── JSON output ─────────────────────────────────────────────────────────────

def generate_json(output_path: Path):
    data = {
        "teachers": build_teachers(),
        "rooms": ROOMS,
        "subjects": SUBJECTS,
        "classes": CLASSES,
        "lesson_blocks": build_lesson_blocks(),
        "fixed_slots": FIXED_SLOTS,
        "schedule_config": SCHEDULE_CONFIG,
        "solver_time_limit_seconds": 5.0,
    }
    output_path.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")
    return data


# ── Excel output ────────────────────────────────────────────────────────────

def generate_excel(data: dict, output_path: Path):
    teachers = data["teachers"]
    blocks = data["lesson_blocks"]
    subjects_map = {s["id"]: s for s in data["subjects"]}
    classes_map = {c["id"]: c for c in data["classes"]}
    rooms_map = {r["id"]: r for r in data["rooms"]}
    teachers_map = {t["id"]: t for t in teachers}

    # Tab 1: Course_Mapping
    course_rows = []
    for lb in blocks:
        subj = subjects_map.get(lb["subject_id"], {})
        teacher = teachers_map.get(lb["teacher_id"], {})
        cls = classes_map.get(lb["class_id"], {})
        room = rooms_map.get(lb["room_id"], {})
        special_note = ""
        if lb["is_double_period"]:
            special_note = "คาบคู่"
        if room.get("room_type") not in ("classroom", None):
            special_note += f" ใช้{room.get('name', '')}"
        if lb["subject_id"] == "EN_CO":
            special_note = "Co-Teaching (ครูไทย+ครูต่างชาติ)"
        course_rows.append({
            "Teacher_ID": lb["teacher_id"],
            "Teacher_Name": teacher.get("name", ""),
            "Subject_Code": lb["subject_id"],
            "Subject_Name": subj.get("name", ""),
            "Classroom": cls.get("name", ""),
            "Periods_Per_Week": lb["periods_per_week"],
            "Is_Double_Period": "Yes" if lb["is_double_period"] else "No",
            "Required_Facility": rooms_map.get(lb["room_id"], {}).get("name", "") if lb["room_id"] and lb["room_id"] not in CLASS_ROOM_MAP.values() else "",
            "Special_Note": special_note,
        })
    df_course = pd.DataFrame(course_rows)

    # Tab 2: Teacher_Constraints
    constraint_rows = []
    for t in teachers:
        unavail = t.get("unavailable_slots", [])
        unavail_notes = []
        day_names = {1: "จ", 2: "อ", 3: "พ", 4: "พฤ", 5: "ศ"}
        for slot in unavail:
            parts = slot.split("-")
            if len(parts) == 2:
                unavail_notes.append(f"{day_names.get(int(parts[0]), parts[0])}.คาบ{parts[1]}")
        max_per_day = 6 if t["admin_role"] == "none" else 4
        constraint_rows.append({
            "Teacher_ID": t["id"],
            "Teacher_Name": t["name"],
            "Max_Periods_Per_Day": max_per_day,
            "Max_Periods_Per_Week": t["max_periods_per_week"],
            "Admin_Role": t["admin_role"],
            "Unavailable_Slots_Note": ", ".join(unavail_notes) if unavail_notes else "—",
        })
    df_constraints = pd.DataFrame(constraint_rows)

    # Tab 3: Fixed_Slots
    fixed_rows = []
    day_names_full = {1: "จันทร์", 2: "อังคาร", 3: "พุธ", 4: "พฤหัสบดี", 5: "ศุกร์"}
    for fs in FIXED_SLOTS:
        fixed_rows.append({
            "Activity_Name": fs["name"],
            "Slot_Type": fs["slot_type"],
            "Classroom": "ทุกห้อง" if not fs["class_ids"] else ", ".join(fs["class_ids"]),
            "Day": day_names_full.get(fs["day"], str(fs["day"])),
            "Period": fs["period"],
        })
    df_fixed = pd.DataFrame(fixed_rows)

    # Write Excel with formatting
    with pd.ExcelWriter(output_path, engine="openpyxl") as writer:
        df_course.to_excel(writer, sheet_name="Course_Mapping", index=False)
        df_constraints.to_excel(writer, sheet_name="Teacher_Constraints", index=False)
        df_fixed.to_excel(writer, sheet_name="Fixed_Slots", index=False)

        wb = writer.book
        header_fill = PatternFill(start_color="B4D6F0", end_color="B4D6F0", fill_type="solid")
        header_font = Font(bold=True, size=11)
        thin_border = Border(
            left=Side(style="thin"), right=Side(style="thin"),
            top=Side(style="thin"), bottom=Side(style="thin"),
        )
        center_align = Alignment(horizontal="center", vertical="center")

        for sheet_name in ["Course_Mapping", "Teacher_Constraints", "Fixed_Slots"]:
            ws = wb[sheet_name]
            # Header styling
            for cell in ws[1]:
                cell.fill = header_fill
                cell.font = header_font
                cell.border = thin_border
                cell.alignment = center_align
            # Auto-fit column widths
            for col in ws.columns:
                max_len = 0
                col_letter = get_column_letter(col[0].column)
                for cell in col:
                    try:
                        cell_len = len(str(cell.value))
                        if cell_len > max_len:
                            max_len = cell_len
                    except Exception:
                        pass
                ws.column_dimensions[col_letter].width = min(max_len + 4, 40)
            # Gridlines + freeze header
            ws.freeze_panes = "A2"
            ws.sheet_view.showGridLines = True


# ── Main ────────────────────────────────────────────────────────────────────

def main():
    FIXTURES_DIR.mkdir(parents=True, exist_ok=True)

    json_path = FIXTURES_DIR / "school_primary_mock.json"
    excel_path = OUTPUT_DIR / "mock_primary_school.xlsx"

    print("=" * 60)
    print("  Primary School Mock Data Generator")
    print("  โรงเรียนประถมศึกษาอนุบาลมิตรภาพ (สพฐ.)")
    print("=" * 60)

    # Generate JSON
    data = generate_json(json_path)
    print(f"\n✅ JSON: {json_path}")
    print(f"   Teachers:    {len(data['teachers'])}")
    print(f"   Rooms:       {len(data['rooms'])}")
    print(f"   Subjects:    {len(data['subjects'])}")
    print(f"   Classes:     {len(data['classes'])}")
    print(f"   Lesson Blocks: {len(data['lesson_blocks'])}")
    print(f"   Fixed Slots:   {len(data['fixed_slots'])}")

    total_periods = sum(lb["periods_per_week"] for lb in data["lesson_blocks"])
    print(f"   Total Periods: {total_periods} คาบ/สัปดาห์")

    # Per-teacher load summary
    teacher_loads = {}
    for lb in data["lesson_blocks"]:
        teacher_loads[lb["teacher_id"]] = teacher_loads.get(lb["teacher_id"], 0) + lb["periods_per_week"]
    print(f"\n   📊 Teacher Load Summary:")
    for tid in sorted(teacher_loads.keys()):
        load = teacher_loads[tid]
        max_w = next((t["max_periods_per_week"] for t in data["teachers"] if t["id"] == tid), 22)
        status = "✅" if load <= max_w else "⚠️ OVER"
        print(f"      {tid} ({TEACHER_NAMES[tid]:>20s}): {load:3d}/{max_w}  {status}")

    # Generate Excel
    generate_excel(data, excel_path)
    print(f"\n✅ Excel: {excel_path}")
    print(f"   Tabs: Course_Mapping ({len(data['lesson_blocks'])} rows), "
          f"Teacher_Constraints ({len(data['teachers'])} rows), "
          f"Fixed_Slots ({len(data['fixed_slots'])} rows)")

    print("\n" + "=" * 60)
    print("  Done! 🎉")
    print("=" * 60)


if __name__ == "__main__":
    main()
