import { useState, useMemo } from 'react'
import { Plus, Edit2, Trash2, X, Layers, Users, AlertTriangle } from 'lucide-react'
import { useApp } from '../context/AppContext.jsx'

export default function CourseOfferingPage() {
  const { fixtureData, setView } = useApp()
  const [showForm, setShowForm] = useState(false)
  const [editingLb, setEditingLb] = useState(null)
  const [filter, setFilter] = useState({ teacher: '', class: '', subject: '' })

  const lessonBlocks = fixtureData?.lesson_blocks || []
  const teachers = fixtureData?.teachers || []
  const subjects = fixtureData?.subjects || []
  const classes = fixtureData?.classes || []

  const teacherMap = useMemo(() => new Map(teachers.map((t) => [t.id, t])), [teachers])
  const subjectMap = useMemo(() => new Map(subjects.map((s) => [s.id, s])), [subjects])
  const classMap = useMemo(() => new Map(classes.map((c) => [c.id, c])), [classes])

  // Teacher load before solver
  const teacherLoadBefore = useMemo(() => {
    const loads = {}
    for (const t of teachers) {
      loads[t.id] = { teacher: t, assigned: 0 }
    }
    for (const lb of lessonBlocks) {
      if (loads[lb.teacher_id]) {
        loads[lb.teacher_id].assigned += lb.periods_per_week
      }
    }
    return Object.values(loads).map((l) => ({
      ...l.teacher,
      assigned_periods: l.assigned,
      load_status: l.assigned > l.teacher.max_periods_per_week
        ? 'over'
        : l.assigned < l.teacher.min_periods_per_week
        ? 'under'
        : 'ok',
    }))
  }, [teachers, lessonBlocks])

  const filteredLbs = lessonBlocks.filter((lb) => {
    if (filter.teacher && lb.teacher_id !== filter.teacher) return false
    if (filter.class && lb.class_id !== filter.class) return false
    if (filter.subject && lb.subject_id !== filter.subject) return false
    return true
  })

  const totalPeriods = lessonBlocks.reduce((sum, lb) => sum + lb.periods_per_week, 0)
  const overCount = teacherLoadBefore.filter((t) => t.load_status === 'over').length

  if (!fixtureData) {
    return (
      <div className="text-center py-12 text-gray-500">
        ยังไม่มีข้อมูล — ไปหน้าแรกเพื่อเลือก fixture หรือนำเข้า Excel
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Course Offering</h1>
        <div className="flex gap-2">
          <button
            onClick={() => setView('import')}
            className="btn-secondary text-sm flex items-center gap-1"
          >
            นำเข้า Excel
          </button>
          <button
            onClick={() => { setEditingLb(null); setShowForm(true) }}
            className="btn-primary text-sm flex items-center gap-1"
          >
            <Plus className="w-4 h-4" /> เพิ่ม
          </button>
        </div>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="bg-white rounded-lg border border-gray-200 p-3">
          <Users className="w-5 h-5 text-blue-600 mb-1" />
          <div className="text-2xl font-bold">{teachers.length}</div>
          <div className="text-xs text-gray-500">ครู</div>
        </div>
        <div className="bg-white rounded-lg border border-gray-200 p-3">
          <Layers className="w-5 h-5 text-orange-600 mb-1" />
          <div className="text-2xl font-bold">{lessonBlocks.length}</div>
          <div className="text-xs text-gray-500">Lesson Blocks</div>
        </div>
        <div className="bg-white rounded-lg border border-gray-200 p-3">
          <div className="text-2xl font-bold">{totalPeriods}</div>
          <div className="text-xs text-gray-500">รวมคาบ/สัปดาห์</div>
        </div>
        <div className={`rounded-lg border p-3 ${overCount > 0 ? 'bg-red-50 border-red-200' : 'bg-green-50 border-green-200'}`}>
          {overCount > 0 ? (
            <AlertTriangle className="w-5 h-5 text-red-600 mb-1" />
          ) : (
            <Users className="w-5 h-5 text-green-600 mb-1" />
          )}
          <div className={`text-2xl font-bold ${overCount > 0 ? 'text-red-700' : 'text-green-700'}`}>
            {overCount}
          </div>
          <div className="text-xs text-gray-500">ครูเกินเพดาน</div>
        </div>
      </div>

      {/* Teacher load before solver */}
      <div className="card">
        <h3 className="font-bold text-gray-900 mb-3">👨‍🏫 ภาระงานครู (ก่อนจัดตาราง)</h3>
        <div className="space-y-1.5">
          {teacherLoadBefore.map((t) => {
            const pct = t.max_periods_per_week > 0
              ? Math.min(100, (t.assigned_periods / t.max_periods_per_week) * 100)
              : 0
            return (
              <div key={t.id} className="flex items-center gap-3 text-sm">
                <div className="w-24 truncate font-medium text-gray-700">{t.name}</div>
                <div className="flex-1 flex items-center gap-2">
                  <div className="flex-1 h-3 bg-gray-200 rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full ${
                        t.load_status === 'over' ? 'bg-red-500'
                        : t.load_status === 'under' ? 'bg-yellow-500'
                        : 'bg-green-500'
                      }`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <span className="font-bold w-12 text-right">
                    {t.assigned_periods}/{t.max_periods_per_week}
                  </span>
                  {t.load_status === 'over' && (
                    <span className="badge bg-red-100 text-red-700">เกิน</span>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-2">
        <select
          value={filter.teacher}
          onChange={(e) => setFilter({ ...filter, teacher: e.target.value })}
          className="text-sm border border-gray-300 rounded-lg px-3 py-1.5"
        >
          <option value="">ทุกครู</option>
          {teachers.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
        <select
          value={filter.class}
          onChange={(e) => setFilter({ ...filter, class: e.target.value })}
          className="text-sm border border-gray-300 rounded-lg px-3 py-1.5"
        >
          <option value="">ทุกห้อง</option>
          {classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <select
          value={filter.subject}
          onChange={(e) => setFilter({ ...filter, subject: e.target.value })}
          className="text-sm border border-gray-300 rounded-lg px-3 py-1.5"
        >
          <option value="">ทุกวิชา</option>
          {subjects.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      </div>

      {/* Lesson blocks table */}
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-3 py-2 text-left text-xs font-bold text-gray-600">วิชา</th>
              <th className="px-3 py-2 text-left text-xs font-bold text-gray-600">ครู</th>
              <th className="px-3 py-2 text-left text-xs font-bold text-gray-600">ห้อง</th>
              <th className="px-3 py-2 text-center text-xs font-bold text-gray-600">คาบ/สัปดาห์</th>
              <th className="px-3 py-2 text-center text-xs font-bold text-gray-600">คาบคู่</th>
              <th className="px-3 py-2 text-center text-xs font-bold text-gray-600">Fixed</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-100">
            {filteredLbs.map((lb) => {
              const subj = subjectMap.get(lb.subject_id)
              const teacher = teacherMap.get(lb.teacher_id)
              const cls = classMap.get(lb.class_id)
              return (
                <tr key={lb.id} className="hover:bg-gray-50">
                  <td className="px-3 py-2 text-sm text-gray-900">{subj?.name || lb.subject_id}</td>
                  <td className="px-3 py-2 text-sm text-gray-700">{teacher?.name || lb.teacher_id}</td>
                  <td className="px-3 py-2 text-sm text-gray-700">{cls?.name || lb.class_id}</td>
                  <td className="px-3 py-2 text-sm text-center font-bold">{lb.periods_per_week}</td>
                  <td className="px-3 py-2 text-sm text-center">
                    {lb.is_double_period && <span className="badge bg-purple-100 text-purple-700">คู่</span>}
                  </td>
                  <td className="px-3 py-2 text-sm text-center">
                    {lb.is_fixed && <span className="badge bg-gray-100 text-gray-600">
                      วัน{lb.fixed_day} คาบ{lb.fixed_period}
                    </span>}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <button
                      onClick={() => { setEditingLb(lb); setShowForm(true) }}
                      className="text-blue-600 hover:text-blue-700"
                    >
                      <Edit2 className="w-3.5 h-3.5" />
                    </button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* Add/Edit form modal */}
      {showForm && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50" onClick={() => setShowForm(false)}>
          <div className="bg-white rounded-xl shadow-lg p-6 w-full max-w-md space-y-4" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-gray-900">
                {editingLb ? 'แก้ไข Lesson Block' : 'เพิ่ม Lesson Block'}
              </h3>
              <button onClick={() => setShowForm(false)}><X className="w-5 h-5 text-gray-400" /></button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="text-sm font-medium text-gray-700">วิชา</label>
                <select className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" defaultValue={editingLb?.subject_id || ''}>
                  {subjects.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </div>
              <div>
                <label className="text-sm font-medium text-gray-700">ครู</label>
                <select className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" defaultValue={editingLb?.teacher_id || ''}>
                  {teachers.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
              </div>
              <div>
                <label className="text-sm font-medium text-gray-700">ห้อง</label>
                <select className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" defaultValue={editingLb?.class_id || ''}>
                  {classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-sm font-medium text-gray-700">คาบ/สัปดาห์</label>
                  <input
                    type="number" min="1" max="10"
                    defaultValue={editingLb?.periods_per_week || 1}
                    className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="text-sm font-medium text-gray-700">คาบคู่</label>
                  <select className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" defaultValue={editingLb?.is_double_period ? 'true' : 'false'}>
                    <option value="false">ไม่</option>
                    <option value="true">คาบคู่</option>
                  </select>
                </div>
              </div>
            </div>
            <div className="flex gap-2 justify-end">
              <button onClick={() => setShowForm(false)} className="btn-secondary text-sm">ยกเลิก</button>
              <button onClick={() => setShowForm(false)} className="btn-primary text-sm">บันทึก</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
