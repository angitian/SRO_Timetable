import { useState, useMemo } from 'react'
import {
  BarChart3, Users, CalendarClock, AlertTriangle, ArrowLeft,
  Printer, FileDown, TrendingUp, UserX,
} from 'lucide-react'
import { useApp } from '../../context/AppContext.jsx'
import DateField from '../../components/common/DateField.jsx'
import {
  computeBaseTeacherLoad, computeSubstituteStats, buildStatsRows,
  mondayOfWeek, isDateInRange, computeAbsenceReasonStats,
} from '../substitute/substituteStats.js'
import { todayISO, formatShortDate, DAY_LABELS, normalizeDailySchedule } from '../substitute/dailySchedule.js'
import { exportStatsPDF, exportStatsExcel } from '../substitute/exportDailySchedule.js'

function toISODate(d) {
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${m}-${day}`
}

export default function TeacherDashboardPage() {
  const { fixtureData, result, userPlacements, dailySchedules, setStep } = useApp()
  const [range, setRange] = useState('week')
  const [customFrom, setCustomFrom] = useState('')
  const [customTo, setCustomTo] = useState('')
  const [exporting, setExporting] = useState(false)

  const { fromDate, toDate } = useMemo(() => {
    const today = todayISO()
    if (range === 'week') {
      const start = mondayOfWeek(today)
      const end = new Date(`${start}T00:00:00`)
      end.setDate(end.getDate() + 6)
      return { fromDate: start, toDate: toISODate(end) }
    }
    if (range === 'month') {
      const [y, m] = today.split('-').map(Number)
      const last = new Date(y, m, 0).getDate()
      return {
        fromDate: `${y}-${String(m).padStart(2, '0')}-01`,
        toDate: `${y}-${String(m).padStart(2, '0')}-${String(last).padStart(2, '0')}`,
      }
    }
    return { fromDate: customFrom || null, toDate: customTo || null }
  }, [range, customFrom, customTo])

  const { teachers = [], lesson_blocks = [], schedule_blocks = [], schedule_config } = fixtureData || {}
  const lessonBlockMap = useMemo(() => new Map(lesson_blocks.map((lb) => [lb.id, lb])), [lesson_blocks])

  const baseLoads = useMemo(
    () => fixtureData ? computeBaseTeacherLoad({
      resultSlots: result?.slots || [],
      userPlacements,
      lessonBlockMap,
      scheduleBlocks: schedule_blocks,
      scheduleConfig: schedule_config,
      fixedSlots: fixtureData.fixed_slots,
    }) : {},
    [fixtureData, result, userPlacements, lessonBlockMap, schedule_blocks, schedule_config],
  )
  const subStats = useMemo(
    () => computeSubstituteStats(dailySchedules, { fromDate, toDate, scheduleBlocks: schedule_blocks, scheduleConfig: schedule_config }),
    [dailySchedules, fromDate, toDate, schedule_blocks, schedule_config],
  )
  const rows = useMemo(
    () => buildStatsRows({ teachers, baseLoads, subStats, fromDate, toDate }),
    [teachers, baseLoads, subStats, fromDate, toDate],
  )
  const reasonStats = useMemo(
    () => computeAbsenceReasonStats(dailySchedules, { fromDate, toDate }),
    [dailySchedules, fromDate, toDate],
  )
  const weeklyTotals = useMemo(() => {
    const map = {}
    for (const ds of Object.values(dailySchedules || {})) {
      if (!isDateInRange(ds.date, fromDate, toDate)) continue
      const wk = mondayOfWeek(ds.date)
      map[wk] = (map[wk] || 0) + (ds.assignments?.length || 0)
    }
    return Object.entries(map).sort((a, b) => a[0].localeCompare(b[0]))
  }, [dailySchedules, fromDate, toDate])
  const absentIdsInRange = useMemo(() => {
    const set = new Set()
    for (const ds of Object.values(dailySchedules || {})) {
      if (!isDateInRange(ds.date, fromDate, toDate)) continue
      const norm = normalizeDailySchedule(ds)
      for (const a of norm.absences || []) set.add(a.teacherId)
    }
    return set
  }, [dailySchedules, fromDate, toDate])

  if (!fixtureData) {
    return (
      <div className="flex flex-col items-center justify-center py-20 space-y-6">
        <div className="w-20 h-20 rounded-full bg-purple-50 flex items-center justify-center">
          <BarChart3 className="w-10 h-10 text-purple-300" />
        </div>
        <div className="text-center space-y-2">
          <h2 className="text-xl font-bold text-gray-700">ยังไม่มีข้อมูล</h2>
          <p className="text-gray-500">สร้างหรือเปิดตารางสอนก่อนเพื่อดู Dashboard ภาระงานครู</p>
        </div>
        <button onClick={() => setStep(0)} className="btn-primary flex items-center gap-2">
          <ArrowLeft className="w-4 h-4" /> กลับหน้าเลือกงาน
        </button>
      </div>
    )
  }

  const totalBase = rows.reduce((s, r) => s + r.basePeriodsPerWeek, 0)
  const totalSub = rows.reduce((s, r) => s + r.subPeriods, 0)
  const overCount = (result?.teacher_loads || []).filter((l) => l.load_status === 'over').length
  const maxSub = Math.max(1, ...rows.map((r) => r.subPeriods))
  const maxReason = Math.max(1, ...reasonStats.map((r) => r.count))
  const maxWeekly = Math.max(1, ...weeklyTotals.map(([, c]) => c))

  const handleExportPDF = () => exportStatsPDF({ rows, fromDate, toDate, reasonRows: reasonStats }).catch((e) => alert(e.message))
  const handleExportExcel = async () => {
    setExporting(true)
    try { await exportStatsExcel({ rows, fromDate, toDate, reasonRows: reasonStats }) }
    catch (e) { alert(`ส่งออกไม่สำเร็จ: ${e.message}`) }
    finally { setExporting(false) }
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <button
            onClick={() => setStep(0)}
            className="p-2 rounded-lg text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition-colors"
            title="กลับหน้าเลือกงาน"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div>
            <h1 className="text-xl font-bold text-gray-800 flex items-center gap-2">
              <BarChart3 className="w-5 h-5 text-purple-600" />
              Dashboard ภาระงานครู
            </h1>
            <p className="text-xs text-gray-400">ภาระสอนปกติ + สอนแทน + เหตุผลลา รวมในหน้าเดียว</p>
          </div>
        </div>
        <div className="flex gap-1.5">
          <button onClick={handleExportPDF} className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold bg-blue-600 text-white hover:bg-blue-700 transition-colors">
            <Printer className="w-3.5 h-3.5" /> PDF
          </button>
          <button onClick={handleExportExcel} disabled={exporting} className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold bg-emerald-600 text-white hover:bg-emerald-700 transition-colors disabled:opacity-50">
            <FileDown className="w-3.5 h-3.5" /> Excel
          </button>
        </div>
      </div>

      {/* Range filter */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4">
        <div className="flex flex-wrap items-center gap-2">
          <CalendarClock className="w-4 h-4 text-blue-600" />
          <span className="text-sm font-bold text-gray-700">ช่วงเวลา</span>
          <div className="flex gap-1.5 ml-2">
            {[['week', 'สัปดาห์นี้'], ['month', 'เดือนนี้'], ['custom', 'ช่วงวันที่เอง']].map(([val, label]) => (
              <button
                key={val}
                onClick={() => setRange(val)}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors
                  ${range === val ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
              >
                {label}
              </button>
            ))}
          </div>
          {range === 'custom' && (
            <div className="flex items-center gap-1.5 ml-2">
              <DateField value={customFrom} onChange={setCustomFrom} title="ตั้งแต่วันที่" />
              <span className="text-gray-400 text-xs">ถึง</span>
              <DateField value={customTo} onChange={setCustomTo} title="ถึงวันที่" />
            </div>
          )}
        </div>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4">
          <div className="text-3xl font-bold text-blue-600">{teachers.length}</div>
          <div className="text-xs text-gray-500 mt-1 flex items-center gap-1"><Users className="w-3 h-3" /> ครูทั้งหมด</div>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4">
          <div className="text-3xl font-bold text-gray-800">{totalBase}</div>
          <div className="text-xs text-gray-500 mt-1 flex items-center gap-1"><TrendingUp className="w-3 h-3" /> คาบสอน/สัปดาห์รวม</div>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4">
          <div className={`text-3xl font-bold ${overCount > 0 ? 'text-red-600' : 'text-green-600'}`}>{overCount}</div>
          <div className="text-xs text-gray-500 mt-1 flex items-center gap-1"><AlertTriangle className="w-3 h-3" /> ครูเกินเพดาน</div>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4">
          <div className="text-3xl font-bold text-orange-600">{totalSub}</div>
          <div className="text-xs text-gray-500 mt-1 flex items-center gap-1"><CalendarClock className="w-3 h-3" /> คาบสอนแทน (ช่วงนี้)</div>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4">
          <div className="text-3xl font-bold text-red-600">{absentIdsInRange.size}</div>
          <div className="text-xs text-gray-500 mt-1 flex items-center gap-1"><UserX className="w-3 h-3" /> ครูลา (ช่วงนี้)</div>
        </div>
      </div>

      {/* Teacher table */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4">
        <h3 className="font-bold text-gray-800 text-sm mb-3">ภาระครู/นศ.ฝึกสอน: สอนปกติ vs สอนแทน</h3>
        <div className="overflow-x-auto rounded-lg border border-gray-200">
          <table className="min-w-full text-xs">
            <thead>
              <tr className="bg-gray-50">
                <th className="px-2 py-2 text-left text-gray-500 font-semibold">#</th>
                <th className="px-2 py-2 text-left text-gray-500 font-semibold">ครู / นศ.ฝึกสอน</th>
                <th className="px-2 py-2 text-center text-gray-500 font-semibold">คาบปกติ/สัปดาห์</th>
                <th className="px-2 py-2 text-center text-gray-500 font-semibold">ชม./สัปดาห์</th>
                <th className="px-2 py-2 text-center text-orange-600 font-semibold">คาบสอนแทน</th>
                <th className="px-2 py-2 text-center text-gray-500 font-semibold">ชม.สอนแทน</th>
                <th className="px-2 py-2 text-center text-gray-500 font-semibold">รวมคาบ</th>
                <th className="px-2 py-2 text-center text-gray-500 font-semibold">% สัดส่วน</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.teacherId} className="border-t border-gray-100 hover:bg-gray-50/60">
                  <td className="px-2 py-2 text-gray-400">{r.rank}</td>
                  <td className="px-2 py-2 font-medium text-gray-800">
                    {r.teacherName}
                    {r.personKind === 'trainee' && (
                      <span className="ml-1 text-[10px] px-1.5 py-0.5 rounded-full bg-violet-100 text-violet-700 font-semibold">🎓 นศ.</span>
                    )}
                  </td>
                  <td className="px-2 py-2 text-center text-gray-600">{r.basePeriodsPerWeek}</td>
                  <td className="px-2 py-2 text-center text-gray-600">{r.baseHoursPerWeek.toFixed(1)}</td>
                  <td className="px-2 py-2 text-center">
                    <span className={`inline-flex items-center justify-center min-w-[2rem] px-2 py-0.5 rounded-full text-xs font-bold
                      ${r.subPeriods > 0 ? 'bg-orange-100 text-orange-700' : 'bg-gray-100 text-gray-400'}`}>
                      {r.subPeriods}
                    </span>
                  </td>
                  <td className="px-2 py-2 text-center text-gray-600">{r.subHours.toFixed(1)}</td>
                  <td className="px-2 py-2 text-center text-gray-600">{r.totalPeriods}</td>
                  <td className="px-2 py-2">
                    <div className="flex items-center gap-1.5">
                      <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                        <div className="h-full bg-orange-500 rounded-full" style={{ width: `${Math.min(100, (r.subPeriods / maxSub) * 100)}%` }} />
                      </div>
                      <span className="text-[11px] text-gray-500 w-10 text-right">{r.sharePct.toFixed(1)}%</span>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Charts row: weekly subs + absence reasons */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4">
          <h3 className="font-bold text-gray-800 text-sm mb-3">คาบสอนแทนรายสัปดาห์</h3>
          {weeklyTotals.length === 0 ? (
            <div className="text-xs text-gray-400 italic">ไม่มีข้อมูลสอนแทนในช่วงนี้</div>
          ) : (
            <div className="space-y-2">
              {weeklyTotals.map(([wk, count]) => (
                <div key={wk} className="flex items-center gap-3">
                  <span className="text-xs text-gray-600 w-40 shrink-0">สัปดาห์ของ {formatShortDate(wk)}</span>
                  <div className="flex-1 h-2.5 bg-gray-100 rounded-full overflow-hidden">
                    <div className="h-full bg-blue-500 rounded-full" style={{ width: `${(count / maxWeekly) * 100}%` }} />
                  </div>
                  <span className="text-xs font-bold text-gray-700 w-8 text-right">{count} คาบ</span>
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4">
          <h3 className="font-bold text-gray-800 text-sm mb-3">สถิติเหตุผลที่ลา</h3>
          {reasonStats.length === 0 ? (
            <div className="text-xs text-gray-400 italic">ไม่มีข้อมูลการลาในช่วงนี้</div>
          ) : (
            <div className="space-y-2">
              {reasonStats.map((r) => (
                <div key={r.reason} className="flex items-center gap-3">
                  <span className="text-xs text-gray-600 w-32 shrink-0 truncate">{r.reason}</span>
                  <div className="flex-1 h-2.5 bg-gray-100 rounded-full overflow-hidden">
                    <div className="h-full bg-purple-500 rounded-full" style={{ width: `${(r.count / maxReason) * 100}%` }} />
                  </div>
                  <span className="text-xs font-bold text-gray-700 w-12 text-right">{r.count} ครั้ง</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
