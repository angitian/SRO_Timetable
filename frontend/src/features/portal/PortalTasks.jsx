import { useEffect, useMemo, useState } from 'react'
import {
  CheckCircle2, ChevronDown, ChevronRight, FileText, Upload, Clock, AlertCircle,
} from 'lucide-react'
import PortalUploadModal from './PortalUploadModal.jsx'
import {
  dueBadge,
  formatFileSize,
  formatThaiDateTime,
  progressLabel,
  statusMeta,
} from './portalUtils.js'

const TONE = {
  emerald: 'bg-emerald-100 text-emerald-800 border-emerald-200',
  amber: 'bg-amber-100 text-amber-800 border-amber-200',
  rose: 'bg-rose-100 text-rose-800 border-rose-200',
  slate: 'bg-slate-100 text-slate-600 border-slate-200',
}

function SlotRow({ slot, state, onUpload, disabled }) {
  const meta = statusMeta(state?.status || 'missing')
  return (
    <div className="flex items-center gap-2 py-2 border-t border-slate-100 first:border-t-0">
      <FileText className="w-4 h-4 text-slate-400 shrink-0" />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-slate-800 truncate">
          {slot.title}
          {!slot.is_required && (
            <span className="ml-1 text-[10px] font-normal text-slate-400">(ไม่บังคับ)</span>
          )}
        </p>
        <p className="text-[11px] text-slate-500 truncate">
          {state?.submitted_at
            ? `${state.file_name} · ${formatFileSize(state.file_size_bytes)} · ${formatThaiDateTime(state.submitted_at)}`
            : slot.description || `อนุญาต ${slot.allowed_ext || '.pdf .docx .xlsx .zip'} · ไม่เกิน ${slot.max_mb || 25} MB`}
        </p>
      </div>
      <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-semibold ${TONE[meta.tone]}`}>
        {meta.dot} {meta.short}
      </span>
      <button
        onClick={() => onUpload(slot)}
        disabled={disabled}
        className={`shrink-0 min-h-[34px] px-2.5 rounded-lg text-xs font-bold inline-flex items-center gap-1
          ${state?.submitted_at
            ? 'border border-slate-300 text-slate-600'
            : 'bg-emerald-600 text-white'}
          disabled:opacity-50`}
      >
        <Upload className="w-3.5 h-3.5" />
        {state?.submitted_at ? 'ส่งใหม่' : 'ส่งไฟล์'}
      </button>
    </div>
  )
}

export default function PortalTasks({ code, teacher, tasks = [], submissions = [], onRefresh, focusTaskId }) {
  const [openIds, setOpenIds] = useState(() => new Set())
  const [uploading, setUploading] = useState(null) // { task, slot }

  useEffect(() => {
    if (!focusTaskId) return
    setOpenIds((prev) => new Set(prev).add(focusTaskId))
  }, [focusTaskId])

  const toggle = (taskId) => {
    setOpenIds((prev) => {
      const next = new Set(prev)
      if (next.has(taskId)) next.delete(taskId)
      else next.add(taskId)
      return next
    })
  }

  const byTask = useMemo(() => {
    const map = {}
    for (const row of submissions) {
      map[row.task_id] = map[row.task_id] || []
      map[row.task_id].push(row)
    }
    return map
  }, [submissions])

  if (!teacher) {
    return (
      <div className="bg-white rounded-2xl border border-slate-200 p-5 text-sm text-slate-600">
        เลือกชื่อครูด้านบนก่อน เพื่อดูงานที่ต้องส่ง
      </div>
    )
  }

  const sorted = [...tasks].sort((a, b) => (a.due_datetime || '').localeCompare(b.due_datetime || ''))

  return (
    <div className="space-y-3">
      {sorted.length === 0 && (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-white/70 p-6 text-center text-sm text-slate-500">
          <CheckCircle2 className="w-6 h-6 mx-auto text-emerald-400 mb-1" />
          ยังไม่มีงานที่ต้องส่งในขณะนี้
        </div>
      )}

      {sorted.map((task) => {
        const progress = task.progress || { done: 0, total: task.slots?.length || 0, status: 'missing', slots: {} }
        const badge = dueBadge(task)
        const meta = statusMeta(progress.status)
        const open = openIds.has(task.id)
        return (
          <article key={task.id} className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
            <button
              onClick={() => toggle(task.id)}
              className="w-full text-left p-4 flex items-start gap-2"
              aria-expanded={open}
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-amber-100 text-amber-800">
                    งานส่งไฟล์
                  </span>
                  <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full border ${TONE[badge.tone]}`}>
                    {badge.label}
                  </span>
                </div>
                <h3 className="text-sm font-bold text-slate-800 mt-1 break-words">{task.title}</h3>
                {task.description && (
                  <p className="text-xs text-slate-500 mt-0.5 line-clamp-2">{task.description}</p>
                )}
                <div className="flex items-center gap-2 mt-2">
                  <div className="flex-1 h-1.5 rounded-full bg-slate-200 overflow-hidden">
                    <div
                      className={`h-full ${progress.status === 'complete' ? 'bg-emerald-500' : 'bg-amber-500'}`}
                      style={{ width: `${progress.percent || 0}%` }}
                    />
                  </div>
                  <span className="text-[11px] font-semibold text-slate-500 shrink-0">
                    {progressLabel(progress)}
                  </span>
                  <span className={`shrink-0 rounded-full border px-1.5 py-0.5 text-[10px] font-semibold ${TONE[meta.tone]}`}>
                    {meta.dot} {meta.short}
                  </span>
                </div>
              </div>
              <span className="shrink-0 mt-1 text-slate-400">
                {open ? <ChevronDown className="w-5 h-5" /> : <ChevronRight className="w-5 h-5" />}
              </span>
            </button>

            {open && (
              <div className="px-4 pb-3">
                {(task.slots || []).map((slot) => (
                  <SlotRow
                    key={slot.id}
                    slot={slot}
                    state={(progress.slots || {})[slot.id]}
                    disabled={!teacher.has_pin}
                    onUpload={(s) => setUploading({ task, slot: s })}
                  />
                ))}
                {!teacher.has_pin && (
                  <p className="mt-2 flex items-start gap-1.5 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-2 py-1.5">
                    <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                    ยังไม่ได้ตั้ง PIN — ติดต่อฝ่ายวิชาการก่อนส่งไฟล์
                  </p>
                )}
                {task.due_datetime && (
                  <p className="mt-2 text-[11px] text-slate-400 flex items-center gap-1">
                    <Clock className="w-3 h-3" /> กำหนดส่ง {formatThaiDateTime(task.due_datetime)}
                  </p>
                )}
              </div>
            )}
          </article>
        )
      })}

      {submissions.length > 0 && (
        <section className="space-y-2 pt-2">
          <h2 className="text-sm font-bold text-slate-700 flex items-center gap-1.5">
            <CheckCircle2 className="w-4 h-4 text-emerald-600" /> ไฟล์ที่ฉันส่งแล้ว
          </h2>
          {submissions.map((row) => {
            const meta = statusMeta(row.status)
            return (
              <div key={row.id} className="bg-white rounded-2xl border border-slate-200 p-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-slate-800 truncate">
                      {row.slot_title || row.file_name}
                    </p>
                    <p className="text-[11px] text-slate-500 truncate">
                      {row.task_title} · {formatThaiDateTime(row.submitted_at)}
                    </p>
                  </div>
                  <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-semibold ${TONE[meta.tone]}`}>
                    {meta.dot} {meta.short}
                  </span>
                </div>
                {row.web_view_url && (
                  <a
                    href={row.web_view_url}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-block text-xs text-blue-600 mt-1"
                  >
                    เปิดใน Drive
                  </a>
                )}
              </div>
            )
          })}
        </section>
      )}

      <PortalUploadModal
        open={!!uploading}
        code={code}
        teacher={teacher}
        task={uploading?.task}
        slot={uploading?.slot}
        onClose={() => setUploading(null)}
        onDone={() => { setUploading(null); onRefresh?.() }}
      />
    </div>
  )
}
