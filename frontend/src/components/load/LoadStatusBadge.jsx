const STATUS_STYLES = {
  ok: { bg: 'bg-green-100', text: 'text-green-800', label: '✅ ok' },
  over: { bg: 'bg-red-100', text: 'text-red-800', label: '🔴 over' },
  under: { bg: 'bg-yellow-100', text: 'text-yellow-800', label: '🟡 under' },
}

export default function LoadStatusBadge({ status }) {
  const s = STATUS_STYLES[status] || STATUS_STYLES.ok
  return <span className={`badge ${s.bg} ${s.text}`}>{s.label}</span>
}
