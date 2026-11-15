import { useEffect, useState } from 'react'
import {
  Loader2, FolderOpen, ExternalLink, Copy, Check, RefreshCw, AlertCircle,
} from 'lucide-react'
import { connectAdminDrive, disconnectAdminDrive, updateAdminConfig } from '../../api/portal.js'
import { BASE_URL } from '../../api/config.js'
import { copyText } from './clipboard.js'
import { parseDriveFolderLink } from './portalUtils.js'

const DRIVE_STEPS = [
  'สร้างโฟลเดอร์ใน Google Drive ของฝ่ายวิชาการ (จะใช้ Shared Drive ก็ได้)',
  'แชร์โฟลเดอร์ให้บัญชี Google ที่จะใช้เชื่อม ด้วยสิทธิ์ Editor',
  'กด “เชื่อม Drive” แล้วอนุญาตสิทธิ์ (OAuth consent ต้องตั้งเป็น Internal)',
  'วางลิงก์โฟลเดอร์ด้านล่าง แล้วกด “บันทึกโฟลเดอร์”',
]

export default function AdminSettingsTab({
  code, config, drive, onRefresh, onError, onNotice,
}) {
  const [school, setSchool] = useState('')
  const [webhook, setWebhook] = useState('')
  const [folder, setFolder] = useState('')
  const [saving, setSaving] = useState(false)
  const [savingFolder, setSavingFolder] = useState(false)
  const [folderError, setFolderError] = useState(null)
  const [copied, setCopied] = useState(false)

  const redirectUri = `${BASE_URL}/api/v1/portal/drive/callback`
  const parsed = folder.trim() ? parseDriveFolderLink(folder) : null
  const folderInvalid = Boolean(parsed?.error)

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
      })
      onNotice?.('บันทึกการตั้งค่าแล้ว')
      await onRefresh?.()
    } catch (e) {
      onError?.(e.message)
    } finally {
      setSaving(false)
    }
  }

  async function saveFolder() {
    setFolderError(null)
    if (!folder.trim()) {
      setFolderError('วางลิงก์โฟลเดอร์ Drive ก่อนบันทึก')
      return
    }
    if (folderInvalid) {
      setFolderError(parsed.error)
      return
    }
    setSavingFolder(true)
    try {
      await updateAdminConfig(code, { drive_folder_url: folder.trim() })
      onNotice?.('บันทึกโฟลเดอร์ Drive แล้ว')
      await onRefresh?.()
    } catch (e) {
      setFolderError(e.message || 'บันทึกโฟลเดอร์ไม่สำเร็จ')
    } finally {
      setSavingFolder(false)
    }
  }

  async function clearFolder() {
    setFolder('')
    setFolderError(null)
    setSavingFolder(true)
    try {
      await updateAdminConfig(code, { drive_folder_url: '' })
      onNotice?.('ล้างโฟลเดอร์ Drive แล้ว')
      await onRefresh?.()
    } catch (e) {
      setFolderError(e.message || 'ล้างค่าไม่สำเร็จ')
    } finally {
      setSavingFolder(false)
    }
  }

  function copyRedirect() {
    copyText(redirectUri)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 2000)
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
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-sm font-bold text-slate-700 flex items-center gap-1.5">
            <FolderOpen className="w-4 h-4 text-amber-500" /> Google Drive ปลายทาง
          </h2>
          <button
            type="button"
            onClick={() => onRefresh?.()}
            className="ml-auto p-1.5 rounded-lg hover:bg-slate-100"
            title="รีเฟรชสถานะ"
            aria-label="รีเฟรชสถานะ Drive"
          >
            <RefreshCw className="w-3.5 h-3.5 text-slate-500" />
          </button>
          <span className={`text-xs font-semibold px-2 py-1 rounded-full ${
            drive?.connected ? 'bg-emerald-100 text-emerald-800' : 'bg-rose-100 text-rose-700'
          }`}>
            {drive?.connected ? 'เชื่อมบัญชี Drive แล้ว' : 'ยังไม่เชื่อมบัญชี Drive'}
          </span>
        </div>

        <div className="rounded-lg bg-slate-50 border border-slate-200 p-3">
          <p className="text-xs font-bold text-slate-700 mb-1.5">วิธีตั้งค่า</p>
          <ol className="space-y-1 text-[11px] text-slate-600 list-decimal list-inside">
            {DRIVE_STEPS.map((step) => <li key={step}>{step}</li>)}
          </ol>
        </div>

        <div>
          <span className="text-xs font-semibold text-slate-600">
            Redirect URI (ใส่ใน Authorized redirect URIs ของ Google Cloud Console)
          </span>
          <div className="mt-1 flex items-stretch gap-1.5">
            <code className="flex-1 min-w-0 min-h-[40px] flex items-center rounded-lg border border-slate-300 bg-slate-50 px-2 text-[11px] break-all">
              {redirectUri}
            </code>
            <button
              type="button"
              onClick={copyRedirect}
              className="min-h-[40px] px-2.5 rounded-lg border border-slate-300 text-xs font-semibold inline-flex items-center gap-1 shrink-0 hover:bg-slate-50"
            >
              {copied ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
              {copied ? 'คัดลอกแล้ว' : 'คัดลอก'}
            </button>
          </div>
        </div>

        <div>
          <span className="text-xs font-semibold text-slate-600">ลิงก์โฟลเดอร์ Drive ปลายทาง</span>
          <input
            value={folder}
            onChange={(e) => { setFolder(e.target.value); setFolderError(null) }}
            placeholder="https://drive.google.com/drive/folders/…"
            aria-invalid={folderInvalid || Boolean(folderError)}
            className={`mt-1 w-full min-h-[40px] rounded-lg border px-3 text-sm ${
              folderInvalid || folderError ? 'border-rose-400 bg-rose-50' : 'border-slate-300'
            }`}
          />
          {folderError && (
            <p className="mt-1 text-[11px] text-rose-600 flex items-start gap-1">
              <AlertCircle className="w-3 h-3 mt-0.5 shrink-0" /> {folderError}
            </p>
          )}
          {!folderError && folderInvalid && (
            <p className="mt-1 text-[11px] text-rose-600 flex items-start gap-1">
              <AlertCircle className="w-3 h-3 mt-0.5 shrink-0" /> {parsed.error}
            </p>
          )}
          {!folderError && !folderInvalid && parsed?.folderId && (
            <p className="mt-1 text-[11px] text-emerald-700 flex items-center gap-1">
              <Check className="w-3 h-3 shrink-0" /> รหัสโฟลเดอร์: <code className="break-all">{parsed.folderId}</code>
            </p>
          )}
          {!folder.trim() && (
            <p className="mt-1 text-[11px] text-slate-500">
              ไฟล์ที่ครูส่งจะถูกเก็บในโฟลเดอร์ย่อยต่องาน
            </p>
          )}
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={saveFolder}
            disabled={savingFolder || folderInvalid || !folder.trim()}
            className="min-h-[38px] px-3 rounded-lg bg-blue-600 text-white text-sm font-bold inline-flex items-center gap-1.5 disabled:opacity-50"
          >
            {savingFolder && <Loader2 className="w-3.5 h-3.5 animate-spin" />} บันทึกโฟลเดอร์
          </button>
          {config?.drive_folder_url && (
            <button
              type="button"
              onClick={clearFolder}
              disabled={savingFolder}
              className="min-h-[38px] px-3 rounded-lg border border-slate-300 text-sm font-semibold disabled:opacity-50"
            >
              ล้างค่า
            </button>
          )}
          <button
            type="button"
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
            {drive?.connected ? 'เชื่อม Drive ใหม่' : 'เชื่อม Drive'}
          </button>
          {drive?.connected && (
            <button
              type="button"
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

        <p className="text-xs text-slate-500">
          โหมดเก็บไฟล์: {drive?.storage_backend === 'drive' ? 'Google Drive' : 'เครื่องเซิร์ฟเวอร์ (ชั่วคราว)'}
          {drive?.folder_id && <> · โฟลเดอร์ที่บันทึกไว้: <code className="break-all">{drive.folder_id}</code></>}
        </p>
        {drive?.detail && <p className="text-[11px] text-slate-500">{drive.detail}</p>}
        {!drive?.connected && (
          <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-2 py-1.5">
            ยังไม่เชื่อม Drive — ระบบจะบันทึกลิงก์โดยไม่ตรวจสิทธิ์โฟลเดอร์ ควรเชื่อมก่อนใช้งานจริง
          </p>
        )}
      </div>
    </section>
  )
}
