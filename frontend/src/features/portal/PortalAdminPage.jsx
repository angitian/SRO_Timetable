import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  CalendarDays, Package, Users, Settings2, Loader2, AlertCircle, Copy, Check,
  Link2, LogIn, ShieldAlert, Home, ExternalLink,
} from 'lucide-react'
import {
  fetchAdminConfig, fetchAdminDriveStatus, fetchAdminTeachers, updateAdminConfig,
} from '../../api/portal.js'
import { getAuthToken, loginWithGoogle } from '../../api/client.js'
import PortalCodeEntry from './PortalCodeEntry.jsx'
import { copyText } from './clipboard.js'
import AdminEventsTab from './AdminEventsTab.jsx'
import AdminTasksTab from './AdminTasksTab.jsx'
import AdminTeachersTab from './AdminTeachersTab.jsx'
import AdminSettingsTab from './AdminSettingsTab.jsx'

const TABS = [
  { id: 'events', label: 'กิจกรรมโรงเรียน', icon: CalendarDays },
  { id: 'tasks', label: 'งานส่งไฟล์', icon: Package },
  { id: 'teachers', label: 'ทะเบียนครู', icon: Users },
  { id: 'settings', label: 'ตั้งค่า', icon: Settings2 },
]


function LoginWall({ code }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center px-4">
      <div className="w-full max-w-md bg-white rounded-2xl border border-slate-200 p-6 text-center space-y-3">
        <ShieldAlert className="w-10 h-10 text-amber-500 mx-auto" />
        <h1 className="text-lg font-bold text-slate-800">ต้องเข้าสู่ระบบก่อน</h1>
        <p className="text-sm text-slate-500">
          หน้าตรวจงานใช้สิทธิ์เจ้าของ/ผู้แก้ไขของ workspace
          {code ? ` (${code})` : ''} — เข้าสู่ระบบด้วยบัญชี Google ที่มีสิทธิ์
        </p>
        {error && <p className="text-sm text-rose-600">{error}</p>}
        <button
          onClick={async () => {
            setBusy(true)
            setError(null)
            try {
              try {
                sessionStorage.setItem('sro_auth_return', window.location.pathname + window.location.search)
              } catch { /* private mode */ }
              await loginWithGoogle()
            } catch (e) {
              setError(e.message)
              setBusy(false)
            }
          }}
          disabled={busy}
          className="w-full min-h-[44px] rounded-xl bg-blue-600 text-white font-bold inline-flex items-center justify-center gap-2 disabled:opacity-60"
        >
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <LogIn className="w-4 h-4" />}
          เข้าสู่ระบบด้วย Google
        </button>
        <a href="/" className="block text-xs text-slate-500 hover:underline">กลับหน้าหลัก</a>
      </div>
    </div>
  )
}

