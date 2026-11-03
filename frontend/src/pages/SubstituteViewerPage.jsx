import { useEffect, useMemo, useState } from 'react'
import { Printer, Loader2, ArrowLeft, FileText } from 'lucide-react'
import { fetchSubstituteShare } from '../api/client.js'
import { buildDailyPages } from '../features/substitute/printDaily.js'
import { formatThaiDate } from '../features/substitute/dailySchedule.js'

const GROUPS = [
  { id: 'summary', label: 'สรุปการสอนแทน', kinds: ['sub-summary'] },
  { id: 'classes', label: 'รายห้อง', kinds: ['sub-class'] },
  { id: 'teachers', label: 'รายครูที่สอนแทน', kinds: ['sub-teacher'] },
  { id: 'absent', label: 'ครูที่ลา', kinds: ['sub-absent'] },
]

/**
 * Public viewer for shared daily substitute documents (/view?sub=<code>).
 * Reuses the same HTML builders as Print Studio (features/substitute/printDaily.js)
 * so the shared page matches the printed documents 1:1.
 */
export default function SubstituteViewerPage({ code }) {
  const [record, setRecord] = useState(null)
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(true)
  const [group, setGroup] = useState('summary')

  useEffect(() => {
    let alive = true
    setLoading(true)
    fetchSubstituteShare(code)
      .then((rec) => {
        if (!alive) return
        setRecord(rec)
        setLoading(false)
      })
      .catch((e) => {
        if (!alive) return
        setError(e?.message || 'ไม่พบลิงก์สอนแทน')
        setLoading(false)
      })
    return () => { alive = false }
  }, [code])

  const payload = record?.payload || null
  const dateStr = record?.date || payload?.date || ''

  const pages = useMemo(() => {
    if (!payload) return []
    const scheduleBlocks = [{ periods: payload.periods || [] }]
    return buildDailyPages({
      dateStr,
      dailySchedule: {
        date: dateStr,
        absences: payload.absences || [],
        assignments: payload.assignments || [],
        note: payload.note || '',
      },
      daySlots: payload.daySlots || [],
      classes: payload.classes || [],
      teachers: payload.teachers || [],
      subjects: payload.subjects || [],
      lessonBlockMap: new Map(),
      scheduleBlocks,
      scheduleConfig: {},
      onlySubstitute: false,
      docs: { summary: true, classes: true, teachers: true, absent: true },
      note: payload.note || '',
    })
  }, [payload, dateStr])

  const groupPages = useMemo(() => {
    const def = GROUPS.find((g) => g.id === group)
    if (!def) return []
    return pages.filter((p) => def.kinds.includes(p.kind))
  }, [pages, group])

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-100 flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-orange-600 animate-spin" />
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
          <h2 className="text-xl font-bold text-gray-700">ไม่สามารถแสดงเอกสารสอนแทนได้</h2>
          <p className="text-gray-500">{error}</p>
        </div>
        <a href="/" className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-semibold">
          <ArrowLeft className="w-4 h-4" /> กลับหน้าหลัก
        </a>
      </div>
    )
  }

  const schoolName = payload?.schoolName || ''
  const counts = {
    summary: pages.filter((p) => p.kind === 'sub-summary').length,
    classes: pages.filter((p) => p.kind === 'sub-class').length,
    teachers: pages.filter((p) => p.kind === 'sub-teacher').length,
    absent: pages.filter((p) => p.kind === 'sub-absent').length,
  }

  return (
    <div className="min-h-screen bg-slate-100">
      <style>{`
        @media print {
          .no-print { display: none !important; }
          body { background: #fff; }
          .print-page { box-shadow: none !important; border: 0 !important; margin: 0 !important; page-break-after: always; }
        }
      `}</style>

      {/* Header */}
      <div className="no-print bg-white border-b border-slate-200 px-4 py-3">
        <div className="max-w-5xl mx-auto flex flex-wrap items-center gap-3">
          <div className="min-w-0">
            <div className="text-sm font-bold text-slate-800">เอกสารสอนแทน {formatThaiDate(dateStr)}</div>
            <div className="text-xs text-slate-500">
              {schoolName ? `${schoolName} · ` : ''}ลิงก์แชร์ {code}
            </div>
          </div>
          <button
            onClick={() => window.print()}
            className="ml-auto inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-blue-600 text-white text-xs font-semibold hover:bg-blue-700"
          >
            <Printer className="w-4 h-4" /> พิมพ์ / บันทึก PDF
          </button>
        </div>

        {/* Group tabs */}
        <div className="max-w-5xl mx-auto flex flex-wrap gap-1.5 mt-3">
          {GROUPS.map((g) => (
            <button
              key={g.id}
              onClick={() => setGroup(g.id)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors
                ${group === g.id
                  ? 'bg-orange-600 border-orange-600 text-white'
                  : 'bg-white border-slate-200 text-slate-600 hover:border-orange-300'}`}
            >
              {g.label} ({counts[g.id]})
            </button>
          ))}
        </div>
      </div>

      {/* Pages */}
      <div className="max-w-5xl mx-auto p-4 space-y-4">
        {groupPages.length === 0 ? (
          <div className="bg-white rounded-xl border border-slate-200 p-10 text-center text-sm text-slate-400">
            ไม่มีเอกสารในหมวดนี้
          </div>
        ) : (
          groupPages.map((p) => (
            <div
              key={p.id}
              className="print-page bg-white rounded-xl border border-slate-200 shadow-sm p-6"
              dangerouslySetInnerHTML={{ __html: p.gridHTML }}
            />
          ))
        )}
      </div>
    </div>
  )
}
