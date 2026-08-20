import { useState, useMemo, useEffect } from 'react'
import { renderToString } from 'react-dom/server.browser'
import { decompressFromEncodedURIComponent, decompressFromBase64 } from 'lz-string'
import { QRCodeSVG } from 'qrcode.react'
import {
  ArrowLeft,
  Calendar,
  FileText,
  Loader2,
} from 'lucide-react'
import {
  buildExportContext,
  buildClassGridHTML,
  buildTeacherGridHTML,
} from '../utils/exportEngine.js'
import { fetchTimetableByShortCode } from '../api/client.js'

// Google Fonts @import for Sarabun (Thai font)
const SARABUN_IMPORT = `@import url('https://fonts.googleapis.com/css2?family=Sarabun:wght@400;500;600;700&display=swap');`
const KRU_PLATFORM_URL = 'https://kru-platform.com'

/**
 * Decode a compressed payload from the `?d=` query param.
 * Supports:
 *   v3 — lz-string compressToEncodedURIComponent (current, URL-safe)
 *   v2 — lz-string compressToBase64 (previous, needs decodeURIComponent)
 *   legacy — btoa(encodeURIComponent(...)) (original format)
 */
function decodePayload(encoded) {
  // v3: lz-string URL-safe compression (no encodeURIComponent needed)
  try {
    const json = decompressFromEncodedURIComponent(encoded)
    if (json) return expandCompactPayload(JSON.parse(json))
  } catch {
    // fall through to v2 attempt
  }

  // v2: lz-string base64 compression (may have been encodeURIComponent'd)
  try {
    const decoded = decodeURIComponent(encoded)
    const json = decompressFromBase64(decoded)
    if (json) return expandCompactPayload(JSON.parse(json))
  } catch {
    // fall through to legacy
  }

  // Legacy: atob → decodeURIComponent reverses the encodeURIComponent+btoa encoding
  const json = decodeURIComponent(escapeAtob(encoded))
  return JSON.parse(json)
}

/**
 * Expand a compact v2 payload back into the shape expected by buildExportContext.
 */
function expandCompactPayload(p) {
  if (!p || (p.v !== 2 && p.v !== 3)) throw new Error('payload format ไม่รองรับ')
  return {
    kind: p.kind,
    item: { id: p.i[0], name: p.i[1] },
    slots: (p.s || []).map(([day, period, subject_id, teacher_id, class_id]) => ({
      day, period, subject_id, teacher_id, class_id,
    })),
    subjects: (p.su || []).map(([id, name]) => ({ id, name })),
    teachers: (p.t || []).map(([id, name]) => ({ id, name })),
    classes: (p.c || []).map(([id, name]) => ({ id, name })),
    gridConfig: p.g,
    fixedSlots: (p.f || []).map(([day, period, name]) => ({ day, period, name })),
    settings: p.set || {},
  }
}

/**
 * Derive a gridConfig from a stored TimetableRequest config, mirroring the
 * logic in PrintStudio.jsx (supports both schedule_blocks and legacy schedule_config).
 */
function deriveGridConfig(config) {
  const schedule_blocks = config?.schedule_blocks || []
  const schedule_config = config?.schedule_config
  if (schedule_blocks.length > 0) {
    const periodSet = new Set()
    const lunchSet = new Set()
    const breakSet = new Set()
    let maxDays = 0
    for (const blk of schedule_blocks) {
      for (const p of (blk.periods || [])) {
        periodSet.add(p.period_no)
        if (p.type === 'LUNCH') lunchSet.add(p.period_no)
        else if (p.type === 'BREAK') breakSet.add(p.period_no)
      }
      if (blk.days_per_week > maxDays) maxDays = blk.days_per_week
    }
    return {
      periodList: [...periodSet].sort((a, b) => a - b),
      lunchPeriods: [...lunchSet].sort((a, b) => a - b),
      breakPeriods: [...breakSet].sort((a, b) => a - b),
      daysPerWeek: maxDays,
    }
  }
  const periodsPerDay = schedule_config?.periods_per_day || 7
  return {
    periodsPerDay,
    periodList: Array.from({ length: periodsPerDay }, (_, i) => i + 1),
    lunchPeriods: schedule_config?.lunch_periods || [4],
    breakPeriods: [],
    daysPerWeek: schedule_config?.days_per_week || 5,
  }
}

