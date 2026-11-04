import { useState, useRef, useCallback, useEffect } from 'react'
import {
  Plus, FolderOpen, Check, AlertCircle, Zap,
  Printer, ShieldCheck, Cloud, Loader2, Trash2,
  History, Download, Rocket, CalendarDays, Users, X, Lock, Globe, GraduationCap,
} from 'lucide-react'
import { useApp } from '../context/AppContext.jsx'
import TeamDialog from '../components/modals/TeamDialog.jsx'
import WorkspaceMembersDialog from '../components/modals/WorkspaceMembersDialog.jsx'
import { formatSnapshotDate } from '../utils/versionManager.js'
import { formatLastSync } from '../utils/cache.js'
import { listMyTraineeWorkspaces } from '../api/client.js'

const FEATURES = [
  {
    icon: Zap,
    title: 'Auto-Solver',
    desc: 'จัดตารางและล็อกห้องพิเศษ/ครูผู้สอนอัตโนมัติ',
    accent: 'amber',
  },
  {
    icon: Printer,
    title: 'Print Studio',
    desc: 'ส่งออก A4 สวยงาม พร้อม QR Code สแกนดูตาราง',
    accent: 'blue',
  },
  {
    icon: ShieldCheck,
    title: 'Data Privacy',
    desc: 'ประมวลผลบนเบราว์เซอร์ 100% ข้อมูลปลอดภัยบนเครื่องคุณ',
    accent: 'emerald',
  },
]

const ACCENT_STYLES = {
  amber: { icon: 'text-amber-600', bg: 'bg-amber-50', ring: 'ring-amber-100' },
  blue: { icon: 'text-blue-600', bg: 'bg-blue-50', ring: 'ring-blue-100' },
  emerald: { icon: 'text-emerald-600', bg: 'bg-emerald-50', ring: 'ring-emerald-100' },
  violet: { icon: 'text-violet-600', bg: 'bg-violet-50', ring: 'ring-violet-100' },
}

