import { Fragment, useMemo, useState } from 'react'
import {
  CalendarDays,
  ChevronDown,
  ChevronRight,
  Download,
  Printer,
  TrendingUp,
  UserX,
  Users,
} from 'lucide-react'
import {
  STATUS_META,
  buildDashboardCSV,
  buildDashboardStats,
  dashboardRange,
  dashboardRangeLabel,
  downloadText,
  formatThaiDate,
  mentorDisplayLine,
  todayISO,
  traineeTeachingLines,
} from '../../utils/traineeAttendance.js'
import TraineeDateField from './TraineeDateField.jsx'

const DASH_MODES = [
  { value: 'semester', label: 'ภาคเรียน' },
  { value: 'month', label: 'รายเดือน' },
  { value: 'week', label: 'รายสัปดาห์' },
  { value: 'day', label: 'รายวัน' },
]

function KpiCard({ icon: Icon, label, value, sub, tone = 'slate' }) {
  const tones = {
    slate: 'bg-white border-slate-200 text-slate-800',
    emerald: 'bg-emerald-50 border-emerald-100 text-emerald-700',
    amber: 'bg-amber-50 border-amber-100 text-amber-700',
    blue: 'bg-blue-50 border-blue-100 text-blue-700',
    rose: 'bg-rose-50 border-rose-100 text-rose-700',
    violet: 'bg-violet-50 border-violet-100 text-violet-700',
  }
  return (
    <div className={`rounded-2xl border p-4 shadow-sm ${tones[tone] || tones.slate}`}>
      <div className="flex items-center gap-2 text-[11px] font-semibold opacity-80">
        {Icon && <Icon className="w-3.5 h-3.5" />}
        {label}
      </div>
      <div className="text-2xl font-bold mt-1">{value}</div>
      {sub && <div className="text-[11px] opacity-70 mt-1">{sub}</div>}
    </div>
  )
}

function TrendBar({ bucket, maxTotal }) {
  const total = bucket.total || 0
  const width = total ? Math.max(4, Math.round((total / Math.max(1, maxTotal)) * 100)) : 0
  const segments = [
    ['present', 'bg-emerald-500'],
    ['late', 'bg-amber-400'],
    ['leave', 'bg-blue-400'],
    ['absent', 'bg-rose-500'],
  ]
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between gap-3 text-xs">
        <span className="font-medium text-slate-600">{bucket.label}</span>
        <span className="text-slate-400">{total} รายการ</span>
      </div>
      <div className="h-2.5 rounded-full bg-slate-100 overflow-hidden" title={`ปกติ ${bucket.present} · สาย ${bucket.late} · ลา ${bucket.leave} · ขาด ${bucket.absent}`}>
        <div className="h-full flex" style={{ width: `${width}%` }}>
          {segments.map(([key, cls]) => {
            const pct = total ? (bucket[key] / total) * 100 : 0
            return pct ? <span key={key} className={cls} style={{ width: `${pct}%` }} /> : null
          })}
        </div>
      </div>
    </div>
  )
}

const BREAKDOWN_MODES = [
  { value: 'trainee', label: 'รายคน' },
  { value: 'major', label: 'วิชาเอก' },
  { value: 'institution', label: 'สถาบัน' },
  { value: 'mentor', label: 'ครูพี่เลี้ยง' },
  { value: 'subject', label: 'วิชาที่สอน' },
]

