import { useState, useMemo } from 'react'
import { Save, Clock, Ban, Shield, User } from 'lucide-react'
import { useApp } from '../context/AppContext.jsx'

const DAY_LABELS = ['', 'จ.', 'อ.', 'พ.', 'พฤ.', 'ศ.']
const DAY_FULL = ['', 'จันทร์', 'อังคาร', 'พุธ', 'พฤหัสบดี', 'ศุกร์']
const PERIOD_LABELS = [1, 2, 3, 4, 5, 6, 7]

const ADMIN_ROLES = [
  { value: 'none', label: '—', color: 'bg-gray-100 text-gray-500' },
  { value: 'finance', label: 'การเงิน', color: 'bg-blue-100 text-blue-700' },
  { value: 'discipline', label: 'ปกครอง', color: 'bg-red-100 text-red-700' },
  { value: 'dept_head', label: 'หัวหน้าหมวด', color: 'bg-purple-100 text-purple-700' },
]

export default function TeacherConstraintsPage() {
  const { fixtureData } = useApp()
  const [selectedTeacher, setSelectedTeacher] = useState(null)
  const [editedTeachers, setEditedTeachers] = useState({}) // { teacher_id: { unavailable_slots, admin_role, max_periods_per_week } }

  const teachers = fixtureData?.teachers || []
  const scheduleConfig = fixtureData?.schedule_config || { days_per_week: 5, periods_per_day: 7, lunch_periods: [4] }

  const days = Array.from({ length: scheduleConfig.days_per_week }, (_, i) => i + 1)
  const periods = Array.from({ length: scheduleConfig.periods_per_day }, (_, i) => i + 1)
  const lunchSet = new Set(scheduleConfig.lunch_periods || [4])

  // Get current state for a teacher (edited or original)
  function getTeacherState(tid) {
    if (editedTeachers[tid]) return editedTeachers[tid]
    const t = teachers.find((t) => t.id === tid)
    if (!t) return { unavailable_slots: [], admin_role: 'none', max_periods_per_week: 22 }
    return {
      unavailable_slots: t.unavailable_slots || [],
      admin_role: t.admin_role || 'none',
      max_periods_per_week: t.max_periods_per_week || 22,
    }
  }

  function toggleSlot(tid, day, period) {
    if (lunchSet.has(period)) return
    const slot = `${day}-${period}`
    const state = getTeacherState(tid)
    const isUnavailable = state.unavailable_slots.includes(slot)
    const newSlots = isUnavailable
      ? state.unavailable_slots.filter((s) => s !== slot)
      : [...state.unavailable_slots, slot]
    setEditedTeachers((prev) => ({
      ...prev,
      [tid]: { ...state, unavailable_slots: newSlots },
    }))
  }

  function setAdminRole(tid, role) {
    const state = getTeacherState(tid)
    setEditedTeachers((prev) => ({
      ...prev,
      [tid]: { ...state, admin_role: role },
    }))
  }

  function setMaxPeriods(tid, value) {
    const state = getTeacherState(tid)
    setEditedTeachers((prev) => ({
      ...prev,
      [tid]: { ...state, max_periods_per_week: parseInt(value) || 22 },
    }))
  }

  function saveAll() {
    // In a real app, this would call the API
    // For POC, we just log and show a toast
    console.log('Saved teacher constraints:', editedTeachers)
    setEditedTeachers({})
    alert('บันทึกเงื่อนไขครูเรียบร้อย')
  }

  const hasChanges = Object.keys(editedTeachers).length > 0

  // Summary stats
  const stats = useMemo(() => {
    let totalUnavailable = 0
    let adminCount = 0
    for (const t of teachers) {
      const state = getTeacherState(t.id)
      totalUnavailable += state.unavailable_slots.length
      if (state.admin_role !== 'none') adminCount++
    }
    return { totalUnavailable, adminCount, total: teachers.length }
  }, [teachers, editedTeachers])

  if (!fixtureData) {
    return (
      <div className="text-center py-12 text-gray-500">
        ยังไม่มีข้อมูล — ไปหน้าแรกเพื่อเลือก fixture หรือนำเข้า Excel
      </div>
    )
  }

  const selected = selectedTeacher ? teachers.find((t) => t.id === selectedTeacher) : null
  const selectedState = selected ? getTeacherState(selected.id) : null

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">จัดการเงื่อนไขครู</h1>
        {hasChanges && (
          <button onClick={saveAll} className="btn-primary flex items-center gap-2 text-sm">
            <Save className="w-4 h-4" /> บันทึก ({Object.keys(editedTeachers).length})
          </button>
        )}
      </div>

      {/* Summary */}
      <div className="grid grid-cols-3 gap-3">
        <div className="bg-white rounded-lg border border-gray-200 p-3 text-center">
          <User className="w-5 h-5 text-blue-600 mx-auto mb-1" />
          <div className="text-2xl font-bold">{stats.total}</div>
          <div className="text-xs text-gray-500">ครูทั้งหมด</div>
        </div>
        <div className="bg-white rounded-lg border border-gray-200 p-3 text-center">
          <Shield className="w-5 h-5 text-purple-600 mx-auto mb-1" />
          <div className="text-2xl font-bold">{stats.adminCount}</div>
          <div className="text-xs text-gray-500">มีบทบาทพิเศษ</div>
        </div>
        <div className="bg-white rounded-lg border border-gray-200 p-3 text-center">
          <Ban className="w-5 h-5 text-red-600 mx-auto mb-1" />
          <div className="text-2xl font-bold">{stats.totalUnavailable}</div>
          <div className="text-xs text-gray-500">ช่องที่ห้ามสอน</div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Teacher list */}
        <div className="lg:col-span-1">
          <div className="card">
            <h3 className="font-bold text-gray-900 mb-3">รายชื่อครู</h3>
            <div className="space-y-1 max-h-[600px] overflow-y-auto">
              {teachers.map((t) => {
                const state = getTeacherState(t.id)
                const isEdited = !!editedTeachers[t.id]
                const isSelected = selectedTeacher === t.id
                return (
                  <button
                    key={t.id}
                    onClick={() => setSelectedTeacher(t.id)}
                    className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-all
                      ${isSelected ? 'bg-blue-50 border border-blue-300' : 'hover:bg-gray-50 border border-transparent'}`}
                  >
                    <div className="flex items-center justify-between">
                      <div>
                        <span className="font-bold text-gray-700">{t.id}</span>
                        <span className="ml-2 text-gray-600">{t.name}</span>
                      </div>
                      <div className="flex items-center gap-1">
                        {state.admin_role !== 'none' && (
                          <span className={`badge text-[10px] ${
                            ADMIN_ROLES.find((r) => r.value === state.admin_role)?.color
                          }`}>
                            {ADMIN_ROLES.find((r) => r.value === state.admin_role)?.label}
                          </span>
                        )}
                        {state.unavailable_slots.length > 0 && (
                          <span className="badge bg-red-50 text-red-600 text-[10px]">
                            {state.unavailable_slots.length} ช่อง
                          </span>
                        )}
                        {isEdited && <span className="text-orange-500 text-xs">●</span>}
                      </div>
                    </div>
                  </button>
                )
              })}
            </div>
          </div>
        </div>

        {/* Editor panel */}
        <div className="lg:col-span-2">
          {selected && selectedState ? (
            <div className="card space-y-5">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="font-bold text-gray-900 text-lg">
                    {selected.id} — {selected.name}
                  </h3>
                  <p className="text-sm text-gray-500">
                    ภาระงานปัจจุบัน: {selectedState.max_periods_per_week} คาบ/สัปดาห์
                  </p>
                </div>
                {editedTeachers[selected.id] && (
                  <span className="text-sm text-orange-500 flex items-center gap-1">
                    <Save className="w-3.5 h-3.5" /> ยังไม่บันทึก
                  </span>
                )}
              </div>

              {/* Admin role */}
              <div>
                <label className="text-sm font-medium text-gray-700 mb-2 block">บทบาทพิเศษ (Admin Role)</label>
                <div className="flex gap-2">
                  {ADMIN_ROLES.map((role) => (
                    <button
                      key={role.value}
                      onClick={() => setAdminRole(selected.id, role.value)}
                      className={`px-3 py-1.5 rounded-lg text-sm font-medium border-2 transition-all
                        ${selectedState.admin_role === role.value
                          ? `${role.color} border-current`
                          : 'bg-white border-gray-200 text-gray-400 hover:border-gray-300'
                        }`}
                    >
                      {role.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Max periods */}
              <div>
                <label className="text-sm font-medium text-gray-700 mb-1 block">
                  ภาระงานสูงสุด (คาบ/สัปดาห์)
                </label>
                <input
                  type="number"
                  min="1"
                  max="30"
                  value={selectedState.max_periods_per_week}
                  onChange={(e) => setMaxPeriods(selected.id, e.target.value)}
                  className="w-24 border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:ring-2 focus:ring-blue-500"
                />
              </div>

              {/* Unavailable slots grid */}
              <div>
                <label className="text-sm font-medium text-gray-700 mb-2 block flex items-center gap-2">
                  <Ban className="w-4 h-4 text-red-500" />
                  ช่องที่ห้ามจัดสอน (คลิกเพื่อสลับ)
                </label>
                <div className="overflow-x-auto">
                  <div
                    className="inline-grid gap-1"
                    style={{ gridTemplateColumns: `50px repeat(${periods.length}, 1fr)` }}
                  >
                    {/* Header row */}
                    <div className="text-xs text-gray-400 flex items-center justify-center">วัน\คาบ</div>
                    {periods.map((p) => (
                      <div
                        key={p}
                        className={`text-center text-xs font-bold py-1 rounded
                          ${lunchSet.has(p) ? 'bg-gray-200 text-gray-400' : 'text-gray-600'}`}
                      >
                        {p}
                      </div>
                    ))}

                    {/* Day rows */}
                    {days.map((d) => (
                      <div key={d} className="contents">
                        <div className="flex items-center justify-center text-xs font-bold text-gray-600 bg-gray-100 rounded">
                          {DAY_LABELS[d]}
                        </div>
                        {periods.map((p) => {
                          const isLunch = lunchSet.has(p)
                          const slot = `${d}-${p}`
                          const isUnavailable = selectedState.unavailable_slots.includes(slot)
                          if (isLunch) {
                            return (
                              <div key={slot} className="bg-gray-100 rounded flex items-center justify-center">
                                <Clock className="w-3 h-3 text-gray-300" />
                              </div>
                            )
                          }
                          return (
                            <button
                              key={slot}
                              onClick={() => toggleSlot(selected.id, d, p)}
                              className={`h-9 rounded text-xs font-medium border-2 transition-all
                                ${isUnavailable
                                  ? 'bg-red-100 border-red-400 text-red-700'
                                  : 'bg-white border-gray-200 text-gray-300 hover:border-gray-300'
                                }`}
                            >
                              {isUnavailable ? '✕' : ''}
                            </button>
                          )
                        })}
                      </div>
                    ))}
                  </div>
                </div>
                <p className="text-xs text-gray-400 mt-2">
                  สีแดง = ห้ามจัดสอน | สีเทา = พักเที่ยง | คลิกช่องว่างเพื่อสลับสถานะ
                </p>
              </div>

              {/* Unavailable slots summary */}
              {selectedState.unavailable_slots.length > 0 && (
                <div className="bg-red-50 border border-red-200 rounded-lg p-3">
                  <div className="text-sm font-medium text-red-700 mb-1">
                    ห้ามจัดสอน {selectedState.unavailable_slots.length} ช่อง:
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {selectedState.unavailable_slots.sort().map((slot) => {
                      const [d, p] = slot.split('-')
                      return (
                        <span key={slot} className="badge bg-red-100 text-red-600 text-xs">
                          {DAY_FULL[parseInt(d)] || `วัน${d}`} คาบ{p}
                        </span>
                      )
                    })}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="card text-center py-12 text-gray-400">
              เลือกครูจากรายการด้านซ้ายเพื่อจัดการเงื่อนไข
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
