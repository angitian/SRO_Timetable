from __future__ import annotations

from enum import Enum
from typing import Optional

from pydantic import BaseModel, Field, field_validator


# ── Enums ──────────────────────────────────────────────────────────────────

class SubjectCategory(str, Enum):
    CORE = "core"
    PE = "pe"
    ART = "art"
    MUSIC = "music"
    LAB = "lab"
    ADMIN = "admin"


class FixedSlotType(str, Enum):
    ASSEMBLY = "assembly"
    GUIDANCE = "guidance"
    CLUB = "club"
    HOMEROOM = "homeroom"
    SCOUT = "scout"
    ROTC = "rotc"
    ACTIVITY = "activity"
    OTHER = "other"


class PeriodType(str, Enum):
    STUDY = "STUDY"
    LUNCH = "LUNCH"
    BREAK = "BREAK"


class AdminRole(str, Enum):
    NONE = "none"
    FINANCE = "finance"
    DISCIPLINE = "discipline"
    DEPT_HEAD = "dept_head"


class OptimizationMode(str, Enum):
    FAST = "FAST"
    BALANCED = "BALANCED"
    DEEP = "DEEP"


# ── Input models ───────────────────────────────────────────────────────────

class Teacher(BaseModel):
    id: str
    name: str
    teacher_type: str = Field(
        default="regular",
        description="Type of teacher: 'regular' | 'special' | 'foreign' | 'trainee' (นศ.ฝึกสอน). Display-only — solver treats all equally.",
    )
    max_periods_per_week: int = Field(default=30, ge=0)
    min_periods_per_week: int = Field(default=0, ge=0)
    unavailable_slots: list[str] = Field(
        default_factory=list,
        description="List of 'day-period' strings, e.g. ['1-7','2-8']",
    )
    admin_role: AdminRole = Field(
        default=AdminRole.NONE,
        description="T4/T5: Administrative role requiring protected free slots",
    )
    admin_free_slots: list[str] = Field(
        default_factory=list,
        description="T4: 'day-period' strings that must be free for admin duties",
    )
    no_first_period: bool = Field(
        default=False,
        description="Hard filter: teacher cannot teach in the first period of the day",
    )
    no_last_period: bool = Field(
        default=False,
        description="Hard filter: teacher cannot teach in the last period of the day",
    )
    max_consecutive_teaching: int = Field(
        default=0,
        ge=0,
        le=8,
        description="Per-teacher max consecutive teaching periods (0 = use global default)",
    )
    enable_consecutive_limit: bool = Field(
        default=True,
        description="Toggle on/off the consecutive teaching limit soft constraint",
    )
    is_consecutive_customized: bool = Field(
        default=False,
        description="Flag: True if user manually selected N (otherwise smart default is used)",
    )
    spread_free_periods: bool = Field(
        default=False,
        description="Soft constraint: teacher should have >=1 free period in the morning AND >=1 free period in the afternoon each day (opt-in)",
    )


class Room(BaseModel):
    id: str
    name: str
    room_type: str = Field(default="classroom")


class Subject(BaseModel):
    id: str
    name: str
    category: SubjectCategory = SubjectCategory.CORE
    is_heavy: bool = Field(
        default=False,
        description="S2: Heavy subjects (math, physics, English) preferred in morning slots",
    )
    time_preference: str = Field(
        default="any",
        description="Soft preference for scheduling time: 'any' | 'morning' | 'afternoon'",
    )


class ClassGroup(BaseModel):
    id: str
    name: str
    grade_level: int = Field(ge=1, le=12)


class FixedSlotAssignment(BaseModel):
    """A single pre-assigned (day, period) slot for a lesson block.

    Multiple FixedSlotAssignment entries on one LessonBlock allow the user
    to manually pin several periods of a multi-period lesson block before
    invoking the solver for the remaining periods.
    """
    day: int = Field(ge=1, le=7)
    period: int = Field(ge=1, le=12)


