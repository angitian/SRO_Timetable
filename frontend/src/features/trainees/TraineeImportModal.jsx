import { useMemo, useState } from 'react'
import { AlertCircle, Check, Download, FileSpreadsheet, Loader2, Upload, X } from 'lucide-react'
import { makeTraineeId, normalizeText } from '../../utils/traineeAttendance.js'
import { downloadTraineeTemplate } from '../../utils/traineeExcelTemplate.js'

const ALIASES = {
  studentCode: ['studentcode', 'student_code', 'รหัส', 'รหัสนักศึกษา', 'รหัส นศ.', 'code'],
  name: ['name', 'ชื่อ', 'ชื่อ-นามสกุล', 'ชื่อ–นามสกุล', 'ชื่อ นามสกุล'],
  major: ['major', 'วิชาเอก', 'สาขา', 'สาขาวิชา'],
  institution: ['institution', 'สถาบัน', 'มหาวิทยาลัย', 'วิทยาลัย'],
  mentorTeacherName: ['mentorteachername', 'mentor', 'ครูพี่เลี้ยง', 'พี่เลี้ยง'],
  subjectName: ['subjectname', 'subject', 'วิชา', 'วิชาที่สอน'],
  className: ['classname', 'class', 'ชั้น', 'ชั้นเรียน'],
  roomName: ['roomname', 'room', 'ห้อง', 'ห้องที่ใช้ฝึกสอน'],
  weeklyPeriods: ['weeklyperiods', 'periods', 'คาบ', 'คาบ/สัปดาห์', 'จำนวนคาบ'],
  phone: ['phone', 'tel', 'เบอร์โทร', 'โทรศัพท์', 'เบอร์'],
  email: ['email', 'อีเมล', 'เมล'],
  advisorName: ['advisorname', 'advisor', 'อาจารย์นิเทศ', 'ครูนิเทศ', 'นิเทศ'],
  internshipStart: ['internshipstart', 'startdate', 'เริ่มฝึก', 'วันเริ่ม', 'วันเริ่มฝึก', 'วันเริ่มฝึกงาน'],
  internshipEnd: ['internshipend', 'enddate', 'สิ้นสุดฝึก', 'วันสิ้นสุด', 'วันสิ้นสุดฝึก', 'วันสิ้นสุดฝึกงาน'],
  workplace: ['workplace', 'organization', 'หน่วยงาน', 'หน่วยงาน/โรงเรียน', 'โรงเรียนที่ฝึก', 'สถานที่ฝึก'],
  department: ['department', 'แผนก', 'แผนก/กลุ่มสาระ', 'กลุ่มสาระ', 'หน่วยงานย่อย'],
  note: ['note', 'หมายเหตุ', 'รายละเอียด'],
}

function normalizeHeader(value) {
  return normalizeText(value).replace(/[\s_]+/g, '')
}

function pick(row, field) {
  const keys = Object.keys(row)
  const aliases = ALIASES[field].map(normalizeHeader)
  for (const key of keys) {
    if (aliases.includes(normalizeHeader(key))) return row[key]
  }
  return ''
}

