# SRO Timetable — แผนผังเว็บไซต์ & Flow การทำงาน

> ใช้สำหรับวางแผนออกแบบ flow การทำงานใหม่

---

## 🗺️ Sitemap (โครงสร้างหน้าปัจจุบัน)

```
SRO Timetable POC
│
├── 🏠 หน้าแรก (HomePage)          → activeView: 'home'
│   ├── Step 1: เลือกข้อมูลทดสอบ (FixtureSelector)
│   │   ├── small (5 ครู · 3 ห้อง)
│   │   ├── medium (15 ครู · 6 ห้อง)
│   │   ├── large (30 ครู · 12 ห้อง)
│   │   └── primary_mock (25 ครู · 12 ห้อง · ประถม สพฐ.)
│   ├── Step 2: สั่งจัดตาราง (GenerateButton → runSolver)
│   └── Step 3: ผลลัพธ์ (SolverMetrics)
│       ├── → ดูตารางสอน (setView: 'timetable')
│       └── → ดูภาระงานครู (setView: 'teachers')
│
├── ⚙️ ตั้งค่าตาราง (ScheduleConfigPage)  → activeView: 'schedules'
│   ├── สร้าง Template ใหม่ (CRUD via API)
│   ├── แก้ไข Template (ชื่อ, วัน/คาบ, พักเที่ยง, ระดับชั้น)
│   └── ลบ Template
│
├── 📤 นำเข้า Excel (ExcelImportPage)   → activeView: 'import'
│   ├── Step 1: อัพโหลดไฟล์ (.xlsx)
│   ├── Step 2: Map คอลัมน์ (auto-mapping + manual)
│   ├── Step 3: Preview ข้อมูล
│   └── Step 4: เสร็จ → ไป Course Offering / เงื่อนไขครู
│
├── 📚 Course Offering (CourseOfferingPage) → activeView: 'offering'
│   ├── สรุปจำนวน (ครู, Lesson Blocks, คาบรวม, ครูเกินเพดาน)
│   ├── ภาระงานครูก่อนจัด (progress bar)
│   ├── ตัวกรอง (ครู, ห้อง, วิชา)
│   ├── ตาราง Lesson Blocks (เพิ่ม/แก้ไข)
│   └── → นำเข้า Excel
│
├── 🛡️ เงื่อนไขครู (TeacherConstraintsPage) → activeView: 'constraints'
│   ├── สรุปจำนวน (ครูทั้งหมด, มีบทบาทพิเศษ, ช่องห้ามสอน)
│   ├── รายชื่อครู (เลือกเพื่อแก้ไข)
│   └── Editor Panel
│       ├── บทบาทพิเศษ (none, finance, discipline, dept_head)
│       ├── ภาระงานสูงสุด (max_periods_per_week)
│       └── กริดช่องห้ามสอน (5 วัน × 7 คาบ)
│
├── 📅 ตารางสอน (TimetableView)       → activeView: 'timetable' [ต้องมี result]
│   ├── SolverMetrics (status, time, variables, constraints)
│   ├── GridToolbar (กรองตามห้อง/ครู)
│   └── TimetableGrid
│       ├── กริดรายห้อง (วัน × คาบ)
│       ├── สีแยกตามวิชา (MA=น้ำเงิน, TH=ชมพู, SC=เขียวเข้ม, ...)
│       ├── Drag & Drop เพื่อสลับคาบ
│       ├── Conflict tooltip (H1: ครูซ้ำ, H2: ห้องซ้ำ)
│       └── GridLegend (แผนภาพสีวิชา)
│
└── 👨‍🏫 ภาระงานครู (TeacherLoadView)   → activeView: 'teachers' [ต้องมี result]
    ├── สรุป Before/After (เกินเพดาน, ว่างมาก)
    ├── ตารางเปรียบเทียบ (ก่อน, หลัง, Δ, Max, สถานะ)
    └── รายละเอียดภาระงานหลังจัด (progress bar)
```

---

## 🔄 Flow การทำงานปัจจุบัน (Current User Flow)

