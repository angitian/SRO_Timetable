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
import PrintSettingsPanel from '../components/print/PrintSettingsPanel.jsx'

// ── Constants ────────────────────────────────────────────────────────────
const TEMPLATE_KEY = 'app_timetable_print_template'
const KRU_PLATFORM_URL = 'https://kru-platform.com'

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
    kind === 'class' ? s.class_id === item.id : s.teacher_id === item.id
  )
  const subjectIds = new Set(filteredSlots.map((s) => s.subject_id))
  const teacherIds = new Set(filteredSlots.map((s) => s.teacher_id))
  const classIds = new Set(filteredSlots.map((s) => s.class_id))

  const payload = {
    v: 3, // payload format version — see PublicViewerPage.decodePayload
    kind,
    i: [item.id, item.name],
    s: filteredSlots.map((sl) => [sl.day, sl.period, sl.subject_id, sl.teacher_id, sl.class_id]),
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
    f: (fixedSlots || []).map((fs) => [fs.day, fs.period, fs.name]),
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
  return `${window.location.origin}/view?d=${payload}`
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
 * Build the sign-off section HTML (signature blocks).
 */
function buildSignOffHTML(settings) {
  const { signatoryName, signatoryTitle } = settings
  const dateStr = new Date().toLocaleDateString('th-TH', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })

  return `<div style="margin-top:8px;display:flex;justify-content:space-between;gap:40px;break-inside:avoid;">
    <div style="text-align:center;font-size:12px;color:#4b5563;">
      <div>ลงนามวันที่ ${dateStr}</div>
      <div style="margin-top:18px;border-top:1px solid #1f2937;padding-top:3px;min-width:200px;">
        ${signatoryName ? escapeHTML(signatoryName) : '..............................'}
      </div>
      <div style="margin-top:2px;font-weight:600;">
        ${signatoryTitle ? escapeHTML(signatoryTitle) : 'ผู้จัดทำ'}
      </div>
    </div>
  </div>`
}

/**
 * Build the toggleable timestamp footer strip (print date/time only).
 * Pinned to the bottom of the A4 page via margin-top:auto in a flex column.
 * Returns empty string when settings.showFooter is false — the user may
 * turn this off without affecting the always-on branding footer below.
 */
function buildTimestampFooterHTML(settings) {
  if (!settings.showFooter) return ''
  const now = new Date()
  const dateStr = now.toLocaleDateString('th-TH', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })
  const timeStr = now.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' })

  return `<div style="padding-top:8px;border-top:1px solid #e5e7eb;
    font-size:10px;color:#64748b;line-height:1.3;">
    <div style="white-space:nowrap;">พิมพ์เมื่อ ${dateStr} เวลา ${timeStr} น.</div>
  </div>`
}

/**
 * Build the ALWAYS-ON branding footer strip (developer credits).
 * This is hardcoded and cannot be disabled by any setting — the developer
 * credit "One Man Lab / KRU Platform" must remain visible on every print.
 * Pinned to the very bottom of the A4 page via margin-top:auto.
 * Equivalent Tailwind: text-[9px] text-slate-400 select-none
 */
function buildBrandingFooterHTML() {
  return `<div style="margin-top:auto;padding-top:6px;
    display:flex;align-items:center;justify-content:space-between;
    font-size:9px;color:#94a3b8;line-height:1.3;user-select:none;-webkit-user-select:none;">
    <div style="white-space:nowrap;">SRO Timetable — พัฒนาโดย One Man Lab เพื่อ KRU Platform</div>
    <div style="white-space:nowrap;">
      <a href="${KRU_PLATFORM_URL}" style="color:#94a3b8;text-decoration:none;">kru-platform.com</a>
    </div>
  </div>`
}

/**
 * Build the workload summary HTML for a class or teacher.
 * Compact inline badge strip (1-2 lines) instead of a tall table.
 */
