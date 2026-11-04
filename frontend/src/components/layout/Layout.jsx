import Header from './Header.jsx'
import WorkspaceBar from './WorkspaceBar.jsx'
import OfflineBanner from '../common/OfflineBanner.jsx'
import { useApp } from '../../context/AppContext.jsx'
import { Lock, AlertCircle, X } from 'lucide-react'

export default function Layout({ children }) {
  const { cacheKey, activeStep, user, canEditWorkspace, authError, clearAuthError } = useApp()
  // Step 5 (TimetableView), Step 6 (PrintStudio), Step 7 (SubstituteCenter),
  // Step 8 (Dashboard) and Step 9 (Trainee module) use full-width layout.
  const isFullWidth = activeStep === 5 || activeStep === 6 || activeStep === 7 || activeStep === 8 || activeStep === 9
  // Step 0 (LandingPage) manages its own full-height layout — no padding
  const isLanding = activeStep === 0
  // Read-only: workspace viewer or a shared workspace without edit rights.
  const isReadOnly = !canEditWorkspace
  return (
    <div className="min-h-screen bg-gray-50 overflow-x-hidden max-w-full">
      <OfflineBanner cacheKey={cacheKey} />
      <Header />
      <WorkspaceBar />
      {authError && (
        <div className="bg-red-50 border-b border-red-200 px-4 py-2">
          <div className="max-w-7xl mx-auto flex items-start gap-2 text-sm text-red-800">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <span className="flex-1">เข้าสู่ระบบไม่สำเร็จ — {authError}</span>
            <button
              onClick={clearAuthError}
              className="shrink-0 p-0.5 rounded hover:bg-red-100 transition-colors"
              title="ปิดข้อความ"
              aria-label="ปิดข้อความ"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}
      {isReadOnly && (
        <div className="bg-amber-50 border-b border-amber-200 px-4 py-2">
          <div className="max-w-7xl mx-auto flex items-center gap-2 text-sm text-amber-800">
            <Lock className="w-4 h-4 shrink-0" />
            <span>
              โหมดอ่านอย่างเดียว — คุณมีสิทธิ์ดูข้อมูลแต่ไม่สามารถแก้ไข workspace นี้
              {user ? '' : ' (เข้าสู่ระบบด้วยบัญชีที่มีสิทธิ์แก้ไข)'}
            </span>
          </div>
        </div>
      )}
      <main className={isLanding
        ? 'p-0'
        : isFullWidth
        ? 'w-full px-4 sm:px-6 lg:px-8 py-6'
        : 'max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6'
      }>
        {children}
      </main>
    </div>
  )
}
