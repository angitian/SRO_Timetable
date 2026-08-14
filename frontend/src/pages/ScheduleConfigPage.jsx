import { useState, useEffect } from 'react'
import { Plus, Edit2, Trash2, Save, X, Clock, Layers } from 'lucide-react'
import { listSchedules, createSchedule, updateSchedule, deleteSchedule } from '../api/client.js'

const PERIOD_TYPES = [
  { value: 'teaching', label: 'เรียน', color: 'bg-blue-100 text-blue-700' },
  { value: 'lunch', label: 'พักเที่ยง', color: 'bg-gray-100 text-gray-600' },
  { value: 'break', label: 'พัก', color: 'bg-yellow-100 text-yellow-700' },
  { value: 'assembly', label: 'ชุมนุม', color: 'bg-purple-100 text-purple-700' },
  { value: 'activity', label: 'กิจกรรม', color: 'bg-green-100 text-green-700' },
]

const DAY_LABELS = ['', 'จันทร์', 'อังคาร', 'พุธ', 'พฤหัสบดี', 'ศุกร์', 'เสาร์', 'อาทิตย์']

const EMPTY_TEMPLATE = {
  name: '',
  description: '',
  days_per_week: 5,
  periods_per_day: 8,
  lunch_periods: [4],
  period_definitions: [],
  grade_levels: [],
  special_days: [],
  grade_activities: [],
  is_preset: false,
  is_active: true,
}

