import { useState, useMemo, useEffect, useRef, useCallback } from 'react'
import { renderToString } from 'react-dom/server.browser'
import { compressToEncodedURIComponent } from 'lz-string'
import { QRCodeSVG } from 'qrcode.react'
import {
  ArrowLeft,
  Printer,
  Image as ImageIcon,
  Table,
  Calendar,
  CheckCircle,
  XCircle,
  Loader2,
  FileText,
  Link2,
  Copy,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  ChevronUp,
  ChevronDown,
  SlidersHorizontal,
  Download,
} from 'lucide-react'
import { useApp } from '../context/AppContext.jsx'
import {
  buildExportContext,
  buildClassGridHTML,
  buildTeacherGridHTML,
  buildFacilityGridHTML,
} from '../utils/exportEngine.js'
import { exportMultiExcel } from '../utils/exportExcel.js'
import { exportMultiPNG } from '../utils/exportImage.js'
import { normalizeClassTeachers, flattenClassTeachers } from '../utils/teacherLoad.js'
import { saveTimetableResult } from '../api/client.js'
import PrintSettingsPanel from '../components/print/PrintSettingsPanel.jsx'

// ── Constants ────────────────────────────────────────────────────────────
const TEMPLATE_KEY = 'app_timetable_print_template'
const SHORT_LINK_KEY = 'sro_print_saved_links'
const MAX_SAVED_SLOTS = 5
const SHORT_LINK_DEBOUNCE_MS = 800
const KRU_PLATFORM_URL = 'https://kru-platform.com'

// Panel collapse preferences persist across sessions so teachers collapse
// once and it stays that way next time they open the print studio.
const PANEL_PREF_KEY = 'sro_print_panels'
function readPanelPref(key, fallback) {
  try {
    const saved = JSON.parse(localStorage.getItem(PANEL_PREF_KEY) || '{}')
    if (typeof saved[key] === 'boolean') return saved[key]
  } catch { /* corrupted pref — ignore */ }
  return fallback
}

// FNV-1a 32-bit hash — compact schedule fingerprint for short-link caching.
function hashString(str) {
  let h = 0x811c9dc5
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(36)
}

// Standardized frontend origin: prefer VITE_FRONTEND_URL, fall back to the
// window origin so short links work under any dev/deploy host.
function getFrontendOrigin() {
  const envUrl = import.meta.env.VITE_FRONTEND_URL
  if (envUrl) return envUrl.replace(/\/+$/, '')
  return window.location.origin
}

function buildShortViewerURL(shortCode) {
  return `${getFrontendOrigin()}/view?code=${shortCode}`
}

// Deep-link variants: point a short link directly at one class or teacher so
// QRs on printed pages always open the correct timetable (the viewer falls
// back to the first item when these params are absent).
function buildClassViewerShortURL(shortCode, classId) {
  return `${getFrontendOrigin()}/view?code=${shortCode}&c=${encodeURIComponent(classId)}`
}
function buildTeacherViewerShortURL(shortCode, teacherId) {
  return `${getFrontendOrigin()}/view?code=${shortCode}&v=teacher&t=${encodeURIComponent(teacherId)}`
}

/**
 * Build the canonical slot list shown on screen = solver slots ∪ manual
 * placements, deduplicated by (lesson_block_id, day, period). Manual
 * placements are materialized into full ScheduledSlot objects using the
 * lesson block's subject/teacher/class/room ids (room falls back to the
 * solver slot for the same block if present, else to the block's room_id).
 *
 * This is what gets persisted via /save-result so the public viewer matches
 * the printed page 1:1 — no re-solve, no INFEASIBLE, no solver drift.
 */