export default function LandingPage() {
  const {
    createNewWorkspace, importSnapshot, selectFixture,
    user, listCloudWorkspaces, loadFromCloud, deleteFromCloud, cloudWorkspaces, cloudSyncing,
    // Workspace snapshots saved in this browser
    snapshots, loadSnapshot, deleteSnapshot, exportSnapshot,
    // Resume last session from IndexedDB cache
    cacheHint, resumeFromCache,
    fixtureData, result, setStep, updateManagerEmails, updateWorkspaceAccess,
    teamInfo, activeWorkspace, activeTraineeWorkspace, setActiveTraineeWorkspace,
    canEditWorkspace, myWorkspaceRole, myTraineeRole,
  } = useApp()
  const fileInputRef = useRef(null)
  const [toast, setToast] = useState(null) // { type: 'ok'|'err', msg }
  const [showCloudModal, setShowCloudModal] = useState(false)
  const [cloudLoading, setCloudLoading] = useState(false)
  const [showNewModal, setShowNewModal] = useState(false)
  const [newTitle, setNewTitle] = useState('')
  const [managerWs, setManagerWs] = useState(null) // cloud ws being share-edited
  const [showTeam, setShowTeam] = useState(false)
  const [traineeModules, setTraineeModules] = useState([])
  const [traineeModulesLoading, setTraineeModulesLoading] = useState(false)
  const [showTraineePicker, setShowTraineePicker] = useState(false)

  // Trainee modules have their own ACL, so they need a separate list. This is
  // also what lets a trainee-only manager open the module without workspace
  // edit access.
  useEffect(() => {
    if (!user) {
      setTraineeModules([])
      return
    }
    let cancelled = false
    setTraineeModulesLoading(true)
    listMyTraineeWorkspaces()
      .then((rows) => { if (!cancelled) setTraineeModules(rows || []) })
      .catch(() => { if (!cancelled) setTraineeModules([]) })
      .finally(() => { if (!cancelled) setTraineeModulesLoading(false) })
    return () => { cancelled = true }
  }, [user])

  const showToast = useCallback((type, msg) => {
    setToast({ type, msg })
    setTimeout(() => setToast(null), 4000)
  }, [])

  // "สร้างตารางใหม่" opens a small title dialog first — the actual work
  // happens in createNewWorkspace(), which auto-saves the current workspace
  // before resetting, so a second timetable never overwrites the first.
  function handleCreateNew() {
    setNewTitle(`ตารางใหม่ ${new Date().toLocaleDateString('th-TH', { day: 'numeric', month: 'short' })}`)
    setShowNewModal(true)
  }

  function handleConfirmCreate() {
    const result = createNewWorkspace(newTitle)
    setShowNewModal(false)
    if (!result?.ok) {
      showToast('err', result?.error || 'สร้างตารางใหม่ไม่สำเร็จ')
      return
    }
    if (result.savedLabel) {
      showToast('ok', `บันทึก "${result.savedLabel}" ไว้ในรายการงานแล้ว`)
    }
  }

  async function handleFile(file) {
    if (!file) return
    // Quick extension check
    if (!file.name.endsWith('.json')) {
      showToast('err', 'รูปแบบไฟล์ไม่ถูกต้อง กรุณาใช้ไฟล์สำรอง (.json) ของระบบ')
      return
    }
    const result = await importSnapshot(file)
    if (result?.ok) {
      showToast('ok', 'โหลดข้อมูลตารางสำเร็จ')
    } else {
      showToast('err', result?.error || 'รูปแบบไฟล์ไม่ถูกต้อง กรุณาใช้ไฟล์สำรอง (.json) ของระบบ')
    }
  }

  async function handleFileChange(e) {
    const file = e.target.files?.[0]
    if (file) await handleFile(file)
    e.target.value = ''
  }

  function handleLoadDemo() {
    selectFixture('primary_mock')
    showToast('ok', 'กำลังโหลดข้อมูลตัวอย่าง...')
  }

  function handleDownloadTemplate() {
    window.open('/samples/ตัวอย่างข้อมูลการเรียน.xlsx', '_blank')
  }

  async function handleOpenCloud() {
    if (!user) {
      showToast('err', 'กรุณาเข้าสู่ระบบเพื่อเปิดตารางจากคลาวด์')
      return
    }
    setShowCloudModal(true)
    setCloudLoading(true)
    try {
      await listCloudWorkspaces()
    } catch (e) {
      showToast('err', 'โหลดรายการตารางไม่สำเร็จ')
    } finally {
      setCloudLoading(false)
    }
  }

  async function handleLoadCloudWorkspace(id) {
    const result = await loadFromCloud(id, { stayOnLanding: true })
    if (result.ok) {
      setShowCloudModal(false)
      showToast('ok', 'เลือกงานปัจจุบันแล้ว — เลือกงานที่จะทำต่อได้เลย')
    } else {
      showToast('err', result.error || 'โหลดไม่สำเร็จ')
    }
  }

  async function handleDeleteCloudWorkspace(id, title) {
    if (!confirm(`ยืนยันการลบ "${title}" จากคลาวด์?`)) return
    const result = await deleteFromCloud(id)
    if (result.ok) {
      showToast('ok', `ลบ "${title}" แล้ว`)
    } else {
      showToast('err', result.error || 'ลบไม่สำเร็จ')
    }
  }

  // ── Resume last session from IndexedDB cache ─────────────────────────
  async function handleResume() {
    if (!cacheHint) return
    const result = await resumeFromCache(cacheHint.cacheKey)
    if (result.ok) {
      showToast('ok', 'โหลดงานล่าสุดแล้ว')
    } else {
      showToast('err', result.error || 'โหลดงานล่าสุดไม่สำเร็จ')
    }
  }

  // ── Local workspace snapshot actions ─────────────────────────────────
  function handleOpenSnapshot(id) {
    const result = loadSnapshot(id, { stayOnLanding: true })
    if (result.ok) {
      showToast('ok', 'เลือกงานปัจจุบันแล้ว — เลือกงานที่จะทำต่อได้เลย')
    } else {
      showToast('err', result.error || 'เปิดไม่สำเร็จ')
    }
  }

  function handleExportSnapshot(id) {
    exportSnapshot(id)
    showToast('ok', 'ดาวน์โหลดไฟล์ .json สำรองแล้ว')
  }

  function handleDeleteSnapshot(id, label) {
    if (!confirm(`ยืนยันการลบ "${label}"?`)) return
    const ok = deleteSnapshot(id)
    if (ok) {
      showToast('ok', `ลบ "${label}" แล้ว`)
    } else {
      showToast('err', 'ลบไม่สำเร็จ')
    }
  }

  function handleContinueCurrent() {
    if (!activeWorkspace) {
      showToast('err', 'ยังไม่มีงานปัจจุบัน — เลือกงานหรือสร้างตารางใหม่ก่อน')
      return
    }
    if (result) setStep(5)
    else if (fixtureData) setStep(3)
    else setStep(1)
  }

  function handleOpenTraineeModule(module = null) {
    const target = module || traineeModules[0]
    if (!target && !activeWorkspace && !activeTraineeWorkspace) {
      showToast('err', 'ต้องมี workspace หรือสิทธิ์โมดูลนักศึกษาก่อน')
      return
    }
    if (!target && activeTraineeWorkspace) {
      setStep(9)
      return
    }
    if (!target && activeWorkspace && myTraineeRole !== 'none') {
      setStep(9)
      return
    }
    if (!target && myTraineeRole === 'none' && !canEditWorkspace) {
      showToast('err', 'คุณไม่มีสิทธิ์จัดการโมดูลนักศึกษาใน workspace นี้')
      return
    }
    if (!target && traineeModules.length > 1) {
      setShowTraineePicker(true)
      return
    }
    if (target) {
      setActiveTraineeWorkspace({
        timetableId: target.timetable_id,
        title: target.title || target.timetable_title,
        linkedTimetableTitle: target.timetable_title || target.title,
        myTraineeRole: target.my_trainee_role,
      })
    }
    setStep(9)
  }

  // Merge local workspace snapshots + cloud workspaces into ONE list sorted
  // by last-modified — the user sees "งาน/ตารางของฉัน" regardless of where
  // each timetable is stored.
  const localItems = snapshots.map((s) => ({
    type: 'local',
    id: s.id,
    title: s.label,
    status: s.status,
    updatedAt: s.updatedAt || 0,
    counts: s.counts,
  }))
  const cloudItems = (user ? cloudWorkspaces : []).map((w) => ({
    type: 'cloud',
    id: w.id,
    title: w.title,
    updatedAt: w.updated_at ? new Date(w.updated_at).getTime() : 0,
    academic_year: w.academic_year,
    term: w.term,
    user_id: w.user_id || null,
    manager_emails: w.manager_emails || [],
    access_mode: w.access_mode || 'team',
    owner_name: w.owner_name || null,
    owner_email: w.owner_email || null,
    my_workspace_role: w.my_workspace_role || null,
    my_trainee_role: w.my_trainee_role || 'none',
  }))
  const allItems = [...localItems, ...cloudItems].sort((a, b) => b.updatedAt - a.updatedAt)
  // Show the "ทำงานต่อ" card only when the cache is newer than every saved
  // workspace — otherwise the newest workspace card already covers it.
  const showResumeCard = Boolean(cacheHint) &&
    (allItems.length === 0 || cacheHint.lastCachedAt > Math.max(...allItems.map((i) => i.updatedAt)))
  const hasRecent = showResumeCard || allItems.length > 0

  return (
    <div className="min-h-[calc(100vh-3.5rem)] bg-gradient-to-br from-blue-50 via-white to-indigo-50 flex flex-col">

      <div className="w-full max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-6 flex-1 flex flex-col justify-center">
        {/* ── Hero Title Section ─────────────────────────────────────── */}
        <div className="text-center">
          <h1 className="text-3xl md:text-4xl font-extrabold text-slate-800 tracking-tight mb-3">
            ระบบจัดตารางสอนอัตโนมัติ
          </h1>
          <p className="text-base md:text-lg text-slate-600 max-w-2xl mx-auto leading-normal mb-8">
            จัดตารางรวดเร็ว ตรวจจับคาบชนอัตโนมัติ ส่งออกเอกสาร A4 พร้อมพิมพ์ และเปิดดูออนไลน์ผ่าน QR Code
          </p>
        </div>

        {/* ── Team membership banner (ผู้ถูกเพิ่มเข้าทีม) ─────────────── */}
        {teamInfo?.memberships?.length > 0 && (
          <div className="w-full max-w-4xl mx-auto mb-4 flex items-start gap-2 rounded-xl border border-violet-200 bg-violet-50 px-4 py-3">
            <Users className="w-4 h-4 text-violet-600 shrink-0 mt-0.5" />
            <p className="text-sm text-violet-800 leading-relaxed">
              คุณมีสิทธิ์ใช้งานทีมของ{' '}
              <span className="font-semibold">
                {teamInfo.memberships
                  .map((m) => m.owner_name || m.owner_email || m.owner_id)
                  .join(', ')}
              </span>
              {' '}— ตารางที่แชร์ให้คุณอยู่ในรายการ &quot;งาน/ตารางของฉัน&quot; ด้านล่าง เปิดใช้งานต่อได้ทันที
            </p>
          </div>
        )}

        {/* ── Current workspace ──────────────────────────────────────── */}
        <div className="w-full max-w-4xl mx-auto mb-5">
          {activeWorkspace ? (
            <div className="rounded-2xl border border-blue-200 bg-white shadow-sm p-4 sm:p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex items-start gap-3 min-w-0">
                  <div className="w-10 h-10 rounded-xl bg-blue-50 ring-1 ring-blue-100 flex items-center justify-center shrink-0">
                    {activeWorkspace.kind === 'cloud'
                      ? <Cloud className="w-5 h-5 text-violet-600" />
                      : <CalendarDays className="w-5 h-5 text-blue-600" />}
                  </div>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-[11px] font-bold uppercase tracking-wide text-blue-600">
                        งานปัจจุบัน
                      </span>
                      <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold ${
                        myWorkspaceRole === 'owner'
                          ? 'bg-violet-100 text-violet-700'
                          : myWorkspaceRole === 'editor'
                            ? 'bg-emerald-100 text-emerald-700'
                            : 'bg-slate-100 text-slate-600'
                      }`}>
                        {myWorkspaceRole === 'owner' ? 'เจ้าของ' : myWorkspaceRole === 'editor' ? 'แก้ไขได้' : 'อ่านอย่างเดียว'}
                      </span>
                    </div>
                    <h2 className="text-lg font-bold text-slate-900 truncate">{activeWorkspace.title}</h2>
                    <p className="text-xs text-slate-500 mt-0.5">
                      {activeWorkspace.kind === 'cloud' ? 'บันทึกบนคลาวด์' : 'บันทึกในเบราว์เซอร์นี้'}
                      {activeWorkspace.updatedAt ? ` · แก้ไขล่าสุด ${formatSnapshotDate(activeWorkspace.updatedAt)}` : ''}
                      {fixtureData ? ` · ครู ${fixtureData.teachers?.length || 0} · ห้อง ${fixtureData.classes?.length || 0}` : ''}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    onClick={handleContinueCurrent}
                    className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-bold bg-blue-600 text-white hover:bg-blue-700 transition-colors"
                  >
                    <Rocket className="w-4 h-4" />
                    ทำงานต่อ
                  </button>
                  <button
                    onClick={() => document.getElementById('workspace-list')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
                    className="px-3 py-2 rounded-lg text-sm font-semibold text-slate-600 bg-slate-100 hover:bg-slate-200 transition-colors"
                  >
                    เปลี่ยนงาน
                  </button>
                </div>
              </div>
              <p className="text-[11px] text-slate-400 mt-3">
                ทุกขั้นตอนจะทำงานจากงานนี้ จนกว่าคุณจะเลือกงานอื่นหรือสร้างตารางใหม่
              </p>
            </div>
          ) : activeTraineeWorkspace ? (
            <div className="rounded-2xl border border-violet-200 bg-white shadow-sm p-4 sm:p-5">
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <div className="flex items-start gap-3 min-w-0">
                  <div className="w-10 h-10 rounded-xl bg-violet-50 ring-1 ring-violet-100 flex items-center justify-center shrink-0">
                    <GraduationCap className="w-5 h-5 text-violet-600" />
                  </div>
                  <div className="min-w-0">
                    <div className="text-[11px] font-bold uppercase tracking-wide text-violet-600">โมดูลนักศึกษาฝึกสอน</div>
                    <h2 className="text-lg font-bold text-slate-900 truncate">
                      {activeTraineeWorkspace.title || activeTraineeWorkspace.linkedTimetableTitle}
                    </h2>
                    <p className="text-xs text-slate-500">ตาราง: {activeTraineeWorkspace.linkedTimetableTitle || '—'}</p>
                  </div>
                </div>
                <button
                  onClick={() => setStep(9)}
                  className="px-4 py-2 rounded-lg text-sm font-bold bg-violet-600 text-white hover:bg-violet-700"
                >
                  เปิดโมดูล
                </button>
              </div>
            </div>
          ) : (
            <div className="rounded-2xl border border-dashed border-slate-300 bg-white/70 p-4 text-sm text-slate-500">
              ยังไม่มีงานปัจจุบัน — สร้างตารางใหม่หรือเลือกงานจากรายการด้านล่าง
            </div>
          )}
        </div>

        {/* ── เลือกงานที่จะทำ (4 การ์ด) ────────────────────────────── */}
        <div className="w-full max-w-4xl mx-auto mb-6">
          <h2 className="text-base font-bold text-slate-700 mb-3 flex items-center gap-2">
            <Rocket className="w-4 h-4 text-slate-500" />
            เลือกงานที่จะทำ
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
            {[
              {
                icon: Zap,
                accent: 'amber',
                title: 'จัดตารางสอน',
                desc: 'นำเข้าข้อมูล → ตั้งค่าคาบ → ภาระครู → ตรวจสอบ → จัดตาราง',
                ready: !!activeWorkspace,
                needMsg: 'ต้องเลือกหรือสร้างงานก่อน',
                onClick: () => {
                  if (!activeWorkspace) { showToast('err', 'เลือกงานปัจจุบันก่อน'); return }
                  if (!fixtureData) setStep(1)
                  else if (result) setStep(5)
                  else setStep(3)
                },
              },
              {
                icon: GraduationCap,
                accent: 'violet',
                title: 'นักศึกษาฝึกสอน',
                desc: 'ลงเวลาปฏิบัติงาน จัดการรายชื่อ พี่เลี้ยง วิชา/ชั้น/ห้อง',
                ready: !!activeWorkspace || !!activeTraineeWorkspace || traineeModules.length > 0,
                needMsg: 'ต้องมี workspace หรือสิทธิ์โมดูลนักศึกษา',
                onClick: () => handleOpenTraineeModule(),
              },
              {
                icon: CalendarDays,
                accent: 'blue',
                title: 'จัดการสอนแทน + ภาระงาน',
                desc: 'จัดครูสอนแทนรายวัน ดูตารางสอนแทน สถิติ เหตุผลลา',
                ready: !!result,
                needMsg: 'ต้องจัดตารางหลักก่อน',
                onClick: () => {
                  if (!result) { showToast('err', 'ต้องจัดตารางหลักก่อนใช้ระบบสอนแทน'); return }
                  setStep(7)
                },
              },
              {
                icon: History,
                accent: 'emerald',
                title: 'Dashboard ภาระงานครู',
                desc: 'ภาระสอนปกติ vs สอนแทน + สถิติเหตุผลลา รวมในหน้าเดียว',
                ready: !!fixtureData,
                needMsg: 'ต้องมีข้อมูลตารางก่อน',
                onClick: () => {
                  if (!fixtureData) { showToast('err', 'สร้างหรือเปิดตารางสอนก่อนดู Dashboard'); return }
                  setStep(8)
                },
              },
            ].map((card) => {
              const Icon = card.icon
              const s = ACCENT_STYLES[card.accent]
              return (
                <button
                  key={card.title}
                  onClick={card.onClick}
                  disabled={!card.ready}
                  title={!card.ready ? card.needMsg : ''}
                  className={`p-5 rounded-xl border text-left transition-all relative
                    ${card.ready
                      ? 'border-slate-200 bg-white shadow-sm hover:shadow-md hover:border-blue-300'
                      : 'border-slate-200 bg-slate-50 opacity-60 cursor-not-allowed'}`}
                >
                  <div className={`w-10 h-10 rounded-lg ${s.bg} ${s.ring} ring-1 flex items-center justify-center mb-3`}>
                    <Icon className={`w-5 h-5 ${s.icon}`} />
                  </div>
                  <h3 className="text-base font-bold text-slate-800 mb-1">{card.title}</h3>
                  <p className="text-xs text-slate-500 leading-relaxed">{card.desc}</p>
                  {!card.ready && (
                    <div className="mt-2 text-[10px] text-amber-600 font-medium">⚠ {card.needMsg}</div>
                  )}
                </button>
              )
            })}
          </div>
        </div>

        {/* ── Main Actions ───────────────────────────────────────────── */}
        <div className="w-full max-w-4xl mx-auto border-2 border-dashed border-slate-300 hover:border-slate-400 rounded-2xl p-8 bg-slate-50/50 my-4 transition-all">
          <div className="flex flex-wrap items-center justify-center gap-3 sm:gap-4">
            {/* Primary: Create new */}
            <button
              onClick={handleCreateNew}
              className="flex items-center gap-2 px-6 py-3.5 text-base font-semibold rounded-xl shadow-sm bg-blue-600 text-white hover:bg-blue-700 transition-all whitespace-nowrap"
            >
              <Plus className="w-5 h-5 flex-shrink-0" />
              สร้างตารางใหม่
            </button>

            {/* Secondary: Open from cloud (requires login) */}
            <button
              onClick={handleOpenCloud}
              className={`flex items-center gap-2 px-6 py-3.5 text-base font-semibold rounded-xl shadow-sm transition-all whitespace-nowrap
                ${user
                  ? 'bg-violet-600 text-white hover:bg-violet-700'
                  : 'bg-white text-slate-400 border border-slate-200 cursor-not-allowed'}`}
              title={user ? 'เปิดตารางที่บันทึกไว้บนคลาวด์' : 'เข้าสู่ระบบเพื่อใช้งาน'}
            >
              <Cloud className="w-5 h-5 flex-shrink-0" />
              เปิดจากคลาวด์
            </button>

            {/* Team: add users who share every workspace of this account */}
            {user && (
              <button
                onClick={() => setShowTeam(true)}
                className="flex items-center gap-2 px-5 py-3.5 text-base font-semibold rounded-xl shadow-sm bg-white text-slate-700 border border-slate-300 hover:bg-slate-50 hover:border-violet-300 transition-all whitespace-nowrap"
                title="เพิ่มผู้ใช้ที่ใช้ระบบร่วมกัน (เห็นทุกตารางของคุณ)"
              >
                <Users className="w-5 h-5 flex-shrink-0 text-violet-600" />
                ผู้ใช้ในทีม
              </button>
            )}
          </div>

          {/* Hint text */}
          <p className="mt-4 text-center text-sm text-slate-500">
            งานทั้งหมดถูกบันทึกอัตโนมัติ — เลือกเปิดงานเก่าได้จากรายการ &quot;งาน/ตารางของฉัน&quot; ด้านล่าง
          </p>
        </div>

        {/* ── Help Links ─────────────────────────────────────────────── */}
        <p className="text-sm text-slate-600 mt-4 mb-8 text-center">
          ยังไม่มีไฟล์?
          <button
            onClick={handleLoadDemo}
            className="text-blue-600 font-medium hover:underline mx-1"
          >
            ทดลองข้อมูลตัวอย่าง
          </button>
          หรือ
          <button
            onClick={handleDownloadTemplate}
            className="text-blue-600 font-medium hover:underline mx-1"
          >
            ดาวน์โหลดไฟล์ตัวอย่าง Excel
          </button>
        </p>

        {/* ── My Workspaces (งาน/ตารางของฉัน) ────────────────────────── */}
        {hasRecent && (
          <div id="workspace-list" className="w-full max-w-4xl mx-auto mb-6 scroll-mt-20">
            <h2 className="text-lg font-bold text-slate-800 mb-3 flex items-center gap-2">
              <History className="w-5 h-5 text-slate-500" />
              งาน/ตารางของฉัน
            </h2>
            <div className="space-y-3">
              {/* Resume card — shown only when the cache is newer than every
                  saved workspace */}
              {showResumeCard && (
                <div className="flex items-center gap-3 p-4 rounded-xl border border-blue-200 bg-blue-50/70">
                  <div className="w-10 h-10 rounded-lg bg-blue-100 flex items-center justify-center shrink-0">
                    <Rocket className="w-5 h-5 text-blue-600" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-semibold text-blue-900">
                      คุณมีงานที่ทำค้างไว้ล่าสุด
                    </div>
                    <div className="text-xs text-blue-600">
                      แก้ไขล่าสุด {formatLastSync(cacheHint.lastCachedAt)}
                    </div>
                  </div>
                  <button
                    onClick={handleResume}
                    className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-bold
                      bg-blue-600 text-white hover:bg-blue-700 transition-colors shadow-sm whitespace-nowrap"
                  >
                    <Rocket className="w-4 h-4" />
                    ทำงานต่อทันที
                  </button>
                </div>
              )}

              {/* One unified workspace list — local + cloud, newest first */}
              <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
                <div className="px-4 py-2.5 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
                  <span className="text-xs font-bold text-slate-500">
                    {allItems.length} งาน
                  </span>
                  <span className="text-[10px] text-slate-400">
                    💻 เก็บในเบราว์เซอร์นี้ · ☁️ = บนคลาวด์
                  </span>
                </div>
                <ul className="divide-y divide-slate-100">
                  {allItems.map((item) => {
                    const isActive = activeWorkspace?.kind === item.type && activeWorkspace.id === item.id
                    return (
                    <li key={`${item.type}-${item.id}`} className={`flex items-center gap-2 px-4 py-2.5 transition-colors ${
                      isActive ? 'bg-blue-50/70' : 'hover:bg-slate-50/60'
                    }`}>
                      <button
                        onClick={() => (item.type === 'local'
                          ? handleOpenSnapshot(item.id)
                          : handleLoadCloudWorkspace(item.id))}
                        disabled={item.type === 'cloud' && cloudSyncing}
                        className="flex-1 text-left min-w-0"
                        title={`เปิด "${item.title}"`}
                      >
                        <div className="flex items-center gap-2">
                          {item.type === 'cloud' && (
                            <Cloud className="w-3.5 h-3.5 text-violet-500 shrink-0" />
                          )}
                          <span className="text-sm font-semibold text-slate-800 truncate">{item.title}</span>
                          {isActive && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded-full font-bold shrink-0 bg-blue-100 text-blue-700">
                              ใช้งานอยู่
                            </span>
                          )}
                          {item.type === 'local' && (
                            <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium shrink-0
                              ${item.status === 'final' ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'}`}>
                              {item.status === 'final' ? 'สมบูรณ์' : 'ร่าง'}
                            </span>
                          )}
                          {item.type === 'cloud' && user && item.user_id && item.user_id !== user.id && (
                            <span
                              className="text-[10px] px-1.5 py-0.5 rounded-full font-medium shrink-0 bg-violet-100 text-violet-700 max-w-[140px] truncate"
                              title={`แชร์โดย ${item.owner_email || item.owner_name || 'เจ้าของทีม'}`}
                            >
                              แชร์โดย {item.owner_name || item.owner_email || 'เจ้าของทีม'}
                            </span>
                          )}
                          {item.type === 'cloud' && item.access_mode === 'private' && (
                            <Lock className="w-3 h-3 text-slate-400 shrink-0" title="แชร์เฉพาะรายชื่อ" />
                          )}
                        </div>
                        <div className="text-xs text-slate-400 mt-0.5">
                          {item.type === 'local'
                            ? formatSnapshotDate(item.updatedAt)
                            : item.updatedAt
                              ? new Date(item.updatedAt).toLocaleDateString('th-TH', {
                                  day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
                                })
                              : '—'}
                          {item.type === 'local' && item.counts?.teachers > 0 && (
                            <span> · ครู {item.counts.teachers} · ห้อง {item.counts.classes} · วิชา {item.counts.subjects}</span>
                          )}
                          {item.type === 'cloud' && ` · ปีการศึกษา ${item.academic_year}/${item.term}`}
                        </div>
                      </button>
                      {item.type === 'local' && (
                        <button
                          onClick={() => handleExportSnapshot(item.id)}
                          className="p-2 rounded-lg text-slate-400 hover:text-blue-600 hover:bg-blue-50 transition-colors shrink-0"
                          title="ส่งออกไฟล์ .json สำรอง"
                        >
                          <Download className="w-4 h-4" />
                        </button>
                      )}
                      {item.type === 'cloud' && user && item.user_id === user.id && (
                        <button
                          onClick={() => setManagerWs(item)}
                          className="p-2 rounded-lg text-slate-400 hover:text-violet-600 hover:bg-violet-50 transition-colors shrink-0"
                          title="ตั้งค่าการแชร์ (เจ้าของเท่านั้น)"
                        >
                          <Users className="w-4 h-4" />
                        </button>
                      )}
                      {(item.type === 'local' || (user && item.user_id === user.id)) && (
                        <button
                          onClick={() => (item.type === 'local'
                            ? handleDeleteSnapshot(item.id, item.title)
                            : handleDeleteCloudWorkspace(item.id, item.title))}
                          disabled={item.type === 'cloud' && cloudSyncing}
                          className="p-2 rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50 transition-colors shrink-0"
                          title={item.type === 'local' ? 'ลบงานนี้' : 'ลบจากคลาวด์'}
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      )}
                    </li>
                    )
                  })}
                </ul>
              </div>
            </div>
          </div>
        )}

        {/* ── Backup (.json) — secondary ─────────────────────────────── */}
        <div className="w-full max-w-4xl mx-auto mb-10">
          <input
            ref={fileInputRef}
            type="file"
            accept=".json,application/json"
            onChange={handleFileChange}
            className="hidden"
          />
          <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50/50 px-4 py-3 flex flex-wrap items-center gap-3">
            <FolderOpen className="w-4 h-4 text-slate-400 shrink-0" />
            <div className="flex-1 min-w-[200px]">
              <div className="text-xs font-semibold text-slate-600">ข้อมูลสำรอง (.json)</div>
              <div className="text-[11px] text-slate-400">
                สำหรับสำรองงานไว้ภายนอกหรือย้ายไปเครื่องอื่น — ปกติไม่จำเป็นต้องใช้ ระบบบันทึกอัตโนมัติ
              </div>
            </div>
            <button
              onClick={() => fileInputRef.current?.click()}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-white border border-slate-300 text-slate-600 hover:bg-slate-100 transition-colors"
            >
              <FolderOpen className="w-3.5 h-3.5" />
              นำเข้าไฟล์สำรอง (.json)
            </button>
          </div>
        </div>

        {/* ── Feature Highlight Grid ─────────────────────────────────── */}
        <div className="w-full max-w-4xl mx-auto grid grid-cols-1 md:grid-cols-3 gap-5 mb-10">
          {FEATURES.map((f) => {
            const Icon = f.icon
            const s = ACCENT_STYLES[f.accent]
            return (
              <div
                key={f.title}
                className="p-5 rounded-xl border border-slate-200 bg-white shadow-sm text-left hover:shadow-md transition-all"
              >
                <div className={`w-10 h-10 rounded-lg ${s.bg} ${s.ring} ring-1 flex items-center justify-center mb-3`}>
                  <Icon className={`w-5 h-5 ${s.icon}`} />
                </div>
                <h3 className="text-base font-bold text-slate-800 mb-1">
                  {f.title}
                </h3>
                <p className="text-sm text-slate-600 leading-relaxed">{f.desc}</p>
              </div>
            )
          })}
        </div>

        {/* ── Footer ─────────────────────────────────────────────────── */}
        <footer className="w-full py-4 text-center text-xs text-slate-500 border-t border-slate-100 bg-white">
          <p>
            © 2026 SRO Timetable. Developed by{' '}
            <span className="font-semibold text-slate-700">One Man Lab</span>{' '}
            for{' '}
            <a
              href="https://kru-platform.com"
              target="_blank"
              rel="noreferrer"
              className="font-semibold text-slate-700 hover:text-blue-600 underline decoration-slate-300"
            >
              KRU Platform
            </a>
          </p>
        </footer>
      </div>

      {/* Toast */}
      {toast && (
        <div className={`fixed bottom-8 left-1/2 -translate-x-1/2 z-[110] px-6 py-3.5
          rounded-xl shadow-lg text-base font-medium flex items-center gap-2.5
          ${toast.type === 'ok' ? 'bg-green-600 text-white' : 'bg-red-600 text-white'}`}>
          {toast.type === 'ok'
            ? <Check className="w-5 h-5" />
            : <AlertCircle className="w-5 h-5" />}
          {toast.msg}
        </div>
      )}

      {/* ── Trainee module picker (module ACL may be separate from workspace) ── */}
      {showTraineePicker && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40" onClick={() => setShowTraineePicker(false)} />
          <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-lg p-5 max-h-[80vh] flex flex-col">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-lg font-bold text-gray-900 flex items-center gap-2">
                <GraduationCap className="w-5 h-5 text-violet-600" />
                เลือกโมดูลนักศึกษาฝึกสอน
              </h3>
              <button onClick={() => setShowTraineePicker(false)} className="p-1 rounded-lg text-gray-400 hover:bg-gray-100" aria-label="ปิด">
                <X className="w-4 h-4" />
              </button>
            </div>
            {traineeModulesLoading ? (
              <div className="flex items-center justify-center py-10">
                <Loader2 className="w-6 h-6 text-violet-500 animate-spin" />
              </div>
            ) : traineeModules.length === 0 ? (
              <p className="text-sm text-gray-500 py-8 text-center">
                ยังไม่มีโมดูลที่คุณมีสิทธิ์ — เปิด workspace ที่ต้องการแล้วเริ่มโมดูลใหม่
              </p>
            ) : (
              <div className="space-y-2 overflow-y-auto">
                {traineeModules.map((m) => (
                  <button
                    key={m.timetable_id}
                    onClick={() => {
                      setShowTraineePicker(false)
                      handleOpenTraineeModule(m)
                    }}
                    className="w-full text-left p-3 rounded-xl border border-gray-200 hover:border-violet-300 hover:bg-violet-50/40 transition-colors"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-semibold text-gray-800 truncate">{m.title || m.timetable_title}</span>
                      <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold ${
                        m.my_trainee_role === 'owner'
                          ? 'bg-violet-100 text-violet-700'
                          : m.my_trainee_role === 'editor'
                            ? 'bg-emerald-100 text-emerald-700'
                            : 'bg-slate-100 text-slate-600'
                      }`}>
                        {m.my_trainee_role === 'owner' ? 'เจ้าของ' : m.my_trainee_role === 'editor' ? 'แก้ไข' : 'อ่าน'}
                      </span>
                    </div>
                    <div className="text-xs text-gray-400 mt-0.5">
                      ตาราง: {m.timetable_title || m.title || '—'} · นักศึกษา {m.trainee_count || 0} · บันทึก {m.attendance_count || 0}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── New Workspace Modal ───────────────────────────────────────── */}
      {showNewModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center">
          <div className="absolute inset-0 bg-black/40" onClick={() => setShowNewModal(false)} />
          <div className="relative bg-white rounded-2xl shadow-2xl p-6 max-w-sm w-full mx-4">
            <h3 className="text-lg font-bold text-gray-900 mb-1 flex items-center gap-2">
              <Plus className="w-5 h-5 text-blue-600" />
              สร้างตารางใหม่
            </h3>
            <p className="text-xs text-gray-500 mb-4">
              ตั้งชื่องานนี้ — งานเก่าทั้งหมดจะถูกเก็บไว้ในรายการ &quot;งาน/ตารางของฉัน&quot; ไม่ถูกลบหรือเขียนทับ
            </p>
            <input
              type="text"
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleConfirmCreate() }}
              placeholder="เช่น ตารางภาคเรียนที่ 1/2569"
              className="w-full px-3 py-2.5 rounded-xl border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 mb-4"
              autoFocus
            />
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setShowNewModal(false)}
                className="px-4 py-2 rounded-lg text-sm font-semibold text-slate-600 hover:bg-slate-100 transition-colors"
              >
                ยกเลิก
              </button>
              <button
                onClick={handleConfirmCreate}
                className="px-5 py-2 rounded-lg text-sm font-bold bg-blue-600 text-white hover:bg-blue-700 transition-colors"
              >
                สร้างตาราง
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Cloud Workspace Modal ─────────────────────────────────────── */}
      {showCloudModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center">
          <div className="absolute inset-0 bg-black/40" onClick={() => setShowCloudModal(false)} />
          <div className="relative bg-white rounded-2xl shadow-2xl p-6 max-w-lg w-full mx-4 max-h-[80vh] flex flex-col">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold text-gray-900 flex items-center gap-2">
                <Cloud className="w-5 h-5 text-violet-600" />
                ตารางบนคลาวด์
              </h3>
              <button
                onClick={() => setShowCloudModal(false)}
                className="text-gray-400 hover:text-gray-600 text-xl"
              >
                ✕
              </button>
            </div>

            {cloudLoading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="w-8 h-8 text-violet-500 animate-spin" />
              </div>
            ) : cloudWorkspaces.length === 0 ? (
              <div className="text-center py-12 text-gray-400">
                <Cloud className="w-12 h-12 mx-auto mb-3 opacity-40" />
                <p className="text-sm">ยังไม่มีตารางบนคลาวด์</p>
                <p className="text-xs mt-1">บันทึกจากหน้าตารางสอน (step 5) เพื่อเก็บขึ้นคลาวด์</p>
              </div>
            ) : (
              <div className="overflow-y-auto flex-1 space-y-2">
                {cloudWorkspaces.map((ws) => (
                  <div
                    key={ws.id}
                    className="flex items-center gap-3 p-3 rounded-xl border border-gray-200 hover:border-violet-300 hover:bg-violet-50/30 transition-colors"
                  >
                    <button
                      onClick={() => handleLoadCloudWorkspace(ws.id)}
                      disabled={cloudSyncing}
                      className="flex-1 text-left min-w-0"
                    >
                      <div className="text-sm font-semibold text-gray-800 truncate">
                        {ws.title}
                      </div>
                      <div className="text-xs text-gray-400 mt-0.5">
                        {ws.updated_at
                          ? new Date(ws.updated_at).toLocaleDateString('th-TH', {
                              day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
                            })
                          : '—'}
                        {' · '}
                        ปีการศึกษา {ws.academic_year}/{ws.term}
                        {user && ws.user_id && ws.user_id !== user.id && (
                          <span className="text-violet-600 font-medium">
                            {' · แชร์โดย '}{ws.owner_name || ws.owner_email || 'เจ้าของทีม'}
                          </span>
                        )}
                        {ws.access_mode === 'private' && ' · เฉพาะรายชื่อ'}
                      </div>
                    </button>
                    {user && ws.user_id === user.id && (
                      <button
                        onClick={() => setManagerWs(ws)}
                        className="p-1.5 rounded-lg text-gray-400 hover:text-violet-600 hover:bg-violet-50 transition-colors shrink-0"
                        title="ตั้งค่าการแชร์ (เจ้าของเท่านั้น)"
                      >
                        <Users className="w-4 h-4" />
                      </button>
                    )}
                    {user && ws.user_id === user.id && (
                      <button
                        onClick={() => handleDeleteCloudWorkspace(ws.id, ws.title)}
                        className="p-1.5 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50 transition-colors shrink-0"
                        title="ลบจากคลาวด์"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Share dialog (owner only) ───────────────────────────────── */}
      {managerWs && (
        <WorkspaceMembersDialog
          ws={managerWs}
          onClose={(saved) => {
            setManagerWs(null)
            if (saved) showToast('ok', 'บันทึกสิทธิ์การเข้าถึงแล้ว')
          }}
        />
      )}

      {showTeam && <TeamDialog onClose={() => setShowTeam(false)} />}
    </div>
  )
}

/* ═══ Dialog: ตั้งค่าการแชร์ workspace (owner only) ═══ */
function ShareDialog({ ws, onClose, onSave }) {
  const [mode, setMode] = useState(ws.access_mode || 'team')
  const [emails, setEmails] = useState(ws.manager_emails || [])
  const [input, setInput] = useState('')
  const [saving, setSaving] = useState(false)

  const add = () => {
    const v = input.trim().toLowerCase()
    if (!v || !v.includes('@')) return
    if (!emails.includes(v)) setEmails([...emails, v])
    setInput('')
  }
  const remove = (e) => setEmails(emails.filter((x) => x !== e))
  const handleSave = async () => {
    setSaving(true)
    await onSave({ mode, emails })
    setSaving(false)
  }

  const modes = [
    {
      value: 'team',
      icon: Globe,
      title: 'ทีมของฉัน (ทุกคน)',
      desc: 'สมาชิกทุกคนในทีมเห็นและแก้ไขตารางนี้ได้ — ค่าเริ่มต้น',
    },
    {
      value: 'private',
      icon: Lock,
      title: 'เฉพาะรายชื่อ',
      desc: 'เฉพาะเจ้าของและอีเมลที่ระบุด้านล่างเท่านั้นที่เปิดได้',
    },
  ]

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-md p-5 space-y-4 max-h-[85vh] overflow-y-auto">
        <div className="flex items-center justify-between">
          <h3 className="text-base font-bold text-gray-900 flex items-center gap-2">
            <Users className="w-4 h-4 text-violet-600" />
            ตั้งค่าการแชร์
          </h3>
          <button onClick={onClose} className="p-1 rounded-lg text-gray-400 hover:bg-gray-100" aria-label="ปิด">
            <X className="w-4 h-4" />
          </button>
        </div>
        <p className="text-xs text-gray-500">
          {ws.title} — เลือกว่าจะให้ใครใช้ตารางนี้ร่วมกัน (จัดการสมาชิกทั้งทีมได้ที่เมนู “ผู้ใช้ในทีม”)
        </p>

        <div className="space-y-2">
          {modes.map((m) => {
            const Icon = m.icon
            const active = mode === m.value
            return (
              <button
                key={m.value}
                onClick={() => setMode(m.value)}
                className={`w-full flex items-start gap-3 p-3 rounded-xl border text-left transition-colors
                  ${active ? 'border-violet-400 bg-violet-50' : 'border-gray-200 hover:border-violet-200 hover:bg-gray-50'}`}
              >
                <Icon className={`w-4 h-4 mt-0.5 shrink-0 ${active ? 'text-violet-600' : 'text-gray-400'}`} />
                <div className="min-w-0">
                  <div className={`text-xs font-semibold ${active ? 'text-violet-900' : 'text-gray-700'}`}>{m.title}</div>
                  <div className="text-[11px] text-gray-500 mt-0.5">{m.desc}</div>
                </div>
              </button>
            )
          })}
        </div>

        <div className="pt-1">
          <div className="text-xs font-semibold text-gray-700 mb-1.5">รายชื่อเพิ่มเติม (นอกทีม)</div>
          <div className="flex gap-2">
            <input
              type="email"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') add() }}
              placeholder="teacher@school.ac.th"
              className="flex-1 border border-gray-300 rounded-lg px-3 py-1.5 text-sm"
            />
            <button onClick={add} className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-violet-600 text-white hover:bg-violet-700 transition-colors">
              เพิ่ม
            </button>
          </div>
          {emails.length === 0 ? (
            <p className="text-xs text-gray-400 italic mt-2">ยังไม่มีรายชื่อเพิ่มเติม</p>
          ) : (
            <div className="space-y-1.5 mt-2">
              {emails.map((e) => (
                <div key={e} className="flex items-center justify-between bg-violet-50 border border-violet-200 rounded-lg px-3 py-1.5 text-xs">
                  <span className="text-violet-800 font-medium truncate">{e}</span>
                  <button onClick={() => remove(e)} className="shrink-0 text-red-400 hover:text-red-600" aria-label={`ลบ ${e}`}>
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="flex gap-2 pt-1">
          <button onClick={onClose} className="flex-1 px-4 py-2 rounded-lg text-sm font-medium text-gray-600 bg-gray-100 hover:bg-gray-200 transition-colors">ยกเลิก</button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex-1 px-4 py-2 rounded-lg text-sm font-semibold bg-violet-600 text-white hover:bg-violet-700 transition-colors disabled:opacity-40"
          >
            {saving ? 'กำลังบันทึก…' : 'บันทึก'}
          </button>
        </div>
      </div>
    </div>
  )
}
