import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  PackagePlus, Pencil, Trash2, Loader2, Download, FileArchive, BellRing,
  RefreshCw, Copy, Check, Package,
} from 'lucide-react'
import {
  adminTaskRemind, createAdminTask, deleteAdminTask, downloadAdminFile,
  fetchAdminTaskMatrix, fetchAdminTasks, updateAdminTask,
} from '../../api/portal.js'
import TaskEditorModal from './TaskEditorModal.jsx'
import {
  audienceSummary, dueBadge, formatThaiDateTime, statusMeta,
} from './portalUtils.js'

const TONE = {
  emerald: 'bg-emerald-100 text-emerald-800 border-emerald-200',
  amber: 'bg-amber-100 text-amber-800 border-amber-200',
  rose: 'bg-rose-100 text-rose-800 border-rose-200',
  slate: 'bg-slate-100 text-slate-600 border-slate-200',
}

function SlotCell({ state }) {
  const meta = statusMeta(state?.status || 'missing')
  return (
    <div className="text-[11px] leading-tight">
      <span className={`inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 font-semibold ${TONE[meta.tone]}`}>
        {meta.dot} {meta.short}
      </span>
      {state?.submitted_at && (
        <div className="text-slate-400 mt-0.5">{formatThaiDateTime(state.submitted_at)}</div>
      )}
    </div>
  )
}