```
┌─────────────────────────────────────────────────────────────────┐
│                     เริ่มต้น (App mount)                          │
│  AppContext auto-load fixture 'small' → fixtureData             │
└──────────────────────────┬──────────────────────────────────────┘
                           │
                           ▼
              ┌────────────────────────┐
              │   🏠 หน้าแรก (HomePage)  │
              │                        │
              │  เลือก Fixture ──────────┼──→ small / medium / large / primary_mock
              │         │              │
              │  แสดง DataSummary       │
              │  (ครู, ห้อง, วิชา, LB)   │
              └────────────┬───────────┘
                           │
              ┌────────────▼───────────┐
              │  กด "จัดตาราง"          │
              │  (GenerateButton)      │
              └────────────┬───────────┘
                           │
                    ┌──────▼──────┐
                    │  runSolver  │
                    │             │
                    │ preset?     │
                    │ ├── YES → generateFromFile(file_path)
                    │ └── NO  → generateTimetable(POST body)
                    │             │
                    │  CP-SAT Solve│
                    │  (5-10s)    │
                    └──────┬──────┘
                           │
                    ┌──────▼──────┐
                    │  Result     │
                    │  slots[]    │
                    │  metrics    │
                    │  teacher_   │
                    │  loads[]    │
                    └──────┬──────┘
                           │
              ┌────────────▼───────────┐
              │  แสดง SolverMetrics     │
              │  + ปุ่มนำทาง            │
              └────┬───────────────┬───┘
                   │               │
          ┌────────▼──────┐  ┌────▼──────────────┐
          │ 📅 ตารางสอน   │  │ 👨‍🏫 ภาระงานครู     │
          │ TimetableView │  │ TeacherLoadView   │
          │               │  │                   │
          │ กริด + DnD    │  │ Before/After      │
          │ สีตามวิชา     │  │ ตารางเปรียบเทียบ  │
          └───────────────┘  └───────────────────┘
```

### Flow นำเข้า Excel (Alternative Path)

```
┌──────────────────────────┐
│ 🏠 หน้าแรก หรือ เมนู      │
└──────────┬───────────────┘
           │
┌──────────▼───────────────┐
│ 📤 นำเข้า Excel           │
│                          │
│ Step 1: เลือกไฟล์ .xlsx  │
│   → POST /detect         │
│   → ได้ headers + preview │
│                          │
│ Step 2: Map คอลัมน์      │
│   → auto_mapping (แก้ได้) │
│                          │
│ Step 3: กด "นำเข้า"      │
│   → POST /import         │
│   → ได้ teachers,        │
│     subjects, classes,   │
│     lesson_blocks        │
│                          │
│   → clearResult()        │
│   → setFixtureDataDirect │
│     (selectedFixture =   │
│      'custom')           │
│                          │
│ Step 4: เสร็จ            │
│   → ไป Course Offering   │
│   → หรือ เงื่อนไขครู      │
└──────────┬───────────────┘
           │
    ┌──────▼──────┐         ┌──────────────────┐
    │ 📚 Course   │         │ 🛡️ เงื่อนไขครู    │
    │ Offering    │         │                  │
    │             │         │ ตั้งค่า:          │
    │ ตรวจสอบ     │         │ - บทบาทพิเศษ    │
    │ ภาระงานครู  │         │ - ช่องห้ามสอน   │
    │ เพิ่ม/แก้ LB│         │ - max periods   │
    └──────┬──────┘         └────────┬─────────┘
           │                         │
           └────────────┬────────────┘
                        │
                   กลับไป หน้าแรก
                   กด "จัดตาราง"
                   (ใช้ข้อมูลจาก Excel)
```

---

## 🔗 State Management (AppContext)

