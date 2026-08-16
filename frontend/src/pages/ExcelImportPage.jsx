import { useState, useCallback } from 'react'
import { Upload, FileSpreadsheet, CheckCircle, AlertCircle, ArrowRight } from 'lucide-react'
import { useApp } from '../context/AppContext.jsx'

const BASE_URL = 'http://127.0.0.1:8000'

const FIELDS = [
  { key: 'teacher_name', label: 'ชื่อครู' },
  { key: 'subject', label: 'วิชา' },
  { key: 'class_name', label: 'ห้องเรียน' },
  { key: 'periods_per_week', label: 'คาบ/สัปดาห์' },
  { key: 'is_double', label: 'คาบคู่ (optional)' },
  { key: 'room_name', label: 'ห้องกายภาพ (optional)' },
]

export default function ExcelImportPage() {
  const { setFixtureDataDirect, setView, clearResult } = useApp()
  const [step, setStep] = useState('upload') // upload → mapping → preview → done
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

      // Clear any old solver result
      clearResult()

      // Build fixtureData from import result and set in context
      // Ensure teachers have all required fields
      const teachers = (data.teachers || []).map((t) => ({
        id: t.id,
        name: t.name,
        max_periods_per_week: t.max_periods_per_week || 22,
        min_periods_per_week: t.min_periods_per_week || 0,
        unavailable_slots: t.unavailable_slots || [],
        admin_role: t.admin_role || 'none',
      }))

      // Build rooms matching lesson_blocks room_id pattern (R_{class_id})
      const classRooms = (data.classes || []).map((c) => ({
        id: `R_${c.id}`,
        name: `ห้อง ${c.name}`,
        room_type: 'classroom',
      }))
      const specialRooms = data.special_rooms || []
      const rooms = (data.rooms || []).length > 0 ? data.rooms : [...classRooms, ...specialRooms]

      const fixtureData = {
        teachers,
        rooms,
        special_rooms: specialRooms,
        subjects: data.subjects || [],
        classes: data.classes || [],
        lesson_blocks: data.lesson_blocks || [],
        fixed_slots: [],
        schedule_config: {
          days_per_week: 5,
          periods_per_day: 8,
          lunch_periods: [4],
          assembly_slots: [],
          max_consecutive_teaching: 4,
          pe_hot_periods: [],
        },
        solver_time_limit_seconds: 5.0,
      }
      setFixtureDataDirect(fixtureData)

      setStep('done')
    } catch (err) {
      setError(err.message)
    }
    setLoading(false)
  }, [file, mapping, clearResult])

  function updateMapping(field, header) {
    setMapping((prev) => ({ ...prev, [field]: header || null }))
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-gray-900">นำเข้าข้อมูล Excel</h1>

      {/* Step indicator */}
      <div className="flex items-center gap-2 text-sm">
        {['upload', 'mapping', 'preview', 'done'].map((s, i) => {
          const labels = ['อัพโหลด', 'Map คอลัมน์', 'Preview', 'เสร็จ']
          const isActive = step === s
          const isPast = ['upload', 'mapping', 'preview', 'done'].indexOf(step) > i
          return (
            <div key={s} className="flex items-center gap-2">
              <span className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold
                ${isActive ? 'bg-blue-600 text-white' : isPast ? 'bg-green-500 text-white' : 'bg-gray-200 text-gray-400'}`}>
                {i + 1}
              </span>
              <span className={isActive ? 'font-bold text-gray-900' : 'text-gray-400'}>
                {labels[i]}
              </span>
              {i < 3 && <ArrowRight className="w-3 h-3 text-gray-300" />}
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
        <div className="card">
          <label className="block">
            <div className="border-2 border-dashed border-gray-300 rounded-xl p-8 text-center cursor-pointer hover:border-blue-400 hover:bg-blue-50 transition-all">
              {loading ? (
                <div className="text-gray-500">กำลังประมวลผล...</div>
              ) : (
                <>
                  <Upload className="w-10 h-10 text-gray-400 mx-auto mb-3" />
                  <div className="font-medium text-gray-700">คลิกหรือลากไฟล์ Excel มาวาง</div>
                  <div className="text-sm text-gray-400 mt-1">รองรับ .xlsx, .xls</div>
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
        </div>
      )}

      {/* Step 2: Column Mapping */}
      {step === 'mapping' && detectResult && (
        <div className="card space-y-4">
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
                  {mapped && (
                    <CheckCircle className="w-4 h-4 text-green-500" />
                  )}
                </div>
              )
            })}
          </div>

          {/* Preview table */}
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
            <button onClick={() => setStep('upload')} className="btn-secondary">
              ยกเลิก
            </button>
          </div>
        </div>
      )}

      {/* Step 3: Done */}
      {step === 'done' && importResult && (
        <div className="card space-y-4">
          <div className="flex items-center gap-2">
            <CheckCircle className="w-6 h-6 text-green-600" />
            <h2 className="font-bold text-gray-900">นำเข้าสำเร็จ!</h2>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              { label: 'ครู', value: importResult.summary.teachers },
              { label: 'วิชา', value: importResult.summary.subjects },
              { label: 'ห้อง', value: importResult.summary.classes },
              { label: 'Lesson Blocks', value: importResult.summary.lesson_blocks },
            ].map((s) => (
              <div key={s.label} className="bg-blue-50 rounded-lg p-3 text-center">
                <div className="text-2xl font-bold text-blue-700">{s.value}</div>
                <div className="text-xs text-blue-600">{s.label}</div>
              </div>
            ))}
          </div>

          <div className="flex gap-2">
            <button
              onClick={() => setView('offering')}
              className="btn-primary flex items-center gap-2"
            >
              ไปยัง Course Offering →
            </button>
            <button
              onClick={() => setView('constraints')}
              className="btn-secondary flex items-center gap-2"
            >
              ตั้งค่าเงื่อนไขครู →
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
