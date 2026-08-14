import { Plus } from 'lucide-react'
import { useApp } from '../context/AppContext.jsx'

export default function LandingPage() {
  const { setStep, setFixtureDataDirect } = useApp()

  function handleCreateNew() {
    setFixtureDataDirect({
      teachers: [],
      rooms: [],
      subjects: [],
      classes: [],
      lesson_blocks: [],
      fixed_slots: [],
      schedule_blocks: [],
      special_activities: [],
      schedule_config: {
        days_per_week: 5,
        periods_per_day: 8,
        lunch_periods: [4],
        assembly_slots: [],
        max_consecutive_teaching: 4,
        pe_hot_periods: [],
      },
      solver_time_limit_seconds: 5.0,
    })
    setStep(1)
  }

  return (
    <div className="min-h-[calc(100vh-3.5rem)] flex items-center justify-center bg-gradient-to-br from-blue-50 via-white to-indigo-50">
      <div className="text-center">
        <button
          onClick={handleCreateNew}
          className="flex items-center gap-3 px-12 py-6 rounded-2xl bg-blue-600 text-white text-2xl font-bold hover:bg-blue-700 transition-all shadow-xl hover:shadow-2xl hover:-translate-y-0.5"
        >
          <Plus className="w-8 h-8" />
          สร้างตารางสอน
        </button>
      </div>
    </div>
  )
}
