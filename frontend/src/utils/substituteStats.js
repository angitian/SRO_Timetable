/**
 * Substitute statistics — สถิติภาระครู (สอนปกติ + สอนแทน)
 *
 * ใช้ยืนยันความเป็นธรรมเมื่อครูบ่นว่ารับสอนแทนบ่อยเกินไป:
 *   - ภาระฐาน (base load): จากตารางหลัก (solver slots + user placements)
 *   - ภาระสอนแทน: จาก dailySchedules (รายวัน) ตามช่วงวันที่เลือก
 * ชั่วโมงคำนวณจากช่วงเวลาจริงของ schedule block (ไม่นับ lunch/break)
 */
import { getPeriodDurationMinutes } from './dailySchedule.js'
import { flattenClassTeachers } from './teacherLoad.js'

/** ตรวจว่าวันที่อยู่ในช่วง (จาก/ถึง) หรือไม่ — เปรียบเทียบ string YYYY-MM-DD */
export function isDateInRange(dateStr, fromDate, toDate) {
  return (!fromDate || dateStr >= fromDate) && (!toDate || dateStr <= toDate)
}

/**
 * ภาระฐานของครูแต่ละคนจากตารางหลัก
 * คืน { [teacherId]: { periodsPerWeek, periodsPerDay:{day:count}, minutesPerDay:{}, minutesPerWeek } }
 * co-teacher นับทั้งสองฝั่ง + คาบดูแลกิจกรรม (fixed slots class_teachers) นับด้วย
 */
export function computeBaseTeacherLoad({
  resultSlots,
  userPlacements,
  lessonBlockMap,
  scheduleBlocks,
  scheduleConfig,
  fixedSlots,
}) {
  const loads = {}
  const touch = (tid) => {
    if (!loads[tid]) {
      loads[tid] = {
        periodsPerWeek: 0,
        periodsPerDay: {},
        minutesPerDay: {},
        minutesPerWeek: 0,
      }
    }
  }
  const add = (slot) => {
    const lb = lessonBlockMap.get(slot.lesson_block_id)
    const teacherIds = new Set([slot.teacher_id])
    if (lb?.co_teacher_id) teacherIds.add(lb.co_teacher_id)
    else if (slot.co_teacher_id) teacherIds.add(slot.co_teacher_id)
    const mins = getPeriodDurationMinutes(slot.class_id, slot.period, scheduleBlocks, scheduleConfig)
    for (const tid of teacherIds) {
      touch(tid)
      const L = loads[tid]
      L.periodsPerWeek += 1
      L.periodsPerDay[slot.day] = (L.periodsPerDay[slot.day] || 0) + 1
      L.minutesPerDay[slot.day] = (L.minutesPerDay[slot.day] || 0) + mins
      L.minutesPerWeek += mins
    }
  }
  for (const s of resultSlots || []) add(s)
  for (const [lbId, placements] of Object.entries(userPlacements || {})) {
    const lb = lessonBlockMap.get(lbId)
    if (!lb) continue
    for (const p of placements) {
      add({
        lesson_block_id: lbId,
        teacher_id: lb.teacher_id,
        class_id: lb.class_id,
        day: p.day,
        period: p.period,
        co_teacher_id: lb.co_teacher_id,
      })
    }
  }
  // คาบดูแลกิจกรรม (fixed slots) — ภาระคงที่ของครูผู้ดูแล (1 คาบ/ครู/สัปดาห์ ไม่คูณห้อง)
  for (const fs of fixedSlots || []) {
    const periods = [...new Set([fs.period, ...(fs.periods || [])])]
    const seen = new Set()
    for (const tid of flattenClassTeachers(fs.class_teachers)) {
      if (seen.has(tid)) continue
      seen.add(tid)
      touch(tid)
      const L = loads[tid]
      for (const p of periods) {
        const mins = getPeriodDurationMinutes(fs.class_ids?.[0] || '', p, scheduleBlocks, scheduleConfig)
        L.periodsPerWeek += 1
        L.periodsPerDay[fs.day] = (L.periodsPerDay[fs.day] || 0) + 1
        L.minutesPerDay[fs.day] = (L.minutesPerDay[fs.day] || 0) + mins
        L.minutesPerWeek += mins
      }
    }
  }
  return loads
}

/**
 * วันที่เริ่มสัปดาห์ (จันทร์) ของสัปดาห์ที่มี dateStr — 'YYYY-MM-DD'
 */