class LessonBlock(BaseModel):
    id: str
    subject_id: str
    teacher_id: str
    co_teacher_id: Optional[str] = Field(
        default=None,
        description="Co-teacher (second teacher) teaching simultaneously, e.g. MEP Thai+foreign teacher",
    )
    class_id: str
    room_id: Optional[str] = None
    periods_per_week: int = Field(ge=1, le=10)
    is_double_period: bool = False
    is_fixed: bool = False
    fixed_day: Optional[int] = Field(default=None, ge=1, le=5)
    fixed_period: Optional[int] = Field(default=None, ge=1, le=10)
    fixed_slots: list[FixedSlotAssignment] = Field(
        default_factory=list,
        description="Multi-slot pre-assignment list. When non-empty, takes precedence over the legacy single fixed_day/fixed_period fields.",
    )
    block_id: Optional[str] = Field(default=None, description="Schedule block this lesson belongs to (auto-derived from class)")


class FixedSlot(BaseModel):
    id: str
    name: str
    slot_type: FixedSlotType
    day: int = Field(ge=1, le=5)
    period: int = Field(ge=1, le=10)
    periods: list[int] = Field(
        default_factory=list,
        description="Additional consecutive/specific periods in the same day (period stays as the first period for backward compat). Effective periods = sorted(union([period] + periods)).",
    )
    class_ids: list[str] = Field(
        default_factory=list,
        description="Empty list = all classes",
    )
    class_teachers: dict[str, list[str]] = Field(
        default_factory=dict,
        description="ครูผู้ดูแลกิจกรรมรายชั้น: { class_id: [teacher_id, ...] } — รองรับหลายครูต่อห้อง; ครูทุกคนที่เข้าร่วมนับภาระ 1 คาบ/สัปดาห์ (ไม่คูณจำนวนห้อง)",
    )

    @field_validator("class_teachers", mode="before")
    @classmethod
    def _normalize_class_teachers(cls, v):
        """Backward compat: ข้อมูลเก่า { class_id: teacher_id } (string) → [teacher_id]."""
        if not v:
            return {}
        out: dict[str, list[str]] = {}
        for key, val in v.items():
            if isinstance(val, str):
                out[key] = [val] if val.strip() else []
            elif isinstance(val, list):
                out[key] = [x for x in val if isinstance(x, str) and x.strip()]
            else:
                out[key] = []
        return out

    def effective_periods(self) -> list[int]:
        """Return the sorted list of all periods this fixed slot occupies."""
        return sorted(set([self.period, *self.periods]))

    def supervisor_teacher_ids(self) -> set[str]:
        """Unique teacher ids supervising this fixed slot (flattened from class_teachers lists)."""
        ids: set[str] = set()
        for val in (self.class_teachers or {}).values():
            if isinstance(val, str):
                ids.add(val)
            else:
                ids.update(v for v in val if v)
        return ids


class SubjectTimeRule(BaseModel):
    """A user-defined rule pinning a specific subject to a half of the day.

    Used by the 'วิชาเฉพาะช่วงเวลา' section of the Global Conditions UI.
    """
    subject_id: str
    preference: str = Field(default="morning", description="'morning' | 'afternoon' — the half this subject should be scheduled in")
    mode: str = Field(default="soft", description="'soft' (penalty) | 'hard' (constraint) | 'off' (disabled)")


