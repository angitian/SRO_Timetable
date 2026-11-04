import { useEffect, useMemo, useState } from 'react'
import { Download, FileText, Printer, SlidersHorizontal } from 'lucide-react'
import {
  REPORT_TYPES,
  buildReportCSV,
  buildReportHTML,
  defaultOrientation,
  printHTML,
  resolveReportRange,
} from '../../utils/traineeReports.js'
import {
  dashboardRangeLabel,
  downloadText,
  formatThaiDate,
  todayISO,
} from '../../utils/traineeAttendance.js'
import TraineeDateField from './TraineeDateField.jsx'

const RANGE_MODES = [
  { value: 'month', label: 'รายเดือน' },
  { value: 'semester', label: 'ภาคเรียน' },
  { value: 'week', label: 'รายสัปดาห์' },
]

function Field({ label, children, hint }) {
  return (
    <label className="block text-xs font-semibold text-slate-600">
      {label}
      <div className="mt-1">{children}</div>
      {hint && <div className="text-[10px] font-normal text-slate-400 mt-1">{hint}</div>}
    </label>
  )
}

export default function TraineePrintStudio({
  trainees = [],
  attendance = {},
  reference = null,
  initialType = 'daily',
  initialDateKey,
}) {
  const [type, setType] = useState(initialType)
  const [dateKey, setDateKey] = useState(() => initialDateKey || todayISO())
  const [rangeMode, setRangeMode] = useState(initialType === 'dashboard' ? 'semester' : 'month')
  const [studentId, setStudentId] = useState(() => trainees[0]?.id || '')
  const [orientation, setOrientation] = useState(() => defaultOrientation(initialType))
  const [schoolName, setSchoolName] = useState('')
  const [termLabel, setTermLabel] = useState(
    reference ? `ภาคเรียนที่ ${reference.term || 2}/${reference.academicYear || 2569}` : '',
  )
  const [signatureLeft, setSignatureLeft] = useState('ผู้รายงาน')
  const [signatureRight, setSignatureRight] = useState('ผู้ตรวจสอบ')
  const [includeNotes, setIncludeNotes] = useState(true)
  const [sortBy, setSortBy] = useState('name')
  const [error, setError] = useState('')

  useEffect(() => {
    if (!studentId && trainees[0]?.id) setStudentId(trainees[0].id)
  }, [studentId, trainees])

  const settings = {
    dateKey,
    rangeMode,
    studentId,
    orientation,
    schoolName,
    termLabel,
    signatureLeft,
    signatureRight,
    includeNotes,
    sortBy,
  }
  const range = useMemo(
    () => resolveReportRange(type, settings, reference),
    [type, dateKey, rangeMode, reference],
  )
  const html = useMemo(
    () => buildReportHTML({ type, trainees, attendance, reference, settings }),
    [type, trainees, attendance, reference, settings],
  )
  const reportLabel = REPORT_TYPES.find((r) => r.value === type)?.label || 'รายงาน'
  const rangeLabel = type === 'daily'
    ? formatThaiDate(dateKey, { month: 'long' })
    : dashboardRangeLabel(dateKey, rangeMode, reference)

  function handleTypeChange(nextType) {
    setType(nextType)
    setOrientation(defaultOrientation(nextType))
    if (nextType === 'dashboard') setRangeMode('semester')
    setError('')
  }

  function handlePrint() {
    setError('')
    if (!printHTML(html)) setError('เบราว์เซอร์บล็อกหน้าต่างพิมพ์ — กรุณาอนุญาต pop-up แล้วลองอีกครั้ง')
  }

  function handleExport() {
    setError('')
    const csv = buildReportCSV({ type, trainees, attendance, reference, settings })
    const safeType = type === 'student'
      ? `student_${trainees.find((t) => t.id === studentId)?.name || 'report'}`
      : type
    downloadText(`${safeType}_${range.start}_${range.end}.csv`, csv)
  }

  return (
    <div className="grid grid-cols-1 xl:grid-cols-[300px_minmax(0,1fr)] gap-5">
      <aside className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm h-fit print:hidden">
        <h3 className="text-sm font-bold text-slate-800 flex items-center gap-2 mb-4">
          <SlidersHorizontal className="w-4 h-4 text-violet-500" /> ตั้งค่ารายงาน
        </h3>
        <div className="space-y-3">
          <Field label="ประเภทรายงาน">
            <select value={type} onChange={(e) => handleTypeChange(e.target.value)} className="w-full rounded-lg border border-slate-300 px-2.5 py-2 text-xs bg-white">
              {REPORT_TYPES.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
            </select>
          </Field>
          <Field label={type === 'daily' ? 'วันที่รายงาน' : 'วันที่อ้างอิง'}>
            <TraineeDateField value={dateKey} onChange={(value) => setDateKey(value || todayISO())} />
          </Field>
          {type !== 'daily' && (
            <Field label="ช่วงรายงาน">
              <select value={rangeMode} onChange={(e) => setRangeMode(e.target.value)} className="w-full rounded-lg border border-slate-300 px-2.5 py-2 text-xs bg-white">
                {RANGE_MODES.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
              </select>
            </Field>
          )}
          {type === 'student' && (
            <Field label="นักศึกษา">
              <select value={studentId} onChange={(e) => setStudentId(e.target.value)} className="w-full rounded-lg border border-slate-300 px-2.5 py-2 text-xs bg-white">
                {trainees.length === 0 ? <option value="">ยังไม่มีรายชื่อ</option> : trainees.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </Field>
          )}
          <Field label="แนวกระดาษ">
            <div className="grid grid-cols-2 gap-1.5">
              {[
                { value: 'portrait', label: 'แนวตั้ง' },
                { value: 'landscape', label: 'แนวนอน' },
              ].map((o) => (
                <button
                  key={o.value}
                  type="button"
                  onClick={() => setOrientation(o.value)}
                  className={`px-2 py-2 rounded-lg text-xs font-semibold border ${orientation === o.value ? 'bg-violet-600 text-white border-violet-600' : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'}`}
                >
                  {o.label}
                </button>
              ))}
            </div>
          </Field>
          <Field label="ชื่อโรงเรียน / หน่วยงาน">
            <input value={schoolName} onChange={(e) => setSchoolName(e.target.value)} placeholder="เช่น โรงเรียน..." className="w-full rounded-lg border border-slate-300 px-2.5 py-2 text-xs" />
          </Field>
          <Field label="ภาคเรียน">
            <input value={termLabel} onChange={(e) => setTermLabel(e.target.value)} placeholder="เช่น ภาคเรียนที่ 2/2569" className="w-full rounded-lg border border-slate-300 px-2.5 py-2 text-xs" />
          </Field>
          <Field label="เรียงตาม">
            <select value={sortBy} onChange={(e) => setSortBy(e.target.value)} className="w-full rounded-lg border border-slate-300 px-2.5 py-2 text-xs bg-white">
              <option value="name">ชื่อ</option>
              <option value="major">วิชาเอก</option>
              <option value="mentor">ครูพี่เลี้ยง</option>
            </select>
          </Field>
          <div className="grid grid-cols-2 gap-2">
            <Field label="ผู้รายงาน">
              <input value={signatureLeft} onChange={(e) => setSignatureLeft(e.target.value)} className="w-full rounded-lg border border-slate-300 px-2.5 py-2 text-xs" />
            </Field>
            <Field label="ผู้ตรวจสอบ">
              <input value={signatureRight} onChange={(e) => setSignatureRight(e.target.value)} className="w-full rounded-lg border border-slate-300 px-2.5 py-2 text-xs" />
            </Field>
          </div>
          <label className="flex items-center gap-2 text-xs text-slate-600">
            <input type="checkbox" checked={includeNotes} onChange={(e) => setIncludeNotes(e.target.checked)} className="rounded border-slate-300" />
            แสดงคอลัมน์หมายเหตุในรายงานรายวัน
          </label>
        </div>
      </aside>

      <section className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 border-b border-slate-100 print:hidden">
          <div>
            <h3 className="text-sm font-bold text-slate-800 flex items-center gap-2">
              <FileText className="w-4 h-4 text-violet-500" /> {reportLabel}
            </h3>
            <p className="text-[11px] text-slate-400 mt-0.5">{rangeLabel}</p>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={handleExport} className="flex items-center gap-1 px-3 py-2 rounded-lg text-xs font-semibold bg-blue-50 text-blue-700 border border-blue-200 hover:bg-blue-100">
              <Download className="w-3.5 h-3.5" /> CSV
            </button>
            <button onClick={handlePrint} className="flex items-center gap-1 px-3 py-2 rounded-lg text-xs font-semibold bg-violet-600 text-white hover:bg-violet-700">
              <Printer className="w-3.5 h-3.5" /> พิมพ์รายงาน
            </button>
          </div>
        </div>
        {error && <div className="mx-4 mt-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">{error}</div>}
        <div className="p-3 bg-slate-100">
          <iframe
            title={`preview-${type}`}
            srcDoc={html}
            sandbox=""
            className="w-full rounded-lg bg-white border border-slate-200"
            style={{ height: '72vh', minHeight: 520 }}
          />
        </div>
        <div className="px-4 py-2 text-[10px] text-slate-400 print:hidden">
          Preview ใช้ HTML ชุดเดียวกับหน้าต่างพิมพ์ · A4 {orientation === 'portrait' ? 'แนวตั้ง' : 'แนวนอน'}
        </div>
      </section>
    </div>
  )
}
