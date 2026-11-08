import { AppProvider, useApp } from './context/AppContext.jsx'
import Layout from './components/layout/Layout.jsx'
import LandingPage from './pages/LandingPage.jsx'
import DataIngestionStep from './pages/DataIngestionStep.jsx'
import ScheduleBlocksStep from './pages/ScheduleBlocksStep.jsx'
import TeacherWorkloadStep from './pages/TeacherWorkloadStep.jsx'
import VerificationStep from './pages/VerificationStep.jsx'
import TimetableView from './pages/TimetableView.jsx'
import PrintStudio from './pages/PrintStudio.jsx'
import SubstituteCenterPage from './features/substitute/SubstituteCenterPage.jsx'
import TeacherDashboardPage from './features/dashboard/TeacherDashboardPage.jsx'
import TraineeAttendancePage from './pages/TraineeAttendancePage.jsx'
import PublicViewerPage from './pages/PublicViewerPage.jsx'
import SubstituteViewerPage from './pages/SubstituteViewerPage.jsx'
import TraineeViewerPage from './pages/TraineeViewerPage.jsx'
import AuthCallback from './pages/AuthCallback.jsx'

function AppContent() {
  const { activeStep } = useApp()

  // Auth callback route: /auth/callback?token=... — standalone, no Layout needed
  if (window.location.pathname === '/auth/callback') {
    return <AuthCallback />
  }

  // Public viewer route: /view?d=<base64> — standalone, no AppContext needed
  // /view?sub=<code> = shared daily substitute documents
  // /view?tr=<code> = shared trainee summary reports
  if (window.location.pathname === '/view') {
    const params = new URLSearchParams(window.location.search)
    const subCode = params.get('sub')
    const traineeCode = params.get('tr')
    if (subCode) return <SubstituteViewerPage code={subCode} />
    if (traineeCode) return <TraineeViewerPage code={traineeCode} />
    return <PublicViewerPage />
  }

  return (
    <Layout>
      {activeStep === 0 && <LandingPage />}
      {activeStep === 1 && <DataIngestionStep />}
      {activeStep === 2 && <ScheduleBlocksStep />}
      {activeStep === 3 && <TeacherWorkloadStep />}
      {activeStep === 4 && <VerificationStep />}
      {activeStep === 5 && <TimetableView />}
      {activeStep === 6 && <PrintStudio />}
      {activeStep === 7 && <SubstituteCenterPage />}
      {activeStep === 8 && <TeacherDashboardPage />}
      {activeStep === 9 && <TraineeAttendancePage />}
    </Layout>
  )
}

export default function App() {
  return (
    <AppProvider>
      <AppContent />
    </AppProvider>
  )
}
