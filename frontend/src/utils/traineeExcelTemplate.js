export const TRAINEE_TEMPLATE_HEADERS = [
  'รหัสนักศึกษา',
  'ชื่อ-นามสกุล',
  'วิชาเอก',
  'สถาบัน',
  'ครูพี่เลี้ยง',
  'วิชาที่สอน',
  'ชั้นเรียน',
  'ห้องที่ใช้ฝึกสอน',
  'คาบ/สัปดาห์',
  'เบอร์โทร',
  'อีเมล',
  'อาจารย์นิเทศ',
  'วันเริ่มฝึกงาน',
  'วันสิ้นสุดฝึกงาน',
  'หน่วยงาน/โรงเรียน',
  'แผนก/กลุ่มสาระ',
  'หมายเหตุ',
]

export const TRAINEE_TEMPLATE_EXAMPLE_ROW = [
  'EXAMPLE-01',
  'ตัวอย่าง นักศึกษา',
  'ประถมศึกษา',
  'มหาวิทยาลัยเชียงใหม่',
  'ครูตัวอย่าง 1; ครูตัวอย่าง 2',
  'ภาษาไทย',
  'ป.1/1',
  'ห้องเรียน 1, ห้องเรียน 2',
  3,
  '0800000000',
  'example@university.ac.th',
  'อาจารย์ตัวอย่าง',
  '01/11/2569',
  '31/03/2570',
  'โรงเรียนที่ฝึก',
  'กลุ่มสาระ',
  'ตัวอย่างหมายเหตุ',
]

export const TRAINEE_TEMPLATE_EXAMPLE_ROWS = [
  TRAINEE_TEMPLATE_EXAMPLE_ROW,
  [
    'EXAMPLE-01',
    'ตัวอย่าง นักศึกษา',
    '',
    '',
    '',
    'คณิตศาสตร์',
    'ป.2/1',
    'ห้องเรียน 3; ห้องเรียน 4',
    2,
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    'แถวนี้เป็นวิชาที่สองของคนเดียวกัน',
  ],
]

export const TRAINEE_TEMPLATE_GUIDE = [
  ['คอลัมน์ในไฟล์', 'ฟิลด์ระบบ', 'คำอธิบาย/หมายเหตุ'],
  ['รหัสนักศึกษา', 'studentCode', 'ใช้สำหรับจับคู่/อัปเดตรายชื่อซ้ำก่อน ถ้าไม่มีจะใช้ชื่อ'],
  ['ชื่อ-นามสกุล', 'name', 'จำเป็นต้องมีอย่างน้อย 1 คอลัมน์นี้'],
  ['วิชาเอก', 'major', 'เช่น ประถมศึกษา ภาษาไทย'],
  ['สถาบัน', 'institution', 'เช่น มหาวิทยาลัยเชียงใหม่'],
  ['ครูพี่เลี้ยง', 'mentorTeacherName', 'ใส่ได้หลายชื่อ คั่นด้วย , หรือ ;'],
  ['วิชาที่สอน', 'subjectName', 'ถ้าตรงกับวิชาใน workspace ระบบจะจับคู่ให้อัตโนมัติ'],
  ['ชั้นเรียน', 'className', 'พิมพ์เอง เช่น ป.1/1 ม.1/2'],
  ['ห้องที่ใช้ฝึกสอน', 'roomName', 'ใส่ได้หลายห้อง คั่นด้วย , หรือ ;'],
  ['คาบ/สัปดาห์', 'weeklyPeriods', 'ใส่ตัวเลข เช่น 3; เว้นว่างได้'],
  ['เบอร์โทร', 'phone', 'ตัวเลข 9–10 หลัก'],
  ['อีเมล', 'email', 'ต้องเป็นรูปแบบอีเมลถูกต้อง'],
  ['อาจารย์นิเทศ', 'advisorName', 'ชื่ออาจารย์/ครูนิเทศ'],
  ['วันเริ่มฝึกงาน', 'internshipStart', 'รูปแบบ DD/MM/YYYY พ.ศ. เช่น 01/11/2569 (รองรับ ISO ด้วย)'],
  ['วันสิ้นสุดฝึกงาน', 'internshipEnd', 'รูปแบบ DD/MM/YYYY พ.ศ. และต้องไม่ก่อนวันเริ่ม (รองรับ ISO ด้วย)'],
  ['หน่วยงาน/โรงเรียน', 'workplace', 'เช่น โรงเรียน...'],
  ['แผนก/กลุ่มสาระ', 'department', 'เช่น กลุ่มสาระภาษาไทย'],
  ['หมายเหตุ', 'note', 'ข้อมูลเพิ่มเติม เช่น ข้อจำกัดหรือคำอธิบาย'],
  ['หลายวิชา', 'กรอก รหัสนักศึกษา ซ้ำหลายแถว', 'แต่ละแถวคือวิชา/ชั้น/ห้องหนึ่งชุด และระบบจะรวมเป็นคนเดียว'],
]

export function buildTraineeTemplateData() {
  return {
    trainees: [TRAINEE_TEMPLATE_HEADERS, ...TRAINEE_TEMPLATE_EXAMPLE_ROWS],
    guide: TRAINEE_TEMPLATE_GUIDE,
  }
}

export async function buildTraineeTemplateWorkbook() {
  const mod = await import('xlsx-js-style')
  const XLSX = mod.default || mod
  const wb = XLSX.utils.book_new()
  const { trainees, guide } = buildTraineeTemplateData()

  const wsTrainees = XLSX.utils.aoa_to_sheet(trainees)
  wsTrainees['!cols'] = [
    { wch: 14 },
    { wch: 28 },
    { wch: 18 },
    { wch: 24 },
    { wch: 20 },
    { wch: 18 },
    { wch: 14 },
    { wch: 18 },
    { wch: 16 },
    { wch: 14 },
    { wch: 24 },
    { wch: 20 },
    { wch: 14 },
    { wch: 14 },
    { wch: 20 },
    { wch: 18 },
    { wch: 24 },
  ]
  wsTrainees['!rows'] = [{ hpt: 24 }]
  wsTrainees['!freeze'] = { xSplit: 0, ySplit: 1 }
  XLSX.utils.book_append_sheet(wb, wsTrainees, 'นักศึกษาฝึกงาน')

  const wsGuide = XLSX.utils.aoa_to_sheet(guide)
  wsGuide['!cols'] = [{ wch: 20 }, { wch: 28 }, { wch: 72 }]
  wsGuide['!rows'] = [{ hpt: 24 }]
  wsGuide['!freeze'] = { xSplit: 0, ySplit: 1 }
  XLSX.utils.book_append_sheet(wb, wsGuide, 'คำแนะนำ')

  return wb
}

export async function downloadTraineeTemplate(filename = 'trainee_attendance_template.xlsx') {
  const wb = await buildTraineeTemplateWorkbook()
  const mod = await import('xlsx-js-style')
  const XLSX = mod.default || mod
  const buffer = XLSX.write(wb, { bookType: 'xlsx', type: 'array' })
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}
