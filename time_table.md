🛠️ System Specification & AI IDE Prompt: SRO Free TimetableInstruction for AI IDE (Cursor / Windsurf / Claude Dev):You are tasked with building the SRO Free Timetable application. This document contains the exact architecture, data models, logic constraints, API specifications, and step-by-step instructions. Please strictly follow this specification to implement the MVP without introducing out-of-scope features.📌 1. Project Overview & Scope ControlProduct Name: SRO Free TimetableGoal: A zero-friction, browser-based timetable generator that uses deterministic constraint optimization (Google OR-Tools) to help Thai school academic officers schedule timetables effortlessly.Key Positioning: Free Utility Tool & Acquisition Channel for One Man Lab / SRO Platform.🚫 STRICTLY OUT OF SCOPE (DO NOT IMPLEMENT)NO LLM / AI Chatbot / Natural Language scheduling.NO Attendance tracking, Gradebook, LMS, or Student Management features.NO Paid subscriptions, Payment gateways, or intrusive Ad Banners.🏗️ 2. Tech Stack & Architecture[ Frontend (Next.js 14+ App Router + Tailwind CSS) ]
       │
       ├─► Local State & Offline Caching (IndexedDB / LocalStorage)
       │
       ▼ (REST API)
[ Backend Microservice (FastAPI + Python 3.11) ]
       │
       ├─► Google OR-Tools (CP-SAT Solver)
       │
       ▼ (Database)
[ PostgreSQL / Supabase ]
🗄️ 3. Database Schema (PostgreSQL / Supabase)-- 1. Schools Table
CREATE TABLE schools (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    slug VARCHAR(100) UNIQUE NOT NULL,
    schedule_version VARCHAR(50) DEFAULT 'v1',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Teachers Table
CREATE TABLE teachers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    school_id UUID REFERENCES schools(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    short_name VARCHAR(50),
    max_consecutive_periods INT DEFAULT 3
);

-- 3. Classrooms Table
CREATE TABLE classrooms (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    school_id UUID REFERENCES schools(id) ON DELETE CASCADE,
    name VARCHAR(100) NOT NULL, -- e.g., "ม.1/1", "ป.5/1"
    grade_level INT
);

-- 4. Subjects Table
CREATE TABLE subjects (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    school_id UUID REFERENCES schools(id) ON DELETE CASCADE,
    code VARCHAR(50) NOT NULL, -- e.g., "ค15101"
    name VARCHAR(255) NOT NULL,
    requires_facility VARCHAR(100) DEFAULT NULL -- e.g., "lab", "computer_room"
);

-- 5. Lesson Blocks (The Core Atom)
CREATE TABLE lesson_blocks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    school_id UUID REFERENCES schools(id) ON DELETE CASCADE,
    teacher_id UUID REFERENCES teachers(id),
    classroom_id UUID REFERENCES classrooms(id),
    subject_id UUID REFERENCES subjects(id),
    periods_per_week INT NOT NULL DEFAULT 1,
    is_double_period BOOLEAN DEFAULT FALSE,
    fixed_day INT DEFAULT NULL,    -- 1 (Mon) - 5 (Fri)
    fixed_period INT DEFAULT NULL -- 1 - 8
);

-- 6. Timetables Matrix (Published Schedule)
CREATE TABLE timetables (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    school_id UUID REFERENCES schools(id) ON DELETE CASCADE,
    academic_year VARCHAR(10) DEFAULT '2569',
    semester INT DEFAULT 1,
    lesson_block_id UUID REFERENCES lesson_blocks(id),
    classroom_id UUID REFERENCES classrooms(id),
    teacher_id UUID REFERENCES teachers(id),
    subject_id UUID REFERENCES subjects(id),
    day_of_week INT NOT NULL,  -- 1 to 5
    period_number INT NOT NULL -- 1 to 8
);
⚙️ 4. Backend Solver Engine Specification (FastAPI + Google OR-Tools)The optimization engine must be built using ortools.sat.python.cp_model.4.1 Decision VariableDefine a 4D Boolean Decision Matrix $X[c, t, d, p] \in \{0, 1\}$:$c$: Classroom ID$t$: Teacher ID$d$: Day of Week (1..5)$p$: Period Number (1..8)4.2 Hard Constraints Implementation (Python)from ortools.sat.python import cp_model

