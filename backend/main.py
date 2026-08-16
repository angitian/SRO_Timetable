from __future__ import annotations

import json
import io
import functools
from pathlib import Path

from fastapi import FastAPI, HTTPException, UploadFile, File, Form
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse

from models import TimetableRequest, TimetableResponse, ScheduleTemplate
from solver import TimetableSolver
import schedule_store
from excel_parser import parse_excel, import_with_mapping, import_multi_sheet, generate_minimum_template, import_minimum_template, generate_full_template

# Maximum accepted Excel upload size: 10 MB (prevents DoS via huge files)
MAX_UPLOAD_BYTES = 10 * 1024 * 1024


def handle_excel_errors(func):
    """Decorator: converts RuntimeError → 500, other exceptions → 400.

    Eliminates the repeated try/except pattern across Excel endpoints.
    """
    @functools.wraps(func)
    async def wrapper(*args, **kwargs):
        try:
            return await func(*args, **kwargs)
        except HTTPException:
            raise  # Pass through already-formed HTTP errors
        except RuntimeError as e:
            raise HTTPException(status_code=500, detail=str(e))
        except Exception as e:
            raise HTTPException(status_code=400, detail=f"Failed to process Excel: {e}")
    return wrapper

app = FastAPI(
    title="SRO Free Timetable — POC API",
    version="0.1.0",
    description="OR-Tools CP-SAT solver for Thai school timetabling",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
async def health():
    return {"status": "ok", "solver": "OR-Tools CP-SAT"}


@app.post("/generate", response_model=TimetableResponse)
async def generate_timetable(request: TimetableRequest):
    """Generate a timetable from the given lesson blocks and constraints."""
    if not request.lesson_blocks:
        raise HTTPException(status_code=400, detail="No lesson blocks provided")
    if not request.teachers:
        raise HTTPException(status_code=400, detail="No teachers provided")
    if not request.classes:
        raise HTTPException(status_code=400, detail="No classes provided")

    solver = TimetableSolver(request)
    result = solver.solve()

    if result.metrics.status == "INFEASIBLE":
        return JSONResponse(
            status_code=422,
            content=result.model_dump(),
        )

    return result


@app.post("/generate/from-file")
async def generate_from_file(file_path: str):
    """Generate timetable from a JSON fixture file (for testing).

    Restricted to the backend/fixtures directory to prevent path traversal.
    """
    fixtures_dir = (Path(__file__).parent / "fixtures").resolve()
    path = (Path(__file__).parent / file_path).resolve()
    try:
        path.relative_to(fixtures_dir)
    except ValueError:
        raise HTTPException(
            status_code=403,
            detail="file_path must be within the fixtures directory",
        )
    if not path.exists():
        raise HTTPException(status_code=404, detail=f"File not found: {file_path}")

    data = json.loads(path.read_text(encoding="utf-8"))
    request = TimetableRequest(**data)
    solver = TimetableSolver(request)
    result = solver.solve()
    return result


# ── Schedule Config endpoints ──────────────────────────────────────────────

@app.get("/api/schedules")
async def list_schedules():
    return [s.model_dump() for s in schedule_store.list_schedules()]


@app.get("/api/schedules/{schedule_id}")
async def get_schedule(schedule_id: str):
    s = schedule_store.get_schedule(schedule_id)
    if not s:
        raise HTTPException(status_code=404, detail="Schedule not found")
    return s.model_dump()


@app.post("/api/schedules")
async def create_schedule(template: ScheduleTemplate):
    created = schedule_store.create_schedule(template)
    return created.model_dump()


@app.put("/api/schedules/{schedule_id}")
async def update_schedule(schedule_id: str, template: ScheduleTemplate):
    updated = schedule_store.update_schedule(schedule_id, template)
    if not updated:
        raise HTTPException(status_code=404, detail="Schedule not found")
    return updated.model_dump()


@app.delete("/api/schedules/{schedule_id}")
async def delete_schedule(schedule_id: str):
    deleted = schedule_store.delete_schedule(schedule_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Schedule not found")
    return {"deleted": True}


# ── Excel Import endpoints ──────────────────────────────────────────────────

@app.post("/api/import/excel/detect")
@handle_excel_errors
async def detect_excel_columns(file: UploadFile = File(...)):
    """Upload Excel file → detect columns → return preview + auto-mapping."""
    content = await file.read()
    if len(content) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail=f"File too large (max {MAX_UPLOAD_BYTES // 1024 // 1024} MB)")
    return parse_excel(content)


@app.post("/api/import/excel/import")
@handle_excel_errors
async def import_excel(
    file: UploadFile = File(...),
    mapping: str = Form(...),
):
    """Upload Excel + mapping config → import data → return teachers, subjects, classes, lesson_blocks, fixed_slots.

    Supports multi-sheet workbooks:
      - Course_Mapping (required): teacher/subject/class/lesson assignments
      - Teacher_Constraints (optional): unavailable slots, max/min periods, admin role
      - Fixed_Slots (optional): fixed activity slots
    """
    content = await file.read()
    if len(content) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail=f"File too large (max {MAX_UPLOAD_BYTES // 1024 // 1024} MB)")
    try:
        mapping_dict = json.loads(mapping)
    except json.JSONDecodeError:
        raise HTTPException(status_code=400, detail="Invalid JSON in mapping parameter")
    return import_multi_sheet(content, mapping_dict)


# ── Minimum Template endpoints ──────────────────────────────────────────────

@app.get("/api/import/excel/template")
@handle_excel_errors
async def download_minimum_template():
    """Download a minimum-data Excel template (1 sheet flat table)."""
    content = generate_minimum_template()
    return StreamingResponse(
        io.BytesIO(content),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": "attachment; filename=timetable_template_minimum.xlsx"},
    )


@app.get("/api/import/excel/template-full")
@handle_excel_errors
async def download_full_template():
    """Download a full multi-sheet Excel template (Course_Mapping + Teacher_Constraints + Fixed_Slots)."""
    content = generate_full_template()
    return StreamingResponse(
        io.BytesIO(content),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": "attachment; filename=timetable_template_full.xlsx"},
    )


@app.post("/api/import/excel/import-minimum")
@handle_excel_errors
async def import_minimum(file: UploadFile = File(...)):
    """Import a minimum-data Excel template (1 sheet flat table).

    Auto-extracts teachers, subjects, classes, and lesson_blocks.
    Rows with empty subject/classroom still import the teacher.
    """
    content = await file.read()
    if len(content) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail=f"File too large (max {MAX_UPLOAD_BYTES // 1024 // 1024} MB)")
    return import_minimum_template(content)


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=8000)
