import { Rocket, FileText, CheckCircle } from 'lucide-react'
import { useApp } from '../context/AppContext.jsx'
import FixtureSelector from '../components/input/FixtureSelector.jsx'
import DataSummary from '../components/input/DataSummary.jsx'
import GenerateButton from '../components/input/GenerateButton.jsx'
import SolverMetrics from '../components/metrics/SolverMetrics.jsx'

export default function HomePage() {
  const { fixtureData, result, setView } = useApp()

  return (
    <div className="space-y-6">
      {/* Hero */}
      <div className="text-center py-6">
        <h1 className="text-3xl font-bold text-gray-900 mb-2">
          🏫 SRO Free Timetable
        </h1>
        <p className="text-gray-600">
          สร้างตารางสอนอัตโนมัติด้วย Constraint Optimization (OR-Tools CP-SAT)
        </p>
      </div>

      {/* Step 1: Select fixture */}
      <div className="card">
        <div className="flex items-center gap-2 mb-4">
          <span className="w-7 h-7 bg-blue-600 text-white rounded-full flex items-center justify-center text-sm font-bold">
            1
          </span>
          <h2 className="font-bold text-gray-900">เลือกข้อมูลทดสอบ</h2>
        </div>
        <FixtureSelector />
        {fixtureData && (
          <div className="mt-4">
            <DataSummary data={fixtureData} />
          </div>
        )}
      </div>

      {/* Step 2: Generate */}
      <div className="card">
        <div className="flex items-center gap-2 mb-4">
          <span className="w-7 h-7 bg-blue-600 text-white rounded-full flex items-center justify-center text-sm font-bold">
            2
          </span>
          <h2 className="font-bold text-gray-900">สั่งจัดตาราง</h2>
        </div>
        <GenerateButton />
      </div>

      {/* Step 3: Results */}
      {result && (
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <span className="w-7 h-7 bg-green-600 text-white rounded-full flex items-center justify-center text-sm font-bold">
              3
            </span>
            <h2 className="font-bold text-gray-900">ผลลัพธ์</h2>
          </div>
          <SolverMetrics metrics={result.metrics} />
          <div className="flex gap-3 justify-center">
            <button
              onClick={() => setView('timetable')}
              className="btn-primary flex items-center gap-2"
            >
              <FileText className="w-4 h-4" />
              ดูตารางสอน
            </button>
            <button
              onClick={() => setView('teachers')}
              className="btn-secondary flex items-center gap-2"
            >
              <CheckCircle className="w-4 h-4" />
              ดูภาระงานครู
            </button>
          </div>
        </div>
      )}

      {/* Info */}
      <div className="text-center text-xs text-gray-400 pt-4">
        <Rocket className="w-4 h-4 inline mr-1" />
        POC v0.1.0 — Powered by Google OR-Tools CP-SAT
      </div>
    </div>
  )
}
