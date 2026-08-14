import { AppProvider, useApp } from './context/AppContext.jsx'
import Layout from './components/layout/Layout.jsx'
import LandingPage from './pages/LandingPage.jsx'
import DataIngestionStep from './pages/DataIngestionStep.jsx'
import ScheduleBlocksStep from './pages/ScheduleBlocksStep.jsx'
import TeacherWorkloadStep from './pages/TeacherWorkloadStep.jsx'
import VerificationStep from './pages/VerificationStep.jsx'
import TimetableView from './pages/TimetableView.jsx'

function AppContent() {
  const { activeStep } = useApp()

  return (
    <Layout>
      {activeStep === 0 && <LandingPage />}
      {activeStep === 1 && <DataIngestionStep />}
      {activeStep === 2 && <ScheduleBlocksStep />}
      {activeStep === 3 && <TeacherWorkloadStep />}
      {activeStep === 4 && <VerificationStep />}
      {activeStep === 5 && <TimetableView />}
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
