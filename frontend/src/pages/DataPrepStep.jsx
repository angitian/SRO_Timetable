import { useState, useMemo, useCallback } from 'react'
import {
  Upload, FileSpreadsheet, CheckCircle, AlertCircle, ArrowRight,
  Plus, Edit2, X, Layers, Users, AlertTriangle, ClipboardList, Database,
} from 'lucide-react'
import { useApp } from '../context/AppContext.jsx'
import FixtureSelector from '../components/input/FixtureSelector.jsx'
import DataSummary from '../components/input/DataSummary.jsx'
import RoomSelector from '../components/rooms/RoomSelector.jsx'
import { BASE_URL } from '../api/config.js'

const FIELDS = [
  { key: 'teacher_name', label: 'ชื่อครู' },
  { key: 'subject', label: 'วิชา' },
  { key: 'class_name', label: 'ห้องเรียน' },
  { key: 'periods_per_week', label: 'คาบ/สัปดาห์' },
  { key: 'is_double', label: 'คาบคู่ (optional)' },
  { key: 'room_name', label: 'ห้องกายภาพ (optional)' },
]

export default function DataPrepStep() {
  const { fixtureData, setFixtureDataDirect, updateFixtureData, setStep, clearResult } = useApp()
  const [dataSourceTab, setDataSourceTab] = useState('fixture')

  return (
    <div className="space-y-6">
      {/* Segmented Control */}
      <div className="flex items-center gap-2">
        <div className="inline-flex rounded-lg border border-gray-200 bg-gray-50 p-1">
          <button
            onClick={() => setDataSourceTab('fixture')}
            className={`flex items-center gap-1.5 px-4 py-2 rounded-md text-sm font-medium transition-all
              ${dataSourceTab === 'fixture' ? 'bg-white text-blue-700 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
          >
            <Database className="w-4 h-4" />
            เลือกชุดข้อมูลตัวอย่าง
          </button>
          <button
            onClick={() => setDataSourceTab('excel')}
            className={`flex items-center gap-1.5 px-4 py-2 rounded-md text-sm font-medium transition-all
              ${dataSourceTab === 'excel' ? 'bg-white text-blue-700 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
          >
            <Upload className="w-4 h-4" />
            นำเข้าไฟล์ Excel
          </button>
        </div>
      </div>

      {/* Data Source Content */}
      {dataSourceTab === 'fixture' && <FixturePanel />}
      {dataSourceTab === 'excel' && (
        <ExcelImportPanel
          setFixtureDataDirect={setFixtureDataDirect}
          clearResult={clearResult}
          onDone={() => setDataSourceTab('fixture')}
        />
      )}

      {/* Course Offering — always visible when fixtureData exists */}
      {fixtureData && (
        <>
          <div className="border-t border-gray-200 pt-4">
            <h2 className="text-lg font-bold text-gray-900 mb-1 flex items-center gap-2">
              <ClipboardList className="w-5 h-5 text-blue-600" />
              Course Offering — ตรวจสอบ & แก้ไข
            </h2>
            <p className="text-sm text-gray-500 mb-4">
              ตารางการสอนทั้งหมด แก้ไขได้ที่นี่ การเปลี่ยนแปลงจะบันทึกอัตโนมัติ
            </p>
          </div>
          <CourseOfferingTable fixtureData={fixtureData} updateFixtureData={updateFixtureData} />
        </>
      )}

      {/* CTA to Step 2 */}
      {fixtureData && (
        <div className="flex justify-end pt-2">
          <button
            onClick={() => setStep(2)}
            className="btn-primary flex items-center gap-2"
          >
            ไปตั้งค่าเงื่อนไข
            <ArrowRight className="w-4 h-4" />
          </button>
        </div>
      )}
    </div>
  )
}

// ── Fixture Panel ────────────────────────────────────────────────────────────

function FixturePanel() {
  const { fixtureData, selectedFixture } = useApp()

  return (
    <div className="card space-y-4">
      <div className="flex items-center gap-2 mb-2">
        <span className="w-7 h-7 bg-blue-600 text-white rounded-full flex items-center justify-center text-sm font-bold">1</span>
        <h3 className="font-bold text-gray-900">เลือกชุดข้อมูลทดสอบ</h3>
      </div>
      <FixtureSelector />
      {fixtureData && (
        <div className="mt-2">
          <DataSummary data={fixtureData} />
        </div>
      )}
    </div>
  )
}

// ── Excel Import Panel ───────────────────────────────────────────────────────

function ExcelImportPanel({ setFixtureDataDirect, clearResult, onDone }) {
  const [step, setStep] = useState('upload')
  const [file, setFile] = useState(null)
  const [detectResult, setDetectResult] = useState(null)
  const [mapping, setMapping] = useState({})
  const [importResult, setImportResult] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  const handleFileSelect = useCallback(async (selectedFile) => {
    if (!selectedFile) return
    setFile(selectedFile)
    setLoading(true)
    setError(null)
    try {
      const formData = new FormData()
      formData.append('file', selectedFile)
      const res = await fetch(`${BASE_URL}/api/import/excel/detect`, {
        method: 'POST',
        body: formData,
      })
      if (!res.ok) throw new Error((await res.text()) || 'Failed to parse')
      const data = await res.json()
      setDetectResult(data)
      setMapping(data.auto_mapping || {})
      setStep('mapping')
    } catch (err) {
      setError(err.message)
    }
    setLoading(false)
  }, [])

  const handleImport = useCallback(async () => {
    if (!file) return
    setLoading(true)
    setError(null)
    try {
      const formData = new FormData()
      formData.append('file', file)
      formData.append('mapping', JSON.stringify(mapping))
      const res = await fetch(`${BASE_URL}/api/import/excel/import`, {
        method: 'POST',
        body: formData,
      })
      if (!res.ok) throw new Error((await res.text()) || 'Failed to import')
      const data = await res.json()
      setImportResult(data)
      clearResult()

      const currentDefault = fixtureData?.schedule_config?.default_max_periods_per_week || 22
      const teachers = (data.teachers || []).map((t) => ({
        id: t.id,
        name: t.name,
        max_periods_per_week: t.max_periods_per_week || currentDefault,
        min_periods_per_week: t.min_periods_per_week || 0,
        unavailable_slots: t.unavailable_slots || [],
        admin_role: t.admin_role || 'none',
      }))

      const classRooms = (data.classes || []).map((c) => ({
        id: `R_${c.id}`,
        name: `ห้อง ${c.name}`,
        room_type: 'classroom',
      }))
      const specialRooms = data.special_rooms || []
      const rooms = (data.rooms || []).length > 0
        ? data.rooms
        : [...classRooms, ...specialRooms]

      const newFixtureData = {
        teachers,
        rooms,
        special_rooms: specialRooms,
        subjects: data.subjects || [],
        classes: data.classes || [],
        lesson_blocks: data.lesson_blocks || [],
        fixed_slots: data.fixed_slots || [],
        schedule_blocks: [],
        schedule_config: {
          days_per_week: 5,
          periods_per_day: 8,
          lunch_periods: [4],
          assembly_slots: [],
          max_consecutive_teaching: 4,
          pe_hot_periods: [],
          default_max_periods_per_week: currentDefault,
        },
        solver_time_limit_seconds: 5.0,
      }
      setFixtureDataDirect(newFixtureData)
      setStep('done')
    } catch (err) {
      setError(err.message)
    }
    setLoading(false)
  }, [file, mapping, clearResult, setFixtureDataDirect, fixtureData])

  function updateMapping(field, header) {
    setMapping((prev) => ({ ...prev, [field]: header || null }))
  }

  return (
    <div className="card space-y-4">
      {/* Step indicator */}
      <div className="flex items-center gap-2 text-sm">
        {['upload', 'mapping', 'done'].map((s, i) => {
          const labels = ['อัพโหลด', 'Map คอลัมน์', 'เสร็จ']
          const isActive = step === s
          const isPast = ['upload', 'mapping', 'done'].indexOf(step) > i
          return (
            <div key={s} className="flex items-center gap-2">
              <span className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold
                ${isActive ? 'bg-blue-600 text-white' : isPast ? 'bg-green-500 text-white' : 'bg-gray-200 text-gray-400'}`}>
                {i + 1}
              </span>
              <span className={isActive ? 'font-bold text-gray-900' : 'text-gray-400'}>{labels[i]}</span>
              {i < 2 && <ArrowRight className="w-3 h-3 text-gray-300" />}
            </div>
          )
        })}
      </div>

      {error && (
        <div className="text-red-600 text-sm bg-red-50 border border-red-200 rounded-lg px-4 py-2 flex items-center gap-2">
          <AlertCircle className="w-4 h-4" /> {error}
        </div>
      )}

      {/* Step 1: Upload */}
      {step === 'upload' && (
        <label className="block">
          <div className="border-2 border-dashed border-gray-300 rounded-xl p-8 text-center cursor-pointer hover:border-blue-400 hover:bg-blue-50 transition-all">
            {loading ? (
              <div className="text-gray-500">กำลังประมวลผล...</div>
            ) : (
              <>
                <Upload className="w-10 h-10 text-gray-400 mx-auto mb-3" />
                <div className="font-medium text-gray-700">คลิกหรือลากไฟล์ Excel มาวาง</div>
                <div className="text-sm text-gray-400 mt-1">รองรับ .xlsx (หลายชีท: Course_Mapping, Teacher_Constraints, Fixed_Slots)</div>
              </>
            )}
          </div>
          <input
            type="file"
            accept=".xlsx,.xls"
            className="hidden"
            onChange={(e) => handleFileSelect(e.target.files[0])}
          />
        </label>
      )}

      {/* Step 2: Column Mapping */}
      {step === 'mapping' && detectResult && (
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <FileSpreadsheet className="w-5 h-5 text-green-600" />
            <span className="font-bold text-gray-900">Map คอลัมน์</span>
            <span className="text-sm text-gray-500">— {detectResult.row_count} แถว</span>
          </div>
          <div className="space-y-2">
            {FIELDS.map((field) => {
              const mapped = mapping[field.key]
              return (
                <div key={field.key} className="flex items-center gap-3">
                  <div className="w-40 text-sm font-medium text-gray-700">{field.label}</div>
                  <select
                    value={mapped || ''}
                    onChange={(e) => updateMapping(field.key, e.target.value)}
                    className="flex-1 border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="">— ไม่เลือก —</option>
                    {detectResult.headers.map((h) => (
                      <option key={h} value={h}>{h}</option>
                    ))}
                  </select>
                  {mapped && <CheckCircle className="w-4 h-4 text-green-500" />}
                </div>
              )
            })}
          </div>
          {detectResult.rows?.length > 0 && (
            <div>
              <h4 className="text-sm font-bold text-gray-700 mb-2">Preview (5 แถวแรก)</h4>
              <div className="overflow-x-auto">
                <table className="min-w-full text-xs border border-gray-200 rounded">
                  <thead className="bg-gray-50">
                    <tr>
                      {detectResult.headers.map((h, i) => (
                        <th key={i} className="px-2 py-1 text-left border-b">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {detectResult.rows.map((row, i) => (
                      <tr key={i} className="hover:bg-gray-50">
                        {row.map((val, j) => (
                          <td key={j} className="px-2 py-1 border-b">{val}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
          <div className="flex gap-2">
            <button
              onClick={handleImport}
              disabled={loading || !mapping.teacher_name || !mapping.subject || !mapping.class_name}
              className="btn-primary flex items-center gap-2"
            >
              {loading ? 'กำลังนำเข้า...' : 'นำเข้าข้อมูล'}
            </button>
            <button onClick={() => setStep('upload')} className="btn-secondary">ยกเลิก</button>
          </div>
        </div>
      )}

      {/* Step 3: Done */}
      {step === 'done' && importResult && (
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <CheckCircle className="w-6 h-6 text-green-600" />
            <h3 className="font-bold text-gray-900">นำเข้าสำเร็จ!</h3>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
            {[
              { label: 'ครู', value: importResult.summary.teachers },
              { label: 'วิชา', value: importResult.summary.subjects },
              { label: 'ห้อง', value: importResult.summary.classes },
              { label: 'Lesson Blocks', value: importResult.summary.lesson_blocks },
              { label: 'Fixed Slots', value: importResult.summary.fixed_slots || 0 },
            ].map((s) => (
              <div key={s.label} className="bg-blue-50 rounded-lg p-3 text-center">
                <div className="text-2xl font-bold text-blue-700">{s.value}</div>
                <div className="text-xs text-blue-600">{s.label}</div>
              </div>
            ))}
          </div>
          {importResult.warnings && importResult.warnings.length > 0 && (
            <div className="bg-amber-50 border border-amber-300 rounded-lg p-3 text-left">
              {importResult.warnings.map((w, idx) =>
                w.type === 'merged_duplicates' ? (
                  <div key={idx} className="text-sm text-amber-800">
                    <span className="font-bold">⚠ พบแถวซ้ำ {w.merged.length} กลุ่ม:</span>{' '}
                    ระบบรวมคาบของแถวที่ซ้ำกัน (ครู+วิชา+ห้อง+ห้องเรียน เดียวกัน) ให้อัตโนมัติ
                    <ul className="mt-1 ml-4 list-disc text-xs">
                      {w.merged.slice(0, 5).map((m, i) => (
                        <li key={i}>
                          {m.count} แถว → รวมเป็น {m.total_periods} คาบ
                        </li>
                      ))}
                      {w.merged.length > 5 && (
                        <li>... และอีก {w.merged.length - 5} กลุ่ม</li>
                      )}
                    </ul>
                  </div>
                ) : null,
              )}
            </div>
          )}
          <button onClick={onDone} className="btn-primary text-sm">
            ดู Course Offering →
          </button>
        </div>
      )}
    </div>
  )
}

// ── Course Offering Table ────────────────────────────────────────────────────

function CourseOfferingTable({ fixtureData, updateFixtureData }) {
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

  function handleSaveLb(formData) {
    const updatedLbs = [...lessonBlocks]
    if (editingLb) {
      const idx = updatedLbs.findIndex((lb) => lb.id === editingLb.id)
      if (idx >= 0) {
        updatedLbs[idx] = { ...updatedLbs[idx], ...formData }
      }
    } else {
      const newId = `LB${Date.now()}`
      updatedLbs.push({
        id: newId,
        room_id: `R_${formData.class_id}`,
        is_fixed: false,
        fixed_day: null,
        fixed_period: null,
        ...formData,
      })
    }
    updateFixtureData({ lesson_blocks: updatedLbs })
    setShowForm(false)
    setEditingLb(null)
  }

  return (
    <div className="space-y-4">
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
          <div className={`text-2xl font-bold ${overCount > 0 ? 'text-red-700' : 'text-green-700'}`}>{overCount}</div>
          <div className="text-xs text-gray-500">ครูเกินเพดาน</div>
        </div>
      </div>

      {/* Teacher load bars */}
      <div className="card">
        <h3 className="font-bold text-gray-900 mb-3">ภาระงานครู (ก่อนจัดตาราง)</h3>
        <div className="space-y-1.5 max-h-48 overflow-y-auto">
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
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* Filters + Add button */}
      <div className="flex flex-wrap items-center gap-2">
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
        <div className="flex-1" />
        <button
          onClick={() => { setEditingLb(null); setShowForm(true) }}
          className="btn-primary text-sm flex items-center gap-1"
        >
          <Plus className="w-4 h-4" /> เพิ่ม
        </button>
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

      {/* Add/Edit modal */}
      {showForm && (
        <LbEditModal
          editingLb={editingLb}
          subjects={subjects}
          teachers={teachers}
          classes={classes}
          onSave={handleSaveLb}
          onClose={() => { setShowForm(false); setEditingLb(null) }}
        />
      )}
    </div>
  )
}

// ── Lesson Block Edit Modal ──────────────────────────────────────────────────

function LbEditModal({ editingLb, subjects, teachers, classes, onSave, onClose }) {
  const { fixtureData, addSpecialRoom, setLessonBlockRoom } = useApp()
  const specialRooms = fixtureData?.special_rooms || []
  const [formData, setFormData] = useState({
    subject_id: editingLb?.subject_id || subjects[0]?.id || '',
    teacher_id: editingLb?.teacher_id || teachers[0]?.id || '',
    class_id: editingLb?.class_id || classes[0]?.id || '',
    periods_per_week: editingLb?.periods_per_week || 1,
    is_double_period: editingLb?.is_double_period || false,
    room_id: editingLb?.room_id || null,
  })

  // Determine if the current room_id is a special room (not R_{classId})
  const defaultRoomId = formData.class_id ? `R_${formData.class_id}` : null
  const isSpecialRoomSelected = formData.room_id && formData.room_id !== defaultRoomId && !formData.room_id.startsWith('R_')

  function handleRoomChange(newRoomId) {
    setFormData({ ...formData, room_id: newRoomId })
  }

  function handleCreateNewRoom(name) {
    const newId = `SR_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
    addSpecialRoom({ id: newId, name, room_type: 'lab' })
    // Auto-select the newly created room
    setFormData({ ...formData, room_id: newId })
  }

  // When class changes, reset room_id to the new class's default if currently default
  function handleClassChange(newClassId) {
    const newDefault = `R_${newClassId}`
    setFormData((prev) => ({
      ...prev,
      class_id: newClassId,
      room_id: (!prev.room_id || prev.room_id === `R_${prev.class_id}` || prev.room_id.startsWith('R_'))
        ? newDefault
        : prev.room_id,
    }))
  }

  function handleSave() {
    // Ensure room_id is set: default to R_{classId} if not a special room
    const finalRoomId = formData.room_id && !formData.room_id.startsWith('R_')
      ? formData.room_id
      : `R_${formData.class_id}`
    onSave({ ...formData, room_id: finalRoomId })
  }

  return (
    <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-lg p-6 w-full max-w-md space-y-4" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h3 className="font-bold text-gray-900">
            {editingLb ? 'แก้ไข Lesson Block' : 'เพิ่ม Lesson Block'}
          </h3>
          <button onClick={onClose}><X className="w-5 h-5 text-gray-400" /></button>
        </div>
        <div className="space-y-3">
          <div>
            <label className="text-sm font-medium text-gray-700">วิชา</label>
            <select
              className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
              value={formData.subject_id}
              onChange={(e) => setFormData({ ...formData, subject_id: e.target.value })}
            >
              {subjects.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
          <div>
            <label className="text-sm font-medium text-gray-700">ครู</label>
            <select
              className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
              value={formData.teacher_id}
              onChange={(e) => setFormData({ ...formData, teacher_id: e.target.value })}
            >
              {teachers.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </div>
          <div>
            <label className="text-sm font-medium text-gray-700">ห้อง</label>
            <select
              className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
              value={formData.class_id}
              onChange={(e) => handleClassChange(e.target.value)}
            >
              {classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          {/* Special Room (Facility) Selector */}
          <RoomSelector
            value={isSpecialRoomSelected ? formData.room_id : null}
            onChange={handleRoomChange}
            specialRooms={specialRooms}
            classId={formData.class_id}
            onCreateNew={handleCreateNewRoom}
            label="ห้องปฏิบัติการ (ถ้ามี)"
          />
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-sm font-medium text-gray-700">คาบ/สัปดาห์</label>
              <input
                type="number" min="1" max="10"
                value={formData.periods_per_week}
                onChange={(e) => setFormData({ ...formData, periods_per_week: parseInt(e.target.value) || 1 })}
                className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="text-sm font-medium text-gray-700">คาบคู่</label>
              <select
                className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                value={formData.is_double_period ? 'true' : 'false'}
                onChange={(e) => setFormData({ ...formData, is_double_period: e.target.value === 'true' })}
              >
                <option value="false">ไม่</option>
                <option value="true">คาบคู่</option>
              </select>
            </div>
          </div>
        </div>
        <div className="flex gap-2 justify-end">
          <button onClick={onClose} className="btn-secondary text-sm">ยกเลิก</button>
          <button onClick={handleSave} className="btn-primary text-sm">บันทึก</button>
        </div>
      </div>
    </div>
  )
}