function buildMergedSlots(lessonBlocks, placements, resultSlots) {
  const lbMap = new Map((lessonBlocks || []).map((lb) => [lb.id, lb]))
  // First index solver slots by (lbId, day, period) so we can both dedupe
  // and reuse their room_id when materializing manual placements.
  const solverByKey = new Map()
  for (const s of resultSlots || []) {
    solverByKey.set(`${s.lesson_block_id}:${s.day}:${s.period}`, s)
  }
  const out = []
  const seen = new Set()
  // 1) solver slots (already full ScheduledSlot objects)
  for (const s of resultSlots || []) {
    const key = `${s.lesson_block_id}:${s.day}:${s.period}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push(s)
  }
  // 2) manual placements not already covered by a solver slot
  for (const [lbId, arr] of Object.entries(placements || {})) {
    const lb = lbMap.get(lbId)
    for (const p of arr || []) {
      const key = `${lbId}:${p.day}:${p.period}`
      if (seen.has(key)) continue
      seen.add(key)
      // Reuse a solver slot for the same block as a template (for room_id);
      // otherwise derive from the lesson block.
      const template = solverByKey.size > 0
        ? [...solverByKey.values()].find((s) => s.lesson_block_id === lbId)
        : null
      out.push({
        lesson_block_id: lbId,
        day: p.day,
        period: p.period,
        subject_id: lb?.subject_id ?? template?.subject_id ?? '',
        teacher_id: lb?.teacher_id ?? template?.teacher_id ?? '',
        co_teacher_id: lb?.co_teacher_id ?? template?.co_teacher_id ?? null,
        class_id: lb?.class_id ?? template?.class_id ?? '',
        room_id: lb?.room_id ?? template?.room_id ?? null,
      })
    }
  }
  return out
}

// ── Saved-links store (localStorage, capped at MAX_SAVED_SLOTS) ──────────
function loadSavedLinks() {
  try {
    const arr = JSON.parse(localStorage.getItem(SHORT_LINK_KEY) || '[]')
    return Array.isArray(arr) ? arr : []
  } catch {
    return []
  }
}

function persistSavedLinks(entries) {
  try {
    localStorage.setItem(SHORT_LINK_KEY, JSON.stringify(entries.slice(0, MAX_SAVED_SLOTS)))
  } catch {
    // storage quota/unavailable — best effort; auto-cache retries on next change
  }
}

/**
 * Upsert an entry ({ fingerprint, shortCode, url, title, savedAt }) into the store.
 * - fifo (auto-cache background QR): upsert by fingerprint, then FIFO-evict the
 *   oldest entry when over the cap — never interrupts the user.
 * - manual ("บันทึก & แชร์"): update in place if the fingerprint exists; append
 *   when there's room; otherwise return { full: true, entries } so the caller
 *   can open the overwrite modal.
 */
function saveLinkEntry(entry, { fifo = false } = {}) {
  const entries = loadSavedLinks()
  const idx = entries.findIndex((e) => e.fingerprint === entry.fingerprint)
  if (idx >= 0) {
    entries[idx] = { ...entries[idx], ...entry }
    persistSavedLinks(entries)
    return entries
  }
  if (entries.length < MAX_SAVED_SLOTS) {
    entries.push(entry)
    persistSavedLinks(entries)
    return entries
  }
  if (fifo) {
    const sorted = [...entries].sort((a, b) => (a.savedAt || '').localeCompare(b.savedAt || ''))
    const oldest = sorted[0]
    const evicted = entries.filter((e) => e !== oldest)
    evicted.push(entry)
    persistSavedLinks(evicted)
    return evicted
  }
  return { full: true, entries }
}

function formatThaiDate(iso) {
  if (!iso) return ''
  try {
    return new Date(iso).toLocaleDateString('th-TH', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    })
  } catch {
    return ''
  }
}

// Render QR code as an inline SVG string for use in HTML export/print.
// Uses includeMargin (quiet zone) + level "L" for fast scanning.
// If the value is too large for a QR code, falls back to a short link so an
// oversized payload never crashes the Print Studio page.
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
 * Build a compressed payload for a single class/teacher timetable,
 * suitable for embedding in a /view?d=<base64> URL.
 * Filters data to only what's relevant for this item, compacts it into
 * small tuple arrays, then compresses with lz-string so the QR code fits.
 */
function buildQRPayload(kind, item, ctx, gridConfig, fixedSlots, settings) {
  const filteredSlots = (ctx.allSlots || []).filter((s) =>
    kind === 'class'
      ? s.class_id === item.id
      : (() => {
          if (s.teacher_id === item.id) return true
          if (s.co_teacher_id === item.id) return true
          const lb = ctx.lessonBlockMap.get(s.lesson_block_id)
          return !!(lb && lb.co_teacher_id === item.id)
        })()
  )
  const subjectIds = new Set(filteredSlots.map((s) => s.subject_id))
  const teacherIds = new Set(filteredSlots.map((s) => s.teacher_id))
  const classIds = new Set(filteredSlots.map((s) => s.class_id))
  // Include the co-teachers' names too (they show on the printed cell)
  for (const s of filteredSlots) {
    const lb = ctx.lessonBlockMap.get(s.lesson_block_id)
    const coId = (lb && lb.co_teacher_id) || s.co_teacher_id
    if (coId) teacherIds.add(coId)
  }
  // For a teacher page, only embed fixed slots that affect their classes;
  // for a class page, only slots that affect that class.
  const relevantFixedSlots = (fixedSlots || []).filter((fs) => {
    if (!fs.class_ids || fs.class_ids.length === 0) return true
    if (kind === 'class') return fs.class_ids.includes(item.id)
    const teacherClassIds = new Set()
    for (const s of filteredSlots) teacherClassIds.add(s.class_id)
    return fs.class_ids.some((cid) => teacherClassIds.has(cid))
  })

  const payload = {
    v: 4, // payload format version — see PublicViewerPage.decodePayload
    kind,
    i: [item.id, item.name],
    // v4 slot format: [day, period, subject_id, teacher_id, class_id, co_teacher_id]
    s: filteredSlots.map((sl) => {
      const lb = ctx.lessonBlockMap.get(sl.lesson_block_id)
      return [sl.day, sl.period, sl.subject_id, sl.teacher_id, sl.class_id, lb?.co_teacher_id || sl.co_teacher_id || null]
    }),
    su: (ctx.subjects || []).filter((s) => subjectIds.has(s.id)).map((s) => [s.id, s.name]),
    t: (ctx.teachers || []).filter((t) => teacherIds.has(t.id)).map((t) => [t.id, t.name]),
    c: (ctx.classes || []).filter((c) => classIds.has(c.id)).map((c) => [c.id, c.name]),
    g: {
      periodsPerDay: gridConfig.periodsPerDay,
      periodList: gridConfig.periodList,
      lunchPeriods: gridConfig.lunchPeriods || [],
      breakPeriods: gridConfig.breakPeriods || [],
      daysPerWeek: gridConfig.daysPerWeek,
    },
    // v4 fixed slot format: [day, period, name, classIds ([] = all), periods]
    f: relevantFixedSlots.map((fs) => [fs.day, fs.period, fs.name, fs.class_ids || [], fs.periods || []]),
    set: {
      schoolName: settings.schoolName,
      semester: settings.semester,
      academicYear: settings.academicYear,
      // Omit schoolLogo (Base64 too large for QR)
    },
  }
  // compressToEncodedURIComponent produces URL-safe output directly —
  // no need for encodeURIComponent wrapping, smaller than base64+enc.
  return compressToEncodedURIComponent(JSON.stringify(payload))
}

function buildViewerURL(payload) {
  // Output is already URL-safe (compressToEncodedURIComponent)
  return `${getFrontendOrigin()}/view?d=${payload}`
}

const DEFAULT_SETTINGS = {
  schoolName: '',
  semester: '1',        // '1' | '2' | 'summer'
  academicYear: 2569,   // number
  schoolLogo: '',       // Base64 data URL
  signatoryName: '',
  signatoryTitle: '',
  showPeriodTimes: true,
  showWorkloadSummary: true,
  showSignOff: true,
  showFooter: true,   // controls the 3-part footer strip (timestamp + branding + QR)
  showQRCode: true,   // QR code at bottom-right of each page → /view?d=...
}

// Google Fonts @import for Sarabun (Thai font) — injected into print window
const SARABUN_IMPORT = `@import url('https://fonts.googleapis.com/css2?family=Sarabun:wght@400;500;600;700&display=swap');`

/**
 * Build the document header HTML — 3-part flex layout:
 * [left: semester + academic year] [center: ตารางสอน xxx] [right: logo + school name]
 */
function buildHeaderHTML(settings, itemName) {
  const { schoolName, semester, academicYear, schoolLogo } = settings
  const semesterLabel =
    semester === '1' ? 'ภาคเรียนที่ 1'
    : semester === '2' ? 'ภาคเรียนที่ 2'
    : semester === 'summer' ? 'ภาคเรียนฤดูร้อน'
    : ''

  const logoImg = schoolLogo
    ? `<img src="${schoolLogo}" alt="ตราโรงเรียน" style="height:32px;width:auto;object-fit:contain;" />`
    : ''

  const leftText = `${semesterLabel ? escapeHTML(semesterLabel) : ''}${semesterLabel && academicYear ? ' ' : ''}${academicYear ? 'ปีการศึกษา ' + academicYear : ''}`

  return `<div style="display:flex;justify-content:space-between;align-items:center;padding-bottom:8px;margin-bottom:8px;border-bottom:2px solid #1f2937;">
    <div style="font-size:12px;color:#4b5563;white-space:nowrap;">${leftText}</div>
    <div style="font-size:16px;font-weight:700;color:#1f2937;text-align:center;">
      ตารางสอน ${escapeHTML(itemName || '')}
    </div>
    <div style="display:flex;align-items:center;gap:8px;white-space:nowrap;">
      ${logoImg}
      ${schoolName ? `<div style="font-size:13px;font-weight:700;color:#1f2937;">${escapeHTML(schoolName)}</div>` : ''}
    </div>
  </div>`
}

/**
 * Build the consolidated A4 page footer — a single 3-column flex container:
 *   [Left: metadata (timestamp + branding)] [Center: signature] [Right: QR]
 *
 * - Timestamp is toggleable via settings.showFooter; branding is always-on.
 * - Signature column is rendered only when settings.showSignOff is true.
 * - QR column is rendered only when settings.showQRCode is true AND a
 *   viewerUrl is available (facility pages have no viewer URL).
 * - When signature is off → 2-column (metadata | QR).
 * - When QR is off → 2-column (metadata | signature) or just metadata.
 * - margin-top:auto pins the footer to the bottom of the flex-column page.
 * - break-inside:avoid prevents the footer from splitting across pages.
 */
function buildFooterHTML(settings, viewerUrl) {
  const { signatoryName, signatoryTitle, showFooter, showSignOff, showQRCode } = settings
  const now = new Date()
  const dateStr = now.toLocaleDateString('th-TH', { year: 'numeric', month: 'long', day: 'numeric' })
  const timeStr = now.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' })

  // ── Left column: metadata (timestamp + branding) ──────────────────────
  const timestampLine = showFooter
    ? `<div style="font-size:11px;color:#64748b;white-space:nowrap;">พิมพ์เมื่อ ${dateStr} เวลา ${timeStr} น.</div>`
    : ''
  const brandingLine = `<div style="font-size:10px;color:#94a3b8;margin-top:2px;white-space:nowrap;user-select:none;-webkit-user-select:none;">SRO Timetable — พัฒนาโดย One Man Lab เพื่อ KRU Platform</div>`
  const leftCol = `<div style="flex:0 0 auto;">
    ${timestampLine}
    ${brandingLine}
  </div>`

  // ── Center column: signature block ────────────────────────────────────
  const centerCol = showSignOff
    ? `<div style="flex:0 0 auto;text-align:center;font-size:12px;color:#4b5563;">
      <div>ลงนามวันที่ ${dateStr}</div>
      <div style="margin-top:14px;">ลงชื่อ ....................................................</div>
      <div style="margin-top:2px;">(${signatoryName ? escapeHTML(signatoryName) : '........................................'})</div>
      <div style="margin-top:1px;font-weight:600;">${signatoryTitle ? escapeHTML(signatoryTitle) : 'ผู้อำนวยการโรงเรียน'}</div>
    </div>`
    : ''

  // ── Right column: compact QR code ─────────────────────────────────────
  const rightCol = (showQRCode && viewerUrl)
    ? (() => {
        const qrSvg = buildQRSVGString(viewerUrl, 72)
        return `<div style="flex:0 0 auto;text-align:center;">
        <div style="width:72px;height:72px;margin:0 auto;">${qrSvg}</div>
        <div style="font-size:10px;color:#64748b;margin-top:2px;white-space:nowrap;">สแกนดูตารางออนไลน์</div>
      </div>`
      })()
    : ''

  return `<div style="display:flex;justify-content:space-between;align-items:flex-end;gap:16px;
    padding-top:8px;margin-top:auto;border-top:1px solid #e5e7eb;break-inside:avoid;">
    ${leftCol}
    ${centerCol}
    ${rightCol}
  </div>`
}

/**
 * Build the workload summary HTML for a class or teacher.
 * Compact flex-wrap pill strip (1-2 lines) — pills flow naturally without
 * awkward box breaks, gap-based spacing instead of margins.
 */
function buildWorkloadSummaryHTML(kind, item, ctx) {
  const pillStyle = `display:inline-block;background:#f1f5f9;border-radius:9999px;padding:1px 8px;font-size:10px;color:#334155;white-space:nowrap;`
  const labelStyle = `font-weight:700;color:#374151;white-space:nowrap;`

  if (kind === 'class') {
    // Count lessons per subject for this class
    const classLbs = ctx.lessonBlocks.filter((lb) => lb.class_id === item.id)
    const subjCount = {}
    for (const lb of classLbs) {
      const subjName = ctx.subjectMap.get(lb.subject_id)?.name || lb.subject_id
      subjCount[subjName] = (subjCount[subjName] || 0) + lb.periods_per_week
    }
    // คาบกิจกรรมพิเศษที่ล็อกห้องนี้
    for (const fs of ctx.fixedSlots || []) {
      const applies = !fs.class_ids || fs.class_ids.length === 0 || fs.class_ids.includes(item.id)
      if (!applies) continue
      const n = new Set([fs.period, ...(fs.periods || [])]).size
      subjCount[fs.name || 'กิจกรรม'] = (subjCount[fs.name || 'กิจกรรม'] || 0) + n
    }
    const total = Object.values(subjCount).reduce((a, b) => a + b, 0)
    const items = Object.entries(subjCount)
      .map(([name, count]) => `<span style="${pillStyle}">${escapeHTML(name)} (${count})</span>`)
      .join('')
    return `<div style="margin-top:6px;display:flex;flex-wrap:wrap;align-items:center;gap:4px 8px;font-size:10px;color:#6b7280;line-height:1.5;break-inside:avoid;">
      <span style="${labelStyle}">สรุปภาระงาน (${total} คาบ/สัปดาห์):</span> ${items}
    </div>`
  } else {
    // Teacher: count lessons per class (main + co-teacher)
    const teacherSlots = ctx.allSlots.filter((s) => {
      if (s.teacher_id === item.id) return true
      const lb = ctx.lessonBlockMap.get(s.lesson_block_id)
      return !!(lb && lb.co_teacher_id === item.id)
    })
    const classCount = {}
    for (const s of teacherSlots) {
      const className = ctx.classMap.get(s.class_id)?.name || s.class_id
      classCount[className] = (classCount[className] || 0) + 1
    }
    // คาบดูแลกิจกรรม (fixed slots) — นับ 1 คาบ/ครู/กิจกรรม (ไม่คูณจำนวนห้อง)
    const activityCount = {}
    for (const fs of ctx.fixedSlots || []) {
      if (!flattenClassTeachers(fs.class_teachers).has(item.id)) continue
      const n = new Set([fs.period, ...(fs.periods || [])]).size
      activityCount[fs.name || 'กิจกรรม'] = (activityCount[fs.name || 'กิจกรรม'] || 0) + n
    }
    const classTotal = Object.values(classCount).reduce((a, b) => a + b, 0)
    const activityTotal = Object.values(activityCount).reduce((a, b) => a + b, 0)
    const total = classTotal + activityTotal
    const items = [
      ...Object.entries(classCount).map(([name, count]) => `<span style="${pillStyle}">${escapeHTML(name)} (${count})</span>`),
      ...Object.entries(activityCount).map(([name, count]) => `<span style="${pillStyle}">${escapeHTML(name)} (${count})</span>`),
    ].join('')
    return `<div style="margin-top:6px;display:flex;flex-wrap:wrap;align-items:center;gap:4px 8px;font-size:10px;color:#6b7280;line-height:1.5;break-inside:avoid;">
      <span style="${labelStyle}">สรุปภาระงาน (${total} คาบ/สัปดาห์):</span> ${items}
    </div>`
  }
}

/**
 * Escape HTML special characters to prevent injection from user input.
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
 * Build a full A4 page HTML for preview or print, including optional sections.
 */
function buildFullPageHTML({ gridHTML, item, kind, ctx, settings, viewerUrl }) {
  const header = buildHeaderHTML(settings, item?.name || item?.label || '')
  const workload = settings.showWorkloadSummary ? buildWorkloadSummaryHTML(kind, item, ctx) : ''
  const footer = buildFooterHTML(settings, viewerUrl)

  // The grid HTML from exportEngine already includes the page title (h2)
  return `<div class="print-studio-page" style="page-break-after:always;break-inside:avoid;display:flex;flex-direction:column;">
    ${header}
    ${gridHTML}
    ${workload}
    ${footer}
  </div>`
}

// ── Main Component ───────────────────────────────────────────────────────
export default function PrintStudio() {
  const { fixtureData, result, userPlacements, substitutes, activeSnapshotLabel, setStep } = useApp()

  // ── Settings state (with localStorage hydration) ──────────────────────
  const [settings, setSettings] = useState(DEFAULT_SETTINGS)
  const [previewTab, setPreviewTab] = useState('class') // 'class' | 'teacher' | 'facility'
  const [currentPage, setCurrentPage] = useState(0)
  const [exporting, setExporting] = useState(false)
  const [exportProgress, setExportProgress] = useState('')
  const [exportScope, setExportScope] = useState('current') // 'current' | 'tab' | 'all'
  const [sidebarTab, setSidebarTab] = useState('export') // 'header' | 'export'
  // Collapsible side panels — start collapsed on narrow screens, persist choice.
  const [leftCollapsed, setLeftCollapsed] = useState(() => readPanelPref('left', window.innerWidth < 1024))
  const [rightCollapsed, setRightCollapsed] = useState(() => readPanelPref('right', window.innerWidth < 1024))
  const [toast, setToast] = useState(null)
  const [saving, setSaving] = useState(false)
  const [savedLinks, setSavedLinks] = useState([]) // [{ short_code, share_url, title }]
  // Short-link state (auto-created for the current schedule → small QR codes)
  const [shortLink, setShortLink] = useState(null) // { shortCode, url } | null
  const [shortLinkStatus, setShortLinkStatus] = useState('idle') // 'idle' | 'creating' | 'ready' | 'error'
  const [savedLinkEntries, setSavedLinkEntries] = useState([]) // persisted store (≤ MAX_SAVED_SLOTS)
  const [overwritePending, setOverwritePending] = useState(null) // { entry } awaiting slot selection
  const [confirmOverwrite, setConfirmOverwrite] = useState(null) // slot index awaiting 2nd-step confirm
  const isMountedRef = useRef(true)
  const createSeqRef = useRef(0)
  const debounceTimerRef = useRef(null)
  const toastTimerRef = useRef(null)
  const previewRef = useRef(null)
  const storageModalRef = useRef(null)
  const lastFocusedRef = useRef(null)

  // ── Hydrate settings from localStorage on mount ───────────────────────
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(TEMPLATE_KEY) || '{}')
      if (Object.keys(saved).length > 0) {
        setSettings({ ...DEFAULT_SETTINGS, ...saved })
      }
    } catch {
      // Ignore parse errors
    }
  }, [])

  // ── Hydrate saved-links store + mark mounted; cleanup on unmount ──────
  // StrictMode runs mount→cleanup→mount in dev; reset isMountedRef to true
  // at the START of every run so the auto-cache effect's guards stay valid.
  useEffect(() => {
    isMountedRef.current = true
    const entries = loadSavedLinks()
    setSavedLinkEntries(entries)
    setSavedLinks(
      entries.map((e) => ({ short_code: e.shortCode, share_url: e.url, title: e.title })),
    )
    return () => {
      isMountedRef.current = false
    }
  }, [])

  // ── Toast helper ──────────────────────────────────────────────────────
  const showToast = useCallback((type, msg) => {
    setToast({ type, msg })
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current)
    toastTimerRef.current = setTimeout(() => setToast(null), 3000)
  }, [])

  // Clear any pending toast timeout on unmount
  useEffect(() => {
    return () => {
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current)
    }
  }, [])

  // ── Storage modal: focus management + Escape-to-close + Tab-cycle trap ─
  // On open: stash the previously focused element and move focus into the
  // dialog. On close: clear the pending confirm and restore focus.
  useEffect(() => {
    if (!overwritePending) return
    lastFocusedRef.current = document.activeElement
    const modal = storageModalRef.current
    if (modal) {
      // Focus the first focusable element (the cancel button is the safest
      // default — it's the most reversible action).
      const focusables = modal.querySelectorAll(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
      )
      if (focusables.length > 0) focusables[0].focus()
    }
    function onKeyDown(e) {
      if (e.key === 'Escape') {
        setOverwritePending(null)
        setConfirmOverwrite(null)
        return
      }
      if (e.key === 'Tab' && modal) {
        const focusables = modal.querySelectorAll(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
        )
        if (focusables.length === 0) return
        const first = focusables[0]
        const last = focusables[focusables.length - 1]
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault()
          last.focus()
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault()
          first.focus()
        }
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      if (lastFocusedRef.current && typeof lastFocusedRef.current.focus === 'function') {
        lastFocusedRef.current.focus()
      }
    }
  }, [overwritePending])

  // ── Template persistence handlers ─────────────────────────────────────
  function handleSaveTemplate() {
    try {
      localStorage.setItem(TEMPLATE_KEY, JSON.stringify(settings))
      showToast('ok', 'บันทึกเทมเพลตเรียบร้อย')
    } catch {
      showToast('err', 'บันทึกเทมเพลตไม่สำเร็จ')
    }
  }

  function handleResetTemplate() {
    setSettings(DEFAULT_SETTINGS)
    try {
      localStorage.removeItem(TEMPLATE_KEY)
    } catch {
      // ignore
    }
    showToast('ok', 'รีเซ็ตเป็นค่าเริ่มต้นแล้ว')
  }

  // ── Save & Share: persist the current on-screen result (no re-solve) ──
  async function handleSaveAndShare() {
    if (saving) return
    setSaving(true)
    try {
      const term = settings.semester === 'summer' ? 3 : parseInt(settings.semester || '1', 10)
      const payload = buildPersistPayload()
      const result = await saveTimetableResult({
        title: settings.schoolName || activeSnapshotLabel || 'ตารางสอน',
        academicYear: parseInt(settings.academicYear, 10) || 2569,
        term,
        config: payload.config,
        result: payload.result,
      })
      const url = buildShortViewerURL(result.short_code)
      const entry = {
        fingerprint: scheduleFingerprint,
        shortCode: result.short_code,
        url,
        title: result.title,
        savedAt: new Date().toISOString(),
      }
      // Manual save mode: update in place → append → else overwrite modal
      const outcome = saveLinkEntry(entry, { fifo: false })
      if (outcome && outcome.full) {
        setSavedLinkEntries(outcome.entries)
        setOverwritePending({ entry })
        showToast('err', 'พื้นที่บันทึกเต็ม (5/5) — เลือกรายการที่จะแทนที่')
        return
      }
      setSavedLinkEntries(Array.isArray(outcome) ? outcome : loadSavedLinks())
      setSavedLinks((prev) => [
        { short_code: result.short_code, share_url: url, title: result.title },
        ...prev.filter((l) => l.short_code !== result.short_code),
      ].slice(0, MAX_SAVED_SLOTS))
      setShortLink({ shortCode: result.short_code, url })
      setShortLinkStatus('ready')
      showToast('ok', 'บันทึกและสร้างลิงก์สั้นเรียบร้อย')
    } catch (err) {
      showToast('err', err?.message || 'บันทึกตารางไม่สำเร็จ')
    } finally {
      setSaving(false)
    }
  }

  // ── Overwrite modal: replace the selected saved slot with the pending entry ──
  function handleOverwriteSave(index) {
    if (!overwritePending) return
    const entries = loadSavedLinks()
    const safeIndex = Math.min(index, entries.length - 1)
    if (safeIndex < 0) return
    entries[safeIndex] = overwritePending.entry
    persistSavedLinks(entries)
    setSavedLinkEntries(entries)
    setSavedLinks((prev) => [
      { short_code: overwritePending.entry.shortCode, share_url: overwritePending.entry.url, title: overwritePending.entry.title },
      ...prev.filter((l) => l.short_code !== overwritePending.entry.shortCode),
    ].slice(0, MAX_SAVED_SLOTS))
    setShortLink({ shortCode: overwritePending.entry.shortCode, url: overwritePending.entry.url })
    setShortLinkStatus('ready')
    setOverwritePending(null)
    showToast('ok', 'บันทึกและสร้างลิงก์สั้นเรียบร้อย')
  }

  function handleCopyLink(url) {
    navigator.clipboard?.writeText(url).then(
      () => showToast('ok', 'คัดลอกลิงก์แล้ว'),
      () => showToast('err', 'คัดลอกลิงก์ไม่สำเร็จ'),
    )
  }

  // ── Settings update helper (merges partial updates) ───────────────────
  const updateSettings = useCallback((partial) => {
    setSettings((prev) => ({ ...prev, ...partial }))
  }, [])

  // ── Empty State Guard ─────────────────────────────────────────────────
  if (!fixtureData || (!result?.slots?.length && !Object.keys(userPlacements).length)) {
    return (
      <div className="flex flex-col items-center justify-center py-20 space-y-6">
        <div className="w-20 h-20 rounded-full bg-slate-100 flex items-center justify-center">
          <FileText className="w-10 h-10 text-slate-300" />
        </div>
        <div className="text-center space-y-2">
          <h2 className="text-xl font-bold text-gray-700">ยังไม่มีตารางสอนที่จะพิมพ์</h2>
          <p className="text-gray-500">กรุณาจัดตารางสอนในหน้าก่อนหน้าก่อนเข้าใช้งาน Print Studio</p>
        </div>
        <button
          onClick={() => setStep(5)}
          className="btn-primary flex items-center gap-2"
        >
          <ArrowLeft className="w-4 h-4" />
          กลับไปจัดตาราง
        </button>
      </div>
    )
  }

  // ── Derive export data from context ───────────────────────────────────
  const {
    teachers,
    classes,
    subjects,
    fixed_slots,
    schedule_config,
    lesson_blocks,
    schedule_blocks = [],
  } = fixtureData
  const resultSlots = result?.slots || []

  // ── Short-link fingerprint (schedule content only, not metadata) ──────
  const scheduleFingerprint = useMemo(() => {
    if (!fixtureData) return null
    return hashString(JSON.stringify({ f: fixtureData, r: resultSlots, u: userPlacements }))
  }, [fixtureData, resultSlots, userPlacements])

  // Payload sent to /save-result: the original config (no re-solve) plus the
  // exact slots currently displayed on screen (solver ∪ manual, deduped) so
  // the public viewer matches the printed page 1:1.
  const buildPersistPayload = useCallback(() => {
    const mergedSlots = buildMergedSlots(fixtureData?.lesson_blocks, userPlacements, resultSlots)
    return {
      config: fixtureData,
      result: {
        ...(result || { slots: [], teacher_loads: [], metrics: { status: 'FEASIBLE', objective_value: 0, wall_time_seconds: 0, num_variables: 0, num_constraints: 0, hard_violations: 0, soft_violations: 0 } }),
        slots: mergedSlots,
      },
    }
  }, [fixtureData, userPlacements, result, resultSlots])

  // ── Auto-create the short link (debounced, async-safe) ────────────────
  // Reuses a previously saved short code for the same schedule fingerprint;
  // otherwise calls the backend once. Results from stale fingerprint runs are
  // ignored (createSeqRef), and no state is set after unmount (isMountedRef).
  useEffect(() => {
    if (!scheduleFingerprint) return
    // Defensive: ensure isMountedRef is true on every effect run (StrictMode
    // re-mounts in dev; the hydrate effect above also resets it, but this
    // guards against any re-run ordering).
    isMountedRef.current = true
    setShortLink(null)
    setShortLinkStatus('creating')
    const seq = ++createSeqRef.current
    clearTimeout(debounceTimerRef.current)
    debounceTimerRef.current = setTimeout(async () => {
      try {
        const cached = loadSavedLinks().find((e) => e.fingerprint === scheduleFingerprint)
        if (cached) {
          if (!isMountedRef.current || seq !== createSeqRef.current) return
          setShortLink({ shortCode: cached.shortCode, url: cached.url })
          setShortLinkStatus('ready')
          return
        }
        const term = settings.semester === 'summer' ? 3 : parseInt(settings.semester || '1', 10)
        const payload = buildPersistPayload()
        const res = await saveTimetableResult({
          title: settings.schoolName || activeSnapshotLabel || 'ตารางสอน',
          academicYear: parseInt(settings.academicYear, 10) || 2569,
          term,
          config: payload.config,
          result: payload.result,
        })
        if (!isMountedRef.current || seq !== createSeqRef.current) return
        const url = buildShortViewerURL(res.short_code)
        // Auto-cache mode: FIFO rotation, never blocks the user
        const updated = saveLinkEntry({
          fingerprint: scheduleFingerprint,
          shortCode: res.short_code,
          url,
          title: res.title,
          savedAt: new Date().toISOString(),
        }, { fifo: true })
        setSavedLinkEntries(Array.isArray(updated) ? updated : loadSavedLinks())
        setShortLink({ shortCode: res.short_code, url })
        setShortLinkStatus('ready')
      } catch (err) {
        console.error('[PrintStudio] auto-create short link failed:', err?.message || err, err?.payload || '')
        if (isMountedRef.current && seq === createSeqRef.current) {
          setShortLinkStatus('error')
        }
      }
    }, SHORT_LINK_DEBOUNCE_MS)
    return () => clearTimeout(debounceTimerRef.current)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scheduleFingerprint])

  // ── Grid config (mirrors TimetableView logic) ─────────────────────────
  const gridConfig = useMemo(() => {
    if (schedule_blocks && schedule_blocks.length > 0) {
      const allPeriods = schedule_blocks.flatMap((blk) => blk.periods || [])
      const allPeriodNumbers = allPeriods.map((p) => p.period_no)
      if (allPeriodNumbers.length > 0) {
        const maxPeriod = Math.max(...allPeriodNumbers)
        const lunchSet = new Set()
        const breakSet = new Set()
        for (const p of allPeriods) {
          if (p.type === 'LUNCH') lunchSet.add(p.period_no)
          else if (p.type === 'BREAK') breakSet.add(p.period_no)
        }
        const maxDays = Math.max(
          ...schedule_blocks.map((blk) => blk.days_per_week || 5),
        )
        const periodList = [...new Set(allPeriodNumbers)].sort((a, b) => a - b)
        return {
          periodsPerDay: maxPeriod,
          periodList,
          lunchPeriods: [...lunchSet].sort((a, b) => a - b),
          breakPeriods: [...breakSet].sort((a, b) => a - b),
          daysPerWeek: maxDays,
        }
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
  }, [schedule_blocks, schedule_config])

  // ── Build period time map from schedule_blocks ────────────────────────
  const periodTimeMap = useMemo(() => {
    const map = {}
    if (schedule_blocks && schedule_blocks.length > 0) {
      for (const blk of schedule_blocks) {
        for (const p of (blk.periods || [])) {
          if (p.start_time && p.end_time && p.type !== 'LUNCH') {
            map[p.period_no] = `${p.start_time}-${p.end_time}`
          }
        }
      }
    }
    return map
  }, [schedule_blocks])

  const exportData = useMemo(
    () => ({
      slots: resultSlots,
      classes,
      subjects,
      teachers,
      specialRooms: fixtureData?.special_rooms || [],
      gridConfig,
      userPlacements,
      lessonBlocks: lesson_blocks,
      fixedSlots: fixed_slots,
      substitutes: substitutes || [],
      label: activeSnapshotLabel || 'ตารางสอน',
      periodTimeMap,
      showPeriodTimes: settings.showPeriodTimes,
    }),
    [resultSlots, classes, subjects, teachers, fixtureData, gridConfig, userPlacements, lesson_blocks, fixed_slots, substitutes, activeSnapshotLabel, periodTimeMap, settings.showPeriodTimes],
  )

  // ── Build export context (shared lookup maps) ─────────────────────────
  const ctx = useMemo(() => buildExportContext(exportData), [exportData])

  // ── Build page arrays for each tab ────────────────────────────────────
  // viewerUrl prefers the DB short link (small QR), deep-linked to the exact
  // class/teacher; falls back to the embedded compressed payload when the
  // short link isn't ready/failed.
  const shortUrl = shortLink?.url || null
  const shortCode = shortLink?.shortCode || null
  const classPages = useMemo(() => {
    return classes.map((cls) => {
      const qrPayload = buildQRPayload('class', cls, ctx, gridConfig, fixed_slots, settings)
      return {
        label: cls.name,
        kind: 'class',
        id: cls.id,
        item: cls,
        qrPayload,
        viewerUrl: shortUrl && shortCode
          ? buildClassViewerShortURL(shortCode, cls.id)
          : buildViewerURL(qrPayload),
        gridHTML: buildClassGridHTML(cls, ctx),
      }
    })
  }, [classes, ctx, gridConfig, fixed_slots, settings, shortUrl, shortCode])

  const teacherPages = useMemo(() => {
    return teachers.map((teacher) => {
      const qrPayload = buildQRPayload('teacher', teacher, ctx, gridConfig, fixed_slots, settings)
      return {
        label: teacher.name,
        kind: 'teacher',
        id: teacher.id,
        item: teacher,
        qrPayload,
        viewerUrl: shortUrl && shortCode
          ? buildTeacherViewerShortURL(shortCode, teacher.id)
          : buildViewerURL(qrPayload),
        gridHTML: buildTeacherGridHTML(teacher, ctx),
      }
    })
  }, [teachers, ctx, gridConfig, fixed_slots, settings, shortUrl, shortCode])

  // ── Build facility pages (one per special room) ──────────────────────
  const specialRooms = fixtureData?.special_rooms || []
  const facilityPages = useMemo(() => {
    return specialRooms.map((room) => ({
      label: room.name,
      kind: 'facility',
      id: room.id,
      item: room,
      gridHTML: buildFacilityGridHTML(room, ctx),
    }))
  }, [specialRooms, ctx])

  // ── Compute pill status data (mirrors TimetableView classStatuses/teacherStatuses) ──
  const classStatuses = useMemo(() => {
    const statuses = {}
    for (const cls of classes) {
      const classLbs = lesson_blocks.filter((lb) => lb.class_id === cls.id)
      const total = classLbs.reduce((sum, lb) => sum + lb.periods_per_week, 0)
      const placed = resultSlots.filter((s) => s.class_id === cls.id).length
        + Object.entries(userPlacements)
          .filter(([lbId]) => {
            const lb = lesson_blocks.find((l) => l.id === lbId)
            return lb && lb.class_id === cls.id
          })
          .reduce((sum, [, placements]) => sum + placements.length, 0)
      const remaining = Math.max(0, total - placed)
      statuses[cls.id] = { total, placed, remaining, isComplete: total > 0 && placed >= total }
    }
    return statuses
  }, [classes, lesson_blocks, resultSlots, userPlacements])

  const teacherStatuses = useMemo(() => {
    const statuses = {}
    const loadAfter = result?.teacher_loads || []
    const loadMap = new Map(loadAfter.map((l) => [l.teacher_id, l]))
    for (const t of teachers) {
      const load = loadMap.get(t.id)
      if (load) {
        statuses[t.id] = { assigned: load.assigned_periods, max: load.max_periods }
      } else {
        const assigned = lesson_blocks
          .filter((lb) => lb.teacher_id === t.id)
          .reduce((sum, lb) => sum + lb.periods_per_week, 0)
        statuses[t.id] = { assigned, max: t.max_periods_per_week }
      }
    }
    return statuses
  }, [teachers, result, lesson_blocks])

  // ── Build link index for "รายการลิงก์" export scope ──────────────────
  const linkIndex = useMemo(() => {
    const rows = []
    for (const p of classPages) {
      const status = classStatuses[p.id]
      rows.push({
        kind: 'class',
        kindLabel: 'ห้องเรียน',
        name: p.label,
        url: p.viewerUrl,
        qrPayload: p.qrPayload,
        isComplete: status?.isComplete,
        remaining: status?.remaining || 0,
      })
    }
    for (const p of teacherPages) {
      const status = teacherStatuses[p.id]
      rows.push({
        kind: 'teacher',
        kindLabel: 'ครู',
        name: p.label,
        url: p.viewerUrl,
        qrPayload: p.qrPayload,
        assigned: status?.assigned || 0,
        max: status?.max || 0,
      })
    }
    return rows
  }, [classPages, teacherPages, classStatuses, teacherStatuses])

  const activePages = previewTab === 'class' ? classPages : previewTab === 'teacher' ? teacherPages : facilityPages
  const pageCount = activePages.length
  const safeCurrentPage = Math.min(currentPage, Math.max(0, pageCount - 1))
  const currentPageData = activePages[safeCurrentPage]

  // Reset page index when switching tabs
  useEffect(() => {
    setCurrentPage(0)
  }, [previewTab])

  // Persist panel collapse preference across sessions
  useEffect(() => {
    try {
      localStorage.setItem(PANEL_PREF_KEY, JSON.stringify({ left: leftCollapsed, right: rightCollapsed }))
    } catch { /* storage full/blocked — ignore */ }
  }, [leftCollapsed, rightCollapsed])

  // ── Build the full page HTML for preview ──────────────────────────────
  const previewHTML = useMemo(() => {
    if (!currentPageData) return ''
    return buildFullPageHTML({
      gridHTML: currentPageData.gridHTML,
      item: currentPageData.item,
      kind: currentPageData.kind,
      ctx,
      settings,
      viewerUrl: currentPageData.viewerUrl,
    })
  }, [currentPageData, ctx, settings])

  // ── Build all pages HTML for print (all tabs) ────────────────────────
  const allPrintPages = useMemo(() => {
    const pages = []
    for (const p of classPages) {
      pages.push({
        label: p.label,
        kind: p.kind,
        html: buildFullPageHTML({
          gridHTML: p.gridHTML,
          item: p.item,
          kind: p.kind,
          ctx,
          settings,
          viewerUrl: p.viewerUrl,
        }),
      })
    }
    for (const p of teacherPages) {
      pages.push({
        label: p.label,
        kind: p.kind,
        html: buildFullPageHTML({
          gridHTML: p.gridHTML,
          item: p.item,
          kind: p.kind,
          ctx,
          settings,
          viewerUrl: p.viewerUrl,
        }),
      })
    }
    for (const p of facilityPages) {
      pages.push({
        label: p.label,
        kind: p.kind,
        html: buildFullPageHTML({
          gridHTML: p.gridHTML,
          item: p.item,
          kind: p.kind,
          ctx,
          settings,
        }),
      })
    }
    return pages
  }, [classPages, teacherPages, facilityPages, ctx, settings])

  // ── Build pages for current tab only (used by 'tab' scope) ───────────
  const tabPrintPages = useMemo(() => {
    const pages = []
    if (previewTab === 'class') {
      for (const p of classPages) {
        pages.push({
          label: p.label,
          kind: p.kind,
          html: buildFullPageHTML({
            gridHTML: p.gridHTML,
            item: p.item,
            kind: p.kind,
            ctx,
            settings,
            viewerUrl: p.viewerUrl,
          }),
        })
      }
    } else if (previewTab === 'teacher') {
      for (const p of teacherPages) {
        pages.push({
          label: p.label,
          kind: p.kind,
          html: buildFullPageHTML({
            gridHTML: p.gridHTML,
            item: p.item,
            kind: p.kind,
            ctx,
            settings,
            viewerUrl: p.viewerUrl,
          }),
        })
      }
    } else {
      // facility tab
      for (const p of facilityPages) {
        pages.push({
          label: p.label,
          kind: p.kind,
          html: buildFullPageHTML({
            gridHTML: p.gridHTML,
            item: p.item,
            kind: p.kind,
            ctx,
            settings,
          }),
        })
      }
    }
    return pages
  }, [previewTab, classPages, teacherPages, facilityPages, ctx, settings])

  // ── Compute the pages to export based on scope ────────────────────────
  const scopedPrintPages = useMemo(() => {
    if (exportScope === 'current') {
      if (!currentPageData) return []
      return [{
        label: currentPageData.label,
        kind: currentPageData.kind,
        html: buildFullPageHTML({
          gridHTML: currentPageData.gridHTML,
          item: currentPageData.item,
          kind: currentPageData.kind,
          ctx,
          settings,
          viewerUrl: currentPageData.viewerUrl,
        }),
      }]
    }
    if (exportScope === 'tab') return tabPrintPages
    return allPrintPages
  }, [exportScope, currentPageData, tabPrintPages, allPrintPages, ctx, settings])

  // ── Dynamic export button labels ──────────────────────────────────────
  const exportLabelSuffix = useMemo(() => {
    if (exportScope === 'current') return 'หน้านี้'
    if (exportScope === 'tab') return `${tabPrintPages.length} หน้า`
    return `ทั้งหมด ${allPrintPages.length} หน้า`
  }, [exportScope, tabPrintPages.length, allPrintPages.length])

  // ── Print handler (browser native print dialog) ───────────────────────
  function handlePrint() {
    if (scopedPrintPages.length === 0) {
      showToast('err', 'ไม่มีตารางที่จะพิมพ์')
      return
    }

    const printWindow = window.open('', '_blank', 'width=1100,height=850')
    if (!printWindow) {
      showToast('err', 'กรุณาอนุญาต popup เพื่อพิมพ์ตาราง')
      return
    }

    const pagesHTML = scopedPrintPages.map((p) => p.html).join('\n')
    const docTitle = settings.schoolName
      ? `ตารางสอน ${settings.schoolName}`
      : (activeSnapshotLabel || 'ตารางสอน')

    const html = `<!DOCTYPE html>
<html lang="th">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHTML(docTitle)}</title>
  <style>
    ${SARABUN_IMPORT}
    * { box-sizing: border-box; }
    body {
      font-family: 'Sarabun', 'Segoe UI', Tahoma, sans-serif;
      margin: 0;
      padding: 16px;
      color: #1f2937;
    }
    h1 {
      font-size: 20px;
      text-align: center;
      margin: 0 0 16px 0;
      padding-bottom: 8px;
      border-bottom: 2px solid #e5e7eb;
    }
    .print-studio-page {
      page-break-after: always;
      break-after: page;
      break-inside: avoid;
      margin-bottom: 8px;
    }
    .print-studio-page:last-child {
      page-break-after: auto;
      break-after: auto;
    }
    .grid-page { break-inside: avoid; }
    @page {
      size: A4 landscape;
      margin: 8mm;
    }
    @media print {
      body { margin: 0; padding: 0; }
      h1 { display: none; }
      .print-studio-page { margin-bottom: 0; }
    }
    @media screen {
      body { background: #f9fafb; }
      .print-studio-page {
        background: #fff;
        padding: 16px;
        margin-bottom: 24px;
        border-radius: 8px;
        box-shadow: 0 1px 3px rgba(0,0,0,0.1);
      }
    }
  </style>
</head>
<body>
  <h1>${escapeHTML(docTitle)}</h1>
  ${pagesHTML}
</body>
</html>`

    printWindow.document.write(html)
    printWindow.document.close()
    printWindow.focus()
    setTimeout(() => {
      try {
        printWindow.print()
        setTimeout(() => {
          try { printWindow.close() } catch { /* ignore */ }
        }, 500)
      } catch (e) {
        showToast('err', 'พิมพ์ไม่สำเร็จ: ' + e.message)
      }
    }, 600)
  }

  // ── PNG export handler ────────────────────────────────────────────────
  async function handleExportPNG() {
    if (scopedPrintPages.length === 0) {
      showToast('err', 'ไม่มีตารางที่จะส่งออก')
      return
    }
    setExporting(true)
    try {
      const pngPages = scopedPrintPages.map((p) => ({
        label: p.label,
        kind: p.kind,
        html: p.html,
      }))
      await exportMultiPNG(pngPages, activeSnapshotLabel || 'ตารางสอน', (msg) => setExportProgress(msg))
      showToast('ok', `ส่งออก PNG สำเร็จ (${pngPages.length} ตาราง)`)
    } catch (e) {
      if (e?.name === 'AbortError') {
        // User cancelled folder picker — silent
      } else {
        showToast('err', 'ส่งออก PNG ไม่สำเร็จ: ' + e.message)
      }
    }
    setExporting(false)
    setExportProgress('')
  }

  // ── Excel export handler ──────────────────────────────────────────────
  async function handleExportExcel() {
    setExporting(true)
    setExportProgress('กำลังสร้างไฟล์ Excel...')
    try {
      // Map exportScope to Excel's { classes, teachers, facilities } format
      let excelScope
      if (exportScope === 'all') {
        excelScope = { classes: true, teachers: true, facilities: true }
      } else if (exportScope === 'tab') {
        excelScope = previewTab === 'class'
          ? { classes: true, teachers: false, facilities: false }
          : previewTab === 'teacher'
            ? { classes: false, teachers: true, facilities: false }
            : { classes: false, teachers: false, facilities: true }
      } else {
        // 'current' — export only the current tab's sheet
        excelScope = previewTab === 'class'
          ? { classes: true, teachers: false, facilities: false }
          : previewTab === 'teacher'
            ? { classes: false, teachers: true, facilities: false }
            : { classes: false, teachers: false, facilities: true }
      }
      await exportMultiExcel(excelScope, exportData)
      showToast('ok', 'ส่งออก Excel สำเร็จ')
    } catch (e) {
      showToast('err', 'ส่งออก Excel ไม่สำเร็จ: ' + e.message)
    }
    setExporting(false)
    setExportProgress('')
  }

  // ── Link Index PDF export handler ─────────────────────────────────────
  function handleExportLinkPDF() {
    if (linkIndex.length === 0) {
      showToast('err', 'ไม่มีรายการลิงก์ที่จะส่งออก')
      return
    }
    const printWindow = window.open('', '_blank', 'width=900,height=700')
    if (!printWindow) {
      showToast('err', 'กรุณาอนุญาต popup เพื่อส่งออก PDF')
      return
    }

    const rows = linkIndex.map((r) => {
      const qrSvg = buildQRSVGString(r.url, 128)
      const statusBadge = r.kind === 'class'
        ? (r.isComplete
          ? '<span style="color:#059669;font-weight:600;">✓ ครบ</span>'
          : `<span style="color:#d97706;">เหลือ ${r.remaining} คาบ</span>`)
        : `<span style="color:#6b7280;">${r.assigned}/${r.max} คาบ</span>`

      return `<tr style="border-bottom:1px solid #e5e7eb;">
        <td style="padding:8px;font-size:11px;color:#6b7280;">${escapeHTML(r.kindLabel)}</td>
        <td style="padding:8px;font-size:12px;font-weight:600;color:#1f2937;">${escapeHTML(r.name)}</td>
        <td style="padding:8px;font-size:11px;">${statusBadge}</td>
        <td style="padding:8px;">
          <a href="${r.url}" style="color:#2563eb;font-size:10px;text-decoration:none;word-break:break-all;">${r.url}</a>
        </td>
        <td style="padding:8px;text-align:center;">${qrSvg}</td>
      </tr>`
    }).join('')

    const html = `<!DOCTYPE html><html lang="th"><head>
      <meta charset="UTF-8"><title>รายการลิงก์ตารางสอน</title>
      ${SARABUN_IMPORT}
      <style>
        * { box-sizing: border-box; }
        body { font-family:'Sarabun','Segoe UI',Tahoma,sans-serif; padding:20px; color:#1f2937; margin:0; }
        h1 { font-size:18px; text-align:center; margin:0 0 16px 0; }
        table { width:100%; border-collapse:collapse; }
        th { background:#f1f5f9; padding:8px; font-size:11px; text-align:left; color:#475569; border-bottom:2px solid #e5e7eb; }
        td { vertical-align:middle; }
        @page { size:A4 portrait; margin:10mm; }
        @media print { body { padding:0; } }
      </style></head><body>
      <h1>รายการลิงก์ตารางสอน ${escapeHTML(settings.schoolName || '')}</h1>
      <table>
        <thead><tr>
          <th>ประเภท</th><th>ชื่อ</th><th>สถานะ</th><th>ลิงก์ดูออนไลน์</th><th>QR</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
      </body></html>`

    printWindow.document.write(html)
    printWindow.document.close()
    printWindow.focus()
    setTimeout(() => {
      try {
        printWindow.print()
        setTimeout(() => { try { printWindow.close() } catch { /* ignore */ } }, 500)
      } catch (e) {
        showToast('err', 'พิมพ์ไม่สำเร็จ: ' + e.message)
      }
    }, 600)
  }

  // ── Link Index Excel export handler ───────────────────────────────────
  async function handleExportLinkExcel() {
    if (linkIndex.length === 0) {
      showToast('err', 'ไม่มีรายการลิงก์ที่จะส่งออก')
      return
    }
    setExporting(true)
    setExportProgress('กำลังสร้างไฟล์ Excel...')
    try {
      const ExcelJS = await import('exceljs')
      const Workbook = ExcelJS.default?.Workbook || ExcelJS.Workbook
      const wb = new Workbook()
      wb.creator = 'ระบบจัดตารางสอนอัตโนมัติ'
      wb.created = new Date()
      const ws = wb.addWorksheet('รายการลิงก์')

      ws.columns = [
        { header: 'ประเภท', key: 'kindLabel', width: 12 },
        { header: 'ชื่อ', key: 'name', width: 25 },
        { header: 'สถานะ', key: 'statusText', width: 15 },
        { header: 'ลิงก์ดูออนไลน์', key: 'url', width: 60 },
      ]

      for (const r of linkIndex) {
        const statusText = r.kind === 'class'
          ? (r.isComplete ? 'ครบ' : `เหลือ ${r.remaining} คาบ`)
          : `${r.assigned}/${r.max} คาบ`
        const row = ws.addRow({ kindLabel: r.kindLabel, name: r.name, statusText, url: r.url })
        // Make URL cell a clickable hyperlink
        const urlCell = row.getCell(4)
        urlCell.value = { text: r.url, hyperlink: r.url }
        urlCell.font = { color: { argb: 'FF2563EB' }, underline: true, size: 10 }
      }

      // Style header row
      ws.getRow(1).font = { bold: true, size: 11 }
      ws.getRow(1).fill = {
        type: 'pattern', pattern: 'solid',
        fgColor: { argb: 'FFF1F5F9' },
      }

      const buffer = await wb.xlsx.writeBuffer()
      const blob = new Blob([buffer], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `ลิงก์ตารางสอน_${new Date().toISOString().slice(0, 10)}.xlsx`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
      showToast('ok', 'ส่งออก Excel สำเร็จ')
    } catch (e) {
      showToast('err', 'ส่งออก Excel ไม่สำเร็จ: ' + e.message)
    }
    setExporting(false)
    setExportProgress('')
  }

  // ── Current-schedule short link(s) ────────────────────────────────────
  // Only entries matching the current schedule fingerprint are listed; older
  // entries from previous fingerprints stay cached (auto-cache reuses them)
  // but are hidden so duplicates don't confuse users.
  const currentSavedLinks = savedLinkEntries.filter(
    (e) => e.fingerprint === scheduleFingerprint,
  )

  // ── Render ────────────────────────────────────────────────────────────
  return (
    <div className="w-full">
      {/* Print-only styles — inject Sarabun font + hide left panel during print */}
      <style>{`
        @media print {
          .print-studio-left-panel { display: none !important; }
          .print-studio-preview-area { padding: 0 !important; background: white !important; }
          .print-studio-page { box-shadow: none !important; border-radius: 0 !important; break-inside: avoid; }
          .grid-page { break-inside: avoid; }
          @page { size: A4 landscape; margin: 8mm; }
        }
      `}</style>

      <div className="flex gap-4" style={{ height: 'calc(100vh - 120px)', minHeight: '500px' }}>
        {/* ════════════════════════════════════════════════════════════════
            Left Panel: Settings & Controls (w-80, collapsible)
        ════════════════════════════════════════════════════════════════ */}
        {leftCollapsed ? (
          <div className="print-studio-left-panel w-12 shrink-0 bg-white rounded-xl border border-gray-200 shadow-sm flex flex-col items-center py-3 gap-2">
            <button
              onClick={() => setLeftCollapsed(false)}
              title="ขยายแถบตั้งค่า"
              aria-label="ขยายแถบตั้งค่า"
              className="p-2 rounded-lg text-gray-500 hover:text-gray-900 hover:bg-gray-100 transition-colors"
            >
              <PanelLeftOpen className="w-5 h-5" />
            </button>
            <button
              onClick={() => setStep(5)}
              title="กลับไปจัดตาราง"
              aria-label="กลับไปจัดตาราง"
              className="p-2 rounded-lg text-gray-500 hover:text-gray-900 hover:bg-gray-100 transition-colors"
            >
              <ArrowLeft className="w-5 h-5" />
            </button>
            <button
              onClick={() => { setSidebarTab('header'); setLeftCollapsed(false) }}
              title="ตั้งค่าหัวกระดาษ"
              aria-label="ตั้งค่าหัวกระดาษ"
              className="p-2 rounded-lg text-gray-500 hover:text-gray-900 hover:bg-gray-100 transition-colors"
            >
              <SlidersHorizontal className="w-5 h-5" />
            </button>
            <button
              onClick={handlePrint}
              disabled={exporting}
              title="สั่งพิมพ์ / บันทึก PDF"
              aria-label="สั่งพิมพ์ / บันทึก PDF"
              className="p-2 rounded-lg text-blue-600 hover:bg-blue-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Printer className="w-5 h-5" />
            </button>
            <button
              onClick={() => { setSidebarTab('export'); setLeftCollapsed(false) }}
              title="ส่งออกเอกสาร"
              aria-label="ส่งออกเอกสาร"
              className="p-2 rounded-lg text-emerald-600 hover:bg-emerald-50 transition-colors"
            >
              <Download className="w-5 h-5" />
            </button>
          </div>
        ) : (
        <div className="print-studio-left-panel w-80 shrink-0 overflow-y-auto bg-white rounded-xl border border-gray-200 shadow-sm p-4 space-y-3">
          {/* Back button */}
          <div className="flex items-center justify-between">
            <button
              onClick={() => setStep(5)}
              className="flex items-center gap-1.5 text-sm text-gray-600 hover:text-gray-900 transition-colors"
            >
              <ArrowLeft className="w-4 h-4" />
              กลับไปจัดตาราง
            </button>
            <button
              onClick={() => setLeftCollapsed(true)}
              title="ย่อแถบตั้งค่า"
              aria-label="ย่อแถบตั้งค่า"
              className="p-1.5 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors"
            >
              <PanelLeftClose className="w-4 h-4" />
            </button>
          </div>

          {/* Tab Switcher — ตั้งค่าหัวกระดาษ / ส่งออกเอกสาร */}
          <div className="flex gap-1 bg-gray-100 rounded-lg p-1" role="tablist" aria-label="โหมดแผงด้านซ้าย">
            {[
              { id: 'header', label: 'ตั้งค่าหัวกระดาษ', active: 'bg-white text-blue-700 border-blue-500' },
              { id: 'export', label: 'ส่งออกเอกสาร', active: 'bg-white text-emerald-700 border-emerald-500' },
            ].map((opt) => (
              <button
                key={opt.id}
                id={`tab-${opt.id}`}
                role="tab"
                aria-selected={sidebarTab === opt.id}
                aria-controls={`panel-${opt.id}`}
                onClick={() => setSidebarTab(opt.id)}
                className={`flex-1 px-2 py-2 rounded-md text-xs font-semibold transition-all border
                  ${sidebarTab === opt.id
                    ? `${opt.active} shadow-sm border-b-2`
                    : 'text-gray-500 border border-transparent hover:bg-white hover:text-gray-800 hover:shadow-sm'}`}
              >
                {opt.label}
              </button>
            ))}
          </div>

          {/* ── Tab 1: ตั้งค่าหัวกระดาษ ─────────────────────────────── */}
          <div
            id="panel-header"
            role="tabpanel"
            aria-labelledby="tab-header"
            className={sidebarTab === 'header' ? '' : 'hidden'}
          >
            <PrintSettingsPanel
              settings={settings}
              onSettingsChange={updateSettings}
              onSaveTemplate={handleSaveTemplate}
              onResetTemplate={handleResetTemplate}
            />
          </div>

          {/* ── Tab 2: ส่งออกเอกสาร ─────────────────────────────────── */}
          <div
            id="panel-export"
            role="tabpanel"
            aria-labelledby="tab-export"
            className={sidebarTab === 'export' ? '' : 'hidden'}
          >
              {/* Short-link status — fixed height so switching messages never shifts layout */}
              <div className="min-h-[28px] flex items-center text-[11px] leading-tight">
                {shortLinkStatus === 'creating' && (
                  <span className="flex items-center gap-1.5 text-gray-500">
                    <Loader2 className="w-3 h-3 animate-spin shrink-0" />
                    กำลังสร้างลิงก์สั้นสำหรับ QR…
                  </span>
                )}
                {shortLinkStatus === 'error' && (
                  <span className="w-full min-h-[28px] h-auto text-amber-700 bg-amber-50 rounded-lg p-2">
                    ไม่สามารถสร้างลิงก์สั้นได้ — QR จะใช้ลิงก์แนบข้อมูลแทน
                  </span>
                )}
                {shortLinkStatus === 'ready' && shortLink && (
                  <span className="text-emerald-600 truncate" title={shortLink.url}>
                    QR ใช้ลิงก์สั้น /view?code={shortLink.shortCode}
                  </span>
                )}
              </div>

              {/* Primary CTA — Print / Save PDF (prominent at top) */}
              <div className="space-y-2">
                <button
                  onClick={handlePrint}
                  disabled={exporting}
                  className="flex items-center justify-center gap-2 w-full py-2.5
                    bg-blue-600 text-white rounded-lg font-bold text-sm shadow-sm
                    hover:bg-blue-700 transition-colors
                    disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <Printer className="w-4 h-4" />
                  สั่งพิมพ์ / บันทึก PDF ({exportLabelSuffix})
                </button>
              </div>

              {/* Export Scope Selector — horizontal segmented buttons */}
              <div className="space-y-2">
                <h3 className="text-xs font-bold text-gray-500 uppercase tracking-wide">ขอบเขตการส่งออก</h3>
                <div className="flex gap-1 bg-gray-100 rounded-lg p-1" role="tablist" aria-label="ขอบเขตการส่งออก">
                  {[
                    { id: 'current', label: 'หน้านี้' },
                    { id: 'tab', label: `แท็บนี้ (${activePages.length})` },
                    { id: 'all', label: `ทั้งหมด (${classPages.length + teacherPages.length + facilityPages.length})` },
                  ].map((opt) => (
                    <button
                      key={opt.id}
                      id={`tab-scope-${opt.id}`}
                      role="tab"
                      aria-selected={exportScope === opt.id}
                      aria-controls="panel-scope"
                      onClick={() => setExportScope(opt.id)}
                      className={`flex-1 px-2 py-1.5 rounded-md text-xs font-medium transition-colors
                        ${exportScope === opt.id
                          ? 'bg-white text-gray-900 shadow-sm font-bold'
                          : 'text-gray-500 hover:text-gray-700'}`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Secondary export buttons — 2-column grid (tabpanel for scope pills) */}
              <div
                id="panel-scope"
                role="tabpanel"
                aria-labelledby={`tab-scope-${exportScope}`}
                className="space-y-2"
              >
                <div className="grid grid-cols-2 gap-2">
                  <button
                    onClick={handleExportPNG}
                    disabled={exporting}
                    className="flex items-center justify-center gap-1.5 w-full py-2.5
                      bg-indigo-600 text-white rounded-lg font-bold text-xs shadow-sm
                      hover:bg-indigo-700 transition-colors
                      disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {exporting && exportProgress.includes('PNG') ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <ImageIcon className="w-4 h-4" />
                    )}
                    โฟลเดอร์ PNG
                  </button>
                  <button
                    onClick={handleExportExcel}
                    disabled={exporting}
                    className="flex items-center justify-center gap-1.5 w-full py-2.5
                      bg-emerald-700 text-white rounded-lg font-bold text-xs shadow-sm
                      hover:bg-emerald-800 transition-colors
                      disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {exporting && exportProgress.includes('Excel') ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Table className="w-4 h-4" />
                    )}
                    Excel
                  </button>
                </div>
              {exporting && exportProgress && (
                <div className="text-xs text-gray-500 text-center py-0.5">{exportProgress}</div>
              )}
              </div>

              {/* Save & Share (short link via backend D1/local store) */}
              <div className="space-y-2 pt-2 border-t border-gray-200">
                <button
                  onClick={handleSaveAndShare}
                  disabled={saving}
                  className="flex items-center justify-center gap-2 w-full py-2.5
                    bg-violet-600 text-white rounded-lg font-bold text-sm shadow-sm
                    hover:bg-violet-700 transition-colors
                    disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {saving ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Link2 className="w-4 h-4" />
                  )}
                  บันทึก & แชร์ (ลิงก์สั้น)
                </button>
                {currentSavedLinks.length > 0 && (
                  <div className="space-y-1.5">
                    {currentSavedLinks.map((e) => {
                      const link = { short_code: e.shortCode, share_url: e.url, title: e.title }
                      return (
                        <div
                          key={link.short_code}
                          className="flex items-center gap-2 bg-violet-50 border border-violet-200 rounded-lg px-2.5 py-1.5"
                        >
                          <a
                            href={link.share_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex-1 text-xs text-violet-700 hover:text-violet-900 truncate font-medium"
                            title={link.share_url}
                          >
                            {link.share_url}
                          </a>
                          <button
                            onClick={() => handleCopyLink(link.share_url)}
                            className="text-violet-500 hover:text-violet-700 shrink-0"
                            title="คัดลอกลิงก์"
                            aria-label="คัดลอกลิงก์"
                          >
                            <Copy className="w-3.5 h-3.5" aria-hidden="true" />
                          </button>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
          </div>

        </div>
        )}

        {/* ════════════════════════════════════════════════════════════════
            Right Panel: Live A4 Preview Canvas (flex-1)
        ════════════════════════════════════════════════════════════════ */}
        <div className="print-studio-preview-area flex-1 flex bg-slate-100 rounded-xl overflow-hidden">
          {/* A4 Preview Canvas (centered, full area) */}
          <div className="flex-1 overflow-y-auto p-6 flex items-start justify-center">
            {currentPageData ? (
              <div
                ref={previewRef}
                className="print-studio-page bg-white shadow-lg rounded-lg p-8
                  w-full max-w-[1100px]"
                style={{
                  aspectRatio: '297 / 210',
                  fontFamily: "'Sarabun', 'Segoe UI', Tahoma, sans-serif",
                }}
              >
                {/* Inject Sarabun font for preview rendering */}
                <style>{SARABUN_IMPORT}</style>
                <div
                  dangerouslySetInnerHTML={{ __html: previewHTML }}
                  style={{ width: '100%', height: '100%' }}
                />
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center py-20 text-gray-400">
                <Calendar className="w-12 h-12 mb-3" />
                <p className="text-sm">ไม่มีข้อมูลสำหรับแท็บนี้</p>
              </div>
            )}
          </div>

          {/* Right: vertical navigation rail with tab selector (mirrors Step 5) */}
          {pageCount > 0 && (
            rightCollapsed ? (
            <div className="w-11 shrink-0 border-l border-gray-200 bg-gray-50/50 flex flex-col items-center py-2 gap-1.5">
              <button
                onClick={() => setRightCollapsed(false)}
                title="ขยายแถบเลือกหน้า"
                aria-label="ขยายแถบเลือกหน้า"
                className="p-1.5 rounded-lg text-gray-500 hover:text-gray-900 hover:bg-gray-100 transition-colors"
              >
                <PanelRightOpen className="w-4 h-4" />
              </button>
              <div className="w-full border-t border-gray-200 my-1" />
              {[
                { id: 'class', icon: '📋', label: `ห้องเรียน (${classPages.length})` },
                { id: 'teacher', icon: '👤', label: `ครูผู้สอน (${teacherPages.length})` },
                { id: 'facility', icon: '🔬', label: `ห้องพิเศษ (${facilityPages.length})` },
              ].map((t) => (
                <button
                  key={t.id}
                  onClick={() => setPreviewTab(t.id)}
                  title={t.label}
                  aria-label={t.label}
                  aria-pressed={previewTab === t.id}
                  className={`w-8 h-8 flex items-center justify-center rounded-lg text-sm transition-colors
                    ${previewTab === t.id
                      ? (t.id === 'facility'
                          ? 'bg-indigo-50 ring-1 ring-indigo-400'
                          : 'bg-blue-50 ring-1 ring-blue-400')
                      : 'bg-gray-100 text-gray-500 hover:bg-gray-200'}`}
                >
                  <span aria-hidden="true">{t.icon}</span>
                </button>
              ))}
              <div className="w-full border-t border-gray-200 my-1" />
              <button
                onClick={() => setCurrentPage(Math.max(0, safeCurrentPage - 1))}
                title="หน้าก่อนหน้า"
                aria-label="หน้าก่อนหน้า"
                disabled={safeCurrentPage <= 0}
                className="p-1.5 rounded-lg text-gray-500 hover:text-gray-900 hover:bg-gray-100 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <ChevronUp className="w-4 h-4" />
              </button>
              <span className="text-[10px] font-semibold text-gray-500 tabular-nums select-none" aria-live="polite">
                {safeCurrentPage + 1}/{pageCount}
              </span>
              <button
                onClick={() => setCurrentPage(Math.min(pageCount - 1, safeCurrentPage + 1))}
                title="หน้าถัดไป"
                aria-label="หน้าถัดไป"
                disabled={safeCurrentPage >= pageCount - 1}
                className="p-1.5 rounded-lg text-gray-500 hover:text-gray-900 hover:bg-gray-100 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <ChevronDown className="w-4 h-4" />
              </button>
            </div>
            ) : (
            <div className="w-[160px] shrink-0 border-l border-gray-200 bg-gray-50/50 flex flex-col">
              {/* Tab selector (moved here from above preview) */}
              <div className="flex flex-col gap-1 p-2 border-b border-gray-200 bg-white">
                <button
                  onClick={() => setPreviewTab('class')}
                  aria-label={`ห้องเรียน (${classPages.length})`}
                  className={`px-2 py-1.5 rounded-md text-xs font-medium transition-colors text-center
                    ${previewTab === 'class'
                      ? 'bg-blue-50 text-blue-700 border border-blue-400 font-bold'
                      : 'bg-gray-100 text-gray-600 hover:bg-gray-200 border border-transparent'}`}
                >
                  <span aria-hidden="true">📋</span> ห้องเรียน ({classPages.length})
                </button>
                <button
                  onClick={() => setPreviewTab('teacher')}
                  aria-label={`ครูผู้สอน (${teacherPages.length})`}
                  className={`px-2 py-1.5 rounded-md text-xs font-medium transition-colors text-center
                    ${previewTab === 'teacher'
                      ? 'bg-blue-50 text-blue-700 border border-blue-400 font-bold'
                      : 'bg-gray-100 text-gray-600 hover:bg-gray-200 border border-transparent'}`}
                >
                  <span aria-hidden="true">👤</span> ครูผู้สอน ({teacherPages.length})
                </button>
                <button
                  onClick={() => setPreviewTab('facility')}
                  aria-label={`ห้องพิเศษ (${facilityPages.length})`}
                  className={`px-2 py-1.5 rounded-md text-xs font-medium transition-colors text-center
                    ${previewTab === 'facility'
                      ? 'bg-indigo-50 text-indigo-700 border border-indigo-400 font-bold'
                      : 'bg-gray-100 text-gray-600 hover:bg-gray-200 border border-transparent'}`}
                >
                  <span aria-hidden="true">🔬</span> ห้องพิเศษ ({facilityPages.length})
                </button>
              </div>

              {/* Column header */}
              <div className="flex items-center justify-between text-[11px] font-semibold text-gray-400 px-2 py-1 uppercase border-b border-gray-200">
                <span>
                  {previewTab === 'class' ? 'ห้องเรียน' : previewTab === 'teacher' ? 'ครูผู้สอน' : 'ห้องพิเศษ'}
                  <span className="ml-1 text-gray-300 normal-case">
                    {safeCurrentPage + 1}/{pageCount}
                  </span>
                </span>
                <button
                  onClick={() => setRightCollapsed(true)}
                  title="ย่อแถบเลือกหน้า"
                  aria-label="ย่อแถบเลือกหน้า"
                  className="p-1 rounded text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors"
                >
                  <PanelRightClose className="w-3.5 h-3.5" />
                </button>
              </div>

              {/* Scrollable pill list */}
              <div
                className="flex-1 overflow-y-auto py-1 px-1.5 space-y-1"
                style={{ maxHeight: 'calc(100vh - 220px)' }}
              >
                {activePages.map((page, idx) => {
                  const isActive = idx === safeCurrentPage
                  const isFacility = previewTab === 'facility'
                  const status = isFacility ? null
                    : previewTab === 'class'
                      ? classStatuses[page.id]
                      : teacherStatuses[page.id]
                  const isComplete = isFacility ? false
                    : previewTab === 'class'
                      ? status?.isComplete
                      : false

                  const pillClass = isActive
                    ? (isFacility
                        ? 'bg-indigo-50 text-indigo-700 border border-indigo-500 ring-1 ring-indigo-400 font-bold'
                        : 'bg-blue-50 text-blue-700 border border-blue-500 ring-1 ring-blue-400 font-bold')
                    : isComplete
                      ? 'bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-100'
                      : isFacility
                        ? 'bg-gray-50 text-gray-700 border border-gray-200 hover:bg-gray-100'
                        : 'bg-amber-50 text-amber-700 border border-amber-200 hover:bg-amber-100'

                  const badge = isFacility
                    ? ''
                    : previewTab === 'class'
                      ? (isComplete ? '✓' : `(${status?.remaining || 0})`)
                      : `(${status?.assigned || 0})`

                  return (
                    <button
                      key={page.id}
                      onClick={() => setCurrentPage(idx)}
                      className={`w-full text-left px-2 py-1.5 rounded-lg text-[11px] font-medium
                        transition-all truncate ${pillClass}`}
                      title={page.label}
                    >
                      {page.label}
                      <span className="ml-1 text-[10px] opacity-70">{badge}</span>
                    </button>
                  )
                })}
              </div>
            </div>
            )
          )}
        </div>
      </div>

      {/* ── Overwrite modal — saved-links store is full (5/5) ──────────── */}
      {overwritePending && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-black/40 backdrop-blur-sm"
            role="button"
            tabIndex={0}
            aria-label="ปิดหน้าต่าง"
            onClick={() => { setOverwritePending(null); setConfirmOverwrite(null) }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                setOverwritePending(null)
                setConfirmOverwrite(null)
              }
            }}
          />
          <div
            ref={storageModalRef}
            id="storage-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="modal-title"
            className="relative bg-white rounded-xl shadow-2xl w-full max-w-md p-5 space-y-3"
          >
            <div>
              <h3 id="modal-title" className="text-base font-bold text-gray-800">พื้นที่บันทึกเต็ม (5/5 รายการ)</h3>
              <p className="text-xs text-gray-500 mt-1">
                คลิกเลือก 1 รายการด้านล่างเพื่อแทนที่ด้วยตารางปัจจุบัน หรือกดยกเลิก
              </p>
            </div>
            <div className="space-y-1.5 max-h-64 overflow-y-auto">
              {savedLinkEntries.map((e, idx) => (
                <button
                  key={`${e.shortCode}-${idx}`}
                  onClick={() => setConfirmOverwrite(idx)}
                  className={`w-full text-left px-3 py-2 rounded-lg border transition-colors
                    ${confirmOverwrite === idx
                      ? 'border-red-500 bg-red-50 ring-1 ring-red-400'
                      : 'border-gray-200 hover:border-red-400 hover:bg-red-50'}`}
                >
                  <div className="text-sm font-semibold text-gray-800 truncate">
                    {e.title || 'ตารางสอน'}
                  </div>
                  <div className="text-[10px] text-gray-500 mt-0.5">
                    {formatThaiDate(e.savedAt)}
                    {e.savedAt ? ' · ' : ''}
                    {e.shortCode}
                  </div>
                </button>
              ))}
            </div>

            {/* ── 2-step confirmation: shown after a slot is selected ─── */}
            {confirmOverwrite !== null && (
              <div className="rounded-lg bg-amber-50 border border-amber-300 p-3 space-y-2">
                <p className="text-sm text-amber-800 font-medium">
                  ต้องการบันทึกทับ '{savedLinkEntries[confirmOverwrite]?.title || 'ตารางสอน'}' ใช่หรือไม่?
                </p>
                <div className="flex gap-2">
                  <button
                    onClick={() => handleOverwriteSave(confirmOverwrite)}
                    className="flex-1 py-2 text-sm font-bold text-white bg-red-600
                      hover:bg-red-700 rounded-lg transition-colors"
                  >
                    ยืนยันบันทึกทับ
                  </button>
                  <button
                    onClick={() => setConfirmOverwrite(null)}
                    className="flex-1 py-2 text-sm font-medium text-gray-600 bg-gray-100
                      hover:bg-gray-200 rounded-lg transition-colors"
                  >
                    ยกเลิก
                  </button>
                </div>
              </div>
            )}

            <div className="flex gap-2 pt-1">
              <button
                onClick={() => { setOverwritePending(null); setConfirmOverwrite(null) }}
                className="flex-1 py-2 text-sm font-medium text-gray-600 bg-gray-100
                  hover:bg-gray-200 rounded-lg transition-colors"
              >
                ยกเลิก
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Toast notification ─────────────────────────────────────────── */}
      {toast && (
        <div
          role={toast.type === 'ok' ? 'status' : 'alert'}
          aria-live={toast.type === 'ok' ? 'polite' : 'assertive'}
          className={`fixed bottom-6 right-6 z-[120] px-4 py-3 rounded-xl shadow-lg
          text-sm font-medium flex items-center gap-2 max-w-sm
          ${toast.type === 'ok' ? 'bg-green-600 text-white' : 'bg-red-600 text-white'}`}>
          {toast.type === 'ok'
            ? <CheckCircle className="w-5 h-5 shrink-0" aria-hidden="true" />
            : <XCircle className="w-5 h-5 shrink-0" aria-hidden="true" />}
          {toast.msg}
        </div>
      )}
    </div>
  )
}
