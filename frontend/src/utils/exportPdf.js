/**
 * PDF Export — multi-page document via the browser's native print dialog.
 *
 * Compiles one or more grid HTML pages into a single print-window document
 * with page-break CSS, then triggers the print dialog (user saves as PDF).
 *
 * Public API:
 *   exportMultiPagePDF(pages, docTitle) → Promise<void>
 *   exportElementToPDF(element, title)  → void  (legacy single-element API)
 */

/**
 * Export multiple grid HTML pages to a single PDF via the print dialog.
 *
 * @param {Array<{ label: string, html: string }>} pages — grid HTML pages
 * @param {string} docTitle — document title (used in print header)
 * @returns {Promise<void>}
 */
export function exportMultiPagePDF(pages, docTitle = 'ตารางสอน') {
  return new Promise((resolve, reject) => {
    if (!pages || pages.length === 0) {
      reject(new Error('ไม่มีหน้าที่จะพิมพ์'))
      return
    }

    const printWindow = window.open('', '_blank', 'width=1100,height=850')
    if (!printWindow) {
      reject(new Error('กรุณาอนุญาต popup เพื่อพิมพ์ตาราง'))
      return
    }

    const pagesHTML = pages.map((p) => p.html).join('\n')

    const html = `<!DOCTYPE html>
<html lang="th">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${docTitle}</title>
  <style>
    * { box-sizing: border-box; }
    body {
      font-family: 'Sarabun', 'Segoe UI', Tahoma, sans-serif;
      margin: 0;
      padding: 16px;
      color: #1f2937;
    }
    h1 {
      font-size: 20px;
      text-align: center;
      margin: 0 0 16px 0;
      padding-bottom: 8px;
      border-bottom: 2px solid #e5e7eb;
    }
    .grid-page {
      page-break-after: always;
      break-after: page;
      margin-bottom: 16px;
    }
    .grid-page:last-child {
      page-break-after: auto;
      break-after: auto;
    }
    /* Print page setup — A4 landscape */
    @page {
      size: A4 landscape;
      margin: 10mm;
    }
    @media print {
      body { margin: 0; padding: 8px; }
      h1 { display: none; }
    }
    @media screen {
      body { background: #f9fafb; }
      .grid-page {
        background: #fff;
        padding: 16px;
        margin-bottom: 24px;
        border-radius: 8px;
        box-shadow: 0 1px 3px rgba(0,0,0,0.1);
      }
    }
  </style>
</head>
<body>
  <h1>${docTitle}</h1>
  ${pagesHTML}
</body>
</html>`

    printWindow.document.write(html)
    printWindow.document.close()
    printWindow.focus()

    // Wait for content to render before printing
    setTimeout(() => {
      try {
        printWindow.print()
        // Close after print (some browsers keep it open)
        setTimeout(() => {
          try { printWindow.close() } catch { /* ignore */ }
          resolve()
        }, 500)
      } catch (e) {
        reject(e)
      }
    }, 400)
  })
}

/**
 * Legacy single-element PDF export (kept for backward compatibility).
 * @param {HTMLElement} element — the grid element to print
 * @param {string} title — document title
 */
export function exportElementToPDF(element, title = 'ตารางสอน') {
  if (!element) {
    console.error('[exportPdf] No element provided')
    return
  }

  const clone = element.cloneNode(true)
  clone.querySelectorAll('button, input, select, [data-no-print]').forEach((el) => el.remove())

  const printWindow = window.open('', '_blank', 'width=900,height=700')
  if (!printWindow) {
    alert('กรุณาอนุญาต popup เพื่อพิมพ์ตาราง')
    return
  }

  const html = `<!DOCTYPE html>
<html lang="th">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
  <style>
    * { box-sizing: border-box; }
    body { font-family: 'Sarabun', 'Segoe UI', Tahoma, sans-serif; margin: 20px; color: #1f2937; }
    h1 { font-size: 18px; text-align: center; margin-bottom: 16px; }
    [style*="grid-template-columns"] { display: grid !important; }
    [class*="rounded-lg"] { border: 1px solid #d1d5db; border-radius: 6px; padding: 4px 6px; min-height: 50px; font-size: 11px; display: flex; flex-direction: column; justify-content: center; overflow: hidden; }
    [class*="font-bold"] { font-weight: 700; }
    .bg-white { background: #fff !important; }
    .bg-gray-100, .bg-gray-200 { background: #f3f4f6 !important; }
    @page { size: A4 landscape; margin: 10mm; }
    @media print { body { margin: 0; } }
  </style>
</head>
<body>
  <h1>${title}</h1>
  ${clone.outerHTML}
</body>
</html>`

  printWindow.document.write(html)
  printWindow.document.close()
  printWindow.focus()
  setTimeout(() => {
    printWindow.print()
    setTimeout(() => printWindow.close(), 500)
  }, 300)
}
