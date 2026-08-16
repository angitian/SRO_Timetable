import { Rocket, Loader2, Calendar, Check, Layers, Users, ClipboardCheck, Upload, Printer, BookOpen, Facebook } from 'lucide-react'
import { useState } from 'react'
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

export default function Header() {
  const { activeStep, setStep, isGenerating, result, isDirty } = useApp()
  const [showManual, setShowManual] = useState(false)

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
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-14">
          {/* Logo */}
          <div className="flex items-center gap-2 shrink-0">
            <Calendar className="w-6 h-6 text-blue-600" />
            <span className="font-bold text-lg text-gray-900 hidden sm:inline">
              SRO Timetable
            </span>
            <span className="badge bg-blue-100 text-blue-700 ml-1">POC</span>
          </div>

          {/* Wizard Stepper */}
          <nav className="flex items-center gap-1 sm:gap-2">
            {STEPS.map((step, i) => {
              const Icon = step.icon
              const isActive = activeStep === step.id
              const isPast = activeStep > step.id
              const isDisabled = (step.id === 5 || step.id === 6) && !result
              const canClick = !isDisabled

              return (
                <div key={step.id} className="flex items-center">
                  <button
                    onClick={() => canClick && setStep(step.id)}
                    disabled={isDisabled}
                    className={`flex items-center gap-1.5 px-2 sm:px-3 py-1.5 rounded-lg text-sm font-medium transition-all
                      ${isActive
                        ? 'bg-blue-50 text-blue-700'
                        : isPast
                        ? 'text-green-600 hover:bg-green-50'
                        : 'text-gray-400'
                      }
                      ${isDisabled ? 'opacity-40 cursor-not-allowed' : canClick ? 'cursor-pointer' : ''}
                    `}
                  >
                    <span className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold
                      ${isActive
                        ? 'bg-blue-600 text-white'
                        : isPast
                        ? 'bg-green-500 text-white'
                        : 'bg-gray-200 text-gray-400'
                      }`}>
                      {isPast ? <Check className="w-3.5 h-3.5" /> : step.id}
                    </span>
                    <span className="hidden md:inline">{step.label}</span>
                    <Icon className="w-4 h-4 md:hidden" />
                  </button>
                  {i < STEPS.length - 1 && (
                    <div className={`w-4 sm:w-8 h-0.5 mx-0.5 ${isPast ? 'bg-green-300' : 'bg-gray-200'}`} />
                  )}
                </div>
              )
            })}
          </nav>

          {/* Right: Dirty indicator + Manual button */}
          <div className="flex items-center gap-2 shrink-0">
            {isDirty && (
              <span className="hidden sm:flex items-center gap-1 text-xs text-amber-600 font-medium" title="มีการเปลี่ยนแปลงข้อมูล กรุณากดจัดตารางใหม่">
                <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
                ข้อมูลเปลี่ยนแล้ว
              </span>
            )}
            <button
              onClick={() => setShowManual(true)}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-sm font-medium text-gray-500 hover:bg-gray-100 hover:text-blue-700 transition-colors"
              title="คู่มือการใช้งาน"
            >
              <BookOpen className="w-4 h-4" />
              <span className="hidden lg:inline">คู่มือ</span>
            </button>
          </div>
        </div>
      </div>
    </header>
    {showManual && <UserManualModal onClose={() => setShowManual(false)} />}
    </>
  )
}
