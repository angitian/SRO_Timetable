import { useState, useMemo } from 'react'
import {
  Rocket, Loader2, Save, Clock, Ban, Shield, User, Plus, Trash2,
  Settings, Lock, ArrowLeft,
} from 'lucide-react'
import { useApp } from '../context/AppContext.jsx'

const DAY_LABELS = ['', 'จ.', 'อ.', 'พ.', 'พฤ.', 'ศ.']
const DAY_FULL = ['', 'จันทร์', 'อังคาร', 'พุธ', 'พฤหัสบดี', 'ศุกร์']

const ADMIN_ROLES = [
  { value: 'none', label: '—', color: 'bg-gray-100 text-gray-500' },
  { value: 'finance', label: 'การเงิน', color: 'bg-blue-100 text-blue-700' },
  { value: 'discipline', label: 'ปกครอง', color: 'bg-red-100 text-red-700' },
  { value: 'dept_head', label: 'หัวหน้าหมวด', color: 'bg-purple-100 text-purple-700' },
]

const SLOT_TYPES = [
  { value: 'activity', label: 'กิจกรรม' },
  { value: 'assembly', label: 'ชุมนุม' },
  { value: 'homeroom', label: 'โฮมรูม' },
  { value: 'scout', label: 'ลูกเสือ' },
  { value: 'club', label: 'ชมรม' },
]

export default function ConstraintsStep() {
  const { fixtureData, updateFixtureData, runSolver, isGenerating, error, setStep } = useApp()

  if (!fixtureData) {
    return (
      <div className="text-center py-12 text-gray-500">
        ยังไม่มีข้อมูล — กลับไป Step 1 เพื่อเลือก Fixture หรือนำเข้า Excel
        <div className="mt-4">
          <button onClick={() => setStep(1)} className="btn-primary text-sm">← ไป Step 1</button>
        </div>
      </div>
    )
  }

  const scheduleConfig = fixtureData.schedule_config || {
    days_per_week: 5, periods_per_day: 8, lunch_periods: [4],
  }

  return (
    <div className="space-y-6">
      {/* Schedule Config Section */}
      <ScheduleConfigSection
        config={scheduleConfig}
        onChange={(newConfig) => updateFixtureData({ schedule_config: newConfig })}
      />

      {/* Teacher Constraints Section */}
      <TeacherConstraintsSection
        fixtureData={fixtureData}
        updateFixtureData={updateFixtureData}
      />

      {/* Fixed Slots Section */}
      <FixedSlotsSection
        fixtureData={fixtureData}
        updateFixtureData={updateFixtureData}
      />

      {/* Error display */}
      {error && (
        <div className="text-red-600 text-sm bg-red-50 border border-red-200 rounded-lg px-4 py-3">
          ❌ {error}
        </div>
      )}

      {/* Run Solver CTA */}
      <div className="card bg-gradient-to-r from-blue-50 to-indigo-50 border-blue-200">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="font-bold text-gray-900 text-lg">พร้อมจัดตารางสอน?</h3>
            <p className="text-sm text-gray-600 mt-1">
              กดปุ่มด้านขวาเพื่อสั่ง CP-SAT Solver จัดตารางอัตโนมัติ
            </p>
          </div>
          <button
            onClick={runSolver}
            disabled={isGenerating}
            className="flex items-center gap-2 text-lg font-bold px-8 py-4 rounded-xl
              bg-blue-600 text-white hover:bg-blue-700 transition-colors disabled:opacity-60 shadow-lg"
          >
            {isGenerating ? (
              <>
                <Loader2 className="w-5 h-5 animate-spin" />
                กำลังจัดตาราง...
              </>
            ) : (
              <>
                <Rocket className="w-5 h-5" />
                สั่งจัดตารางสอนอัตโนมัติ
              </>
            )}
          </button>
        </div>
      </div>

      {/* Back to Step 1 */}
      <div className="flex justify-start">
        <button onClick={() => setStep(1)} className="btn-secondary text-sm flex items-center gap-1">
          <ArrowLeft className="w-4 h-4" /> กลับไปแก้ข้อมูล
        </button>
      </div>
    </div>
  )
}

// ── Schedule Config Section ──────────────────────────────────────────────────

