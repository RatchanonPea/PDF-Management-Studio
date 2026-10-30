import * as pdfjs from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import { PDFDocument, degrees, rgb } from 'pdf-lib'
import { encryptPDF } from '@pdfsmaller/pdf-encrypt-lite'

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl

let uid = 0
export const nextId = () => `p${++uid}`

export const needsPassword = (e) => e?.name === 'PasswordException'

export async function loadFile(file, password) {
  const bytes = new Uint8Array(await file.arrayBuffer())
  const doc = await pdfjs.getDocument({ data: bytes.slice(), password }).promise
  // pdf-lib cannot decrypt, so an unlocked file is re-drawn from pdf.js on export
  return { id: nextId(), name: file.name, bytes, doc, unlocked: password !== undefined }
}

export async function renderToCanvas(doc, pageIndex, width, density = window.devicePixelRatio || 1) {
  const page = await doc.getPage(pageIndex + 1)
  const base = page.getViewport({ scale: 1 })
  const viewport = page.getViewport({ scale: (width * density) / base.width })
  const canvas = document.createElement('canvas')
  canvas.width = Math.floor(viewport.width)
  canvas.height = Math.floor(viewport.height)
  await page.render({ canvas, viewport }).promise
  canvas.ptW = base.width
  canvas.ptH = base.height
  return canvas
}

/** Text lines of a page as fractions of the page box (0..1, origin top-left). Runs on one baseline are merged into one editable line. */
export async function getTextRuns(doc, pageIndex) {
  const page = await doc.getPage(pageIndex + 1)
  const vp = page.getViewport({ scale: 1 })
  const { items } = await page.getTextContent()
  const raw = items
    .filter((it) => it.str && it.str.trim())
    .map((it) => {
      const [, , , , e, f] = pdfjs.Util.transform(vp.transform, it.transform)
      return { str: it.str, size: Math.hypot(it.transform[2], it.transform[3]), x: e, base: f, w: it.width }
    })
    .sort((a, b) => a.base - b.base || a.x - b.x)

  // group by baseline, then split a line wherever a wide gap suggests another column
  const lines = []
  for (const r of raw) {
    const line = lines.find((l) => Math.abs(l.base - r.base) < Math.max(2, r.size * 0.4))
    if (line) line.items.push(r)
    else lines.push({ base: r.base, items: [r] })
  }
  const out = []
  for (const line of lines) {
    line.items.sort((a, b) => a.x - b.x)
    let cur = null
    for (const r of line.items) {
      const gap = cur ? r.x - (cur.x + cur.w) : 0
      if (cur && gap < cur.size * 2.5) {
        const space = gap > cur.size * 0.2 && !/\s$/.test(cur.str) && !/^\s/.test(r.str) ? ' ' : ''
        cur.str += space + r.str
        cur.w = Math.max(cur.w, r.x + r.w - cur.x)
        cur.size = Math.max(cur.size, r.size)
      } else {
        if (cur) out.push(cur)
        cur = { ...r, base: line.base }
      }
    }
    if (cur) out.push(cur)
  }
  return out.map((r) => ({
    str: r.str,
    size: r.size,
    x: r.x / vp.width,
    y: (r.base - r.size * 0.95) / vp.height,
    w: r.w / vp.width,
    h: (r.size * 1.25) / vp.height,
  }))
}

/** Render page `pageIndex` of a generated PDF blob, for the before/after view. */
export async function renderBlobPage(blob, pageIndex, width) {
  const task = pdfjs.getDocument({ data: new Uint8Array(await blob.arrayBuffer()) })
  try {
    return await renderToCanvas(await task.promise, pageIndex, width, 1)
  } finally {
    task.destroy()
  }
}

/** Load every page of a File into the page list used by the workspace. */
export async function importPdf(file, password) {
  const src = await loadFile(file, password)
  const pages = []
  for (let i = 0; i < src.doc.numPages; i++) {
    const canvas = await renderToCanvas(src.doc, i, 240)
    pages.push({
      id: nextId(),
      fileId: src.id,
      fileName: src.name,
      index: i,
      rotation: 0,
      thumb: canvas.toDataURL('image/jpeg', 0.82),
      ratio: canvas.height / canvas.width,
      ptW: canvas.ptW,
    })
  }
  return { src, pages }
}

