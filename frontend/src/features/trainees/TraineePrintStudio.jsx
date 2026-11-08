import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Copy,
  Download,
  ExternalLink,
  FileText,
  Link2,
  Loader2,
  Printer,
  SlidersHorizontal,
  Trash2,
} from 'lucide-react'
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
import { buildTraineeSharePayload } from '../../utils/traineeShare.js'
import { deleteTraineeShare, fetchTraineeShare, shareTraineeSummary } from '../../api/client.js'
import TraineeDateField from './TraineeDateField.jsx'

const RANGE_MODES = [
  { value: 'month', label: 'รายเดือน' },
  { value: 'semester', label: 'รายภาคเรียน' },
  { value: 'week', label: 'รายสัปดาห์' },
]

const EXPLICIT_RANGE_TYPES = new Set(['week', 'month', 'semester'])

// Clipboard API needs a secure context (localhost/HTTPS). Fall back to a
// hidden textarea so auto-copy still works on older/insecure setups.
async function copyShareText(text) {
  if (!text) return false
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch { /* fall through to execCommand */ }
  try {
    const el = document.createElement('textarea')
    el.value = text
    el.setAttribute('readonly', '')
    el.style.position = 'fixed'
    el.style.opacity = '0'
    document.body.appendChild(el)
    el.select()
    const ok = document.execCommand('copy')
    document.body.removeChild(el)
    return ok
  } catch {
    return false
  }
}

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
  timetableId = null,
  cloudEnabled = false,
  canEdit = true,
  title = '',
  timetableTitle = '',
  onToast,
  onEnsureSaved,
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
  const [share, setShare] = useState(null) // { shortCode, url, updatedAt }
  const [shareStatus, setShareStatus] = useState('idle') // idle | loading | creating | ready | error
  const shareFetchSeqRef = useRef(0)

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
    : EXPLICIT_RANGE_TYPES.has(type)
      ? dashboardRangeLabel(dateKey, type, reference)
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

  // ── Share summary link (cloud module + edit permission only) ─────────────
  useEffect(() => {
    if (!timetableId || !cloudEnabled || !canEdit) {
      setShare(null)
      setShareStatus('idle')
      return undefined
    }
    let alive = true
    const seq = ++shareFetchSeqRef.current
    setShareStatus('loading')
    fetchTraineeShare(timetableId)
      .then((res) => {
        // A create/revoke may have happened while this GET was in flight —
        // never let a stale response overwrite the newer state.
        if (!alive || seq !== shareFetchSeqRef.current) return
        const row = res?.share
        if (row?.short_code) {
          setShare({ shortCode: row.short_code, url: row.share_url, updatedAt: row.updated_at })
          setShareStatus('ready')
        } else {
          setShare(null)
          setShareStatus('idle')
        }
      })
      .catch(() => {
        if (alive && seq === shareFetchSeqRef.current) setShareStatus('idle')
      })
    return () => { alive = false }
  }, [timetableId, cloudEnabled, canEdit])

  async function handleCreateShare() {
    if (!timetableId) return
    setError('')
    setShareStatus('creating')
    // Invalidate the initial "existing link" fetch so it can't clear the link
    // we are about to create.
    shareFetchSeqRef.current += 1
    try {
      if (onEnsureSaved) {
        const ensured = await onEnsureSaved()
        if (!ensured?.ok) {
          throw new Error(
            ensured?.error === 'read-only'
              ? 'คุณมีสิทธิ์อ่านโมดูลนี้เท่านั้น'
              : (ensured?.error || 'บันทึกโมดูลไม่สำเร็จ'),
          )
        }
      }
      const payload = buildTraineeSharePayload({
        timetableId,
        title,
        timetableTitle,
        reference,
        trainees,
        attendance,
        settings,
        defaultType: type,
        dateKey,
      })
      const res = await shareTraineeSummary(timetableId, payload)
      setShare({ shortCode: res.short_code, url: res.share_url, updatedAt: res.updated_at })
      setShareStatus('ready')
      const copied = await copyShareText(res.share_url)
      onToast?.(copied
        ? 'สร้างลิงก์และคัดลอกลิงก์แล้ว'
        : 'สร้างลิงก์แล้ว — กดปุ่มคัดลอกเพื่อคัดลอก')
    } catch (e) {
      setShareStatus(share ? 'ready' : 'idle')
      setError(e?.message || 'สร้างลิงก์แชร์ไม่สำเร็จ')
    }
  }

  async function handleCopyShare() {
    if (!share?.url) return
    const copied = await copyShareText(share.url)
    onToast?.(copied ? 'คัดลอกลิงก์แล้ว' : 'คัดลอกลิงก์ไม่สำเร็จ')
  }

  async function handleRevokeShare() {
    if (!timetableId || !share) return
    if (!confirm('ยกเลิกลิงก์แชร์? คนภายนอกจะเปิดลิงก์นี้ไม่ได้อีก')) return
    setError('')
    setShareStatus('creating')
    shareFetchSeqRef.current += 1
    try {
      await deleteTraineeShare(timetableId)
      setShare(null)
      setShareStatus('idle')
      onToast?.('ยกเลิกลิงก์แชร์แล้ว')
    } catch (e) {
      setShareStatus('ready')
      setError(e?.message || 'ยกเลิกลิงก์ไม่สำเร็จ')
    }
  }

  const shareUnavailable = !cloudEnabled || !canEdit
  const shareUpdatedLabel = share?.updatedAt
    ? formatThaiDate(String(share.updatedAt).slice(0, 10))
    : ''

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
          {!EXPLICIT_RANGE_TYPES.has(type) && type !== 'daily' && (
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

        <div className="mt-4 pt-4 border-t border-slate-100">
          <h4 className="text-xs font-bold text-slate-700 flex items-center gap-1.5">
            <Link2 className="w-3.5 h-3.5 text-violet-500" /> แชร์ผลสรุป
          </h4>
          {shareUnavailable ? (
            <p className="mt-2 text-[11px] text-slate-400 leading-5">
              {!cloudEnabled
                ? 'ต้องเข้าสู่ระบบและบันทึกโมดูลบนคลาวด์ก่อน จึงจะสร้างลิงก์แชร์ได้'
                : 'ต้องมีสิทธิ์แก้ไขโมดูลเพื่อสร้างลิงก์แชร์'}
            </p>
          ) : (
            <div className="mt-2 space-y-2">
              <p className="text-[11px] text-slate-500 leading-5">
                ลิงก์เดียวสำหรับผลสรุปทั้ง 4 ช่วง (รายวัน/สัปดาห์/เดือน/ภาคเรียน) — ผู้ชมสลับช่วงเองได้
                ระบบจะคัดลอกลิงก์ให้อัตโนมัติหลังสร้าง
              </p>
              {shareStatus === 'loading' && (
                <div className="flex items-center gap-1.5 text-[11px] text-slate-400">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" /> กำลังตรวจสอบลิงก์เดิม…
                </div>
              )}
              {share ? (
                <>
                  <div className="flex items-center gap-1.5 rounded-lg border border-violet-200 bg-violet-50 px-2 py-1.5">
                    <a
                      href={share.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex-1 text-[11px] text-violet-700 hover:text-violet-900 truncate font-medium"
                      title={share.url}
                    >
                      {share.url}
                    </a>
                    <button
                      type="button"
                      onClick={handleCopyShare}
                      className="p-1 rounded text-violet-600 hover:text-violet-800 hover:bg-violet-100"
                      title="คัดลอกลิงก์"
                      aria-label="คัดลอกลิงก์แชร์ผลสรุป"
                    >
                      <Copy className="w-3.5 h-3.5" />
                    </button>
                    <a
                      href={share.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="p-1 rounded text-violet-600 hover:text-violet-800 hover:bg-violet-100"
                      title="เปิดลิงก์"
                      aria-label="เปิดลิงก์แชร์ผลสรุป"
                    >
                      <ExternalLink className="w-3.5 h-3.5" />
                    </a>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[10px] text-slate-400">
                      {shareUpdatedLabel ? `อัปเดตลิงก์ ${shareUpdatedLabel}` : 'ลิงก์พร้อมใช้งาน'}
                    </span>
                    <button
                      type="button"
                      onClick={handleRevokeShare}
                      disabled={shareStatus === 'creating'}
                      className="inline-flex items-center gap-1 text-[11px] font-semibold text-rose-600 hover:text-rose-700 disabled:opacity-50"
                    >
                      <Trash2 className="w-3 h-3" /> ยกเลิกลิงก์
                    </button>
                  </div>
                  <button
                    type="button"
                    onClick={handleCreateShare}
                    disabled={shareStatus === 'creating'}
                    className="w-full flex items-center justify-center gap-1.5 px-2.5 py-2 rounded-lg text-[11px] font-semibold bg-violet-50 text-violet-700 border border-violet-200 hover:bg-violet-100 disabled:opacity-50"
                  >
                    {shareStatus === 'creating' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Link2 className="w-3.5 h-3.5" />}
                    อัปเดตลิงก์และคัดลอก
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  onClick={handleCreateShare}
                  disabled={shareStatus === 'creating'}
                  className="w-full flex items-center justify-center gap-1.5 px-2.5 py-2.5 rounded-lg text-xs font-bold bg-violet-600 text-white hover:bg-violet-700 disabled:opacity-50"
                >
                  {shareStatus === 'creating' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Link2 className="w-4 h-4" />}
                  สร้างลิงก์และคัดลอก
                </button>
              )}
              <p className="text-[10px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-2 py-1.5 leading-4">
                ผู้ที่มีลิงก์สามารถดูรายชื่อและสถิติการลงเวลาได้โดยไม่ต้องเข้าสู่ระบบ
              </p>
            </div>
          )}
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
