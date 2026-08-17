/**
 * Backend API base URL.
 *
 * Production: ตั้ง `VITE_API_URL` env var ที่ Cloudflare dashboard
 *             (ค่า = URL ของ Render backend, เช่น https://xxx.onrender.com)
 * Development: fallback ไป http://127.0.0.1:8000 (สำหรับรัน local)
 *
 * หมายเหตุ: Vite embed env var ตอน build time — ต้องตั้ง env ก่อน push/build
 */
export const BASE_URL = import.meta.env.VITE_API_URL || 'http://127.0.0.1:8000'
