import { useEffect, useState } from 'react'
import { Loader2, FolderOpen, ExternalLink } from 'lucide-react'
import {
  connectAdminDrive, disconnectAdminDrive, fetchAdminDriveStatus, updateAdminConfig,
} from '../../api/portal.js'
import { BASE_URL } from '../../api/config.js'

export default function AdminSettingsTab({
  code, config, drive, onRefresh, onError, onNotice,
}) {
  const [school, setSchool] = useState('')
  const [webhook, setWebhook] = useState('')
  const [folder, setFolder] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    setSchool(config?.school_name || '')
    setWebhook(config?.webhook_url || '')
    setFolder(config?.drive_folder_url || '')
  }, [config?.school_name, config?.webhook_url, config?.drive_folder_url])

  async function save() {
    setSaving(true)
    try {
      await updateAdminConfig(code, {
        school_name: school,
        webhook_url: webhook,
        drive_folder_url: folder,
      })
      onNotice?.('บันทึกการตั้งค่าแล้ว')
      await onRefresh?.()
    } catch (e) {
      onError?.(e.message)
    } finally {
      setSaving(false)
    }
  }

  async function setLatePolicy(value) {
    try {
      await updateAdminConfig(code, { late_policy: value })
      onNotice?.('อัปเดตนโยบายการส่งช้าแล้ว')
      await onRefresh?.()
    } catch (e) {
      onError?.(e.message)
    }
  }

  return (
    <section className="grid gap-4 lg:grid-cols-2">
      <div className="bg-white rounded-xl border border-slate-200 p-4 space-y-3">
        <h2 className="text-sm font-bold text-slate-700">ข้อมูลโรงเรียน</h2>
        <label className="block">
          <span className="text-xs font-semibold text-slate-600">ชื่อโรงเรียน (แสดงบนพอร์ทัล)</span>
          <input
            value={school}
            onChange={(e) => setSchool(e.target.value)}
            className="mt-1 w-full min-h-[40px] rounded-lg border border-slate-300 px-3 text-sm"
          />
        </label>
        <label className="block">
          <span className="text-xs font-semibold text-slate-600">นโยบายการส่งช้า</span>
          <select
            value={config?.late_policy || 'allow'}
            onChange={(e) => setLatePolicy(e.target.value)}
            className="mt-1 w-full min-h-[40px] rounded-lg border border-slate-300 px-3 text-sm bg-white"
          >
            <option value="allow">รับไฟล์หลังกำหนด (มาร์กส่งช้า)</option>
            <option value="block">ปิดรับเมื่อเลยกำหนด</option>
          </select>
        </label>
        <label className="block">
          <span className="text-xs font-semibold text-slate-600">Webhook (แจ้งเตือนออกนอกระบบ)</span>
          <input
            value={webhook}
            onChange={(e) => setWebhook(e.target.value)}
            placeholder="https://… (ไม่บังคับ)"
            className="mt-1 w-full min-h-[40px] rounded-lg border border-slate-300 px-3 text-sm"
          />
          <span className="text-[11px] text-slate-500">
            ระบบจะ POST JSON พร้อมลายเซ็น <code>X-Portal-Signature</code> — ใช้ต่อกับ n8n/Make/LINE relay
          </span>
        </label>
        {config?.webhook_last_status && (
          <p className="text-[11px] text-slate-500">สถานะล่าสุด: {config.webhook_last_status}</p>
        )}
        <button
          onClick={save}
          disabled={saving}
          className="min-h-[40px] px-4 rounded-lg bg-blue-600 text-white text-sm font-bold inline-flex items-center gap-2 disabled:opacity-60"
        >
          {saving && <Loader2 className="w-4 h-4 animate-spin" />} บันทึก
        </button>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 p-4 space-y-3">
        <h2 className="text-sm font-bold text-slate-700 flex items-center gap-1.5">
          <FolderOpen className="w-4 h-4 text-amber-500" /> Google Drive ปลายทาง
        </h2>
        <p className="text-xs text-slate-500">
          วางลิงก์โฟลเดอร์ Drive ของฝ่ายวิชาการ — ไฟล์ที่ครูส่งจะถูกเก็บในโฟลเดอร์ย่อยต่องาน
        </p>
        <input
          value={folder}
          onChange={(e) => setFolder(e.target.value)}
          placeholder="https://drive.google.com/drive/folders/…"
          className="w-full min-h-[40px] rounded-lg border border-slate-300 px-3 text-sm"
        />
        <div className="flex flex-wrap items-center gap-2">
          <span className={`text-xs font-semibold px-2 py-1 rounded-full ${
            drive?.connected ? 'bg-emerald-100 text-emerald-800' : 'bg-rose-100 text-rose-700'
          }`}>
            {drive?.connected ? 'เชื่อมบัญชี Drive แล้ว' : 'ยังไม่เชื่อมบัญชี Drive'}
          </span>
          <span className="text-xs text-slate-500">
            โหมดเก็บไฟล์: {drive?.storage_backend === 'drive' ? 'Google Drive' : 'เครื่องเซิร์ฟเวอร์ (ชั่วคราว)'}
          </span>
        </div>
        {drive?.detail && <p className="text-[11px] text-slate-500">{drive.detail}</p>}
        <div className="flex flex-wrap gap-2">
          <button
            onClick={async () => {
              try {
                const body = await connectAdminDrive(code)
                window.location.href = body.auth_url
              } catch (e) {
                onError?.(e.message)
              }
            }}
            className="min-h-[38px] px-3 rounded-lg bg-slate-800 text-white text-sm font-bold"
          >
            เชื่อม Drive
          </button>
          {drive?.connected && (
            <button
              onClick={async () => {
                try {
                  await disconnectAdminDrive(code)
                  await onRefresh?.()
                  onNotice?.('ยกเลิกการเชื่อม Drive แล้ว')
                } catch (e) {
                  onError?.(e.message)
                }
              }}
              className="min-h-[38px] px-3 rounded-lg border border-slate-300 text-sm font-semibold"
            >
              ยกเลิกการเชื่อม
            </button>
          )}
          {config?.drive_folder_url && (
            <a
              href={config.drive_folder_url}
              target="_blank"
              rel="noreferrer"
              className="min-h-[38px] px-3 rounded-lg border border-slate-300 text-sm font-semibold inline-flex items-center gap-1.5"
            >
              <ExternalLink className="w-3.5 h-3.5" /> เปิดโฟลเดอร์
            </a>
          )}
        </div>
        <p className="text-[11px] text-slate-500">
          ต้องเพิ่ม redirect URI ใน Google Cloud Console:
          <code className="block mt-1 break-all bg-slate-50 rounded p-1">
            {`${BASE_URL}/api/v1/portal/drive/callback`}
          </code>
        </p>
      </div>
    </section>
  )
}
