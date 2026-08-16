import { useApp } from '../../context/AppContext.jsx'

const FIXTURES = [
  {
    id: 'small',
    label: 'Small',
    desc: '3 ห้อง · 5 ครู · 5 วิชา',
    detail: '15 Lesson Blocks',
  },
  {
    id: 'medium',
    label: 'Medium',
    desc: '6 ห้อง · 12 ครู · 8 วิชา',
    detail: '48 Lesson Blocks',
  },
  {
    id: 'large',
    label: 'Large',
    desc: '12 ห้อง · 25 ครู · 10 วิชา',
    detail: '120 Lesson Blocks',
  },
  {
    id: 'primary_mock',
    label: 'ประถม สพฐ.',
    desc: '12 ห้อง · 27 ครู · 14 วิชา',
    detail: '156 Lesson Blocks · 6 Fixed Slots',
  },
]

export default function FixtureSelector() {
  const { selectedFixture, selectFixture, isLoadingFixture } = useApp()

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
      {FIXTURES.map((f) => {
        const isActive = selectedFixture === f.id
        return (
          <button
            key={f.id}
            onClick={() => selectFixture(f.id)}
            className={`text-left p-4 rounded-xl border-2 transition-all
              ${isActive
                ? 'border-blue-500 bg-blue-50 ring-2 ring-blue-200'
                : 'border-gray-200 bg-white hover:border-gray-300'
              }`}
          >
            <div className="flex items-center justify-between mb-1">
              <span className="font-bold text-gray-900">{f.label}</span>
              {isActive && (
                <span className="badge bg-blue-600 text-white">เลือกแล้ว</span>
              )}
            </div>
            <p className="text-sm text-gray-600">{f.desc}</p>
            <p className="text-xs text-gray-400 mt-1">{f.detail}</p>
          </button>
        )
      })}
      {isLoadingFixture && (
        <div className="col-span-full text-sm text-gray-500">
          กำลังโหลดข้อมูล...
        </div>
      )}
    </div>
  )
}
