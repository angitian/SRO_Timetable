import { CalendarDays, Cloud, Home, Lock } from 'lucide-react'
import { useApp } from '../../context/AppContext.jsx'

const ROLE_LABEL = {
  owner: 'เจ้าของ',
  editor: 'แก้ไขได้',
  viewer: 'อ่านอย่างเดียว',
}

export default function WorkspaceBar() {
  const {
    activeStep, activeWorkspace, activeTraineeWorkspace,
    myWorkspaceRole, setStep,
  } = useApp()

  if (activeStep === 0) return null

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
