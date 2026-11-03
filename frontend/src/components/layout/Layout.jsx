import Header from './Header.jsx'
import OfflineBanner from '../common/OfflineBanner.jsx'
import { useApp } from '../../context/AppContext.jsx'
import { Lock } from 'lucide-react'

export default function Layout({ children }) {
  const { cacheKey, activeStep, user, canManage, managerEmails } = useApp()
  // Step 5 (TimetableView), Step 6 (PrintStudio) และ Step 7 (SubstituteCenter) ใช้ full-width layout
  const isFullWidth = activeStep === 5 || activeStep === 6 || activeStep === 7 || activeStep === 8
  // Step 0 (LandingPage) manages its own full-height layout — no padding
  const isLanding = activeStep === 0
  // Read-only: ล็อกอินแล้ว แต่ไม่ใช่เจ้าของ/ผู้จัดการของ workspace ที่เปิดอยู่
  const isReadOnly = managerEmails.length > 0 && !canManage
  return (
    <div className="min-h-screen bg-gray-50 overflow-x-hidden max-w-full">
      <OfflineBanner cacheKey={cacheKey} />
      <Header />
      {isReadOnly && (
        <div className="bg-amber-50 border-b border-amber-200 px-4 py-2">
          <div className="max-w-7xl mx-auto flex items-center gap-2 text-sm text-amber-800">
            <Lock className="w-4 h-4 shrink-0" />
            <span>
              โหมดอ่านอย่างเดียว — workspace นี้มีผู้จัดการ
              {user ? '' : ' (เข้าสู่ระบบด้วยบัญชีผู้จัดการเพื่อแก้ไข)'}
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
