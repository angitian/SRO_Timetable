# Deployment Guide — SRO Timetable

ระบบ deploy 2 ส่วน: **Render** (backend FastAPI) + **Cloudflare Workers** (frontend Vite SPA)

## Production Account Map (สถานะจริง ณ 2026-10-22)

| ส่วน | Account | รายละเอียด |
|---|---|---|
| GitHub repo | `angitian` | `angitian/SRO_Timetable`, branch `main` |
| Frontend | Cloudflare acct `angitian02@gmail...` | Worker `sro-timetable` (workers.dev: `sro-timetable.angitian02.workers.dev`) — **ชื่อจริงต่างจาก `wrangler.toml`** (`sro-timetable-frontend`) เพราะสร้างผ่าน dashboard git integration |
| Custom domain | Cloudflare เดียวกัน | `timetable.kru-platform.com` (zone `kru-platform.com` อยู่ acct นี้) |
| D1 database | Cloudflare เดียวกัน | `kru-timetable-db` (id `f4f9b107-8cf5-4c8f-a340-4f5ef9106736`) — ชื่อจริง ไม่ใช่ `sro-timetable-db` |
| Backend | Render acct ที่ผูก GitHub `angitian` | `sro-timetable-2.onrender.com` — **active ตั้งแต่ 2026-10-22** (เดิม `sro-timetable.onrender.com` อยู่ acct ที่เข้าไม่ได้ → orphan, ไม่มี traffic แล้ว) |
| Google OAuth | Google Cloud Console | OAuth client เดิม — redirect URIs มีทั้ง backend เก่าและใหม่ (`google_sub` คงเดิม user เห็นของเดิม) |

---

## สถาปัยร overall

```
GitHub (main) ─┬─► Render (backend)        FastAPI + uvicorn
               │     URL: https://<app>.onrender.com
               │
               └─► Cloudflare Workers (frontend)  Vite build → static assets
                     URL: https://<app>.workers.dev
                     ยิง API ไป Render ผ่าน VITE_API_URL
```

Auto-Deploy ทั้งคู่ trigger เมื่อ push ไป branch `main`

---

## 1. Backend — Render

### Config (ตั้งที่ Render dashboard)

| ฟิลด์ | ค่า |
|---|---|
| Root directory | `backend` |
| Build Command | `pip install -r requirements.txt` |
| Start Command | `uvicorn main:app --host 0.0.0.0 --port $PORT` |
| Auto-Deploy | On Commit (branch `main`) |

### ตรวจสอบหลัง deploy

- `GET https://<app>.onrender.com/health` → 200 `{"status":"ok"}`
- `GET https://<app>.onrender.com/docs` → Swagger UI

### ข้อจำกัดสำคัญ

⚠️ **Render filesystem เป็น ephemeral** — `backend/data/schedules.json` จะหายทุกครั้งที่ redeploy
   - schedule CRUD จะ reset กลับเป็น presets (จาก `schedule_store.py`)
   - ถ้าต้องการ persist จริง ต้องเชื่อม PostgreSQL (มี `schema.sql` อยู่แล้วใน repo — เป็นงานแยก)

⚠️ **CORS เปิด `allow_origins=["*"]`** — เหมาะกับ POC แต่ production จริงควรจำกัดเป็นโดเมนของ Cloudflare

---

## 2. Frontend — Cloudflare Workers

### Config (ตั้งที่ Cloudflare dashboard)

| ฟิลด์ | ค่า |
|---|---|
| Root directory | `frontend` |
| Build command | `npm run build` |
| Deploy command | `npx wrangler deploy` |
| Version command | `npx wrangler versions upload` |
| Production branch | `main` |

### Environment Variables (ตั้งก่อน build ครั้งแรก!)

⚠️ **ต้องตั้งก่อน push ครั้งแรก** — Vite embed env var ตอน build time ถ้าไม่ตั้ง จะใช้ fallback `http://127.0.0.1:8000` ซึ่งพังใน production

| Variable | Value |
|---|---|
| `VITE_API_URL` | `https://<your-render-app>.onrender.com` |

### ไฟล์ config ใน repo

