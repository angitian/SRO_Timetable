/**
 * PNG Image Export — multi-grid high-resolution capture.
 *
 * Renders each grid HTML page to a 2x-scale PNG via SVG foreignObject + Canvas.
 *
 * Two save modes:
 *   1. Direct Folder Mode (Chromium-based browsers with showDirectoryPicker):
 *      Opens a folder picker, creates /ห้องเรียน/ and /ครูผู้สอน/ subfolders,
 *      saves each .png directly.
 *   2. ZIP Fallback (Firefox, Safari, or denied permission):
 *      Bundles all PNGs into a single .zip via JSZip.
 *
 * Public API:
 *   exportMultiPNG(pages, baseName, onProgress) → Promise<void>
 *   exportElementToPNG(element, filename)       → Promise<void> (legacy)
 */

import JSZip from 'jszip'
import html2canvas from 'html2canvas'

/**
 * Render a single grid HTML page to a PNG Blob at 2x scale.
 *
 * Uses html2canvas for reliable DOM→Canvas rendering across all browsers.
 * (Previously used SVG foreignObject + Image.src, which silently failed in
 *  Chrome's sandboxed SVG-as-image context — caused ~60s hang with no output.)
 *
 * @param {string} innerHTML — the grid page HTML
 * @param {number} widthPx — target width in CSS pixels
 * @returns {Promise<Blob>}
 */
async function renderGridHTMLToPNGBlob(innerHTML, widthPx = 1000) {
  const container = document.createElement('div')
  container.style.cssText = `
    position: fixed;
    left: -99999px;
    top: 0;
    width: ${widthPx}px;
    background: #ffffff;
    padding: 16px;
    font-family: 'Sarabun', 'Segoe UI', Tahoma, sans-serif;
    color: #1f2937;
  `
  container.innerHTML = innerHTML
  document.body.appendChild(container)

  try {
    // Wait one frame for layout to settle
    await new Promise((r) => requestAnimationFrame(r))

    const canvas = await html2canvas(container, {
      scale: 2,                 // 2x for sharpness
      backgroundColor: '#ffffff',
      useCORS: true,
      logging: false,
      width: widthPx,
      windowWidth: widthPx,
    })

    const blob = await new Promise((resolve, reject) => {
      canvas.toBlob((b) => {
        if (!b) reject(new Error('Canvas toBlob failed'))
        else resolve(b)
      }, 'image/png')
    })

    return blob
  } finally {
    document.body.removeChild(container)
  }
}

/**
 * Sanitize a name for use as a filename.
 */