```
AppContext State
├── selectedFixture: 'small' | 'medium' | 'large' | 'primary_mock' | 'custom'
├── fixtureData: { teachers, rooms, subjects, classes, lesson_blocks, fixed_slots, schedule_config }
├── result: { slots, teacher_loads, metrics } | null
├── activeView: 'home' | 'schedules' | 'import' | 'offering' | 'constraints' | 'timetable' | 'teachers'
├── gridFilter: { class: string|null, teacher: string|null }
├── isGenerating: boolean
├── error: string | null
├── cacheKey, lastSync (IndexedDB)
│
├── Actions
│   ├── selectFixture(id)     → fetch /fixtures/{id}.json → SET_FIXTURE_DATA
│   ├── runSolver()           → generateFromFile() หรือ generateTimetable()
│   ├── setView(view)         → SET_VIEW
│   ├── setGridFilter(filter) → SET_GRID_FILTER
│   ├── setFixtureDataDirect  → SET_FIXTURE_DATA_DIRECT (selectedFixture='custom')
│   └── clearResult()         → CLEAR_RESULT
```

---

## 📡 API Endpoints

```
Backend (FastAPI · port 8000)
│
├── GET  /health                          → { status, solver }
│
├── POST /generate/from-file?file_path=   → TimetableResponse
│       (preset fixtures)
│
├── POST /generate                        → TimetableResponse
│       (POST body = TimetableRequest JSON)
│
├── GET  /api/schedules                   → ScheduleTemplate[]
├── POST /api/schedules                   → ScheduleTemplate
├── PUT  /api/schedules/{id}              → ScheduleTemplate
├── DEL  /api/schedules/{id}              → { deleted: true }
│
├── POST /api/import/excel/detect         → { headers, rows, auto_mapping }
│       (FormData: file)
│
└── POST /api/import/excel/import         → { teachers, subjects, classes, lesson_blocks }
        (FormData: file + mapping JSON)
```

---

## ⚠️ ปัญหา Flow ปัจจุบัน & จุดที่ควรปรับปรุง

| # | ปัญหา | ผลกระทบ | ข้อเสนอแนะ |
|---|-------|---------|------------|
| 1 | **หน้าแรกคือหน้าเดียวที่สั่ง Generate** | ถ้าผู้ใช้แก้ Course Offering / เงื่อนไขครู แล้วต้องกลับไปหน้าแรกเพื่อกดจัด | เพิ่มปุ่ม "จัดตาราง" ในหน้า Offering/Constraints |
| 2 | **ไม่มี wizard/step-by-step flow** | ผู้ใช้ใหม่ไม่รู้ลำดับขั้นตอน | สร้าง Wizard: เลือกข้อมูล → ตั้งค่า → จัด → ดูผล |
| 3 | **ScheduleConfig แยกจาก fixtureData** | ตั้งค่าตารางในหน้า schedules ไม่เชื่อมกับ fixture ที่เลือก | เชื่อม schedule_config เข้ากับ fixture |
| 4 | **Course Offering แก้ไขไม่ได้จริง** | ปุ่ม "บันทึก" ใน modal ไม่ได้ update context | ผูก form กับ setFixtureDataDirect |
| 5 | **เงื่อนไขครู saveAll() แค่ alert** | ไม่ได้บันทึกลง context จริง | อัปเดต fixtureData.teachers ใน context |
| 6 | **ไม่มีสถานะ "ข้อมูลถูกแก้แล้ว"** | หลังแก้ Offering/Constraints ไม่รู้ว่าต้องจัดตารางใหม่ | เพิ่ม dirty flag + แจ้งเตือน |
| 7 | **Timetable/Teachers disabled ตอนไม่มี result** | ผู้ใช้ไม่รู้ว่าต้องทำอะไรก่อน | เปลี่ยนเป็น empty state พร้อม CTA |
| 8 | **Excel Import ไม่ดึง Teacher_Constraints/Fixed_Slots** | ข้อมูลเงื่อนไขครูและคาบตายตัวหายไป | อ่าน tab เพิ่มเติมจาก Excel |

---

## 💡 Flow ที่แนะนำ (Proposed New Flow)

