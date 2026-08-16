import { FlaskConical, AlertTriangle } from 'lucide-react'
import { FACILITY_TYPE_ICONS, FACILITY_TYPE_LABELS } from '../../utils/roomTypes.js'

/**
 * Renders the facility (special room) usage summary section for the "ห้องปฏิบัติการ" tab.
 *
 * @param {Object} props
 * @param {Array} props.facilityUsage - Aggregated facility usage entries to render.
 */
export default function FacilityUsageSummary({ facilityUsage }) {
  return (
    <div>
      <h3 className="font-bold text-gray-900 mb-3 flex items-center gap-2">
        <FlaskConical className="w-5 h-5 text-indigo-600" />
        สรุปการใช้งานห้องปฏิบัติการ
      </h3>
      {facilityUsage.length === 0 ? (
        <div className="text-center py-8 text-gray-400">
          <FlaskConical className="w-8 h-8 mx-auto mb-2" />
          ยังไม่มีห้องปฏิบัติการ — เพิ่มได้ในขั้นตอน "เตรียมข้อมูล"
        </div>
      ) : (
        <div className="space-y-2">
          {facilityUsage.map((entry) => {
            const icon = FACILITY_TYPE_ICONS[entry.room.room_type] || '🔬'
            const typeLabel = FACILITY_TYPE_LABELS[entry.room.room_type] || entry.room.room_type
            return (
              <div
                key={entry.room.id}
                className={`rounded-lg border p-3 ${entry.isOver ? 'border-red-200 bg-red-50/50' : 'border-gray-200 bg-white'}`}
              >
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-lg">{icon}</span>
                  <span className="font-bold text-gray-900">{entry.room.name}</span>
                  <span className="text-xs px-1.5 py-0.5 rounded-full bg-indigo-100 text-indigo-700">
                    {typeLabel}
                  </span>
                  <span className="ml-auto text-sm">
                    <span className={`font-bold ${entry.isOver ? 'text-red-600' : 'text-gray-700'}`}>
                      {entry.total}
                    </span>
                    {entry.capacity > 0 && (
                      <span className="text-gray-400"> / {entry.capacity} คาบ/สัปดาห์</span>
                    )}
                  </span>
                </div>
                <div className="flex flex-wrap gap-1 text-xs">
                  {entry.subjectList.map((s) => (
                    <span
                      key={s.subject}
                      className="inline-flex items-center rounded-full px-2 py-0.5 bg-gray-100 text-gray-700 border border-gray-200"
                    >
                      {s.subject} · {s.periods} คาบ
                    </span>
                  ))}
                </div>
                {entry.isOver && (
                  <div className="mt-2 text-xs text-red-600 font-medium flex items-center gap-1">
                    <AlertTriangle className="w-3.5 h-3.5" />
                    ใช้เกินความจุ ({entry.total - entry.capacity} คาบ)
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
