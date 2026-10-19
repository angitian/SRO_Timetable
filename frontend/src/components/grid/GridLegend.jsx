const DAY_LABELS = ['', 'จันทร์', 'อังคาร', 'พุธ', 'พฤหัสบดี', 'ศุกร์']

const SUBJECT_LEGEND = [
  { color: 'bg-blue-200',    label: 'คณิต (MA)' },
  { color: 'bg-rose-200',    label: 'ไทย (TH)' },
  { color: 'bg-teal-200',    label: 'วิทย์ (SC)' },
  { color: 'bg-indigo-200',  label: 'อังกฤษ (EN)' },
  { color: 'bg-cyan-200',    label: 'อังกฤษร่วม (EN_CO)' },
  { color: 'bg-amber-200',   label: 'สังคม (SO)' },
  { color: 'bg-orange-200',  label: 'ประวัติศาสตร์ (HI)' },
  { color: 'bg-green-200',   label: 'พละ (PE)' },
  { color: 'bg-yellow-200',  label: 'ศิลปะ (AR)' },
  { color: 'bg-lime-200',    label: 'การงาน (WE)' },
  { color: 'bg-violet-200',  label: 'คอมพิวเตอร์ (ICT)' },
  { color: 'bg-pink-200',    label: 'กิจกรรม (ACT)' },
]

const CLASS_COLOR_SWATCHES = [
  'bg-blue-200', 'bg-rose-200', 'bg-teal-200', 'bg-amber-200',
  'bg-purple-200', 'bg-cyan-200', 'bg-orange-200', 'bg-green-200',
  'bg-pink-200', 'bg-indigo-200', 'bg-lime-200', 'bg-violet-200',
]

export default function GridLegend({ mode = 'subject', teacherClasses = [], classColorMap = {} }) {
  const items = mode === 'class'
    ? teacherClasses.map((c) => {
        const idx = classColorMap[c.id] ?? 0
        return { color: CLASS_COLOR_SWATCHES[idx % CLASS_COLOR_SWATCHES.length], label: c.name }
      })
    : SUBJECT_LEGEND

  return (
    <div className="flex flex-wrap items-center gap-3 text-xs text-gray-600">
      {items.map((item) => (
        <div key={item.label} className="flex items-center gap-1">
          <span className={`w-3 h-3 rounded ${item.color}`} />
          {item.label}
        </div>
      ))}
    </div>
  )
}

export { DAY_LABELS }
