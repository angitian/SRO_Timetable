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

// Google Fonts @import for Sarabun (Thai font)
const SARABUN_IMPORT = `@import url('https://fonts.googleapis.com/css2?family=Sarabun:wght@400;500;600;700&display=swap');`
const KRU_PLATFORM_URL = 'https://kru-platform.com'

/**
 * Escape HTML special characters.
 */
function escapeHTML(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

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

/**
 * Build the document header HTML — 3-part flex layout (mirrors PrintStudio).
 */
function buildHeaderHTML(settings, itemName) {
  const { schoolName, semester, academicYear } = settings
  const semesterLabel =
    semester === '1' ? 'ภาคเรียนที่ 1'
    : semester === '2' ? 'ภาคเรียนที่ 2'
    : semester === 'summer' ? 'ภาคเรียนฤดูร้อน'
    : ''

  const leftText = `${semesterLabel ? escapeHTML(semesterLabel) : ''}${semesterLabel && academicYear ? ' ' : ''}${academicYear ? 'ปีการศึกษา ' + academicYear : ''}`

  return `<div style="display:flex;justify-content:space-between;align-items:center;padding-bottom:8px;margin-bottom:8px;border-bottom:2px solid #1f2937;">
    <div style="font-size:12px;color:#4b5563;white-space:nowrap;">${leftText}</div>
    <div style="font-size:16px;font-weight:700;color:#1f2937;text-align:center;">
      ตารางสอน ${escapeHTML(itemName || '')}
    </div>
    <div style="font-size:13px;font-weight:700;color:#1f2937;white-space:nowrap;">
      ${schoolName ? escapeHTML(schoolName) : ''}
    </div>
  </div>`
}

/**
 * Build the footer strip (timestamp + branding). QR code disabled in this
 * version — will be re-enabled once the backend DB for short-links is in place.
 */
function buildFooterHTML(currentUrl) {
  const now = new Date()
  const dateStr = now.toLocaleDateString('th-TH', { year: 'numeric', month: 'long', day: 'numeric' })
  const timeStr = now.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' })

  return `<div style="margin-top:auto;padding-top:8px;border-top:1px solid #e5e7eb;
    display:flex;align-items:center;justify-content:space-between;
    font-size:10px;color:#64748b;line-height:1.3;">
    <div style="white-space:nowrap;">พิมพ์เมื่อ ${dateStr} เวลา ${timeStr} น.</div>
    <div style="text-align:center;">
      ระบบจัดตารางสอนอัตโนมัติ —
      <a href="${KRU_PLATFORM_URL}" style="color:#64748b;text-decoration:none;">KRU Platform</a>
    </div>
  </div>`
}

export default function PublicViewerPage() {
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const encoded = params.get('d')
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

  // Build export context from decoded data
  const ctx = useMemo(() => {
    if (!data) return null
    return buildExportContext(data)
  }, [data])

  // Build the grid HTML
  const gridHTML = useMemo(() => {
    if (!data || !ctx) return ''
    if (data.kind === 'class') return buildClassGridHTML(data.item, ctx)
    if (data.kind === 'teacher') return buildTeacherGridHTML(data.item, ctx)
    return ''
  }, [data, ctx])

  // Build full page HTML (header + grid + footer)
  const pageHTML = useMemo(() => {
    if (!data || !gridHTML) return ''
    const header = buildHeaderHTML(data.settings || {}, data.item?.name || '')
    const currentUrl = window.location.href
    const footer = buildFooterHTML(currentUrl)
    return `<div style="display:flex;flex-direction:column;min-height:100%;">
      ${header}
      ${gridHTML}
      ${footer}
    </div>`
  }, [data, gridHTML])

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
  return (
    <div className="min-h-screen bg-slate-100">
      {/* Print styles */}
      <style>{`
        @media print {
          body { background: white !important; }
          .viewer-toolbar { display: none !important; }
          .viewer-page { box-shadow: none !important; border-radius: 0 !important; }
          @page { size: A4 landscape; margin: 8mm; }
        }
      `}</style>

      {/* Top toolbar (hidden in print) */}
      <div className="viewer-toolbar bg-white border-b border-gray-200 px-4 py-2 flex items-center justify-between">
        <a href="/" className="flex items-center gap-1.5 text-sm text-gray-600 hover:text-gray-900 transition-colors">
          <ArrowLeft className="w-4 h-4" />
          กลับหน้าหลัก
        </a>
        <button
          onClick={() => window.print()}
          className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-white
            bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors"
        >
          <Calendar className="w-4 h-4" />
          พิมพ์ / บันทึก PDF
        </button>
      </div>

      {/* A4 Preview */}
      <div className="p-6 flex items-start justify-center">
        <div
          className="viewer-page bg-white shadow-lg rounded-lg p-8 w-full max-w-[1100px]"
          style={{
            aspectRatio: '297 / 210',
            fontFamily: "'Sarabun', 'Segoe UI', Tahoma, sans-serif",
          }}
        >
          <style>{SARABUN_IMPORT}</style>
          <div
            dangerouslySetInnerHTML={{ __html: pageHTML }}
            style={{ width: '100%', height: '100%' }}
          />
        </div>
      </div>
    </div>
  )
}