export function mondayOfWeek(dateStr) {
  const d = new Date(`${dateStr}T00:00:00`)
  const dow = (d.getDay() + 6) % 7 // จันทร์=0
  d.setDate(d.getDate() - dow)
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${m}-${day}`
}

/**
 * สถิติสอนแทนจาก dailySchedules ตามช่วงวันที่
 * คืน { [teacherId]: { periods, minutes, periodsPerDate:{date:count}, periodsPerWeek:{monday:count} } }
 * ชั่วโมงคำนวณจากช่วงเวลาจริงของ block (รับ scheduleBlocks/scheduleConfig ต่อจาก caller)
 */
export function computeSubstituteStats(dailySchedules, { fromDate, toDate, scheduleBlocks, scheduleConfig } = {}) {
  const stats = {}
  for (const ds of Object.values(dailySchedules || {})) {
    if (!isDateInRange(ds.date, fromDate, toDate)) continue
    const weekStart = mondayOfWeek(ds.date)
    for (const a of ds.assignments || []) {
      const tid = a.substitute_teacher_id
      if (!stats[tid]) {
        stats[tid] = { periods: 0, minutes: 0, periodsPerDate: {}, periodsPerWeek: {} }
      }
      const S = stats[tid]
      S.periods += 1
      S.minutes += getPeriodDurationMinutes(a.class_id, a.period, scheduleBlocks, scheduleConfig)
      S.periodsPerDate[ds.date] = (S.periodsPerDate[ds.date] || 0) + 1
      S.periodsPerWeek[weekStart] = (S.periodsPerWeek[weekStart] || 0) + 1
    }
  }
  return stats
}

/** รวมสถิติสอนแทนทั้งระบบตามช่วง: { totalPeriods, teacherCount, busiestTeacherId } */
export function computeSubstituteSummary(dailySchedules, { fromDate, toDate, scheduleBlocks, scheduleConfig } = {}) {
  const stats = computeSubstituteStats(dailySchedules, { fromDate, toDate, scheduleBlocks, scheduleConfig })
  let totalPeriods = 0
  let busiestTeacherId = null
  let busiestCount = 0
  for (const [tid, s] of Object.entries(stats)) {
    totalPeriods += s.periods
    if (s.periods > busiestCount) {
      busiestCount = s.periods
      busiestTeacherId = tid
    }
  }
  return { totalPeriods, teacherCount: Object.keys(stats).length, busiestTeacherId, busiestCount }
}

/**
 * รวมตารางรายงานสถิติต่อครู (ใช้แสดง + export)
 * rows: [{ rank, teacherId, teacherName, basePeriodsPerWeek, baseHoursPerWeek,
 *          subPeriods, subHours, totalPeriods, sharePct }]
 * เรียงจากรับสอนแทนมากสุด
 */
export function buildStatsRows({
  teachers,
  baseLoads,
  subStats,
  fromDate,
  toDate,
}) {
  const totalSub = Object.values(subStats || {}).reduce((sum, s) => sum + s.periods, 0) || 1
  const rows = (teachers || [])
    .map((t) => {
      const base = baseLoads[t.id] || {}
      const sub = subStats[t.id] || { periods: 0, minutes: 0 }
      return {
        teacherId: t.id,
        teacherName: t.name,
        basePeriodsPerWeek: base.periodsPerWeek || 0,
        baseHoursPerWeek: ((base.minutesPerWeek || 0) / 60),
        subPeriods: sub.periods || 0,
        subHours: ((sub.minutes || 0) / 60),
        totalPeriods: (base.periodsPerWeek || 0) + (sub.periods || 0),
        sharePct: Math.round(((sub.periods || 0) / totalSub) * 1000) / 10,
      }
    })
    .sort((a, b) => b.subPeriods - a.subPeriods)
    .map((r, i) => ({ ...r, rank: i + 1 }))
  return rows
}

/** label ช่วงวันที่ เช่น 'สัปดาห์ 29 ก.ย. – 5 ต.ค. 69' หรือ '6 ต.ค. 69' */
export function rangeLabel(fromDate, toDate) {
  if (!fromDate && !toDate) return 'ทั้งหมด'
  if (fromDate && toDate) {
    if (fromDate === toDate) return `วันที่ ${fromDate}`
    return `${fromDate} ถึง ${toDate}`
  }
  if (fromDate) return `ตั้งแต่วันที่ ${fromDate}`
  return `ถึงวันที่ ${toDate}`
}