class ScheduleConfig(BaseModel):
    days_per_week: int = Field(default=5, ge=1, le=7)
    periods_per_day: int = Field(default=8, ge=1, le=12)
    lunch_periods: list[int] = Field(
        default_factory=lambda: [4],
        description="1-indexed period numbers that are lunch/break (no teaching)",
    )
    assembly_slots: list[str] = Field(
        default_factory=list,
        description="List of 'day-period' strings reserved for assembly",
    )
    max_consecutive_teaching: int = Field(
        default=4,
        ge=1,
        le=8,
        description="Soft constraint: max consecutive periods a teacher can teach",
    )
    default_max_periods_per_week: int = Field(
        default=22,
        ge=0,
        le=60,
        description="Default max_periods_per_week used for NEW teachers / imports / fallbacks (editable in Global Conditions UI)",
    )
    pe_hot_periods: list[str] = Field(
        default_factory=list,
        description="List of 'day-period' strings where PE should not be scheduled (hot periods)",
    )
    am_pm_free_mode: str = Field(
        default="off",
        description="Global '1 free morning + 1 free afternoon' per day: 'off' | 'soft' | 'hard'. Applies to all teachers; per-teacher spread_free_periods is used only when this is 'off'.",
    )
    max_consecutive_mode: str = Field(
        default="soft",
        description="Max consecutive teaching mode: 'off' | 'soft' | 'hard'",
    )
    subject_day_spacing_mode: str = Field(
        default="soft",
        description="S1 mode: 'off' | 'soft' | 'hard' (legacy bool enable_subject_day_spacing = soft when True, off when False)",
    )
    heavy_morning_mode: str = Field(
        default="soft",
        description="S2 mode: 'off' | 'soft' | 'hard' (legacy bool enable_heavy_morning = soft when True, off when False)",
    )
    workload_balance_mode: str = Field(
        default="soft",
        description="Elastic workload balance mode: 'off' | 'soft' (legacy bool enable_workload_balance)",
    )
    gap_clustering_mode: str = Field(
        default="soft",
        description="Teacher gap clustering mode (DEEP): 'off' | 'soft' (legacy bool enable_gap_clustering)",
    )
    # Legacy bool fields (kept for backward compat with old fixtures/UI)
    enable_subject_day_spacing: bool = Field(
        default=True,
        description="LEGACY: prefer not scheduling the same lesson block on consecutive days",
    )
    enable_heavy_morning: bool = Field(
        default=True,
        description="LEGACY: prefer heavy subjects in morning periods",
    )
    enable_workload_balance: bool = Field(
        default=True,
        description="LEGACY: spread a teacher's daily load evenly across days",
    )
    enable_gap_clustering: bool = Field(
        default=True,
        description="LEGACY: DEEP — cluster a teacher's periods to minimize idle gaps",
    )
    subject_time_rules: list[SubjectTimeRule] = Field(
        default_factory=list,
        description="User-defined subject time preference rules (วิชาเฉพาะช่วงเวลา)",
    )


class PeriodDefinition(BaseModel):
    period_num: int = Field(ge=1, le=12)
    start_time: str = Field(description="HH:MM format")
    end_time: str = Field(description="HH:MM format")
    period_type: str = Field(default="teaching", description="teaching|break|lunch|assembly|activity")
    label: Optional[str] = None


class SpecialDay(BaseModel):
    day_of_week: int = Field(ge=1, le=7)
    day_type: str = Field(default="half_day", description="half_day|full_day_off|activity_day")
    label: Optional[str] = None
    max_periods: Optional[int] = None


class GradeActivity(BaseModel):
    grade_level: int = Field(ge=1, le=12)
    activity_name: str
    activity_type: str = Field(default="scout", description="scout|rotc|club|homeroom|assembly|guidance")
    day_of_week: int = Field(ge=1, le=7)
    period_num: int = Field(ge=1, le=12)


class ScheduleTemplate(BaseModel):
    id: Optional[str] = None
    name: str
    description: Optional[str] = None
    days_per_week: int = Field(default=5, ge=1, le=7)
    periods_per_day: int = Field(default=8, ge=1, le=12)
    lunch_periods: list[int] = Field(default_factory=lambda: [4])
    period_definitions: list[PeriodDefinition] = Field(default_factory=list)
    grade_levels: list[int] = Field(default_factory=list, description="Grade levels mapped to this template")
    special_days: list[SpecialDay] = Field(default_factory=list)
    grade_activities: list[GradeActivity] = Field(default_factory=list)
    is_preset: bool = False
    is_active: bool = True


class SchedulePeriod(BaseModel):
    # period_no supports decimals (e.g. 3.5) for inserted short breaks
    # that don't shift existing STUDY/LUNCH period numbers.
    period_no: float = Field(ge=0.5, le=12)
    start_time: str = Field(description="HH:MM format")
    end_time: str = Field(description="HH:MM format")
    type: PeriodType = Field(default=PeriodType.STUDY)