```
┌─────────────────────────────────────────────────────┐
│                    Wizard Step 1                     │
│              เลือกแหล่งข้อมูล                         │
│                                                     │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  │
│  │ 📋 เลือก    │  │ 📤 นำเข้า   │  │ ✏️ สร้าง   │  │
│  │   Fixture  │  │   Excel     │  │   ใหม่      │  │
│  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘  │
└─────────┼────────────────┼────────────────┼────────┘
          │                │                │
          ▼                ▼                ▼
┌─────────────────────────────────────────────────────┐
│                    Wizard Step 2                     │
│              ตรวจสอบ & แก้ไขข้อมูล                   │
│                                                     │
│  ┌──────────────┐  ┌──────────────┐  ┌────────────┐ │
│  │ 📚 Course    │  │ 🛡️ เงื่อนไข  │  │ ⚙️ ตั้งค่า │ │
│  │  Offering    │  │    ครู       │  │   ตาราง   │ │
│  │              │  │              │  │            │ │
│  │ เพิ่ม/แก้ LB │  │ ห้ามสอน     │  │ วัน/คาบ   │ │
│  │ ตรวจภาระครู  │  │ บทบาท      │  │ พักเที่ยง  │ │
│  └──────┬───────┘  └──────┬───────┘  └─────┬──────┘ │
│         └────────────────┼─────────────────┘        │
│                          ▼                          │
│            ┌─────────────────────────┐              │
│            │  ปุ่ม "จัดตาราง" 🚀     │              │
│            │  (อยู่ในหน้าเดียวกัน)   │              │
│            └───────────┬─────────────┘              │
└────────────────────────┼────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────┐
│                    Wizard Step 3                     │
│              ผลลัพธ์ & ตารางสอน                      │
│                                                     │
│  ┌──────────┐  ┌──────────────┐  ┌───────────────┐  │
│  │ 📊 Metrics│  │ 📅 ตารางสอน │  │ 👨‍🏫 ภาระครู   │  │
│  │          │  │              │  │               │  │
│  │ Status   │  │ Grid + DnD  │  │ Before/After  │  │
│  │ Time     │  │ สีตามวิชา   │  │ ตารางเปรียบ   │  │
│  │ Violations│ │ Conflict    │  │ ภาระงาน       │  │
│  └──────────┘  └──────────────┘  └───────────────┘  │
│                                                     │
│  ┌─────────────────────────────────────────────┐    │
│  │  ปุ่ม: แก้ไขข้อมูล ←  |  ส่งออก →  |  จัดใหม่ │    │
│  └─────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────┘
```

---

## 📁 โครงสร้างไฟล์ Frontend ปัจจุบัน

```
frontend/src/
├── App.jsx                          # Router (activeView-based)
├── context/
│   └── AppContext.jsx               # Global state (reducer + actions)
├── api/
│   └── client.js                    # API calls (generate, schedules)
├── utils/
│   └── cache.js                     # IndexedDB cache
├── components/
│   ├── layout/
│   │   ├── Header.jsx               # Nav bar (7 items)
│   │   └── Layout.jsx               # Wrapper
│   ├── input/
│   │   ├── FixtureSelector.jsx      # 4 fixture cards
│   │   ├── DataSummary.jsx          # Stats summary
│   │   └── GenerateButton.jsx       # Trigger solver
│   ├── grid/
│   │   ├── TimetableGrid.jsx        # Main grid (DnD, conflict)
│   │   ├── GridCell.jsx             # Cell (สีตาม subject ID)
│   │   ├── GridToolbar.jsx          # Filter class/teacher
│   │   └── GridLegend.jsx           # สี 12 วิชา
│   ├── metrics/
│   │   └── SolverMetrics.jsx        # Status/time/variables
│   └── load/
│       ├── TeacherLoadTable.jsx     # Progress bars
│       └── LoadStatusBadge.jsx      # ok/over/under badge
└── pages/
    ├── HomePage.jsx                 # Step 1-3 (select → generate → result)
    ├── ScheduleConfigPage.jsx       # CRUD schedule templates
    ├── ExcelImportPage.jsx          # Upload → map → import
    ├── CourseOfferingPage.jsx       # Lesson blocks table + load
    ├── TeacherConstraintsPage.jsx   # Teacher constraints editor
    ├── TimetableView.jsx            # Grid view
    └── TeacherLoadView.jsx          # Before/After comparison
```
