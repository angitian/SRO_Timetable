const STATUS_CONFIG = {
  OPTIMAL: { bg: 'bg-green-100', text: 'text-green-800', label: '✅ OPTIMAL' },
  FEASIBLE: { bg: 'bg-yellow-100', text: 'text-yellow-800', label: '⚠️ FEASIBLE' },
  INFEASIBLE: { bg: 'bg-red-100', text: 'text-red-800', label: '❌ INFEASIBLE' },
  UNKNOWN: { bg: 'bg-gray-100', text: 'text-gray-800', label: '— UNKNOWN' },
}

export default function StatusBadge({ status }) {
  const config = STATUS_CONFIG[status] || STATUS_CONFIG.UNKNOWN
  return (
    <span className={`badge ${config.bg} ${config.text} font-bold`}>
      {config.label}
    </span>
  )
}
