import { useState, useCallback } from 'react'
import {
  Rocket,
  Target,
  Loader2,
  ChevronDown,
  SlidersHorizontal,
  Check,
  FolderOpen,
  Save,
  Trash2,
  Download,
  Plus,
  AlertCircle,
  Clock,
  Boxes,
  AlertTriangle,
  Gauge,
  Calendar,
  CalendarClock,
  Users,
  FlaskConical,
  FileSpreadsheet,
  Printer,
  Cloud,
} from 'lucide-react'
import { SOLVER_PRESETS, getPreset } from '../../utils/scoreCalculator.js'
import { formatSnapshotDate, generateLabel } from '../../utils/versionManager.js'

/**
 * Solver status config for the compact badge.
 */
const STATUS_CONFIG = {
  OPTIMAL: { dot: 'bg-green-500', text: 'text-green-700', label: 'OPTIMAL' },
  FEASIBLE: { dot: 'bg-yellow-500', text: 'text-yellow-700', label: 'FEASIBLE' },
  INFEASIBLE: { dot: 'bg-red-500', text: 'text-red-700', label: 'INFEASIBLE' },
  UNKNOWN: { dot: 'bg-gray-400', text: 'text-gray-600', label: 'UNKNOWN' },
}

/**
 * Compact inline metrics badge.
 * Renders: `[ ⚡ 0.90s • OPTIMAL ]`
 */
function MetricsBadge({ metrics, onClick }) {
  if (!metrics) return null
  const cfg = STATUS_CONFIG[metrics.status] || STATUS_CONFIG.UNKNOWN
  const secs = metrics.wall_time_seconds != null
    ? `${metrics.wall_time_seconds.toFixed(2)}s`
    : '—'
  return (
    <button
      onClick={onClick}
      className="flex items-center justify-center gap-1 w-full px-2 py-1.5 rounded-lg text-xs font-medium
        bg-gray-50 border border-gray-200 hover:bg-gray-100 hover:border-gray-300
        transition-colors"
      title="ดูสถิติการคำนวณแบบเต็ม"
    >
      <span className="text-amber-500">⚡</span>
      <span className="text-gray-600 tabular-nums">{secs}</span>
      <span className="text-gray-300">•</span>
      <span className={`flex items-center gap-1 font-semibold ${cfg.text}`}>
        <span className={`w-1.5 h-1.5 rounded-full ${cfg.dot}`} />
        {cfg.label}
      </span>
    </button>
  )
}

/**
 * Popover panel showing full technical metrics.
 */
function MetricsPopover({ metrics, onClose }) {
  if (!metrics) return null
  const cfg = STATUS_CONFIG[metrics.status] || STATUS_CONFIG.UNKNOWN
  const rows = [
    { icon: Clock, label: 'เวลาประมวลผล (Wall Time)', value: `${metrics.wall_time_seconds?.toFixed(3)}s` },
    { icon: Boxes, label: 'จำนวนตัวแปร (Variables)', value: metrics.num_variables?.toLocaleString() },
    { icon: Target, label: 'จำนวนข้อจำกัด (Constraints)', value: metrics.num_constraints?.toLocaleString() },
    { icon: AlertTriangle, label: 'Hard Violations', value: metrics.hard_violations, danger: metrics.hard_violations > 0 },
    { icon: AlertTriangle, label: 'Soft Violations', value: metrics.soft_violations, danger: metrics.soft_violations > 0 },
  ]
  if (metrics.objective_value !== undefined) {
    rows.push({ icon: Gauge, label: 'Objective Value', value: metrics.objective_value?.toFixed(1) })
  }
  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} />
      <div className="absolute left-0 top-full mt-1 z-50 w-72 bg-white rounded-xl shadow-xl
        border border-gray-200 overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-100 bg-gray-50 flex items-center justify-between">
          <span className="text-xs font-bold text-gray-500 uppercase tracking-wide">
            สถิติการคำนวณ
          </span>
          <span className={`flex items-center gap-1 text-xs font-bold ${cfg.text}`}>
            <span className={`w-1.5 h-1.5 rounded-full ${cfg.dot}`} />
            {cfg.label}
          </span>
        </div>
        <div className="divide-y divide-gray-50">
          {rows.map((row) => {
            const Icon = row.icon
            return (
              <div key={row.label} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                <Icon className={`w-4 h-4 shrink-0 ${row.danger ? 'text-red-500' : 'text-gray-400'}`} />
                <span className="text-gray-600 flex-1">{row.label}</span>
                <span className={`font-bold tabular-nums ${row.danger ? 'text-red-600' : 'text-gray-900'}`}>
                  {row.value}
                </span>
              </div>
            )
          })}
        </div>
      </div>
    </>
  )
}

/**
 * Clear dropdown option helper.
 */
function ClearOption({ icon, title, desc, disabled, danger, onClick }) {
  return (
    <button
      disabled={disabled}
      onClick={onClick}
      className={`w-full flex items-center gap-3 px-4 py-3 text-sm text-left transition-colors
        border-t border-gray-100 first:border-t-0
        disabled:opacity-30 disabled:cursor-not-allowed
        ${danger ? 'hover:bg-red-50' : 'hover:bg-gray-50'}`}
    >
      <span className="text-base shrink-0">{icon}</span>
      <div>
        <div className={`font-semibold ${danger ? 'text-red-700' : 'text-gray-800'}`}>{title}</div>
        <div className="text-xs text-gray-500">{desc}</div>
      </div>
    </button>
  )
}

/**
 * Preset dropdown option row.
 */
function PresetOption({ preset, timeHint, isActive, onClick }) {
  return (
    <button
      onClick={onClick}
      className={`w-full flex items-start gap-3 px-4 py-3 text-left transition-colors border-t border-gray-100 first:border-t-0
        ${isActive ? 'bg-blue-50' : 'hover:bg-gray-50'}`}
    >
      <span className="text-lg leading-none mt-0.5 shrink-0">{preset.icon}</span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className={`font-semibold text-sm ${isActive ? 'text-blue-700' : 'text-gray-800'}`}>
            {preset.name}
          </span>
          {isActive && <Check className="w-3.5 h-3.5 text-blue-600" />}
        </div>
        <div className="text-xs text-gray-500 mt-0.5">{preset.description}</div>
        <div className="text-[11px] text-gray-400 mt-0.5">{timeHint}</div>
      </div>
    </button>
  )
}