function ScheduleConfigSection({ config, onChange }) {
  function update(field, value) {
    onChange({ ...config, [field]: value })
  }

  function toggleLunch(period) {
    const lunch = config.lunch_periods.includes(period)
      ? config.lunch_periods.filter((p) => p !== period)
      : [...config.lunch_periods, period].sort()
    onChange({ ...config, lunch_periods: lunch })
  }

  return (
    <div className="card space-y-4">
      <div className="flex items-center gap-2">
        <Settings className="w-5 h-5 text-blue-600" />
        <h3 className="font-bold text-gray-900">ตั้งค่าโครงสร้างตาราง</h3>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="text-sm font-medium text-gray-700 mb-1 block">จำนวนวัน/สัปดาห์</label>
          <div className="flex gap-2">
            {[5, 6].map((d) => (
              <button
                key={d}
                onClick={() => update('days_per_week', d)}
                className={`px-4 py-2 rounded-lg text-sm font-bold border-2 transition-all
                  ${config.days_per_week === d
                    ? 'bg-blue-600 border-blue-600 text-white'
                    : 'bg-white border-gray-200 text-gray-500 hover:border-gray-300'
                  }`}
              >
                {d} วัน
              </button>
            ))}
          </div>
        </div>
        <div>
          <label className="text-sm font-medium text-gray-700 mb-1 block">จำนวนคาบ/วัน</label>
          <div className="flex gap-2">
            {[6, 7, 8, 9, 10].map((p) => (
              <button
                key={p}
                onClick={() => update('periods_per_day', p)}
                className={`px-3 py-2 rounded-lg text-sm font-bold border-2 transition-all
                  ${config.periods_per_day === p
                    ? 'bg-blue-600 border-blue-600 text-white'
                    : 'bg-white border-gray-200 text-gray-500 hover:border-gray-300'
                  }`}
              >
                {p}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div>
        <label className="text-sm font-medium text-gray-700 mb-2 block">คาบพักเที่ยง (คลิกเพื่อสลับ)</label>
        <div className="flex flex-wrap gap-2">
          {Array.from({ length: config.periods_per_day }, (_, i) => i + 1).map((p) => {
            const isLunch = config.lunch_periods.includes(p)
            return (
              <button
                key={p}
                onClick={() => toggleLunch(p)}
                className={`px-3 py-2 rounded-lg text-sm font-bold border-2 transition-all
                  ${isLunch
                    ? 'bg-gray-100 border-gray-300 text-gray-500'
                    : 'bg-blue-50 border-blue-300 text-blue-700'
                  }`}
              >
                คาบ {p}
                <span className="ml-1 text-xs">{isLunch ? 'พัก' : 'เรียน'}</span>
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}

// ── Teacher Constraints Section ──────────────────────────────────────────────

function TeacherConstraintsSection({ fixtureData, updateFixtureData }) {
  const { teachers = [] } = fixtureData
  const scheduleConfig = fixtureData.schedule_config || { days_per_week: 5, periods_per_day: 7, lunch_periods: [4] }
  const [selectedTeacher, setSelectedTeacher] = useState(null)
  const [editedTeachers, setEditedTeachers] = useState({})

  const days = Array.from({ length: scheduleConfig.days_per_week }, (_, i) => i + 1)
  const periods = Array.from({ length: scheduleConfig.periods_per_day }, (_, i) => i + 1)
  const lunchSet = new Set(scheduleConfig.lunch_periods || [4])

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
    setEditedTeachers((prev) => ({ ...prev, [tid]: { ...state, admin_role: role } }))
  }

  function setMaxPeriods(tid, value) {
    const state = getTeacherState(tid)
    setEditedTeachers((prev) => ({
      ...prev,
      [tid]: { ...state, max_periods_per_week: parseInt(value) || 22 },
    }))
  }

  function saveAll() {
    const updatedTeachers = teachers.map((t) => {
      if (editedTeachers[t.id]) {
        return { ...t, ...editedTeachers[t.id] }
      }
      return t
    })
    updateFixtureData({ teachers: updatedTeachers })
    setEditedTeachers({})
  }

  const hasChanges = Object.keys(editedTeachers).length > 0

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

  const selected = selectedTeacher ? teachers.find((t) => t.id === selectedTeacher) : null
  const selectedState = selected ? getTeacherState(selected.id) : null

  return (
    <div className="card space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Shield className="w-5 h-5 text-purple-600" />
          <h3 className="font-bold text-gray-900">เงื่อนไขครู</h3>
        </div>
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

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Teacher list */}
        <div className="lg:col-span-1">
          <div className="space-y-1 max-h-[400px] overflow-y-auto">
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
                        <span className={`badge text-[10px] ${ADMIN_ROLES.find((r) => r.value === state.admin_role)?.color}`}>
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

        {/* Editor panel */}
        <div className="lg:col-span-2">
          {selected && selectedState ? (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h4 className="font-bold text-gray-900">{selected.id} — {selected.name}</h4>
                  <p className="text-sm text-gray-500">ภาระงานสูงสุด: {selectedState.max_periods_per_week} คาบ/สัปดาห์</p>
                </div>
                {editedTeachers[selected.id] && (
                  <span className="text-sm text-orange-500 flex items-center gap-1">
                    <Save className="w-3.5 h-3.5" /> ยังไม่บันทึก
                  </span>
                )}
              </div>

              {/* Admin role */}
              <div>
                <label className="text-sm font-medium text-gray-700 mb-2 block">บทบาทพิเศษ</label>
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
                <label className="text-sm font-medium text-gray-700 mb-1 block">ภาระงานสูงสุด (คาบ/สัปดาห์)</label>
                <input
                  type="number" min="1" max="30"
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
                  <div className="inline-grid gap-1" style={{ gridTemplateColumns: `50px repeat(${periods.length}, 1fr)` }}>
                    <div className="text-xs text-gray-400 flex items-center justify-center">วัน\คาบ</div>
                    {periods.map((p) => (
                      <div key={p} className={`text-center text-xs font-bold py-1 rounded
                        ${lunchSet.has(p) ? 'bg-gray-200 text-gray-400' : 'text-gray-600'}`}>
                        {p}
                      </div>
                    ))}
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
              </div>
            </div>
          ) : (
            <div className="text-center py-12 text-gray-400">
              เลือกครูจากรายการด้านซ้ายเพื่อจัดการเงื่อนไข
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Fixed Slots Section ──────────────────────────────────────────────────────

function FixedSlotsSection({ fixtureData, updateFixtureData }) {
  const { fixed_slots = [], classes = [] } = fixtureData
  const scheduleConfig = fixtureData.schedule_config || { days_per_week: 5, periods_per_day: 8 }
  const [showForm, setShowForm] = useState(false)
  const [newSlot, setNewSlot] = useState({
    name: '',
    slot_type: 'activity',
    day: 1,
    period: 1,
    class_ids: [],
  })

  function addSlot() {
    const fs = [...fixed_slots]
    fs.push({
      id: `FS${Date.now()}`,
      ...newSlot,
      class_ids: newSlot.class_ids.length === 0 ? [] : newSlot.class_ids,
    })
    updateFixtureData({ fixed_slots: fs })
    setShowForm(false)
    setNewSlot({ name: '', slot_type: 'activity', day: 1, period: 1, class_ids: [] })
  }

  function removeSlot(id) {
    updateFixtureData({ fixed_slots: fixed_slots.filter((s) => s.id !== id) })
  }

  function toggleClass(cid) {
    setNewSlot((prev) => ({
      ...prev,
      class_ids: prev.class_ids.includes(cid)
        ? prev.class_ids.filter((c) => c !== cid)
        : [...prev.class_ids, cid],
    }))
  }

  return (
    <div className="card space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Lock className="w-5 h-5 text-amber-600" />
          <h3 className="font-bold text-gray-900">คาบตายตัว (Fixed Slots)</h3>
          <span className="badge bg-amber-100 text-amber-700">{fixed_slots.length}</span>
        </div>
        <button
          onClick={() => setShowForm(true)}
          className="btn-primary text-sm flex items-center gap-1"
        >
          <Plus className="w-4 h-4" /> เพิ่ม
        </button>
      </div>

      {fixed_slots.length === 0 ? (
        <div className="text-center py-6 text-gray-400 text-sm">
          ยังไม่มีคาบตายตัว — เช่น ชุมนุม, ลูกเสือ, โฮมรูม
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-3 py-2 text-left text-xs font-bold text-gray-600">ชื่อ</th>
                <th className="px-3 py-2 text-left text-xs font-bold text-gray-600">ประเภท</th>
                <th className="px-3 py-2 text-center text-xs font-bold text-gray-600">วัน</th>
                <th className="px-3 py-2 text-center text-xs font-bold text-gray-600">คาบ</th>
                <th className="px-3 py-2 text-left text-xs font-bold text-gray-600">ห้องที่เกี่ยวข้อง</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-100">
              {fixed_slots.map((fs) => {
                const typeLabel = SLOT_TYPES.find((t) => t.value === fs.slot_type)?.label || fs.slot_type
                const classNames = (fs.class_ids || []).map((cid) =>
                  classes.find((c) => c.id === cid)?.name || cid
                )
                return (
                  <tr key={fs.id} className="hover:bg-gray-50">
                    <td className="px-3 py-2 text-sm text-gray-900">{fs.name}</td>
                    <td className="px-3 py-2 text-sm">
                      <span className="badge bg-amber-100 text-amber-700">{typeLabel}</span>
                    </td>
                    <td className="px-3 py-2 text-sm text-center">{DAY_FULL[fs.day] || fs.day}</td>
                    <td className="px-3 py-2 text-sm text-center">{fs.period}</td>
                    <td className="px-3 py-2 text-sm text-gray-600">
                      {classNames.length === 0 ? 'ทุกห้อง' : classNames.join(', ')}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <button onClick={() => removeSlot(fs.id)} className="text-red-600 hover:text-red-700">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Add Fixed Slot Modal */}
      {showForm && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50" onClick={() => setShowForm(false)}>
          <div className="bg-white rounded-xl shadow-lg p-6 w-full max-w-md space-y-4" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-bold text-gray-900">เพิ่มคาบตายตัว</h3>
            <div className="space-y-3">
              <div>
                <label className="text-sm font-medium text-gray-700">ชื่อกิจกรรม</label>
                <input
                  type="text"
                  value={newSlot.name}
                  onChange={(e) => setNewSlot({ ...newSlot, name: e.target.value })}
                  className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                  placeholder="เช่น ชุมนุม, ลูกเสือ"
                />
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="text-sm font-medium text-gray-700">ประเภท</label>
                  <select
                    value={newSlot.slot_type}
                    onChange={(e) => setNewSlot({ ...newSlot, slot_type: e.target.value })}
                    className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                  >
                    {SLOT_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-sm font-medium text-gray-700">วัน</label>
                  <select
                    value={newSlot.day}
                    onChange={(e) => setNewSlot({ ...newSlot, day: parseInt(e.target.value) })}
                    className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                  >
                    {Array.from({ length: scheduleConfig.days_per_week }, (_, i) => i + 1).map((d) => (
                      <option key={d} value={d}>{DAY_FULL[d]}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-sm font-medium text-gray-700">คาบ</label>
                  <select
                    value={newSlot.period}
                    onChange={(e) => setNewSlot({ ...newSlot, period: parseInt(e.target.value) })}
                    className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                  >
                    {Array.from({ length: scheduleConfig.periods_per_day }, (_, i) => i + 1).map((p) => (
                      <option key={p} value={p}>{p}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div>
                <label className="text-sm font-medium text-gray-700 mb-1 block">ห้องที่เกี่ยวข้อง (ว่าง = ทุกห้อง)</label>
                <div className="flex flex-wrap gap-1 max-h-32 overflow-y-auto">
                  {classes.map((c) => {
                    const isSelected = newSlot.class_ids.includes(c.id)
                    return (
                      <button
                        key={c.id}
                        onClick={() => toggleClass(c.id)}
                        className={`px-2 py-1 rounded text-xs font-medium border transition-all
                          ${isSelected ? 'bg-blue-600 text-white border-blue-600' : 'bg-white border-gray-200 text-gray-500'}`}
                      >
                        {c.name}
                      </button>
                    )
                  })}
                </div>
              </div>
            </div>
            <div className="flex gap-2 justify-end">
              <button onClick={() => setShowForm(false)} className="btn-secondary text-sm">ยกเลิก</button>
              <button onClick={addSlot} className="btn-primary text-sm" disabled={!newSlot.name}>เพิ่ม</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
