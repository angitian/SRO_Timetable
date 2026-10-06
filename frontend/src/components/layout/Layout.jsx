import Header from './Header.jsx'
import OfflineBanner from '../common/OfflineBanner.jsx'
import { useApp } from '../../context/AppContext.jsx'

export default function Layout({ children }) {
  const { cacheKey, activeStep } = useApp()
  // Step 5 (TimetableView), Step 6 (PrintStudio) และ Step 7 (SubstituteCenter) ใช้ full-width layout
  const isFullWidth = activeStep === 5 || activeStep === 6 || activeStep === 7
  // Step 0 (LandingPage) manages its own full-height layout — no padding
  const isLanding = activeStep === 0
  return (
    <div className="min-h-screen bg-gray-50 overflow-x-hidden max-w-full">
      <OfflineBanner cacheKey={cacheKey} />
      <Header />
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