export const TEXT_BASE = 160

/** Renders (multi-line) text with the browser's shaper, so Thai marks stay in place. */
export function textToPng(text, { font, color, size = TEXT_BASE, weight = 700, pad = 8, italic = false, underline = false, strike = false, align = 'left' }) {
  const lines = text.split('\n')
  const lineH = Math.ceil(size * 1.45)
  const spec = `${italic ? 'italic ' : ''}${weight} ${size}px ${font}`
  const probe = document.createElement('canvas').getContext('2d')
  probe.font = spec
  const widths = lines.map((l) => probe.measureText(l).width)
  const inner = Math.ceil(Math.max(...widths))
  const w = inner + pad * 2 + (italic ? Math.round(size * 0.12) : 0)
  const h = lineH * lines.length + pad * 2
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  ctx.font = spec
  ctx.fillStyle = color
  ctx.strokeStyle = color
  ctx.lineWidth = Math.max(2, size / 16)
  ctx.textBaseline = 'middle'
  lines.forEach((l, i) => {
    const x = pad + (align === 'center' ? (inner - widths[i]) / 2 : align === 'right' ? inner - widths[i] : 0)
    const y = pad + lineH * (i + 0.5)
    ctx.fillText(l, x, y)
    if (underline) { ctx.beginPath(); ctx.moveTo(x, y + size * 0.46); ctx.lineTo(x + widths[i], y + size * 0.46); ctx.stroke() }
    if (strike) { ctx.beginPath(); ctx.moveTo(x, y + size * 0.02); ctx.lineTo(x + widths[i], y + size * 0.02); ctx.stroke() }
  })
  return canvas.toDataURL('image/png')
}

/**
 * Renders rich text: runs of { t, b, i, u, s, color, font, size } on shared baselines.
 * `size` is the item's base size in pt; a run's own size is scaled against it.
 */
export function richToPng(runs, { stack, color, size, align = 'left', pad = 8 }) {
  const px = (r) => ((r.size || size) / size) * TEXT_BASE
  const spec = (r) => `${r.i ? 'italic ' : ''}${r.b ? 700 : 400} ${px(r)}px ${stack(r.font)}`

  // split runs into lines
  let lines = [[]]
  for (const r of runs) {
    r.t.split('\n').forEach((seg, n) => {
      if (n) lines.push([])
      if (seg) lines[lines.length - 1].push({ ...r, t: seg })
    })
  }
  while (lines.length > 1 && !lines[lines.length - 1].length) lines.pop()

  const probe = document.createElement('canvas').getContext('2d')
  const laid = lines.map((segs) => {
    const widths = segs.map((r) => { probe.font = spec(r); return probe.measureText(r.t).width })
    const top = Math.max(TEXT_BASE * 0.6, ...segs.map(px))
    return { segs, widths, total: widths.reduce((a, b) => a + b, 0), top, h: Math.ceil(top * 1.45) }
  })
  const inner = Math.ceil(Math.max(1, ...laid.map((l) => l.total)))
  const slant = runs.some((r) => r.i) ? Math.round(TEXT_BASE * 0.12) : 0
  const w = inner + pad * 2 + slant
  const h = laid.reduce((a, l) => a + l.h, 0) + pad * 2

  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  ctx.textBaseline = 'alphabetic'
  let y = pad
  for (const l of laid) {
    let x = pad + (align === 'center' ? (inner - l.total) / 2 : align === 'right' ? inner - l.total : 0)
    const base = y + l.h / 2 + l.top * 0.33
    l.segs.forEach((r, i) => {
      const c = r.color || color
      ctx.font = spec(r)
      ctx.fillStyle = c
      ctx.strokeStyle = c
      ctx.lineWidth = Math.max(2, px(r) / 16)
      ctx.fillText(r.t, x, base)
      if (r.u) { ctx.beginPath(); ctx.moveTo(x, base + px(r) * 0.13); ctx.lineTo(x + l.widths[i], base + px(r) * 0.13); ctx.stroke() }
      if (r.s) { ctx.beginPath(); ctx.moveTo(x, base - px(r) * 0.3); ctx.lineTo(x + l.widths[i], base - px(r) * 0.3); ctx.stroke() }
      x += l.widths[i]
    })
    y += l.h
  }
  return canvas.toDataURL('image/png')
}

const hexToRgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255)
const dataUrlToBytes = (url) => Uint8Array.from(atob(url.split(',')[1]), (c) => c.charCodeAt(0))

/**
 * Build output PDF(s).
 * pages: [{fileId, index, rotation, id}]
 * edits: { watermark?, items: [{pageId, dataUrl, ratio, x, y, w, cover?}], flatten?, password? }
 */
export async function exportPdf(pages, sources, edits = {}, mode = 'merge') {
  const started = performance.now()
  const cache = new Map()
  const getSrc = async (fileId) => {
    if (!cache.has(fileId)) cache.set(fileId, await PDFDocument.load(sources.get(fileId).bytes, { ignoreEncryption: true }))
    return cache.get(fileId)
  }

  const build = async (list) => {
    const out = await PDFDocument.create()
    const wm = edits.watermark?.dataUrl ? await out.embedPng(dataUrlToBytes(edits.watermark.dataUrl)) : null
    const items = edits.items || []
    for (const p of list) {
      const meta = sources.get(p.fileId)
      const mine = items.filter((s) => s.pageId === p.id)
      const covered = mine.some((s) => s.cover)
      let page
      if (meta.unlocked || (edits.flatten && covered)) {
        // draw the page as an image: removes the original text for good
        const c = await renderToCanvas(meta.doc, p.index, 1600, 1)
        const jpg = await out.embedJpg(dataUrlToBytes(c.toDataURL('image/jpeg', 0.92)))
        page = out.addPage([c.ptW, c.ptH])
        page.drawImage(jpg, { x: 0, y: 0, width: c.ptW, height: c.ptH })
      } else {
        const src = await getSrc(p.fileId)
        const [copied] = await out.copyPages(src, [p.index])
        page = out.addPage(copied)
      }
      const { width: pw, height: ph } = page.getSize()

      for (const s of mine) {
        if (!s.cover) continue
        const { x, y, w, h, color } = s.cover
        const [r, g, b] = hexToRgb(color)
        page.drawRectangle({ x: x * pw, y: ph - (y + h) * ph, width: w * pw, height: h * ph, color: rgb(r, g, b) })
      }

      if (wm) {
        const w = pw * 0.7
        const h = w * edits.watermark.ratio
        const rad = (edits.watermark.angle * Math.PI) / 180
        // rotate around the centre of the mark
        const cx = pw / 2
        const cy = ph / 2
        page.drawImage(wm, {
          x: cx - (w / 2) * Math.cos(rad) + (h / 2) * Math.sin(rad),
          y: cy - (w / 2) * Math.sin(rad) - (h / 2) * Math.cos(rad),
          width: w,
          height: h,
          rotate: degrees(edits.watermark.angle),
          opacity: edits.watermark.opacity,
        })
      }

      for (const s of mine) {
        if (!s.dataUrl) continue
        const img = await out.embedPng(dataUrlToBytes(s.dataUrl))
        const w = s.w * pw
        const h = w * s.ratio
        page.drawImage(img, { x: s.x * pw, y: ph - s.y * ph - h, width: w, height: h })
      }

      if (p.rotation) page.setRotation(degrees((page.getRotation().angle + p.rotation) % 360))
    }
    const bytes = await out.save()
    return edits.password ? encryptPDF(bytes, edits.password) : bytes
  }

  const files = []
  if (mode === 'split') {
    for (let i = 0; i < pages.length; i++) {
      const bytes = await build([pages[i]])
      files.push({ name: `page-${String(i + 1).padStart(2, '0')}.pdf`, blob: new Blob([bytes], { type: 'application/pdf' }) })
    }
  } else {
    const bytes = await build(pages)
    const stamp = new Date().toISOString().slice(0, 10)
    files.push({ name: `studio-${stamp}.pdf`, blob: new Blob([bytes], { type: 'application/pdf' }) })
  }
  return { files, ms: Math.round(performance.now() - started), encrypted: !!edits.password }
}

export function downloadBlob({ name, blob }) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 2000)
}

export const formatSize = (n) => (n < 1024 * 1024 ? `${(n / 1024).toFixed(0)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`)