function sanitizeFilename(name) {
  return (name || 'untitled').replace(/[<>:"/\\|?*]+/g, '_').trim()
}

/**
 * Check if the browser supports the File System Access API.
 */
function supportsDirectoryPicker() {
  return typeof window !== 'undefined' && typeof window.showDirectoryPicker === 'function'
}

/**
 * Export multiple grid pages to PNG files.
 *
 * Uses showDirectoryPicker() when available for direct folder save,
 * otherwise falls back to a single .zip download via JSZip.
 *
 * @param {Array<{ label: string, html: string, kind: string }>} pages
 * @param {string} baseName — base name for the zip file (fallback mode)
 * @param {(msg: string) => void} onProgress — progress callback
 * @returns {Promise<void>}
 */
export async function exportMultiPNG(pages, baseName = 'ตารางสอน', onProgress = () => {}) {
  if (!pages || pages.length === 0) {
    throw new Error('ไม่มีตารางที่จะส่งออก')
  }

  // Try direct folder mode
  if (supportsDirectoryPicker()) {
    try {
      onProgress('เลือกโฟลเดอร์ปลายทาง...')
      const dirHandle = await window.showDirectoryPicker({ mode: 'readwrite' })

      // Create subfolders
      const classDir = await dirHandle.getDirectoryHandle('ห้องเรียน', { create: true })
      const teacherDir = await dirHandle.getDirectoryHandle('ครูผู้สอน', { create: true })

      for (let i = 0; i < pages.length; i++) {
        const page = pages[i]
        onProgress(`กำลังบันทึก ${page.label} (${i + 1}/${pages.length})...`)
        const blob = await renderGridHTMLToPNGBlob(page.html)
        const filename = `${sanitizeFilename(page.label)}.png`
        const targetDir = page.kind === 'teacher' ? teacherDir : classDir
        const fileHandle = await targetDir.getFileHandle(filename, { create: true })
        const writable = await fileHandle.createWritable()
        await writable.write(blob)
        await writable.close()
      }

      onProgress('บันทึกไฟล์ทั้งหมดลงโฟลเดอร์แล้ว')
      return
    } catch (e) {
      // If user cancelled the picker, abort entirely
      if (e.name === 'AbortError') {
        throw e
      }
      // Otherwise fall through to ZIP fallback
      console.warn('[exportImage] Direct folder save failed, falling back to ZIP:', e)
    }
  }

  // ZIP fallback
  onProgress('กำลังรวมไฟล์เป็น ZIP...')
  const zip = new JSZip()
  const classFolder = zip.folder('ห้องเรียน')
  const teacherFolder = zip.folder('ครูผู้สอน')

  for (let i = 0; i < pages.length; i++) {
    const page = pages[i]
    onProgress(`กำลังสร้างภาพ ${page.label} (${i + 1}/${pages.length})...`)
    const blob = await renderGridHTMLToPNGBlob(page.html)
    const filename = `${sanitizeFilename(page.label)}.png`
    if (page.kind === 'teacher') {
      teacherFolder.file(filename, blob)
    } else {
      classFolder.file(filename, blob)
    }
  }

  onProgress('กำลังบีบอัด ZIP...')
  const zipBlob = await zip.generateAsync({ type: 'blob' })
  const url = URL.createObjectURL(zipBlob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${sanitizeFilename(baseName)}_PNG.zip`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
  onProgress('ดาวน์โหลด ZIP แล้ว')
}

/**
 * Legacy single-element PNG export (kept for backward compatibility).
 * @param {HTMLElement} element — the element to capture
 * @param {string} filename — output filename (without extension)
 */
export async function exportElementToPNG(element, filename = 'timetable') {
  if (!element) {
    console.error('[exportImage] No element provided')
    return
  }

  const rect = element.getBoundingClientRect()
  const width = Math.ceil(rect.width)
  const height = Math.ceil(rect.height)

  const clone = element.cloneNode(true)
  clone.querySelectorAll('button, input, select, [data-no-print]').forEach((el) => el.remove())

  const serializer = new XMLSerializer()
  const htmlString = serializer.serializeToString(clone)

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
    <foreignObject width="100%" height="100%">
      <div xmlns="http://www.w3.org/1999/xhtml" style="width:${width}px;height:${height}px;">
        ${htmlString}
      </div>
    </foreignObject>
  </svg>`

  const svgBlob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' })
  const url = URL.createObjectURL(svgBlob)

  const img = new Image()
  img.crossOrigin = 'anonymous'

  return new Promise((resolve, reject) => {
    img.onload = () => {
      const canvas = document.createElement('canvas')
      const scale = window.devicePixelRatio || 2
      canvas.width = width * scale
      canvas.height = height * scale
      const ctx = canvas.getContext('2d')
      ctx.scale(scale, scale)
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(0, 0, width, height)
      ctx.drawImage(img, 0, 0, width, height)

      canvas.toBlob((blob) => {
        if (!blob) {
          reject(new Error('Canvas toBlob failed'))
          return
        }
        const pngUrl = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = pngUrl
        a.download = `${filename}.png`
        document.body.appendChild(a)
        a.click()
        document.body.removeChild(a)
        URL.revokeObjectURL(pngUrl)
        URL.revokeObjectURL(url)
        resolve()
      }, 'image/png')
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('ไม่สามารถ capture ตารางเป็น PNG ได้'))
    }
    img.src = url
  })
}