export default function PortalAdminPage() {
  const params = useMemo(() => new URLSearchParams(window.location.search), [])
  const code = (params.get('w') || '').trim().toUpperCase()
  const driveResult = params.get('drive')

  const [tab, setTab] = useState(() => {
    const wanted = params.get('tab')
    return TABS.some((item) => item.id === wanted) ? wanted : 'events'
  })
  const [config, setConfig] = useState(null)
  const [classes, setClasses] = useState([])
  const [teachers, setTeachers] = useState([])
  const [workspaceTeacherCount, setWorkspaceTeacherCount] = useState(0)
  const [drive, setDrive] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [notice, setNotice] = useState(
    driveResult === 'connected'
      ? 'เชื่อม Google Drive สำเร็จ'
      : driveResult === 'error'
        ? `เชื่อม Drive ไม่สำเร็จ: ${params.get('reason') || 'unknown'}`
        : null,
  )
  const [copied, setCopied] = useState(false)

  const loggedIn = !!getAuthToken()
  const portalUrl = code ? `${window.location.origin}/portal?w=${code}` : ''

  const loadBase = useCallback(async () => {
    if (!code || !loggedIn) return
    setLoading(true)
    setError(null)
    try {
      const [configBody, teacherBody, driveBody] = await Promise.all([
        fetchAdminConfig(code),
        fetchAdminTeachers(code),
        fetchAdminDriveStatus(code).catch(() => null),
      ])
      setConfig(configBody.config || {})
      setClasses(configBody.classes || [])
      setTeachers(teacherBody.teachers || [])
      setWorkspaceTeacherCount(teacherBody.workspace_teacher_count || 0)
      if (teacherBody.synced_now) {
        setNotice('ซิงก์รายชื่อครูจาก workspace ให้อัตโนมัติแล้ว')
      }
      setDrive(driveBody)
    } catch (e) {
      setError(e.message || 'โหลดข้อมูลไม่สำเร็จ')
    } finally {
      setLoading(false)
    }
  }, [code, loggedIn])

  useEffect(() => { loadBase() }, [loadBase])

  const reloadTeachers = useCallback(async () => {
    try {
      const body = await fetchAdminTeachers(code)
      setTeachers(body.teachers || [])
      setWorkspaceTeacherCount(body.workspace_teacher_count || 0)
    } catch (e) {
      setError(e.message)
    }
  }, [code])

  const depts = useMemo(
    () => Array.from(new Set(teachers.map((t) => t.dept).filter(Boolean))).sort(),
    [teachers],
  )

  async function togglePublish() {
    try {
      const next = !config?.is_published
      const updated = await updateAdminConfig(code, { is_published: next })
      setConfig(updated.config)
      setNotice(next ? 'เผยแพร่พอร์ทัลแล้ว — ครูเปิดลิงก์ได้' : 'ปิดพอร์ทัลแล้ว — ครูเปิดลิงก์ไม่ได้')
    } catch (e) {
      setError(e.message)
    }
  }

  if (!code) {
    return (
      <PortalCodeEntry
        title="เปิดหน้าตรวจงาน"
        description="กรอกรหัสพอร์ทัลของ workspace (ดูได้จากหน้าแรก หรือลิงก์ที่ครูใช้)"
        cta="เปิดหน้าตรวจงาน"
        onSubmit={(next) => { window.location.href = `/admin?w=${next}` }}
      />
    )
  }

  if (!loggedIn) return <LoginWall code={code} />

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="bg-white border-b border-slate-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-3 flex flex-wrap items-center gap-3">
          <a
            href="/"
            className="min-h-[38px] px-2.5 rounded-lg border border-slate-300 text-sm font-semibold text-slate-700 inline-flex items-center gap-1.5 hover:bg-slate-50"
            title="กลับหน้าหลัก"
          >
            <Home className="w-4 h-4" />
            <span className="hidden sm:inline">หน้าหลัก</span>
          </a>

          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
              พอร์ทัลโรงเรียน · ฝ่ายวิชาการ
            </p>
            <h1 className="text-lg font-bold text-slate-800 truncate">
              {config?.school_name || 'ตรวจงานและแจ้งเตือน'}
            </h1>
          </div>

          <div className="ml-auto flex flex-wrap items-center gap-2">
            <button
              onClick={() => {
                copyText(portalUrl)
                setCopied(true)
                setTimeout(() => setCopied(false), 1500)
              }}
              className="min-h-[38px] px-3 rounded-lg border border-slate-300 text-sm font-semibold text-slate-700 inline-flex items-center gap-1.5"
              title={portalUrl}
            >
              {copied ? <Check className="w-4 h-4 text-emerald-600" /> : <Link2 className="w-4 h-4" />}
              คัดลอกลิงก์พอร์ทัล
            </button>
            <button
              onClick={togglePublish}
              className={`min-h-[38px] px-3 rounded-lg text-sm font-bold ${
                config?.is_published ? 'bg-emerald-600 text-white' : 'bg-slate-200 text-slate-700'
              }`}
            >
              {config?.is_published ? 'เผยแพร่แล้ว' : 'ยังไม่เผยแพร่'}
            </button>
            <a
              href={portalUrl}
              target="_blank"
              rel="noreferrer"
              className="min-h-[38px] px-3 rounded-lg border border-slate-300 text-sm font-semibold text-slate-700 inline-flex items-center gap-1.5"
            >
              <ExternalLink className="w-4 h-4" /> เปิดพอร์ทัล
            </a>
          </div>
        </div>

        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex gap-1 overflow-x-auto">
          {TABS.map((item) => {
            const Icon = item.icon
            return (
              <button
                key={item.id}
                onClick={() => setTab(item.id)}
                className={`min-h-[42px] px-3 inline-flex items-center gap-1.5 text-sm font-semibold border-b-2 whitespace-nowrap ${
                  tab === item.id
                    ? 'border-blue-600 text-blue-700'
                    : 'border-transparent text-slate-500 hover:text-slate-700'
                }`}
              >
                <Icon className="w-4 h-4" /> {item.label}
              </button>
            )
          })}
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-5 space-y-4">
        {notice && (
          <div className="rounded-xl border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-800 flex items-center justify-between gap-2">
            <span>{notice}</span>
            <button onClick={() => setNotice(null)} className="text-xs text-blue-600 font-semibold">ปิด</button>
          </div>
        )}
        {error && (
          <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700 flex items-start gap-2">
            <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
            <span className="flex-1">{error}</span>
            <button onClick={() => setError(null)} className="text-xs font-semibold">ปิด</button>
          </div>
        )}
        {config?.is_published && drive?.warning && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
            ⚠ {drive.warning}
          </div>
        )}

        {loading && (
          <div className="flex items-center gap-2 text-sm text-slate-500">
            <Loader2 className="w-4 h-4 animate-spin" /> กำลังโหลด…
          </div>
        )}

        {!loading && (
          <>
            {tab === 'events' && (
              <AdminEventsTab
                code={code}
                teachers={teachers}
                depts={depts}
                classes={classes}
                onError={setError}
                onNotice={setNotice}
              />
            )}
            {tab === 'tasks' && (
              <AdminTasksTab
                code={code}
                teachers={teachers}
                depts={depts}
                onError={setError}
                onNotice={setNotice}
              />
            )}
            {tab === 'teachers' && (
              <AdminTeachersTab
                code={code}
                teachers={teachers}
                workspaceTeacherCount={workspaceTeacherCount}
                onRefresh={reloadTeachers}
                onError={setError}
                onNotice={setNotice}
              />
            )}
            {tab === 'settings' && (
              <AdminSettingsTab
                code={code}
                config={config}
                drive={drive}
                onRefresh={loadBase}
                onError={setError}
                onNotice={setNotice}
              />
            )}
          </>
        )}
      </main>
    </div>
  )
}