/**
 * Top Solver Toolbar — full-width horizontal panel placed below the Tab Selector
 * and above the three-panel layout (Drawer | Grid | MiniRail).
 *
 * Left side:  Solver preset selector (dropdown) + Clear dropdown + Constraint info
 *             + Version dropdown + Save buttons + Import/Export JSON
 * Right side: Primary "generate remaining" action button
 *
 * Props:
 *   solverPreset          — 'fast' | 'balanced' | 'deep'
 *   onPresetChange        — (presetId) => void
 *   onGenerate            — () => void
 *   isGenerating          — boolean
 *   disabled              — boolean (e.g. when no fixture data)
 *   fixedCount            — int: number of 🔒 locked fixed slots
 *   preAssignedCount      — int: number of 📌 user-placed slots
 *   onClearManual         — () => void
 *   onClearSolver         — () => void
 *   onClearAll            — () => void
 *   onClearByTeacher      — (teacherId: string) => void
 *   teachers              — { id, name }[]
 *   hasResult             — boolean
 *   hasPlacements         — boolean
 *   className             — string (selected class/teacher name for confirmation)
 *   onOpenConstraints     — () => void  (opens the constraints overview modal)
 *   // ── Version / Save props ──
 *   snapshots             — array of snapshot metadata
 *   activeSnapshotId      — string | null
 *   activeSnapshotLabel   — string | null
 *   isSnapshotDirty       — boolean
 *   lastSnapshotSaveAt    — number | null
 *   onSaveSnapshot        — (label, opts?) => { ok, error? }
 *   onLoadSnapshot        — (id) => { ok, error? }
 *   onDeleteSnapshot      — (id) => boolean
 *   onExportSnapshot      — (id?) => void
 *   onImportSnapshot      — (file) => Promise<{ ok, error? }>
 */

// Build the confirmation modal message for a pending batch action.
// Replaces the previous 8-level nested ternary with a flat lookup.
function buildConfirmMessage(action, selectedTeacherId, selectedClassId, teachers, classes) {
  if (!action) return ''
  // Actions that don't need a teacher/class selection
  const SIMPLE_MESSAGES = {
    manual: 'ยืนยันการล้างเฉพาะวิชาที่วางด้วยมือ',
    solver: 'ยืนยันการล้างเฉพาะวิชาที่ระบบจัดอัตโนมัติ',
    all: 'ยืนยันการล้างทั้งหมดกลับเป็นตารางเปล่า',
  }
  if (SIMPLE_MESSAGES[action]) return SIMPLE_MESSAGES[action]

  // Actions that target a teacher
  const TEACHER_ACTIONS = {
    teacher: 'ยืนยันการล้างวิชาทั้งหมดของ',
    pinTeacher: 'ยืนยันการปักหมุดผล AI ของ',
    unpinTeacher: 'ยืนยันการปลดล็อกหมุดของ',
  }
  if (TEACHER_ACTIONS[action]) {
    if (!selectedTeacherId) return 'กรุณาเลือกครูผู้สอน'
    const name = teachers.find((t) => t.id === selectedTeacherId)?.name
    return `${TEACHER_ACTIONS[action]} ${name}`
  }

  // Actions that target a class
  const CLASS_ACTIONS = {
    class: 'ยืนยันการล้างวิชาทั้งหมดของ',
    pinClass: 'ยืนยันการปักหมุดผล AI ของ',
    unpinClass: 'ยืนยันการปลดล็อกหมุดของ',
  }
  if (CLASS_ACTIONS[action]) {
    if (!selectedClassId) return 'กรุณาเลือกห้องเรียน'
    const name = classes.find((c) => c.id === selectedClassId)?.name
    return `${CLASS_ACTIONS[action]} ${name}`
  }

  return ''
}

// Actions that require a teacher or class selection before the confirm button is enabled.
const ACTIONS_REQUIRING_SELECTION = new Set([
  'teacher', 'class', 'pinTeacher', 'pinClass', 'unpinTeacher', 'unpinClass',
])

