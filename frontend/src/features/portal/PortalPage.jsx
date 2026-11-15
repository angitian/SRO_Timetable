import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  CalendarDays, Bell, Users, Loader2, AlertCircle, RefreshCw, Inbox, ListChecks,
} from 'lucide-react'
import {
  fetchPortal,
  fetchPortalNotifications,
  fetchPortalSubmissions,
  fetchPortalSubstitutions,
  fetchPortalTasks,
  markAllPortalNotificationsRead,
  markPortalNotificationRead,
} from '../../api/portal.js'
import PortalCodeEntry from './PortalCodeEntry.jsx'
import PortalCalendar from './PortalCalendar.jsx'
import PortalTasks from './PortalTasks.jsx'
import {
  filterSubstitutionsForTeacher,
  formatThaiDateLong,
  formatThaiDateTime,
  readStoredTeacher,
  todayISO,
  writeStoredTeacher,
} from './portalUtils.js'

const TABS = [
  { id: 'calendar', label: 'ปฏิทิน', icon: CalendarDays },
  { id: 'tasks', label: 'งานของฉัน', icon: ListChecks },
  { id: 'subs', label: 'สอนแทน', icon: Users },
  { id: 'inbox', label: 'แจ้งเตือน', icon: Bell },
]

function initialTab() {
  const wanted = new URLSearchParams(window.location.search).get('tab')
  return TABS.some((item) => item.id === wanted) ? wanted : 'calendar'
}

