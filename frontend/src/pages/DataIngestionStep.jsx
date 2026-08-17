import { useState, useEffect, useCallback } from 'react'
import {
  Upload, Plus, Trash2, ArrowRight, ArrowLeft, FileSpreadsheet, X, Check,
  Users, Layers, BookOpen, Download, FlaskConical,
} from 'lucide-react'
import { useApp } from '../context/AppContext.jsx'
import { ROOM_TYPES, getRoomTypeColor, isSpecialRoomType } from '../utils/roomTypes.js'
import SpecialRoomsManager from '../components/rooms/SpecialRoomsManager.jsx'
import LabPeriodSplitter from '../components/rooms/LabPeriodSplitter.jsx'
import { BASE_URL } from '../api/config.js'

const GRADE_LEVELS = [
  { label: 'อ.1', value: -2 },
  { label: 'อ.2', value: -1 },
  { label: 'อ.3', value: 0 },
  { label: 'ป.1', value: 1 },
  { label: 'ป.2', value: 2 },
  { label: 'ป.3', value: 3 },
  { label: 'ป.4', value: 4 },
  { label: 'ป.5', value: 5 },
  { label: 'ป.6', value: 6 },
  { label: 'ม.1', value: 7 },
  { label: 'ม.2', value: 8 },
  { label: 'ม.3', value: 9 },
  { label: 'ม.4', value: 10 },
  { label: 'ม.5', value: 11 },
  { label: 'ม.6', value: 12 },
]

const GRADE_RANGE_PRESETS = [
  { label: 'อ.1-3', grades: [-2, -1, 0] },
  { label: 'ป.1-3', grades: [1, 2, 3] },
  { label: 'ป.4-6', grades: [4, 5, 6] },
  { label: 'ม.1-3', grades: [7, 8, 9] },
  { label: 'ม.4-6', grades: [10, 11, 12] },
]

function gradeLevelToLabel(v) {
  const g = GRADE_LEVELS.find((g) => g.value === v)
  return g ? g.label : String(v)
}