function buildWorkloadSummaryHTML(kind, item, ctx) {
  const badgeStyle = `display:inline-block;background:#f1f5f9;border-radius:3px;padding:1px 6px;margin:0 3px 2px 0;font-size:10px;color:#334155;`
  const labelStyle = `font-weight:700;color:#374151;`

  if (kind === 'class') {
    // Count lessons per subject for this class
    const classLbs = ctx.lessonBlocks.filter((lb) => lb.class_id === item.id)
    const subjCount = {}
    for (const lb of classLbs) {
      const subjName = ctx.subjectMap.get(lb.subject_id)?.name || lb.subject_id
      subjCount[subjName] = (subjCount[subjName] || 0) + lb.periods_per_week
    }
    const total = Object.values(subjCount).reduce((a, b) => a + b, 0)
    const items = Object.entries(subjCount)
      .map(([name, count]) => `<span style="${badgeStyle}">${escapeHTML(name)} (${count})</span>`)
      .join('')
    return `<div style="margin-top:4px;font-size:10px;color:#6b7280;line-height:1.5;break-inside:avoid;">
      <span style="${labelStyle}">สรุปภาระงาน (${total} คาบ/สัปดาห์):</span> ${items}
    </div>`
  } else {
    // Teacher: count lessons per class
    const teacherSlots = ctx.allSlots.filter((s) => s.teacher_id === item.id)
    const classCount = {}
    for (const s of teacherSlots) {
      const className = ctx.classMap.get(s.class_id)?.name || s.class_id
      classCount[className] = (classCount[className] || 0) + 1
    }
    const total = Object.values(classCount).reduce((a, b) => a + b, 0)
    const items = Object.entries(classCount)
      .map(([name, count]) => `<span style="${badgeStyle}">${escapeHTML(name)} (${count})</span>`)
      .join('')
    return `<div style="margin-top:4px;font-size:10px;color:#6b7280;line-height:1.5;break-inside:avoid;">
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
  const signOff = settings.showSignOff ? buildSignOffHTML(settings) : ''
  // Timestamp footer is toggleable via settings.showFooter; branding footer
  // is always rendered and pinned to the bottom of the A4 page.
  const timestampFooter = buildTimestampFooterHTML(settings)
  const brandingFooter = buildBrandingFooterHTML()

  // The grid HTML from exportEngine already includes the page title (h2)
  return `<div class="print-studio-page" style="page-break-after:always;break-inside:avoid;display:flex;flex-direction:column;">
    ${header}
    ${gridHTML}
    ${workload}
    ${signOff}
    ${timestampFooter}
    ${brandingFooter}
  </div>`
}

// ── Main Component ───────────────────────────────────────────────────────
export default function PrintStudio() {
  const { fixtureData, result, userPlacements, activeSnapshotLabel, setStep } = useApp()

  // ── Settings state (with localStorage hydration) ──────────────────────
  const [settings, setSettings] = useState(DEFAULT_SETTINGS)
  const [previewTab, setPreviewTab] = useState('class') // 'class' | 'teacher' | 'facility'
  const [currentPage, setCurrentPage] = useState(0)
  const [exporting, setExporting] = useState(false)
  const [exportProgress, setExportProgress] = useState('')
  const [exportScope, setExportScope] = useState('current') // 'current' | 'tab' | 'all'
  const [toast, setToast] = useState(null)
  const toastTimerRef = useRef(null)
  const previewRef = useRef(null)

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
          กลับไปหน้าจัดตาราง
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
      label: activeSnapshotLabel || 'ตารางสอน',
      periodTimeMap,
      showPeriodTimes: settings.showPeriodTimes,
    }),
    [resultSlots, classes, subjects, teachers, fixtureData, gridConfig, userPlacements, lesson_blocks, fixed_slots, activeSnapshotLabel, periodTimeMap, settings.showPeriodTimes],
  )

  // ── Build export context (shared lookup maps) ─────────────────────────
  const ctx = useMemo(() => buildExportContext(exportData), [exportData])

  // ── Build page arrays for each tab ────────────────────────────────────
  const classPages = useMemo(() => {
    return classes.map((cls) => {
      const qrPayload = buildQRPayload('class', cls, ctx, gridConfig, fixed_slots, settings)
      return {
        label: cls.name,
        kind: 'class',
        id: cls.id,
        item: cls,
        qrPayload,
        viewerUrl: buildViewerURL(qrPayload),
        gridHTML: buildClassGridHTML(cls, ctx),
      }
    })
  }, [classes, ctx, gridConfig, fixed_slots, settings])

  const teacherPages = useMemo(() => {
    return teachers.map((teacher) => {
      const qrPayload = buildQRPayload('teacher', teacher, ctx, gridConfig, fixed_slots, settings)
      return {
        label: teacher.name,
        kind: 'teacher',
        id: teacher.id,
        item: teacher,
        qrPayload,
        viewerUrl: buildViewerURL(qrPayload),
        gridHTML: buildTeacherGridHTML(teacher, ctx),
      }
    })
  }, [teachers, ctx, gridConfig, fixed_slots, settings])

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
            Left Panel: Settings & Controls (w-80)
        ════════════════════════════════════════════════════════════════ */}
        <div className="print-studio-left-panel w-80 shrink-0 overflow-y-auto bg-white rounded-xl border border-gray-200 shadow-sm p-4 space-y-4">
          {/* Back button */}
          <button
            onClick={() => setStep(5)}
            className="flex items-center gap-1.5 text-sm text-gray-600 hover:text-gray-900 transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            กลับไปแก้ไขตาราง
          </button>

          {/* Settings Form (extracted component) */}
          <PrintSettingsPanel
            settings={settings}
            onSettingsChange={updateSettings}
            onSaveTemplate={handleSaveTemplate}
            onResetTemplate={handleResetTemplate}
          />

          {/* Export Scope Selector — horizontal segmented buttons */}
          <div className="space-y-2">
            <h3 className="text-xs font-bold text-gray-500 uppercase tracking-wide">ขอบเขตการส่งออก</h3>
            <div className="flex gap-1 bg-gray-100 rounded-lg p-1">
              {[
                { id: 'current', label: 'หน้านี้' },
                { id: 'tab', label: `แท็บนี้ (${activePages.length})` },
                { id: 'all', label: `ทั้งหมด (${classPages.length + teacherPages.length + facilityPages.length})` },
              ].map((opt) => (
                <button
                  key={opt.id}
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

          {/* Output Action Buttons */}
          <div className="space-y-2">
            <h3 className="text-xs font-bold text-gray-500 uppercase tracking-wide">ส่งออกเอกสาร</h3>
            <>
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
              <button
                onClick={handleExportPNG}
                disabled={exporting}
                className="flex items-center justify-center gap-2 w-full py-2.5
                  bg-emerald-600 text-white rounded-lg font-bold text-sm shadow-sm
                  hover:bg-emerald-700 transition-colors
                  disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {exporting && exportProgress.includes('PNG') ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <ImageIcon className="w-4 h-4" />
                )}
                ส่งออกโฟลเดอร์ PNG ({exportLabelSuffix})
              </button>
              <button
                onClick={handleExportExcel}
                disabled={exporting}
                className="flex items-center justify-center gap-2 w-full py-2.5
                  bg-green-700 text-white rounded-lg font-bold text-sm shadow-sm
                  hover:bg-green-800 transition-colors
                  disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {exporting && exportProgress.includes('Excel') ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Table className="w-4 h-4" />
                )}
                ส่งออก Excel ({exportScope === 'all' ? 'ทุกชีต' : previewTab === 'class' ? 'ชีตห้องเรียน' : previewTab === 'teacher' ? 'ชีตครู' : 'ชีตห้องพิเศษ'})
              </button>
            </>
            {exporting && exportProgress && (
              <div className="text-xs text-gray-500 text-center py-1">{exportProgress}</div>
            )}
          </div>

        </div>

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
            <div className="w-[160px] shrink-0 border-l border-gray-200 bg-gray-50/50 flex flex-col">
              {/* Tab selector (moved here from above preview) */}
              <div className="flex flex-col gap-1 p-2 border-b border-gray-200 bg-white">
                <button
                  onClick={() => setPreviewTab('class')}
                  className={`px-2 py-1.5 rounded-md text-xs font-medium transition-colors text-center
                    ${previewTab === 'class'
                      ? 'bg-blue-50 text-blue-700 border border-blue-400 font-bold'
                      : 'bg-gray-100 text-gray-600 hover:bg-gray-200 border border-transparent'}`}
                >
                  📋 ห้องเรียน ({classPages.length})
                </button>
                <button
                  onClick={() => setPreviewTab('teacher')}
                  className={`px-2 py-1.5 rounded-md text-xs font-medium transition-colors text-center
                    ${previewTab === 'teacher'
                      ? 'bg-blue-50 text-blue-700 border border-blue-400 font-bold'
                      : 'bg-gray-100 text-gray-600 hover:bg-gray-200 border border-transparent'}`}
                >
                  👤 ครูผู้สอน ({teacherPages.length})
                </button>
                <button
                  onClick={() => setPreviewTab('facility')}
                  className={`px-2 py-1.5 rounded-md text-xs font-medium transition-colors text-center
                    ${previewTab === 'facility'
                      ? 'bg-indigo-50 text-indigo-700 border border-indigo-400 font-bold'
                      : 'bg-gray-100 text-gray-600 hover:bg-gray-200 border border-transparent'}`}
                >
                  🔬 ห้องพิเศษ ({facilityPages.length})
                </button>
              </div>

              {/* Column header */}
              <div className="text-[11px] font-semibold text-gray-400 px-2 py-1 uppercase border-b border-gray-200">
                {previewTab === 'class' ? 'ห้องเรียน' : previewTab === 'teacher' ? 'ครูผู้สอน' : 'ห้องพิเศษ'}
                <span className="ml-1 text-gray-300 normal-case">
                  {safeCurrentPage + 1}/{pageCount}
                </span>
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
          )}
        </div>
      </div>

      {/* ── Toast notification ─────────────────────────────────────────── */}
      {toast && (
        <div className={`fixed bottom-6 right-6 z-[120] px-4 py-3 rounded-xl shadow-lg
          text-sm font-medium flex items-center gap-2 max-w-sm
          ${toast.type === 'ok' ? 'bg-green-600 text-white' : 'bg-red-600 text-white'}`}>
          {toast.type === 'ok'
            ? <CheckCircle className="w-5 h-5 shrink-0" />
            : <XCircle className="w-5 h-5 shrink-0" />}
          {toast.msg}
        </div>
      )}
    </div>
  )
}
