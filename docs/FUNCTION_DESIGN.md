# SRO Free Timetable — เอกสารออกแบบฟังก์ชันการทำงาน (Function Design)

> เอกสารนี้อธิบายการออกแบบและฟังก์ชันการทำงานของระบบ **SRO Free Timetable POC** อย่างละเอียด
> จัดทำขึ้นเพื่อใช้เป็นข้อมูลอ้างอิงในการ **นำระบบไปรวมกับระบบหลัก (Main System)** และเป็น
> เอกสารประกอบการพัฒนา/ดูแลระบบต่อ
>
> อัปเดตล่าสุด: 2026-10-06 · สอดคล้องกับโค้ดบน branch `main` + งานที่ยังไม่ commit ในขณะนั้น

---

## สารบัญ

1. [ภาพรวมระบบ](#1-ภาพรวมระบบ)
2. [สถาปัตยกรรมและโครงสร้างโปรเจค](#2-สถาปัตยกรรมและโครงสร้างโปรเจค)
3. [Data Model (ข้อมูลและโครงสร้างข้อมูล)](#3-data-model)
4. [API Endpoints (Backend)](#4-api-endpoints)
5. [Constraint Solver Engine](#5-constraint-solver-engine)
6. [Pre-flight Validation](#6-pre-flight-validation)
7. [Excel Import / Export](#7-excel-import--export)
8. [Storage และ Authentication](#8-storage-และ-authentication)
9. [Frontend — Wizard 7 ขั้นตอน](#9-frontend--wizard-7-ขั้นตอน)
10. [State Management (AppContext)](#10-state-management-appcontext)
11. [ฟังก์ชัน Export และ Utility (Frontend)](#11-ฟังก์ชัน-export-และ-utility-frontend)
12. [การทดสอบ (Testing)](#12-การทดสอบ-testing)
13. [แนวทางการรวมกับระบบหลัก (Integration Guide)](#13-แนวทางการรวมกับระบบหลัก)
14. [การ Deploy และการตั้งค่า](#14-การ-deploy-และการตั้งค่า)

---

## 1. ภาพรวมระบบ

ระบบ **SRO Free Timetable** เป็นระบบจัดตารางเรียนอัตโนมัติสำหรับโรงเรียนไทย (ประถม/มัธยม/อนุบาล)
โดยใช้ **Constraint Solver (Google OR-Tools CP-SAT)** คำนวณตารางสอนที่ไม่มีคาบชนกันของ
ครู/ห้อง/ห้องเรียน พร้อมรองรับเงื่อนไขเฉพาะของบริบทโรงเรียนไทย เช่น กิจกรรมลูกเสือ/โฮมรูม,
รด., ครูควบภาระงานบริหาร, วิชาคาบคู่, Co-teaching (ครูผู้สอนร่วม) เป็นต้น

**จุดประสงค์ของระบบ (POC)**:
- พิสูจน์ว่า CP-SAT solver รองรับขนาดโรงเรียนจริง (5–30 ครู) ได้ภายในเวลาที่ใช้งานได้
- ใช้งานได้จริงตั้งแต่กรอกข้อมูล → จัดตาราง → ตรวจสอบ → แก้ไขมือ → พิมพ์/แชร์
- มีกลไกอธิบายสาเหตุเมื่อหา INFEASIBLE (หาไม่ได้) เพื่อให้ผู้ใช้แก้ข้อมูลได้

**เทคโนโลยีหลัก**:

| ส่วน | เทคโนโลยี |
|---|---|
| Frontend | React 18 + Vite 6 + Tailwind CSS 3 + lucide-react |
| Backend | Python + FastAPI + Pydantic v2 |
| Solver | Google OR-Tools CP-SAT |
| Excel | openpyxl (backend) / exceljs + xlsx (frontend) |
| Storage | Cloudflare D1 (REST API) + fallback ไฟล์ JSON ในเครื่อง |
| Auth | Google OAuth 2.0 (optional) + JWT (HS256) + Guest Device ID |
| Cache (frontend) | IndexedDB (native) + localStorage |

---

## 2. สถาปัตยกรรมและโครงสร้างโปรเจค

### 2.1 ภาพรวมสถาปัตยกรรม

```
┌─────────────────────────────┐        ┌──────────────────────────────┐
│  Frontend (React SPA)        │  HTTP  │  Backend (FastAPI :8000)     │
│  ─────────────────           │ ─────► │  ─────────────────           │
│  Wizard 7 ขั้นตอน             │        │  /generate                  │
│  AppContext (global state)   │        │  /api/schedules  (CRUD)     │
│  IndexedDB cache             │        │  /api/import/excel/*        │
│  localStorage (placements/   │        │  /api/v1/timetables/*       │
│   snapshots/substitutes)     │        │  /api/v1/auth/*             │
└─────────────────────────────┘        │  ─────────────────           │
                                       │  solver.py (OR-Tools CP-SAT) │
                                       │  preflight.py (ตรวจสอบก่อน)   │
                                       │  excel_parser.py             │
                                       └──────────┬───────────────────┘
                                                  │
                              ┌───────────────────┼───────────────────┐
                              ▼                   ▼                   ▼
                    ┌─────────────────┐  ┌────────────────┐  ┌────────────────┐
                    │ Cloudflare D1   │  │ ไฟล์ JSON       │  │ Google OAuth   │
                    │ (timetables,    │  │ (schedule_store │  │ (ถ้าตั้งค่า)     │
                    │  users,         │  │  / local        │  │                │
                    │  workspaces)    │  │  fallback)      │  │                │
                    └─────────────────┘  └────────────────┘  └────────────────┘
```

### 2.2 โครงสร้างโฟลเดอร์

```
time table/
├── backend/                      # Python FastAPI
│   ├── main.py                   # FastAPI app + route รวม (health, generate, schedules, import)
│   ├── models.py                 # Pydantic models ทั้งหมด (input/output/enum)
│   ├── solver.py                 # TimetableSolver — OR-Tools CP-SAT
│   ├── preflight.py              # run_preflight — ตรวจสอบก่อนรัน solver
│   ├── excel_parser.py           # นำเข้า/สร้าง template Excel (1,316 บรรทัด)
│   ├── auth.py                   # JWT create/decode + identity resolution
│   ├── config.py                 # Settings จาก env / .env (pydantic-settings)
│   ├── utils.py                  # helpers: เวลา, day-period,  overlap, lunch window
│   ├── schedule_store.py         # จัดเก็บ ScheduleTemplate (ไฟล์ JSON)
│   ├── timetable_store.py        # D1 หรือ LocalTimetableStore (timetables/users/workspaces)
│   ├── d1_service.py             # D1Client — เรียก Cloudflare D1 REST API
│   ├── api/
│   │   ├── timetables.py         # Router /api/v1/timetables/* (sharing + workspace)
│   │   └── auth.py               # Router /api/v1/auth/* (Google OAuth)
│   ├── fixtures/                 # ข้อมูลตัวอย่าง school_small/medium/large/primary_mock.json
│   ├── schema.sql                # DDL สำหรับ D1
│   ├── scripts/ (002_upgrade.sql, init_d1.sql)
│   └── test_*.py                 # ชุดทดสอบ pytest
├── frontend/                     # React SPA
│   └── src/
│       ├── App.jsx               # กำหนด route ตาม activeStep + /view + /auth/callback
│       ├── context/AppContext.jsx# global state (useReducer) + actions ทั้งหมด
│       ├── api/client.js         # ฟังก์ชันเรียก API ทั้งหมด
│       ├── api/config.js         # BASE_URL
│       ├── pages/                # 7 ขั้นตอน wizard + PublicViewer + AuthCallback
│       ├── components/           # grid / input / layout / load / metrics / modals /
│       │                         #   print / rooms / timetable / verification / common / version
│       ├── hooks/useToast.js     # toast notification
│       └── utils/                # periods, scoreCalculator, versionManager, cache,
│                                 #   exportEngine, exportExcel, exportPdf, exportImage,
│                                 #   exportMatrix, exportTemplateExcel, smartDefaults,
│                                 #   subjectColors, roomTypes, teacherLoad
└── docs/                         # SITEMAP.md (เก่า), ux-review-*, FUNCTION_DESIGN.md (เอกสารนี้)
```

### 2.3 Flow การทำงานหลัก (Wizard 7 ขั้นตอน)

| Step | หน้า | หน้าที่ |
|---|---|---|
| 0 | `LandingPage` | เลือกข้อมูลตัวอย่าง (fixture), ทำงานต่อจากแคช, เข้าสู่ระบบ, โหลดงานจากคลาวด์/สแนปชอต |
| 1 | `DataIngestionStep` | สร้างห้องเรียน/ระดับชั้น, นำเข้า Excel, จัดการห้องพิเศษ (special rooms), แยกคาบ Lab |
| 2 | `ScheduleBlocksStep` | กำหนดตารางโครงสร้าง (บล็อกเวลา/คาบ/พักเที่ยง), กิจกรรมพิเศษ (fixed slots) |
| 3 | `TeacherWorkloadStep` | เงื่อนไขรวม (Global Conditions), เงื่อนไขครูรายบุคคล, จัดการวิชา, เพิ่มครู |
| 4 | `VerificationStep` | ตรวจสอบข้อมูลก่อนจัด: สรุปครู/ห้อง, ความหนาแน่นห้องเรียน, การใช้ห้องพิเศษ, เมทริกซ์ครู×ห้อง |
| 5 | `TimetableView` | ดูตารางสอนกริด, แก้ไขด้วยลากวาง, กันคาบ (pin), รายงานคาบที่ยังไม่ได้จัด, จัดครูสอนแทน |
| 6 | `PrintStudio` | สร้างเอกสารพิมพ์ (PDF/HTML), QR code, ลิงก์แชร์ตาราง |

หน้าพิเศษ (ไม่เข้า wizard): `PublicViewerPage` (`/view?code=...`) และ `AuthCallback` (`/auth/callback?token=...`)

---

## 3. Data Model

ไฟล์: `backend/models.py` — ทุก model เป็น Pydantic v2 `BaseModel`

### 3.1 Enum

| Enum | ค่า |
|---|---|
| `SubjectCategory` | `core`, `pe`, `art`, `music`, `lab`, `admin` |
| `FixedSlotType` | `assembly`, `guidance`, `club`, `homeroom`, `scout`, `rotc`, `activity`, `other` |
| `PeriodType` | `STUDY`, `LUNCH`, `BREAK` |
| `AdminRole` | `none`, `finance`, `discipline`, `dept_head` |
| `OptimizationMode` | `FAST`, `BALANCED`, `DEEP` |

### 3.2 Input Models (ใช้สร้าง `TimetableRequest`)

| Model | ฟิลด์สำคัญ | หมายเหตุ |
|---|---|---|
| `Teacher` | `id`, `name`, `teacher_type` (regular/special/foreign/trainee — แสดงผลเท่านั้น), `max_periods_per_week` (default 30), `min_periods_per_week`, `unavailable_slots` (list `"day-period"`), `admin_role`, `admin_free_slots` (T4), `no_first_period`, `no_last_period`, `max_consecutive_teaching` (0 = ใช้ global), `enable_consecutive_limit`, `is_consecutive_customized`, `spread_free_periods` | |
| `Room` | `id`, `name`, `room_type` (default `classroom`) | |
| `Subject` | `id`, `name`, `category`, `is_heavy` (S2 วิชาหนักเน้นเช้า), `time_preference` (`any`/`morning`/`afternoon`) | |
| `ClassGroup` | `id`, `name`, `grade_level` (1–12) | |
| `FixedSlotAssignment` | `day` (1–7), `period` (1–12) | ใช้ปักหมุดหลายช่องของ lesson block เดียวกัน |
| `LessonBlock` | `id`, `subject_id`, `teacher_id`, `co_teacher_id` (ครูผู้สอนร่วม), `class_id`, `room_id`, `periods_per_week` (1–10), `is_double_period`, `is_fixed`, `fixed_day`/`fixed_period` (legacy เดี่ยว), `fixed_slots` (list — มีค่าเมื่อใช้แทน legacy), `block_id` (ผูกกับ schedule block) | หน่วยประมวลผลหลักของ solver |
| `FixedSlot` | `id`, `name`, `slot_type`, `day`, `period`, `periods` (คาบเพิ่มเติมในวันเดียวกัน), `class_ids` (ว่าง = ทุกห้อง) | กิจกรรมพิเศษ เช่น ลูกเสือ/โฮมรูม; `effective_periods()` = sorted union |
| `SubjectTimeRule` | `subject_id`, `preference` (morning/afternoon), `mode` (soft/hard/off) | "วิชาเฉพาะช่วงเวลา" |
| `ScheduleConfig` | `days_per_week` (1–7), `periods_per_day` (1–12), `lunch_periods` (default [4]), `assembly_slots`, `max_consecutive_teaching` (default 4), `default_max_periods_per_week` (default 22), `pe_hot_periods`, `am_pm_free_mode`, `max_consecutive_mode`, `subject_day_spacing_mode`, `heavy_morning_mode`, `workload_balance_mode`, `gap_clustering_mode`, + legacy bool fields, `subject_time_rules` | ทุก `*_mode` มีค่า `off`/`soft`/`hard` |

**Legacy bool → mode mapping** (สำคัญสำหรับ backward compat):
- `enable_subject_day_spacing` (True → soft) → `subject_day_spacing_mode`
- `enable_heavy_morning` (True → soft) → `heavy_morning_mode`
- `enable_workload_balance` (True → soft) → `workload_balance_mode`
- `enable_gap_clustering` (True → soft) → `gap_clustering_mode`

| Model | ฟิลด์สำคัญ | หมายเหตุ |
|---|---|---|
| `PeriodDefinition` | `period_num`, `start_time`, `end_time`, `period_type`, `label` | ใช้ใน ScheduleTemplate |
| `SpecialDay` | `day_of_week`, `day_type` (half_day/full_day_off/activity_day), `label`, `max_periods` | |
| `GradeActivity` | `grade_level`, `activity_name`, `activity_type` (scout/rotc/club/homeroom/assembly/guidance), `day_of_week`, `period_num` | |
| `ScheduleTemplate` | `id`, `name`, `description`, `days_per_week`, `periods_per_day`, `lunch_periods`, `period_definitions`, `grade_levels`, `special_days`, `grade_activities`, `is_preset`, `is_active` | CRUD ผ่าน `/api/schedules` |
| `SchedulePeriod` | `period_no` (**float** — รองรับ 3.5 = พักเบรกสั้นแทรก), `start_time`, `end_time`, `type` | |
| `ScheduleBlock` | `id`, `name`, `target_classes`, `days_per_week`, `start_time`, `period_duration_mins`, `break_duration_mins`, `periods`, `apply_to_all_days`, `periods_by_day` (dict day → periods) | รองรับหลายบล็อก (เช่น ระดับชั้นต่างกันเวลาไม่เท่ากัน) |
| `TimetableRequest` | `teachers`, `rooms`, `subjects`, `classes`, `lesson_blocks`, `fixed_slots`, `schedule_blocks`, `schedule_config` (ใช้เมื่อ schedule_blocks ว่าง), `solver_time_limit_seconds` (0.5–120), `optimization_mode` | **Payload หลักที่ส่ง POST /generate** |

### 3.3 Output Models

| Model | ฟิลด์ |
|---|---|
| `ScheduledSlot` | `lesson_block_id`, `day`, `period`, `subject_id`, `teacher_id`, `class_id`, `room_id` |
| `TeacherLoadSummary` | `teacher_id`, `teacher_name`, `assigned_periods`, `max_periods`, `min_periods`, `load_status` (`ok`/`over`/`under`) |
| `SolverMetrics` | `status` (`OPTIMAL`/`FEASIBLE`/`INFEASIBLE`/`UNKNOWN`), `objective_value`, `wall_time_seconds`, `num_variables`, `num_constraints`, `hard_violations`, `soft_violations` |
| `TimetableResponse` | `slots[]`, `teacher_loads[]`, `metrics`, `diagnostics?` |

### 3.4 Diagnostics (ผล pre-flight)

| Model | ฟิลด์ | ความหมาย blocking |
|---|---|---|
| `TeacherOverload` | `teacher_id/name`, `needed_periods`, `available_slots`, `max/min_periods_per_week`, `reason` (`over_max`/`over_available`/`under_min`/`am_pm_hard`) | `over_max` = **เตือนเท่านั้น** (solver ยังจัดให้ครบแล้ว flag "over"); อื่น = blocking |
| `RoomOverload` | `room_id/name`, `needed_periods`, `available_slots` | blocking |
| `FixedSlotConflict` | `lesson_block_id`, `day`, `period`, `reason` | blocking |
| `ClassCapacityIssue` | `class_id/name`, `needed_periods`, `available_slots`, `overflow` | **ไม่บล็อก** — solver ใช้ period_count เป็น soft จะคืนตารางบางส่วน + คำเตือน |
| `DiagnosticsReport` | รายการข้างต้น + `hard_rule_issues[]` (ข้อความไทยว่าทำไม hard rule เป็นไปไม่ได้) + `notes[]` | `has_blocking_issues()` = มี teacher overload (ยกเว้น over_max), room overload, fixed slot conflict, หรือ hard rule issue |

### 3.5 Sharing / Workspace / Auth Models

| Model | ฟิลด์ | ใช้กับ endpoint |
|---|---|---|
| `GenerateAndSaveRequest` | `title`, `academic_year`, `term` (1–3), `config: TimetableRequest`, `is_public` | `generate-and-save` (รัน solver + บันทึก) |
| `SaveResultRequest` | เหมือนข้างบน + `result: TimetableResponse` | `save-result` (**ไม่รัน solver ใหม่** — ใช้เมื่อแก้มือแล้ว) |
| `ClaimTimetableRequest` | `short_code` | `claim` |
| `TimetableRecord` | `id`, `short_code`, `user_id`, `title`, `academic_year`, `term`, `config`, `result`, `workspace`, `is_public`, `created_at`, `updated_at` | `t/{code}`, `my-schedules`, `workspace/{id}` |
| `TimetableSaveResult` | `id`, `short_code`, `share_url`, `title`, `academic_year`, `term` | ตอบกลับการบันทึก |
| `WorkspaceSaveRequest` | `id?`, `title`, `academic_year`, `term`, `workspace` (dict เก็บทั้ง workspace) | `save-workspace` |
| `MergeGuestRequest` | `device_id` | `merge-guest` |
| `User` | `id` (google_sub), `email`, `name`, `picture` | `auth/me` |

---

## 4. API Endpoints

### 4.1 Core (main.py)

| Method | Path | ฟังก์ชัน |
|---|---|---|
| GET | `/health` | ตรวจสถานะ → `{ status: "ok", solver: "OR-Tools CP-SAT" }` |
| POST | `/generate` | รับ `TimetableRequest` → เรียก solver → `TimetableResponse`; ถ้า INFEASIBLE คืน **422 พร้อม body เต็ม (มี diagnostics)** |
| POST | `/generate/from-file?file_path=...` | รันจากไฟล์ JSON ใน `backend/fixtures/` — **บังคับ path อยู่ใน fixtures** (กัน path traversal, 403/404) |
| GET | `/api/schedules` | list `ScheduleTemplate[]` |
| GET | `/api/schedules/{id}` | ดึง template |
| POST | `/api/schedules` | สร้าง template |
| PUT | `/api/schedules/{id}` | แก้ไข template |
| DELETE | `/api/schedules/{id}` | ลบ template |

### 4.2 Excel Import (main.py)

| Method | Path | ฟังก์ชัน |
|---|---|---|
| POST | `/api/import/excel/detect` | อัปโหลด .xlsx → detect columns → คืน preview + auto-mapping |
| POST | `/api/import/excel/import` | อัปโหลด + `mapping` (JSON form) → import **multi-sheet** → คืน teachers/subjects/classes/lesson_blocks/fixed_slots |
| GET | `/api/import/excel/template` | ดาวน์โหลด template ขั้นต่ำ (1 sheet flat) |
| GET | `/api/import/excel/template-full` | ดาวน์โหลด template เต็ม 3 sheets |
| POST | `/api/import/excel/import-minimum` | import template ขั้นต่ำ (แถวที่วิชา/ห้องว่างยัง import ครู) |

> ทุก endpoint Excel จำกัดขนาดไฟล์ **10 MB** (413 ถ้าเกิน) และใช้ decorator `handle_excel_errors`:
> `HTTPException` → ส่งต่อ, `RuntimeError` → 500, อื่น → 400

### 4.3 Timetable Sharing / Workspace (`api/timetables.py` — prefix `/api/v1/timetables`)

| Method | Path | Auth | ฟังก์ชัน |
|---|---|---|---|
| POST | `/generate-and-save` | optional identity | รัน solver → บันทึก → คืน `short_code` 6 ตัว + `share_url`; INFEASIBLE → 422 |
| POST | `/save-result` | optional identity | **บันทึกผลลัพธ์ที่แก้มือแล้วโดยไม่รัน solver ใหม่** (กัน INFEASIBLE จาก placement ที่ล็อกแล้ว) |
| GET | `/t/{short_code}` | สาธารณะ | ดึงตารางตาม short code (`TimetableRecord`) |
| GET | `/my-schedules` | ต้องมี identity | list ตารางของตัวเอง |
| POST | `/claim` | ต้องมี identity | ผูก short code ที่สร้างแบบ guest เข้ากับผู้ใช้ |
| POST | `/save-workspace` | ต้องมี identity | บันทึก workspace ทั้งหมด (private, `is_public=0`); มี `id` = update (ตรวจ ownership) |
| GET | `/workspace/{record_id}` | ต้องมี identity (owner) | โหลด workspace ส่วนตัว |
| DELETE | `/workspace/{record_id}` | ต้องมี identity (owner) | ลบ workspace |
| POST | `/merge-guest` | **JWT เท่านั้น** (guest merge ไม่ได้) | โอนย้าย records ที่สร้างแบบ guest ไปให้ผู้ใช้ที่ login แล้ว |

**Short code**: 6 ตัวอักษร จาก alphabet `ABCDEFGHJKLMNPQRSTUVWXYZ23456789` (ตัด 0/O/1/I/L ที่กำกวม), สุ่มด้วย `secrets`, ลองสูงสุด 10 ครั้งกันชน, URL = `{FRONTEND_BASE_URL}/view?code={code}`

**Identity**: ใช้ `get_optional_identity` (ยอมรับ anonymous) หรือ `get_identity` (บังคับ) — ดูหัวข้อ 8

### 4.4 Auth (`api/auth.py` — prefix `/api/v1/auth`)

| Method | Path | ฟังก์ชัน |
|---|---|---|
| GET | `/google/url` | คืน Google consent URL + state (CSRF, TTL 10 นาที) — 503 ถ้ายังไม่ได้ตั้งค่า |
| GET | `/google/callback` | รับ `?code&state` → แลก token → ดึง userinfo → upsert user → ออก JWT → **302 redirect** ไป `/auth/callback?token=...` |
| GET | `/me` | คืนโปรไฟล์ผู้ใช้ปัจจุบัน (Bearer JWT) |

---

## 5. Constraint Solver Engine

ไฟล์: `backend/solver.py` (คลาส `TimetableSolver`)

### 5.1 ตัวแปรตัดสินใจ

- `x[(lb_idx, day, period)]` — BoolVar: ก้อนวิชา i ถูกจัดที่ (วัน, คาบ) (คาบเดียว)
- `pair[(lb_idx, day, period)]` — BoolVar: ก้อนวิชา i **คาบคู่** ครอบ (period, period+1) — นับเป็น 2 คาบ

ถ้า `is_double_period` และ `periods_per_week` เป็นเลขคี่ จะสร้างทั้ง pair + single ที่เหลืออีก 1 คาบ
**Multi-block mode**: ใช้ `schedule_blocks` ถ้ามี (เช็คชนกันตามช่วงเวลาจริง ใช้ `time_intervals_overlap`); ไม่มี → legacy `schedule_config` (เช็คตามเลข day-period)

### 5.2 Hard Constraints (ละเมิด = INFEASIBLE)

| ID | ชื่อ | คำอธิบาย |
|---|---|---|
| H1 | Teacher Clash | ครู 1 คน (รวม co-teacher) สอนพร้อมกันไม่ได้ — multi-block ตรวจ overlap ตามเวลาจริงของแต่ละ block |
| H2 | Class Clash | ห้องเรียน 1 ห้องเรียนได้ 1 วิชาต่อคาบ |
| H3 | Room Clash | ห้องเรียน/ห้องพิเศษ 1 ห้องใช้พร้อมกันไม่ได้ |
| H4 | Period Count | แต่ละ lesson block ต้องได้ `periods_per_week` คาบ — **เป็น soft** (`<=` + penalty under 50) เพื่อให้คืนตารางบางส่วนแทน INFEASIBLE |
| H5 | Max per Day | คาบต่อวันต่อ block: double = สูงสุด 1 pair + 1 single (3 คาบ), single = `ceil(periods/days)` แต่ไม่เกิน 2 |
| H6 | Pre-assignment | `is_fixed=True` → บังคับตัวแปรที่ `fixed_slots[]` (หรือ legacy `fixed_day/fixed_period`) = 1 |
| — | Teaching Load Bounds | `min_periods_per_week` = **hard**; `max_periods_per_week` = **soft เตือน** (overflow penalty 10 < under 50 → จัดครบก่อน แล้ว flag "over") |
| T5 | Discipline free slots | ครูฝ่ายปกครองว่างคาบ 1 และคาบสุดท้าย (ผ่าน `admin_free_slots`) |
| — | Lunch Guarantee | (multi-block) ครูทุกคนมีคาบว่างอย่างน้อย 1 ในช่วง 11:00–13:30 ต่อวัน |
| H7 | Unavailable | `unavailable_slots` + `admin_free_slots` = ห้ามจัด |
| H8 | Double continuity | คาบคู่ต้องติดกันภายในวันเดียว (ผ่าน pair var) |
| H11 | PE thermal | PE ห้ามจัดใน `pe_hot_periods` |

### 5.3 Soft Constraints (Objective penalty — `minimize Σ weight×penalty`)

| ID | ชื่อ | โหมด | น้ำหนัก |
|---|---|---|---|
| S1 | Subject Day Spacing | off/soft/hard | 5 — วิชา 2+ คาบไม่ควรจัดวันติดกันคาบเดียวกัน |
| S2 | Cognitive Load Morning | off/soft/hard | **10 ถ้า DEEP, 1 ถ้าอื่น** — วิชาหนักเน้นเช้า (คาบ 1–3) |
| S3 | Max Consecutive Teaching | off/soft/hard | 100 — สอนติดกันเกิน N คาบ (N ต่อครู > 0 ใช้ของครู, ไม่งั้น global) |
| — | Elastic Workload Balance | off/soft | 5 — เกลี่ยภาระครูต่อวันให้ใกล้ค่าเฉลี่ย ±1 |
| — | Teacher Gap Clustering | off/soft (**DEEP เท่านั้น**) | 3 ต่อ transition — ลดคาบว่างแทรกกลางวัน (จับกลุ่มคาบสอน) |
| — | AM/PM Free | off/soft/hard | 50 — ทุกวันต้องมีว่างเช้า 1 + บ่าย 1 (แบ่งตามพักเที่ยง; ไม่มีพักเที่ยง → แบ่งครึ่ง) |
| — | Subject Time Preference | soft/hard | 8 — วิชาเฉพาะช่วงเวลา (`subject_time_rules`; fallback `subject.time_preference` soft) |

หมายเหตุ: penalty `_add_soft_spread_preference` (ไม่จัดคาบสุดท้าย) ถูก **ปิดใช้งาน** เพราะทำให้คาบสุดท้ายว่างทั้งกระดาน — S2 เอาน้ำหนักที่พอดีแทน

### 5.4 โหมดการแก้ (Optimization Mode + Time Limit)

| Preset (frontend) | optimization_mode | time limit | พฤติกรรม |
|---|---|---|---|
| ⚡ fast | `FAST` | ~2–3 วิ | ใช้ `_FirstSolutionCallback` หยุดที่ feasible แรก |
| 🎯 balanced | `BALANCED` | ~10–15 วิ | รันเต็ม time limit เพิ่มคุณภาพ objective |
| 💎 deep | `DEEP` | มากกว่า | เปิด gap clustering + S2 น้ำหนักสูง |

ค่า time limit จริงมาจาก `SOLVER_PRESETS` ใน `frontend/src/utils/scoreCalculator.js` (resolveSolverParams)
Solver ใช้ `num_search_workers = 8`, `max_time_in_seconds = solver_time_limit_seconds`

### 5.5 ขั้นตอนการ solve

1. `run_preflight(request)` — ถ้า `has_blocking_issues()` → คืน INFEASIBLE พร้อม diagnostics ทันที (ไม่รัน CP-SAT)
2. `_create_variables()` → `_add_hard_constraints()` → `_add_objective()` (soft penalties)
3. `solver.Solve()` → map status → `_extract_slots()` (รวม single + pair × 2) → `_compute_teacher_loads()` (นับ co-teacher ด้วย)
4. ถ้า solver คืน INFEASIBLE ทั้งที่ผ่าน pre-flight → ต่อท้าย `diagnostics.notes` คำแนะนำภาษาไทย

---

## 6. Pre-flight Validation

ไฟล์: `backend/preflight.py` — ตรวจสอบก่อนรัน solver เพื่อคืน **DiagnosticsReport** ที่อ่านเข้าใจได้
ตรรกะนับช่องว่าง (`_count_teacher_available_slots`) สะท้อน `TimetableSolver._is_valid_slot` ให้ตรงกัน

**การตรวจ 5 อย่าง**:

1. **Class Capacity** — คาบรวมของห้อง > ช่อง STUDY ทั้งสัปดาห์ (หัก fixed slots + assembly) → `ClassCapacityIssue` (ไม่บล็อก แต่ UI ปิดปุ่ม generate พร้อมบอกห้องที่ต้องแก้)
2. **Teacher Overload** — ภาระครูเทียบกับ [min, max] และช่องว่างจริง:
   - `needed > max` → `over_max` (**เตือน**)
   - `needed > available` → `over_available` (บล็อก)
   - `needed < min` → `under_min` (บล็อก)
   - hard am/pm mode → `am_pm_hard` (บล็อก)
3. **Room Overload** — ห้องพิเศษถูกใช้เกินช่องว่าง → `RoomOverload` (บล็อก)
4. **Fixed Slot Conflict** — lesson block ที่ `is_fixed` ชนกับ unavailable/lunch/assembly/class block → `FixedSlotConflict` (บล็อก)
5. **Hard Rule Feasibility** — hard global rules ที่พิสูจน์ได้ว่าเป็นไปไม่ได้ (เช่น วิชาหนัก hard morning เกินช่องเช้า) → `hard_rule_issues` ข้อความภาษาไทย (บล็อก)

---

## 7. Excel Import / Export

ไฟล์: `backend/excel_parser.py`

### 7.1 ฟังก์ชันหลัก

| ฟังก์ชัน | คำอธิบาย |
|---|---|
| `parse_excel(bytes)` | อ่าน header + preview + `auto_map_columns` (จับคู่คอลัมน์ไทย/อังกฤษด้วย `_similarity`) |
| `import_with_mapping(bytes, mapping)` | import ตาม mapping ที่ผู้ใช้ยืนยัน (sheet เดียว) |
| `import_multi_sheet(bytes, mapping)` | import **3 sheets**: `Course_Mapping` (บังคับ), `Teacher_Constraints` (optional: unavailable slots, max/min periods, admin role), `Fixed_Slots` (optional) — แปลง unavailable เป็น `"day-period"`, period list, class ids; `_dedup_lesson_blocks` กันซ้ำ |
| `generate_minimum_template()` | สร้าง .xlsx template 1 sheet แบน |
| `import_minimum_template(bytes)` | import template ขั้นต่ำ; `_extract_grade_level` อนุมานเกรดจากชื่อห้อง (เช่น ป.4 → 4) |
| `generate_full_template()` | สร้าง .xlsx 3 sheets พร้อม header/styling |

### 7.2 Flow การนำเข้า (frontend)

```
เลือกไฟล์ .xlsx → POST /detect → แสดง preview + auto-mapping (แก้ได้)
→ POST /import (mapping JSON) → ได้ teachers/subjects/classes/lesson_blocks/fixed_slots
→ setFixtureDataDirect(data)  // selectedFixture = 'custom', ล้าง cache/result เก่า
```

---

## 8. Storage และ Authentication

### 8.1 Storage

| ส่วน | กลไก | รายละเอียด |
|---|---|---|
| ScheduleTemplate | `schedule_store.py` | ไฟล์ JSON ในเครื่อง (`backend/data/`) — CRUD |
| Timetables / Users / Workspaces | `timetable_store.py` | ถ้าตั้งค่า D1 (`d1_configured`) → `D1Client` (Cloudflare D1 REST); ไม่ตั้ง → `LocalTimetableStore` (ไฟล์ JSON) — interface เดียวกันผ่าน `get_timetable_store()` |
| D1 | `d1_service.py` | `D1Client.query()`/`execute()` เรียก REST API; `D1Error`; schema ใน `backend/schema.sql` + `scripts/` |
| Frontend cache | `utils/cache.js` | IndexedDB (`sro-timetable`) 2 object stores: `timetable` + `meta`; key เช่น `timetable_small` |
| Frontend localStorage | | `placements_{fixture}`, `substitutes_{fixture}`, `sro_snapshots`, `sro_user_id`, `sro_auth_token`, ปุ่ม panel pref |

### 8.2 Authentication (optional)

ไฟล์: `backend/auth.py` + `backend/api/auth.py` + `frontend/src/api/client.js`

**สองรูปแบบ identity**:
1. **Logged-in (JWT)**: `Authorization: Bearer <jwt>` — JWT HS256, exp 30 วัน (`JWT_EXPIRE_DAYS`), claims: `sub`(google_sub), `email`, `name`, `iat`, `exp`
2. **Guest (device)**: `X-User-Id: <device_id>` — device id สุ่มเก็บใน localStorage (`sro_user_id`)

**Dependency ของ FastAPI**:
- `get_identity` — ต้องมี identity ตัวใดตัวหนึ่ง (401 ถ้าไม่มี)
- `get_optional_identity` — ยอมรับ anonymous (คืน None); ใช้กับ generate-and-save
- `require_authenticated` — ต้องเป็น JWT เท่านั้น (guest → 403); ใช้กับ merge-guest

**Google OAuth flow**:
```
/login → GET /api/v1/auth/google/url → { url, state }
→ redirect ไป Google → กลับมา /api/v1/auth/google/callback?code&state
→ แลก code → userinfo → upsert user → ออก JWT → 302 ไป /auth/callback?token=<jwt>
→ frontend เก็บ token ใน localStorage (sro_auth_token)
```

> OAuth state เก็บใน memory dict (TTL 10 นาที, auto-GC) — หมายเหตุ POC: ต้องย้ายไป Redis/D1 ถ้ารันหลาย instance

---

## 9. Frontend — Wizard 7 ขั้นตอน

### Step 0 — `LandingPage.jsx`

- การ์ดเลือกข้อมูลตัวอย่าง: **small** (5 ครู/3 ห้อง), **medium** (15/6), **large** (30/12), **primary_mock** (25/12 ประถม สพฐ.)
- การ์ด **"ทำงานต่อ"** (cache hint จาก IndexedDB — ไม่ auto-jump, ผู้ใช้เลือกกดเอง)
- ปุ่มเริ่มต้น: สร้างใหม่ (ไป Step 1), นำเข้า Excel, โหลดงานจากคลาวด์/สแนปชอต
- ปุ่ม **เข้าสู่ระบบด้วย Google** (ซ่อนเมื่อ backend ยังไม่ได้ตั้งค่า — 503), หลัง login แสดงรูป/ชื่อผู้ใช้ + logout
- แสดงโทสต์แจ้งเตือน (useToast)

### Step 1 — `DataIngestionStep.jsx`

- **สร้างห้องเรียน**: เดี่ยว (`addManualClass` — สร้าง class + room `R_{id}` พร้อมกัน) หรือ **batch ตามระดับชั้น** (`addGradeBatch` — GRADE_RANGE_PRESETS อ.1–3 / ป.1–3 / ป.4–6 / ม.1–3 / ม.4–6)
- **นำเข้า Excel**: `ExcelImportModal` 2 โหมด — `full` (multi-sheet detect+import) / `minimum` (template ขั้นต่ำ)
- **SpecialRoomsManager** (`components/rooms/`): เพิ่ม/แก้ไข/ลบห้องพิเศษ (ห้องแล็บ, ห้องดนตรี ฯลฯ ตาม `roomTypes.js`)
- **LabPeriodSplitter**: แยกคาบ lab ออกจากวิชาปกติ (สร้าง lesson block ใหม่ในห้อง lab + ลดคาบ block เดิม; labPeriods=0 = รวมกลับ)
- Demo quick-start: โหลด `primary_mock`

### Step 2 — `ScheduleBlocksStep.jsx`

- **BlockCard**: สร้าง/แก้ไข schedule block — ชื่อ, target classes, เริ่มเวลา, ระยะคาบ/พัก/พักเที่ยง, จำนวนคาบ, `apply_to_all_days` + `periods_by_day` (วันไหนต่างจากปกติ), เพิ่ม/ลบพักเบรกสั้น (`insertBreakPeriod` → period_no 3.5 ไม่เลื่อนเลขคาบเดิม → **ไม่ต้องรัน solver ใหม่**)
- `generatePeriods` คำนวณ start/end time อัตโนมัติ
- **SpecialActivitiesSection** (กิจกรรมพิเศษ/fixed slots): สร้างกิจกรรม (ลูกเสือ/โฮมรูม/ประชุมเช้า/ฯลฯ) เลือกวัน/คาบ/จำนวนคาบ/ระดับชั้น, บันทึกเป็น preset (`loadCustomPresets`/`saveCustomPresets` localStorage), และ **ตรวจคาบซ้ำ (ใหม่)** — `computeSlotConflicts` เตือนเมื่อวัน+คาบ+ชั้นทับกับกิจกรรมเดิม (บล็อกการบันทึก + แสดง badge ในรายการ)
- ปุ่ม "สร้างตาราง" (ไป Step 3)

### Step 3 — `TeacherWorkloadStep.jsx`

- **GlobalConditionsCard**: ปรับโหมด off/soft/hard ของทุกกฎรวม (S1–S3, workload balance, am/pm free, heavy morning, gap clustering, subject day spacing), `default_max_periods_per_week`, `max_consecutive_teaching`, lunch periods, PE hot periods, วิชาเฉพาะช่วงเวลา (`subject_time_rules`)
- **TeacherCard + TeacherPreferencesSection** (ต่อครู): กริดช่องห้ามสอน (unavailable_slots), admin role (none/finance/discipline/dept_head), max/min periods, no_first_period/no_last_period, max_consecutive_teaching + enable toggle, spread_free_periods (AM/PM)
- **AddTeacherModal**: เพิ่มครูใหม่ (auto ID)
- **SubjectMasterModal**: จัดการวิชา — ชื่อ, category, is_heavy, time_preference
- ปุ่ม "ตรวจสอบข้อมูล" (ไป Step 4)

### Step 4 — `VerificationStep.jsx`

ตรวจสอบ **ข้อมูลก่อนจัดตาราง** (คำนวณจาก lesson_blocks ไม่ใช่ result):

- **TeacherSummaryTable** — สรุปภาระครู: วิชา → ห้อง, รวมคาบ, สถานะเกินเพดาน (แดง), สอนข้าม block (`isCrossBlock`)
- **ClassroomDensityTable** — จำนวนคาบต่อห้อง เทียบความจุรายสัปดาห์ของ block; **overCapacityClasses** → บล็อกปุ่ม "จัดตาราง" + แจ้งห้องที่ต้องแก้
- **FacilityUsageSummary / FacilityTimetable** — การใช้ห้องพิเศษ (สรุป + ตารางรายห้อง)
- **TeacherClassMatrix (ใหม่)** — เมทริกซ์ **ครู × ห้อง**: เซลล์ = จำนวนคาบที่ครูสอนในห้องนั้น (สีเข้มตามจำนวน, tooltip แสดงรายวิชา, แถวแดง = ครูเกินเพดาน, คำเตือน co-teach นับ 2 ฝั่ง); ปุ่ม **ส่งออก Excel / PDF** (ใช้ `utils/exportMatrix.js`)
- Tab: ครู / ห้องเรียน / ห้องพิเศษ / เมทริกซ์ครู×ห้อง + ช่องค้นหา

### Step 5 — `TimetableView.jsx`

- **TimetableGrid**: กริด วัน × คาบ ต่อห้อง, สีตามวิชา (`subjectColors.js`), filter ตามห้อง/ครู
- **Drag & Drop**: ลากคาบไปวาง = เพิ่ม `userPlacements` (📌 pre-assigned); ลากออก = ลบ
- **Conflict tooltip**: ครูซ้ำ / ห้องซ้ำ เมื่อจัดซ้อน
- **Pin/Unpin กลุ่ม**: กันคาบ (pin) ตามครู / ตามห้อง / ทั้งหมดจาก solver — ใช้สำหรับล็อกก่อนจัดใหม่
- **Clear กลุ่ม**: เคลียร์ตามครู / ตามห้อง / เฉพาะ solver-only / ทั้งหมด
- **UnassignedSidebar (ใหม่)**: รายงาน lesson blocks ที่ยังไม่ได้จัดครบ `periods_per_week` (จาก `utils/teacherLoad.js`) — แสดงครู/ห้องที่ยังขาด
- **SubstituteManagerModal** (สอนแทน): เปลี่ยนครูผู้สอนระดับแสดงผล (display-level, ไม่รัน solver) — upsert ต่อ (day, period, class)
- **CellRoomEditModal**: เปลี่ยนห้องของคาบในกริด (`CHANGE_SLOT_ROOM`)
- **lockSlot/unlockSlot**: ล็อกคาบว่างเป็น fixed slot (รายห้องหรือทั้งโรงเรียน)
- **ส่งออก Excel** (ExportExcelModal) + ปุ่มไป PrintStudio
- แถบสถานะ: SolverMetrics + quality score (scoreCalculator)

### Step 6 — `PrintStudio.jsx`

- สร้างเอกสารพิมพ์ **HTML + inline CSS** (self-contained, พิมพ์ได้): หัวเอกสาร (โรงเรียน/ภาคเรียน/ชื่อครู/ห้อง), ตารางกริด, footer, สรุปภาระงาน (`buildWorkloadSummaryHTML`)
- **QR Code** (SVG string): payload บีบอัด → ลิงก์ `/view?code=...` หรือ `/view?d=<base64 payload>` — ครู/ห้อง/ชั้น/ทั้งโรงเรียน
- **ลิงก์แชร์สั้น** (short URL): `buildShortViewerURL(shortCode)` — ต้องบันทึกขึ้น D1 ก่อน (save-result); บันทึกลิงก์ที่สร้างแล้วใน localStorage (FIFO limit)
- **Export**: PDF หลายหน้า (`exportMultiPagePDF`), Excel, รูปภาพ (png)
- แผงพับเก็บได้ (collapsible panel — ปรับ tablet UX, จำ pref ไว้ localStorage)

### หน้าพิเศษ

- **`PublicViewerPage`** (`/view`): อ่าน `?code=` (เรียก `/api/v1/timetables/t/{code}`) หรือ `?d=` (payload base64 → `decodePayload`/`expandCompactPayload`) → แสดงตารางสาธารณะ (viewer responsive, แยกตามห้อง/ครู, QR)
- **`AuthCallback`** (`/auth/callback`): รับ `?token=` / `?error=` → เก็บ JWT → redirect กลับ Landing

---

## 10. State Management (AppContext)

ไฟล์: `frontend/src/context/AppContext.jsx` — `useReducer` + context

### 10.1 State หลัก

| state | ประเภท | คำอธิบาย |
|---|---|---|
| `selectedFixture` | string | `small/medium/large/primary_mock/custom` |
| `fixtureData` | object | `{ teachers, rooms, subjects, classes, lesson_blocks, fixed_slots, schedule_blocks, schedule_config, special_rooms }` |
| `result` | object|null | `TimetableResponse` (slots/teacher_loads/metrics/diagnostics) |
| `activeStep` | 0–6 | ขั้นตอน wizard |
| `isDirty` | bool | ข้อมูลเปลี่ยนหลังจัดตาราง → เตือนจัดใหม่ |
| `gridFilter` | {class, teacher} | ตัวกรองกริด |
| `userPlacements` | `{ [lb_id]: [{day, period}] }` | คาบที่ผู้ใช้ลากวางเอง (persist localStorage `placements_{fixture}`) |
| `substitutes` | array | ครูสอนแทน (display-level, persist `substitutes_{fixture}`) |
| `optimizationMode` / `solverPreset` | string | `FAST/BALANCED/DEEP` / `fast/balanced/deep` |
| `snapshots` / `activeSnapshotId` / `isSnapshotDirty` | | สแนปชอตเวอร์ชัน (versionManager) |
| `user` / `authToken` | | ผู้ใช้ที่ login + JWT |
| `cloudWorkspaces` / `activeCloudWorkspaceId` / `cloudSyncing` | | งานบนคลาวด์ |
| `cacheKey` / `lastSync` / `cacheHint` | | ข้อมูล cache IndexedDB |

### 10.2 Actions หลัก (reducer)

**ข้อมูล**: `SET_FIXTURE`, `SET_FIXTURE_DATA`, `SET_FIXTURE_DATA_DIRECT` (custom + ล้างทุกอย่าง), `UPDATE_FIXTURE_DATA`, `SET_DIRTY`, `CLEAR_RESULT`

**Placement**: `PLACE_LESSON_BLOCK` (กันซ้ำ + กันเกิน periods_per_week), `REMOVE_PLACEMENT`, `CLEAR_PLACEMENTS`, `RESTORE_PLACEMENTS` (filter lb_id ที่ยังมีอยู่ — กัน placement เก่าจากไฟล์ใหม่), `PIN_BY_TEACHER/CLASS`, `UNPIN_BY_TEACHER/CLASS`, `PIN_ALL_SOLVER_SLOTS`, `CLEAR_BY_TEACHER/CLASS`, `CLEAR_SOLVER_ONLY`, `CLEAR_ALL_SLOTS`

**Slot-level**: `MOVE_SLOT`, `DELETE_SLOT`, `LOCK_SLOT`/`UNLOCK_SLOT` (เขียนลง `fixtureData.fixed_slots`)

**Substitute**: `SET_SUBSTITUTE` (upsert ต่อ slot), `REMOVE_SUBSTITUTE`, `CLEAR_SUBSTITUTES`, `RESTORE_SUBSTITUTES`

**Special rooms**: `ADD_SPECIAL_ROOM` (dedupe ตามชื่อ + เพิ่มใน rooms), `UPDATE_SPECIAL_ROOM`, `DELETE_SPECIAL_ROOM` (reset room_id ของ lb → `R_{class}`), `SET_LESSON_BLOCK_ROOM`, `CHANGE_SLOT_ROOM`, `SPLIT_LESSON_BLOCKS_FOR_LAB` (split/merge กลับ)

**Snapshot**: `SET_SNAPSHOTS`, `LOAD_SNAPSHOT`, `SET_ACTIVE_SNAPSHOT`, `MARK_SNAPSHOT_DIRTY/SAVED`, `ADD/REMOVE_SNAPSHOT_TO_LIST` + **auto-save 2 วินาที** (debounce)

**Auth/Cloud**: `SET_USER`, `SET_AUTH_TOKEN`, `LOGOUT`, `SET_CLOUD_WORKSPACES`, `SET_CLOUD_SYNCING`, `LOAD_CLOUD_WORKSPACE` (กระโดด Step 5 ถ้ามี result), `CLEAR_CLOUD_WORKSPACE`

**Cache**: `SET_CACHE_INFO`, `SET_CACHE_HINT`, `RESTORE_FROM_CACHE`

### 10.3 ฟังก์ชันสำคัญ

- **`runSolver(options)`** — หัวใจหลัก:
  1. `resolveSolverParams(solverPreset)` → `{ timeLimitSeconds, optimizationMode }`
  2. รวม payload: `fixtureData + optimization_mode + solver_time_limit_seconds`
  3. ถ้ามี `preAssignments` → map lesson_blocks: `is_fixed=true, fixed_slots=[{day,period}]`
  4. `POST /generate` → `SET_RESULT` + cache ลง IndexedDB
  5. **ข้อผิดพลาด → fallback cache**: ถ้ามี cache เก่า → ใช้ผลลัพธ์เก่า; ถ้า 422 (INFEASIBLE) → `SET_ERROR` พร้อม `errorResponse` (diagnostics) ให้ UI แสดง
- **`resumeFromCache(cacheKey)`** — โหลดงานเก่าเต็มจาก IndexedDB → Step 5
- **`setFixtureDataDirect(data)`** — ล้าง cache + placements/substitutes เก่า ก่อนตั้งข้อมูลใหม่ (กันของเก่าทับของใหม่)
- **`doSaveToCloud` / `doLoadFromCloud`** — workspace บนคลาวด์ (D1) ไม่ re-solve

---

## 11. ฟังก์ชัน Export และ Utility (Frontend)

### 11.1 Export

| ไฟล์ | ฟังก์ชันหลัก | คำอธิบาย |
|---|---|---|
| `exportEngine.js` | จัดการ pipeline export รวม (HTML → PDF/Excel/Image) | ใช้ร่วมกันทุกหน้า |
| `exportExcel.js` | `exportExcel` ฯลฯ | ส่งออกตารางเป็น .xlsx ด้วย exceljs — **round-trip safe** (นำกลับเข้าได้) |
| `exportPdf.js` | `exportMultiPagePDF(htmlParts, title)` | PDF หลายหน้า ผ่าน print dialog (html2canvas + window.print) |
| `exportImage.js` | จับภาพกริดเป็น PNG | ใช้ html2canvas |
| `exportMatrix.js` (**ใหม่**) | `buildMatrixHTML`, `exportMatrixExcel`, `exportMatrixPDF` | เมทริกซ์ครู×ห้อง — HTML inline style + ExcelJS (หัวน้ำเงิน, รวมคอลัมน์/แถว) + PDF |
| `exportTemplateExcel.js` | สร้าง template ฝั่ง frontend | เทียบเท่า backend template |

### 11.2 Utility

| ไฟล์ | ฟังก์ชัน | คำอธิบาย |
|---|---|---|
| `periods.js` | `generatePeriods`, `createDefaultBlock`, `buildClassBlockMap`, `insertBreakPeriod` | สร้างคาบเวลา, บล็อกเริ่มต้น, map class→block, แทรกพักเบรก (period_no .5) |
| `scoreCalculator.js` | `isHeavySubject`, `computeTimetableScore` (0–100), `SOLVER_PRESETS`, `getPreset`, `resolveSolverParams` | คะแนนคุณภาพตาราง (หัก: คาบว่างแทรก −2, สอนติดกัน 4+ −3, วิชาหนักคาบสุดท้าย −1.5) + preset solver |
| `teacherLoad.js` (**ใหม่**) | `computeTeacherAvailableSlots`, `computeClassAvailableSlots`, `computeNeededPerClass`, `computeNeededPerTeacher` | คำนวณช่องว่างครู/ห้อง **สะท้อน preflight backend** — ใช้ใน Step 3/5 (รายงานคาบที่ยังไม่ได้จัด) |
| `versionManager.js` | `listSnapshots`, `saveSnapshot`, `loadSnapshot`, `deleteSnapshot`, `exportToFile`, `importFromFile`, `buildSnapshot`, `generateLabel` | สแนปชอตเวอร์ชันใน localStorage (limit ~4.5MB), export/import ไฟล์ JSON |
| `cache.js` | `cacheTimetable`, `getCachedTimetable`, `getCachedMeta`, `clearCache`, `isOnline`, `formatLastSync` | IndexedDB cache + ข้อความ "ซิงก์เมื่อ..." ภาษาไทย |
| `smartDefaults.js` | ตั้งค่าเริ่มต้นอัจฉริยะ (เช่น max_consecutive ตามภาระครู) | ใช้ใน Step 3 |
| `subjectColors.js` | `getSubjectColor` | สีวิชา (MA=น้ำเงิน, TH=ชมพู, SC=เขียวเข้ม ฯลฯ) |
| `roomTypes.js` | `ROOM_TYPES`, `getRoomTypeColor`, `isSpecialRoomType` | ประเภทห้อง + สี |
| `api/client.js` | ฟังก์ชัน API ทั้งหมด + `getUserId`, `authHeaders`, `isLoggedIn` | โปรดดูหัวข้อ 4 |

---

## 12. การทดสอบ (Testing)

### Backend (pytest — `backend/`)

| ไฟล์ | ครอบคลุม |
|---|---|
| `test_solver.py` | ความถูกต้องของ solver: ไม่มี clash ครู/ห้อง/ห้องเรียน, จำนวนคาบครบ, double period ติดกัน, fixed slots, co-teaching, pre-assignment, am/pm free, consecutive limit, **preflight diagnostics** (เพิ่มเติมล่าสุด) |
| `test_api_timetables.py` | API sharing: generate-and-save, short_code, save-result, claim, my-schedules, workspace CRUD |
| `test_auth_workspace.py` | auth + workspace flow (JWT/guest) |
| `POC_TEST_REPORT.md` | รายงานผลการทดสอบ POC |

รัน: `python -m pytest backend/ -q` (จาก root)

### Frontend

- ไม่มี test framework ฝั่ง frontend — ตรวจผ่าน `npm run build` (vite build) และการใช้งานจริง
- UX review docs อยู่ใน `docs/` (ux-review-PrintStudio, ux-review-landing-page)

---

## 13. แนวทางการรวมกับระบบหลัก

### 13.1 จุดเชื่อมต่อ (Integration Points)

| ระดับ | สิ่งที่ส่งต่อ | วิธีรวม |
|---|---|---|
| **Solver core** | `backend/solver.py` + `preflight.py` + `models.py` (เฉพาะ TimetableRequest/Response/Diagnostics) | โมดูล Python อิสระ — import เข้า backend หลักได้เลย; ไม่พึ่ง FastAPI/DB (รับ `TimetableRequest` → คืน `TimetableResponse`) |
| **API contract** | `TimetableRequest` / `TimetableResponse` JSON | ใช้ schema เดียวกันทั้งสองระบบ — ฝั่งหลัก implement endpoint `/generate` หรือเรียกเป็น library |
| **Excel import** | `excel_parser.py` | คัดลอกโมดูล + mapping ฟอร์แมตเดียวกัน |
| **Data storage** | `timetable_store.py` (interface `save_timetable/get_timetable_by_short_code/get_user_schedules/claim_timetable/...`) | เปลี่ยน `get_timetable_store()` ให้คืน store ที่ผูกกับ DB หลัก (implement interface เดียวกัน) |
| **Auth** | `get_identity` / `get_optional_identity` | แทนที่ด้วย SSO/ระบบผู้ใช้ของฝั่งหลัก — ส่งต่อ `user_id` ให้ store |
| **Frontend** | wizard 7 ขั้นตอน + AppContext | รวมเป็น route/feature ในระบบหลัก หรือ embed ผ่าน iframe; สลับ `BASE_URL` (`api/config.js`) ชี้ backend หลัก |

### 13.2 ข้อควรระวัง (Gotchas) ที่สำคัญ

1. **`max_periods_per_week` เป็น soft** — solver จัดคาบให้ครบแม้เกินเพดาน แล้ว flag `load_status: "over"`; อย่าเปลี่ยนเป็น hard ในฝั่งหลักโดยไม่แจ้งผู้ใช้ (จะ INFEASIBLE)
2. **`save-result` ไม่ re-solve** — ใช้บันทึกตารางที่แก้มือแล้ว กัน INFEASIBLE จากการล็อก placement แล้วรันใหม่; ฝั่งหลักควรมี endpoint ลักษณะนี้ด้วย
3. **Pre-flight ก่อน solver เสมอ** — ถ้าข้าม จะได้ INFEASIBLE เปล่า ๆ ไม่มีคำอธิบาย
4. **`schedule_config` legacy bool ↔ mode** — ข้อมูลเก่าที่ยังใช้ bool ยังอ่านได้ (mapping ใน 3.2)
5. **`period_no` เป็น float** — break แทรกได้เป็น 3.5; โค้ดฝั่งหลักที่อ่าน period ต้องไม่สมมติว่าเป็น int
6. **D1 REST ผ่าน `D1Client`** — ถ้าฝั่งหลักใช้ ORM เดิม ต้อง implement 5–6 method ของ store (ดู `timetable_store.py`) เท่านั้น
7. **Cache/localStorage เป็น per-browser** — placement/snapshot ไม่ได้ sync ข้ามเครื่อง (ยกเว้น cloud workspace)
8. **OAuth state เก็บใน memory** — ฝั่งหลักต้องย้ายไป Redis/DB ถ้ารันหลาย instance

### 13.3 ข้อมูลที่ต้องแลกเปลี่ยน (Payload หลัก)

```
POST /generate  body = TimetableRequest {
  teachers: [{ id, name, max_periods_per_week, min_periods_per_week, unavailable_slots, admin_role, ... }],
  rooms: [{ id, name, room_type }],
  subjects: [{ id, name, category, is_heavy, time_preference }],
  classes: [{ id, name, grade_level }],
  lesson_blocks: [{ id, subject_id, teacher_id, co_teacher_id, class_id, room_id,
                    periods_per_week, is_double_period, is_fixed, fixed_slots }],
  fixed_slots: [{ id, name, slot_type, day, period, periods, class_ids }],
  schedule_blocks: [{ id, name, target_classes, days_per_week, start_time,
                      period_duration_mins, break_duration_mins, periods, ... }],
  schedule_config: { days_per_week, periods_per_day, lunch_periods, ...modes },
  solver_time_limit_seconds, optimization_mode
}
→ 200 TimetableResponse { slots[], teacher_loads[], metrics, diagnostics? }
   หรือ 422 (INFEASIBLE) พร้อม diagnostics
```

---

## 14. การ Deploy และการตั้งค่า

สรุปจาก `DEPLOYMENT.md` (ดูไฟล์เต็มสำหรับขั้นตอน)

### 14.1 Environment Variables (`backend/.env`)

| ตัวแปร | ค่าเริ่มต้น | หมายเหตุ |
|---|---|---|
| `CLOUDFLARE_ACCOUNT_ID` / `CLOUDFLARE_D1_DATABASE_ID` / `CLOUDFLARE_API_TOKEN` | ว่าง | ตั้งครบทั้ง 3 = ใช้ D1; ไม่ตั้ง = fallback ไฟล์ JSON |
| `FRONTEND_BASE_URL` | `http://localhost:5173` | ใช้สร้าง share link |
| `BACKEND_BASE_URL` | `http://localhost:8000` | ใช้สร้าง Google OAuth redirect |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | ว่าง | ตั้งครบ + JWT_SECRET = เปิด auth |
| `JWT_SECRET` | ว่าง | HS256; `python -c "import secrets; print(secrets.token_urlsafe(32))"` |
| `JWT_ALGORITHM` / `JWT_EXPIRE_DAYS` | HS256 / 30 | |

### 14.2 การรัน

```bash
# Backend
cd backend && pip install -r requirements.txt
uvicorn main:app --host 0.0.0.0 --port 8000

# Frontend
cd frontend && npm install
npm run dev        # dev (port 5173)
npm run build      # production build
```

### 14.3 D1 Schema

- `backend/schema.sql` — DDL หลัก (timetables, users)
- `backend/scripts/init_d1.sql` — init
- `backend/scripts/002_upgrade.sql` — migration (เพิ่มคอลัมน์ workspace เป็นต้น)

---

## ภาคผนวก

### A. ไฟล์ใหม่/ที่แก้ไขล่าสุด (รอบงานที่ยังไม่ commit ในขณะเขียนเอกสาร)

| ไฟล์ | ประเภท | ฟังก์ชัน |
|---|---|---|
| `frontend/src/components/verification/TeacherClassMatrix.jsx` | ใหม่ | เมทริกซ์ครู×ห้องใน VerificationStep (Step 4) |
| `frontend/src/utils/exportMatrix.js` | ใหม่ | export เมทริกซ์ครู×ห้อง (Excel/PDF) |
| `frontend/src/utils/teacherLoad.js` | ใหม่ | คำนวณช่องว่างครู/ห้อง ใช้ใน Step 3 + รายงานคาบไม่ครบ Step 5 |
| `frontend/src/pages/ScheduleBlocksStep.jsx` | แก้ไข | ตรวจคาบซ้ำกิจกรรมพิเศษ (computeSlotConflicts) |
| `frontend/src/pages/TeacherWorkloadStep.jsx` | แก้ไข | ใช้ teacherLoad.js |
| `frontend/src/pages/TimetableView.jsx` | แก้ไข | UnassignedSidebar — รายงานคาบที่ยังไม่ได้จัด |
| `frontend/src/pages/VerificationStep.jsx` | แก้ไข | ผูก TeacherClassMatrix + export |
| `backend/preflight.py` | แก้ไข | ปรับปรุงการตรวจ (สอดคล้องกับกรณีใหม่) |
| `backend/test_solver.py` | แก้ไข | เพิ่มเทสต์ครอบคลุมเคสใหม่ |

### B. คำศัพท์ไทย ↔ อังกฤษ

| ไทย | อังกฤษ |
|---|---|
| ก้อนวิชาเรียน | Lesson Block |
| คาบ | Period |
| ครูผู้สอนร่วม | Co-teacher |
| คาบตายตัว / กิจกรรมพิเศษ | Fixed Slot |
| ช่องห้ามสอน | Unavailable Slots |
| วิชาหนัก | Heavy Subject |
| ภาระงานครู | Teacher Workload / Load |
| กันคาบ (ล็อกคาบ) | Pin / Pre-assignment |
| สอนแทน | Substitute |
| ตารางบล็อกเวลา | Schedule Block |
| เงื่อนไขรวม | Global Conditions |
| ห้องพิเศษ / ห้องปฏิบัติการ | Special Room / Lab |
| คาบว่างแทรก | Idle Gap |
| ตรวจสอบก่อนจัด | Pre-flight Validation |
| ครูเกินเพดาน | Over Max Load |
