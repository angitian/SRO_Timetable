# UX Review: PrintStudio

**วันที่:** 2026-08-20
**ไฟล์ที่วิเคราะห์:** frontend/src/pages/PrintStudio.jsx
**Input sources:** source code (code-only review — ไม่มี screenshot)
**Reviewer:** Devin (ux-review skill)

> หมายเหตุ: รีวิวนี้วิเคราะห์จากโค้ดเพียงอย่างเดียว ปัญหาด้าน visual ที่ต้องเห็นหน้าจอจริง (เช่น contrast ของสีที่ render จริง, spacing สุดท้าย) อาจต้องตรวจซ้ำด้วย screenshot ในครั้งถัดไป

---

## สรุปผู้บริหาร

- จำนวน findings: **2 Critical, 5 Major, 6 Minor**
- พื้นที่ที่มีปัญหามากที่สุด: **Accessibility (WCAG)** — ไอคอน/ปุ่มหลายตัวไม่มี accessible name, โมดัลไม่ trap focus
- สิ่งที่ทำได้ดีแล้ว:
  - มี empty state ชัดเจน พร้อม CTA นำผู้ใช้กลับ (PrintStudio.jsx:610-628)
  - มี loading state ทุก async action (Loader2 + disabled) พร้อม progress text (PrintStudio.jsx:1460-1465, 1475-1479, 1483-1485)
  - มี toast feedback สำหรับ success/error (PrintStudio.jsx:1708-1718)
  - ปุ่ม disabled มี `disabled:opacity-50 disabled:cursor-not-allowed` สม่ำเสมอ
  - แยก primary CTA (พิมพ์) จาก secondary export ด้วยสีและขนาด ชัดเจน

---

## Findings

