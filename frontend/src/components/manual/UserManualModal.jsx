import { useState } from 'react'
import {
  X, BookOpen, Upload, Layers, Users, ClipboardCheck, Calendar,
  Printer, Rocket, FileSpreadsheet, FlaskConical, ShieldCheck, Zap,
  ChevronDown, ChevronRight, MousePointerClick, Pin, Lock, Download,
} from 'lucide-react'

const SECTIONS = [
  {
    id: 'overview',
    icon: BookOpen,
    title: 'ภาพรวมระบบ',
    content: [
      'ระบบจัดตารางสอนอัตโนมัติ (SRO Timetable) เป็นเครื่องมือสำหรับโรงเรียนในการจัดตารางสอนโดยใช้ Constraint Optimization (Google OR-Tools CP-SAT) ระบบจะพิจารณาข้อจำกัดต่างๆ เช่น จำนวนคาบของครู ห้องเรียน วิชา และคาบที่ตรงกัน พร้อมตรวจจับคาบชนอัตโนมัติ',
      'ข้อมูลทั้งหมดประมวลผลบนเบราว์เซอร์ (100% Client-Side) ไม่มีการส่งข้อมูลไปยังเซิร์ฟเวอร์ภายนอก ข้อมูลปลอดภัยบนเครื่องของคุณ',
    ],
  },
  {
    id: 'getting-started',
    icon: Rocket,
    title: 'การเริ่มต้นใช้งาน',
    content: [
      'หน้า Landing Page มี 4 ทางเลือกในการเริ่มต้น:',
      '',
      '1. สร้างตารางสอน — เริ่มจากข้อมูลว่าง สำหรับโรงเรียนที่ต้องการกรอกข้อมูลเองทั้งหมด',
      '2. เปิดไฟล์ตารางเดิม (.json) — โหลดไฟล์ Snapshot ที่เคยบันทึกไว้ สามารถลากไฟล์มาวางที่หน้าจอได้',
      '3. ทดลองใช้งานด้วยข้อมูลตัวอย่าง (Load Demo) — โหลดข้อมูลโรงเรียนประถมตัวอย่าง (12 ห้อง · 25 ครู · 10 วิชา) เพื่อทดลองระบบ',
      '4. ดาวน์โหลด Template Excel — ดาวน์โหลดเทมเพลต Excel สำหรับกรอกข้อมูลก่อนนำเข้าระบบ',
    ],
  },
  {
    id: 'step1',
    icon: Upload,
    title: 'ขั้นตอนที่ 1: นำเข้าข้อมูลห้องเรียน',
    content: [
      'ขั้นตอนนี้สำหรับเตรียมข้อมูลห้องเรียนและครูผู้สอน มี 3 วิธี:',
      '',
      'วิธีที่ 1 — นำเข้าข้อมูลแบบด่วน (Quick Import):',
      '• อัปโหลดไฟล์ Excel ชีทเดียว ที่มีข้อมูลพื้นฐาน: ชื่อครู, วิชา, ห้องเรียน, จำนวนคาบ/สัปดาห์',
      '• คอลัมน์เสริม: ห้องปฏิบัติการ + คาบแล็บ สำหรับวิชาที่ใช้ห้องแล็บ',
      '• ระบบจะสกัดรายชื่อและจับคู่ภาระงานให้อัตโนมัติ',
      '• เหมาะสำหรับเริ่มต้น — หากข้อมูลยังไม่ครบ สามารถเพิ่มทีหลังได้',
      '',
      'วิธีที่ 2 — นำเข้าแบบกำหนดเองระดับสูง (Advanced Custom Import):',
      '• อัปโหลดไฟล์ Excel แบบหลายชีท (Multi-Sheets)',
      '• รวมข้อมูล: ภาระงาน, เงื่อนไขข้อห้ามสอนของครู (Teacher Constraints), คาบล็อกตายตัว (Fixed Slots)',
      '• มีระบบเลือกจับคู่คอลัมน์ (Column Mapping) ได้ตามต้องการ',
      '• เหมาะสำหรับตารางขนาดใหญ่หรือมีเงื่อนไขซับซ้อน',
      '',
      'วิธีที่ 3 — เพิ่มห้องเรียนเอง:',
      '• เพิ่มทีละห้อง, เพิ่มเป็นชั้น, หรือเพิ่มเป็นช่วงชั้น',
      '• เลือกระดับชั้น (อ.1-3, ป.1-6, ม.1-6) และชนิดห้อง',
      '',
      'ส่วนเสริม:',
      '• จัดการห้องพิเศษ (Labs) — เพิ่ม/แก้ไข/ลบห้องวิทยาศาสตร์, คอมพิวเตอร์, ดนตรี ฯลฯ',
      '• กำหนดคาบห้องปฏิบัติการ (Lab Periods) — แยกคาบเรียนออกเป็นคาบห้องปกติ + คาบห้องแล็บ',
    ],
  },
  {
    id: 'step2',
    icon: Layers,
    title: 'ขั้นตอนที่ 2: สร้างบล็อกตารางเรียน',
    content: [
      'ขั้นตอนนี้สำหรับกำหนดโครงสร้างเวลาของตารางเรียน:',
      '',
      '• สร้างบล็อกตาราง (Schedule Block) สำหรับกลุ่มห้องเรียนที่ใช้โครงสร้างเวลาเดียวกัน',
      '• กำหนด: จำนวนวัน/สัปดาห์, จำนวนคาบ/วัน, เวลาเริ่มต้น, ระยะเวลาต่อคาบ',
      '• กำหนดคาบพักเที่ยง (Lunch) และคาบพัก (Break) ได้',
      '• ระบบจะคำนวณเวลาเริ่ม-สิ้นสุดของแต่ละคาบอัตโนมัติ',
      '• สามารถสร้างหลายบล็อกสำหรับห้องเรียนที่มีโครงสร้างเวลาต่างกัน',
      '• ปรับขนาดตัวอักษรได้ (เล็ก/กลาง/ใหญ่) เพื่อความชัดเจน',
    ],
  },
  {
    id: 'step3',
    icon: Users,
    title: 'ขั้นตอนที่ 3: ภาระงานครู',
    content: [
      'ขั้นตอนนี้สำหรับจัดการครูผู้สอนและภาระงาน:',
      '',
      '• เพิ่มครูผู้สอน: ชื่อ, จำนวนคาบสอนสูงสุด/ต่ำสุดต่อสัปดาห์',
      '• กำหนดเงื่อนไขข้อห้ามสอน (Unavailable Slots) เช่น ครูไม่ว่างวันจันทร์คาบ 1-2',
      '• เพิ่ม Lesson Block: เลือกวิชา → ห้องเรียน → จำนวนคาบ/สัปดาห์ ให้แต่ละครู',
      '• ระบบจะแสดงภาระงานรวมของแต่ละครู และเตือนหากเกิน/ต่ำกว่าเกณฑ์',
      '• รองรับคาบคู่ (Double Period) สำหรับวิชาที่ต้องเรียนติดกัน 2 คาบ',
      '• ปุ่มลัดสำหรับกิจกรรม: ลูกเสือ-เนตรนารี, โฮมรูม, ชุมนุม/รด.',
      '• ครูที่สอนข้ามบล็อก (Cross-Block) จะถูกเน้นเตือน',
    ],
  },
  {
    id: 'step4',
    icon: ClipboardCheck,
    title: 'ขั้นตอนที่ 4: ตรวจสอบข้อมูล',
    content: [
      'ขั้นตอนนี้สำหรับตรวจสอบความถูกต้องก่อนสั่งจัดตาราง:',
      '',
      '• สรุปภาระงานครู: แสดงวิชาที่สอน, ห้อง, จำนวนคาบ และสถานะ (ปกติ/เกิน/ต่ำ)',
      '• ความหนาแน่นของห้องเรียน: แสดงวิชาทั้งหมดในแต่ละห้อง',
      '• ตรวจจับครูที่สอนข้ามบล็อก (Cross-Block Teachers)',
      '• คำนวณคาบรวมที่ต้องจัดเทียบกับความจุของบล็อก',
      '• หากพบปัญหา ให้กลับไปแก้ไขในขั้นตอนก่อนหน้า',
      '',
      'เมื่อตรวจสอบเรียบร้อย กดปุ่ม "จัดตารางสอนอัตโนมัติ" เพื่อสั่ง Solver ทำงาน',
    ],
  },
  {
    id: 'step5',
    icon: Calendar,
    title: 'ขั้นตอนที่ 5: ตารางสอน',
    content: [
      'ขั้นตอนนี้สำหรับดูและแก้ไขตารางสอนที่จัดแล้ว:',
      '',
      'โหมดการดู:',
      '• โหมดห้องเรียน (Class) — ดูตารางทีละห้อง',
      '• โหมดครู (Teacher) — ดูตารางทีละครู',
      '• โหมดห้องพิเศษ (Facility) — ดูตารางการใช้ห้องแล็บ',
      '',
      'การนำทาง:',
      '• เลื่อนล้อเมาส์ (Scroll) หรือกดลูกศร เพื่อเปลี่ยนห้อง/ครู',
      '• คลิกที่รายการในแถบด้านซ้ายเพื่อเลือกโดยตรง',
      '',
      'การแก้ไขตาราง:',
      '• ลาก Lesson Block จากแถบด้านขวา (Unassigned) ไปวางในช่องตาราง',
      '• ลากคาบที่จัดแล้วไปยังช่องอื่นเพื่อย้าย',
      '• ปักหมุด (Pin) เพื่อล็อกคาบไม่ให้ Solver จัดใหม่',
      '• ปลดล็อก (Unpin) เพื่อให้ Solver จัดใหม่ได้',
      '• ลบคาบ (Delete Slot) เพื่อนำคาบออกจากตาราง',
      '• เปลี่ยนห้อง (Change Room) สำหรับคาบที่ใช้ห้องพิเศษ',
      '',
      'การดำเนินการแบบกลุ่ม:',
      '• ปักหมุด/ปลดล็อกทั้งห้อง หรือทั้งครู',
      '• ล้างคาบทั้งหมด หรือเฉพาะคาบที่ Solver จัด',
      '',
      'การจัดตารางใหม่:',
      '• หากมีการแก้ไขข้อมูล จะมีจุดส้มเตือน "ข้อมูลเปลี่ยนแล้ว"',
      '• กด "จัดตารางใหม่" เพื่อให้ Solver ทำงานอีกครั้ง',
      '• เลือก Preset (Fast/Balanced/Quality) เพื่อปรับเวลาและคุณภาพ',
      '',
      'การบันทึกเวอร์ชัน (Snapshot):',
      '• บันทึก Snapshot เพื่อเก็บเวอร์ชันปัจจุบัน',
      '• โหลด Snapshot เก่าได้ตลอดเวลา',
      '• ส่งออก/นำเข้าไฟล์ .json',
    ],
  },
  {
    id: 'step6',
    icon: Printer,
    title: 'ขั้นตอนที่ 6: พิมพ์ / ส่งออก',
    content: [
      'ขั้นตอนนี้สำหรับส่งออกตารางสอนเป็นเอกสาร:',
      '',
      'การตั้งค่าเอกสาร:',
      '• ชื่อโรงเรียน, ภาคเรียน, ปีการศึกษา',
      '• อัปโหลดตราโรงเรียน (School Logo)',
      '• ชื่อ-ตำแหน่งผู้ลงนาม',
      '• เปิด/ปิด: เวลาคาบ, สรุปภาระงาน, ช่องลงนาม, ส่วนท้าย',
      '',
      'รูปแบบการส่งออก:',
      '• พิมพ์ (Print) — เปิดหน้าต่างพิมพ์ A4 พอดี 1 หน้า',
      '• รูปภาพ (PNG) — ส่งออกเป็นไฟล์รูปภาพคุณภาพสูง',
      '• Excel — ส่งออกเป็นไฟล์ Excel หลายชีท',
      '',
      'QR Code:',
      '• ระบบสร้าง QR Code สำหรับสแกนดูตารางออนไลน์',
      '• พิมพ์ QR Code ลงเอกสารเพื่อให้ครู/นักเรียนสแกนดูตารางได้',
    ],
  },
  {
    id: 'tips',
    icon: Zap,
    title: 'เคล็ดลับและข้อควรรู้',
    content: [
      '• ใช้ "Load Demo" เพื่อทดลองระบบก่อนใช้งานจริง',
      '• บันทึก Snapshot บ่อยๆ ขณะทำงาน เพื่อย้อนกลับได้',
      '• หาก Solver จัดไม่ได้ (INFEASIBLE) ให้ตรวจสอบภาระงานครูและคาบรวม',
      '• ปักหมุดคาบสำคัญก่อนสั่งจัดใหม่ เพื่อรักษาคาบที่ต้องการไว้',
      '• ใช้ Preset "Fast" เพื่อทดลอง และ "Quality" เพื่อผลลัพธ์ที่ดีที่สุด',
      '• ข้อมูลทั้งหมดเก็บในเบราว์เซอร์ — ปิดเบราว์เซอร์ข้อมูลอาจหาย ควรส่งออก .json สำรอง',
      '• รองรับห้อง Lab พิเศษ: วิทยาศาสตร์, คอมพิวเตอร์, ดนตรี, โสตทัศนศึกษา',
    ],
  },
]

