from __future__ import annotations

from enum import Enum
from typing import Optional

from pydantic import BaseModel, Field


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
    class_ids: list[str] = Field(
        default_factory=list,
        description="Empty list = all classes",
    )


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
    pe_hot_periods: list[str] = Field(
        default_factory=list,
        description="List of 'day-period' strings where PE should not be scheduled (hot periods)",
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
        )


TimetableResponse.model_rebuild()
