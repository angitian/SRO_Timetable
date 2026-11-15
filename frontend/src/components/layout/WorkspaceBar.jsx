import { useState } from 'react'
import { BellRing, CalendarDays, Cloud, Home, Loader2, Lock } from 'lucide-react'
import { useApp } from '../../context/AppContext.jsx'
import { markPendingPortal } from '../../features/portal/portalUtils.js'

const ROLE_LABEL = {
  owner: 'เจ้าของ',
  editor: 'แก้ไขได้',
  viewer: 'อ่านอย่างเดียว',
}

const PORTAL_ERRORS = {
  no_workspace: 'ยังไม่มีงานที่เปิดอยู่ — เลือกงานก่อน',
  saved_without_code: 'บันทึกขึ้นคลาวด์แล้วแต่ไม่ได้รับรหัสพอร์ทัล — ลองโหลดงานใหม่',
}

export default function WorkspaceBar() {
  const {
    activeStep, activeWorkspace, activeTraineeWorkspace,
    myWorkspaceRole, setStep, openPortal, login, cloudSyncing,
  } = useApp()
  const [portalError, setPortalError] = useState(null)

  if (activeStep === 0) return null

  async function handlePortal() {
    setPortalError(null)
    const result = await openPortal()
    if (result.ok) {
      window.location.href = `/admin?w=${result.shortCode}`
      return
    }
    if (result.error === 'need_login') {
      // กลับมาทำ flow ต่อหลัง login (AuthCallback redirect กลับ '/' แล้ว LandingPage จะ resume)
      markPendingPortal()
      try {
        await login()
      } catch (e) {
        setPortalError(e.message)
      }
      return
    }
    setPortalError(PORTAL_ERRORS[result.error] || result.error || 'เปิดพอร์ทัลไม่สำเร็จ')
  }

  const title = activeWorkspace?.title || activeTraineeWorkspace?.linkedTimetableTitle || activeTraineeWorkspace?.title
  const isCloud = activeWorkspace?.kind === 'cloud'
  const role = activeWorkspace
    ? (myWorkspaceRole || 'viewer')
    : (activeTraineeWorkspace?.myTraineeRole || 'viewer')

  return (
    <div className="bg-white/95 border-b border-slate-200 print:hidden">
      <div className="max-w-[1600px] mx-auto px-4 sm:px-6 lg:px-8 py-2 flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-2 min-w-0">
          {isCloud ? <Cloud className="w-4 h-4 text-violet-500 shrink-0" /> : <CalendarDays className="w-4 h-4 text-blue-500 shrink-0" />}
          <span className="text-[11px] font-bold uppercase tracking-wide text-slate-400 shrink-0">
            {activeWorkspace ? 'งานปัจจุบัน' : 'โมดูล นศ.'}
          </span>
          <span className="text-sm font-semibold text-slate-800 truncate max-w-[42vw] sm:max-w-md">
            {title || 'ยังไม่ได้เลือกงาน'}
          </span>
          <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold shrink-0 ${
            role === 'owner'
              ? 'bg-violet-100 text-violet-700'
              : role === 'editor'
                ? 'bg-emerald-100 text-emerald-700'
                : 'bg-slate-100 text-slate-600'
          }`}>
            {role === 'viewer' && <Lock className="w-2.5 h-2.5 inline mr-1" />}
            {ROLE_LABEL[role] || role}
          </span>
        </div>
        <div className="ml-auto flex items-center gap-1.5">
          {portalError && (
            <span className="text-[11px] font-medium text-rose-600 max-w-[40vw] truncate" title={portalError}>
              {portalError}
            </span>
          )}
          {activeWorkspace && (
            <button
              onClick={handlePortal}
              disabled={cloudSyncing}
              className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold text-indigo-700 bg-indigo-50 hover:bg-indigo-100 transition-colors disabled:opacity-60"
              title={
                isCloud
                  ? 'พอร์ทัลแจ้งเตือน & ส่งงานของ workspace นี้'
                  : 'บันทึกงานนี้ขึ้นคลาวด์ก่อน แล้วเปิดพอร์ทัลให้ครู'
              }
            >
              {cloudSyncing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <BellRing className="w-3.5 h-3.5" />}
              พอร์ทัล
            </button>
          )}
          <button
            onClick={() => setStep(0)}
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold text-slate-600 bg-slate-100 hover:bg-slate-200 transition-colors"
            title="กลับหน้าแรกเพื่อเปลี่ยนงาน"
          >
            <Home className="w-3.5 h-3.5" />
            เปลี่ยนงาน
          </button>
        </div>
      </div>
    </div>
  )
}