| # | Severity | Category | Issue | Evidence | Recommendation |
|---|----------|----------|-------|----------|----------------|
| 1 | Critical | WCAG | ปุ่ม "คัดลอกลิงก์" มีแค่ไอคอน `<Copy />` ไม่มีข้อความ และ `title` ไม่ใช่ accessible name ที่ screen reader อ่านได้ทุก browser | `PrintStudio.jsx:1520-1526` | เพิ่ม `aria-label="คัดลอกลิงก์"` (หรือ `<span className="sr-only">`) ให้ปุ่มนี้และทุก icon-only button |
| 2 | Critical | WCAG | โมดัล "พื้นที่บันทึกเต็ม" ไม่มี focus trap, ไม่มี `role="dialog"`/`aria-modal`, และไม่คืน focus หลังปิด — ผู้ใช้ keyboard หลุดออกจากโมดัลได้ | `PrintStudio.jsx:1663-1706` | ใส่ `role="dialog" aria-modal="true" aria-labelledby=...`, ทำ focus trap (ย้าย focus เข้าปุ่มแรกตอนเปิด, คืน focus ตอนปิด), ปิดด้วย Esc |
| 3 | Major | WCAG | โมดัลใช้ `<div onClick>` บน overlay เพื่อปิด แทนที่จะเป็นปุ่ม — ไม่ keyboard-accessible | `PrintStudio.jsx:1665-1668` | เปลี่ยน overlay เป็น `<button>` หรือเพิ่ม `role="button" tabIndex={0}` + handler สำหรับ Enter/Space และกด Esc ปิด |
| 4 | Major | WCAG | ปุ่ม tab switcher "ตั้งค่าหัวกระดาษ/ส่งออกเอกสาร" และ "ขอบเขตการส่งออก" ใช้ `<button>` แต่ไม่มี `role="tab"`/`aria-selected`/`aria-controls` — ไม่สื่อ state ให้ AT | `PrintStudio.jsx:1366-1376`, `1436-1446` | ใช้ ARIA tab pattern: container `role="tablist"`, ปุ่ม `role="tab" aria-selected={...} aria-controls={panelId}`, panel `role="tabpanel" id={panelId}` |
| 5 | Major | WCAG | Toast notification ใช้ `fixed bottom-6 right-6` แต่ไม่มี `role="status"` หรือ `aria-live` — screen reader จะไม่ประกาศ toast | `PrintStudio.jsx:1709-1718` | เพิ่ม `role="status" aria-live="polite"` สำหรับ success, `role="alert" aria-live="assertive"` สำหรับ error |
| 6 | Major | Heuristic | ปุ่ม "บันทึก & แชร์ (ลิงก์สั้น)" เมื่อเต็ม (5/5) จะเปิดโมดัลให้เลือกแทนที่ แต่ไม่มี **error prevention** แบบ confirm ก่อนทำลาย — คลิกแล้วแทนที่ทันที | `PrintStudio.jsx:1678-1693` (`handleOverwriteSave`) | ในโมดัล ให้คลิกรายการแล้วแสดง confirm ที่สอง ("แทนที่ตาราง X ใช่ไหม?") ก่อนเรียก `handleOverwriteSave` |
| 7 | Major | Task flow | สถานะ short-link (`creating`/`error`/`ready`) แสดงในพื้นที่เพียง 28px ด้วย `text-[11px]` — ข้อความ error ยาว "ไม่สามารถสร้างลิงก์สั้นได้ — QR จะใช้ลิงก์แนบข้อมูลแทน" อาจถูก truncate และผู้ใช้อาจไม่สังเกตเห็น | `PrintStudio.jsx:1393-1410` | ขยายพื้นที่เมื่อเป็น error (เช่น `min-h-[28px]` → auto ตอน error) หรือย้าย error ไป toast ที่เด่นชัดกว่า |
| 8 | Minor | WCAG | ปุ่มใน right nav rail ใช้ emoji (📋👤🔬) เป็น label บางส่วน — screen reader อาจอ่าน emoji ไม่ตรงความหมาย | `PrintStudio.jsx:1580, 1588, 1598` | เพิ่ม `aria-label` ที่ชัด (เช่น "ห้องเรียน (3)") หรือซ่อน emoji จาก AT ด้วย `aria-hidden="true"` |
| 9 | Minor | WCAG | ปุ่ม pill ในรายการหน้ามี `title={page.label}` แต่ข้อความในปุ่มอาจถูก `truncate` ตัด — `title` ช่วยแต่ไม่ใช่ accessible name ที่ AT ใช้หลัก | `PrintStudio.jsx:1644-1653` | พิจารณาเพิ่ม `aria-label` เต็ม หรืออนุญาตให้ wrap บรรทัดแทน truncate |
| 10 | Minor | Visual | ปุ่ม secondary export ใช้ `bg-emerald-600` (PNG) และ `bg-green-700` (Excel) — สีใกล้กันมาก ผู้ใช้แยกยาก และทั้งคู่ "เขียว" ทำให้สับสนกับ semantic ของ success | `PrintStudio.jsx:1456, 1471` | ใช้คู่สีที่ต่างกันชัด (เช่น PNG = indigo, Excel = emerald) หรือใช้ outline style สำหรับ secondary |
| 11 | Minor | Visual | primary CTA ใช้ `bg-blue-600` ส่วน tab active ด้านบนก็ใช้ `text-blue-700 border-blue-500` — สีน้ำเงินถูกใช้ทั้ง "active tab" และ "primary action" ทำให้สื่อสารสับสน | `PrintStudio.jsx:1363, 1418` | สงวนสีน้ำเงินไว้สำหรับ primary action อย่างเดียว ส่วน active tab ใช้ neutral/gray หรือสีอื่น |
| 12 | Minor | Heuristic | ปุ่มย้อนกลับใช้ข้อความต่างกันใน 2 จุด: "กลับไปแก้ไขตาราง" (left panel) กับ "กลับไปหน้าจัดตาราง" (empty state) — ไม่ consistent | `PrintStudio.jsx:1357, 625` | ใช้ข้อความเดียวกันทั้งสองจุด (แนะ "กลับไปจัดตาราง") |
| 13 | Minor | UX writing | ปุ่ม primary เขียน "สั่งพิมพ์ / บันทึก PDF ({suffix})" — ผู้ใช้อาจสับสนว่ากดแล้วจะพิมพ์เลยหรือเปิด dialog บันทึก | `PrintStudio.jsx:1423` | พิจารณาแยกเป็น "พิมพ์" และ "บันทึกเป็น PDF" หรือเขียนให้ชัดว่ากดแล้วเปิด dialog พิมพ์ของเบราว์เซอร์ |

