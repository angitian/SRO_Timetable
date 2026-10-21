import { Rocket, Loader2, Calendar, Check, Layers, Users, ClipboardCheck, Upload, Printer, BookOpen, Facebook, LogIn, LogOut, User as UserIcon, Home, AlertTriangle } from 'lucide-react'
import { useState, useRef, useEffect } from 'react'
import { useApp } from '../../context/AppContext.jsx'
import UserManualModal from '../manual/UserManualModal.jsx'

const STEPS = [
  { id: 1, label: 'นำเข้าข้อมูล', icon: Upload },
  { id: 2, label: 'สร้างบล็อก', icon: Layers },
  { id: 3, label: 'ภาระงานครู', icon: Users },
  { id: 4, label: 'ตรวจสอบ', icon: ClipboardCheck },
  { id: 5, label: 'ตารางสอน', icon: Calendar },
  { id: 6, label: 'พิมพ์ / ส่งออก', icon: Printer },
]

/** User menu — login button or user avatar with logout dropdown. */
function UserMenu() {
  const { user, login, logout } = useApp()
  const [open, setOpen] = useState(false)
  const ref = useRef(null)

  useEffect(() => {
    function handleClick(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  if (!user) {
    return (
      <button
        onClick={login}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium
          text-white bg-blue-600 hover:bg-blue-700 transition-colors"
        title="เข้าสู่ระบบด้วย Google (ทางเลือก — ใช้บันทึกขึ้นคลาวด์)"
      >
        <LogIn className="w-4 h-4" />
        <span className="hidden sm:inline">เข้าสู่ระบบ</span>
      </button>
    )
  }

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 px-2 py-1 rounded-lg hover:bg-gray-100 transition-colors"
      >
        {user.picture ? (
          <img src={user.picture} alt="" className="w-7 h-7 rounded-full" referrerPolicy="no-referrer" />
        ) : (
          <div className="w-7 h-7 rounded-full bg-blue-100 flex items-center justify-center">
            <UserIcon className="w-4 h-4 text-blue-600" />
          </div>
        )}
        <span className="hidden sm:inline text-sm font-medium text-gray-700 max-w-[120px] truncate">
          {user.name || user.email}
        </span>
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 w-56 bg-white rounded-xl shadow-xl border border-gray-200 overflow-hidden z-50">
          <div className="px-4 py-3 border-b border-gray-100">
            <div className="text-sm font-semibold text-gray-800 truncate">{user.name}</div>
            <div className="text-xs text-gray-500 truncate">{user.email}</div>
          </div>
          <button
            onClick={() => { setOpen(false); logout() }}
            className="w-full flex items-center gap-2 px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50 transition-colors"
          >
            <LogOut className="w-4 h-4 text-gray-400" />
            ออกจากระบบ
          </button>
        </div>
      )}
    </div>
  )
}

