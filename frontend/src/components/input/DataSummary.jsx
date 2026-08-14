import { Users, DoorOpen, BookOpen, Layers, Clock } from 'lucide-react'

export default function DataSummary({ data }) {
  if (!data) return null

  const stats = [
    { icon: Users, label: 'ครู', value: data.teachers?.length || 0, color: 'text-blue-600' },
    { icon: DoorOpen, label: 'ห้องเรียน', value: data.classes?.length || 0, color: 'text-green-600' },
    { icon: BookOpen, label: 'วิชา', value: data.subjects?.length || 0, color: 'text-purple-600' },
    { icon: Layers, label: 'Lesson Blocks', value: data.lesson_blocks?.length || 0, color: 'text-orange-600' },
    {
      icon: Clock,
      label: 'คาบ/วัน',
      value: data.schedule_config?.periods_per_day || 0,
      color: 'text-gray-600',
    },
  ]

  const totalPeriods = data.lesson_blocks?.reduce((sum, lb) => sum + lb.periods_per_week, 0) || 0
  const daysPerWeek = data.schedule_config?.days_per_week || 5
  const lunchPeriods = data.schedule_config?.lunch_periods || []
  const maxConsec = data.schedule_config?.max_consecutive_teaching || 0

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        {stats.map((s) => {
          const Icon = s.icon
          return (
            <div key={s.label} className="bg-white rounded-lg border border-gray-200 p-3">
              <Icon className={`w-5 h-5 ${s.color} mb-1`} />
              <div className="text-2xl font-bold text-gray-900">{s.value}</div>
              <div className="text-xs text-gray-500">{s.label}</div>
            </div>
          )
        })}
      </div>
      <div className="bg-gray-50 rounded-lg p-3 text-sm text-gray-600 flex flex-wrap gap-4">
        <span>รวมคาบที่ต้องจัด: <strong>{totalPeriods}</strong> คาบ/สัปดาห์</span>
        <span>วัน/สัปดาห์: <strong>{daysPerWeek}</strong></span>
        <span>คาบพักเที่ยง: <strong>{lunchPeriods.join(', ')}</strong></span>
        <span>สอนติดกันสูงสุด: <strong>{maxConsec}</strong> คาบ</span>
      </div>
    </div>
  )
}
