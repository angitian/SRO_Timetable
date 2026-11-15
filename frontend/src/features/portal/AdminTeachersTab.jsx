import { useEffect, useState } from 'react'
import { RefreshCw, Wand2, KeyRound, Info } from 'lucide-react'
import {
  inferAdminDepts, resetAdminPin, syncAdminTeachers, updateAdminTeacher,
} from '../../api/portal.js'

function TeacherRow({ teacher, onSave, onResetPin, onError }) {
  const [dept, setDept] = useState(teacher.dept || '')
  const [phone, setPhone] = useState(teacher.phone || '')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    setDept(teacher.dept || '')
    setPhone(teacher.phone || '')
  }, [teacher.dept, teacher.phone])

  const dirty = dept !== (teacher.dept || '') || phone !== (teacher.phone || '')

  return (
    <tr>
      <td className="px-3 py-2 font-mono text-xs text-slate-500">{teacher.teacher_id}</td>
      <td className="px-3 py-2 font-medium text-slate-800">{teacher.display_name}</td>
      <td className="px-3 py-2">
        <input
          value={dept}
          onChange={(e) => setDept(e.target.value)}
          placeholder="กลุ่มสาระ"
          className="w-36 min-h-[32px] rounded border border-slate-300 px-2 text-sm"
        />
      </td>
      <td className="px-3 py-2">
        <input
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          placeholder="08x-xxx-xxxx"
          className="w-36 min-h-[32px] rounded border border-slate-300 px-2 text-sm"
        />
      </td>
      <td className="px-3 py-2">
        <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${
          teacher.has_pin ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'
        }`}>
          {teacher.has_pin ? 'ตั้งแล้ว' : 'ยังไม่มี PIN'}
        </span>
        {teacher.pin_locked && <span className="ml-1 text-[11px] text-rose-600">ถูกล็อก</span>}
        {!teacher.is_active && <span className="ml-1 text-[11px] text-slate-400">ปิดใช้งาน</span>}
      </td>
      <td className="px-3 py-2 text-right whitespace-nowrap">
        <button
          onClick={async () => {
            setBusy(true)
            try {
              await onSave({ dept, phone })
            } catch (e) {
              onError?.(e.message)
            } finally {
              setBusy(false)
            }
          }}
          disabled={!dirty || busy}
          className="text-xs font-semibold text-blue-600 disabled:text-slate-300"
        >
          บันทึก
        </button>
        <button onClick={onResetPin} className="ml-3 text-xs font-semibold text-amber-600">
          รีเซ็ต PIN
        </button>
      </td>
    </tr>
  )
}

export default function AdminTeachersTab({
  code, teachers = [], workspaceTeacherCount = 0, onRefresh, onError, onNotice,
}) {
  const [busy, setBusy] = useState(false)

  async function sync() {
    setBusy(true)
    try {
      const body = await syncAdminTeachers(code)
      onNotice?.(`ซิงก์รายชื่อแล้ว: เพิ่ม/อัปเดต ${body.upserted} คน, ปิดใช้งาน ${body.deactivated} คน`)
      await onRefresh?.()
    } catch (e) {
      onError?.(e.message)
    } finally {
      setBusy(false)
    }
  }

  async function infer() {
    setBusy(true)
    try {
      const body = await inferAdminDepts(code)
      onNotice?.(`เดากลุ่มสาระให้ ${body.updated} คน (จากวิชาที่สอน)`)
      await onRefresh?.()
    } catch (e) {
      onError?.(e.message)
    } finally {
      setBusy(false)
    }
  }

  const missingDept = teachers.filter((t) => !t.dept).length
  const missingPin = teachers.filter((t) => !t.has_pin).length

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-sm font-bold text-slate-700">ทะเบียนครู ({teachers.length})</h2>
        <button
          onClick={sync}
          disabled={busy}
          className="min-h-[34px] px-3 rounded-lg border border-slate-300 text-xs font-semibold inline-flex items-center gap-1.5 disabled:opacity-50"
        >
          <RefreshCw className="w-3.5 h-3.5" /> ซิงก์จาก workspace
        </button>
        <button
          onClick={infer}
          disabled={busy || !missingDept}
          className="min-h-[34px] px-3 rounded-lg border border-violet-300 text-xs font-semibold text-violet-700 inline-flex items-center gap-1.5 disabled:opacity-40"
          title="เดากลุ่มสาระจากวิชาที่ครูสอน (เฉพาะช่องที่ว่าง)"
        >
          <Wand2 className="w-3.5 h-3.5" /> เดากลุ่มสาระ ({missingDept})
        </button>
        <span className="ml-auto text-[11px] text-slate-500">
          ยังไม่มี PIN {missingPin} คน · กรอกเบอร์โทรเพื่อตั้ง PIN เริ่มต้น (4 ตัวท้าย)
        </span>
      </div>

      {teachers.length === 0 && (
        <div className="rounded-xl border border-dashed border-slate-300 bg-white/70 p-6 text-center text-sm text-slate-500 space-y-1">
          {workspaceTeacherCount === 0 ? (
            <>
              <p className="font-semibold text-amber-700">workspace นี้ยังไม่มีข้อมูลครู</p>
              <p>
                งานที่สร้างจากลิงก์แชร์เดิมจะไม่มีรายชื่อครู — เปิดงานในแอปแล้วกด
                “บันทึกขึ้นคลาวด์” หนึ่งครั้ง จากนั้นกลับมาซิงก์
              </p>
            </>
          ) : (
            <>
              <p className="font-semibold text-slate-700">
                พบครู {workspaceTeacherCount} คนใน workspace แต่ยังไม่ถูกซิงก์
              </p>
              <p>กด “ซิงก์จาก workspace” เพื่อดึงรายชื่อเข้ามา</p>
            </>
          )}
        </div>
      )}

      {teachers.length > 0 && (
        <div className="bg-white rounded-xl border border-slate-200 overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th className="px-3 py-2 text-left font-semibold">รหัส</th>
                <th className="px-3 py-2 text-left font-semibold">ชื่อ-สกุล</th>
                <th className="px-3 py-2 text-left font-semibold">กลุ่มสาระ</th>
                <th className="px-3 py-2 text-left font-semibold">เบอร์โทร</th>
                <th className="px-3 py-2 text-left font-semibold">PIN</th>
                <th className="px-3 py-2 text-right font-semibold">จัดการ</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {teachers.map((teacher) => (
                <TeacherRow
                  key={teacher.teacher_id}
                  teacher={teacher}
                  onSave={async (payload) => {
                    await updateAdminTeacher(code, teacher.teacher_id, payload)
                    await onRefresh?.()
                  }}
                  onResetPin={async () => {
                    try {
                      const body = await resetAdminPin(code, teacher.teacher_id)
                      onNotice?.(
                        body.pin_source === 'last4_phone'
                          ? `รีเซ็ต PIN ของ ${teacher.display_name} เป็น 4 ตัวท้ายของเบอร์แล้ว`
                          : `ตั้ง PIN ใหม่ของ ${teacher.display_name} แล้ว`,
                      )
                      await onRefresh?.()
                    } catch (e) {
                      onError?.(e.message)
                    }
                  }}
                  onError={onError}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="flex items-start gap-1.5 text-[11px] text-slate-500">
        <Info className="w-3.5 h-3.5 mt-0.5 shrink-0" />
        กลุ่มสาระใช้กำหนดว่าใครต้องเข้าร่วมกิจกรรม/ต้องส่งงาน — ระบบเดาจากวิชาที่สอนให้ก่อน
        แต่แก้ได้ตลอด
        <KeyRound className="w-3.5 h-3.5 mt-0.5 shrink-0" />
        PIN เริ่มต้น = เลข 4 ตัวท้ายของเบอร์โทร
      </p>
    </section>
  )
}
