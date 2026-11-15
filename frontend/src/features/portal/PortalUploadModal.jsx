import { useRef, useState } from 'react'
import { UploadCloud, FileCheck2, Loader2, AlertCircle, X, Send } from 'lucide-react'
import { uploadPortalSubmission } from '../../api/portal.js'
import {
  formatFileSize,
  formatThaiDateTime,
  statusMeta,
  validateFile,
} from './portalUtils.js'

const TONE = {
  emerald: 'bg-emerald-100 text-emerald-800 border-emerald-200',
  amber: 'bg-amber-100 text-amber-800 border-amber-200',
  rose: 'bg-rose-100 text-rose-800 border-rose-200',
  slate: 'bg-slate-100 text-slate-600 border-slate-200',
}

/**
 * Upload one submission slot: เลือกไฟล์ → PIN 4 หลัก → ส่ง → receipt
 */
export default function PortalUploadModal({ open, code, teacher, task, slot, onClose, onDone }) {
  const [file, setFile] = useState(null)
  const [pin, setPin] = useState('')
  const [note, setNote] = useState('')
  const [progress, setProgress] = useState(0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [receipt, setReceipt] = useState(null)
  const [dragging, setDragging] = useState(false)
  const inputRef = useRef(null)

  if (!open || !slot || !task) return null

  const allowedExt = (slot.allowed_ext || '.pdf,.docx,.xlsx,.zip')
    .split(',')
    .map((e) => e.trim())
    .filter(Boolean)
  const maxMb = slot.max_mb || 25

  function reset() {
    setFile(null)
    setPin('')
    setNote('')
    setReceipt(null)
    setError(null)
    setProgress(0)
    if (inputRef.current) inputRef.current.value = ''
  }

  function close() {
    if (busy) return
    reset()
    onClose?.()
  }

  function pickFile(next) {
    const problem = validateFile(next, { allowedExt, maxMb })
    setError(problem)
    setFile(problem ? null : next)
    setReceipt(null)
  }

  async function submit(event) {
    event.preventDefault()
    setError(null)
    if (!teacher) return setError('กรุณาเลือกชื่อครูด้านบนก่อน')
    const problem = validateFile(file, { allowedExt, maxMb })
    if (problem) return setError(problem)
    if (!/^\d{4}$/.test(pin)) return setError('PIN ต้องเป็นตัวเลข 4 หลัก')

    setBusy(true)
    setProgress(0)
    try {
      const { promise } = uploadPortalSubmission({
        code,
        teacherId: teacher.teacher_id,
        taskId: task.id,
        slotId: slot.id,
        pin,
        file,
        note,
        onProgress: setProgress,
      })
      const body = await promise
      setReceipt(body)
      setFile(null)
      setPin('')
      setNote('')
      if (inputRef.current) inputRef.current.value = ''
      onDone?.(body)
    } catch (e) {
      setError(e.message || 'อัปโหลดไม่สำเร็จ')
    } finally {
      setBusy(false)
      setProgress(0)
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/40 flex items-end sm:items-center justify-center">
      <form
        onSubmit={submit}
        className="w-full sm:max-w-md bg-white rounded-t-2xl sm:rounded-2xl p-5 space-y-3 max-h-[92vh] overflow-y-auto"
      >
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold text-slate-400">{task.title}</p>
            <h2 className="text-base font-bold text-slate-800">ส่ง: {slot.title}</h2>
            {slot.description && <p className="text-xs text-slate-500 mt-0.5">{slot.description}</p>}
          </div>
          <button type="button" onClick={close} className="p-1 rounded hover:bg-slate-100">
            <X className="w-5 h-5 text-slate-500" />
          </button>
        </div>

        <p className="text-xs text-slate-500">
          {teacher?.display_name} · {teacher?.dept || 'ยังไม่ระบุกลุ่มสาระ'}
        </p>

        <div>
          <div
            onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault()
              setDragging(false)
              const dropped = e.dataTransfer?.files?.[0]
              if (dropped) pickFile(dropped)
            }}
            onClick={() => inputRef.current?.click()}
            className={`rounded-xl border-2 border-dashed px-4 py-6 text-center cursor-pointer transition-colors
              ${dragging ? 'border-blue-500 bg-blue-50' : 'border-slate-300 bg-slate-50 hover:border-blue-400'}`}
          >
            <UploadCloud className="w-7 h-7 mx-auto text-slate-400" />
            <p className="mt-1 text-sm font-medium text-slate-700 break-all">
              {file ? file.name : 'แตะเพื่อเลือกไฟล์ หรือลากไฟล์มาวาง'}
            </p>
            <p className="text-xs text-slate-500 mt-0.5">
              {file ? formatFileSize(file.size) : `${allowedExt.join(' ')} — ไม่เกิน ${maxMb} MB`}
            </p>
            <input
              ref={inputRef}
              type="file"
              accept={allowedExt.join(',')}
              className="hidden"
              onChange={(e) => pickFile(e.target.files?.[0])}
            />
          </div>
          {file && (
            <button
              type="button"
              onClick={() => { setFile(null); if (inputRef.current) inputRef.current.value = '' }}
              className="mt-1 inline-flex items-center gap-1 text-xs text-slate-500 hover:text-rose-600"
            >
              <X className="w-3 h-3" /> ลบไฟล์ที่เลือก
            </button>
          )}
        </div>

        <label className="block">
          <span className="text-sm font-semibold text-slate-700">PIN 4 หลัก</span>
          <input
            type="password"
            inputMode="numeric"
            autoComplete="off"
            maxLength={4}
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 4))}
            placeholder="••••"
            className="mt-1 w-full min-h-[48px] rounded-xl border border-slate-300 px-3 text-center text-2xl tracking-[0.5em]"
          />
          <span className="mt-1 block text-xs text-slate-500">
            ค่าเริ่มต้นคือเลข 4 ตัวท้ายของเบอร์โทร — ถ้าลืมให้ติดต่อฝ่ายวิชาการ
          </span>
        </label>

        <label className="block">
          <span className="text-sm font-semibold text-slate-700">หมายเหตุ (ไม่บังคับ)</span>
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={200}
            className="mt-1 w-full min-h-[44px] rounded-xl border border-slate-300 px-3 text-sm"
            placeholder="เช่น แนบฉบับแก้ไข"
          />
        </label>

        {error && (
          <div className="flex items-start gap-2 rounded-xl bg-rose-50 border border-rose-200 px-3 py-2 text-sm text-rose-700">
            <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {busy && (
          <div className="space-y-1">
            <div className="h-2 rounded-full bg-slate-200 overflow-hidden">
              <div className="h-full bg-emerald-500 transition-all" style={{ width: `${progress}%` }} />
            </div>
            <p className="text-xs text-slate-500">กำลังอัปโหลด {progress}%</p>
          </div>
        )}

        <button
          type="submit"
          disabled={busy}
          className="w-full min-h-[52px] rounded-xl bg-emerald-600 text-white text-base font-bold
            flex items-center justify-center gap-2 disabled:opacity-60 active:bg-emerald-700"
        >
          {busy ? <Loader2 className="w-5 h-5 animate-spin" /> : <Send className="w-5 h-5" />}
          {busy ? 'กำลังส่ง…' : 'ส่งไฟล์'}
        </button>

        {receipt && (
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 space-y-1">
            <div className="flex items-center gap-2 text-emerald-800 font-bold text-sm">
              <FileCheck2 className="w-5 h-5" /> ส่งไฟล์สำเร็จ
            </div>
            <dl className="text-sm text-emerald-900 space-y-0.5">
              <div className="flex justify-between gap-3">
                <dt className="text-emerald-700">ไฟล์</dt>
                <dd className="font-medium truncate max-w-[60%]">{receipt.receipt?.file_name}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-emerald-700">เวลาที่ส่ง</dt>
                <dd className="font-medium">{formatThaiDateTime(receipt.receipt?.submitted_at)}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-emerald-700">สถานะ</dt>
                <dd className={`font-semibold inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] ${TONE[statusMeta(receipt.status).tone]}`}>
                  {statusMeta(receipt.status).dot} {statusMeta(receipt.status).label}
                </dd>
              </div>
              {receipt.progress && (
                <div className="flex justify-between gap-3">
                  <dt className="text-emerald-700">ความคืบหน้า</dt>
                  <dd className="font-medium">
                    {receipt.progress.done}/{receipt.progress.total} กล่อง
                  </dd>
                </div>
              )}
            </dl>
            <div className="flex gap-2 pt-1">
              {receipt.receipt?.web_view_url && (
                <a
                  href={receipt.receipt.web_view_url}
                  target="_blank"
                  rel="noreferrer"
                  className="text-emerald-700 underline text-xs"
                >
                  เปิดไฟล์ใน Drive
                </a>
              )}
              <button type="button" onClick={close} className="ml-auto text-xs font-semibold text-slate-600">
                ปิด
              </button>
            </div>
          </div>
        )}
      </form>
    </div>
  )
}
