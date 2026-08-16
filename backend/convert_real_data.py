"""Convert real school timetable into the multi-sheet template format (v3).

This version uses keyword-based classification: a cell value is a subject if it
contains an academic keyword, a fixed-slot activity if it matches a special
keyword, otherwise it is treated as a teacher name.
"""
from openpyxl import load_workbook, Workbook
from collections import defaultdict
import re

INPUT = '../ตารางเรียนชั้นประถมศึกษา 2569 (8).xlsx'
OUTPUT = '../output_template.xlsx'

DAY_NAMES = ['จันทร์', 'อังคาร', 'พุธ', 'พฤหัส', 'ศุกร์', 'เสาร์', 'อาทิตย์']
DAY_MAP = {name: i + 1 for i, name in enumerate(DAY_NAMES)}

PERIOD_COLS = [1, 2, 3, 5, 6, 7, 8]

SPECIAL_KEYWORDS = {
    'club': 'club',
    'ลูกเสือ': 'scout',
    'ซ่อมเสริม': 'activity',
    'อบรม': 'activity',
    'บูรณาการ': 'activity',
    'ส่งเสริม': 'activity',
    'พักรับประทานอาหารกลางวัน': 'lunch',
    'พักเที่ยง': 'lunch',
    'พักร้อน': 'lunch',
    'ลดเวลาเรียน': 'activity',
    'แนะแนว': 'activity',
}

SUBJECT_KEYWORDS = [
    r'Maths', r'Math', r'คณิต', r'คอม', r'Coding', r'Basic Coding',
    r'Science', r'วิทย์', r'วิทยาศาสตร์', r'วิทยาการคอม',
    r'English', r'อังกฤษ', r'Conversation', r'ภาษาอังกฤษ',
    r'ภาษาไทย',
    r'สังคม',
    r'ประวัติ', r'ประวัติศาสตร์',
    r'พละ', r'พลศึกษา', r'สุขศึกษา', r'สุขภาพ',
    r'ดนตรี', r'นาฏศิลป์', r'ศิลปะ',
    r'การงาน',
    r'Additional',
    r'additional',
    r'หน้าที่',
    r'ป้องกัน',
    r'ศักยภาพ',
    r'วิทยาการ',
    r'วิทย์/คณิต',
    r'อังกฤษสื่อสาร',
]

# Values that look like names but could be confused with subjects
KNOWN_TEACHERS = {
    'Dono', 'Lucas', 'Matthew', 'James', 'Elloit',
    'ลลิล', 'ธีรพล', 'ณัฏฐิวรรณ', 'ศักย์ศรณ์', 'สุรีรัตน์',
    'Dono ', 'Matthew ', 'Lucas ', 'James ', 'Elloit ',
    'ธีรชัย', 'จักรพงษ์', 'ณปภัช', 'พิพัฒน์', 'พิมพิศา',
    'วรินทร์ทิพย์', 'สุรชัย', 'สุทธิพงค์', 'สุริศร์', 'ใจสคราญ',
    'อนิวรรต', 'กฤษณะ', 'กฤษฎ์', 'อัจราวรรณ', 'อำพน', 'สมพร',
    'พิมพิวัลย์', 'ชวิศ', 'สหรัฐ',
}


def is_day_name(cell):
    if not cell:
        return None
    s = str(cell).strip()
    for d in DAY_NAMES:
        if d in s:
            return d
    return None


def is_uniform_or_note(cell):
    if not cell:
        return False
    s = str(cell).strip()
    return s.startswith('ชุด') or s.startswith('$') or s in ['ชุดนักเรียน', 'ชุดลูกเสือ', 'ชุดพละ', 'ชุดพื้นเมือง']


def clean_name(s):
    if not s:
        return ''
    s = re.sub(r'[\s()（）]+', ' ', str(s)).strip()
    s = re.sub(r'\s+', ' ', s)
    return s