export default function Header() {
  const { activeStep, setStep, isGenerating, result, isDirty, isSnapshotDirty, activeSnapshotId } = useApp()
  const [showManual, setShowManual] = useState(false)
  const [showExitConfirm, setShowExitConfirm] = useState(false)

  // Return to the landing page, guarding against losing unsaved work.
  function handleGoHome() {
    if (isDirty || isSnapshotDirty) {
      setShowExitConfirm(true)
    } else {
      setStep(0)
    }
  }

  // Hide stepper on landing page (step 0) — manual + social links in navbar
  if (activeStep === 0) {
    return (
      <>
        <header className="bg-white border-b border-gray-200 sticky top-0 z-10">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="flex items-center justify-between h-14">
              <div className="flex items-center gap-2 shrink-0">
                <Calendar className="w-6 h-6 text-blue-600" />
                <span className="font-bold text-lg text-gray-900 hidden sm:inline">
                  SRO Timetable
                </span>
                <span className="badge bg-blue-100 text-blue-700 ml-1">POC</span>
              </div>
              <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
                <a
                  href="https://www.facebook.com/kruplatform/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="w-9 h-9 rounded-lg flex items-center justify-center text-gray-400 hover:bg-gray-100 hover:text-blue-600 transition-colors"
                  title="Facebook"
                  aria-label="Facebook"
                >
                  <Facebook className="w-4.5 h-4.5" />
                </a>
                <button
                  onClick={() => setShowManual(true)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium text-gray-600 border border-gray-200 hover:bg-gray-50 hover:border-blue-300 hover:text-blue-700 transition-all"
                >
                  <BookOpen className="w-4 h-4" />
                  <span className="hidden sm:inline">คู่มือการใช้งาน</span>
                </button>
                <UserMenu />
              </div>
            </div>
          </div>
        </header>
        {showManual && <UserManualModal onClose={() => setShowManual(false)} />}
      </>
    )
  }

  return (
    <>
    <header className="bg-white border-b border-gray-200 sticky top-0 z-10">
      <div className="w-full px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-14">
          {/* Logo — clickable, returns to landing/dashboard */}
          <button
            onClick={handleGoHome}
            className="flex items-center gap-2 shrink-0"
            title="กลับหน้าแรก (รายการตารางของคุณ)"
          >
            <Calendar className="w-6 h-6 text-blue-600" />
            <span className="font-bold text-lg text-gray-900 hidden sm:inline">
              SRO Timetable
            </span>
            <span className="badge bg-blue-100 text-blue-700 ml-1">POC</span>
          </button>

          {/* Wizard Stepper — steps share the full header width (flex-1 each) so it never needs to scroll */}
          <nav className="flex items-center min-w-0 flex-1 flex-nowrap">
            {STEPS.map((step, i) => {
              const Icon = step.icon
              const isActive = activeStep === step.id
              const isPast = activeStep > step.id
              const isDisabled = (step.id === 5 || step.id === 6) && !result
              const canClick = !isDisabled

              return (
                <div key={step.id} className="flex-1 min-w-0 flex items-center">
                  <button
                    onClick={() => canClick && setStep(step.id)}
                    disabled={isDisabled}
                    title={step.label}
                    className={`w-full min-w-0 flex items-center justify-center gap-1 sm:gap-1.5 px-1 sm:px-2 py-1.5 rounded-lg text-sm font-medium transition-all
                      ${isActive
                        ? 'bg-blue-50 text-blue-700'
                        : isPast
                        ? 'text-green-600 hover:bg-green-50'
                        : 'text-gray-400'
                      }
                      ${isDisabled ? 'opacity-40 cursor-not-allowed' : canClick ? 'cursor-pointer' : ''}
                    `}
                  >
                    <span className={`w-6 h-6 shrink-0 rounded-full flex items-center justify-center text-xs font-bold
                      ${isActive
                        ? 'bg-blue-600 text-white'
                        : isPast
                        ? 'bg-green-500 text-white'
                        : 'bg-gray-200 text-gray-400'
                      }`}>
                      {isPast ? <Check className="w-3.5 h-3.5" /> : step.id}
                    </span>
                    <span className="hidden lg:inline truncate">{step.label}</span>
                    <Icon className="w-4 h-4 shrink-0 lg:hidden" />
                  </button>
                  {i < STEPS.length - 1 && (
                    <div className={`w-2 sm:w-4 h-0.5 mx-0.5 shrink-0 ${isPast ? 'bg-green-300' : 'bg-gray-200'}`} />
                  )}
                </div>
              )
            })}
          </nav>

          {/* Right: Dirty indicator + Home + Manual button + User menu */}
          <div className="flex items-center gap-1 sm:gap-2 shrink-0">
            {isDirty && (
              <span className="hidden sm:flex items-center gap-1 text-xs text-amber-600 font-medium" title="มีการเปลี่ยนแปลงข้อมูล กรุณากดจัดตารางใหม่">
                <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
                ข้อมูลเปลี่ยนแล้ว
              </span>
            )}
            <button
              onClick={handleGoHome}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-sm font-medium text-gray-500 hover:bg-gray-100 hover:text-blue-700 transition-colors"
              title="กลับหน้าแรก (รายการตารางของคุณ)"
            >
              <Home className="w-4 h-4" />
              <span className="hidden lg:inline">หน้าแรก</span>
            </button>
            <button
              onClick={() => setShowManual(true)}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-sm font-medium text-gray-500 hover:bg-gray-100 hover:text-blue-700 transition-colors"
              title="คู่มือการใช้งาน"
            >
              <BookOpen className="w-4 h-4" />
              <span className="hidden lg:inline">คู่มือ</span>
            </button>
            <UserMenu />
          </div>
        </div>
      </div>
    </header>
    {showManual && <UserManualModal onClose={() => setShowManual(false)} />}

    {/* Exit-confirm guard — warns before leaving with unsaved changes */}
    {showExitConfirm && (
      <div className="fixed inset-0 z-[100] flex items-center justify-center">
        <div className="absolute inset-0 bg-black/40" onClick={() => setShowExitConfirm(false)} />
        <div className="relative bg-white rounded-2xl shadow-2xl p-6 max-w-md w-full mx-4">
          <div className="flex items-center gap-2 mb-3">
            <AlertTriangle className="w-5 h-5 text-amber-500 shrink-0" />
            <h3 className="text-lg font-bold text-gray-900">ข้อมูลยังไม่ถูกบันทึก</h3>
          </div>
          <p className="text-sm text-gray-600 mb-5 leading-relaxed">
            {activeSnapshotId
              ? 'ระบบจะบันทึกการเปลี่ยนแปลงให้อัตโนมัติภายในไม่กี่วินาที หากออกจากหน้านี้ทันที การเปลี่ยนแปลงครั้งล่าสุดอาจยังไม่ถูกบันทึก — แนะนำให้รอสักครู่หรือกด "บันทึก" ก่อนออก'
              : 'คุณมีข้อมูลที่ยังไม่ได้บันทึกเป็นงาน หากออกจากหน้านี้ ข้อมูลที่ทำไว้อาจสูญหาย — แนะนำให้กด "บันทึกใหม่" ที่หน้าตารางสอนก่อนออกจากหน้า'}
          </p>
          <div className="flex justify-end gap-2">
            <button
              onClick={() => setShowExitConfirm(false)}
              className="px-4 py-2 rounded-lg text-sm font-semibold bg-gray-100 text-gray-700 hover:bg-gray-200 transition-colors"
            >
              ยกเลิก
            </button>
            <button
              onClick={() => { setShowExitConfirm(false); setStep(0) }}
              className="px-4 py-2 rounded-lg text-sm font-semibold bg-blue-600 text-white hover:bg-blue-700 transition-colors"
            >
              ออกจากหน้านี้
            </button>
          </div>
        </div>
      </div>
    )}
    </>
  )
}