/**
 * Convert a fetched TimetableRecord (from the backend short-code API) into
 * the payload shape expected by buildExportContext / buildClassGridHTML.
 * Supports both class view (default) and teacher view via viewMode.
 */
function recordToPayload(record, viewMode, selectedClassId, selectedTeacherId) {
  const config = record?.config || {}
  const result = record?.result || {}
  const classes = (config.classes || []).map((c) => ({ id: c.id, name: c.name }))
  const teachers = (config.teachers || []).map((t) => ({ id: t.id, name: t.name }))
  const isTeacher = viewMode === 'teacher' && teachers.length > 0
  const cls = classes.find((c) => c.id === selectedClassId) || classes[0] || null
  const teacher = teachers.find((t) => t.id === selectedTeacherId) || teachers[0] || null
  const item = isTeacher ? teacher : cls
  const term = record.term
  const semester = term === 3 ? 'summer' : String(term)
  return {
    kind: isTeacher ? 'teacher' : 'class',
    item,
    slots: result.slots || [],
    subjects: (config.subjects || []).map((s) => ({ id: s.id, name: s.name })),
    teachers,
    classes,
    gridConfig: deriveGridConfig(config),
    fixedSlots: (config.fixed_slots || []).map((fs) => ({
      day: fs.day, period: fs.period, name: fs.name,
    })),
    settings: {
      schoolName: record.title || '',
      semester,
      academicYear: record.academic_year,
    },
  }
}

// atob may produce malformed URI sequences for multibyte chars; use a safe decoder
function escapeAtob(b64) {
  const binary = atob(b64)
  try {
    return decodeURIComponent(escape(binary))
  } catch {
    return binary
  }
}

// Render QR code as an inline SVG string for use in HTML export/print.
// Uses includeMargin (quiet zone) + level "L" for fast scanning.
// Falls back to a short link if the value is too large for a QR code.
function buildQRSVGString(url, size = 128) {
  try {
    return renderToString(
      <QRCodeSVG value={url} size={size} level="L" includeMargin={true} />
    )
  } catch {
    return renderToString(
      <QRCodeSVG value={KRU_PLATFORM_URL} size={size} level="L" includeMargin={true} />
    )
  }
}