export default function ScheduleConfigPage() {
  const [schedules, setSchedules] = useState([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState(null) // null | 'new' | schedule_id
  const [formData, setFormData] = useState(EMPTY_TEMPLATE)
  const [error, setError] = useState(null)

  async function load() {
    setLoading(true)
    try {
      const data = await listSchedules()
      setSchedules(data)
    } catch (err) {
      setError(err.message)
    }
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  function startNew() {
    setFormData({ ...EMPTY_TEMPLATE, period_definitions: genPeriodDefs(8, [4]) })
    setEditing('new')
  }

  function startEdit(s) {
    setFormData({ ...s })
    setEditing(s.id)
  }

  function cancelEdit() {
    setEditing(null)
    setFormData(EMPTY_TEMPLATE)
  }

  async function handleSave() {
    try {
      if (editing === 'new') {
        await createSchedule(formData)
      } else {
        await updateSchedule(editing, formData)
      }
      cancelEdit()
      load()
    } catch (err) {
      setError(err.message)
    }
  }

  async function handleDelete(id) {
    if (!confirm('ต้องการลบ template นี้?')) return
    try {
      await deleteSchedule(id)
      load()
    } catch (err) {
      setError(err.message)
    }
  }

  function genPeriodDefs(periods, lunch) {
    const defs = []
    for (let i = 1; i <= periods; i++) {
      defs.push({
        period_num: i,
        start_time: '',
        end_time: '',
        period_type: lunch.includes(i) ? 'lunch' : 'teaching',
        label: lunch.includes(i) ? 'พักเที่ยง' : null,
      })
    }
    return defs
  }

  function updateField(field, value) {
    setFormData((prev) => ({ ...prev, [field]: value }))
  }

  function updatePeriods(newCount) {
    const newDefs = genPeriodDefs(newCount, formData.lunch_periods)
    setFormData((prev) => ({ ...prev, periods_per_day: newCount, period_definitions: newDefs }))
  }

  function toggleLunch(period) {
    setFormData((prev) => {
      const lunch = prev.lunch_periods.includes(period)
        ? prev.lunch_periods.filter((p) => p !== period)
        : [...prev.lunch_periods, period].sort()
      const defs = prev.period_definitions.map((d) => ({
        ...d,
        period_type: lunch.includes(d.period_num) ? 'teaching' : (d.period_type === 'lunch' ? 'teaching' : d.period_type),
        label: lunch.includes(d.period_num) ? null : d.label,
      }))
      // Mark lunch periods
      defs.forEach((d) => {
        if (lunch.includes(d.period_num)) {
          d.period_type = 'lunch'
          d.label = 'พักเที่ยง'
        }
      })
      return { ...prev, lunch_periods: lunch, period_definitions: defs }
    })
  }

  function toggleGrade(level) {
    setFormData((prev) => ({
      ...prev,
      grade_levels: prev.grade_levels.includes(level)
        ? prev.grade_levels.filter((g) => g !== level)
        : [...prev.grade_levels, level].sort(),
    }))
  }

  if (loading) return <div className="text-center py-12 text-gray-500">กำลังโหลด...</div>

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">ตั้งค่าตารางเรียน</h1>
        {editing === null && (
          <button onClick={startNew} className="btn-primary flex items-center gap-2">
            <Plus className="w-4 h-4" />
            สร้าง Template ใหม่
          </button>
        )}
      </div>

      {error && (
        <div className="text-red-600 text-sm bg-red-50 border border-red-200 rounded-lg px-4 py-2">
          ❌ {error}
        </div>
      )}

      {/* Edit form */}
      {editing !== null && (
        <div className="card space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="font-bold text-gray-900">
              {editing === 'new' ? 'สร้าง Template ใหม่' : 'แก้ไข Template'}
            </h2>
            <div className="flex gap-2">
              <button onClick={handleSave} className="btn-primary flex items-center gap-1 text-sm">
                <Save className="w-4 h-4" /> บันทึก
              </button>
              <button onClick={cancelEdit} className="btn-secondary flex items-center gap-1 text-sm">
                <X className="w-4 h-4" /> ยกเลิก
              </button>
            </div>
          </div>

          {/* Basic info */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="text-sm font-medium text-gray-700">ชื่อ Template</label>
              <input
                type="text"
                value={formData.name}
                onChange={(e) => updateField('name', e.target.value)}
                className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500"
                placeholder="เช่น มัธยม 8 คาบ"
              />
            </div>
            <div>
              <label className="text-sm font-medium text-gray-700">คำอธิบาย</label>
              <input
                type="text"
                value={formData.description || ''}
                onChange={(e) => updateField('description', e.target.value)}
                className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500"
                placeholder="เช่น 5 วัน × 8 คาบ"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-sm font-medium text-gray-700">จำนวนวัน/สัปดาห์</label>
              <input
                type="number"
                min="1" max="7"
                value={formData.days_per_week}
                onChange={(e) => updateField('days_per_week', parseInt(e.target.value) || 5)}
                className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="text-sm font-medium text-gray-700">จำนวนคาบ/วัน</label>
              <input
                type="number"
                min="1" max="12"
                value={formData.periods_per_day}
                onChange={(e) => updatePeriods(parseInt(e.target.value) || 8)}
                className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>

          {/* Period definitions */}
          <div>
            <label className="text-sm font-medium text-gray-700 mb-2 block">
              คาบเรียน — คลิกเพื่อสลับประเภท (เรียน/พักเที่ยง)
            </label>
            <div className="flex flex-wrap gap-2">
              {formData.period_definitions.map((pd) => {
                const isLunch = pd.period_type === 'lunch'
                return (
                  <button
                    key={pd.period_num}
                    onClick={() => toggleLunch(pd.period_num)}
                    className={`px-3 py-2 rounded-lg text-sm font-medium border-2 transition-all
                      ${isLunch
                        ? 'bg-gray-100 border-gray-300 text-gray-500'
                        : 'bg-blue-50 border-blue-300 text-blue-700'
                      }`}
                  >
                    <span className="font-bold">{pd.period_num}</span>
                    <span className="ml-1 text-xs">{isLunch ? 'พัก' : 'เรียน'}</span>
                  </button>
                )
              })}
            </div>
          </div>

          {/* Grade mapping */}
          <div>
            <label className="text-sm font-medium text-gray-700 mb-2 block">
              ระดับชั้นที่ใช้ Template นี้
            </label>
            <div className="flex flex-wrap gap-2">
              {Array.from({ length: 12 }, (_, i) => i + 1).map((level) => {
                const selected = formData.grade_levels.includes(level)
                return (
                  <button
                    key={level}
                    onClick={() => toggleGrade(level)}
                    className={`w-9 h-9 rounded-lg text-sm font-bold border-2 transition-all
                      ${selected
                        ? 'bg-blue-600 border-blue-600 text-white'
                        : 'bg-white border-gray-300 text-gray-400 hover:border-gray-400'
                      }`}
                  >
                    {level}
                  </button>
                )
              })}
            </div>
            <p className="text-xs text-gray-400 mt-1">ป.1 = 1, ม.1 = 7, ม.4 = 10</p>
          </div>
        </div>
      )}

      {/* Schedule list */}
      {editing === null && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {schedules.map((s) => (
            <div key={s.id} className="card space-y-3">
              <div className="flex items-start justify-between">
                <div>
                  <h3 className="font-bold text-gray-900">{s.name}</h3>
                  {s.description && <p className="text-sm text-gray-500">{s.description}</p>}
                </div>
                {s.is_preset && (
                  <span className="badge bg-purple-100 text-purple-700">Preset</span>
                )}
              </div>

              <div className="flex items-center gap-4 text-sm text-gray-600">
                <span className="flex items-center gap-1">
                  <Clock className="w-4 h-4" /> {s.days_per_week} วัน
                </span>
                <span className="flex items-center gap-1">
                  <Layers className="w-4 h-4" /> {s.periods_per_day} คาบ
                </span>
                <span>พักคาบ {s.lunch_periods.join(',')}</span>
              </div>

              {s.grade_levels?.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {s.grade_levels.map((g) => (
                    <span key={g} className="badge bg-blue-50 text-blue-600">{g}</span>
                  ))}
                </div>
              )}

              {!s.is_preset && (
                <div className="flex gap-2 pt-2 border-t border-gray-100">
                  <button
                    onClick={() => startEdit(s)}
                    className="text-sm text-blue-600 hover:text-blue-700 flex items-center gap-1"
                  >
                    <Edit2 className="w-3.5 h-3.5" /> แก้ไข
                  </button>
                  <button
                    onClick={() => handleDelete(s.id)}
                    className="text-sm text-red-600 hover:text-red-700 flex items-center gap-1"
                  >
                    <Trash2 className="w-3.5 h-3.5" /> ลบ
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