function UnifiedBreakdownTable({ stats }) {
  const [mode, setMode] = useState('trainee')
  const [expanded, setExpanded] = useState(new Set())
  const perTraineeMap = new Map((stats.perTrainee || []).map((row) => [row.trainee.id, row]))
  const groupedRows = {
    trainee: (stats.perTrainee || []).map((row) => ({
      key: row.trainee.name || row.trainee.id,
      traineeCount: 1,
      trainees: [row.trainee],
      ...row,
    })),
    major: stats.byMajor || [],
    institution: stats.byInstitution || [],
    mentor: stats.byMentor || [],
    subject: stats.bySubject || [],
  }
  const rows = groupedRows[mode] || []

  function toggle(key) {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  function detailLine(trainee) {
    return [
      [trainee.major, trainee.institution].filter(Boolean).join(' · '),
      mentorDisplayLine(trainee) ? `พี่เลี้ยง: ${mentorDisplayLine(trainee)}` : '',
      traineeTeachingLines(trainee)[0] || '',
    ].filter(Boolean).join(' / ')
  }

  return (
    <section className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
      <div className="px-4 py-3 border-b border-slate-100 flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-sm font-bold text-slate-800">ตารางสรุปนักศึกษา</h3>
        <div className="flex flex-wrap gap-1.5">
          {BREAKDOWN_MODES.map((item) => (
            <button
              key={item.value}
              onClick={() => { setMode(item.value); setExpanded(new Set()) }}
              className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold ${
                mode === item.value ? 'bg-violet-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >{item.label}</button>
          ))}
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[760px] text-xs">
          <thead className="bg-slate-50 text-slate-500">
            <tr>
              <th className="px-3 py-2 text-left">{mode === 'trainee' ? 'นักศึกษา' : 'กลุ่ม'}</th>
              <th className="px-3 py-2 text-left">รายละเอียด</th>
              <th className="px-3 py-2 text-center">คน</th>
              <th className="px-3 py-2 text-center">ปกติ</th>
              <th className="px-3 py-2 text-center">สาย</th>
              <th className="px-3 py-2 text-center">ลา</th>
              <th className="px-3 py-2 text-center">ขาด</th>
              <th className="px-3 py-2 text-center">รวม</th>
              <th className="px-3 py-2 text-center">มา%</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.length === 0 ? (
              <tr><td colSpan={9} className="px-3 py-6 text-center text-slate-400">ยังไม่มีข้อมูล</td></tr>
            ) : rows.map((row) => {
              const isExpanded = expanded.has(row.key)
              const expandable = mode !== 'trainee'
              return (
                <Fragment key={row.key}>
                  <tr className="hover:bg-slate-50/60">
                    <td className="px-3 py-2 font-medium text-slate-700">
                      <button
                        type="button"
                        onClick={() => expandable && toggle(row.key)}
                        className={`flex items-center gap-1 text-left ${expandable ? '' : 'cursor-default'}`}
                      >
                        {expandable && (isExpanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />)}
                        {row.key}
                      </button>
                    </td>
                    <td className="px-3 py-2 text-slate-500">{mode === 'trainee' ? detailLine(row.trainees[0]) : `${row.traineeCount} คน`}</td>
                    <td className="px-3 py-2 text-center text-slate-500">{row.traineeCount}</td>
                    <td className="px-3 py-2 text-center font-semibold text-emerald-700">{row.present}</td>
                    <td className="px-3 py-2 text-center font-semibold text-amber-700">{row.late}</td>
                    <td className="px-3 py-2 text-center font-semibold text-blue-700">{row.leave}</td>
                    <td className="px-3 py-2 text-center font-semibold text-rose-700">{row.absent}</td>
                    <td className="px-3 py-2 text-center font-bold text-slate-700">{row.total}</td>
                    <td className="px-3 py-2 text-center text-slate-600">{row.attendedRate}%</td>
                  </tr>
                  {expandable && isExpanded && (row.trainees || []).map((trainee) => {
                    const sub = perTraineeMap.get(trainee.id)
                    return (
                      <tr key={`${row.key}-${trainee.id}`} className="bg-slate-50/50">
                        <td className="px-3 py-2 pl-9 text-slate-600">{trainee.name}</td>
                        <td className="px-3 py-2 text-slate-400">{detailLine(trainee)}</td>
                        <td className="px-3 py-2 text-center text-slate-400">1</td>
                        <td className="px-3 py-2 text-center text-emerald-600">{sub?.present || 0}</td>
                        <td className="px-3 py-2 text-center text-amber-600">{sub?.late || 0}</td>
                        <td className="px-3 py-2 text-center text-blue-600">{sub?.leave || 0}</td>
                        <td className="px-3 py-2 text-center text-rose-600">{sub?.absent || 0}</td>
                        <td className="px-3 py-2 text-center text-slate-500">{sub?.total || 0}</td>
                        <td className="px-3 py-2 text-center text-slate-500">{sub?.attendedRate || 0}%</td>
                      </tr>
                    )
                  })}
                </Fragment>
              )
            })}
          </tbody>
        </table>
      </div>
    </section>
  )
}

function TopList({ title, rows, field, tone }) {
  const colors = {
    amber: 'text-amber-700 bg-amber-50 border-amber-100',
    rose: 'text-rose-700 bg-rose-50 border-rose-100',
  }
  return (
    <section className="rounded-2xl border border-slate-200 bg-white shadow-sm p-4">
      <h3 className="text-sm font-bold text-slate-800 mb-3">{title}</h3>
      {rows.length === 0 ? (
        <p className="text-xs text-slate-400">ยังไม่มีรายการ</p>
      ) : (
        <div className="space-y-2">
          {rows.map((row, index) => (
            <div key={row.trainee.id} className="flex items-center gap-3">
              <span className="w-5 text-xs text-slate-400">{index + 1}.</span>
              <div className="flex-1 min-w-0">
                <div className="text-xs font-medium text-slate-700 truncate">{row.trainee.name}</div>
                <div className="text-[10px] text-slate-400 truncate">{row.trainee.major || '—'}</div>
              </div>
              <span className={`px-2 py-0.5 rounded-full border text-[11px] font-bold ${colors[tone]}`}>
                {row[field]}
              </span>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}

export default function TraineeDashboard({ trainees = [], attendance = {}, reference = null, onPrint }) {
  const [dashMode, setDashMode] = useState('semester')
  const [dashDate, setDashDate] = useState(() => todayISO())

  const range = useMemo(
    () => dashboardRange(dashDate, dashMode, reference),
    [dashDate, dashMode, reference],
  )
  const stats = useMemo(
    () => buildDashboardStats({ trainees, attendance, range }),
    [trainees, attendance, range],
  )
  const maxTrendTotal = Math.max(0, ...stats.trend.map((b) => b.total))

  function handleExport() {
    downloadText(
      `dashboard_นักศึกษาฝึกสอน_${range.start}_${range.end}.csv`,
      buildDashboardCSV(stats),
    )
  }

  return (
    <div className="space-y-5">
      <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm print:hidden">
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-xs font-semibold text-slate-600">
            วันที่อ้างอิง
            <TraineeDateField
              value={dashDate}
              onChange={(value) => setDashDate(value || todayISO())}
              className="mt-1 block"
            />
          </label>
          <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="ช่วง Dashboard">
            {DASH_MODES.map((m) => (
              <button
                key={m.value}
                role="tab"
                aria-selected={dashMode === m.value}
                onClick={() => setDashMode(m.value)}
                className={`px-4 py-2 rounded-xl text-sm font-semibold transition-colors ${
                  dashMode === m.value ? 'bg-violet-600 text-white shadow-sm' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                {m.label}
              </button>
            ))}
          </div>
          <div className="ml-auto flex items-center gap-2">
            <button onClick={handleExport} className="flex items-center gap-1 px-3 py-2 rounded-lg text-xs font-semibold bg-blue-50 text-blue-700 border border-blue-200 hover:bg-blue-100">
              <Download className="w-3.5 h-3.5" /> ส่งออก CSV
            </button>
            <button onClick={onPrint || (() => window.print())} className="flex items-center gap-1 px-3 py-2 rounded-lg text-xs font-semibold bg-slate-50 text-slate-700 border border-slate-200 hover:bg-slate-100">
              <Printer className="w-3.5 h-3.5" /> พิมพ์รายงาน
            </button>
          </div>
        </div>
        <p className="mt-3 text-xs text-slate-500 flex items-center gap-1">
          <CalendarDays className="w-3.5 h-3.5" />
          {dashboardRangeLabel(dashDate, dashMode, reference)}
        </p>
      </section>

      <section>
        <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-3">
          <KpiCard icon={Users} label="นักศึกษาทั้งหมด" value={stats.traineeCount} sub={`${stats.recordedDays}/${stats.rangeDays} วันมีบันทึก`} tone="violet" />
          <KpiCard label="มาปฏิบัติงาน" value={`${stats.attendedRate}%`} sub={`${stats.totals.present + stats.totals.late} จาก ${stats.totals.total}`} tone="emerald" />
          <KpiCard label="ตรงเวลา" value={`${stats.punctualRate}%`} sub={`${stats.totals.present} จาก ${stats.totals.total}`} tone="blue" />
          <KpiCard label="สาย" value={stats.totals.late} tone="amber" />
          <KpiCard label="ลา" value={stats.totals.leave} tone="blue" />
          <KpiCard label="ขาด" value={stats.totals.absent} tone="rose" />
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white shadow-sm p-4">
        <div className="flex items-center justify-between gap-3 mb-4">
          <h3 className="text-sm font-bold text-slate-800 flex items-center gap-2">
            <TrendingUp className="w-4 h-4 text-violet-500" /> แนวโน้มการลงเวลา
          </h3>
          <div className="flex flex-wrap gap-2 text-[10px] text-slate-500">
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-emerald-500" />ปกติ</span>
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-amber-400" />สาย</span>
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-blue-400" />ลา</span>
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-rose-500" />ขาด</span>
          </div>
        </div>
        {stats.trend.length === 0 ? (
          <p className="text-sm text-slate-400">ยังไม่มีข้อมูลในช่วงที่เลือก</p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-x-6 gap-y-4">
            {stats.trend.map((bucket) => (
              <TrendBar key={bucket.key} bucket={bucket} maxTotal={maxTrendTotal} />
            ))}
          </div>
        )}
      </section>

      <UnifiedBreakdownTable stats={stats} />

      <div className="grid grid-cols-1 xl:grid-cols-1 gap-5">
        <section className="rounded-2xl border border-slate-200 bg-white shadow-sm p-4">
          <h3 className="text-sm font-bold text-slate-800 mb-3 flex items-center gap-2">
            <UserX className="w-4 h-4 text-slate-400" /> นักศึกษาที่ยังไม่มีรายการในช่วงนี้
          </h3>
          {stats.noRecordTrainees.length === 0 ? (
            <p className="text-xs text-slate-400">ทุกคนมีรายการบันทึกแล้ว</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {stats.noRecordTrainees.map((t) => (
                <span key={t.id} className="px-2.5 py-1 rounded-full bg-slate-100 text-slate-600 text-xs">
                  {t.name}
                </span>
              ))}
            </div>
          )}
        </section>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-5">
        <TopList title="Top 5 สาย" rows={stats.topLate} field="late" tone="amber" />
        <TopList title="Top 5 ขาด" rows={stats.topAbsent} field="absent" tone="rose" />
        <section className="rounded-2xl border border-slate-200 bg-white shadow-sm p-4">
          <h3 className="text-sm font-bold text-slate-800 mb-3">กิจกรรมล่าสุด</h3>
          {stats.recent.length === 0 ? (
            <p className="text-xs text-slate-400">ยังไม่มีรายการ</p>
          ) : (
            <div className="space-y-2 max-h-72 overflow-y-auto">
              {stats.recent.map((item, index) => (
                <div key={`${item.dateKey}-${item.traineeId}-${index}`} className="text-xs border-b border-slate-100 last:border-0 pb-2 last:pb-0">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-slate-500">{formatThaiDate(item.dateKey)}</span>
                    <span className={`px-2 py-0.5 rounded-full border font-semibold ${STATUS_META[item.status]?.chip || ''}`}>
                      {STATUS_META[item.status]?.label || item.status}
                    </span>
                  </div>
                  <div className="font-medium text-slate-700 mt-1 truncate">{item.traineeName}</div>
                  <div className="text-[11px] text-slate-400 truncate">
                    {[item.time, item.note].filter(Boolean).join(' · ') || '—'}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  )
}
