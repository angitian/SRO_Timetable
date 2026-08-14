import { Clock, Boxes, AlertTriangle, CheckCircle, Target } from 'lucide-react'
import StatusBadge from './StatusBadge.jsx'

export default function SolverMetrics({ metrics }) {
  if (!metrics) return null

  const items = [
    { icon: Clock, label: 'เวลาประมวลผล', value: `${metrics.wall_time_seconds.toFixed(3)}s`, color: 'text-blue-600' },
    { icon: Boxes, label: 'ตัวแปร', value: metrics.num_variables.toLocaleString(), color: 'text-purple-600' },
    { icon: Target, label: 'ข้อจำกัด', value: metrics.num_constraints.toLocaleString(), color: 'text-orange-600' },
    { icon: AlertTriangle, label: 'Hard Violations', value: metrics.hard_violations, color: metrics.hard_violations > 0 ? 'text-red-600' : 'text-green-600' },
  ]

  return (
    <div className="card">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-bold text-gray-900">Solver Metrics</h3>
        <StatusBadge status={metrics.status} />
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {items.map((item) => {
          const Icon = item.icon
          return (
            <div key={item.label} className="text-center">
              <Icon className={`w-5 h-5 ${item.color} mx-auto mb-1`} />
              <div className="text-lg font-bold text-gray-900">{item.value}</div>
              <div className="text-xs text-gray-500">{item.label}</div>
            </div>
          )
        })}
      </div>
      {metrics.objective_value !== undefined && (
        <div className="mt-3 pt-3 border-t border-gray-100 text-sm text-gray-600">
          Objective Value: <strong>{metrics.objective_value.toFixed(1)}</strong>
          {metrics.objective_value === 0 && (
            <span className="ml-2 text-green-600">
              <CheckCircle className="w-4 h-4 inline" /> ไม่มี Soft Constraint Violation
            </span>
          )}
        </div>
      )}
    </div>
  )
}