export default function PortalPage() {
  const params = useMemo(() => new URLSearchParams(window.location.search), [])
  const [code, setCode] = useState(() => (params.get('w') || '').trim().toUpperCase())
  const focusTaskId = params.get('task') || ''

  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [tab, setTab] = useState(initialTab)
  const [teacherId, setTeacherId] = useState('')
  const [tasks, setTasks] = useState([])
  const [submissions, setSubmissions] = useState([])
  const [notifications, setNotifications] = useState([])
  const [subsDate, setSubsDate] = useState(todayISO())
  const [subs, setSubs] = useState(null)
  const [onlyMine, setOnlyMine] = useState(false)
  const [notice, setNotice] = useState(null)

  const teacher = useMemo(
    () => (data?.teachers || []).find((t) => t.teacher_id === teacherId) || null,
    [data, teacherId],
  )

  const loadPortal = useCallback(async (portalCode) => {
    if (!portalCode) return
    setLoading(true)
    setError(null)
    try {
      const body = await fetchPortal(portalCode)
      setData(body)
      const stored = readStoredTeacher(portalCode)
      const exists = (body.teachers || []).some((t) => t.teacher_id === stored)
      setTeacherId(exists ? stored : '')
    } catch (e) {
      setError(e.message || 'เปิดพอร์ทัลไม่สำเร็จ')
      setData(null)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (code) loadPortal(code)
  }, [code, loadPortal])

  const loadTeacherData = useCallback(async () => {
    if (!code || !teacherId) {
      setTasks([])
      setSubmissions([])
      setNotifications([])
      return
    }
    try {
      const [taskBody, submissionBody, notificationBody] = await Promise.all([
        fetchPortalTasks(code, teacherId),
        fetchPortalSubmissions(code, teacherId),
        fetchPortalNotifications(code, teacherId),
      ])
      setTasks(taskBody.tasks || [])
      setSubmissions(submissionBody.submissions || [])
      setNotifications(notificationBody.notifications || [])
    } catch (e) {
      setNotice(e.message || 'โหลดข้อมูลไม่สำเร็จ')
    }
  }, [code, teacherId])

  useEffect(() => { loadTeacherData() }, [loadTeacherData])

  const loadSubs = useCallback(async () => {
    if (!code) return
    try {
      setSubs(await fetchPortalSubstitutions(code, subsDate))
    } catch (e) {
      setSubs({ rows: [], absences: [], has_data: false, error: e.message })
    }
  }, [code, subsDate])

  useEffect(() => {
    if (tab === 'subs') loadSubs()
  }, [tab, loadSubs])

  function chooseTeacher(value) {
    setTeacherId(value)
    writeStoredTeacher(code, value)
  }

  function switchTab(next) {
    setTab(next)
    const url = new URL(window.location.href)
    url.searchParams.set('tab', next)
    url.searchParams.delete('task')
    window.history.replaceState({}, '', url)
  }

  async function markRead(id) {
    try {
      await markPortalNotificationRead(code, id, teacherId)
      setNotifications((rows) => rows.map((n) => (n.id === id ? { ...n, read_at: 'now' } : n)))
    } catch { /* ignore */ }
  }

  async function markAllRead() {
    try {
      await markAllPortalNotificationsRead(code, teacherId)
      setNotifications((rows) => rows.map((n) => ({ ...n, read_at: n.read_at || 'now' })))
    } catch { /* ignore */ }
  }

  if (!code) {
    return (
      <PortalCodeEntry
        onSubmit={(next) => {
          window.history.replaceState({}, '', `/portal?w=${next}`)
          setCode(next)
        }}
      />
    )
  }

  const unread = notifications.filter((n) => !n.read_at).length
  const visibleSubs = onlyMine
    ? filterSubstitutionsForTeacher(subs?.rows || [], teacherId)
    : (subs?.rows || [])

  return (
    <div className="min-h-screen bg-slate-50 pb-28 overflow-x-hidden">
      <header className="bg-white border-b border-slate-200 sticky top-0 z-10">
        <div className="px-4 pt-3 pb-2">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
            พอร์ทัลโรงเรียน
          </p>
          <h1 className="text-lg font-bold text-slate-800 leading-tight truncate">
            {data?.workspace?.school_name || 'กำลังโหลด…'}
          </h1>
          <p className="text-xs text-slate-500 mt-0.5">{formatThaiDateLong(data?.today || todayISO())}</p>
        </div>
      </header>

      <main className={`w-full px-4 py-4 space-y-4 mx-auto ${tab === 'calendar' ? 'max-w-6xl' : 'max-w-2xl'}`}>
        {loading && (
          <div className="flex items-center gap-2 text-sm text-slate-500">
            <Loader2 className="w-4 h-4 animate-spin" /> กำลังโหลดพอร์ทัล…
          </div>
        )}

        {error && (
          <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700 space-y-2">
            <div className="flex items-start gap-2">
              <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
              <span>{error}</span>
            </div>
            <button
              onClick={() => loadPortal(code)}
              className="inline-flex items-center gap-1 rounded-lg bg-white border border-rose-200 px-3 py-1.5 text-xs font-semibold"
            >
              <RefreshCw className="w-3.5 h-3.5" /> ลองใหม่
            </button>
          </div>
        )}

        {notice && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 flex items-start justify-between gap-2">
            <span className="flex-1">{notice}</span>
            <button onClick={() => setNotice(null)} className="font-semibold">ปิด</button>
          </div>
        )}

        {data && (
          <>
            <section className="bg-white rounded-2xl border border-slate-200 p-4">
              <label className="block">
                <span className="text-sm font-semibold text-slate-700">ชื่อของฉัน</span>
                <select
                  value={teacherId}
                  onChange={(e) => chooseTeacher(e.target.value)}
                  className="mt-1.5 w-full min-h-[48px] rounded-xl border border-slate-300 px-3 text-base bg-white"
                >
                  <option value="">— เลือกชื่อครู —</option>
                  {(data.depts || []).length
                    ? (data.depts || []).map((dept) => (
                        <optgroup key={dept} label={dept}>
                          {data.teachers
                            .filter((t) => (t.dept || '') === dept)
                            .map((t) => (
                              <option key={t.teacher_id} value={t.teacher_id}>{t.display_name}</option>
                            ))}
                        </optgroup>
                      ))
                    : data.teachers.map((t) => (
                        <option key={t.teacher_id} value={t.teacher_id}>{t.display_name}</option>
                      ))}
                  {(data.teachers || []).some((t) => !t.dept) && (
                    <optgroup label="ยังไม่ระบุกลุ่มสาระ">
                      {data.teachers
                        .filter((t) => !t.dept)
                        .map((t) => (
                          <option key={t.teacher_id} value={t.teacher_id}>{t.display_name}</option>
                        ))}
                    </optgroup>
                  )}
                </select>
              </label>
              {teacher && !teacher.has_pin && (
                <p className="mt-2 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-2 py-1.5">
                  ยังไม่ได้ตั้ง PIN — ติดต่อฝ่ายวิชาการก่อนส่งไฟล์
                </p>
              )}
            </section>

            {tab === 'calendar' && (
              <PortalCalendar
                code={code}
                teacherId={teacherId}
                onOpenTask={(taskId) => {
                  switchTab('tasks')
                  setNotice(null)
                  window.history.replaceState({}, '', `/portal?w=${code}&tab=tasks&task=${taskId}`)
                }}
              />
            )}

            {tab === 'tasks' && (
              <PortalTasks
                code={code}
                teacher={teacher}
                tasks={tasks}
                submissions={submissions}
                focusTaskId={focusTaskId}
                onRefresh={loadTeacherData}
              />
            )}

            {tab === 'subs' && (
              <section className="space-y-3">
                <div className="flex items-center gap-2">
                  <input
                    type="date"
                    value={subsDate}
                    onChange={(e) => setSubsDate(e.target.value)}
                    className="min-h-[44px] flex-1 rounded-xl border border-slate-300 px-3 text-sm"
                  />
                  <button
                    onClick={() => setOnlyMine((v) => !v)}
                    disabled={!teacherId}
                    className={`min-h-[44px] px-3 rounded-xl border text-xs font-semibold
                      ${onlyMine ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-slate-600 border-slate-300'}`}
                  >
                    เฉพาะของฉัน
                  </button>
                </div>

                {!subs && <p className="text-sm text-slate-500">กำลังโหลด…</p>}
                {subs && !subs.has_data && (
                  <p className="text-sm text-slate-500">ไม่มีตารางสอนแทนของวันนี้</p>
                )}
                {subs?.absences?.length > 0 && (
                  <div className="rounded-2xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
                    ครูที่ลา: {subs.absences.map((a) => a.teacher_name).join(', ')}
                  </div>
                )}
                {visibleSubs.map((row) => (
                  <article key={row.id} className="bg-white rounded-2xl border border-slate-200 p-4">
                    <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
                      <span className="text-xs font-semibold text-blue-700">{row.period_label}</span>
                      <span className="text-xs text-slate-500">{row.class_name}</span>
                    </div>
                    <p className="text-sm font-bold text-slate-800 mt-1">{row.subject_name}</p>
                    <p className="text-xs text-slate-600 mt-1">
                      {row.absent_teacher_name} → <span className="font-semibold">{row.substitute_name}</span>
                      {row.substitute_kind === 'trainee' ? ' (นศ.ฝึกสอน)' : ''}
                    </p>
                    {row.reason && <p className="text-[11px] text-slate-500 mt-1">เหตุผล: {row.reason}</p>}
                  </article>
                ))}
              </section>
            )}

            {tab === 'inbox' && (
              <section className="space-y-2">
                <div className="flex items-center justify-between">
                  <h2 className="text-sm font-bold text-slate-700">
                    กล่องแจ้งเตือน {unread > 0 && <span className="text-rose-600">({unread})</span>}
                  </h2>
                  {notifications.length > 0 && (
                    <button onClick={markAllRead} className="text-xs font-semibold text-blue-600">
                      อ่านทั้งหมด
                    </button>
                  )}
                </div>
                {!teacherId && (
                  <p className="text-sm text-slate-500">เลือกชื่อครูด้านบนเพื่อดูการแจ้งเตือน</p>
                )}
                {teacherId && notifications.length === 0 && (
                  <div className="rounded-2xl border border-slate-200 bg-white p-6 text-center text-sm text-slate-500">
                    <Inbox className="w-6 h-6 mx-auto text-slate-300" />
                    ยังไม่มีการแจ้งเตือน
                  </div>
                )}
                {notifications.map((item) => (
                  <button
                    key={item.id}
                    onClick={() => markRead(item.id)}
                    className={`w-full text-left rounded-2xl border p-4 ${
                      item.read_at ? 'bg-white border-slate-200' : 'bg-blue-50 border-blue-200'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <span className="text-sm font-bold text-slate-800">{item.title}</span>
                      {!item.read_at && <span className="w-2 h-2 rounded-full bg-blue-500 mt-1.5 shrink-0" />}
                    </div>
                    {item.body && <p className="text-xs text-slate-600 mt-1 whitespace-pre-line">{item.body}</p>}
                    <p className="text-[11px] text-slate-400 mt-1">{formatThaiDateTime(item.created_at)}</p>
                  </button>
                ))}
              </section>
            )}
          </>
        )}
      </main>

      <nav className="fixed bottom-0 inset-x-0 z-30 bg-white border-t border-slate-200 pb-[env(safe-area-inset-bottom)] shadow-[0_-4px_16px_rgba(15,23,42,0.04)]">
        <div className="max-w-6xl mx-auto grid grid-cols-4">
          {TABS.map((item) => {
            const Icon = item.icon
            const active = tab === item.id
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => switchTab(item.id)}
                aria-current={active ? 'page' : undefined}
                className={`min-h-[68px] flex flex-col items-center justify-center gap-1 text-xs font-semibold
                  ${active ? 'text-blue-600' : 'text-slate-500'}`}
              >
                <span className="relative">
                  <Icon className="w-6 h-6" />
                  {item.id === 'inbox' && unread > 0 && (
                    <span className="absolute -top-1 -right-2 min-w-[16px] h-4 px-1 rounded-full bg-rose-500 text-white text-[10px] leading-4 text-center">
                      {unread}
                    </span>
                  )}
                </span>
                {item.label}
              </button>
            )
          })}
        </div>
      </nav>
    </div>
  )
}