class ScheduleBlock(BaseModel):
    id: str
    name: str
    target_classes: list[str] = Field(default_factory=list, description="Class IDs mapped to this block")
    days_per_week: int = Field(default=5, ge=1, le=7)
    start_time: str = Field(default="08:30", description="HH:MM start of first period")
    period_duration_mins: int = Field(default=50, ge=10, le=120)
    break_duration_mins: int = Field(default=10, ge=5, le=60)
    periods: list[SchedulePeriod] = Field(default_factory=list)
    apply_to_all_days: bool = Field(default=True)
    periods_by_day: dict[str, list[SchedulePeriod]] = Field(default_factory=dict, description="Day number (1-indexed) to periods mapping when apply_to_all_days=False")


class TimetableRequest(BaseModel):
    teachers: list[Teacher]
    rooms: list[Room]
    subjects: list[Subject]
    classes: list[ClassGroup]
    lesson_blocks: list[LessonBlock]
    fixed_slots: list[FixedSlot] = Field(default_factory=list)
    schedule_blocks: list[ScheduleBlock] = Field(default_factory=list)
    schedule_config: ScheduleConfig = Field(default_factory=ScheduleConfig, description="Legacy single-block config (used if schedule_blocks is empty)")
    solver_time_limit_seconds: float = Field(default=2.0, ge=0.5, le=120.0)
    optimization_mode: OptimizationMode = Field(
        default=OptimizationMode.BALANCED,
        description="FAST: stop at first feasible solution; BALANCED: optimize soft constraints within time limit",
    )


# ── Output models ──────────────────────────────────────────────────────────

class ScheduledSlot(BaseModel):
    lesson_block_id: str
    day: int
    period: int
    subject_id: str
    teacher_id: str
    class_id: str
    room_id: Optional[str] = None


class TeacherLoadSummary(BaseModel):
    teacher_id: str
    teacher_name: str
    assigned_periods: int
    max_periods: int
    min_periods: int
    load_status: str  # "ok" | "over" | "under"


class SolverMetrics(BaseModel):
    status: str  # "OPTIMAL" | "FEASIBLE" | "INFEASIBLE" | "UNKNOWN"
    objective_value: float
    wall_time_seconds: float
    num_variables: int
    num_constraints: int
    hard_violations: int
    soft_violations: int


class TimetableResponse(BaseModel):
    slots: list[ScheduledSlot]
    teacher_loads: list[TeacherLoadSummary]
    metrics: SolverMetrics
    diagnostics: Optional["DiagnosticsReport"] = None


# ── Diagnostics (pre-flight validation) ────────────────────────────────────

class TeacherOverload(BaseModel):
    teacher_id: str
    teacher_name: str
    needed_periods: int
    available_slots: int
    max_periods_per_week: int
    min_periods_per_week: int
    reason: str  # "over_max" | "over_available" | "under_min"


class RoomOverload(BaseModel):
    room_id: str
    room_name: str
    needed_periods: int
    available_slots: int


class FixedSlotConflict(BaseModel):
    lesson_block_id: str
    day: int
    period: int
    reason: str  # "teacher_unavailable" | "lunch" | "assembly" | "no_pair_slot" | "class_blocked"


class ClassCapacityIssue(BaseModel):
    class_id: str
    class_name: str
    needed_periods: int
    available_slots: int
    overflow: int  # needed - available (positive when over capacity)


class DiagnosticsReport(BaseModel):
    teacher_overloads: list[TeacherOverload] = Field(default_factory=list)
    room_overloads: list[RoomOverload] = Field(default_factory=list)
    fixed_slot_conflicts: list[FixedSlotConflict] = Field(default_factory=list)
    class_capacity_issues: list[ClassCapacityIssue] = Field(default_factory=list)
    hard_rule_issues: list[str] = Field(
        default_factory=list,
        description="Human-readable reasons why a HARD global rule is provably impossible",
    )
    notes: list[str] = Field(default_factory=list)

    def has_blocking_issues(self) -> bool:
        # `over_max` (teacher's lesson load exceeds max_periods_per_week) is
        # treated as a NON-blocking warning: the solver enforces max as a soft
        # constraint and will still place the teacher's lessons, surfacing a
        # warning via TeacherLoadSummary.load_status == "over". Other overload
        # reasons (over_available, under_min) remain blocking because they
        # indicate a physically impossible situation.
        blocking_teacher_overloads = [
            t for t in self.teacher_overloads if t.reason != "over_max"
        ]
        # class_capacity_issues: a class has more lesson periods than available
        # slots. The solver treats period_count as a soft constraint (<= with
        # penalty), so it will place as many periods as possible and surface
        # a warning. Non-blocking so the user still gets a partial timetable.
        return bool(
            blocking_teacher_overloads
            or self.room_overloads
            or self.fixed_slot_conflicts
            or self.hard_rule_issues
        )


