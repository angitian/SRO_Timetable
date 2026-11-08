import { useEffect, useMemo, useState } from 'react'
import { ArrowLeft, CalendarDays, FileText, Loader2, Printer } from 'lucide-react'
import { fetchPublicTraineeShare } from '../api/client.js'
import {
  buildReportHTML,
  defaultOrientation,
} from '../utils/traineeReports.js'
import {
  dashboardRangeLabel,
  formatThaiDate,
  todayISO,
} from '../utils/traineeAttendance.js'
import { SHARE_PERIODS, normalizeSharePeriod } from '../utils/traineeShare.js'
import TraineeDateField from '../features/trainees/TraineeDateField.jsx'

const KRU_PLATFORM_URL = 'https://kru-platform.com'

/**
 * Public viewer for shared trainee summary reports (/view?tr=<code>).
 *
 * Reuses the same report builders as the trainee Print Studio so the shared
 * page matches the printed documents 1:1. Viewers can switch between daily,
 * weekly, monthly and semester summaries without logging in.
 */
export default function TraineeViewerPage({ code }) {
  const [record, setRecord] = useState(null)
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(true)
  const [type, setType] = useState('month')
  const [dateKey, setDateKey] = useState(() => todayISO())
  const [printError, setPrintError] = useState('')

  useEffect(() => {
    let alive = true
    setLoading(true)
    fetchPublicTraineeShare(code)
      .then((rec) => {
        if (!alive) return
        const payload = rec?.payload || {}
        setRecord(rec)
        setType(normalizeSharePeriod(payload.defaultType))
        setDateKey(payload.dateKey || todayISO())
        setLoading(false)
      })
      .catch((e) => {
        if (!alive) return
        setError(e?.message || 'ไม่พบลิงก์แชร์ผลสรุป')
        setLoading(false)
      })
    return () => { alive = false }
  }, [code])

  // The shared page contains student names and attendance — keep it out of
  // search engine indexes.
  useEffect(() => {
    const meta = document.createElement('meta')
    meta.name = 'robots'
    meta.content = 'noindex, nofollow'
    document.head.appendChild(meta)
    return () => { document.head.removeChild(meta) }
  }, [])

  const payload = record?.payload || null
  const reference = payload?.reference || null
  const trainees = payload?.trainees || []
  const attendance = payload?.attendance || {}
  const settings = payload?.settings || {}

  const reportSettings = useMemo(() => ({
    ...settings,
    dateKey,
    orientation: defaultOrientation(type),
    rangeMode: type === 'daily' ? 'month' : type,
  }), [settings, dateKey, type])

  const html = useMemo(
    () => buildReportHTML({ type, trainees, attendance, reference, settings: reportSettings }),
    [type, trainees, attendance, reference, reportSettings],
  )

  const rangeLabel = type === 'daily'
    ? formatThaiDate(dateKey, { month: 'long' })
    : dashboardRangeLabel(dateKey, type, reference)

  const updatedLabel = record?.updated_at
    ? formatThaiDate(String(record.updated_at).slice(0, 10))
    : ''

  function handlePrint() {
    setPrintError('')
    const win = window.open('', '_blank', 'width=1100,height=850')
    if (!win) {
      setPrintError('เบราว์เซอร์บล็อกหน้าต่างพิมพ์ — กรุณาอนุญาต pop-up แล้วลองอีกครั้ง')
      return
    }
    win.document.open()
    win.document.write(html)
    win.document.close()
    win.focus()
    setTimeout(() => {
      try { win.print() } catch { /* user can print manually */ }
    }, 400)
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-100 flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-violet-600 animate-spin" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="min-h-screen bg-slate-100 flex flex-col items-center justify-center space-y-6 px-4">
        <div className="w-20 h-20 rounded-full bg-red-50 flex items-center justify-center">
          <FileText className="w-10 h-10 text-red-300" />
        </div>
        <div className="text-center space-y-2">
          <h2 className="text-xl font-bold text-gray-700">ไม่สามารถแสดงผลสรุปได้</h2>
          <p className="text-gray-500">{error}</p>
        </div>
        <a href="/" className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-violet-600 text-white text-sm font-semibold">
          <ArrowLeft className="w-4 h-4" /> กลับหน้าหลัก
        </a>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-slate-100">
      <style>{`
        @media print {
          .no-print { display: none !important; }
          body { background: #fff; }
          .viewer-frame { border: 0 !important; border-radius: 0 !important; height: auto !important; }
        }
      `}</style>

      <div className="no-print bg-white border-b border-slate-200 px-3 sm:px-4 py-3">
        <div className="max-w-6xl mx-auto flex flex-wrap items-center gap-3">
          <div className="min-w-0">
            <div className="text-sm font-bold text-slate-800 truncate">
              สรุปการลงเวลานักศึกษาฝึกสอน{payload?.title ? ` · ${payload.title}` : ''}
            </div>
            <div className="text-[11px] text-slate-500">
              {[settings.schoolName, settings.termLabel].filter(Boolean).join(' · ') || 'ลิงก์แชร์ผลสรุป'}
              {updatedLabel ? ` · อัปเดต ${updatedLabel}` : ''}
            </div>
          </div>
          <button
            onClick={handlePrint}
            className="ml-auto inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-violet-600 text-white text-xs font-semibold hover:bg-violet-700"
          >
            <Printer className="w-4 h-4" /> พิมพ์ / บันทึก PDF
          </button>
        </div>

        <div className="max-w-6xl mx-auto flex flex-wrap items-end gap-3 mt-3">
          <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="ช่วงเวลาสรุป">
            {SHARE_PERIODS.map((period) => (
              <button
                key={period.value}
                role="tab"
                aria-selected={type === period.value}
                onClick={() => setType(period.value)}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                  type === period.value
                    ? 'bg-violet-600 text-white shadow-sm'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                {period.label}
              </button>
            ))}
          </div>
          <label className="text-[11px] font-semibold text-slate-600">
            วันที่อ้างอิง
            <TraineeDateField
              value={dateKey}
              onChange={(value) => setDateKey(value || todayISO())}
              className="mt-1 block"
            />
          </label>
          <div className="ml-auto text-[11px] text-slate-500 flex items-center gap-1">
            <CalendarDays className="w-3.5 h-3.5" /> {rangeLabel}
          </div>
        </div>
      </div>

      {printError && (
        <div className="no-print max-w-6xl mx-auto mt-3 px-3">
          <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">{printError}</div>
        </div>
      )}

      <div className="max-w-6xl mx-auto p-2 sm:p-4">
        <iframe
          title={`trainee-summary-${type}`}
          srcDoc={html}
          sandbox="allow-same-origin"
          className="viewer-frame w-full rounded-xl bg-white border border-slate-200 shadow-sm"
          style={{ height: '82vh', minHeight: 560 }}
        />
      </div>

      <div className="no-print max-w-6xl mx-auto px-3 pb-6 text-[10px] text-slate-400 flex flex-wrap items-center gap-2">
        <span>ลิงก์แชร์ {code} · ข้อมูล ณ เวลาที่แชร์</span>
        <span>
          ระบบจัดตารางสอนอัตโนมัติ —{' '}
          <a href={KRU_PLATFORM_URL} className="hover:text-slate-600 no-underline">KRU Platform</a>
        </span>
      </div>
    </div>
  )
}
