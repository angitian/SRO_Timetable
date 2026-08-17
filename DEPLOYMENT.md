# Deployment Guide — SRO Timetable

ระบบ deploy 2 ส่วน: **Render** (backend FastAPI) + **Cloudflare Workers** (frontend Vite SPA)

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