TimetableResponse.model_rebuild()


# ── Timetable sharing / D1 storage models ───────────────────────────────────

class GenerateAndSaveRequest(BaseModel):
    """Request body for POST /api/v1/timetables/generate-and-save.

    Wraps a full `TimetableRequest` (the solver input) plus metadata that gets
    stored alongside the generated result in the timetables table.
    """
    title: str = Field(description="Human-readable label, e.g. school name")
    academic_year: int = Field(ge=1900, le=3000)
    term: int = Field(ge=1, le=3, description="1 = first semester, 2 = second, 3 = summer")
    config: TimetableRequest
    is_public: bool = Field(default=True, description="If False, the short_code link won't resolve")


class SaveResultRequest(BaseModel):
    """Request body for POST /api/v1/timetables/save-result.

    Persists a pre-solved (or manually edited) timetable WITHOUT re-running the
    solver. The frontend sends the exact slots currently displayed on screen
    (solver slots ∪ manual placements, deduplicated) so the public viewer
    matches the printed page 1:1. Avoids the INFEASIBLE failure mode that
    arises when locking user-edited placements and re-solving.
    """
    title: str = Field(description="Human-readable label, e.g. school name")
    academic_year: int = Field(ge=1900, le=3000)
    term: int = Field(ge=1, le=3, description="1 = first semester, 2 = second, 3 = summer")
    config: TimetableRequest
    result: TimetableResponse
    is_public: bool = Field(default=True, description="If False, the short_code link won't resolve")


class ClaimTimetableRequest(BaseModel):
    """Request body for POST /api/v1/timetables/claim."""
    short_code: str = Field(min_length=1, max_length=32)


class TimetableRecord(BaseModel):
    """A stored timetable row, returned by GET /t/{short_code} and /my-schedules."""
    id: str
    short_code: str
    user_id: Optional[str] = None
    title: str
    academic_year: int
    term: int
    config: Optional[dict] = None
    result: Optional[dict] = None
    workspace: Optional[dict] = None
    is_public: bool = True
    created_at: Optional[str] = None
    updated_at: Optional[str] = None


class TimetableSaveResult(BaseModel):
    """Response for POST /api/v1/timetables/generate-and-save."""
    id: str
    short_code: str
    share_url: str
    title: str
    academic_year: int
    term: int


# ── User / auth models ───────────────────────────────────────────────────────

class User(BaseModel):
    """A user record (stored in the `users` table, keyed by google_sub)."""
    id: str
    email: str = ""
    name: str = ""
    picture: Optional[str] = None
    created_at: Optional[str] = None
    updated_at: Optional[str] = None


# ── Workspace save/load models ───────────────────────────────────────────────

class WorkspaceSaveRequest(BaseModel):
    """Request body for POST /api/v1/timetables/save-workspace.

    Unlike `GenerateAndSaveRequest`, this does NOT re-run the solver — it stores
    the full workspace (fixtureData + result + userPlacements + solverPreset)
    so loading it back restores the exact state the user left at.
    """
    id: Optional[str] = Field(default=None, description="If set, update existing; else create new")
    title: str
    academic_year: int = Field(ge=1900, le=3000)
    term: int = Field(ge=1, le=3)
    workspace: dict = Field(description="Full workspace payload (fixtureData, result, userPlacements, ...)")


class WorkspaceSaveResult(BaseModel):
    """Response for POST /save-workspace."""
    id: str
    title: str
    updated_at: Optional[str] = None


class MergeGuestRequest(BaseModel):
    """Request body for POST /api/v1/timetables/merge-guest."""
    device_id: str = Field(min_length=1, description="Guest device id to merge into the authenticated user")