export default function TraineeImportModal({ reference, onImport, onClose }) {
  const [rows, setRows] = useState([])
  const [fileName, setFileName] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const teachers = reference?.teachers || []
  const subjects = reference?.subjects || []
  const classes = reference?.classes || []
  const rooms = reference?.rooms || []

  const preview = useMemo(() => rows.slice(0, 8), [rows])

  async function handleFile(file) {
    if (!file) return
    setLoading(true)
    setError('')
    setRows([])
    setFileName(file.name)
    try {
      if (!/\.(xlsx|xls)$/i.test(file.name)) throw new Error('รองรับเฉพาะไฟล์ .xlsx หรือ .xls')
      const mod = await import('xlsx-js-style')
      const XLSX = mod.default || mod
      const buffer = await file.arrayBuffer()
      const wb = XLSX.read(buffer, { type: 'array' })
      const sheet = wb.Sheets[wb.SheetNames[0]]
      const json = XLSX.utils.sheet_to_json(sheet, { defval: '' })
      const parsed = []
      for (const row of json) {
        const name = String(pick(row, 'name') || '').trim()
        const studentCode = String(pick(row, 'studentCode') || '').trim()
        if (!name) continue
        if (/^EXAMPLE/i.test(studentCode) || name.includes('ตัวอย่าง')) continue
        const mentorName = String(pick(row, 'mentorTeacherName') || '').trim()
        const subjectName = String(pick(row, 'subjectName') || '').trim()
        const className = String(pick(row, 'className') || '').trim()
        const roomName = String(pick(row, 'roomName') || '').trim()
        const mentor = teachers.find((t) => normalizeText(t.name) === normalizeText(mentorName))
        const subject = subjects.find((s) => normalizeText(s.name) === normalizeText(subjectName))
        const cls = classes.find((c) => normalizeText(c.name) === normalizeText(className))
        const room = rooms.find((r) => normalizeText(r.name) === normalizeText(roomName))
        parsed.push({
          id: makeTraineeId(),
          studentCode,
          name,
          major: String(pick(row, 'major') || '').trim(),
          institution: String(pick(row, 'institution') || '').trim(),
          mentorTeacherId: mentor?.id || '',
          mentorTeacherName: mentorName,
          subjectId: subject?.id || '',
          subjectName,
          classId: cls?.id || '',
          className,
          roomId: room?.id || '',
          roomName,
          weeklyPeriods: Number(pick(row, 'weeklyPeriods') || 0) || 0,
          phone: String(pick(row, 'phone') || '').trim(),
          email: String(pick(row, 'email') || '').trim(),
          advisorName: String(pick(row, 'advisorName') || '').trim(),
          internshipStart: String(pick(row, 'internshipStart') || '').trim(),
          internshipEnd: String(pick(row, 'internshipEnd') || '').trim(),
          workplace: String(pick(row, 'workplace') || '').trim(),
          department: String(pick(row, 'department') || '').trim(),
          note: String(pick(row, 'note') || '').trim(),
          archived: false,
        })
      }
      if (parsed.length === 0) throw new Error('ไม่พบแถวที่มีชื่อนักศึกษา — ตรวจสอบหัวคอลัมน์')
      setRows(parsed)
    } catch (e) {
      setError(e.message || 'อ่านไฟล์ไม่สำเร็จ')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[130] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-2xl p-5 space-y-4 max-h-[88vh] overflow-y-auto">
        <div className="flex items-center justify-between">
          <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
            <FileSpreadsheet className="w-4 h-4 text-emerald-600" />
            นำเข้ารายชื่อ Excel
          </h3>
          <button onClick={onClose} className="p-1 rounded-lg text-slate-400 hover:bg-slate-100" aria-label="ปิด">
            <X className="w-4 h-4" />
          </button>
        </div>

        <label className="block cursor-pointer">
          <div className="border-2 border-dashed border-slate-300 rounded-xl p-6 text-center hover:border-emerald-400 hover:bg-emerald-50/30 transition-colors">
            {loading ? (
              <Loader2 className="w-7 h-7 text-emerald-500 animate-spin mx-auto" />
            ) : (
              <>
                <Upload className="w-7 h-7 text-slate-400 mx-auto mb-2" />
                <div className="text-sm font-semibold text-slate-700">เลือกไฟล์ Excel (.xlsx / .xls)</div>
                <div className="text-xs text-slate-400 mt-1">รองรับคอลัมน์ ชื่อ, รหัสนักศึกษา, วิชาเอก, สถาบัน, ครูพี่เลี้ยง, วิชา, ชั้น, ห้อง, คาบ</div>
              </>
            )}
          </div>
          <input type="file" accept=".xlsx,.xls" className="hidden" onChange={(e) => handleFile(e.target.files?.[0])} />
        </label>

        {fileName && <p className="text-xs text-slate-500">ไฟล์: {fileName}</p>}
        <button
          type="button"
          onClick={downloadTraineeTemplate}
          className="inline-flex items-center gap-1 text-xs font-semibold text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-lg px-3 py-2"
        >
          <Download className="w-3.5 h-3.5" /> ดาวน์โหลด Template เปล่า
        </button>
        {error && (
          <div className="flex items-start gap-2 text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            {error}
          </div>
        )}

        {rows.length > 0 && (
          <>
            <div className="flex items-center gap-2 text-sm font-semibold text-emerald-700">
              <Check className="w-4 h-4" />
              อ่านได้ {rows.length} รายชื่อ
            </div>
            <div className="overflow-x-auto border border-slate-200 rounded-xl">
              <table className="w-full text-xs">
                <thead className="bg-slate-50 text-slate-500">
                  <tr>
                    <th className="px-3 py-2 text-left">ชื่อ</th>
                    <th className="px-3 py-2 text-left">รหัส</th>
                    <th className="px-3 py-2 text-left">วิชาเอก</th>
                    <th className="px-3 py-2 text-left">ครูพี่เลี้ยง</th>
                    <th className="px-3 py-2 text-left">วิชา/ชั้น</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {preview.map((r) => (
                    <tr key={r.id}>
                      <td className="px-3 py-2 font-medium text-slate-800">{r.name}</td>
                      <td className="px-3 py-2 text-slate-500">{r.studentCode || '—'}</td>
                      <td className="px-3 py-2 text-slate-500">{r.major || '—'}</td>
                      <td className="px-3 py-2 text-slate-500">{r.mentorTeacherName || '—'}</td>
                      <td className="px-3 py-2 text-slate-500">{[r.subjectName, r.className].filter(Boolean).join(' / ') || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {rows.length > preview.length && (
              <p className="text-[11px] text-slate-400">แสดงตัวอย่าง {preview.length} จาก {rows.length} รายการ</p>
            )}
          </>
        )}

        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 rounded-lg text-sm font-medium text-slate-600 bg-slate-100 hover:bg-slate-200">ยกเลิก</button>
          <button
            onClick={() => { onImport(rows); onClose() }}
            disabled={rows.length === 0}
            className="px-4 py-2 rounded-lg text-sm font-semibold bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-40"
          >
            นำเข้า {rows.length || ''} รายชื่อ
          </button>
        </div>
      </div>
    </div>
  )
}
