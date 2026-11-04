import { useEffect, useState } from 'react'
import { Globe, Loader2, Lock, Plus, Trash2, Users, X } from 'lucide-react'
import { useApp } from '../../context/AppContext.jsx'
import { fetchTraineeMembers, saveTraineeMembers } from '../../api/client.js'

export default function TraineeAccessDialog({ timetableId, onClose }) {
  const { user } = useApp()
  const [members, setMembers] = useState([])
  const [accessMode, setAccessMode] = useState('private')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [input, setInput] = useState('')
  const [newRole, setNewRole] = useState('viewer')

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    fetchTraineeMembers(timetableId)
      .then((res) => {
        if (cancelled) return
        setMembers(res.members || [])
        setAccessMode(res.access_mode || 'private')
      })
      .catch((e) => { if (!cancelled) setError(e.message) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [timetableId])

  function addMember() {
    const email = input.trim().toLowerCase()
    if (!email || !email.includes('@')) return
    if (members.some((m) => m.email === email)) { setInput(''); return }
    setMembers([...members, { email, role: newRole }])
    setInput('')
  }

  async function handleSave() {
    setSaving(true)
    setError('')
    try {
      await saveTraineeMembers(timetableId, members, accessMode)
      onClose(true)
    } catch (e) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[130] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => onClose(false)} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-lg p-5 space-y-4 max-h-[88vh] overflow-y-auto">
        <div className="flex items-center justify-between">
          <h3 className="text-base font-bold text-gray-900 flex items-center gap-2">
            <Users className="w-4 h-4 text-violet-600" />
            สิทธิ์โมดูลนักศึกษาฝึกสอน
          </h3>
          <button onClick={() => onClose(false)} className="p-1 rounded-lg text-gray-400 hover:bg-gray-100" aria-label="ปิด">
            <X className="w-4 h-4" />
          </button>
        </div>
        <p className="text-xs text-gray-500">
          สิทธิ์นี้แยกจากสิทธิ์ตารางสอน — ผู้ที่ได้รับสิทธิ์แก้ไขโมดูลสามารถลงเวลา/จัดการรายชื่อได้โดยไม่ต้องแก้ตาราง
        </p>

        <div className="space-y-2">
          {[
            { value: 'private', icon: Lock, title: 'เฉพาะรายชื่อ', desc: 'เจ้าของ + รายชื่อด้านล่าง' },
            { value: 'team', icon: Globe, title: 'ทีมของเจ้าของโมดูล', desc: 'ใช้ default trainee role ของทีม' },
          ].map((m) => {
            const Icon = m.icon
            const active = accessMode === m.value
            return (
              <button
                key={m.value}
                type="button"
                onClick={() => setAccessMode(m.value)}
                className={`w-full flex items-start gap-3 p-3 rounded-xl border text-left transition-colors
                  ${active ? 'border-violet-400 bg-violet-50' : 'border-gray-200 hover:border-violet-200 hover:bg-gray-50'}`}
              >
                <Icon className={`w-4 h-4 mt-0.5 shrink-0 ${active ? 'text-violet-600' : 'text-gray-400'}`} />
                <div>
                  <div className={`text-xs font-semibold ${active ? 'text-violet-900' : 'text-gray-700'}`}>{m.title}</div>
                  <div className="text-[11px] text-gray-500 mt-0.5">{m.desc}</div>
                </div>
              </button>
            )
          })}
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-8"><Loader2 className="w-5 h-5 text-violet-500 animate-spin" /></div>
        ) : (
          <>
            <div className="space-y-2 border-t border-gray-100 pt-3">
              <div className="text-xs font-semibold text-gray-700">เพิ่มรายชื่อ</div>
              <div className="flex gap-2">
                <input
                  type="email"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addMember() } }}
                  placeholder="teacher@school.ac.th"
                  className="flex-1 min-w-0 border border-gray-300 rounded-lg px-3 py-1.5 text-sm"
                />
                <select value={newRole} onChange={(e) => setNewRole(e.target.value)} className="border border-gray-300 rounded-lg px-2 py-1.5 text-xs">
                  <option value="viewer">อ่าน</option>
                  <option value="editor">แก้ไข</option>
                </select>
                <button onClick={addMember} className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-violet-600 text-white hover:bg-violet-700">
                  <Plus className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>

            <div className="space-y-2">
              {members.length === 0 ? (
                <p className="text-xs text-gray-400 italic py-2">ยังไม่มีรายชื่อเพิ่มเติม</p>
              ) : members.map((m) => (
                <div key={m.email} className="flex items-center gap-2 rounded-xl border border-gray-200 px-3 py-2">
                  <span className="text-xs font-semibold text-gray-800 truncate flex-1">{m.email}</span>
                  <select
                    value={m.role}
                    onChange={(e) => setMembers(members.map((x) => x.email === m.email ? { ...x, role: e.target.value } : x))}
                    className="border border-gray-300 rounded-lg px-2 py-1 text-[11px]"
                    aria-label={`สิทธิ์ของ ${m.email}`}
                  >
                    <option value="viewer">อ่าน</option>
                    <option value="editor">แก้ไข</option>
                  </select>
                  <button onClick={() => setMembers(members.filter((x) => x.email !== m.email))} className="text-red-400 hover:text-red-600" aria-label={`ลบ ${m.email}`}>
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
          </>
        )}

        {error && <p className="text-xs text-red-600">{error}</p>}
        <div className="flex gap-2 pt-1">
          <button onClick={() => onClose(false)} className="flex-1 px-4 py-2 rounded-lg text-sm font-medium text-gray-600 bg-gray-100 hover:bg-gray-200">ยกเลิก</button>
          <button
            onClick={handleSave}
            disabled={saving || loading}
            className="flex-1 px-4 py-2 rounded-lg text-sm font-semibold bg-violet-600 text-white hover:bg-violet-700 disabled:opacity-40"
          >
            {saving ? 'กำลังบันทึก…' : 'บันทึกสิทธิ์'}
          </button>
        </div>
      </div>
    </div>
  )
}