- `frontend/wrangler.toml` — config สำหรับ `wrangler deploy` (assets-only Worker + SPA fallback)
- `frontend/.env.example` — template env var สำหรับ dev local
- `frontend/src/api/config.js` — จุดเดียวที่อ่าน `VITE_API_URL` แล้ว export `BASE_URL`

### ตรวจสอบหลัง deploy

- เปิด site → DevTools → Network → ดูว่า request ไปยัง Render URL **ไม่ใช่** `127.0.0.1:8000`
- ทดสอบ 3 ฟังก์ชันที่ใช้ `BASE_URL`:
  1. ดาวน์โหลด Excel template (LandingPage / DataIngestionStep)
  2. Import Excel (DataIngestionStep / DataPrepStep / ExcelImportPage)
  3. Generate timetable (api/client.js → `/generate`)
- ทดสอบ SPA route: เปิด `/view?d=1&p=1` → ไม่ 404 (wrangler.toml ตั้ง SPA fallback ไว้)

---

## 3. ขั้นตอน Deploy ครั้งแรก

1. **ตั้ง Render service** ตาม config ด้านบน → deploy ครั้งแรกให้ผ่าน → จด URL (`https://xxx.onrender.com`)
2. **ตั้ง Cloudflare Workers** ตาม config ด้านบน
3. **ตั้ง env var `VITE_API_URL`** ที่ Cloudflare dashboard = Render URL จากข้อ 1
4. **Push โค้ดขึ้น GitHub** (branch `main`) → ทั้งสอง auto-deploy
5. ตรวจสอบตาม checklist ด้านบน

## 4. Deploy ครั้งถัดไป

แค่ push ไป `main` — Auto-Deploy ทำงานอัตโนมัติ

---

## 5. ทดสอบ local ก่อน push

```powershell
# terminal 1 — backend (port 8000)
powershell -ExecutionPolicy Bypass -File scripts/dev-backend.ps1

# terminal 2 — frontend (http://localhost:5173)
powershell -ExecutionPolicy Bypass -File scripts/dev-frontend.ps1
```

หรือรันตรง ๆ (ต้องรันจาก `backend/` เพื่อให้อ่าน `.env` ได้):

```powershell
cd backend
uvicorn main:app --reload --port 8000

# อีก terminal
cd frontend
npm run dev
```

> **สำคัญสำหรับ Google login บน local**
> 1. ต้องเปิดแอปที่ **`http://localhost:5173`** (ไม่ใช่ `127.0.0.1`) — Google
>    ลงทะเบียน redirect URI ไว้เฉพาะ `http://localhost:8000/...` และ localStorage
>    (ที่เก็บ JWT) แยกตาม origin ถ้าสลับ host จะดูเหมือน login ไม่ติด
> 2. backend ต้องรันที่ port **8000** ให้ตรงกับ redirect URI ที่ลงทะเบียนไว้
>    ถ้า `.env` ยังเป็น port อื่น ให้ใช้ `scripts/dev-backend.ps1` (script override
>    env var ทับ `.env` ให้) หรือแก้ `BACKEND_BASE_URL` ใน `backend/.env` เอง
> 3. เช็ค config ก่อนทดสอบทุกครั้ง:
>    ```bash
>    python scripts/check_oauth_config.py
>    ```
>    ถ้าขึ้น `MISMATCH` แปลว่า URI ที่ backend สร้างยังไม่ถูกเพิ่มใน Google Cloud
>    Console (หรือ port ไม่ตรง) — login จะพังด้วย `Error 400: redirect_uri_mismatch`

ถ้าต้องการทดสอบค่า `VITE_API_URL` จริง:
```powershell
$env:VITE_API_URL='https://your-render-app.onrender.com'
npm run build
# ตรวจ dist/assets/*.js ว่ามี URL นี้อยู่
```

---

## 6. Cloudflare D1 — Timetable Sharing (Short Links)

ระบบบันทึกตารางสอนและสร้างลิงก์สั้น (`/view?code=ABC123`) ใช้ Cloudflare D1
เป็นที่เก็บข้อมูลใน production และมี local JSON fallback สำหรับ dev

### สถาปัตยกรรม

```
PrintStudio "บันทึก & แชร์"
  → POST /api/v1/timetables/generate-and-save (Render)
    → solver จัดตาราง → บันทึกลง D1 (หรือ local JSON fallback)
    → คืน short_code + share_url
ผู้รับเปิด /view?code=ABC123
  → GET /api/v1/timetables/t/ABC123 (Render)
    → ดึงจาก D1 → ส่งกลับ → PublicViewerPage แสดงตาราง
```