def build_timetable_model(classrooms, teachers, lesson_blocks, days=5, periods=8):
    model = cp_model.CpModel()
    X = {}

    # Define Variables
    for c in classrooms:
        for t in teachers:
            for d in range(1, days + 1):
                for p in range(1, periods + 1):
                    X[c, t, d, p] = model.NewBoolVar(f'x_{c}_{t}_{d}_{p}')

    # Rule 1: One Teacher cannot teach more than 1 class per period
    for t in teachers:
        for d in range(1, days + 1):
            for p in range(1, periods + 1):
                model.Add(sum(X[c, t, d, p] for c in classrooms) <= 1)

    # Rule 2: One Classroom cannot have more than 1 subject per period
    for c in classrooms:
        for d in range(1, days + 1):
            for p in range(1, periods + 1):
                model.Add(sum(X[c, t, d, p] for t in teachers) <= 1)

    # Rule 3: Fulfill Lesson Block Requirements
    for block in lesson_blocks:
        c = block['classroom_id']
        t = block['teacher_id']
        required_periods = block['periods_per_week']
        
        model.Add(
            sum(X[c, t, d, p] for d in range(1, days + 1) for p in range(1, periods + 1)) 
            == required_periods
        )

        # Fixed Slots (e.g., Homeroom / Scout)
        if block.get('fixed_day') and block.get('fixed_period'):
            model.Add(X[c, t, block['fixed_day'], block['fixed_period']] == 1)

    # Solve
    solver = cp_model.CpSolver()
    solver.parameters.max_time_in_seconds = 5.0
    status = solver.Solve(model)

    return solver, status, X
📡 5. API Endpoint Specifications1. POST /api/v1/schedule/generatePurpose: Runs OR-Tools to calculate an initial feasible schedule.Payload: JSON array of Teachers, Classrooms, Subjects, and LessonBlocks.Response: Feasible 3D Matrix Mapping [{ classroom_id, teacher_id, subject_id, day, period }].2. POST /api/v1/schedule/validate-movePurpose: Calculates Candidate Highlighting and Conflict Explanation for Drag & Drop.Payload: { target_block_id, current_day, current_period }Response:{
  "candidate_slots": [
    { "day": 1, "period": 2, "status": "AVAILABLE" },
    { "day": 1, "period": 3, "status": "BLOCKED", "reason": "Teacher Somchai is teaching M.2/1" },
    { "day": 2, "period": 1, "status": "BLOCKED", "reason": "Computer Lab is occupied" }
  ]
}
3. GET /api/v1/public/schedule/:school_slug/versionPurpose: Version check for Client-side IndexedDB caching.Response: { "version": "v_1723420800" }🎨 6. Frontend Specification & UX Logic (Next.js)6.1 Interactive Grid & Candidate Highlighting (Drag & Drop)When a user clicks or begins dragging a Lesson Block:Send validate-move query or compute Client-side against the cached matrix.Render the Grid with visual indicators:🟢 Green Slot (status == "AVAILABLE"): Droppable slot.⚪ Gray/White Slot (status == "BLOCKED"): Non-droppable slot.Hovering/Clicking a ⚪ slot opens a Tooltip/Popover showing the exact Conflict Explanation string.6.2 Anonymous Trial & Conversion FlowUnauthenticated User: Can enter data, run Auto-Schedule, drag/drop blocks, and view Candidate Highlighting in-memory.Save / Export / Publish Action: Triggers a Modal:"Log in for free to Save your Timetable, Export A4 PDF, and generate a Public QR Code link!"6.3 Public Viewer & Client CachingURL: /s/:school_slug (No Login Required)Tabs: [ 🏫 View by Classroom ] and [ 👨‍🏫 View by Teacher ]Offline-First Logic:Load timetable matrix from IndexedDB instantly (0.01s).Background fetch /version. If mismatched, fetch new JSON and update IndexedDB.6.4 Soft CTA / Product CreditAt the bottom of the Public Schedule Viewer & Exported PDF:┌─────────────────────────────────────────────────────────────┐
│ ⚡ Free Timetable Engine by One Man Lab                      │
│ Want to connect this timetable with AI GPAS 5 Lesson Plans?  │
│ 👉 [ Try KRU Platform for Free ]                            │
└─────────────────────────────────────────────────────────────┘
🚦 7. AI IDE Implementation InstructionsExecute the implementation in the following sequential steps:Step 1: Set up Project StructureNext.js (TypeScript, Tailwind CSS, Lucide Icons).FastAPI Python App with google-ortools, pydantic, and uvicorn.Step 2: Database & Models SetupCreate Prisma/Drizzle schema or raw SQL tables as specified in Section 3.Define TypeScript interfaces matching the Database schema.Step 3: Implement Backend Optimization EngineCreate solver.py inside FastAPI implementing build_timetable_model().Ensure it returns JSON matrix with OPTIMAL or FEASIBLE status within 5 seconds.Step 4: Implement Frontend Timetable Grid ComponentCreate interactive $5 \times 8$ Grid (Monday - Friday, Periods 1 - 8).Add Filter dropdown for Classroom (classrooms) and Teacher (teachers).Step 5: Implement Candidate Highlighting & Conflict TooltipsAdd interactive event handlers on Block click/drag to compute matrix availability.Render 🟢 Green and ⚪ Gray slots with Tooltips explaining conflicts.Step 6: Add IndexedDB Client-Side Caching & Version SyncUse idb or native IndexedDB API to store published timetable matrices locally.Implement Version Hash check on page load.Step 7: Add Soft CTA BannerInsert the One Man Lab / KRU Platform redirection credit banner on the Public View footer.