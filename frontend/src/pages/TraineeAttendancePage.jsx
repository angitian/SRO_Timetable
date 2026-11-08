import { Fragment, useEffect, useMemo, useState } from 'react'
import {
  AlertTriangle, Check, ChevronDown, ChevronRight, Cloud, CloudOff,
  GraduationCap, Loader2, Lock, Printer, RefreshCw, Shield, Trash2,
} from 'lucide-react'
import { useApp } from '../context/AppContext.jsx'
import useTraineeWorkspace from '../hooks/useTraineeWorkspace.js'
import {
  STATUSES, STATUS_META, buildReference, buildSummaryCSV, bulkPresent,
  downloadText, formatThaiDate, getRange, historyForTrainee,
  mergeTraineeRows, rangeLabel, removeDailyRecord, removeTraineeRecords,
  mentorDisplayLine, normalizeTime24, setDailyRecord, statsForTrainee,
  summarizeDay, summarizeRange, todayISO, traineeTeachingLines,
} from '../utils/traineeAttendance.js'
import TraineeDirectoryPage from '../features/trainees/TraineeDirectoryPage.jsx'
import TraineeImportModal from '../features/trainees/TraineeImportModal.jsx'
import TraineeAccessDialog from '../features/trainees/TraineeAccessDialog.jsx'
import TraineeDashboard from '../features/trainees/TraineeDashboard.jsx'
import TraineePrintStudio from '../features/trainees/TraineePrintStudio.jsx'
import TraineeDateField from '../features/trainees/TraineeDateField.jsx'
import { downloadTraineeTemplate } from '../utils/traineeExcelTemplate.js'

const MODES = [
  { value: 'day', label: 'รายวัน' },
  { value: 'week', label: 'รายสัปดาห์' },
  { value: 'month', label: 'รายเดือน' },
  { value: 'semester', label: 'รายภาคเรียน' },
]

function SummaryCard({ label, value, tone }) {
  const tones = {
    slate: 'bg-white border-slate-200 text-slate-800',
    emerald: 'bg-emerald-50 border-emerald-100 text-emerald-700',
    amber: 'bg-amber-50 border-amber-100 text-amber-700',
    blue: 'bg-blue-50 border-blue-100 text-blue-700',
    rose: 'bg-rose-50 border-rose-100 text-rose-700',
  }
  return (
    <div className={`rounded-lg border px-3 py-1.5 text-center min-w-[86px] ${tones[tone] || tones.slate}`}>
      <div className="text-[11px] font-semibold opacity-80 leading-4">{label}</div>
      <div className="text-xl font-bold leading-6 mt-0.5">{value}</div>
    </div>
  )
}

function SyncBadge({ cloudEnabled, syncState }) {
  if (!cloudEnabled) {
    return (
      <span className="inline-flex items-center gap-1 text-[11px] font-medium text-slate-500 bg-slate-100 rounded-full px-2.5 py-1">
        <CloudOff className="w-3 h-3" /> บันทึกในเครื่องนี้
      </span>
    )
  }
  const map = {
    saving: { icon: Loader2, text: 'กำลังบันทึก…', cls: 'text-blue-600 bg-blue-50', spin: true },
    saved: { icon: Cloud, text: 'บันทึกคลาวด์แล้ว', cls: 'text-emerald-600 bg-emerald-50' },
    offline: { icon: CloudOff, text: 'ออฟไลน์ — รอบันทึก', cls: 'text-amber-600 bg-amber-50' },
    error: { icon: AlertTriangle, text: 'บันทึกไม่สำเร็จ', cls: 'text-rose-600 bg-rose-50' },
    conflict: { icon: AlertTriangle, text: 'มีข้อมูลชนกัน', cls: 'text-rose-600 bg-rose-50' },
    idle: { icon: Cloud, text: 'พร้อมบันทึก', cls: 'text-slate-500 bg-slate-100' },
  }
  const s = map[syncState] || map.idle
  const Icon = s.icon
  return (
    <span className={`inline-flex items-center gap-1 text-[11px] font-medium rounded-full px-2.5 py-1 ${s.cls}`}>
      <Icon className={`w-3 h-3 ${s.spin ? 'animate-spin' : ''}`} /> {s.text}
    </span>
  )
}

