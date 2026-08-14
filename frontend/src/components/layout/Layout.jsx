import Header from './Header.jsx'
import OfflineBanner from '../common/OfflineBanner.jsx'
import { useApp } from '../../context/AppContext.jsx'

export default function Layout({ children }) {
  const { cacheKey, activeStep } = useApp()
  // Step 5 (TimetableView) uses full-width 3-panel layout — no max-width constraint
  const isFullWidth = activeStep === 5
  return (
    <div className="min-h-screen bg-gray-50">
      <OfflineBanner cacheKey={cacheKey} />
      <Header />
      <main className={isFullWidth
        ? 'w-full px-4 sm:px-6 lg:px-8 py-6'
        : 'max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6'
      }>
        {children}
      </main>
    </div>
  )
}
