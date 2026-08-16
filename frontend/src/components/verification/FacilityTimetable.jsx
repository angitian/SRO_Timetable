import { Layers } from 'lucide-react'
import { FACILITY_TYPE_ICONS } from '../../utils/roomTypes.js'

/**
 * Renders the facility timetable grid section for the "ห้องปฏิบัติการ" tab,
 * shown when a solver result is available.
 *
 * @param {Object} props
 * @param {Array} props.specialRooms - Available special rooms for the selector.
 * @param {string} props.selectedFacilityId - Currently selected facility id.
 * @param {(id: string) => void} props.onSelectFacility - Callback when the selected facility changes.
 * @param {Array} props.facilityTimetable - Aggregated facility timetable rows to render.
 * @param {boolean} props.hasResult - Whether a solver result is available (controls visibility).
 */
export default function FacilityTimetable({
  specialRooms,
  selectedFacilityId,
  onSelectFacility,
  facilityTimetable,
  hasResult,
}) {
  if (!hasResult || specialRooms.length === 0) return null

  return (
    <div>
      <h3 className="font-bold text-gray-900 mb-3 flex items-center gap-2">
        <Layers className="w-5 h-5 text-indigo-600" />
        ตารางเวลาตามห้องปฏิบัติการ
      </h3>
      <select
        value={selectedFacilityId}
        onChange={(e) => onSelectFacility(e.target.value)}
        className="w-full max-w-xs border border-gray-300 rounded-lg px-3 py-2 text-sm mb-3 focus:ring-2 focus:ring-indigo-500"
      >
        <option value="">— เลือกห้องปฏิบัติการ —</option>
        {specialRooms.map((r) => {
          const icon = FACILITY_TYPE_ICONS[r.room_type] || '🔬'
          return (
            <option key={r.id} value={r.id}>
              {icon} {r.name}
            </option>
          )
        })}
      </select>
      {selectedFacilityId && (
        facilityTimetable.length === 0 ? (
          <div className="text-center py-6 text-gray-400 text-sm">
            ยังไม่มีคาบที่ใช้ห้องนี้ในตารางสอนปัจจุบัน
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200 text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-3 py-2 text-left text-xs font-bold text-gray-600">วัน</th>
                  <th className="px-3 py-2 text-center text-xs font-bold text-gray-600">คาบที่</th>
                  <th className="px-3 py-2 text-left text-xs font-bold text-gray-600">ชั้น</th>
                  <th className="px-3 py-2 text-left text-xs font-bold text-gray-600">วิชา</th>
                  <th className="px-3 py-2 text-left text-xs font-bold text-gray-600">ครู</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {facilityTimetable.map((s, i) => (
                  <tr key={i} className="hover:bg-gray-50">
                    <td className="px-3 py-2 font-medium text-gray-900">{s.dayName}</td>
                    <td className="px-3 py-2 text-center text-gray-700">{s.period}</td>
                    <td className="px-3 py-2 text-gray-700">{s.className}</td>
                    <td className="px-3 py-2 text-gray-700">{s.subjectName}</td>
                    <td className="px-3 py-2 text-gray-700">{s.teacherName}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      )}
    </div>
  )
}