export default function TraineeAttendancePage() {
  const {
    activeWorkspace, activeTraineeWorkspace, fixtureData, user,
    canEditWorkspace, setStep,
  } = useApp()

  const timetableId = activeTraineeWorkspace?.timetableId || activeWorkspace?.id || null
  const cloudEnabled = activeTraineeWorkspace
    ? true
    : activeWorkspace?.kind === 'cloud' && !!user
  const localCanEdit = activeTraineeWorkspace
    ? ['owner', 'editor'].includes(activeTraineeWorkspace.myTraineeRole)
    : canEditWorkspace

  const liveReference = useMemo(() => {
    const sameWorkspace = !activeTraineeWorkspace || activeWorkspace?.id === activeTraineeWorkspace.timetableId
    if (!fixtureData || !sameWorkspace) return null
    return buildReference(fixtureData, {
      title: activeWorkspace?.title || activeTraineeWorkspace?.linkedTimetableTitle || '',
      academicYear: 2569,
      term: 2,
    })
  }, [fixtureData, activeWorkspace?.id, activeWorkspace?.title, activeTraineeWorkspace?.timetableId, activeTraineeWorkspace?.linkedTimetableTitle])

  const workspace = useTraineeWorkspace(timetableId, {
    cloudEnabled,
    canEdit: localCanEdit,
    initialReference: null,
  })

  const [dateKey, setDateKey] = useState(() => todayISO())
  const [mode, setMode] = useState('day')
  const [expanded, setExpanded] = useState(new Set())
  const [showImport, setShowImport] = useState(false)
  const [showAccess, setShowAccess] = useState(false)
  const [notice, setNotice] = useState('')
  const [moduleTab, setModuleTab] = useState('attendance')
  const [printInitialType, setPrintInitialType] = useState('daily')

  const data = workspace.data || {}
  const reference = data.reference || liveReference
  const trainees = useMemo(
    () => (data.trainees || []).filter((t) => !t.archived),
    [data.trainees],
  )
  const traineeIds = useMemo(() => trainees.map((t) => t.id), [trainees])
  const range = useMemo(() => getRange(dateKey, mode, reference), [dateKey, mode, reference])
  const stats = useMemo(
    () => (mode === 'day'
      ? summarizeDay(data.attendance, dateKey, traineeIds)
      : summarizeRange(data.attendance, range, traineeIds)),
    [mode, data.attendance, dateKey, range, traineeIds],
  )
  const dayRecords = data.attendance?.[dateKey] || {}

  useEffect(() => {
    if (!workspace.loading && workspace.canEdit && liveReference && !data.reference) {
      workspace.mutate((prev) => ({ ...prev, reference: liveReference }))
    }
  }, [workspace.loading, workspace.canEdit, liveReference, data.reference, workspace])

  useEffect(() => {
    if (!notice) return
    const timer = setTimeout(() => setNotice(''), 3500)
    return () => clearTimeout(timer)
  }, [notice])

  function toggleExpanded(id) {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function updateRecord(traineeId, patch) {
    if (!workspace.canEdit) return
    workspace.mutate((prev) => ({
      ...prev,
      attendance: setDailyRecord(prev.attendance, dateKey, traineeId, {
        ...patch,
        updatedBy: user?.id || null,
      }),
    }))
  }

  function deleteRecord(traineeId, name) {
    if (!workspace.canEdit) return
    if (!confirm(`ลบรายการลงเวลาของ ${name} วันที่ ${formatThaiDate(dateKey)}?`)) return
    workspace.mutate((prev) => ({
      ...prev,
      attendance: removeDailyRecord(prev.attendance, dateKey, traineeId),
    }))
    setNotice('ลบรายการของวันนี้แล้ว')
  }

  function handleBulkPresent() {
    if (!workspace.canEdit || trainees.length === 0) return
    if (!confirm(`ยืนยันตั้งสถานะ "ปกติ" ให้ ${trainees.length} คน วันที่ ${formatThaiDate(dateKey)}?`)) return
    if (mode !== 'day') setMode('day')
    workspace.mutate((prev) => ({
      ...prev,
      attendance: bulkPresent(prev.attendance, dateKey, traineeIds, user?.id || null),
    }))
    setNotice(`ตั้งค่าปกติให้ ${trainees.length} คนแล้ว`)
  }

  function handleSaveTrainee(t) {
    workspace.mutate((prev) => {
      const exists = (prev.trainees || []).some((x) => x.id === t.id)
      const next = exists
        ? prev.trainees.map((x) => (x.id === t.id ? { ...x, ...t } : x))
        : [...(prev.trainees || []), t]
      return { ...prev, trainees: next }
    })
    setNotice('บันทึกข้อมูลนักศึกษาแล้ว')
  }

  function handleArchive(id, archived) {
    workspace.mutate((prev) => ({
      ...prev,
      trainees: (prev.trainees || []).map((t) => (t.id === id ? { ...t, archived: !!archived } : t)),
    }))
    setNotice(archived ? 'เก็บรายชื่อออกจากรายการแล้ว' : 'นำรายชื่อกลับมาใช้แล้ว')
  }

  function handleDeleteTrainee(t) {
    if (!workspace.canEdit) return
    if (!confirm(`ลบถาวร ${t.name} และประวัติลงเวลาของรายนี้? ไม่สามารถกู้คืนได้`)) return
    workspace.mutate((prev) => ({
      ...prev,
      trainees: (prev.trainees || []).filter((x) => x.id !== t.id),
      attendance: removeTraineeRecords(prev.attendance, t.id),
    }))
    setNotice('ลบรายชื่อและประวัติลงเวลาแล้ว')
  }

  function handleImport(rows) {
    workspace.mutate((prev) => {
      const merged = mergeTraineeRows(prev.trainees || [], rows)
      return {
        ...prev,
        reference: prev.reference || liveReference,
        trainees: merged.trainees,
      }
    })
    setNotice(`นำเข้ารายชื่อแล้ว`)
  }

  function handleExportCSV() {
    const csv = buildSummaryCSV({ trainees, attendance: data.attendance || {}, range, reference })
    downloadText(`นักศึกษาฝึกสอน_${range.start}_${range.end}.csv`, csv)
  }

  function refreshReference() {
    if (!liveReference || !workspace.canEdit) return
    workspace.mutate((prev) => ({ ...prev, reference: liveReference }))
    setNotice('อัปเดตข้อมูลอ้างอิงจาก workspace แล้ว')
  }

  if (!timetableId) {
    return (
      <div className="max-w-3xl mx-auto py-20 text-center space-y-4">
        <div className="w-16 h-16 rounded-full bg-violet-50 flex items-center justify-center mx-auto">
          <GraduationCap className="w-8 h-8 text-violet-300" />
        </div>
        <h2 className="text-xl font-bold text-slate-800">ยังไม่มีงานปัจจุบัน</h2>
        <p className="text-sm text-slate-500">เลือก workspace หรือเปิดโมดูลนักศึกษาจากหน้าแรกก่อน</p>
        <button onClick={() => setStep(0)} className="px-4 py-2 rounded-lg text-sm font-semibold bg-violet-600 text-white hover:bg-violet-700">
          กลับหน้าแรก
        </button>
      </div>
    )
  }

  if (workspace.loading) {
    return (
      <div className="flex items-center justify-center py-24 text-slate-400">
        <Loader2 className="w-6 h-6 animate-spin mr-2" /> กำลังโหลดโมดูลนักศึกษา…
      </div>
    )
  }

  if (workspace.role === 'none' && !workspace.canEdit) {
    return (
      <div className="max-w-3xl mx-auto py-20 text-center space-y-4">
        <Lock className="w-10 h-10 text-slate-300 mx-auto" />
        <h2 className="text-xl font-bold text-slate-800">ไม่มีสิทธิ์เข้าถึงโมดูลนี้</h2>
        <p className="text-sm text-slate-500">ขอสิทธิ์จากเจ้าของโมดูล หรือเปิด workspace ที่คุณมีสิทธิ์</p>
        <button onClick={() => setStep(0)} className="px-4 py-2 rounded-lg text-sm font-semibold bg-slate-700 text-white hover:bg-slate-800">
          กลับหน้าแรก
        </button>
      </div>
    )
  }

  const title = activeTraineeWorkspace?.linkedTimetableTitle || activeWorkspace?.title || activeTraineeWorkspace?.title || 'โมดูลนักศึกษา'
  const canEdit = workspace.canEdit

  return (
    <div className="trainee-print space-y-5 pb-24">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3 min-w-0">
          <div className="w-11 h-11 rounded-xl bg-violet-50 ring-1 ring-violet-100 flex items-center justify-center shrink-0">
            <GraduationCap className="w-5 h-5 text-violet-600" />
          </div>
          <div className="min-w-0">
            <h1 className="text-xl sm:text-2xl font-bold text-slate-900">ระบบตรวจการลงเวลาปฏิบัติงาน</h1>
            <p className="text-xs text-slate-400 mt-0.5">ตาราง: {title}</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 print:hidden">
          <SyncBadge cloudEnabled={cloudEnabled} syncState={workspace.syncState} />
          {workspace.role === 'owner' && cloudEnabled && (
            <button onClick={() => setShowAccess(true)} className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold text-violet-700 bg-violet-50 hover:bg-violet-100">
              <Shield className="w-3.5 h-3.5" /> สิทธิ์โมดูล
            </button>
          )}
          <div className="flex flex-wrap gap-1" role="tablist" aria-label="ส่วนงานนักศึกษา">
            {[
              { value: 'attendance', label: 'ลงเวลา' },
              { value: 'directory', label: 'จัดการข้อมูล' },
              { value: 'dashboard', label: 'Dashboard' },
            ].map((tab) => (
              <button
                key={tab.value}
                role="tab"
                aria-selected={moduleTab === tab.value}
                onClick={() => setModuleTab(tab.value)}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                  moduleTab === tab.value ? 'bg-violet-600 text-white shadow-sm' : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
          <button
            onClick={() => {
              setPrintInitialType('daily')
              setModuleTab('print')
            }}
            aria-pressed={moduleTab === 'print'}
            className={`flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
              moduleTab === 'print'
                ? 'bg-slate-900 text-white'
                : 'text-slate-700 bg-white border border-slate-300 hover:bg-slate-50'
            }`}
          >
            <Printer className="w-3.5 h-3.5" /> พิมพ์รายงาน
          </button>
        </div>
      </div>

      {(workspace.error || workspace.conflict) && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800 flex flex-wrap items-center gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <span className="flex-1">{workspace.error}</span>
          {workspace.conflict && (
            <>
              <button onClick={workspace.useServerCopy} className="px-2.5 py-1 rounded-lg text-xs font-semibold bg-white border border-rose-200 hover:bg-rose-100">
                ใช้ข้อมูลคลาวด์
              </button>
              <button onClick={workspace.overwriteServer} className="px-2.5 py-1 rounded-lg text-xs font-semibold bg-rose-600 text-white hover:bg-rose-700">
                บันทึกทับ
              </button>
            </>
          )}
        </div>
      )}

      {notice && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[140] px-5 py-2.5 rounded-xl bg-slate-900 text-white text-sm shadow-lg">
          {notice}
        </div>
      )}

      {moduleTab === 'attendance' && (
        <>
      {/* Controls */}
      <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm print:hidden">
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-xs font-semibold text-slate-600">
            วันที่อ้างอิง
            <TraineeDateField
              value={dateKey}
              onChange={(value) => setDateKey(value || todayISO())}
              className="mt-1 block"
            />
          </label>
          <button
            onClick={handleBulkPresent}
            disabled={!canEdit || trainees.length === 0}
            className="flex items-center gap-1 px-4 py-2 rounded-xl text-xs font-bold bg-emerald-600 text-white shadow-sm hover:bg-emerald-700 disabled:opacity-40"
          >
            <Check className="w-3.5 h-3.5" /> เช็กชื่อปกติทุกคน
          </button>
          <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="ช่วงเวลาสรุป">
            {MODES.map((m) => (
              <button
                key={m.value}
                role="tab"
                aria-selected={mode === m.value}
                onClick={() => setMode(m.value)}
                className={`px-4 py-2 rounded-xl text-sm font-semibold transition-colors ${
                  mode === m.value ? 'bg-violet-600 text-white shadow-sm' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                {m.label}
              </button>
            ))}
          </div>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            {liveReference && workspace.canEdit && (
              <button onClick={refreshReference} className="p-2 rounded-lg text-slate-400 hover:text-violet-600 hover:bg-violet-50" title="รีเฟรชข้อมูลอ้างอิงจาก workspace">
                <RefreshCw className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>
        {!canEdit && (
          <p className="mt-3 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
            คุณมีสิทธิ์อ่านโมดูลนี้เท่านั้น — การแก้ไขสถานะ/รายชื่อถูกปิดใช้งาน
          </p>
        )}
      </section>

      {/* Summary */}
      <section>
        <div className="flex flex-wrap items-center gap-3 mb-2">
          <div className="min-w-[220px]">
            <h2 className="text-lg font-bold text-slate-900">ตารางการปฏิบัติงานนักศึกษา</h2>
            <p className="text-xs text-slate-500">{rangeLabel(dateKey, mode, reference)} · {trainees.length} คน</p>
          </div>
          <div className="flex flex-wrap items-center gap-1.5 ml-auto">
            <SummaryCard label="รายการที่บันทึก" value={stats.total} tone="slate" />
            <SummaryCard label="ปกติ" value={stats.present} tone="emerald" />
            <SummaryCard label="สาย" value={stats.late} tone="amber" />
            <SummaryCard label="ลา" value={stats.leave} tone="blue" />
            <SummaryCard label="ขาด" value={stats.absent} tone="rose" />
          </div>
        </div>
        <p className="text-[11px] text-slate-400">* สรุปเฉพาะรายการที่บันทึกไว้ในระบบ วันที่ยังไม่บันทึกไม่นับรวมเป็นวันขาด</p>
      </section>

      {/* Table */}
      <section className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1360px] text-sm">
            <thead className="bg-slate-100 text-slate-600 border-b border-slate-200">
              <tr>
                <th className="p-3 w-14 text-center font-medium">ลำดับ</th>
                <th className="p-3 text-left font-medium">ชื่อ–นามสกุล</th>
                <th className="p-3 text-left w-36 font-medium">ครูพี่เลี้ยง</th>
                <th className="p-3 text-left w-64 font-medium">วิชา / ชั้น / ห้อง</th>
                <th className="p-3 text-center w-40 font-medium">สถานะ{mode === 'day' ? 'ประจำวัน' : 'ช่วงเวลา'}</th>
                <th className="p-3 text-center w-24 font-medium">เวลา</th>
                <th className="p-3 text-left w-48 font-medium">หมายเหตุ</th>
                <th className="p-3 text-center w-14 font-medium text-emerald-700">ปกติ</th>
                <th className="p-3 text-center w-14 font-medium text-amber-700">สาย</th>
                <th className="p-3 text-center w-14 font-medium text-blue-700">ลา</th>
                <th className="p-3 text-center w-14 font-medium text-rose-700">ขาด</th>
                <th className="p-3 text-center w-14 font-medium text-slate-700">รวม</th>
                <th className="p-3 text-center w-24 font-medium">ประวัติ</th>
                <th className="p-3 text-center w-16 font-medium">จัดการ</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {trainees.length === 0 ? (
                <tr>
                  <td colSpan={14} className="p-10 text-center text-slate-400">
                    <GraduationCap className="w-8 h-8 mx-auto mb-2 opacity-40" />
                    ยังไม่มีรายชื่อนักศึกษา — เพิ่มด้วยมือหรือนำเข้า Excel
                  </td>
                </tr>
              ) : trainees.map((t, index) => {
                const record = dayRecords[t.id]
                const per = statsForTrainee(data.attendance, t.id, range)
                const history = historyForTrainee(data.attendance, t.id)
                const isExpanded = expanded.has(t.id)
                return (
                  <Fragment key={t.id}>
                    <tr className="hover:bg-slate-50/60 align-top">
                      <td className="p-3 text-center text-slate-400">{String(index + 1).padStart(2, '0')}</td>
                      <td className="p-3">
                        <div className="font-semibold text-slate-800">{t.name}</div>
                        <div className="text-[11px] text-slate-400 mt-0.5">{[t.major, t.institution].filter(Boolean).join(' · ') || '—'}</div>
                      </td>
                      <td className="p-3 text-sm text-slate-600">{mentorDisplayLine(t) || '—'}</td>
                      <td className="p-3 text-[11px] text-slate-500 leading-5">
                        {traineeTeachingLines(t).length ? traineeTeachingLines(t).map((line, i) => (
                          <div key={i}>{line}</div>
                        )) : '—'}
                      </td>
                      <td className="p-3 text-center">
                        {mode === 'day' ? (
                          <select
                            value={record?.status || ''}
                            disabled={!canEdit}
                            onChange={(e) => updateRecord(t.id, { status: e.target.value })}
                            className={`w-full min-w-[130px] rounded-xl border px-2 py-1.5 text-center text-sm font-medium disabled:bg-slate-50 ${
                              record?.status ? STATUS_META[record.status].chip : 'border-slate-300 bg-white text-slate-500'
                            }`}
                            aria-label={`สถานะของ ${t.name}`}
                          >
                            <option value="" disabled>ยังไม่บันทึก</option>
                            {STATUSES.map((s) => <option key={s} value={s}>{STATUS_META[s].label}</option>)}
                          </select>
                        ) : (
                          <span className="text-xs text-slate-400">ดูสรุปช่วงเวลา</span>
                        )}
                      </td>
                      <td className="p-3 text-center">
                        {mode === 'day' ? (
                          <input
                            type="text"
                            inputMode="numeric"
                            maxLength={5}
                            placeholder="HH:MM"
                            value={record?.time || ''}
                            disabled={!canEdit}
                            onChange={(e) => updateRecord(t.id, { time: e.target.value.replace(/[^\d:.]/g, '') })}
                            onBlur={(e) => updateRecord(t.id, { time: normalizeTime24(e.target.value) })}
                            className="w-full rounded-lg border border-slate-300 px-2 py-1.5 text-xs text-center tabular-nums disabled:bg-slate-50"
                            aria-label={`เวลาเข้าของ ${t.name}`}
                          />
                        ) : '—'}
                      </td>
                      <td className="p-3">
                        {mode === 'day' ? (
                          <input
                            value={record?.note || ''}
                            disabled={!canEdit}
                            onChange={(e) => updateRecord(t.id, { note: e.target.value })}
                            placeholder="เหตุผล / หมายเหตุ"
                            className="w-full rounded-lg border border-slate-300 px-2 py-1.5 text-xs disabled:bg-slate-50"
                            aria-label={`หมายเหตุของ ${t.name}`}
                          />
                        ) : (
                          <span className="text-[11px] text-slate-400">
                            {history.map((h) => h.note).filter(Boolean).slice(0, 2).join(' · ') || '—'}
                          </span>
                        )}
                      </td>
                      <td className="p-3 text-center font-semibold text-emerald-700">{per.present}</td>
                      <td className="p-3 text-center font-semibold text-amber-700">{per.late}</td>
                      <td className="p-3 text-center font-semibold text-blue-700">{per.leave}</td>
                      <td className="p-3 text-center font-semibold text-rose-700">{per.absent}</td>
                      <td className="p-3 text-center font-bold text-slate-700">{per.total}</td>
                      <td className="p-3 text-center">
                        <button
                          onClick={() => toggleExpanded(t.id)}
                          className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-medium text-slate-600 bg-slate-100 hover:bg-slate-200"
                          aria-expanded={isExpanded}
                        >
                          {isExpanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                          {history.length}
                        </button>
                      </td>
                      <td className="p-3 text-center">
                        {mode === 'day' && record && canEdit ? (
                          <button onClick={() => deleteRecord(t.id, t.name)} className="p-1.5 rounded-lg text-rose-400 hover:text-rose-600 hover:bg-rose-50" title="ลบรายการของวันนี้">
                            <Trash2 className="w-4 h-4" />
                          </button>
                        ) : <span className="text-slate-300">—</span>}
                      </td>
                    </tr>
                    {isExpanded && (
                      <tr key={`${t.id}-history`} className="bg-slate-50/70">
                        <td colSpan={14} className="p-0">
                          <div className="px-6 py-3">
                            <div className="text-xs font-bold text-slate-600 mb-2">ประวัติย้อนหลัง (เฉพาะรายการที่ไม่ใช่ปกติ)</div>
                            {history.length === 0 ? (
                              <p className="text-xs text-slate-400">ยังไม่มีรายการสาย/ลา/ขาด</p>
                            ) : (
                              <div className="space-y-1.5 max-h-52 overflow-y-auto">
                                {history.map((h) => (
                                  <div key={h.dateKey} className="flex flex-wrap items-center gap-2 text-xs">
                                    <span className="text-slate-500 w-28 shrink-0">{formatThaiDate(h.dateKey)}</span>
                                    <span className={`px-2 py-0.5 rounded-full border font-semibold ${STATUS_META[h.status]?.chip || ''}`}>
                                      {STATUS_META[h.status]?.label || h.status}
                                    </span>
                                    {h.time && <span className="text-slate-400">{h.time}</span>}
                                    <span className="text-slate-600">{h.note || '—'}</span>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                )
              })}
            </tbody>
          </table>
        </div>
      </section>
        </>
      )}

      {moduleTab === 'dashboard' && (
        <TraineeDashboard
          trainees={trainees}
          attendance={data.attendance || {}}
          reference={reference}
          onPrint={() => {
            setPrintInitialType('dashboard')
            setModuleTab('print')
          }}
        />
      )}

      {moduleTab === 'print' && (
        <TraineePrintStudio
          trainees={trainees}
          attendance={data.attendance || {}}
          reference={reference}
          initialType={printInitialType}
          initialDateKey={dateKey}
          timetableId={timetableId}
          cloudEnabled={cloudEnabled}
          canEdit={canEdit}
          title={title}
          timetableTitle={activeTraineeWorkspace?.linkedTimetableTitle || activeWorkspace?.title || ''}
          onToast={(msg) => setNotice(msg)}
          onEnsureSaved={workspace.ensureSaved}
        />
      )}

      {moduleTab === 'directory' && (
        <TraineeDirectoryPage
          trainees={data.trainees || []}
          reference={reference}
          canEdit={canEdit}
          onSave={handleSaveTrainee}
          onArchive={handleArchive}
          onDelete={handleDeleteTrainee}
          onTemplate={downloadTraineeTemplate}
          onImport={() => setShowImport(true)}
          onExport={handleExportCSV}
        />
      )}
      {showImport && (
        <TraineeImportModal
          reference={reference}
          onImport={handleImport}
          onClose={() => setShowImport(false)}
        />
      )}
      {showAccess && (
        <TraineeAccessDialog
          timetableId={timetableId}
          onClose={(saved) => {
            setShowAccess(false)
            if (saved) setNotice('บันทึกสิทธิ์โมดูลแล้ว')
          }}
        />
      )}
    </div>
  )
}
