import { useState } from 'react'
import { KeyRound } from 'lucide-react'

/**
 * Shared "enter the portal code" screen.
 *
 * Used by /portal (teacher) and /admin (ฝ่ายวิชาการ) so a link without `?w=`
 * is never a dead end.
 */
export default function PortalCodeEntry({
  title = 'เปิดพอร์ทัลโรงเรียน',
  description = 'กรอกรหัสพอร์ทัล 6 หลักที่ฝ่ายวิชาการส่งให้',
  cta = 'เข้าสู่พอร์ทัล',
  onSubmit,
}) {
  const [value, setValue] = useState('')
  const [error, setError] = useState(null)

  function submit(event) {
    event.preventDefault()
    const code = value.trim().toUpperCase()
    if (code.length < 4) {
      setError('รหัสพอร์ทัลต้องมีอย่างน้อย 4 ตัวอักษร')
      return
    }
    setError(null)
    onSubmit?.(code)
  }

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center px-4">
      <form
        onSubmit={submit}
        className="w-full max-w-sm bg-white rounded-2xl border border-slate-200 p-6 space-y-3"
      >
        <div className="w-11 h-11 rounded-xl bg-indigo-50 ring-1 ring-indigo-100 flex items-center justify-center">
          <KeyRound className="w-5 h-5 text-indigo-600" />
        </div>
        <h1 className="text-lg font-bold text-slate-800">{title}</h1>
        <p className="text-sm text-slate-500">{description}</p>
        <input
          value={value}
          onChange={(e) => setValue(e.target.value.toUpperCase())}
          maxLength={12}
          autoFocus
          placeholder="เช่น ABC123"
          className="w-full min-h-[48px] rounded-xl border border-slate-300 px-3 text-center text-lg tracking-widest"
        />
        {error && <p className="text-sm text-rose-600">{error}</p>}
        <button
          type="submit"
          className="w-full min-h-[48px] rounded-xl bg-blue-600 text-white font-bold"
        >
          {cta}
        </button>
        <a href="/" className="block text-center text-xs text-slate-500 hover:underline">
          กลับหน้าหลัก
        </a>
      </form>
    </div>
  )
}
