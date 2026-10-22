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
# รัน backend
cd backend
uvicorn main:app --reload --port 8000

# รัน frontend (อีก terminal) — ไม่ต้องตั้ง env var เพราะมี fallback
cd frontend
npm run dev
```

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
| POST | `/api/v1/timetables/save-workspace` | บันทึก workspace ขึ้นคลาวด์ (ไม่ re-solve, private) |
| GET | `/api/v1/timetables/workspace/{id}` | โหลด workspace จากคลาวด์ (เจ้าของเท่านั้น) |
| DELETE | `/api/v1/timetables/workspace/{id}` | ลบ workspace (เจ้าของเท่านั้น) |
| POST | `/api/v1/timetables/merge-guest` | ย้ายของ guest device ไปผูกกับบัญชีที่ login |
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
3. **Authorized redirect URIs**:
   ```
   http://localhost:8000/api/v1/auth/google/callback          (dev)
   https://<your-render-app>.onrender.com/api/v1/auth/google/callback  (prod)
   ```
4. Copy Client ID + Client Secret

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

### Flow การใช้งาน

1. **Guest**: สร้างตาราง → บันทึก local snapshot (auto-save) → ใช้ได้ปกติ
2. **กด login**: เลือก Google account → redirect กลับ → token เก็บใน localStorage
3. **บันทึกขึ้นคลาวด์**: กดปุ่ม "บันทึกคลาวด์" ใน VersionBar (step 5) → เก็บ workspace ลง D1
4. **เปิดจากคลาวด์**: หน้าแรก → กด "เปิดจากคลาวด์" → เลือกตาราง → โหลดกลับมาแก้ต่อ
5. **merge-guest**: หลัง login ระบบย้ายของที่ save ด้วย device id เข้าบัญชีอัตโนมัติ

> **หมายเหตุ**: login เป็น **ทางเลือก** — guest ยังใช้ทุกฟีเจอร์เดิมได้ (short code, snapshot, export JSON)
