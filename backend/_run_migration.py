"""Temporary D1 migration runner — executes scripts/init_d1.sql against D1.

Usage:
    python _run_migration.py                  # runs scripts/init_d1.sql
    python _run_migration.py scripts/002_upgrade.sql  # runs a specific file

Tolerates "duplicate column name" errors so ALTER TABLE migrations are
re-runnable (SQLite doesn't support IF NOT EXISTS for ADD COLUMN).
"""
import asyncio
import sys
from pathlib import Path

from d1_service import D1Client


# Errors that are safe to ignore when re-running idempotent migrations.
_SAFE_ERROR_FRAGMENTS = (
    "duplicate column name",
    "already exists",
)


def _is_safe_error(msg: str) -> bool:
    lowered = str(msg).lower()
    return any(frag in lowered for frag in _SAFE_ERROR_FRAGMENTS)


async def main() -> int:
    client = D1Client()
    sql_path = Path(sys.argv[1]) if len(sys.argv) > 1 else (
        Path(__file__).parent.parent / "scripts" / "init_d1.sql"
    )
    sql = sql_path.read_text(encoding="utf-8")
    # Strip line comments, then split by ';'
    lines = [ln for ln in sql.split("\n") if not ln.strip().startswith("--")]
    cleaned = "\n".join(lines)
    statements = [s.strip() for s in cleaned.split(";") if s.strip()]
    print(f"Found {len(statements)} statement(s) in {sql_path.name}:")
    for i, s in enumerate(statements, 1):
        first = s.split("\n")[0][:70]
        print(f"  [{i}] {first}")
    print()
    for i, stmt in enumerate(statements, 1):
        try:
            await client.execute_query(stmt)
            print(f"  [{i}/{len(statements)}] OK")
        except Exception as e:
            if _is_safe_error(e):
                print(f"  [{i}/{len(statements)}] SKIPPED (already applied): {e}")
            else:
                print(f"  [{i}/{len(statements)}] ERROR: {e}")
                return 1
    print("Migration complete.")
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