def normalize_subject(s):
    s = clean_name(s)
    s = re.sub(r'\s*\+\s*', '+', s)
    if s.lower() == 'additional':
        return 'Additional'
    if s.lower() == 'basic coding':
        return 'Basic Coding'
    if 'ประวัติ' in s:
        return 'ประวัติศาสตร์'
    if re.match(r'หน้าที่', s):
        return 'หน้าที่พลเมือง+ป้องกันภัย'
    if s in ['คณิตศาสตร์']:
        return 'คณิตศาสตร์'
    if s in ['สังคม', 'สังคมศึกษา']:
        return 'สังคม'
    if s in ['พลศึกษา']:
        return 'พลศึกษา'
    if s in ['สุขศึกษา', 'สุขภาพ', 'สุขภาพฯ']:
        return 'สุขศึกษา'
    if s in ['วิทยาศาสตร์']:
        return 'วิทยาศาสตร์'
    if s in ['ภาษาอังกฤษ', 'English', 'อังกฤษสื่อสาร']:
        return 'ภาษาอังกฤษ'
    if s in ['วิทยาการคอม']:
        return 'วิทยาการคอมพิวเตอร์'
    return s


def is_special(v):
    v = clean_name(v).lower()
    for kw in SPECIAL_KEYWORDS:
        if kw in v:
            return SPECIAL_KEYWORDS[kw], v
    return None, None


def is_subject(v):
    v = clean_name(v)
    for pat in SUBJECT_KEYWORDS:
        if re.search(pat, v, re.I):
            return True
    # Has a math/science-like slash or plus — likely combined subject
    if '/' in v or ' + ' in v or '+' in v:
        return True
    return False


def is_teacher(v):
    v = clean_name(v)
    if not v:
        return False
    # Direct known teacher
    if v in KNOWN_TEACHERS or v in [clean_name(t) for t in KNOWN_TEACHERS]:
        return True
    # Not special and not subject → default to teacher
    if is_subject(v):
        return False
    if is_special(v)[0]:
        return False
    # Pure Thai personal name (2-20 chars, no obvious subject keyword)
    if re.match(r'^[ก-๙A-Za-z\s\.]+$', v) and 2 <= len(v) <= 25:
        return True
    return False


def extract_class_name(ws_name):
    m = re.match(r'ป\.(\d)(\d)', ws_name)
    if m:
        return f'ป.{m.group(1)}/{m.group(2)}'
    return ws_name


course_map = defaultdict(int)
fixed_slots = defaultdict(list)  # (name, slot_type) -> [(class, day, period)]
all_teachers = set()
all_subjects = set()
all_classes = set()

wb = load_workbook(INPUT, data_only=True)

for ws_name in wb.sheetnames:
    ws = wb[ws_name]
    class_name = extract_class_name(ws_name)
    all_classes.add(class_name)
    rows = list(ws.iter_rows(values_only=True))

    # Find day groups. A day group starts at a row with a day name in col 0
    # and includes all following rows until the next day name (or end).
    # Pre-day subject rows (rows above the day-name row but before prev day) are tricky;
    # we include the day-name row and all following non-day, non-uniform rows.
    day_groups = []
    i = 0
    while i < len(rows):
        row = rows[i]
        if not row:
            i += 1
            continue
        day = is_day_name(row[0])
        if not day:
            i += 1
            continue
        group = [row]
        i += 1
        while i < len(rows):
            r = rows[i]
            if not r:
                i += 1
                continue
            if is_day_name(r[0]):
                break
            if is_uniform_or_note(r[0]):
                i += 1
                continue
            group.append(r)
            i += 1
        day_groups.append((day, group))

    for day, group in day_groups:
        day_num = DAY_MAP.get(day)
        if not day_num:
            continue
        for pidx, col in enumerate(PERIOD_COLS):
            period = pidx + 1
            values = []
            for r in group:
                if col < len(r) and r[col]:
                    v = clean_name(r[col])
                    if v:
                        values.append(v)
            if not values:
                continue

            # First, detect special fixed-slot values
            special_values = []
            normal_values = []
            for v in values:
                st, _ = is_special(v)
                if st:
                    special_values.append((v, st))
                else:
                    normal_values.append(v)

            if special_values:
                # Record the first special value as a fixed slot
                name, st = special_values[0]
                fixed_slots[(name, st)].append((class_name, day_num, period))
                # Also process the rest if there is a subject/teacher
                values = normal_values

            if not values:
                continue

            # Classify remaining values
            teachers = [v for v in values if is_teacher(v)]
            subjects = [v for v in values if is_subject(v)]

            # If no subject but multiple values, use the last non-teacher as subject
            if not subjects:
                for v in values:
                    if not is_teacher(v):
                        subjects.append(v)
                        break

            # Pick primary teacher and subject
            teacher = teachers[0] if teachers else ''
            subject = subjects[0] if subjects else ''

            # If one value, decide carefully
            if len(values) == 1:
                v = values[0]
                if is_teacher(v):
                    teacher = v
                    subject = ''
                elif is_subject(v):
                    subject = v
                    teacher = ''
                else:
                    # Unknown token — cannot classify; skip
                    teacher = ''
                    subject = ''

            # Normalize
            teacher = teacher.strip()
            subject = normalize_subject(subject)

            # Store only if both are present
            if subject and teacher:
                all_subjects.add(subject)
                all_teachers.add(teacher)
                course_map[(class_name, subject, teacher)] += 1