export default function UserManualModal({ onClose }) {
  const [activeSection, setActiveSection] = useState('overview')
  const [mobileOpen, setMobileOpen] = useState(false)

  const current = SECTIONS.find((s) => s.id === activeSection)
  const CurrentIcon = current.icon

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-5xl h-[85vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 bg-gradient-to-r from-blue-50 to-indigo-50">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-blue-600 text-white flex items-center justify-center">
              <BookOpen className="w-6 h-6" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-gray-900">คู่มือการใช้งาน</h2>
              <p className="text-xs text-gray-500">SRO Timetable — ระบบจัดตารางสอนอัตโนมัติ</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-9 h-9 rounded-lg hover:bg-gray-200 flex items-center justify-center text-gray-500 hover:text-gray-700 transition-colors"
            aria-label="ปิด"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 flex overflow-hidden">
          {/* Sidebar — desktop */}
          <nav className="hidden md:block w-64 shrink-0 border-r border-gray-200 bg-gray-50/50 overflow-y-auto py-3">
            {SECTIONS.map((s) => {
              const Icon = s.icon
              const isActive = activeSection === s.id
              return (
                <button
                  key={s.id}
                  onClick={() => setActiveSection(s.id)}
                  className={`w-full flex items-center gap-2.5 px-4 py-2.5 text-sm font-medium text-left transition-colors
                    ${isActive
                      ? 'bg-blue-100 text-blue-700 border-r-2 border-blue-600'
                      : 'text-gray-600 hover:bg-gray-100'
                    }`}
                >
                  <Icon className={`w-4 h-4 shrink-0 ${isActive ? 'text-blue-600' : 'text-gray-400'}`} />
                  <span className="truncate">{s.title}</span>
                </button>
              )
            })}
          </nav>

          {/* Mobile section selector */}
          <div className="md:hidden w-full border-b border-gray-200 bg-gray-50">
            <button
              onClick={() => setMobileOpen(!mobileOpen)}
              className="w-full flex items-center justify-between px-4 py-3 text-sm font-medium text-gray-700"
            >
              <span className="flex items-center gap-2">
                <CurrentIcon className="w-4 h-4 text-blue-600" />
                {current.title}
              </span>
              {mobileOpen ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
            </button>
            {mobileOpen && (
              <div className="border-t border-gray-200 max-h-64 overflow-y-auto">
                {SECTIONS.map((s) => {
                  const Icon = s.icon
                  const isActive = activeSection === s.id
                  return (
                    <button
                      key={s.id}
                      onClick={() => {
                        setActiveSection(s.id)
                        setMobileOpen(false)
                      }}
                      className={`w-full flex items-center gap-2.5 px-4 py-2.5 text-sm text-left transition-colors
                        ${isActive ? 'bg-blue-100 text-blue-700' : 'text-gray-600 hover:bg-gray-100'}`}
                    >
                      <Icon className="w-4 h-4 shrink-0 text-gray-400" />
                      <span className="truncate">{s.title}</span>
                    </button>
                  )
                })}
              </div>
            )}
          </div>

          {/* Content */}
          <div className="flex-1 overflow-y-auto px-6 py-5">
            <div className="flex items-center gap-2.5 mb-4 pb-3 border-b border-gray-100">
              <div className="w-9 h-9 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center">
                <CurrentIcon className="w-5 h-5" />
              </div>
              <h3 className="text-base font-bold text-gray-900">{current.title}</h3>
            </div>
            <div className="space-y-2.5 text-sm text-gray-700 leading-relaxed">
              {current.content.map((line, i) => {
                if (line === '') {
                  return <div key={i} className="h-2" />
                }
                const isBullet = line.startsWith('•')
                const isNumbered = /^\d+\./.test(line)
                return (
                  <p
                    key={i}
                    className={`${isBullet ? 'pl-4' : ''} ${isNumbered ? 'font-medium text-gray-900' : ''}`}
                  >
                    {isBullet ? (
                      <span className="flex gap-2">
                        <span className="text-blue-500 mt-0.5">•</span>
                        <span>{line.slice(2)}</span>
                      </span>
                    ) : (
                      line
                    )}
                  </p>
                )
              })}
            </div>

            {/* Quick feature badges */}
            {activeSection === 'overview' && (
              <div className="mt-6 grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="card bg-amber-50/50 border-amber-100">
                  <Zap className="w-5 h-5 text-amber-600 mb-1.5" />
                  <h4 className="text-sm font-bold text-gray-900">Auto-Solver</h4>
                  <p className="text-xs text-gray-600">จัดตารางและล็อกห้องพิเศษ/ครูผู้สอนอัตโนมัติ</p>
                </div>
                <div className="card bg-blue-50/50 border-blue-100">
                  <Printer className="w-5 h-5 text-blue-600 mb-1.5" />
                  <h4 className="text-sm font-bold text-gray-900">Print Studio</h4>
                  <p className="text-xs text-gray-600">ส่งออก A4 สวยงาม พร้อม QR Code</p>
                </div>
                <div className="card bg-emerald-50/50 border-emerald-100">
                  <ShieldCheck className="w-5 h-5 text-emerald-600 mb-1.5" />
                  <h4 className="text-sm font-bold text-gray-900">Data Privacy</h4>
                  <p className="text-xs text-gray-600">ประมวลผลบนเบราว์เซอร์ 100%</p>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-3 border-t border-gray-200 bg-gray-50 flex items-center justify-between">
          <span className="text-xs text-gray-400">© 2026 SRO Timetable — KRU Platform</span>
          <button
            onClick={onClose}
            className="btn-primary text-sm py-2"
          >
            เข้าใจแล้ว
          </button>
        </div>
      </div>
    </div>
  )
}
