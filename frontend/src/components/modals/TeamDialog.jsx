import { useState } from 'react'
import { Users, X, Plus, Trash2, Loader2, Clock, CheckCircle2, Mail, Info } from 'lucide-react'
import { useApp } from '../../context/AppContext.jsx'

/**
 * TeamDialog — เพิ่ม/ถอดผู้ใช้ที่ใช้ระบบร่วมกัน (ระดับทีม)
 *
 * เจ้าของเพิ่มอีเมล Google ครั้งเดียว → ทุก workspace ของเจ้าของถูกแชร์ให้
 * สมาชิกคนนั้นโดยอัตโนมัติ (ทั้งของเดิมและของใหม่) เมื่อสมาชิก login ด้วย
 * อีเมลนั้นจะเห็นข้อมูลเดิมและแก้ไขได้ทันที
 */
export default function TeamDialog({ onClose }) {
  const { user, teamInfo, teamLoading, inviteTeamMember, updateTeamMemberRoles, revokeTeamMember } = useApp()
  const [input, setInput] = useState('')
  const [workspaceRole, setWorkspaceRole] = useState('editor')
  const [traineeRole, setTraineeRole] = useState('none')
  const [busy, setBusy] = useState(null) // email ที่กำลังเพิ่ม/ถอด
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const members = teamInfo?.members || []
  const memberships = teamInfo?.memberships || []

  async function handleAdd() {
    const email = input.trim().toLowerCase()
    if (!email || !email.includes('@')) {
      setError('กรุณากรอกอีเมลให้ถูกต้อง')
      return
    }
    setError('')
    setNotice('')
    setBusy(email)
    const res = await inviteTeamMember(email, workspaceRole, traineeRole)
    setBusy(null)
    if (!res.ok) {
      setError(res.error || 'เพิ่มผู้ใช้ไม่สำเร็จ')
      return
    }
    setInput('')
    setNotice(res.added ? `เพิ่ม ${email} เข้าทีมแล้ว` : `${email} อยู่ในทีมอยู่แล้ว`)
  }

  async function handleRoleChange(email, nextWorkspaceRole, nextTraineeRole) {
    setError('')
    setNotice('')
    setBusy(email)
    const res = await updateTeamMemberRoles(email, nextWorkspaceRole, nextTraineeRole)
    setBusy(null)
    if (!res.ok) {
      setError(res.error || 'แก้สิทธิ์ไม่สำเร็จ')
      return
    }
    setNotice(`อัปเดตสิทธิ์ของ ${email} แล้ว`)
  }

  async function handleRemove(email) {
    setError('')
    setNotice('')
    setBusy(email)
    const res = await revokeTeamMember(email)
    setBusy(null)
    if (!res.ok) {
      setError(res.error || 'ถอดผู้ใช้ไม่สำเร็จ')
      return
    }
    setNotice(`ถอด ${email} ออกจากทีมแล้ว`)
  }

  return (
    <div className="fixed inset-0 z-[130] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-lg p-5 space-y-4 max-h-[85vh] overflow-y-auto">
        <div className="flex items-center justify-between">
          <h3 className="text-base font-bold text-gray-900 flex items-center gap-2">
            <Users className="w-4 h-4 text-violet-600" />
            ผู้ใช้ในทีม
          </h3>
          <button onClick={onClose} className="p-1 rounded-lg text-gray-400 hover:bg-gray-100" aria-label="ปิด">
            <X className="w-4 h-4" />
          </button>
        </div>

        <p className="text-xs text-gray-500 leading-relaxed">
          เพิ่มอีเมล Google ของครูที่ต้องการใช้ระบบร่วมกัน — สมาชิกจะเห็น
          <span className="font-semibold text-gray-700"> ทุกตารางที่คุณเป็นเจ้าของ</span>
          {' '}(ทั้งตารางเดิมและตารางใหม่) และแก้ไขได้เหมือนเจ้าของ
          เมื่อสมาชิก login ด้วยอีเมลนั้นจะใช้งานข้อมูลเดิมได้ทันที
        </p>

        {user?.email && (
          <div className="flex items-center gap-2 text-xs text-gray-600 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2">
            <Mail className="w-3.5 h-3.5 text-gray-400 shrink-0" />
            <span className="truncate">เจ้าของทีม: <span className="font-medium text-gray-800">{user.email}</span></span>
          </div>
        )}

        <div className="space-y-2">
          <div className="flex gap-2">
            <input
              type="email"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleAdd() }}
              placeholder="teacher@school.ac.th"
              className="flex-1 border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500"
            />
            <button
              onClick={handleAdd}
              disabled={!!busy}
              className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold bg-violet-600 text-white hover:bg-violet-700 transition-colors disabled:opacity-40"
            >
              {busy === input.trim().toLowerCase() ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
              เพิ่ม
            </button>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <label className="text-[11px] text-gray-500">
              สิทธิ์ตาราง (default)
              <select
                value={workspaceRole}
                onChange={(e) => setWorkspaceRole(e.target.value)}
                className="mt-1 w-full border border-gray-300 rounded-lg px-2 py-1.5 text-xs"
              >
                <option value="editor">แก้ไขได้</option>
                <option value="viewer">อ่านอย่างเดียว</option>
              </select>
            </label>
            <label className="text-[11px] text-gray-500">
              สิทธิ์โมดูล นศ.
              <select
                value={traineeRole}
                onChange={(e) => setTraineeRole(e.target.value)}
                className="mt-1 w-full border border-gray-300 rounded-lg px-2 py-1.5 text-xs"
              >
                <option value="none">ไม่เห็นโมดูล</option>
                <option value="viewer">อ่านอย่างเดียว</option>
                <option value="editor">แก้ไขได้</option>
              </select>
            </label>
          </div>
        </div>

        {error && <p className="text-xs text-red-600">{error}</p>}
        {notice && <p className="text-xs text-emerald-600">{notice}</p>}

        {teamLoading && !teamInfo ? (
          <div className="flex items-center justify-center py-6 text-gray-400">
            <Loader2 className="w-5 h-5 animate-spin" />
          </div>
        ) : members.length === 0 ? (
          <div className="text-center py-6 text-gray-400 border border-dashed border-gray-200 rounded-xl">
            <Users className="w-8 h-8 mx-auto mb-2 opacity-40" />
            <p className="text-xs">ยังไม่มีสมาชิกในทีม — คุณเป็นเจ้าของคนเดียว</p>
          </div>
        ) : (
          <div className="space-y-1.5">
            {members.map((m) => (
              <div key={m.email} className="bg-violet-50 border border-violet-200 rounded-lg px-3 py-2 space-y-2">
                <div className="flex items-center gap-2">
                  {m.picture ? (
                    <img src={m.picture} alt="" className="w-6 h-6 rounded-full shrink-0" referrerPolicy="no-referrer" />
                  ) : (
                    <div className="w-6 h-6 rounded-full bg-violet-200 flex items-center justify-center shrink-0">
                      <Users className="w-3 h-3 text-violet-700" />
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="text-xs font-medium text-violet-900 truncate">{m.name || m.email}</div>
                    {m.name && <div className="text-[11px] text-violet-600 truncate">{m.email}</div>}
                  </div>
                  <span
                    className={`shrink-0 inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full ${
                      m.status === 'active'
                        ? 'bg-emerald-100 text-emerald-700'
                        : 'bg-amber-100 text-amber-700'
                    }`}
                    title={m.status === 'active' ? 'เข้าสู่ระบบแล้ว' : 'ยังไม่เคยเข้าสู่ระบบด้วยอีเมลนี้'}
                  >
                    {m.status === 'active' ? <CheckCircle2 className="w-3 h-3" /> : <Clock className="w-3 h-3" />}
                    {m.status === 'active' ? 'เข้าใช้งานแล้ว' : 'รอเข้าสู่ระบบ'}
                  </span>
                  <button
                    onClick={() => handleRemove(m.email)}
                    disabled={busy === m.email}
                    className="shrink-0 p-1 rounded text-red-400 hover:text-red-600 hover:bg-red-50 transition-colors disabled:opacity-40"
                    title="ถอดออกจากทีม"
                    aria-label={`ถอด ${m.email} ออกจากทีม`}
                  >
                    {busy === m.email ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                  </button>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <select
                    value={m.default_workspace_role || 'editor'}
                    disabled={busy === m.email}
                    onChange={(e) => handleRoleChange(m.email, e.target.value, m.default_trainee_role || 'none')}
                    className="border border-violet-200 bg-white rounded-lg px-2 py-1 text-[11px]"
                    aria-label={`สิทธิ์ตารางของ ${m.email}`}
                  >
                    <option value="editor">ตาราง: แก้ไขได้</option>
                    <option value="viewer">ตาราง: อ่านอย่างเดียว</option>
                  </select>
                  <select
                    value={m.default_trainee_role || 'none'}
                    disabled={busy === m.email}
                    onChange={(e) => handleRoleChange(m.email, m.default_workspace_role || 'editor', e.target.value)}
                    className="border border-violet-200 bg-white rounded-lg px-2 py-1 text-[11px]"
                    aria-label={`สิทธิ์โมดูล นศ. ของ ${m.email}`}
                  >
                    <option value="none">นศ.: ไม่เห็น</option>
                    <option value="viewer">นศ.: อ่าน</option>
                    <option value="editor">นศ.: แก้ไข</option>
                  </select>
                </div>
              </div>
            ))}
          </div>
        )}

        {memberships.length > 0 && (
          <div className="pt-2 border-t border-gray-100 space-y-1.5">
            <div className="text-xs font-semibold text-gray-600">ทีมที่คุณเข้าร่วม</div>
            {memberships.map((m) => (
              <div key={m.owner_id} className="flex items-center gap-2 text-xs text-gray-600 bg-gray-50 border border-gray-200 rounded-lg px-3 py-1.5">
                <Users className="w-3.5 h-3.5 text-gray-400 shrink-0" />
                <span className="truncate">{m.owner_name || m.owner_email || m.owner_id}</span>
              </div>
            ))}
          </div>
        )}

        <div className="flex items-start gap-2 text-[11px] text-gray-500 bg-blue-50 border border-blue-100 rounded-lg px-3 py-2">
          <Info className="w-3.5 h-3.5 text-blue-500 shrink-0 mt-0.5" />
          <span>ต้องการแชร์เฉพาะบางตาราง? ไปที่หน้าแรก → ไอคอนแชร์ของตารางนั้น แล้วเลือก &quot;เฉพาะรายชื่อ&quot;</span>
        </div>
      </div>
    </div>
  )
}
