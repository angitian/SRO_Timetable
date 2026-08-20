"""Smoke test the live timetables API against the running backend."""
import json
import urllib.request

BASE = "http://127.0.0.1:8000"


def fetch_record(code: str) -> dict:
    req = urllib.request.Request(f"{BASE}/api/v1/timetables/t/{code}")
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.loads(resp.read())


def main() -> None:
    code = "H57TTE"
    body = fetch_record(code)
    print("=== Record fetched from D1 via /t/{code} ===")
    print(f"  id:                  {body['id']}")
    print(f"  short_code:          {body['short_code']}")
    print(f"  title:               {body['title']}")
    print(f"  user_id:             {body['user_id']}")
    print(f"  academic_year:       {body['academic_year']}")
    print(f"  term:                {body['term']}")
    print(f"  is_public:           {body['is_public']}")
    print(f"  created_at:          {body['created_at']}")
    print(f"  updated_at:          {body['updated_at']}")
    print(f"  config.teachers:     {len(body['config']['teachers'])}")
    print(f"  config.classes:      {len(body['config']['classes'])}")
    print(f"  config.lesson_blocks:{len(body['config']['lesson_blocks'])}")
    print(f"  result.slots:        {len(body['result']['slots'])}")
    print(f"  result.metrics.status: {body['result']['metrics']['status']}")
    print(f"  result.teacher_loads:  {len(body['result']['teacher_loads'])}")

    # Test my-schedules without header (should 401)
    print("\n=== GET /my-schedules (no header) ===")
    try:
        req = urllib.request.Request(f"{BASE}/api/v1/timetables/my-schedules")
        urllib.request.urlopen(req, timeout=10)
        print("  ERROR: expected 401")
    except urllib.error.HTTPError as e:
        print(f"  Status: {e.code} (expected 401)")

    # Test my-schedules with header
    print("\n=== GET /my-schedules (X-User-Id: test-user) ===")
    req = urllib.request.Request(f"{BASE}/api/v1/timetables/my-schedules")
    req.add_header("X-User-Id", "test-user")
    with urllib.request.urlopen(req, timeout=10) as resp:
        print(f"  Status: {resp.status}, schedules: {json.loads(resp.read())}")

    # Test claim
    print("\n=== POST /claim (X-User-Id: test-user) ===")
    payload = json.dumps({"short_code": code}).encode("utf-8")
    req = urllib.request.Request(
        f"{BASE}/api/v1/timetables/claim",
        data=payload,
        headers={"Content-Type": "application/json", "X-User-Id": "test-user"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=10) as resp:
        body = json.loads(resp.read())
        print(f"  Status: {resp.status}")
        print(f"  user_id after claim: {body['user_id']}")

    # Verify my-schedules now returns 1
    print("\n=== GET /my-schedules after claim ===")
    req = urllib.request.Request(f"{BASE}/api/v1/timetables/my-schedules")
    req.add_header("X-User-Id", "test-user")
    with urllib.request.urlopen(req, timeout=10) as resp:
        schedules = json.loads(resp.read())
        print(f"  Status: {resp.status}, count: {len(schedules)}")
        if schedules:
            print(f"  First schedule: {schedules[0]['short_code']} (user_id={schedules[0]['user_id']})")


if __name__ == "__main__":
    import urllib.error
    main()