export default function DataIngestionStep() {
  const { fixtureData, updateFixtureData, setStep } = useApp()
  const [showExcelImport, setShowExcelImport] = useState(false)  // false | { file, mode } where mode = 'full' | 'minimum'

  const classes = fixtureData?.classes || []

  function addManualClass(name, gradeLevel, roomType) {
    const newId = `C${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
    const newClass = { id: newId, name, grade_level: gradeLevel, room_type: roomType }
    const newRoom = { id: `R_${newId}`, name: `ห้อง ${name}`, room_type: roomType }
    updateFixtureData({
      classes: [...classes, newClass],
      rooms: [...(fixtureData?.rooms || []), newRoom],
    })
  }

  function removeClass(classId) {
    updateFixtureData({
      classes: classes.filter((c) => c.id !== classId),
      rooms: (fixtureData?.rooms || []).filter((r) => r.id !== `R_${classId}`),
      lesson_blocks: (fixtureData?.lesson_blocks || []).filter((lb) => lb.class_id !== classId),
    })
  }

  function addGradeBatch(gradeLevels, roomCount, roomType) {
    const newClasses = []
    const newRooms = []
    const ts = Date.now()
    let counter = 0
    for (const gl of gradeLevels) {
      const label = gradeLevelToLabel(gl)
      for (let i = 1; i <= roomCount; i++) {
        counter++
        const name = `${label}/${i}`
        const id = `C${ts}_${counter}`
        newClasses.push({ id, name, grade_level: gl, room_type: roomType })
        newRooms.push({ id: `R_${id}`, name: `ห้อง ${name}`, room_type: roomType })
      }
    }
    updateFixtureData({
      classes: [...classes, ...newClasses],
      rooms: [...(fixtureData?.rooms || []), ...newRooms],
    })
  }

  return (
    <div className="space-y-6 pb-24">
      {/* Header */}
      <div className="flex items-center gap-2">
        <Users className="w-6 h-6 text-blue-600" />
        <h2 className="text-xl font-bold text-gray-900">เตรียมข้อมูลห้องเรียน</h2>
      </div>

      {/* Upload options */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Option 1: Quick Import */}
        <div className="card border-2 border-emerald-200 bg-emerald-50/50">
          <div className="flex items-center gap-2 mb-3">
            <FileSpreadsheet className="w-5 h-5 text-emerald-600" />
            <h3 className="font-bold text-gray-900">1. นำเข้าข้อมูลแบบด่วน (Quick Import)</h3>
            <span className="badge bg-emerald-100 text-emerald-800 text-xs">แนะนำสำหรับเริ่มต้น</span>
          </div>
          <p className="text-sm text-gray-600 mb-3">
            อัปโหลดไฟล์ Excel <strong>ชีทเดียว</strong> เพียงมีข้อมูลพื้นฐาน <code className="bg-gray-100 px-1 rounded">ชื่อครู</code> <code className="bg-gray-100 px-1 rounded">วิชา</code> <code className="bg-gray-100 px-1 rounded">ห้องเรียน</code> <code className="bg-gray-100 px-1 rounded">จำนวนคาบ/สัปดาห์</code> และคอลัมน์เสริม <code className="bg-gray-100 px-1 rounded">ห้องปฏิบัติการ</code> + <code className="bg-gray-100 px-1 rounded">คาบแล็บ</code> สำหรับวิชาที่ใช้ห้องแล็บ ระบบจะสกัดรายชื่อและจับคู่ภาระงานให้อัตโนมัติทันที
          </p>
          <p className="text-xs text-gray-500 italic mb-4">
            💡 คำแนะนำ: หากยังไม่มีวิชาหรือห้องเรียนครบ ไม่เป็นไร สามารถใส่นำเข้าเฉพาะรายชื่อครูมาก่อน แล้วไปเพิ่มรายละเอียดในหน้าเว็บทีหลังได้
          </p>
          <ExcelDropZone
            onFile={(file) => setShowExcelImport({ file, mode: 'minimum' })}
            label="ลากไฟล์ Excel แบบด่วนมาวางที่นี่ หรือ คลิกเพื่อเลือกไฟล์"
            accent="emerald"
          />
          <button
            onClick={() => window.open(`${BASE_URL}/api/import/excel/template`, '_blank')}
            className="flex items-center gap-1.5 text-sm text-emerald-700 hover:text-emerald-800 font-medium mt-3 bg-emerald-100 hover:bg-emerald-200 rounded-lg px-3 py-1.5 transition-all"
          >
            <Download className="w-4 h-4" />
            ดาวน์โหลดเทมเพลตแบบด่วน (.xlsx)
          </button>
        </div>

        {/* Option 2: Advanced Custom Import */}
        <div className="card border-2 border-blue-200 bg-blue-50/50">
          <div className="flex items-center gap-2 mb-3">
            <FileSpreadsheet className="w-5 h-5 text-blue-600" />
            <h3 className="font-bold text-gray-900">2. นำเข้าแบบกำหนดเองระดับสูง (Advanced Custom Import)</h3>
            <span className="badge bg-blue-100 text-blue-800 text-xs">สำหรับตารางขนาดใหญ่ / มีเงื่อนไขซับซ้อน</span>
          </div>
          <p className="text-sm text-gray-600 mb-4">
            สำหรับอัปโหลดไฟล์โครงสร้างแบบหลายชีท (Multi-Sheets) รวมข้อมูลภาระงาน เงื่อนไขข้อห้ามสอนของครู (Teacher Constraints) และคาบล็อกตายตัว (Fixed Slots) พร้อมระบบเลือกจับคู่คอลัมน์ (Column Mapping) ได้ตามต้องการ
          </p>
          <ExcelDropZone
            onFile={(file) => setShowExcelImport({ file, mode: 'full' })}
            label="ลากไฟล์ Excel สมบูรณ์มาวางที่นี่ หรือ คลิกเพื่อเลือกไฟล์"
            accent="blue"
          />
          <button
            onClick={() => window.open(`${BASE_URL}/api/import/excel/template-full`, '_blank')}
            className="flex items-center gap-1.5 text-sm text-blue-700 hover:text-blue-800 font-medium mt-3 bg-blue-100 hover:bg-blue-200 rounded-lg px-3 py-1.5 transition-all"
          >
            <Download className="w-4 h-4" />
            ดาวน์โหลดเทมเพลตแบบสมบูรณ์ (.xlsx)
          </button>
        </div>
      </div>

      {/* Current classes list — moved to top, above manual add */}
      {classes.length > 0 && (
        <div className="card">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-bold text-gray-900 flex items-center gap-2">
              <Layers className="w-5 h-5 text-blue-600" />
              ห้องเรียน ({classes.length})
            </h3>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {classes.map((c) => {
              const colors = getRoomTypeColor(c.room_type)
              const isSpecial = isSpecialRoomType(c.room_type)
              return (
                <div
                  key={c.id}
                  className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-sm ${colors.chip}`}
                >
                  <span>{c.name}</span>
                  {isSpecial && (
                    <span className={`text-[10px] px-1 rounded ${colors.badge}`}>{c.room_type}</span>
                  )}
                  <button
                    onClick={() => removeClass(c.id)}
                    className="text-red-400 hover:text-red-600"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Manual option */}
      <div className="card border-2 border-gray-200">
        <div className="flex items-center gap-2 mb-3">
          <Plus className="w-5 h-5 text-gray-600" />
          <h3 className="font-bold text-gray-900">เพิ่มห้องเรียนเอง</h3>
        </div>
        <p className="text-sm text-gray-600 mb-4">
          สร้างรายการห้องเรียนด้วยตนเอง เหมาะกับโรงเรียนที่ยังไม่มีไฟล์ Excel
        </p>
        <ManualClassForm onAdd={addManualClass} onAddBatch={addGradeBatch} />
      </div>

      {/* Special Rooms (Facilities) Manager */}
      <div className="card border-2 border-indigo-200 bg-indigo-50/30">
        <div className="flex items-center gap-2 mb-3">
          <FlaskConical className="w-5 h-5 text-indigo-600" />
          <h3 className="font-bold text-gray-900">จัดการห้องพิเศษ (Labs / ห้องปฏิบัติการ)</h3>
        </div>
        <p className="text-sm text-gray-600 mb-4">
          ห้องพิเศษคือห้องที่ไม่ใช่ห้องเรียนประจำชั้น เช่น ห้องวิทยาศาสตร์ ห้องคอมพิวเตอร์ ห้องดนตรี ห้องโสตทัศนศึกษา — สามารถเพิ่ม แก้ไข หรือลบได้ที่นี่ และเลือกใช้ในฟอร์มแก้ไขรายวิชา
        </p>
        <SpecialRoomsManager />
      </div>

      {/* Lab Period Splitter — assign lab periods to subjects */}
      {fixtureData?.lesson_blocks?.length > 0 && (fixtureData?.special_rooms?.length || 0) > 0 && (
        <div className="card border-2 border-purple-200 bg-purple-50/30">
          <div className="flex items-center gap-2 mb-3">
            <FlaskConical className="w-5 h-5 text-purple-600" />
            <h3 className="font-bold text-gray-900">กำหนดคาบห้องปฏิบัติการ (Lab Periods)</h3>
          </div>
          <p className="text-sm text-gray-600 mb-4">
            แยกคาบเรียนออกเป็นคาบห้องปกติ + คาบห้องปฏิบัติการ เช่น วิทย์ 5 คาบ = 3 คาบในห้องเรียน + 2 คาบในห้องแล็บ — เลือกชั้น → เลือกห้อง → เลือกวิชา → กำหนดคาบแล็บ → นำไปใช้
          </p>
          <LabPeriodSplitter />
        </div>
      )}

      {/* Sticky Global Wizard Footer */}
      <div className="fixed bottom-0 left-0 right-0 z-50 bg-white/95 backdrop-blur border-t border-gray-200 shadow-lg px-4 sm:px-6 lg:px-8 py-3">
        <div className="max-w-7xl mx-auto flex items-center justify-between gap-4">
          <button
            onClick={() => setStep(0)}
            className="btn-secondary text-sm flex items-center gap-1.5 shrink-0"
          >
            <ArrowLeft className="w-4 h-4" />
            กลับ
          </button>
          <div className="hidden sm:flex items-center gap-2 text-sm min-w-0">
            <Layers className="w-4 h-4 text-blue-500 shrink-0" />
            <span className="text-gray-700 font-medium truncate">
              ห้องเรียน {classes.length} ห้อง
            </span>
          </div>
          <button
            onClick={() => setStep(2)}
            disabled={classes.length === 0}
            className="flex items-center gap-2 px-6 py-2.5 bg-blue-600 text-white rounded-xl font-bold text-sm hover:bg-blue-700 transition-colors shadow-md whitespace-nowrap disabled:opacity-50 disabled:cursor-not-allowed shrink-0"
          >
            ถัดไป: สร้างบล็อกตารางเรียน
            <ArrowRight className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Excel Import Modal */}
      {showExcelImport && (
        <ExcelImportModal
          initialFile={showExcelImport.file}
          mode={showExcelImport.mode}
          onClose={() => setShowExcelImport(false)}
          onDone={() => setShowExcelImport(false)}
        />
      )}
    </div>
  )
}