export default function SolverToolbar({
  solverPreset = 'balanced',
  onPresetChange,
  onGenerate,
  isGenerating = false,
  disabled = false,
  metrics = null,
  fixedCount = 0,
  preAssignedCount = 0,
  onClearManual,
  onClearSolver,
  onClearAll,
  onClearByTeacher,
  onClearSolverOnly,
  onClearByClass,
  onPinAllSolver,
  onUnpinAll,
  onPinByTeacher,
  onPinByClass,
  onUnpinByTeacher,
  onUnpinByClass,
  teachers = [],
  classes = [],
  hasResult = false,
  hasPlacements = false,
  className: selectedClassName,
  onOpenConstraints,
  onOpenSubstitutes,
  // ── Version / Save props ──
  snapshots = [],
  activeSnapshotId = null,
  activeSnapshotLabel = null,
  isSnapshotDirty = false,
  lastSnapshotSaveAt = null,
  onSaveSnapshot,
  onLoadSnapshot,
  onDeleteSnapshot,
  onExportSnapshot,
  onImportSnapshot,
  // ── Cloud workspace props ──
  user = null,
  onLogin,
  cloudSyncing = false,
  activeCloudWorkspaceId = null,
  onSaveToCloud,
  cloudWorkspaces = [],
  onListCloudWorkspaces,
  onLoadFromCloud,
  onDeleteFromCloud,
  // ── Tab + Print Studio props ──
  activeTab = 'timetable',
  onTabChange,
  onNavigatePrintStudio,
  // ── Excel Export props ──
  onQuickExport,
  onAdvancedExport,
  exporting = false,
  exportDisabled = false,
}) {
  const [presetDropdownOpen, setPresetDropdownOpen] = useState(false)
  const [metricsPopoverOpen, setMetricsPopoverOpen] = useState(false)
  const [clearDropdownOpen, setClearDropdownOpen] = useState(false)
  const [pinDropdownOpen, setPinDropdownOpen] = useState(false)
  const [excelDropdownOpen, setExcelDropdownOpen] = useState(false)
  const [pendingAction, setPendingAction] = useState(null) // 'manual'|'solver'|'all'|'teacher'|'class'|'pinTeacher'|'pinClass'|'unpinTeacher'|'unpinClass'
  const [showConfirm, setShowConfirm] = useState(false)
  const [selectedTeacherId, setSelectedTeacherId] = useState(null)
  const [selectedClassId, setSelectedClassId] = useState(null)
  // ── Version state ──
  const [versionDropdownOpen, setVersionDropdownOpen] = useState(false)
  const [showSaveDialog, setShowSaveDialog] = useState(false)
  const [saveLabel, setSaveLabel] = useState('')
  const [toast, setToast] = useState(null)
  // ── Cloud list state ──
  const [cloudListLoading, setCloudListLoading] = useState(false)

  const showToast = useCallback((type, msg) => {
    setToast({ type, msg })
    setTimeout(() => setToast(null), 3000)
  }, [])

  const currentPreset = getPreset(solverPreset)

  function openConfirm(action) {
    setPendingAction(action)
    if (action === 'teacher' || action === 'pinTeacher' || action === 'unpinTeacher') setSelectedTeacherId(null)
    if (action === 'class' || action === 'pinClass' || action === 'unpinClass') setSelectedClassId(null)
    setShowConfirm(true)
    setClearDropdownOpen(false)
    setPinDropdownOpen(false)
  }

  function handleConfirm() {
    if (pendingAction === 'manual') onClearManual?.()
    else if (pendingAction === 'solver') onClearSolver?.()
    else if (pendingAction === 'all') onClearAll?.()
    else if (pendingAction === 'teacher') onClearByTeacher?.(selectedTeacherId)
    else if (pendingAction === 'class') onClearByClass?.(selectedClassId)
    else if (pendingAction === 'pinTeacher') onPinByTeacher?.(selectedTeacherId)
    else if (pendingAction === 'pinClass') onPinByClass?.(selectedClassId)
    else if (pendingAction === 'unpinTeacher') onUnpinByTeacher?.(selectedTeacherId)
    else if (pendingAction === 'unpinClass') onUnpinByClass?.(selectedClassId)
    setShowConfirm(false)
    setPendingAction(null)
    setSelectedTeacherId(null)
    setSelectedClassId(null)
  }

  function handleCancel() {
    setShowConfirm(false)
    setPendingAction(null)
    setSelectedTeacherId(null)
    setSelectedClassId(null)
  }

  function handlePresetSelect(presetId) {
    setPresetDropdownOpen(false)
    onPresetChange?.(presetId)
  }

  const confirmMessage = buildConfirmMessage(
    pendingAction, selectedTeacherId, selectedClassId, teachers, classes,
  )

  const confirmDisabled =
    ACTIONS_REQUIRING_SELECTION.has(pendingAction) &&
    ((!selectedTeacherId && ['teacher', 'pinTeacher', 'unpinTeacher'].includes(pendingAction)) ||
     (!selectedClassId && ['class', 'pinClass', 'unpinClass'].includes(pendingAction)))

  // Build time hint for each preset option in the dropdown
  function presetTimeHint(preset) {
    return `~${preset.timeLimit} วินาที`
  }

  // ── Version handlers ──────────────────────────────────────────────
  function handleSaveNew() {
    const label = saveLabel.trim() || generateLabel(snapshots.length)
    const result = onSaveSnapshot?.(label)
    if (result?.ok) {
      showToast('ok', `บันทึก "${label}" แล้ว`)
    } else {
      showToast('err', result?.error || 'บันทึกไม่สำเร็จ')
    }
    setShowSaveDialog(false)
    setSaveLabel('')
  }

  function handleSaveCurrent() {
    if (!activeSnapshotId) {
      setShowSaveDialog(true)
      return
    }
    const result = onSaveSnapshot?.(activeSnapshotLabel, { updateExisting: true })
    if (result?.ok) {
      showToast('ok', 'บันทึกการเปลี่ยนแปลงแล้ว')
    } else {
      showToast('err', result?.error || 'บันทึกไม่สำเร็จ')
    }
  }

  function handleLoadSnap(id) {
    const result = onLoadSnapshot?.(id)
    if (result?.ok) {
      showToast('ok', 'โหลดเวอร์ชันแล้ว')
    } else {
      showToast('err', result?.error || 'โหลดไม่สำเร็จ')
    }
    setVersionDropdownOpen(false)
  }

  function handleDeleteSnap(id, label) {
    if (!confirm(`ยืนยันการลบ "${label}"?`)) return
    const ok = onDeleteSnapshot?.(id)
    if (ok) {
      showToast('ok', `ลบ "${label}" แล้ว`)
    } else {
      showToast('err', 'ลบไม่สำเร็จ')
    }
  }

  function handleExport() {
    onExportSnapshot?.(activeSnapshotId)
    showToast('ok', 'ดาวน์โหลดไฟล์ .json แล้ว')
  }

  async function handleSaveToCloud() {
    if (cloudSyncing) return
    if (!user) {
      showToast('err', 'กรุณาเข้าสู่ระบบด้วย Google เพื่อบันทึกขึ้นคลาวด์')
      try {
        await onLogin?.()
      } catch (e) {
        // login() redirects to Google; failure here is non-fatal
      }
      return
    }
    const label = activeSnapshotLabel || generateLabel(snapshots.length)
    const result = await onSaveToCloud?.(label)
    if (result?.ok) {
      showToast('ok', activeCloudWorkspaceId
        ? `อัปเดต "${result.title}" บนคลาวด์แล้ว`
        : `บันทึก "${result.title}" ขึ้นคลาวด์แล้ว`)
    } else {
      showToast('err', result?.error || 'บันทึกขึ้นคลาวด์ไม่สำเร็จ')
    }
  }

  // ── Cloud list handlers ──────────────────────────────────────────────
  // Toggle the version dropdown open/closed. When opening, fetch the latest
  // cloud workspace list so the user sees fresh data after saves/deletes
  // from elsewhere (e.g. the cloud save button just above).
  function handleToggleVersionDropdown() {
    const next = !versionDropdownOpen
    setVersionDropdownOpen(next)
    if (next && user && onListCloudWorkspaces) {
      setCloudListLoading(true)
      Promise.resolve(onListCloudWorkspaces())
        .catch(() => { /* doListCloudWorkspaces already returns [] on err */ })
        .finally(() => setCloudListLoading(false))
    }
  }

  async function handleLoadCloud(id) {
    if (cloudSyncing || !onLoadFromCloud) return
    const result = await onLoadFromCloud(id)
    if (result?.ok) {
      setVersionDropdownOpen(false)
      showToast('ok', 'โหลดตารางจากคลาวด์แล้ว')
    } else {
      showToast('err', result?.error || 'โหลดไม่สำเร็จ')
    }
  }

  async function handleDeleteCloud(id, title) {
    if (cloudSyncing || !onDeleteFromCloud) return
    if (!confirm(`ยืนยันการลบ "${title}" จากคลาวด์?`)) return
    const result = await onDeleteFromCloud(id)
    if (result?.ok) {
      showToast('ok', `ลบ "${title}" แล้ว`)
    } else {
      showToast('err', result?.error || 'ลบไม่สำเร็จ')
    }
  }

  async function handleCloudLoginFromDropdown() {
    try {
      await onLogin?.()
    } catch (e) {
      // login() redirects to Google; failure here is non-fatal
    }
  }

  // Active cloud workspace title (for dropdown label when no local snapshot
  // is active — i.e. user opened a cloud workspace directly).
  const activeCloudTitle = cloudWorkspaces.find(
    (w) => w.id === activeCloudWorkspaceId,
  )?.title

  const dirtyIndicator = isSnapshotDirty ? '●' : '✓'
  const dirtyColor = isSnapshotDirty ? 'text-amber-500' : 'text-green-500'
  const dirtyText = isSnapshotDirty
    ? 'ยังไม่ได้บันทึก'
    : lastSnapshotSaveAt
      ? `บันทึกล่าสุด ${formatSnapshotDate(lastSnapshotSaveAt)}`
      : 'พร้อมใช้งาน'

  const constraintCount = fixedCount + preAssignedCount
  const isTeacherTab = activeTab === 'teachers'

  // Quick Save is enabled when:
  //   - No snapshot yet (click opens "save new version" dialog), OR
  //   - Active snapshot has unsaved changes (click saves over current).
  // When a snapshot exists and nothing changed (auto-save already persisted),
  // the button is genuinely disabled — both visually and functionally.
  const quickSaveEnabled = !activeSnapshotId || isSnapshotDirty

  return (
    <>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-12 gap-3 items-stretch mb-3">
        {/* ════════════════════════════════════════════════════════════════
            Card 1: View & Status (มุมมองและสถานะ)
        ════════════════════════════════════════════════════════════════ */}
        <div className="bg-white p-2.5 rounded-xl border border-gray-200 shadow-sm
          flex flex-col justify-between gap-2 min-w-0 lg:col-span-3">
          {/* Row 1: Segmented Tab — ตารางสอน / ภาระงานครู */}
          <div className="w-full grid grid-cols-2 rounded-lg border border-gray-200 bg-gray-50 p-0.5 text-xs font-medium">
            <button
              onClick={() => onTabChange?.('timetable')}
              className={`flex items-center justify-center gap-1 px-2 py-1.5 rounded-md transition-all whitespace-nowrap
                ${activeTab === 'timetable' ? 'bg-white text-blue-700 shadow-sm font-semibold' : 'text-gray-500 hover:text-gray-700'}`}
              title="ดูตารางสอนแบบกริด"
            >
              <Calendar className="w-3.5 h-3.5 shrink-0" />
              ตารางสอน
            </button>
            <button
              onClick={() => onTabChange?.('teachers')}
              className={`flex items-center justify-center gap-1 px-2 py-1.5 rounded-md transition-all whitespace-nowrap
                ${activeTab === 'teachers' ? 'bg-white text-blue-700 shadow-sm font-semibold' : 'text-gray-500 hover:text-gray-700'}`}
              title="ดูภาระงานครูผู้สอน"
            >
              <Users className="w-3.5 h-3.5 shrink-0" />
              ภาระงานครู
            </button>
          </div>

          {/* Row 2: Metrics badge + Constraints button — split 50/50 */}
          <div className="w-full grid grid-cols-2 gap-2 text-xs">
            {metrics ? (
              <div className="relative flex items-center min-w-0">
                <MetricsBadge
                  metrics={metrics}
                  onClick={() => setMetricsPopoverOpen(!metricsPopoverOpen)}
                />
                {metricsPopoverOpen && (
                  <MetricsPopover
                    metrics={metrics}
                    onClose={() => setMetricsPopoverOpen(false)}
                  />
                )}
              </div>
            ) : (
              <span className="text-xs text-gray-400 italic px-2 py-1.5 text-center">ยังไม่มีผลลัพธ์</span>
            )}

            <button
              onClick={onOpenConstraints}
              className="inline-flex items-center justify-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold
                text-gray-700 bg-white border border-gray-300 hover:bg-gray-50 hover:border-gray-400
                transition-colors whitespace-nowrap min-w-0"
              title="เงื่อนไข & ข้อจำกัดทั้งหมด"
            >
              <SlidersHorizontal className="w-3.5 h-3.5 shrink-0" />
              เงื่อนไข
              {constraintCount > 0 && (
                <span className="ml-0.5 px-1.5 py-0.5 rounded-full bg-blue-100 text-blue-700 text-[10px] font-bold">
                  {constraintCount}
                </span>
              )}
            </button>

            <button
              onClick={onOpenSubstitutes}
              disabled={!hasResult}
              className="inline-flex items-center justify-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold
                text-orange-700 bg-orange-50 border border-orange-300 hover:bg-orange-100 hover:border-orange-400
                transition-colors whitespace-nowrap min-w-0 disabled:opacity-40 disabled:cursor-not-allowed"
              title="จัดการคาบสอนแทน (ครูที่ลา)"
            >
              <CalendarClock className="w-3.5 h-3.5 shrink-0" />
              สอนแทน
            </button>
          </div>
        </div>

        {/* ════════════════════════════════════════════════════════════════
            Card 2: Version & Storage / Export
            Top: Version dropdown + Quick Save + Cloud Save
            Bottom: Export JSON + Export Excel (dropdown)
        ════════════════════════════════════════════════════════════════ */}
        <div className="bg-white p-2.5 rounded-xl border border-gray-200 shadow-sm
          flex flex-col justify-between gap-2 min-w-0 lg:col-span-4">
          {/* Row 1: Version dropdown + Quick Save + Cloud Save */}
          <div className="flex items-stretch gap-2 flex-wrap">
            {/* Version snapshot dropdown — flexible width */}
            <div className="relative flex-1 min-w-0">
              <button
                onClick={handleToggleVersionDropdown}
                className="flex items-center gap-1.5 w-full px-2.5 py-2 rounded-lg text-xs font-semibold
                  bg-white border border-gray-300 hover:border-gray-400 hover:bg-gray-50
                  transition-colors whitespace-nowrap"
                title={dirtyText}
              >
                <FolderOpen className="w-3.5 h-3.5 text-blue-600 shrink-0" />
                <span className="truncate flex-1 text-left">
                  {activeSnapshotLabel || activeCloudTitle || 'เวอร์ชั่นที่บันทึกไว้'}
                </span>
                <span className={`text-xs shrink-0 ${dirtyColor}`}>
                  {dirtyIndicator}
                </span>
                <ChevronDown
                  className={`w-3 h-3 text-gray-500 transition-transform shrink-0
                    ${versionDropdownOpen ? 'rotate-180' : ''}`}
                />
              </button>

              {versionDropdownOpen && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setVersionDropdownOpen(false)} />
                  <div className="absolute left-0 top-full mt-1 z-50 w-80 bg-white rounded-xl
                    shadow-xl border border-gray-200 overflow-hidden">
                    <div className="px-4 py-3 border-b border-gray-100 bg-gray-50">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-bold text-gray-500 uppercase tracking-wide">
                          เวอร์ชันที่บันทึกไว้
                        </span>
                        <span className="text-xs text-gray-400">{snapshots.length} รายการ</span>
                      </div>
                    </div>

                    <div className="max-h-72 overflow-y-auto">
                      {/* ── Local snapshots (บันทึกด่วน — IndexedDB) ── */}
                      {snapshots.length === 0 ? (
                        <div className="px-4 py-6 text-center text-sm text-gray-400">
                          ยังไม่มีเวอร์ชันที่บันทึกไว้
                          <br />
                          กด "บันทึกด่วน" เพื่อเริ่ม
                        </div>
                      ) : (
                        snapshots.map((snap) => (
                          <div
                            key={snap.id}
                            className={`flex items-center gap-2 px-4 py-3 border-t border-gray-50
                              first:border-t-0 transition-colors
                              ${snap.id === activeSnapshotId ? 'bg-blue-50' : 'hover:bg-gray-50'}`}
                          >
                            <button
                              onClick={() => handleLoadSnap(snap.id)}
                              className="flex-1 text-left min-w-0"
                            >
                              <div className="flex items-center gap-2">
                                <span className="text-sm font-semibold text-gray-800 truncate">
                                  {snap.label}
                                </span>
                                {snap.id === activeSnapshotId && (
                                  <Check className="w-3.5 h-3.5 text-blue-600 shrink-0" />
                                )}
                                <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium shrink-0
                                  ${snap.status === 'final'
                                    ? 'bg-green-100 text-green-700'
                                    : 'bg-amber-100 text-amber-700'}`}>
                                  {snap.status === 'final' ? 'สมบูรณ์' : 'ร่าง'}
                                </span>
                              </div>
                              <div className="text-xs text-gray-400 mt-0.5">
                                {formatSnapshotDate(snap.updatedAt)}
                                {snap.solverPreset && ` · ${snap.solverPreset}`}
                              </div>
                            </button>
                            <button
                              onClick={(e) => { e.stopPropagation(); handleDeleteSnap(snap.id, snap.label) }}
                              className="p-1.5 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50
                                transition-colors shrink-0"
                              title="ลบเวอร์ชันนี้"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        ))
                      )}

                      {/* ── Cloud workspaces ── */}
                      <div className="px-4 pt-3 pb-1.5 border-t border-gray-100 bg-violet-50/30">
                        <div className="flex items-center justify-between">
                          <span className="text-[11px] font-bold text-violet-500 uppercase tracking-wide flex items-center gap-1">
                            <Cloud className="w-3 h-3" />
                            ตารางบนคลาวด์
                          </span>
                          <span className="text-[10px] text-gray-400">
                            {user ? `${cloudWorkspaces.length} รายการ` : 'ต้องเข้าสู่ระบบ'}
                          </span>
                        </div>
                      </div>

                      {!user ? (
                        <div className="px-4 py-3 text-center">
                          <p className="text-xs text-gray-500 mb-2">
                            เข้าสู่ระบบด้วย Google เพื่อดูตารางบนคลาวด์
                          </p>
                          <button
                            onClick={handleCloudLoginFromDropdown}
                            className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-bold
                              bg-violet-600 text-white hover:bg-violet-700 transition-colors"
                          >
                            เข้าสู่ระบบ
                          </button>
                        </div>
                      ) : cloudListLoading ? (
                        <div className="flex items-center justify-center px-4 py-4 text-xs text-gray-400">
                          <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" />
                          กำลังโหลด...
                        </div>
                      ) : cloudWorkspaces.length === 0 ? (
                        <div className="px-4 py-3 text-center text-xs text-gray-400">
                          ยังไม่มีตารางบนคลาวด์
                          <br />
                          กดปุ่ม ☁️ บันทึก เพื่อบันทึกตารางนี้ขึ้นคลาวด์
                        </div>
                      ) : (
                        cloudWorkspaces.map((ws) => (
                          <div
                            key={ws.id}
                            className={`flex items-center gap-2 px-4 py-3 border-t border-gray-50
                              transition-colors
                              ${ws.id === activeCloudWorkspaceId ? 'bg-violet-50' : 'hover:bg-gray-50'}`}
                          >
                            <button
                              onClick={() => handleLoadCloud(ws.id)}
                              disabled={cloudSyncing}
                              className="flex-1 text-left min-w-0 disabled:opacity-50"
                            >
                              <div className="flex items-center gap-2">
                                <span className="text-sm font-semibold text-gray-800 truncate">
                                  {ws.title}
                                </span>
                                {ws.id === activeCloudWorkspaceId && (
                                  <Check className="w-3.5 h-3.5 text-violet-600 shrink-0" />
                                )}
                                <span className="text-[10px] px-1.5 py-0.5 rounded-full font-medium shrink-0
                                  bg-violet-100 text-violet-700">
                                  คลาวด์
                                </span>
                              </div>
                              <div className="text-xs text-gray-400 mt-0.5">
                                {ws.updated_at
                                  ? new Date(ws.updated_at).toLocaleDateString('th-TH', {
                                      day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
                                    })
                                  : '—'}
                                {' · '}
                                ปีการศึกษา {ws.academic_year}/{ws.term}
                              </div>
                            </button>
                            <button
                              onClick={(e) => { e.stopPropagation(); handleDeleteCloud(ws.id, ws.title) }}
                              disabled={cloudSyncing}
                              className="p-1.5 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50
                                transition-colors shrink-0 disabled:opacity-50"
                              title="ลบจากคลาวด์"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                </>
              )}
            </div>

            {/* Quick Save button (local IndexedDB) */}
            <button
              onClick={() => {
                if (!activeSnapshotId) {
                  setShowSaveDialog(true)
                } else {
                  handleSaveCurrent()
                }
              }}
              disabled={!quickSaveEnabled}
              className={`flex-shrink-0 flex items-center justify-center gap-1 px-3 py-1.5 rounded-lg text-xs font-bold
                whitespace-nowrap transition-colors border
                ${quickSaveEnabled
                  ? 'bg-green-600 text-white hover:bg-green-700 border-green-700'
                  : 'bg-gray-100 text-gray-400 cursor-not-allowed border-gray-200'}`}
              title={!activeSnapshotId
                ? 'ยังไม่มีเวอร์ชัน — กดเพื่อสร้างใหม่'
                : isSnapshotDirty
                  ? 'บันทึกทับเวอร์ชันปัจจุบัน'
                  : 'ไม่มีการเปลี่ยนแปลงที่ต้องบันทึก'}
            >
              <Save className="w-3.5 h-3.5 shrink-0" />
              <span className="hidden sm:inline">บันทึกด่วน</span>
            </button>

            {/* Cloud Save button */}
            <button
              onClick={handleSaveToCloud}
              disabled={cloudSyncing}
              className={`flex-shrink-0 flex items-center justify-center gap-1 px-3 py-1.5 rounded-lg text-xs font-bold
                whitespace-nowrap transition-colors border
                ${user
                  ? 'bg-purple-600 text-white hover:bg-purple-700 shadow-sm border-purple-700'
                  : 'bg-gray-100 text-gray-400 hover:bg-gray-200 border-gray-200'}`}
              title={user
                ? (activeCloudWorkspaceId ? 'บันทึกทับบนคลาวด์' : 'บันทึกขึ้นคลาวด์ (สร้างใหม่)')
                : 'เข้าสู่ระบบด้วย Google เพื่อบันทึกขึ้นคลาวด์'}
            >
              {cloudSyncing ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" />
              ) : (
                <Cloud className="w-3.5 h-3.5 shrink-0" />
              )}
              <span className="hidden sm:inline whitespace-nowrap">
                {activeCloudWorkspaceId ? '☁️ บันทึก' : '☁️ บันทึก'}
              </span>
              {!user && (
                <span className="hidden lg:inline-flex items-center text-[9px] font-bold px-1 py-0.5 rounded-full bg-amber-100 text-amber-700 shrink-0">
                  login
                </span>
              )}
            </button>
          </div>

          {/* Row 2: Export JSON + Export Excel (dropdown) */}
          <div className="grid grid-cols-2 gap-2">
            {/* Export JSON */}
            <button
              onClick={handleExport}
              disabled={!activeSnapshotId && !snapshots.length}
              className="flex items-center justify-center gap-1 px-2 py-1.5 rounded-lg text-xs font-medium
                whitespace-nowrap text-gray-700 bg-white border border-gray-300 hover:bg-gray-50
                transition-colors min-w-0 disabled:opacity-40 disabled:cursor-not-allowed"
              title="ส่งออกไฟล์ .json (สำรองข้อมูล)"
            >
              <Download className="w-3.5 h-3.5 shrink-0" />
              <span className="truncate">ส่งออก JSON</span>
            </button>

            {/* Export Excel dropdown */}
            <div className="relative min-w-0">
              <button
                onClick={() => setExcelDropdownOpen(!excelDropdownOpen)}
                disabled={exporting || exportDisabled}
                className="flex items-center justify-center gap-1 w-full px-2 py-1.5
                  bg-emerald-600 hover:bg-emerald-700 text-white
                  rounded-lg font-bold text-xs shadow-sm
                  transition-colors border border-emerald-700
                  disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap min-w-0"
                title="ส่งออกไฟล์ Excel"
              >
                {exporting ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" />
                ) : (
                  <FileSpreadsheet className="w-3.5 h-3.5 shrink-0" />
                )}
                <span className="truncate">ส่งออก Excel</span>
                <ChevronDown
                  className={`w-3 h-3 transition-transform shrink-0
                    ${excelDropdownOpen ? 'rotate-180' : ''}`}
                />
              </button>

              {excelDropdownOpen && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setExcelDropdownOpen(false)} />
                  <div className="absolute right-0 top-full mt-1 z-50 w-64 bg-white rounded-xl shadow-xl
                    border border-gray-200 overflow-hidden">
                    <ClearOption
                      icon="⚡"
                      title="ส่งออกด่วน"
                      desc="1 ชีท ฟอร์แมตเดียวกับเทมเพลต — นำกลับเข้า import ได้"
                      disabled={exporting || exportDisabled}
                      onClick={() => { onQuickExport?.(); setExcelDropdownOpen(false) }}
                    />
                    <ClearOption
                      icon="🎨"
                      title="ส่งออกแบบกำหนดเอง"
                      desc="หลายชีท + เงื่อนไขครู + กิจกรรมล็อก (เปิด modal)"
                      disabled={exporting || exportDisabled}
                      onClick={() => { onAdvancedExport?.(); setExcelDropdownOpen(false) }}
                    />
                  </div>
                </>
              )}
            </div>
          </div>
        </div>

        {/* ════════════════════════════════════════════════════════════════
            Card 3: Auto Solver Engine
            Left (stacked): Preset dropdown (top) + Clear/Pin buttons (bottom)
            Right: Large primary generate button (full height)
        ════════════════════════════════════════════════════════════════ */}
        <div className={`bg-white p-2.5 rounded-xl border border-gray-200 shadow-sm
          grid grid-cols-[1.2fr_1fr] gap-2 min-w-0 lg:col-span-3
          ${isTeacherTab ? 'opacity-50 pointer-events-none' : ''}`}>
          {/* ── Left column: Controls (stacked) ── */}
          <div className="flex flex-col gap-1.5 justify-between min-w-0">
            {/* Top: Solver Preset Dropdown */}
            <div className="relative">
              <button
                onClick={() => setPresetDropdownOpen(!presetDropdownOpen)}
                disabled={isGenerating}
                className={`flex items-center gap-1.5 w-full px-2.5 py-1.5 rounded-md text-xs font-medium border transition-all
                  bg-white border-gray-300 hover:border-gray-400 hover:bg-gray-50
                  ${isGenerating ? 'opacity-50 cursor-not-allowed' : ''}`}
              >
                <span className="text-xs leading-none shrink-0" aria-hidden>
                  {currentPreset.icon}
                </span>
                <span className="font-semibold text-gray-800 flex-1 text-left truncate text-xs">
                  {currentPreset.shortName}
                </span>
                <span className="text-[10px] text-gray-500 shrink-0 whitespace-nowrap">
                  (~{currentPreset.timeLimit}วิ)
                </span>
                <ChevronDown
                  className={`w-3 h-3 text-gray-500 transition-transform shrink-0
                    ${presetDropdownOpen ? 'rotate-180' : ''}`}
                />
              </button>

              {presetDropdownOpen && (
                <>
                  <div
                    className="fixed inset-0 z-40"
                    onClick={() => setPresetDropdownOpen(false)}
                  />
                  <div className="absolute left-0 top-full mt-1 z-50 w-80 bg-white rounded-xl
                    shadow-xl border border-gray-200 overflow-hidden">
                    {Object.values(SOLVER_PRESETS).map((preset) => (
                      <PresetOption
                        key={preset.id}
                        preset={preset}
                        timeHint={presetTimeHint(preset)}
                        isActive={preset.id === currentPreset.id}
                        onClick={() => handlePresetSelect(preset.id)}
                      />
                    ))}
                  </div>
                </>
              )}
            </div>

            {/* Bottom: Pin + Clear side by side */}
            <div className="grid grid-cols-2 gap-1">
              {/* Pin dropdown */}
              <div className="relative">
                <button
                  onClick={() => setPinDropdownOpen(!pinDropdownOpen)}
                  className="flex items-center justify-center gap-0.5 w-full px-1.5 py-1 text-xs font-medium text-gray-600
                    bg-white border border-gray-300 hover:bg-gray-100 rounded-md transition-colors whitespace-nowrap"
                  title="ปักหมุด / ล็อกตำแหน่ง"
                >
                  📌
                  <span className="truncate">ปักหมุด</span>
                  <ChevronDown
                    className={`w-2.5 h-2.5 transition-transform shrink-0
                      ${pinDropdownOpen ? 'rotate-180' : ''}`}
                  />
                </button>

                {pinDropdownOpen && (
                  <>
                    <div
                      className="fixed inset-0 z-40"
                      onClick={() => setPinDropdownOpen(false)}
                    />
                    <div className="absolute left-0 top-full mt-1 z-50 w-72 bg-white rounded-xl shadow-xl
                      border border-gray-200 overflow-hidden">
                      <ClearOption
                        icon="🤖"
                        title="ล็อกเฉพาะที่ AI เพิ่งจัด"
                        desc="ปักหมุดผลลัพธ์จาก Solver ทั้งหมด (Pin All AI)"
                        disabled={!hasResult}
                        onClick={() => { onPinAllSolver?.(); setPinDropdownOpen(false) }}
                      />
                      <ClearOption
                        icon="🔓"
                        title="ปลดล็อกหมุดทั้งหมด"
                        desc="นำการ์ด 📌 ออกทั้งหมด คงผลจัดของ Solver ไว้"
                        disabled={!hasPlacements}
                        onClick={() => { onUnpinAll?.(); setPinDropdownOpen(false) }}
                      />
                      <ClearOption
                        icon="👤"
                        title="ปักหมุดตามครู..."
                        desc="เลือกครูเพื่อล็อกผล AI ของครูท่านนั้นทั้งหมด"
                        disabled={teachers.length === 0 || !hasResult}
                        onClick={() => openConfirm('pinTeacher')}
                      />
                      <ClearOption
                        icon="🏫"
                        title="ปักหมุดตามห้อง..."
                        desc="เลือกห้องเพื่อล็อกผล AI ของห้องเรียนนั้นทั้งหมด"
                        disabled={classes.length === 0 || !hasResult}
                        onClick={() => openConfirm('pinClass')}
                      />
                      <ClearOption
                        icon="🔓👤"
                        title="ปลดล็อกตามครู..."
                        desc="เลือกครูเพื่อปลดหมุดของครูท่านนั้นทั้งหมด"
                        disabled={teachers.length === 0 || !hasPlacements}
                        onClick={() => openConfirm('unpinTeacher')}
                      />
                      <ClearOption
                        icon="🔓🏫"
                        title="ปลดล็อกตามห้อง..."
                        desc="เลือกห้องเพื่อปลดหมุดของห้องเรียนนั้นทั้งหมด"
                        disabled={classes.length === 0 || !hasPlacements}
                        onClick={() => openConfirm('unpinClass')}
                      />
                    </div>
                  </>
                )}
              </div>

              {/* Clear dropdown */}
              <div className="relative">
                <button
                  onClick={() => setClearDropdownOpen(!clearDropdownOpen)}
                  className="flex items-center justify-center gap-0.5 w-full px-1.5 py-1 text-xs font-medium text-gray-600
                    bg-white border border-gray-300 hover:bg-gray-100 rounded-md transition-colors whitespace-nowrap"
                  title="ล้างตาราง"
                >
                  🗑️
                  <span className="truncate">ล้างข้อมูล</span>
                  <ChevronDown
                    className={`w-2.5 h-2.5 transition-transform shrink-0
                      ${clearDropdownOpen ? 'rotate-180' : ''}`}
                  />
                </button>

                {clearDropdownOpen && (
                  <>
                    <div
                      className="fixed inset-0 z-40"
                      onClick={() => setClearDropdownOpen(false)}
                    />
                    <div className="absolute left-0 top-full mt-1 z-50 w-72 bg-white rounded-xl shadow-xl
                      border border-gray-200 overflow-hidden">
                      <ClearOption
                        icon="📌"
                        title="ล้างเฉพาะวิชาที่วางด้วยมือ"
                        desc="นำการ์ด 📌 กลับคลังวิชา โดยไม่ลบผลจัดอัตโนมัติ"
                        disabled={!hasPlacements}
                        onClick={() => openConfirm('manual')}
                      />
                      <ClearOption
                        icon="🤖"
                        title="ล้างเฉพาะที่ AI จัด (เก็บหมุดไว้)"
                        desc="ลบเฉพาะผล 🚀 ที่ไม่ได้ปักหมุด คงการ์ด 📌 ไว้"
                        disabled={!hasResult}
                        onClick={() => { onClearSolverOnly?.(); setClearDropdownOpen(false) }}
                      />
                      <ClearOption
                        icon="🚀"
                        title="ล้างเฉพาะวิชาที่ระบบจัดอัตโนมัติ"
                        desc="คงการ์ด 📌 ไว้ ลบเฉพาะผล 🚀 จาก Solver ทั้งหมด"
                        disabled={!hasResult}
                        onClick={() => openConfirm('solver')}
                      />
                      <ClearOption
                        icon="🔄"
                        title="ล้างทั้งหมดกลับเป็นตารางเปล่า"
                        desc="ลบทั้ง 📌 และ 🚀 คงไว้เฉพาะ 🔒 กิจกรรมล็อก"
                        danger
                        disabled={!hasResult && !hasPlacements}
                        onClick={() => openConfirm('all')}
                      />
                      <ClearOption
                        icon="👤"
                        title="ล้างเฉพาะตารางของครู..."
                        desc="เลือกครูเพื่อลบเฉพาะวิชาที่ครูท่านนั้นสอน"
                        disabled={teachers.length === 0}
                        onClick={() => openConfirm('teacher')}
                      />
                      <ClearOption
                        icon="🏫"
                        title="ล้างเฉพาะตารางของห้อง..."
                        desc="เลือกห้องเพื่อลบเฉพาะวิชาของห้องเรียนนั้น"
                        disabled={classes.length === 0}
                        onClick={() => openConfirm('class')}
                      />
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>

          {/* ── Right column: Large primary generate button (full height) ── */}
          <button
            onClick={onGenerate}
            disabled={isGenerating || disabled}
            className="flex flex-col justify-center items-center gap-1.5 px-4 py-2
              bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-lg shadow-sm text-sm
              disabled:opacity-50 disabled:cursor-not-allowed transition-colors whitespace-nowrap
              min-w-[120px]"
          >
            {isGenerating ? (
              <>
                <Loader2 className="w-6 h-6 animate-spin" />
                <span className="text-xs">กำลังจัด...</span>
              </>
            ) : (
              <>
                <Rocket className="w-6 h-6" />
                <span className="text-sm leading-tight">จัดอัตโนมัติ</span>
              </>
            )}
          </button>
        </div>

        {/* ════════════════════════════════════════════════════════════════
            Card 4: Print Studio CTA
            Single full-height dark button
        ════════════════════════════════════════════════════════════════ */}
        <button
          onClick={onNavigatePrintStudio}
          className="h-full flex items-center justify-center text-center gap-2 p-2
            bg-gradient-to-br from-slate-700 to-slate-900 text-white
            rounded-xl font-bold text-sm shadow-md
            hover:from-slate-800 hover:to-black
            transition-all border border-slate-600
            active:scale-[0.98] whitespace-nowrap min-w-0 lg:col-span-2"
          title="เปิดหน้า Print Studio เพื่อจัดพิมพ์และส่งออกเอกสาร"
        >
          <Printer className="w-5 h-5 shrink-0" />
          <span className="truncate">จัดพิมพ์ Print Studio</span>
          <span className="text-base shrink-0">→</span>
        </button>
      </div>

      {/* ── Confirmation Modal ─────────────────────────────────────── */}
      {showConfirm && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center">
          <div className="absolute inset-0 bg-black/40" onClick={handleCancel} />
          <div className="relative bg-white rounded-2xl shadow-2xl p-6 max-w-sm w-full mx-4">
            <h3 className="text-lg font-bold text-gray-900 mb-3">ยืนยันการล้างข้อมูล</h3>
            <p className="text-sm text-gray-600">{confirmMessage}</p>
            {selectedClassName && (
              <p className="text-sm text-gray-500 mt-1">ของ {selectedClassName}</p>
            )}

            {(pendingAction === 'teacher' || pendingAction === 'pinTeacher' || pendingAction === 'unpinTeacher') && (
              <select
                value={selectedTeacherId || ''}
                onChange={(e) => setSelectedTeacherId(e.target.value)}
                className="w-full mt-3 text-sm border border-gray-300 rounded-lg px-3 py-2 bg-white
                  focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              >
                <option value="" disabled>-- เลือกครู --</option>
                {teachers.map((t) => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>
            )}

            {(pendingAction === 'class' || pendingAction === 'pinClass' || pendingAction === 'unpinClass') && (
              <select
                value={selectedClassId || ''}
                onChange={(e) => setSelectedClassId(e.target.value)}
                className="w-full mt-3 text-sm border border-gray-300 rounded-lg px-3 py-2 bg-white
                  focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              >
                <option value="" disabled>-- เลือกห้อง --</option>
                {classes.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            )}

            <div className="flex gap-3 mt-5">
              <button
                onClick={handleCancel}
                className="flex-1 px-4 py-2.5 text-sm font-medium text-gray-700 bg-gray-100
                  hover:bg-gray-200 rounded-xl transition-colors"
              >
                ยกเลิก
              </button>
              <button
                onClick={handleConfirm}
                disabled={confirmDisabled}
                className={`flex-1 px-4 py-2.5 text-sm font-bold text-white rounded-xl transition-colors
                  ${confirmDisabled
                    ? 'bg-gray-300 cursor-not-allowed'
                    : pendingAction?.startsWith('pin') || pendingAction?.startsWith('unpin')
                      ? 'bg-amber-600 hover:bg-amber-700'
                      : 'bg-rose-600 hover:bg-rose-700'}`}
              >
                {pendingAction?.startsWith('pin') || pendingAction?.startsWith('unpin')
                  ? 'ยืนยันดำเนินการ'
                  : 'ยืนยันล้างข้อมูล'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Save New Snapshot Dialog ──────────────────────────────── */}
      {showSaveDialog && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center">
          <div className="absolute inset-0 bg-black/40" onClick={() => setShowSaveDialog(false)} />
          <div className="relative bg-white rounded-2xl shadow-2xl p-6 max-w-sm w-full mx-4">
            <h3 className="text-lg font-bold text-gray-900 mb-3">บันทึกเวอร์ชันใหม่</h3>
            <input
              type="text"
              value={saveLabel}
              onChange={(e) => setSaveLabel(e.target.value)}
              placeholder={generateLabel(snapshots.length)}
              autoFocus
              onKeyDown={(e) => { if (e.key === 'Enter') handleSaveNew() }}
              className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg
                focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            />
            <div className="flex gap-3 mt-5">
              <button
                onClick={() => setShowSaveDialog(false)}
                className="flex-1 px-4 py-2.5 text-sm font-medium text-gray-700 bg-gray-100
                  hover:bg-gray-200 rounded-xl transition-colors"
              >
                ยกเลิก
              </button>
              <button
                onClick={handleSaveNew}
                className="flex-1 px-4 py-2.5 text-sm font-bold text-white bg-blue-600
                  hover:bg-blue-700 rounded-xl transition-colors"
              >
                บันทึก
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Toast ─────────────────────────────────────────────────── */}
      {toast && (
        <div className={`fixed bottom-20 left-1/2 -translate-x-1/2 z-[110] px-4 py-2.5
          rounded-xl shadow-lg text-sm font-medium flex items-center gap-2
          ${toast.type === 'ok' ? 'bg-green-600 text-white' : 'bg-red-600 text-white'}`}>
          {toast.type === 'ok'
            ? <Check className="w-4 h-4" />
            : <AlertCircle className="w-4 h-4" />}
          {toast.msg}
        </div>
      )}
    </>
  )
}