export default function PublicViewerPage() {
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(true)
  // TimetableRecord fetched via short code (null when loaded via ?d= payload)
  const [record, setRecord] = useState(null)
  const [viewMode, setViewMode] = useState('class') // 'class' | 'teacher'
  const [selectedClassId, setSelectedClassId] = useState(null)
  const [selectedTeacherId, setSelectedTeacherId] = useState(null)

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const code = params.get('code')
    const encoded = params.get('d')
    // Optional deep-link params: v=teacher&t=<teacherId> / c=<classId>
    const v = params.get('v')
    const t = params.get('t')
    const c = params.get('c')
    const teacherMode = v === 'teacher'

    // Short-code path: fetch from backend D1/local store
    if (code) {
      fetchTimetableByShortCode(code)
        .then((rec) => {
          setRecord(rec)
          setViewMode(teacherMode ? 'teacher' : 'class')
          setSelectedClassId(c || null)
          setSelectedTeacherId(teacherMode ? (t || null) : null)
          // Derive the viewer payload immediately so there is no render
          // window where loading=false but data is still null (would crash
          // the success-block JSX). null ids → first class/teacher.
          setData(recordToPayload(rec, teacherMode ? 'teacher' : 'class', c || null, teacherMode ? (t || null) : null))
          setLoading(false)
        })
        .catch((e) => {
          setError(e?.message || 'ไม่พบตารางจากรหัสที่ระบุ')
          setLoading(false)
        })
      return
    }

    // Legacy path: decode compressed payload from ?d=
    if (!encoded) {
      setError('ไม่พบข้อมูลตารางในลิงก์')
      setLoading(false)
      return
    }
    try {
      const parsed = decodePayload(encoded)
      setData(parsed)
    } catch (e) {
      setError('ข้อมูลตารางเสียหรือลิงก์ไม่ถูกต้อง')
      setLoading(false)
    }
  }, [])

  // When a record is loaded via short code, derive the viewer payload from it.
  // Recomputes when the user switches view mode or picks a class/teacher.
  useEffect(() => {
    if (record) {
      const payload = recordToPayload(record, viewMode, selectedClassId, selectedTeacherId)
      setData(payload)
    }
  }, [record, viewMode, selectedClassId, selectedTeacherId])

  // Build export context from decoded data
  const ctx = useMemo(() => {
    if (!data) return null
    return buildExportContext(data)
  }, [data])

  // Build the grid HTML
  const gridHTML = useMemo(() => {
    if (!data || !ctx) return ''
    if (data.kind === 'class' && data.item) return buildClassGridHTML(data.item, ctx)
    if (data.kind === 'teacher' && data.item) return buildTeacherGridHTML(data.item, ctx)
    return ''
  }, [data, ctx])

  // ── Loading state ──
  if (loading && !data && !error) {
    return (
      <div className="min-h-screen bg-slate-100 flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-blue-600 animate-spin" />
      </div>
    )
  }

  // ── Error state ──
  if (error) {
    return (
      <div className="min-h-screen bg-slate-100 flex flex-col items-center justify-center space-y-6">
        <div className="w-20 h-20 rounded-full bg-red-50 flex items-center justify-center">
          <FileText className="w-10 h-10 text-red-300" />
        </div>
        <div className="text-center space-y-2">
          <h2 className="text-xl font-bold text-gray-700">ไม่สามารถแสดงตารางได้</h2>
          <p className="text-gray-500">{error}</p>
        </div>
        <a href="/" className="btn-primary flex items-center gap-2">
          <ArrowLeft className="w-4 h-4" />
          กลับหน้าหลัก
        </a>
      </div>
    )
  }

  // ── Success: render timetable ──
  const settings = data?.settings || {}
  const semester = settings.semester
  const semesterLabel =
    semester === '1' ? 'ภาคเรียนที่ 1'
    : semester === '2' ? 'ภาคเรียนที่ 2'
    : semester === 'summer' ? 'ภาคเรียนฤดูร้อน'
    : ''
  const academicYear = settings.academicYear
  const schoolName = settings.schoolName || ''
  const now = new Date()
  const dateStr = now.toLocaleDateString('th-TH', { year: 'numeric', month: 'long', day: 'numeric' })
  const timeStr = now.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' })
  const qrSvg = buildQRSVGString(window.location.href, 96)

  return (
    <div className="min-h-screen bg-slate-100">
      {/* Print + desktop-scaling styles */}
      <style>{`
        @media print {
          body { background: white !important; }
          .viewer-toolbar { display: none !important; }
          .viewer-page { box-shadow: none !important; border-radius: 0 !important; }
          @page { size: A4 landscape; margin: 8mm; }
        }
        /* Desktop (lg+): scale up the grid so the table fills the screen better */
        @media screen and (min-width: 1024px) {
          .viewer-page .grid-page > div {
            --vlabel: 100px;
            gap: 3px !important;
            margin-bottom: 3px !important;
          }
          .viewer-page .vcell {
            min-height: 58px !important;
            font-size: 13px !important;
            padding: 6px 10px !important;
            border-radius: 6px !important;
          }
          .viewer-page .grid-page > div:first-child .vcell { min-height: 34px !important; }
          .viewer-page .vcell-title { font-size: 16px !important; }
          .viewer-page .vcell-sub   { font-size: 13px !important; }
        }
        @media screen and (min-width: 1536px) {
          .viewer-page .grid-page > div { --vlabel: 110px; }
          .viewer-page .vcell         { min-height: 64px !important; font-size: 14px !important; }
          .viewer-page .vcell-title   { font-size: 17px !important; }
          .viewer-page .vcell-sub     { font-size: 14px !important; }
        }
      `}</style>

      {/* Top toolbar (hidden in print) */}
      <div className="viewer-toolbar bg-white border-b border-gray-200 px-4 py-2 flex items-center justify-between">
        <a href="/" className="flex items-center gap-1.5 text-sm text-gray-600 hover:text-gray-900 transition-colors">
          <ArrowLeft className="w-4 h-4" />
          กลับหน้าหลัก
        </a>
        <div className="flex items-center gap-3">
          {/* View-mode toggle (only for short-code records that have both views) */}
          {record && (data?.classes?.length || 0) > 0 && (data?.teachers?.length || 0) > 0 && (
            <div className="inline-flex rounded-lg border border-gray-200 bg-gray-100 p-0.5">
              <button
                onClick={() => setViewMode('class')}
                className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-all ${
                  viewMode === 'class'
                    ? 'bg-white text-blue-700 shadow-sm'
                    : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                🏫 ห้องเรียน
              </button>
              <button
                onClick={() => setViewMode('teacher')}
                className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-all ${
                  viewMode === 'teacher'
                    ? 'bg-white text-purple-700 shadow-sm'
                    : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                👤 ครู
              </button>
            </div>
          )}
          {/* Class selector (short-code records with multiple classes) */}
          {record && viewMode === 'class' && (data?.classes?.length || 0) > 1 && (
            <select
              value={selectedClassId || data?.item?.id || ''}
              onChange={(e) => setSelectedClassId(e.target.value)}
              className="text-sm border border-gray-300 rounded-lg px-2 py-1.5 text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              {(data?.classes || []).map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          )}
          {/* Teacher selector (short-code records with multiple teachers) */}
          {record && viewMode === 'teacher' && (data?.teachers?.length || 0) > 1 && (
            <select
              value={selectedTeacherId || data?.item?.id || ''}
              onChange={(e) => setSelectedTeacherId(e.target.value)}
              className="text-sm border border-gray-300 rounded-lg px-2 py-1.5 text-gray-700 focus:outline-none focus:ring-2 focus:ring-purple-500"
            >
              {(data?.teachers || []).map((t) => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>
          )}
          <button
            onClick={() => window.print()}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-white
              bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors"
          >
            <Calendar className="w-4 h-4" />
            พิมพ์ / บันทึก PDF
          </button>
        </div>
      </div>

      {/* Responsive card */}
      <div className="p-2 sm:p-6 flex items-start justify-center">
        <div
          className="viewer-page bg-white shadow-sm rounded-2xl w-full max-w-7xl 2xl:max-w-[1600px] mx-auto p-3 sm:p-6"
          style={{ fontFamily: "'Sarabun', 'Segoe UI', Tahoma, sans-serif" }}
        >
          <style>{SARABUN_IMPORT}</style>

          {/* Header: semester+year | title | school name (stacks on mobile) */}
          <div className="flex flex-col sm:flex-row items-center justify-between gap-2 text-center sm:text-left pb-3 mb-3 border-b-2 border-gray-800">
            <div className="text-xs text-gray-500 whitespace-nowrap">
              {semesterLabel}{academicYear ? ` ปีการศึกษา ${academicYear}` : ''}
            </div>
            <div className="text-base sm:text-lg font-bold text-gray-900">
              ตารางสอน {data?.item?.name || ''}
            </div>
            <div className="text-sm font-bold text-gray-900 whitespace-nowrap">
              {schoolName}
            </div>
          </div>

          {/* Mobile swipe hint */}
          <div className="sm:hidden text-[11px] text-slate-400 text-center mb-1">
            👈 เลื่อนซ้าย-ขวาเพื่อดูตารางเต็ม 👉
          </div>

          {/* Scrollable grid */}
          <div className="w-full overflow-x-auto pb-4 -mx-2 px-2 sm:mx-0 sm:px-0">
            <div
              className="min-w-[720px] md:min-w-full"
              dangerouslySetInnerHTML={{ __html: gridHTML }}
            />
          </div>

          {/* Footer: timestamp + branding (wrap) | QR (hidden on mobile screens) */}
          <div className="mt-auto pt-2 border-t border-gray-200 flex items-center justify-between gap-2 text-xs text-slate-500">
            <div className="flex flex-wrap gap-2">
              <span className="whitespace-nowrap">พิมพ์เมื่อ {dateStr} เวลา {timeStr} น.</span>
              <span>
                ระบบจัดตารางสอนอัตโนมัติ —{' '}
                <a href={KRU_PLATFORM_URL} className="text-slate-500 hover:text-slate-700 no-underline">KRU Platform</a>
              </span>
            </div>
            <div
              className="hidden sm:block print:block flex-shrink-0"
              dangerouslySetInnerHTML={{ __html: qrSvg }}
            />
          </div>
        </div>
      </div>
    </div>
  )
}
