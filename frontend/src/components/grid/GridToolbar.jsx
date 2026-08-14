import { Filter } from 'lucide-react'

export default function GridToolbar({
  classes,
  teachers,
  filterClass,
  filterTeacher,
  onFilterClass,
  onFilterTeacher,
}) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <div className="flex items-center gap-1.5 text-sm text-gray-600">
        <Filter className="w-4 h-4" />
        <span>ตัวกรอง:</span>
      </div>
      <select
        value={filterClass || ''}
        onChange={(e) => onFilterClass(e.target.value || null)}
        className="text-sm border border-gray-300 rounded-lg px-3 py-1.5 bg-white focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
      >
        <option value="">ทุกห้อง</option>
        {classes.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </select>
      <select
        value={filterTeacher || ''}
        onChange={(e) => onFilterTeacher(e.target.value || null)}
        className="text-sm border border-gray-300 rounded-lg px-3 py-1.5 bg-white focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
      >
        <option value="">ทุกครู</option>
        {teachers.map((t) => (
          <option key={t.id} value={t.id}>
            {t.name}
          </option>
        ))}
      </select>
    </div>
  )
}