### การตั้งค่า D1

1. **สร้าง D1 database** ใน Cloudflare dashboard หรือ CLI:
   ```bash
   npx wrangler d1 create kru-timetable-db
   ```
   (ของจริงชื่อ `kru-timetable-db` — ถ้าใช้ของเดิมอยู่แล้ว ข้ามขั้นนี้)

2. **รัน schema migration** (จาก root ของ repo):
   ```bash
   npx wrangler d1 execute kru-timetable-db --remote --file scripts/init_d1.sql
   ```
   หรือสำหรับ local dev:
   ```bash
   npx wrangler d1 execute kru-timetable-db --local --file scripts/init_d1.sql
   ```

3. **ตั้ง environment variables บน Render** (Settings → Environment):

   | Variable | Value |
   |---|---|
   | `CLOUDFLARE_ACCOUNT_ID` | Cloudflare account ID (ดูที่มุมขวาบน dashboard) |
   | `CLOUDFLARE_D1_DATABASE_ID` | Database ID จากขั้นตอนที่ 1 |
   | `CLOUDFLARE_API_TOKEN` | API token ที่มี permission `D1 Edit` ([สร้างที่นี่](https://dash.cloudflare.com/profile/api-tokens)) |
   | `FRONTEND_BASE_URL` | `https://timetable.kru-platform.com` |

4. **Redeploy Render** — หลังตั้ง env vars แล้ว

### Local Dev (ไม่ต้องตั้งค่า D1)

ถ้าไม่ได้ตั้ง `CLOUDFLARE_*` env vars, backend จะใช้ **local JSON fallback**
(`backend/data/timetables.json`) โดยอัตโนมัติ — ทุก endpoint ทำงานเหมือนกัน
แต่ข้อมูลเก็บในไฟล์แทน D1 (เหมาะสำหรับ dev ที่ไม่ต้องการ Cloudflare credentials)

### API Endpoints (ใหม่)

| Method | Path | คำอธิบาย |
|--------|------|----------|
| POST | `/api/v1/timetables/generate-and-save` | จัดตาราง + บันทึก + คืน short_code และ share_url |
| GET | `/api/v1/timetables/t/{short_code}` | ดูตารางสอนจาก short code (public, Lead Magnet) |
| GET | `/api/v1/timetables/my-schedules` | รายการตารางของผู้ใช้ (Bearer JWT หรือ `X-User-Id`) |
| POST | `/api/v1/timetables/claim` | ผูก short code กับ user (Bearer JWT หรือ `X-User-Id`) |
| POST | `/api/v1/timetables/save-workspace` | บันทึก workspace ขึ้นคลาวด์ (ไม่ re-solve, private) — รับ `access_mode` (`team`/`private`) |
| GET | `/api/v1/timetables/workspace/{id}` | โหลด workspace จากคลาวด์ (เจ้าของ / สมาชิกทีม / manager_emails) |
| DELETE | `/api/v1/timetables/workspace/{id}` | ลบ workspace (เจ้าของเท่านั้น) |
| PUT | `/api/v1/timetables/workspace/{id}/managers` | ตั้งรายชื่อผู้จัดการรายตาราง (เจ้าของเท่านั้น) |
| PUT | `/api/v1/timetables/workspace/{id}/access` | เปลี่ยนการแชร์เป็น `team` หรือ `private` (เจ้าของเท่านั้น) |
| POST | `/api/v1/timetables/merge-guest` | ย้ายของ guest device ไปผูกกับบัญชีที่ login |
| GET | `/api/v1/team` | ดูทีมของฉัน + ทีมที่ฉันถูกเพิ่ม (ต้องมี Bearer JWT) |
| POST | `/api/v1/team/members` | เพิ่มอีเมลเข้าทีม (เจ้าของเท่านั้น, idempotent) |
| DELETE | `/api/v1/team/members/{email}` | ถอดอีเมลออกจากทีม (เจ้าของเท่านั้น) |
| GET | `/api/v1/auth/google/url` | สร้าง Google OAuth consent URL |
| GET | `/api/v1/auth/google/callback` | Google redirect callback (แลก code → JWT → redirect frontend) |
| GET | `/api/v1/auth/me` | ดึง profile ผู้ใช้ (ต้องมี Bearer JWT) |

### Auth (2 ระดับ)

1. **Guest (default)** — ใช้ `X-User-Id` header (device id ใน localStorage)
   - ใช้ได้ทุก endpoint ยกเว้น `/auth/me` และ `/merge-guest`
   - ข้อมูลผูกกับเครื่อง — เปลี่ยนเครื่อง/ล้าง cache → ดู schedules เก่าไม่ได้
2. **Google login (optional)** — ใช้ `Authorization: Bearer <jwt>`
   - บันทึก workspace ข้ามเครื่องได้
   - หลัง login ระบบ merge ของที่ save ด้วย device id เข้าบัญชีอัตโนมัติ
   - เก็บ user ด้วย `google_sub` (stable identifier) → อนาคตรวมกับเว็บหลักได้โดย map sub

---

## 7. Google Login + Cloud Save/Load (Optional)

### การตั้งค่า Google OAuth

1. **Google Cloud Console** → APIs & Services → Credentials
2. **Create Credentials** → OAuth client ID → Web application
3. **Authorized redirect URIs** (ต้องตรงทุกตัวอักษร — scheme, host, port):
   ```
   http://localhost:8000/api/v1/auth/google/callback          (dev)
   https://<your-render-app>.onrender.com/api/v1/auth/google/callback  (prod)
   ```
   - `http://127.0.0.1:8000/...` **ใช้ไม่ได้** ถ้าไม่ได้เพิ่มแยก (Google ถือว่า host ต่างกัน)
   - ถ้า backend รันคนละ port ให้เพิ่ม URI ของ port นั้นแยก หรือเปลี่ยน `BACKEND_BASE_URL`
     ให้ตรงกับ URI ที่มีอยู่แล้ว
4. Copy Client ID + Client Secret
5. ตรวจสอบว่าฝั่ง local ตั้งค่าตรง:
   ```bash
   python scripts/check_oauth_config.py   # ต้องขึ้น PASS
   ```

### การตั้งค่า Render env vars (เพิ่มเติม)

| Variable | Value |
|---|---|
| `GOOGLE_CLIENT_ID` | จาก Google Cloud Console |
| `GOOGLE_CLIENT_SECRET` | จาก Google Cloud Console |
| `JWT_SECRET` | สุ่มยาว 32+ ตัว: `python -c "import secrets; print(secrets.token_urlsafe(32))"` |
| `BACKEND_BASE_URL` | `https://<your-render-app>.onrender.com` |

### การรัน migration บน D1 (เพิ่ม users table + workspace_json)

```bash
# รันจาก backend/ ด้วย D1 credentials ใน env
python _run_migration.py ../scripts/002_upgrade.sql
```

### การรัน migration 005 (ทีมผู้ใช้ + access_mode)

ต้องรัน **ก่อน** deploy backend เวอร์ชันที่มีระบบทีม:

```bash
cd backend
python _run_migration.py ../scripts/005_team_members.sql
```

สร้างตาราง `team_members (owner_user_id, member_email, added_at)` และเพิ่มคอลัมน์
`timetables.access_mode` (default `'team'`) — รันซ้ำได้ (runner ข้าม duplicate column ให้)

### ทีมผู้ใช้ (ใช้งานระบบร่วมกันหลายคน)

1. เจ้าของ login ด้วย Google → เมนูผู้ใช้ → **ผู้ใช้ในทีม** (หรือปุ่มบนหน้าแรก)
2. ใส่อีเมล Google ของครูที่ต้องการ → กดเพิ่ม (สถานะ "รอเข้าสู่ระบบ" จนกว่าเขาจะ login)
3. สมาชิก login ด้วยอีเมลนั้น → เห็น workspace **ทุกตารางของเจ้าของ** ในหน้าแรกทันที และแก้ไขได้เท่าเจ้าของ
4. ถ้าต้องการแชร์เฉพาะบางตาราง: หน้าแรก → ไอคอนแชร์ของตารางนั้น → เลือก
   **"เฉพาะรายชื่อ"** แล้วระบุอีเมล (โหมด `private`)
5. ถอดสมาชิกออกจากทีม → สิทธิ์ระดับทีมถูกเพิกถอนทันที (แต่รายชื่อที่เคยใส่ใน `manager_emails` ของแต่ละตารางยังอยู่)

สิทธิ์ที่ทำได้เฉพาะเจ้าของ: เพิ่ม/ถอดสมาชิกทีม, เปลี่ยนโหมดแชร์, แก้ `manager_emails`, ลบ workspace

> อีเมลถูก normalize เป็นตัวพิมพ์เล็กทั้งระบบ (JWT / team_members / manager_emails) — ใช้ได้แม้ผู้ใช้พิมพ์ตัวพิมพ์ใหญ่

### Flow การใช้งาน

1. **Guest**: สร้างตาราง → บันทึก local snapshot (auto-save) → ใช้ได้ปกติ
2. **กด login**: เลือก Google account → redirect กลับ → token เก็บใน localStorage
3. **บันทึกขึ้นคลาวด์**: กดปุ่ม "บันทึกคลาวด์" ใน VersionBar (step 5) → เก็บ workspace ลง D1
4. **เปิดจากคลาวด์**: หน้าแรก → กด "เปิดจากคลาวด์" → เลือกตาราง → โหลดกลับมาแก้ต่อ
5. **merge-guest**: หลัง login ระบบย้ายของที่ save ด้วย device id เข้าบัญชีอัตโนมัติ

> **หมายเหตุ**: login เป็น **ทางเลือก** — guest ยังใช้ทุกฟีเจอร์เดิมได้ (short code, snapshot, export JSON)

### การรัน migration 006 + 007 (สิทธิ์ role + โมดูลนักศึกษาฝึกสอน)

ต้องรัน **ก่อน** deploy backend เวอร์ชันที่มี Workspace role และโมดูล นศ.:

```bash
cd backend
python _run_migration.py ../scripts/006_workspace_roles.sql
python _run_migration.py ../scripts/007_trainee_workspaces.sql
```

- `006` เพิ่มตาราง `workspace_members` (role ต่อ workspace), คอลัมน์ default role ของ `team_members`
  และ migrate `manager_emails` เดิมเป็น editor
- `007` เพิ่มตาราง `trainee_workspaces` และ `trainee_members`
- ทั้งสองไฟล์รันซ้ำได้ (runner ข้าม duplicate column/table ให้)

หลัง migrate แล้ว หน้าแรกจะมี card **นักศึกษาฝึกสอน** และปุ่มแชร์ workspace จะเปิด dialog
เลือก role `แก้ไขได้/อ่านอย่างเดียว` + สิทธิ์โมดูล นศ. `ไม่เห็น/อ่าน/แก้ไข` ต่อคนได้

### การรัน migration 008 (ลิงก์แชร์ผลสรุปนักศึกษา)

ต้องรัน **ก่อน** deploy backend เวอร์ชันที่มีปุ่ม "แชร์ผลสรุป" ใน Print Studio ของโมดูล นศ.:

```bash
cd backend
python _run_migration.py ../scripts/008_trainee_shares.sql
```

- `008` เพิ่มตาราง `trainee_shares` (1 ลิงก์ต่อโมดูล, short code 6 ตัว)
- รันซ้ำได้ (`CREATE TABLE/INDEX IF NOT EXISTS`)
- ถ้ายังไม่รัน: การกดสร้างลิงก์จะได้ error 502 จาก backend

---

---

## 8. Portal v2 — กิจกรรมโรงเรียน + งานส่งไฟล์

พอร์ทัลสำหรับครู (มือถือ, ไม่ต้อง login) และฝ่ายวิชาการ (ตรวจงาน) ผูกกับ workspace
ผ่าน `timetables.short_code` — ใช้ข้อมูลครู/ห้องเรียน/ตารางสอนแทนที่มีอยู่แล้ว

| หน้า | URL | สิทธิ์ |
|---|---|---|
| พอร์ทัลครู | `/portal?w=<short_code>` | ไม่ต้อง login (ต้องเปิด "เผยแพร่พอร์ทัล" ก่อน) |
| ตรวจงาน (ฝ่ายวิชาการ) | `/admin?w=<short_code>` | Google login + role owner/editor ของ workspace |

### 8.1 แนวคิดหลัก (v2 แยกสองระบบออกจากกัน)

| | กิจกรรมโรงเรียน | งานส่งไฟล์ |
|---|---|---|
| ตาราง | `portal_events` | `portal_tasks` + `portal_task_slots` |
| ผู้เข้าร่วม | ครู / กลุ่มสาระ / **ห้องเรียน** | ครู / กลุ่มสาระ |
| ไฟล์ | ไม่มี | **หลายกล่องต่องาน** (กำหนดนามสกุล/ขนาด/บังคับหรือไม่ต่อกล่อง) |
| ครูเห็น | ปฏิทินรวมทั้งโรงเรียน → คลิกดูผู้เข้าร่วม | เลือกชื่อ → เห็นงาน+กล่อง → ส่งด้วย PIN |
| Admin เห็น | รายการ + สร้าง/แก้ | ตารางตรวจงาน **แถว=ครู คอลัมน์=กล่อง** + Excel/ZIP/เตือน |

### 8.2 Migration (ต้องรันก่อน deploy)

```bash
cd backend
python _run_migration.py ../scripts/010_portal_v2.sql
```

- ⚠️ **DROP TABLE** ตาราง `portal_*` 7 ตัว แล้วสร้างใหม่ (ตรวจแล้วว่าว่าง 0 rows ก่อนรัน)
- คงเดิม: `portal_config`, `portal_teachers`, `portal_settings`
- ใหม่: `portal_tasks`, `portal_task_slots`, `portal_audience`
- เปลี่ยน: `portal_events` (กิจกรรมล้วน), `portal_submissions` (UNIQUE `slot_id`+`teacher_id`),
  `portal_submission_history`, `portal_notifications` (+`task_id`)
- รันซ้ำได้ (DROP IF EXISTS + CREATE)

### 8.3 Environment variables (Render)

| Variable | ค่า | หมายเหตุ |
|---|---|---|
| `PORTAL_STORAGE` | `drive` \| `local` \| (ว่าง = auto) | auto = `drive` เมื่อตั้งค่า Drive, ไม่งั้น `local` |
| `PORTAL_UPLOAD_DIR` | เช่น `/var/data/uploads` | ใช้เมื่อ `PORTAL_STORAGE=local` |
| `PORTAL_MAX_UPLOAD_MB` | `25` | ค่าเริ่มต้นของกล่องใหม่ (แต่ละกล่องปรับได้) |
| `PORTAL_ALLOWED_EXT` | `.pdf,.docx,.xlsx,.zip` | ค่าเริ่มต้นของกล่องใหม่ |
| `PORTAL_TZ` | `Asia/Bangkok` | ใช้ตัดสิน "ส่งช้า" |
| `PORTAL_WEBHOOK_SECRET` | (ไม่บังคับ) | ใช้เซ็น `X-Portal-Signature` (HMAC-SHA256) |
| `GOOGLE_DRIVE_CLIENT_ID` / `_SECRET` | ว่าง = ใช้ `GOOGLE_CLIENT_ID/SECRET` | ใช้กับ OAuth ของ Drive |
| `GOOGLE_DRIVE_REFRESH_TOKEN` | (ไม่บังคับ) | ทางเลือกแทนการกดเชื่อมใน UI |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | path หรือ JSON | ทางเลือก: SA + Shared Drive |

⚠️ **Render filesystem เป็น ephemeral** — ถ้า `PORTAL_STORAGE=local` ไฟล์ที่ครูส่งจะหาย
ทุกครั้งที่ redeploy หน้าตรวจงานจะขึ้นแบนเนอร์เตือนเมื่อพอร์ทัลถูกเผยแพร่

### 8.4 เชื่อม Google Drive (แนะนำ)

กด **ตั้งค่า → เชื่อม Drive** ในหน้า `/admin` (ต้องเพิ่ม redirect URI ใน Google Cloud Console):

```
https://<render-app>.onrender.com/api/v1/portal/drive/callback
```

**ต้องตั้ง OAuth consent screen เป็น User type = Internal** (Google Workspace for Education)
ถ้าตั้งเป็น External + Testing → **refresh token จะหมดอายุใน 7 วัน** และระบบจะขึ้น
`invalid_grant` ให้กดเชื่อมใหม่

ทางเลือกอื่น:

| ทางเลือก | ใช้เมื่อ | ข้อควรรู้ |
|---|---|---|
| **OAuth (Internal)** | มี Google Workspace | ไม่ต้อง verification, token อยู่ยาว |
| **Service account + Shared Drive** | มี Workspace + Shared Drive | SA ที่สร้างหลัง 15 เม.ย. 2025 **ไม่มี storage quota** — ต้องเพิ่ม SA เป็น Content Manager ใน Shared Drive |
| **Cloudflare R2** | ไม่มี Workspace | ถูกกว่า, ไม่มี quota, แต่ไฟล์ไม่อยู่ใน Drive |
| **Local disk** | dev / self-host | ต้องมี persistent disk |

หลังเชื่อมแล้ว วางลิงก์โฟลเดอร์ปลายทาง (เช่น
`https://drive.google.com/drive/folders/1AbC...`) ในช่อง **Google Drive ปลายทาง** →
ไฟล์จะถูกเก็บเป็น `โฟลเดอร์/<วันที่>_<ชื่องาน>/<รหัสครู>_<ชื่อครู>_<กล่อง>_<ชื่อไฟล์>`

### 8.5 งานที่อยู่ในเบราว์เซอร์ (local snapshot) → ต้องบันทึกขึ้นคลาวด์ก่อน

พอร์ทัลทำงานฝั่งเซิร์ฟเวอร์และผูกกับ `timetables.short_code` — งานที่บันทึกใน
IndexedDB/localStorage ยังไม่มี short_code จึงซิงก์ครูไม่ได้

กดปุ่ม **พอร์ทัล** (ในแถบงานปัจจุบันหรือการ์ดหน้าแรก) ระบบจะ:
1. ถ้ายังไม่ login → ให้เข้าสู่ระบบ Google ก่อน (admin ต้องใช้ JWT) แล้วทำต่อให้อัตโนมัติ
2. บันทึกงานนี้ขึ้นคลาวด์ (`POST /save-workspace` — คืน `short_code` แล้วตั้งแต่ v2)
3. เปิด `/admin?w=<short_code>` → ทะเบียนครูซิงก์จากงานนั้นทันที

### 8.6 ทะเบียนครู (auto-sync + เดากลุ่มสาระ)

- เปิดแท็บ **ทะเบียนครู** ครั้งแรก ระบบจะ **ซิงก์รายชื่อจาก workspace อัตโนมัติ**
- ระบบ **เดากลุ่มสาระ** จากวิชาที่ครูสอนมากที่สุด (เช่น สอนคณิตศาสตร์ 4 คาบ → dept = คณิตศาสตร์)
  เติมเฉพาะช่องที่ว่าง — แก้ไขได้ตลอด หรือกดปุ่ม "เดากลุ่มสาระ" ใหม่
- PIN เริ่มต้น = **เลข 4 ตัวท้ายของเบอร์โทร** (กรอกเบอร์แล้วระบบตั้งให้)
- ถ้าครูย้าย/เพิ่มในตารางสอน → กด "ซิงก์จาก workspace" อีกครั้ง (คนที่หายไปจะถูกปิดใช้งาน ไม่ลบ)

### 8.7 Webhook (แจ้งเตือนออกนอกระบบ)

ตั้ง URL ในหน้า ตั้งค่า — ระบบจะ POST JSON:

```json
{
  "source": "sro-portal",
  "type": "submission | reminder",
  "workspace": { "short_code": "ABC123", "title": "..." },
  "task": { "id": "...", "title": "...", "due_datetime": "..." },
  "event": null,
  "message": "ข้อความภาษาไทย",
  "portal_url": "https://.../portal?w=ABC123",
  "recipients": [{ "teacher_id": "T1", "name": "...", "dept": "..." }]
}
```

ถ้าตั้ง `PORTAL_WEBHOOK_SECRET` จะมี header `X-Portal-Signature: sha256=<hex>`
(ต่อกับ n8n / Make / LINE relay ได้) — ถ้าไม่ตั้ง webhook ก็ยังใช้ปุ่ม
"คัดลอกข้อความ" แล้ววางในกลุ่ม LINE ได้

### 8.8 API (สรุป)

| Method | Path | สิทธิ์ |
|---|---|---|
| GET | `/api/v1/portal/{code}` | public (ต้อง publish) |
| GET | `/api/v1/portal/{code}/calendar?from&to&teacher_id` | public |
| GET | `/api/v1/portal/{code}/events/{id}?teacher_id` | public |
| GET | `/api/v1/portal/{code}/tasks?teacher_id` | public |
| POST | `/api/v1/portal/{code}/submissions` | public + PIN (teacher_id, task_id, slot_id, file) |
| GET | `/api/v1/portal/{code}/submissions?teacher_id` | public |
| GET | `/api/v1/portal/{code}/substitutions?date` | public |
| GET/POST | `/api/v1/portal/{code}/notifications…` | public |
| CRUD | `/api/v1/portal/{code}/admin/events` | owner/editor |
| CRUD | `/api/v1/portal/{code}/admin/tasks` (+ `slots`, `audience`) | owner/editor |
| GET | `/api/v1/portal/{code}/admin/tasks/{id}/matrix` | owner/editor |
| GET | `/api/v1/portal/{code}/admin/tasks/{id}/export.xlsx` `/download-zip` | owner/editor |
| POST | `/api/v1/portal/{code}/admin/tasks/{id}/remind` | owner/editor |
| GET | `/api/v1/portal/{code}/admin/teachers?auto_sync=true` | owner/editor |
| POST | `/api/v1/portal/{code}/admin/teachers/sync` `/infer-depts` | owner/editor |
| PUT | `/api/v1/portal/{code}/admin/teachers/{id}` · `/pin` | owner/editor |
| GET/PUT | `/api/v1/portal/{code}/admin/config` | owner/editor |
| GET/POST | `/api/v1/portal/{code}/admin/drive/*` | owner/editor |

---

## 9. การย้อนรุ่น (rollback) และการติด tag

`main` ผูก auto-deploy ทั้ง Render และ Cloudflare Workers → **push ขึ้น `main` = ขึ้น production ทันที**
งานที่ยังไม่พร้อมจึงควรอยู่บน branch (`feat/...`) แล้ว merge เมื่อผ่านการตรวจ

### 9.1 tag ที่ใช้เป็นจุดย้อนกลับ

| tag | หมายถึง |
|---|---|
| `v0.1.0` | ระบบตารางสอน ก่อนมีพอร์ทัล (baseline) |
| `v0.2.0-portal` | เพิ่มพอร์ทัล: กิจกรรมโรงเรียน + งานส่งไฟล์ + ตรวจงาน |

```bash
git tag -a v0.2.0-portal -m "Portal: แจ้งเตือน + ส่งงาน"   # หลัง merge
git push origin v0.2.0-portal
git tag -l                                                 # ดูทั้งหมด
```

### 9.2 ย้อนรุ่นหลัง deploy แล้วพบปัญหา

```bash
# 1) ถอยเร็วที่สุด — revert merge commit (history ยังอยู่ครบ)
git switch main && git pull
git revert -m 1 <merge-sha>      # merge-sha = commit ที่ merge PR เข้า main
git push origin main             # auto-deploy กลับสภาพก่อน merge

# 2) ไม่แตะ git เลย — ใช้ Render dashboard
#    Service → Deploys → เลือก commit เก่า → "Redeploy"
#    (Cloudflare Workers: `npx wrangler rollback` หรือ deploy commit เก่า)

# 3) ดู/รันโค้ดรุ่นเก่าในเครื่อง
git switch --detach v0.1.0
git switch -                           # กลับ branch เดิม
```

### 9.3 ข้อควรระวัง

- **migration ไม่ย้อนตามโค้ด** — `009_portal.sql` / `010_portal_v2.sql` เป็น additive
  การ rollback โค้ดจะไม่ลบตาราง/ข้อมูลที่พอร์ทัลสร้าง ถ้าต้องถอย DB ด้วย
  ต้องเขียน migration ย้อนกลับแยกและรันเอง
- **Render filesystem เป็น ephemeral** — ไฟล์ที่เก็บแบบ `PORTAL_STORAGE=local`
  หายทุกครั้งที่ redeploy/rollback ต้องใช้ Google Drive สำหรับไฟล์จริง
- อย่า `git reset --hard` บน `main` ที่ push แล้ว — ใช้ `git revert` เท่านั้น
