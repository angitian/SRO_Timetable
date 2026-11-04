/**
 * Backend API base URL.
 *
 * Production: ตั้ง `VITE_API_URL` env var ที่ Cloudflare dashboard
 *             (ค่า = URL ของ Render backend, เช่น https://xxx.onrender.com)
 * Development: fallback ไป http://localhost:8000 (สำหรับรัน local)
 *             — ต้องใช้ host `localhost` (ไม่ใช่ 127.0.0.1) ให้ตรงกับ Google OAuth
 *               redirect URI ที่ลงทะเบียนไว้: http://localhost:8000/api/v1/auth/google/callback
 *             — ถ้า port 8000 ถูกโปรแกรมอื่นยึด (เช่น Devin Desktop)
 *               ให้ใช้ scripts/dev-backend.ps1 + scripts/dev-frontend.ps1
 *               (ตั้ง BACKEND_BASE_URL/VITE_API_URL ให้ตรงกันอัตโนมัติ)
 *
 * หมายเหตุ: Vite embed env var ตอน build time — ต้องตั้ง env ก่อน push/build
 */
export const BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000'