// ── Manual Class Form ───────────────────────────────────────────────────────

function ManualClassForm({ onAdd, onAddBatch }) {
  const [mode, setMode] = useState('batch')

  // Batch mode state
  const [batchGrade, setBatchGrade] = useState(1)
  const [batchCount, setBatchCount] = useState(2)
  const [batchRoomType, setBatchRoomType] = useState('ห้องปกติ')
  const [batchCustomType, setBatchCustomType] = useState('')

  // Single mode state
  const [singleGrade, setSingleGrade] = useState(1)
  const [singleRoomNo, setSingleRoomNo] = useState(1)
  const [singleRoomType, setSingleRoomType] = useState('ห้องปกติ')
  const [singleCustomType, setSingleCustomType] = useState('')

  // Range mode state
  const [rangePreset, setRangePreset] = useState(null)
  const [rangeCount, setRangeCount] = useState(2)
  const [rangeRoomType, setRangeRoomType] = useState('ห้องปกติ')
  const [rangeCustomType, setRangeCustomType] = useState('')

  function getRoomType(type, custom) {
    return type === 'อื่นๆ' ? (custom.trim() || 'อื่นๆ') : type
  }

  function handleBatchAdd() {
    onAddBatch([batchGrade], batchCount, getRoomType(batchRoomType, batchCustomType))
  }

  function handleSingleAdd() {
    const label = gradeLevelToLabel(singleGrade)
    const name = `${label}/${singleRoomNo}`
    onAdd(name, singleGrade, getRoomType(singleRoomType, singleCustomType))
  }

  function handleRangeAdd() {
    if (!rangePreset) return
    onAddBatch(rangePreset.grades, rangeCount, getRoomType(rangeRoomType, rangeCustomType))
  }

  const RoomTypeSelector = ({ value, onChange, customValue, onCustomChange }) => (
    <div className="flex gap-1.5 flex-wrap">
      {ROOM_TYPES.map((t) => {
        const colors = getRoomTypeColor(t)
        return (
          <button
            key={t}
            onClick={() => onChange(t)}
            className={`text-xs px-2 py-1 rounded-md font-medium border transition-all
              ${value === t ? colors.selected : colors.unselected}`}
          >
            {t}
          </button>
        )
      })}
      {value === 'อื่นๆ' && (
        <input
          type="text"
          value={customValue}
          onChange={(e) => onCustomChange(e.target.value)}
          placeholder="ระบุชนิดห้อง"
          className="border border-gray-300 rounded-md px-2 py-1 text-xs w-28"
        />
      )}
    </div>
  )

  return (
    <div className="space-y-3">
      {/* Mode toggle — 3 modes */}
      <div className="flex gap-1 bg-gray-100 rounded-lg p-0.5">
        <button
          onClick={() => setMode('range')}
          className={`flex-1 text-xs py-1.5 rounded-md font-medium transition-all ${mode === 'range' ? 'bg-white text-blue-700 shadow-sm' : 'text-gray-500'}`}
        >
          เพิ่มเป็นช่วงชั้น
        </button>
        <button
          onClick={() => setMode('batch')}
          className={`flex-1 text-xs py-1.5 rounded-md font-medium transition-all ${mode === 'batch' ? 'bg-white text-blue-700 shadow-sm' : 'text-gray-500'}`}
        >
          เพิ่มเป็นชั้น
        </button>
        <button
          onClick={() => setMode('single')}
          className={`flex-1 text-xs py-1.5 rounded-md font-medium transition-all ${mode === 'single' ? 'bg-white text-blue-700 shadow-sm' : 'text-gray-500'}`}
        >
          ทีละห้อง
        </button>
      </div>

      {/* ── Range mode: อ.1-3, ป.1-3, etc. ── */}
      {mode === 'range' && (
        <div className="space-y-3">
          <div>
            <label className="text-xs font-medium text-gray-600 mb-1 block">ช่วงชั้น</label>
            <div className="flex gap-1.5 flex-wrap">
              {GRADE_RANGE_PRESETS.map((rp) => (
                <button
                  key={rp.label}
                  onClick={() => setRangePreset(rp)}
                  className={`text-xs px-2.5 py-1.5 rounded-lg font-medium border-2 transition-all
                    ${rangePreset?.label === rp.label
                      ? 'bg-blue-600 text-white border-blue-600'
                      : 'bg-white text-gray-600 border-gray-200 hover:border-blue-300'
                    }`}
                >
                  {rp.label}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="text-xs font-medium text-gray-600 mb-1 block">จำนวนห้อง/ชั้น</label>
            <input
              type="number" min="1" max="20"
              value={rangeCount}
              onChange={(e) => setRangeCount(parseInt(e.target.value) || 1)}
              className="border border-gray-300 rounded-lg px-2 py-1.5 text-sm w-20 text-center"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-gray-600 mb-1 block">ชนิดห้อง</label>
            <RoomTypeSelector
              value={rangeRoomType}
              onChange={setRangeRoomType}
              customValue={rangeCustomType}
              onCustomChange={setRangeCustomType}
            />
          </div>
          {rangePreset && (
            <p className="text-xs text-gray-400">
              ตัวอย่าง: {rangePreset.grades.map((g) => gradeLevelToLabel(g)).map((l) => `${l}/1`).join(', ')}
              {' ...'} ({rangePreset.grades.length} ชั้น × {rangeCount} ห้อง = {rangePreset.grades.length * rangeCount} ห้อง)
            </p>
          )}
          <button
            onClick={handleRangeAdd}
            disabled={!rangePreset}
            className="btn-primary text-xs flex items-center gap-1 w-full justify-center"
          >
            <Plus className="w-3 h-3" />
            เพิ่ม {rangePreset ? `${rangePreset.grades.length * rangeCount} ห้อง` : ''}
          </button>
        </div>
      )}

      {/* ── Batch mode: single grade, N rooms ── */}
      {mode === 'batch' && (
        <div className="space-y-3">
          <div className="flex gap-2 items-end">
            <div className="flex-1">
              <label className="text-xs font-medium text-gray-600 mb-1 block">ระดับชั้น</label>
              <select
                value={batchGrade}
                onChange={(e) => setBatchGrade(parseInt(e.target.value))}
                className="border border-gray-300 rounded-lg px-2 py-1.5 text-sm w-full"
              >
                {GRADE_LEVELS.map((g) => (
                  <option key={g.value} value={g.value}>{g.label}</option>
                ))}
              </select>
            </div>
            <div className="w-20">
              <label className="text-xs font-medium text-gray-600 mb-1 block">จำนวนห้อง</label>
              <input
                type="number" min="1" max="20"
                value={batchCount}
                onChange={(e) => setBatchCount(parseInt(e.target.value) || 1)}
                className="border border-gray-300 rounded-lg px-2 py-1.5 text-sm w-full text-center"
              />
            </div>
          </div>
          <div>
            <label className="text-xs font-medium text-gray-600 mb-1 block">ชนิดห้อง</label>
            <RoomTypeSelector
              value={batchRoomType}
              onChange={setBatchRoomType}
              customValue={batchCustomType}
              onCustomChange={setBatchCustomType}
            />
          </div>
          <p className="text-xs text-gray-400">
            ตัวอย่าง: {gradeLevelToLabel(batchGrade)}/1, {gradeLevelToLabel(batchGrade)}/2, ... ({batchCount} ห้อง)
          </p>
          <button
            onClick={handleBatchAdd}
            className="btn-primary text-xs flex items-center gap-1 w-full justify-center"
          >
            <Plus className="w-3 h-3" />
            เพิ่ม {batchCount} ห้อง
          </button>
        </div>
      )}

      {/* ── Single mode: one room at a time ── */}
      {mode === 'single' && (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-xs font-medium text-gray-600 mb-1 block">ระดับชั้น</label>
              <select
                value={singleGrade}
                onChange={(e) => setSingleGrade(parseInt(e.target.value))}
                className="border border-gray-300 rounded-lg px-2 py-1.5 text-sm w-full"
              >
                {GRADE_LEVELS.map((g) => (
                  <option key={g.value} value={g.value}>{g.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs font-medium text-gray-600 mb-1 block">ห้องที่</label>
              <input
                type="number" min="1" max="20"
                value={singleRoomNo}
                onChange={(e) => setSingleRoomNo(parseInt(e.target.value) || 1)}
                className="border border-gray-300 rounded-lg px-2 py-1.5 text-sm w-full text-center"
              />
            </div>
          </div>
          <div>
            <label className="text-xs font-medium text-gray-600 mb-1 block">ชนิดห้อง</label>
            <RoomTypeSelector
              value={singleRoomType}
              onChange={setSingleRoomType}
              customValue={singleCustomType}
              onCustomChange={setSingleCustomType}
            />
          </div>
          <p className="text-xs text-gray-400">
            ตัวอย่าง: {gradeLevelToLabel(singleGrade)}/{singleRoomNo}
          </p>
          <button
            onClick={handleSingleAdd}
            className="btn-primary text-xs flex items-center gap-1 w-full justify-center"
          >
            <Plus className="w-3 h-3" />
            เพิ่ม {gradeLevelToLabel(singleGrade)}/{singleRoomNo}
          </button>
        </div>
      )}
    </div>
  )
}

// ── Excel Drop Zone ─────────────────────────────────────────────────────────

function ExcelDropZone({ onFile, label = 'ลากไฟล์ Excel มาวาง หรือคลิกเพื่อเลือกไฟล์', accent = 'blue' }) {
  const [dragOver, setDragOver] = useState(false)

  const handleDrop = useCallback((e) => {
    e.preventDefault()
    setDragOver(false)
    const file = e.dataTransfer.files[0]
    if (file && /\.(xlsx|xls)$/i.test(file.name)) {
      onFile(file)
    }
  }, [onFile])

  const handleSelect = useCallback((e) => {
    const file = e.target.files[0]
    if (file) onFile(file)
  }, [onFile])

  return (
    <label
      onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
      onDragLeave={() => setDragOver(false)}
      onDrop={handleDrop}
      className={`block border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition-all
        ${dragOver
          ? accent === 'emerald'
            ? 'border-emerald-500 bg-emerald-100 scale-[1.02]'
            : 'border-blue-500 bg-blue-100 scale-[1.02]'
          : accent === 'emerald'
          ? 'border-gray-300 hover:border-emerald-400 hover:bg-emerald-50'
          : 'border-gray-300 hover:border-blue-400 hover:bg-blue-50'
        }`}
    >
      <Upload className="w-8 h-8 text-gray-400 mx-auto mb-2" />
      <div className="font-medium text-gray-700 text-sm">
        {label}
      </div>
      <div className="text-xs text-gray-400 mt-1">รองรับ .xlsx, .xls</div>
      <input type="file" accept=".xlsx,.xls" className="hidden" onChange={handleSelect} />
    </label>
  )
}

// ── Excel Import Modal ──────────────────────────────────────────────────────

function ExcelImportModal({ initialFile, mode = 'full', onClose, onDone }) {
  const { setFixtureDataDirect, clearResult } = useApp()
  const [step, setStep] = useState('upload')
  const [file, setFile] = useState(null)
  const [detectResult, setDetectResult] = useState(null)
  const [mapping, setMapping] = useState({})
  const [importResult, setImportResult] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  const FIELDS = [
    { key: 'teacher_name', label: 'ชื่อครู' },
    { key: 'subject', label: 'วิชา' },
    { key: 'class_name', label: 'ห้องเรียน' },
    { key: 'periods_per_week', label: 'คาบ/สัปดาห์' },
    { key: 'is_double', label: 'คาบคู่ (optional)' },
  ]

  async function handleFileSelect(selectedFile) {
    if (!selectedFile) return
    setFile(selectedFile)
    setLoading(true)
    setError(null)
    try {
      if (mode === 'minimum') {
        // Minimum mode: skip detect/mapping, import directly
        await handleMinimumImport(selectedFile)
      } else {
        // Full mode: detect columns then show mapping
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
      }
    } catch (err) {
      setError(err.message)
    }
    setLoading(false)
  }

  // Auto-process if initialFile is provided (from drop zone)
  useEffect(() => {
    if (initialFile && initialFile instanceof File) {
      handleFileSelect(initialFile)
    }
  }, [initialFile])

  async function handleMinimumImport(selectedFile) {
    setLoading(true)
    setError(null)
    try {
      const formData = new FormData()
      formData.append('file', selectedFile)
      const res = await fetch(`${BASE_URL}/api/import/excel/import-minimum`, {
        method: 'POST',
        body: formData,
      })
      if (!res.ok) throw new Error((await res.text()) || 'Failed to import')
      const data = await res.json()
      setImportResult(data)
      clearResult()

      const teachers = (data.teachers || []).map((t) => ({
        id: t.id, name: t.name,
        max_periods_per_week: t.max_periods_per_week || 22,
        min_periods_per_week: t.min_periods_per_week || 0,
        unavailable_slots: t.unavailable_slots || [],
        admin_role: t.admin_role || 'none',
      }))
      const classRooms = (data.classes || []).map((c) => ({
        id: `R_${c.id}`, name: `ห้อง ${c.name}`, room_type: 'classroom',
      }))
      const specialRooms = data.special_rooms || []
      const rooms = [...classRooms, ...specialRooms]

      setFixtureDataDirect({
        teachers,
        rooms,
        special_rooms: specialRooms,
        subjects: data.subjects || [],
        classes: data.classes || [],
        lesson_blocks: data.lesson_blocks || [],
        fixed_slots: data.fixed_slots || [],
        schedule_blocks: [],
        special_activities: [],
        schedule_config: {
          days_per_week: 5, periods_per_day: 8, lunch_periods: [4],
          assembly_slots: [], max_consecutive_teaching: 4, pe_hot_periods: [],
        },
        solver_time_limit_seconds: 5.0,
      })
      setStep('done')
    } catch (err) {
      setError(err.message)
    }
    setLoading(false)
  }

  async function handleImport() {
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

      const teachers = (data.teachers || []).map((t) => ({
        id: t.id, name: t.name,
        max_periods_per_week: t.max_periods_per_week || 22,
        min_periods_per_week: t.min_periods_per_week || 0,
        unavailable_slots: t.unavailable_slots || [],
        admin_role: t.admin_role || 'none',
      }))
      const classRooms = (data.classes || []).map((c) => ({
        id: `R_${c.id}`, name: `ห้อง ${c.name}`, room_type: 'classroom',
      }))
      const specialRooms = data.special_rooms || []
      const rooms = (data.rooms && data.rooms.length > 0) ? data.rooms : [...classRooms, ...specialRooms]

      setFixtureDataDirect({
        teachers,
        rooms,
        special_rooms: specialRooms,
        subjects: data.subjects || [],
        classes: data.classes || [],
        lesson_blocks: data.lesson_blocks || [],
        fixed_slots: data.fixed_slots || [],
        schedule_blocks: [],
        special_activities: [],
        schedule_config: {
          days_per_week: 5, periods_per_day: 8, lunch_periods: [4],
          assembly_slots: [], max_consecutive_teaching: 4, pe_hot_periods: [],
        },
        solver_time_limit_seconds: 5.0,
      })
      setStep('done')
    } catch (err) {
      setError(err.message)
    }
    setLoading(false)
  }

  return (
    <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-lg p-6 w-full max-w-lg space-y-4" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h3 className="font-bold text-gray-900">
            {mode === 'minimum' ? 'นำเข้าไฟล์ Excel (แบบกรอกขั้นต่ำ)' : 'นำเข้าไฟล์ Excel (แบบเติม)'}
          </h3>
          <button onClick={onClose}><X className="w-5 h-5 text-gray-400" /></button>
        </div>

        {error && (
          <div className="text-red-600 text-sm bg-red-50 border border-red-200 rounded-lg px-3 py-2">
            {error}
          </div>
        )}

        {step === 'upload' && (
          <label className="block">
            <div className="border-2 border-dashed border-gray-300 rounded-xl p-6 text-center cursor-pointer hover:border-blue-400 hover:bg-blue-50 transition-all">
              {loading ? (
                <div className="text-gray-500">กำลังประมวลผล...</div>
              ) : (
                <>
                  <Upload className="w-8 h-8 text-gray-400 mx-auto mb-2" />
                  <div className="font-medium text-gray-700">คลิกหรือลากไฟล์ Excel มาวาง</div>
                  <div className="text-xs text-gray-400 mt-1">
                    {mode === 'minimum' ? 'รองรับ .xlsx (1 ชีท, ขั้นต่ำ)' : 'รองรับ .xlsx (หลายชีท)'}
                  </div>
                </>
              )}
            </div>
            <input type="file" accept=".xlsx,.xls" className="hidden"
              onChange={(e) => handleFileSelect(e.target.files[0])} />
          </label>
        )}

        {step === 'mapping' && detectResult && (
          <div className="space-y-3">
            <div className="text-sm text-gray-600">{detectResult.row_count} แถว</div>
            {FIELDS.map((field) => (
              <div key={field.key} className="flex items-center gap-2">
                <div className="w-32 text-sm font-medium text-gray-700">{field.label}</div>
                <select
                  value={mapping[field.key] || ''}
                  onChange={(e) => setMapping({ ...mapping, [field.key]: e.target.value || null })}
                  className="flex-1 border border-gray-300 rounded-lg px-2 py-1.5 text-sm"
                >
                  <option value="">— ไม่เลือก —</option>
                  {detectResult.headers.map((h) => <option key={h} value={h}>{h}</option>)}
                </select>
              </div>
            ))}
            <button
              onClick={handleImport}
              disabled={loading || !mapping.teacher_name || !mapping.subject || !mapping.class_name}
              className="btn-primary text-sm w-full"
            >
              {loading ? 'กำลังนำเข้า...' : 'นำเข้าข้อมูล'}
            </button>
          </div>
        )}

        {step === 'done' && importResult && (
          <div className="space-y-3 text-center">
            <Check className="w-10 h-10 text-green-600 mx-auto" />
            <p className="font-bold text-gray-900">นำเข้าสำเร็จ!</p>
            <div className="grid grid-cols-4 gap-2 text-sm">
              <div className="bg-blue-50 rounded p-2">
                <div className="font-bold text-blue-700">{importResult.summary.teachers}</div>
                <div className="text-xs text-blue-600">ครู</div>
              </div>
              <div className="bg-blue-50 rounded p-2">
                <div className="font-bold text-blue-700">{importResult.summary.subjects}</div>
                <div className="text-xs text-blue-600">วิชา</div>
              </div>
              <div className="bg-blue-50 rounded p-2">
                <div className="font-bold text-blue-700">{importResult.summary.classes}</div>
                <div className="text-xs text-blue-600">ห้อง</div>
              </div>
              <div className="bg-blue-50 rounded p-2">
                <div className="font-bold text-blue-700">{importResult.summary.lesson_blocks}</div>
                <div className="text-xs text-blue-600">LB</div>
              </div>
            </div>
            {importResult.summary.teacher_only > 0 && (
              <p className="text-xs text-amber-600 bg-amber-50 rounded-lg px-3 py-2">
                มี {importResult.summary.teacher_only} แถวที่มีเฉพาะชื่อครู (ไม่มีวิชา/ห้องเรียน) — นำเข้าครูแล้ว สามารถเพิ่มวิชาได้ภายหลัง
              </p>
            )}
            {importResult.warnings && importResult.warnings.length > 0 && (
              <div className="bg-amber-50 border border-amber-300 rounded-lg p-3 text-left text-sm text-amber-800">
                {importResult.warnings.map((w, idx) =>
                  w.type === 'merged_duplicates' ? (
                    <div key={idx}>
                      <span className="font-bold">⚠ พบแถวซ้ำ {w.merged.length} กลุ่ม:</span>{' '}
                      ระบบรวมคาบของแถวที่ซ้ำกัน (ครู+วิชา+ห้อง+ห้องเรียน เดียวกัน) ให้อัตโนมัติ
                    </div>
                  ) : null,
                )}
              </div>
            )}
            <button onClick={onDone} className="btn-primary text-sm">
              เสร็จสิ้น
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