---

## ลำดับความสำคัญแนะนำ

1. **เพิ่ม `aria-label` ให้ทุก icon-only button** (Critical #1) — แก้ทีเดียวครอบคลุมหลายจุด, ค่าใช้จ่ายต่ำ
2. **ซ่อมโมดัล accessibility** (Critical #2 + Major #3) — focus trap, `role="dialog"`, Esc ปิด, overlay เป็นปุ่ม
3. **เพิ่ม `role="status"`/`aria-live` ให้ toast** (Major #5) — บรรทัดเดียวก็ผ่าน
4. **เพิ่ม confirm ก่อนแทนที่ลิงก์ที่บันทึกไว้** (Major #6) — กันข้อมูลหาย
5. **ปรับ ARIA tab pattern** (Major #4) — ใช้ tablist/tab/tabpanel ให้ถูกต้อง
6. ปรับสี/consistency ของ minor findings ในรอบถัดไป

---

## ภาคผนวก: Heuristic Checklist

| Heuristic | ผ่าน? | หมายเหตุ |
|-----------|-------|----------|
| Visibility of system status | ✓ | Loader2 + progress text + toast ครบ |
| Match between system and real world | ✓ | ใช้ภาษาไทยผู้ใช้ ("สั่งพิมพ์", "บันทึก & แชร์") |
| User control & freedom | ~ | มี back button แต่โมดัลปิดได้แค่คลิก overlay/ยกเลิก ไม่มี Esc |
| Consistency & standards | ✗ | ข้อความ back button ไม่เหมือนกัน (#12), สีน้ำเงินใช้ 2 หน้าที่ (#11) |
| Error prevention | ✗ | แทนที่ลิงก์ที่บันทึกไว้ไม่มี confirm (#6) |
| Recognition rather than recall | ✓ | tab/label ชัด |
| Flexibility & efficiency | ~ | ไม่พบ keyboard shortcut |
| Aesthetic & minimalist design | ✓ | layout 2 คอลัมน์ + nav rail ชัด |
| Help users recover from errors | ~ | short-link error แสดงในพื้นที่เล็ก (#7) |
| Help & documentation | — | ไม่พบในไฟล์นี้ (อาจอยู่ใน onboarding อื่น) |

## ภาคผนวก: WCAG Checklist

| เกณฑ์ | ผ่าน? | หมายเหตุ |
|-------|-------|----------|
| Contrast 4.5:1 | ? | ต้องตรวจด้วย screenshot — `text-gray-400` บน `bg-slate-100` (line 1561) น่าสงสัย |
| Non-text content มี accessible name | ✗ | icon-only button หลายจุด (#1) |
| Keyboard navigable | ✗ | โมดัลไม่ trap focus (#2), overlay ใช้ div onClick (#3) |
| Forms มี label | — | ไม่มี form ในไฟล์นี้ (อยู่ใน PrintSettingsPanel) |
| ไม่ใช้สีเป็นสื่อเดียว | ~ | pill status มีสี + badge ข้อความ ✓/(n) — พอใช้ได้ |
| Heading hierarchy | ~ | empty state ใช้ h2 โดยไม่มี h1 ก่อนหน้า |
| Semantic HTML/ARIA | ✗ | tab ไม่ใช้ role tab (#4), toast ไม่มี aria-live (#5) |
| Reflow/Responsive | ~ | ใช้ fixed `w-80` + `w-[160px]` อาจลำบากบนจอแคบ |
