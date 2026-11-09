import test from 'node:test'
import assert from 'node:assert/strict'
import ExcelJS from 'exceljs'
import { buildClassGridHTML, buildExportContext } from './src/utils/exportEngine.js'
import { exportMultiExcel } from './src/utils/exportExcel.js'

const exportData = {
  label: 'period-label-test',
  classes: [{ id: 'C1', name: 'ป.1/1' }],
  teachers: [],
  subjects: [],
  slots: [],
  lessonBlocks: [],
  fixedSlots: [],
  userPlacements: {},
  gridConfig: {
    periodsPerDay: 4,
    periodList: [1, 2, 3, 4],
    lunchPeriods: [3],
    breakPeriods: [],
    daysPerWeek: 1,
  },
}

test('print grid header labels lunch and resumes study numbering after it', () => {
  const ctx = buildExportContext(exportData)
  const html = buildClassGridHTML(exportData.classes[0], ctx)
  assert.equal(ctx.periodLabelMap.get(3), 'พักเที่ยง')
  assert.equal(ctx.periodLabelMap.get(4), '3')
  assert.match(html, /พักเที่ยง/)
})

test('Excel combined sheet labels the merged lunch header and continues numbering', async () => {
  const originalURL = globalThis.URL
  const originalDocument = globalThis.document
  let exportedBlob
  globalThis.URL = {
    createObjectURL: (blob) => {
      exportedBlob = blob
      return 'blob:period-label-test'
    },
    revokeObjectURL: () => {},
  }
  globalThis.document = {
    createElement: () => ({ click: () => {} }),
    body: { appendChild: () => {}, removeChild: () => {} },
  }
  try {
    await exportMultiExcel({
      classes: false,
      teachers: false,
      facilities: false,
      combinedClasses: true,
      combinedTeachers: false,
    }, exportData)
  } finally {
    globalThis.URL = originalURL
    if (originalDocument === undefined) delete globalThis.document
    else globalThis.document = originalDocument
  }

  assert.ok(exportedBlob)
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(new Uint8Array(await exportedBlob.arrayBuffer()))
  const sheet = workbook.getWorksheet('ตารางรวมห้องเรียนทั้งหมด')
  assert.equal(sheet.getCell('E3').value, 'พักเที่ยง')
  assert.equal(sheet.getCell('E3').isMerged, true)
  assert.equal(sheet.getCell('F3').value, '3')
})