# Build output workbook
out_wb = Workbook()

# Course_Mapping
ws_cm = out_wb.active
ws_cm.title = 'Course_Mapping'
ws_cm.append(['Teacher_ID', 'Teacher_Name', 'Subject_Code', 'Subject_Name', 'Classroom',
              'Periods_Per_Week', 'Is_Double_Period', 'Required_Facility', 'Lab_Periods', 'Special_Note'])

teacher_id_map = {name: f'T{i+1:02d}' for i, name in enumerate(sorted(all_teachers))}
subject_id_map = {name: f'S{i+1:02d}' for i, name in enumerate(sorted(all_subjects))}


def class_sort_key(c):
    m = re.match(r'ป\.(\d+)/(\d+)', c)
    if m:
        return (int(m.group(1)), int(m.group(2)))
    return (99, 99)


for (cls, subj, teacher), count in sorted(course_map.items(), key=lambda x: (class_sort_key(x[0][0]), x[0][1], x[0][2])):
    ws_cm.append([
        teacher_id_map.get(teacher, ''),
        teacher,
        subject_id_map.get(subj, ''),
        subj,
        cls,
        count,
        'No',
        '',
        0,
        ''
    ])

# Teacher_Constraints
ws_tc = out_wb.create_sheet('Teacher_Constraints')
ws_tc.append(['Teacher_ID', 'Teacher_Name', 'Max_Periods_Per_Day', 'Max_Periods_Per_Week', 'Admin_Role', 'Unavailable_Slots_Note'])
for t in sorted(all_teachers):
    ws_tc.append([teacher_id_map[t], t, 7, 35, 'none', ''])

# Fixed_Slots
ws_fs = out_wb.create_sheet('Fixed_Slots')
ws_fs.append(['Activity_Name', 'Slot_Type', 'Classroom', 'Day', 'Period'])
for (name, st), cps in sorted(fixed_slots.items()):
    for cls, day, period in sorted(cps, key=lambda x: (class_sort_key(x[0]), x[1], x[2])):
        ws_fs.append([name, st, cls, day, period])

# Special_Rooms (optional)
ws_sr = out_wb.create_sheet('Special_Rooms')
ws_sr.append(['Room_Name', 'Room_Type', 'Capacity', 'Notes'])
ws_sr.append(['ห้องคอมพิวเตอร์', 'computer', 40, 'ห้องคอม'])
ws_sr.append(['ห้องดนตรี', 'music', 30, 'ห้องดนตรี'])
ws_sr.append(['ห้องศิลปะ', 'art', 40, 'ห้องศิลปะ'])

out_wb.save(OUTPUT)
print(f'Output written to: {OUTPUT}')
print(f'Classes: {len(all_classes)}')
print(f'Teachers: {len(all_teachers)}')
print(f'Subjects: {len(all_subjects)}')
print(f'Course rows: {len(course_map)}')
print(f'Total periods: {sum(course_map.values())}')
print(f'Fixed slot rows: {sum(len(v) for v in fixed_slots.values())}')

print('\nTeachers:', sorted(all_teachers))
print('\nSubjects:', sorted(all_subjects))