export default function AdminTasksTab({ code, teachers, depts, onError, onNotice }) {
  const [tasks, setTasks] = useState([])
  const [loading, setLoading] = useState(true)
  const [selectedId, setSelectedId] = useState('')
  const [matrix, setMatrix] = useState(null)
  const [matrixBusy, setMatrixBusy] = useState(false)
  const [includeAll, setIncludeAll] = useState(false)
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState(null)
  const [remind, setRemind] = useState(null)
  const [remindBusy, setRemindBusy] = useState(false)
  const [copied, setCopied] = useState(false)

  const loadTasks = useCallback(async () => {
    setLoading(true)
    try {
      const body = await fetchAdminTasks(code)
      const list = body.tasks || []
      setTasks(list)
      setSelectedId((prev) => (list.some((t) => t.id === prev) ? prev : (list[0]?.id || '')))
    } catch (e) {
      onError?.(e.message)
    } finally {
      setLoading(false)
    }
  }, [code, onError])

  useEffect(() => { loadTasks() }, [loadTasks])

  const loadMatrix = useCallback(async () => {
    if (!selectedId) { setMatrix(null); return }
    setMatrixBusy(true)
    try {
      setMatrix(await fetchAdminTaskMatrix(code, selectedId, includeAll))
    } catch (e) {
      onError?.(e.message)
    } finally {
      setMatrixBusy(false)
    }
  }, [code, selectedId, includeAll, onError])

  useEffect(() => { loadMatrix() }, [loadMatrix])

  const selectedTask = useMemo(
    () => tasks.find((t) => t.id === selectedId) || null,
    [tasks, selectedId],
  )

  async function save(payload) {
    if (editing?.id) await updateAdminTask(code, editing.id, payload)
    else {
      const body = await createAdminTask(code, payload)
      if (body.task?.id) setSelectedId(body.task.id)
    }
    setOpen(false)
    setEditing(null)
    onNotice?.(editing ? 'บันทึกการแก้ไขงานแล้ว' : 'สร้างงานส่งไฟล์แล้ว')
    await loadTasks()
  }

  async function remove(task) {
    if (!window.confirm(`ลบงาน “${task.title}” พร้อมไฟล์ที่ส่งทั้งหมด?`)) return
    try {
      await deleteAdminTask(code, task.id)
      onNotice?.('ลบงานแล้ว')
      await loadTasks()
    } catch (e) {
      onError?.(e.message)
    }
  }

  async function doRemind({ sendWebhook = true, copyOnly = false }) {
    if (!selectedId) return
    setRemindBusy(true)
    try {
      const body = await adminTaskRemind(code, selectedId, { sendWebhook, copyOnly })
      setRemind(body)
      await loadMatrix()
    } catch (e) {
      onError?.(e.message)
    } finally {
      setRemindBusy(false)
    }
  }

  function download(path, filename) {
    downloadAdminFile(code, path, filename).catch((e) => onError?.(e.message))
  }

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-sm font-bold text-slate-700">งานส่งไฟล์ ({tasks.length})</h2>
        <button
          onClick={loadTasks}
          className="min-h-[32px] px-2.5 rounded-lg border border-slate-300 text-xs font-semibold inline-flex items-center gap-1"
          title="โหลดใหม่"
        >
          <RefreshCw className="w-3.5 h-3.5" />
        </button>
        <button
          onClick={() => { setEditing(null); setOpen(true) }}
          className="ml-auto min-h-[38px] px-3 rounded-lg bg-blue-600 text-white text-sm font-bold inline-flex items-center gap-1.5"
        >
          <PackagePlus className="w-4 h-4" /> สร้างงาน
        </button>
      </div>

      {loading && (
        <div className="flex items-center gap-2 text-sm text-slate-500">
          <Loader2 className="w-4 h-4 animate-spin" /> กำลังโหลด…
        </div>
      )}

      {!loading && tasks.length === 0 && (
        <div className="rounded-xl border border-dashed border-slate-300 bg-white/70 p-6 text-center text-sm text-slate-500">
          ยังไม่มีงานส่งไฟล์ — เริ่มจาก “สร้างงาน” แล้วกำหนดกล่องรับไฟล์
        </div>
      )}

      {tasks.length > 0 && (
        <div className="grid gap-3 lg:grid-cols-[320px,1fr]">
          <div className="space-y-2">
            {tasks.map((task) => {
              const active = task.id === selectedId
              const badge = dueBadge(task)
              return (
                <button
                  key={task.id}
                  onClick={() => setSelectedId(task.id)}
                  className={`w-full text-left rounded-xl border p-3 transition-colors
                    ${active ? 'border-blue-400 bg-blue-50' : 'border-slate-200 bg-white hover:border-blue-300'}`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <span className="text-sm font-bold text-slate-800 break-words">{task.title}</span>
                    <span className={`shrink-0 rounded-full border px-1.5 py-0.5 text-[10px] font-semibold ${TONE[badge.tone]}`}>
                      {badge.label}
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-500 mt-1">
                    {(task.slots || []).length} กล่อง · {audienceSummary(task.audience)}
                  </p>
                  <div className="flex items-center gap-2 mt-1.5">
                    <div className="flex-1 h-1.5 rounded-full bg-slate-200 overflow-hidden">
                      <div className="h-full bg-emerald-500" style={{ width: `${task.summary?.percent || 0}%` }} />
                    </div>
                    <span className="text-[10px] font-semibold text-slate-500">
                      {task.summary?.complete || 0}/{task.summary?.total || 0}
                    </span>
                  </div>
                </button>
              )
            })}
          </div>

          <div className="space-y-2 min-w-0">
            {selectedTask && (
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs text-slate-500">
                  กล่อง: {(selectedTask.slots || []).map((s) => s.title).join(' · ')}
                </span>
                <label className="inline-flex items-center gap-1.5 text-xs text-slate-600">
                  <input
                    type="checkbox"
                    checked={includeAll}
                    onChange={(e) => setIncludeAll(e.target.checked)}
                    className="w-4 h-4"
                  />
                  แสดงทุกคน
                </label>
                <div className="ml-auto flex flex-wrap gap-2">
                  <button
                    onClick={() => { setEditing(selectedTask); setOpen(true) }}
                    className="min-h-[34px] px-2.5 rounded-lg border border-slate-300 text-xs font-semibold inline-flex items-center gap-1"
                  >
                    <Pencil className="w-3.5 h-3.5" /> แก้ไข
                  </button>
                  <button
                    onClick={() => remove(selectedTask)}
                    className="min-h-[34px] px-2.5 rounded-lg border border-rose-200 text-xs font-semibold text-rose-600 inline-flex items-center gap-1"
                  >
                    <Trash2 className="w-3.5 h-3.5" /> ลบ
                  </button>
                  <button
                    onClick={() => download(
                      `/admin/tasks/${selectedTask.id}/export.xlsx`,
                      `task_${selectedTask.id}.xlsx`,
                    )}
                    className="min-h-[34px] px-2.5 rounded-lg border border-slate-300 text-xs font-semibold inline-flex items-center gap-1"
                  >
                    <Download className="w-3.5 h-3.5" /> Excel
                  </button>
                  <button
                    onClick={() => download(
                      `/admin/tasks/${selectedTask.id}/download-zip`,
                      `task_${selectedTask.id}.zip`,
                    )}
                    className="min-h-[34px] px-2.5 rounded-lg border border-slate-300 text-xs font-semibold inline-flex items-center gap-1"
                  >
                    <FileArchive className="w-3.5 h-3.5" /> ZIP
                  </button>
                  <button
                    onClick={() => doRemind({ sendWebhook: false, copyOnly: true })}
                    disabled={remindBusy}
                    className="min-h-[34px] px-2.5 rounded-lg bg-amber-500 text-white text-xs font-bold inline-flex items-center gap-1 disabled:opacity-50"
                  >
                    <BellRing className="w-3.5 h-3.5" /> เตือนคนค้างส่ง
                  </button>
                </div>
              </div>
            )}

            {matrixBusy && (
              <div className="flex items-center gap-2 text-sm text-slate-500">
                <Loader2 className="w-4 h-4 animate-spin" /> กำลังโหลดตาราง…
              </div>
            )}

            {matrix && !matrixBusy && (
              <>
                <div className="bg-white rounded-xl border border-slate-200 p-4">
                  <div className="flex flex-wrap items-center gap-4">
                    <div>
                      <p className="text-xs text-slate-500">ส่งครบแล้ว</p>
                      <p className="text-2xl font-bold text-slate-800">
                        {matrix.summary.complete} / {matrix.summary.total}
                        <span className="text-sm font-semibold text-slate-500 ml-1">
                          ({matrix.summary.percent}%)
                        </span>
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2 text-xs">
                      <span className="rounded-full bg-emerald-100 text-emerald-800 px-2 py-0.5 font-semibold">
                        🟩 ครบ {matrix.summary.complete}
                      </span>
                      <span className="rounded-full bg-amber-100 text-amber-800 px-2 py-0.5 font-semibold">
                        🟨 ไม่ครบ {matrix.summary.partial}
                      </span>
                      <span className="rounded-full bg-rose-100 text-rose-800 px-2 py-0.5 font-semibold">
                        🟥 ยังไม่ส่ง {matrix.summary.missing}
                      </span>
                    </div>
                  </div>
                  <div className="mt-3 h-2 rounded-full bg-slate-200 overflow-hidden">
                    <div className="h-full bg-emerald-500" style={{ width: `${matrix.summary.percent}%` }} />
                  </div>
                </div>

                <div className="bg-white rounded-xl border border-slate-200 overflow-x-auto">
                  <table className="min-w-full text-sm">
                    <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                      <tr>
                        <th className="px-3 py-2 text-left font-semibold">รหัส</th>
                        <th className="px-3 py-2 text-left font-semibold">ชื่อ-สกุล</th>
                        <th className="px-3 py-2 text-left font-semibold">กลุ่มสาระ</th>
                        <th className="px-3 py-2 text-left font-semibold">รวม</th>
                        {(matrix.slots || []).map((slot) => (
                          <th key={slot.id} className="px-3 py-2 text-left font-semibold whitespace-nowrap">
                            {slot.title}
                            {!slot.is_required && <span className="text-slate-400"> (ไม่บังคับ)</span>}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {matrix.rows.map((row) => {
                        const meta = statusMeta(row.status)
                        return (
                          <tr key={row.teacher_id} className={row.status === 'not_targeted' ? 'opacity-50' : ''}>
                            <td className="px-3 py-2 font-mono text-xs text-slate-500">{row.teacher_id}</td>
                            <td className="px-3 py-2 font-medium text-slate-800">{row.display_name}</td>
                            <td className="px-3 py-2 text-slate-600">{row.dept || '—'}</td>
                            <td className="px-3 py-2">
                              <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold ${meta.className}`}>
                                {meta.dot} {row.done}/{row.total}
                              </span>
                            </td>
                            {(matrix.slots || []).map((slot) => (
                              <td key={slot.id} className="px-3 py-2">
                                <SlotCell state={(row.slots || {})[slot.id]} />
                              </td>
                            ))}
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </>
            )}

            {!selectedTask && tasks.length > 0 && (
              <div className="rounded-xl border border-dashed border-slate-300 bg-white/70 p-6 text-center text-sm text-slate-500">
                <Package className="w-6 h-6 mx-auto text-slate-300 mb-1" />
                เลือกงานด้านซ้ายเพื่อดูตารางตรวจงาน
              </div>
            )}
          </div>
        </div>
      )}

      <TaskEditorModal
        open={open}
        initial={editing}
        teachers={teachers}
        depts={depts}
        onClose={() => { setOpen(false); setEditing(null) }}
        onSave={save}
      />

      {remind && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 flex items-center justify-center p-4">
          <div className="w-full max-w-lg bg-white rounded-2xl shadow-xl p-5 space-y-3">
            <h2 className="text-base font-bold text-slate-800">แจ้งเตือนคนที่ยังส่งไม่ครบ</h2>
            <pre className="whitespace-pre-wrap text-sm bg-slate-50 border border-slate-200 rounded-lg p-3 max-h-56 overflow-y-auto">
              {remind.message}
            </pre>
            <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
              <span>ยังไม่ครบ {remind.incomplete} คน</span>
              {remind.webhook && (
                <span className={remind.webhook.ok ? 'text-emerald-600' : 'text-rose-600'}>
                  webhook: {remind.webhook.status}
                </span>
              )}
            </div>
            <div className="flex flex-wrap justify-end gap-2">
              <button
                onClick={() => {
                  try { navigator.clipboard.writeText(remind.message) } catch { /* ignore */ }
                  setCopied(true)
                  setTimeout(() => setCopied(false), 1500)
                }}
                className="min-h-[40px] px-3 rounded-lg border border-slate-300 text-sm font-semibold inline-flex items-center gap-1.5"
              >
                {copied ? <Check className="w-4 h-4 text-emerald-600" /> : <Copy className="w-4 h-4" />}
                คัดลอกข้อความ
              </button>
              <button
                onClick={() => doRemind({ sendWebhook: true, copyOnly: false })}
                disabled={remindBusy}
                className="min-h-[40px] px-3 rounded-lg bg-amber-500 text-white text-sm font-bold inline-flex items-center gap-2 disabled:opacity-60"
              >
                {remindBusy && <Loader2 className="w-4 h-4 animate-spin" />} ส่งแจ้งเตือนในแอป
              </button>
              <button
                onClick={() => setRemind(null)}
                className="min-h-[40px] px-3 rounded-lg bg-slate-100 text-sm font-semibold"
              >
                ปิด
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}
