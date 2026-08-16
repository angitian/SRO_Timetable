import { useState, useMemo } from 'react'
import { FlaskConical, Check, X, Layers } from 'lucide-react'
import { useApp } from '../../context/AppContext.jsx'
import { getRoomTypeColor, FACILITY_TYPE_LABELS, FACILITY_TYPE_ICONS } from '../../utils/roomTypes.js'

/**
 * LabPeriodSplitter — single-row dropdown layout for splitting lesson blocks.
 *
 * Layout: [ชั้นเรียน] [ห้องเรียน (multi)] [วิชา] [คาบปกติ] [คาบแล็บ] [ห้องแล็บ] [รวมคาบ] [นำไปใช้]
 * - คาบปกติ and คาบแล็บ are manual input fields
 * - รวมคาบ = คาบปกติ + คาบแล็บ (auto-calculated, read-only)
 */
export default function LabPeriodSplitter() {
  const { fixtureData, splitLessonBlocksForLab } = useApp()
  const classes = fixtureData?.classes || []
  const subjects = fixtureData?.subjects || []
  const teachers = fixtureData?.teachers || []
  const specialRooms = fixtureData?.special_rooms || []
  const lessonBlocks = fixtureData?.lesson_blocks || []

  const subjectMap = useMemo(() => new Map(subjects.map((s) => [s.id, s])), [subjects])
  const teacherMap = useMemo(() => new Map(teachers.map((t) => [t.id, t])), [teachers])
  const classMap = useMemo(() => new Map(classes.map((c) => [c.id, c])), [classes])

  // Group classes by grade
  const classesByGrade = useMemo(() => {
    const map = {}
    for (const c of classes) {
      const key = c.grade_level || 0
      if (!map[key]) map[key] = []
      map[key].push(c)
    }
    return Object.entries(map).sort((a, b) => parseInt(a[0]) - parseInt(b[0]))
  }, [classes])

  function gradeLabel(gradeNum) {
    if (gradeNum <= 0) return `อ.${Math.abs(gradeNum - 1)}`
    if (gradeNum <= 6) return `ป.${gradeNum}`
    return `ม.${gradeNum - 6}`
  }

  // State
  const [selectedGrade, setSelectedGrade] = useState('')
  const [selectedClassIds, setSelectedClassIds] = useState([])
  const [selectedSubjectId, setSelectedSubjectId] = useState('')
  const [normalPeriods, setNormalPeriods] = useState(0)
  const [labPeriods, setLabPeriods] = useState(0)
  const [labRoomId, setLabRoomId] = useState('')

  // Classes in selected grade
  const gradeClasses = useMemo(() => {
    if (!selectedGrade) return []
    const gradeNum = parseInt(selectedGrade)
    return classesByGrade.find(([g]) => parseInt(g) === gradeNum)?.[1] || []
  }, [selectedGrade, classesByGrade])

  // Subjects available in ALL selected classes
  const availableSubjects = useMemo(() => {
    if (selectedClassIds.length === 0) return []
    const subjectIdsPerClass = {}
    for (const lb of lessonBlocks) {
      if (selectedClassIds.includes(lb.class_id)) {
        if (!subjectIdsPerClass[lb.subject_id]) subjectIdsPerClass[lb.subject_id] = new Set()
        subjectIdsPerClass[lb.subject_id].add(lb.class_id)
      }
    }
    return Object.entries(subjectIdsPerClass)
      .filter(([, classSet]) => classSet.size === selectedClassIds.length)
      .map(([sid]) => subjectMap.get(sid))
      .filter(Boolean)
  }, [selectedClassIds, lessonBlocks, subjectMap])

  // Existing total periods for selected subject across selected classes (avg)
  const existingTotalPeriods = useMemo(() => {
    if (!selectedSubjectId || selectedClassIds.length === 0) return 0
    let total = 0
    for (const lb of lessonBlocks) {
      if (selectedClassIds.includes(lb.class_id) && lb.subject_id === selectedSubjectId) {
        total += lb.periods_per_week
      }
    }
    return Math.round(total / selectedClassIds.length)
  }, [selectedSubjectId, selectedClassIds, lessonBlocks])

  // Existing splits (lesson blocks with room_id starting with SR_)
  const existingSplits = useMemo(() => {
    return lessonBlocks
      .filter((lb) => lb.room_id && lb.room_id.startsWith('SR_'))
      .map((lb) => {
        const cls = classMap.get(lb.class_id)
        const subj = subjectMap.get(lb.subject_id)
        const teacher = teacherMap.get(lb.teacher_id)
        const room = specialRooms.find((r) => r.id === lb.room_id)
        const normalBlock = lessonBlocks.find(
          (nb) => nb.class_id === lb.class_id && nb.subject_id === lb.subject_id && nb.room_id && nb.room_id.startsWith('R_'),
        )
        return {
          labBlock: lb,
          normalBlock,
          className: cls?.name || lb.class_id,
          subjectName: subj?.name || lb.subject_id,
          teacherName: teacher?.name || '',
          roomName: room?.name || lb.room_id,
          roomType: room?.room_type,
          labPeriods: lb.periods_per_week,
          normalPeriods: normalBlock?.periods_per_week || 0,
        }
      })
  }, [lessonBlocks, classMap, subjectMap, teacherMap, specialRooms])

  // When subject changes, prefill normal/lab periods from existing data
  function handleSubjectChange(subjectId) {
    setSelectedSubjectId(subjectId)
    if (subjectId && selectedClassIds.length > 0) {
      // Find existing normal + lab blocks for first selected class
      const firstClassId = selectedClassIds[0]
      const normalBlock = lessonBlocks.find(
        (lb) => lb.class_id === firstClassId && lb.subject_id === subjectId && lb.room_id && lb.room_id.startsWith('R_'),
      )
      const labBlock = lessonBlocks.find(
        (lb) => lb.class_id === firstClassId && lb.subject_id === subjectId && lb.room_id && !lb.room_id.startsWith('R_'),
      )
      setNormalPeriods(normalBlock?.periods_per_week || 0)
      setLabPeriods(labBlock?.periods_per_week || 0)
      if (labBlock) {
        setLabRoomId(labBlock.room_id)
      } else {
        setLabRoomId('')
      }
    } else {
      setNormalPeriods(0)
      setLabPeriods(0)
      setLabRoomId('')
    }
  }

  function handleSelectGrade(grade) {
    setSelectedGrade(grade)
    setSelectedClassIds([])
    setSelectedSubjectId('')
    setNormalPeriods(0)
    setLabPeriods(0)
    setLabRoomId('')
  }

  function handleToggleClass(classId) {
    setSelectedClassIds((prev) =>
      prev.includes(classId) ? prev.filter((id) => id !== classId) : [...prev, classId],
    )
    setSelectedSubjectId('')
    setNormalPeriods(0)
    setLabPeriods(0)
    setLabRoomId('')
  }

  function handleSelectAllInGrade() {
    setSelectedClassIds(gradeClasses.map((c) => c.id))
    setSelectedSubjectId('')
    setNormalPeriods(0)
    setLabPeriods(0)
    setLabRoomId('')
  }

  function handleDeselectAll() {
    setSelectedClassIds([])
    setSelectedSubjectId('')
    setNormalPeriods(0)
    setLabPeriods(0)
    setLabRoomId('')
  }

  const totalPeriods = normalPeriods + labPeriods

  function handleApply() {
    if (!selectedSubjectId || selectedClassIds.length === 0 || !labRoomId) return
    splitLessonBlocksForLab(
      selectedClassIds,
      selectedSubjectId,
      labPeriods,
      labRoomId,
    )
    // Reset lab fields but keep selection
    setNormalPeriods(0)
    setLabPeriods(0)
    setLabRoomId('')
    setSelectedSubjectId('')
  }

  function handleUnsplit(classId, subjectId) {
    splitLessonBlocksForLab([classId], subjectId, 0, '')
  }

  const canApply = selectedSubjectId && selectedClassIds.length > 0 && labRoomId && labPeriods > 0 && totalPeriods > 0

  return (
    <div className="space-y-4">
      {/* Single-row dropdown layout */}
      <div className="flex flex-wrap items-end gap-2">
        {/* ชั้นเรียน */}
        <div className="flex flex-col">
          <label className="text-xs font-medium text-gray-600 mb-1">ชั้นเรียน</label>
          <select
            value={selectedGrade}
            onChange={(e) => handleSelectGrade(e.target.value)}
            className="border border-gray-300 rounded-lg px-2.5 py-2 text-sm focus:ring-2 focus:ring-indigo-500 min-w-[100px]"
          >
            <option value="">— เลือกชั้น —</option>
            {classesByGrade.map(([gradeKey, gClasses]) => {
              const gradeNum = parseInt(gradeKey)
              return (
                <option key={gradeKey} value={gradeNum}>
                  {gradeLabel(gradeNum)} ({gClasses.length})
                </option>
              )
            })}
          </select>
        </div>

        {/* ห้องเรียน (multi-select) */}
        <div className="flex flex-col">
          <label className="text-xs font-medium text-gray-600 mb-1">
            ห้องเรียน {selectedClassIds.length > 0 && `(${selectedClassIds.length})`}
          </label>
          <div className="flex items-center gap-1">
            <select
              value=""
              onChange={(e) => { if (e.target.value) handleToggleClass(e.target.value) }}
              disabled={gradeClasses.length === 0}
              className="border border-gray-300 rounded-lg px-2.5 py-2 text-sm focus:ring-2 focus:ring-indigo-500 min-w-[120px] disabled:bg-gray-100"
            >
              <option value="">{selectedClassIds.length === 0 ? '— เลือกห้อง —' : 'เพิ่มห้อง...'}</option>
              {gradeClasses
                .filter((c) => !selectedClassIds.includes(c.id))
                .map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
            </select>
            {gradeClasses.length > 0 && selectedClassIds.length < gradeClasses.length && (
              <button
                onClick={handleSelectAllInGrade}
                className="text-xs text-indigo-600 hover:text-indigo-700 font-medium px-1.5 py-1"
                title="เลือกทั้งหมด"
              >
                ทั้งหมด
              </button>
            )}
            {selectedClassIds.length > 0 && (
              <button
                onClick={handleDeselectAll}
                className="text-xs text-gray-500 hover:text-gray-700 px-1.5 py-1"
                title="ยกเลิกเลือก"
              >
                ล้าง
              </button>
            )}
          </div>
          {/* Selected class chips */}
          {selectedClassIds.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-1">
              {selectedClassIds.map((cid) => {
                const c = classMap.get(cid)
                return (
                  <span
                    key={cid}
                    className="inline-flex items-center gap-0.5 bg-indigo-100 text-indigo-700 text-xs px-1.5 py-0.5 rounded"
                  >
                    {c?.name || cid}
                    <button onClick={() => handleToggleClass(cid)} className="hover:text-indigo-900">
                      <X className="w-3 h-3" />
                    </button>
                  </span>
                )
              })}
            </div>
          )}
        </div>

        {/* วิชา */}
        <div className="flex flex-col">
          <label className="text-xs font-medium text-gray-600 mb-1">วิชา</label>
          <select
            value={selectedSubjectId}
            onChange={(e) => handleSubjectChange(e.target.value)}
            disabled={availableSubjects.length === 0}
            className="border border-gray-300 rounded-lg px-2.5 py-2 text-sm focus:ring-2 focus:ring-indigo-500 min-w-[120px] disabled:bg-gray-100"
          >
            <option value="">— เลือกวิชา —</option>
            {availableSubjects.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        </div>

        {/* คาบปกติ (manual input) */}
        <div className="flex flex-col">
          <label className="text-xs font-medium text-gray-600 mb-1">คาบปกติ</label>
          <input
            type="number"
            min="0"
            max="20"
            value={normalPeriods}
            onChange={(e) => setNormalPeriods(Math.max(0, parseInt(e.target.value) || 0))}
            disabled={!selectedSubjectId}
            className="border border-gray-300 rounded-lg px-2.5 py-2 text-sm text-center focus:ring-2 focus:ring-indigo-500 w-20 disabled:bg-gray-100"
            placeholder="0"
          />
        </div>

        {/* คาบแล็บ (manual input) */}
        <div className="flex flex-col">
          <label className="text-xs font-medium text-gray-600 mb-1">คาบแล็บ</label>
          <input
            type="number"
            min="0"
            max="20"
            value={labPeriods}
            onChange={(e) => setLabPeriods(Math.max(0, parseInt(e.target.value) || 0))}
            disabled={!selectedSubjectId}
            className="border border-indigo-300 rounded-lg px-2.5 py-2 text-sm text-center font-bold text-indigo-700 focus:ring-2 focus:ring-indigo-500 w-20 disabled:bg-gray-100"
            placeholder="0"
          />
        </div>

        {/* ห้องแล็บ */}
        <div className="flex flex-col">
          <label className="text-xs font-medium text-gray-600 mb-1">ห้องแล็บ</label>
          <select
            value={labRoomId}
            onChange={(e) => setLabRoomId(e.target.value)}
            disabled={specialRooms.length === 0}
            className="border border-gray-300 rounded-lg px-2.5 py-2 text-sm focus:ring-2 focus:ring-indigo-500 min-w-[140px] disabled:bg-gray-100"
          >
            <option value="">— เลือกห้อง —</option>
            {specialRooms.map((r) => {
              const icon = FACILITY_TYPE_ICONS[r.room_type] || '🔬'
              const label = FACILITY_TYPE_LABELS[r.room_type] || r.room_type
              return (
                <option key={r.id} value={r.id}>
                  {icon} {r.name} ({label})
                </option>
              )
            })}
          </select>
        </div>

        {/* รวมคาบ (read-only, auto-calculated) */}
        <div className="flex flex-col">
          <label className="text-xs font-medium text-gray-600 mb-1">รวมคาบ</label>
          <div className="px-2.5 py-2 text-sm font-bold text-gray-700 bg-gray-100 rounded-lg text-center w-20">
            {totalPeriods}
          </div>
        </div>

        {/* นำไปใช้ button */}
        <div className="flex flex-col">
          <label className="text-xs font-medium text-transparent mb-1 select-none">.</label>
          <button
            onClick={handleApply}
            disabled={!canApply}
            className="flex items-center gap-1.5 px-4 py-2 bg-indigo-600 text-white rounded-lg font-medium text-sm hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors whitespace-nowrap"
          >
            <Check className="w-4 h-4" />
            นำไปใช้ {selectedClassIds.length > 0 && `(${selectedClassIds.length})`}
          </button>
        </div>
      </div>

      {/* Helper text */}
      {selectedSubjectId && existingTotalPeriods > 0 && totalPeriods !== existingTotalPeriods && (
        <p className="text-xs text-amber-600">
          ⚠️ รวมคาบปัจจุบัน = {existingTotalPeriods} แต่กรอกใหม่รวม = {totalPeriods} (จะถูกแทนที่)
        </p>
      )}
      {selectedSubjectId && existingTotalPeriods > 0 && totalPeriods === existingTotalPeriods && labPeriods > 0 && (
        <p className="text-xs text-green-600">
          ✓ รวมคาบตรงกับปัจจุบัน ({totalPeriods} คาบ) — พร้อมนำไปใช้
        </p>
      )}

      {/* Existing splits summary */}
      {existingSplits.length > 0 && (
        <div>
          <h4 className="text-sm font-bold text-gray-700 mb-2 flex items-center gap-1.5">
            <FlaskConical className="w-4 h-4 text-indigo-600" />
            รายการที่แยกคาบแล็บแล้ว ({existingSplits.length})
          </h4>
          <div className="space-y-1.5 max-h-60 overflow-y-auto">
            {existingSplits.map((split) => {
              const icon = FACILITY_TYPE_ICONS[split.roomType] || '🔬'
              return (
                <div
                  key={split.labBlock.id}
                  className="flex items-center gap-2 px-3 py-2 rounded-lg border border-indigo-100 bg-white"
                >
                  <span className="text-base">{icon}</span>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-gray-800 truncate">
                      {split.className} · {split.subjectName}
                    </div>
                    <div className="text-xs text-gray-500">
                      {split.normalPeriods} ปกติ + {split.labPeriods} แล็บ · {split.roomName}
                      {split.teacherName && ` · ${split.teacherName}`}
                    </div>
                  </div>
                  <button
                    onClick={() => handleUnsplit(split.labBlock.class_id, split.labBlock.subject_id)}
                    className="text-xs text-red-500 hover:text-red-700 font-medium px-2 py-1 rounded hover:bg-red-50 transition-colors"
                    title="ยกเลิกการแยก (รวมกลับเป็นคาบปกติ)"
                  >
                    ยกเลิกแยก
                  </button>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {existingSplits.length === 0 && selectedClassIds.length === 0 && (
        <p className="text-xs text-gray-400 italic py-2">
          เลือกชั้นและห้อง แล้วเลือกวิชาเพื่อกำหนดคาบแล็บ
        </p>
      )}
    </div>
  )
}
