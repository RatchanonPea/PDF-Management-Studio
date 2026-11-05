import { useEffect, useRef, useState } from 'react'
import { renderToCanvas, getTextRuns, splitAtRules, textToPng, richToPng, nextId, TEXT_BASE } from './pdf.js'
import { Icon } from './icons.jsx'
import { SIGN_FONTS, FONTS, CUSTOM_FONTS, getFont, fontStack } from './fonts.js'
import { FontSelect, TextInspector } from './TextInspector.jsx'
import { plain, applyStyle, stylesIn, replaceText } from './rich.js'
import { Select } from './Select.jsx'
import { Tip } from './Tip.jsx'
import { ColorField } from './ColorField.jsx'
import { detectBoxes, boxToPng, cropBox, boxFrame, accentOf, markOnBox, recolorBox, boxColors, nearest, MARK_STYLES } from './checkboxes.js'

const PENS = [
  { name: 'ดำ', value: '#111827' },
  { name: 'น้ำเงิน', value: '#1D3FD1' },
  { name: 'แดง', value: '#C8312B' },
]
const WM_FONT = '"Prompt", Sarabun, sans-serif'
const TABS = [
  { id: 'sign', label: 'เซ็นชื่อ' },
  { id: 'text', label: 'ข้อความ' },
  { id: 'image', label: 'รูปภาพ' },
  { id: 'edit', label: 'แก้ข้อความเดิม' },
  { id: 'watermark', label: 'ลายน้ำ' },
]

// an existing line that was clicked but not changed goes back to the original when you leave it
/** Rich-text runs from a line's pieces, so a bold label keeps its bold and the rest of the line does not. */
function runsOfParts(parts, fallback) {
  if (!parts?.length) return [{ t: fallback }]
  const runs = []
  for (const q of parts) {
    const last = runs[runs.length - 1]
    if (last && !!last.b === !!q.bold && !!last.i === !!q.italic) last.t += q.s
    else runs.push({ t: q.s, ...(q.bold && { b: true }), ...(q.italic && { i: true }) })
  }
  runs[0].t = runs[0].t.trimStart()
  runs[runs.length - 1].t = runs[runs.length - 1].t.trimEnd()
  return runs.filter((r) => r.t)
}

const lookKey = (s) => JSON.stringify([s.runs, s.font, s.size, s.color, s.align])
const untouched = (s) => !!s.run && s.initial === lookKey(s)

// with no ticked box in the document to copy from, boxes are plain black and white
const BW = '#000000'
const isColour = (hex) => { if (!hex) return false; const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)); return Math.max(...c) - Math.min(...c) > 60 }

const paintLook = (look, fill, mark) => (fill || mark ? recolorBox(look, fill, mark) : look).toDataURL()

const loadImage = (url) => new Promise((resolve) => { const i = new Image(); i.onload = () => resolve(i); i.src = url })

/** Rasterise a text item; its width follows from the font size in points. */
async function renderText(t, ptW) {
  const fonts = new Set([t.font, ...t.runs.map((r) => r.font).filter(Boolean)])
  const sample = plain(t.runs)
  await Promise.all([...fonts, 'sarabun'].flatMap((f) => [300, 400, 700].map((w) => document.fonts.load(`${w} 100px "${getFont(f).family}"`, sample)))).catch(() => {})
  const dataUrl = richToPng(t.runs, { stack: fontStack, font: t.font, color: t.color, size: t.size, align: t.align })
  const img = await loadImage(dataUrl)
  // sx squeezes (or stretches) the text sideways, to match the proportions of the original font
  const sx = t.sx || 1
  return { dataUrl, ratio: img.naturalHeight / img.naturalWidth / sx, w: (img.naturalWidth * (t.size / TEXT_BASE) * sx) / ptW }
}

/** Colours of a text run on the rendered page: background from just left of it, ink from its darkest pixel. */
function sampleColors(img, run) {
  const c = document.createElement('canvas')
  c.width = img.naturalWidth; c.height = img.naturalHeight
  const ctx = c.getContext('2d', { willReadFrequently: true })
  ctx.drawImage(img, 0, 0)
  const hex = (r, g, b) => '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')
  const clamp = (v, max) => Math.max(0, Math.min(max - 1, Math.round(v)))
  const bg = ctx.getImageData(clamp(run.x * c.width - 3, c.width), clamp((run.y + run.h / 2) * c.height, c.height), 1, 1).data
  const bx = clamp(run.x * c.width, c.width)
  const by = clamp(run.y * c.height, c.height)
  const box = ctx.getImageData(bx, by, Math.max(1, Math.min(c.width - bx, Math.round(run.w * c.width))), Math.max(1, Math.min(c.height - by, Math.round(run.h * c.height)))).data
  let best = [17, 24, 39], bestL = 999
  for (let i = 0; i < box.length; i += 4) {
    const l = box[i] + box[i + 1] + box[i + 2]
    if (l < bestL) { bestL = l; best = [box[i], box[i + 1], box[i + 2]] }
  }
  return { bg: hex(bg[0], bg[1], bg[2]), ink: hex(...best) }
}

/**
 * Rows covered by the letters in an RGBA region, ignoring table lines that run through it. With `baseRow`, only the ink
 * connected to the baseline counts, so a neighbouring line that pokes into the region is left out.
 */
function inkExtent(data, w, h, isInk, baseRow) {
  const col = new Uint32Array(w)
  const row = new Uint32Array(h)
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (isInk((y * w + x) * 4)) { col[x]++; row[y]++ }
  const has = new Uint8Array(h)
  for (let y = 0; y < h; y++) {
    if (row[y] > w * 0.9) continue // a horizontal rule
    for (let x = 0; x < w; x++) {
      if (col[x] > h * 0.8) continue // a vertical rule
      if (isInk((y * w + x) * 4)) { has[y] = 1; break }
    }
  }
  let top = h, bot = -1
  if (baseRow === undefined) {
    for (let y = 0; y < h; y++) if (has[y]) { if (y < top) top = y; bot = y }
  } else {
    // start at the ink nearest the baseline, then grow while the rows stay close together (marks sit apart from letters)
    const gap = Math.max(1, Math.round(h * 0.05))
    let seed = -1
    for (let d = 0; d <= gap + 2 && seed < 0; d++) {
      if (baseRow - d >= 0 && has[baseRow - d]) seed = baseRow - d
      else if (baseRow + d < h && has[baseRow + d]) seed = baseRow + d
    }
    if (seed >= 0) {
      top = bot = seed
      for (let y = seed - 1, miss = 0; y >= 0 && miss <= gap; y--) { if (has[y]) { top = y; miss = 0 } else miss++ }
      for (let y = seed + 1, miss = 0; y < h && miss <= gap; y++) { if (has[y]) { bot = y; miss = 0 } else miss++ }
    }
  }
  return bot < top ? { height: 0, top: 0, bot: -1 } : { height: bot - top + 1, top, bot }
}

/** Letter height of the original text on the page in points, and where its ink starts and ends (page fractions). */
async function originalInk(doc, pageIndex, run, bg, ptW) {
  const c = await renderToCanvas(doc, pageIndex, 1400, 1)
  const x0 = Math.max(0, Math.floor(run.x * c.width))
  const y0 = Math.max(0, Math.floor(run.y * c.height))
  const w = Math.max(1, Math.min(c.width - x0, Math.ceil(run.w * c.width)))
  const h = Math.max(1, Math.min(c.height - y0, Math.ceil(run.h * c.height)))
  const d = c.getContext('2d', { willReadFrequently: true }).getImageData(x0, y0, w, h).data
  const ref = [1, 3, 5].map((i) => parseInt(bg.slice(i, i + 2), 16))
  const baseRow = Math.round(run.base * c.height) - y0 - 1
  const ink = inkExtent(d, w, h, (i) => Math.abs(d[i] - ref[0]) + Math.abs(d[i + 1] - ref[1]) + Math.abs(d[i + 2] - ref[2]) > 120, baseRow)
  return { pt: ink.height / (c.width / ptW), top: ink.height ? (y0 + ink.top) / c.height : null, bot: ink.height ? (y0 + ink.bot + 1) / c.height : null }
}

/** Letter height of a rendered text image, in points at the given size. */
async function renderedInkPt(dataUrl, size) {
  const img = await loadImage(dataUrl)
  const c = document.createElement('canvas')
  c.width = img.naturalWidth; c.height = img.naturalHeight
  const ctx = c.getContext('2d', { willReadFrequently: true })
  ctx.drawImage(img, 0, 0)
  const d = ctx.getImageData(0, 0, c.width, c.height).data
  return (inkExtent(d, c.width, c.height, (i) => d[i + 3] > 80).height * size) / TEXT_BASE
}

export function Editor({ tab, onTab, onBack, onDirty, pages, sources, addFiles, busy, error, onExport }) {
  const [pageId, setPageId] = useState(pages[0]?.id)
  const [preview, setPreview] = useState(null)
  const [runs, setRuns] = useState([])
  const [runsState, setRunsState] = useState('loading') // loading | ok | an error message
  const [boxes, setBoxes] = useState([])
  const [markStyle, setMarkStyle] = useState('tick')
  const [boxFill, setBoxFill] = useState(null) // body colour behind the mark; null = keep the document's
  const [boxMark, setBoxMark] = useState(null) // colour of the tick / cross / dot
  const [boxTheme, setBoxTheme] = useState('bw') // 'bw' = black mark on white (default), 'doc' = copy the document's own boxes
  const boxCanvas = useRef(null)
  // looks of checked / unchecked boxes seen in this document, so a toggled box matches its theme
  const samples = useRef({ tick: [], cross: [], dot: [], off: [], seen: new Set() })
  const [zoom, setZoom] = useState(1)
  const [items, setItems] = useState([])
  const [selected, setSelected] = useState(null)
  const [pen, setPen] = useState(PENS[1].value)
  const [draft, setDraft] = useState('')
  const [draftFont, setDraftFont] = useState('prompt')
  const [signName, setSignName] = useState('')
  const [signFont, setSignFont] = useState(SIGN_FONTS[0])
  const [cleanBg, setCleanBg] = useState(true)
  const [flatten, setFlatten] = useState(false)
  const [wm, setWm] = useState({ text: 'สำเนาถูกต้อง', opacity: 0.25, angle: 35, color: '#2338D4', on: false })
  const [wmImg, setWmImg] = useState(null)
  const input = useRef(null)
  // phones: the tool panel is a bottom sheet that can be collapsed to just its tabs
  const [sheet, setSheet] = useState(false)

  useEffect(() => {
    if (selected) setSheet(true)
  }, [selected])

  const prevSelected = useRef(null)
  useEffect(() => {
    const prev = prevSelected.current
    prevSelected.current = selected
    if (prev && prev !== selected) setItems((list) => (list.some((s) => s.id === prev && untouched(s)) ? list.filter((s) => !(s.id === prev && untouched(s))) : list))
  }, [selected])

  useEffect(() => {
    const perPage = {}
    const live = items.filter((s) => !untouched(s))
    live.forEach((s) => { perPage[s.pageId] = (perPage[s.pageId] || 0) + 1 })
    onDirty((wm.on && wmImg ? 1 : 0) + live.length, perPage)
  }, [items, wm.on, wmImg])

  // undo / redo of everything placed on the pages; edits made within half a second count as one step
  const hist = useRef({ past: [], future: [], last: null, timer: null, skip: false })
  const [can, setCan] = useState({ undo: false, redo: false })
  const root = useRef(null)
  // everything that ends up in the PDF: the placed items, the watermark, the checkbox colours and the "erase original" switch
  const snapshot = () => ({ items: items.filter((s) => !untouched(s)), wm, boxFill, boxMark, flatten })
  useEffect(() => {
    const h = hist.current
    const now = snapshot()
    if (!h.last || h.skip) { h.skip = false; h.last = now; return }
    const l = h.last
    // a line that was only clicked (not changed) is not an edit, so it never makes a step
    const same = now.items.length === l.items.length && now.items.every((x, i) => x === l.items[i]) && now.wm === l.wm && now.boxFill === l.boxFill && now.boxMark === l.boxMark && now.flatten === l.flatten
    if (same) return
    if (!h.timer) { h.past.push(l); if (h.past.length > 100) h.past.shift(); h.future = [] }
    clearTimeout(h.timer)
    h.timer = setTimeout(() => { h.timer = null }, 500)
    h.last = now
    setCan({ undo: h.past.length > 0, redo: false })
  }, [items, wm, boxFill, boxMark, flatten])

  const apply = (snap) => {
    hist.current.skip = true
    setSelected((id) => (snap.items.some((x) => x.id === id) ? id : null))
    setItems(snap.items)
    setWm(snap.wm)
    setBoxFill(snap.boxFill)
    setBoxMark(snap.boxMark)
    setFlatten(snap.flatten)
  }
  const undo = () => {
    const h = hist.current
    clearTimeout(h.timer); h.timer = null
    if (!h.past.length) return
    h.future.push(h.last)
    apply(h.past.pop())
    setCan({ undo: h.past.length > 0, redo: true })
  }
  const redo = () => {
    const h = hist.current
    clearTimeout(h.timer); h.timer = null
    if (!h.future.length) return
    h.past.push(h.last)
    apply(h.future.pop())
    setCan({ undo: true, redo: h.future.length > 0 })
  }
  // the floating toolbar follows the selected text / picture on the page
  const [tbPos, setTbPos] = useState(null)
  const tbRef = useRef(null)
  const wantFocus = useRef(false) // set when a line was just clicked: the text field in the bar takes the cursor
  useEffect(() => {
    const place = () => {
      const el = root.current?.querySelector('.stamp-layer.is-sel')
      const cur = items.find((s) => s.id === selected)
      if (!el || !cur || cur.box || root.current.offsetParent === null) { setTbPos(null); return }
      const r = el.getBoundingClientRect()
      const w = tbRef.current?.offsetWidth || 440
      const h = tbRef.current?.offsetHeight || 96
      // the bar stays over the page area, never over the side panel
      const panelEl = root.current.querySelector('.panel')
      const vw = window.innerWidth > 900 && panelEl ? panelEl.getBoundingClientRect().left : window.innerWidth
      const vh = window.innerHeight
      const maxW = Math.min(700, vw - 16)
      const TOP = 76 // under the site header
      const BAND = 130 // the page toolbar (back, undo, zoom): covering it is allowed but costs a little
      const clamp = (v, lo, hi) => Math.max(lo, Math.min(v, Math.max(lo, hi)))
      // try above, below, right and left of the selected item, and keep the spot that covers the least other text
      const spots = [
        { top: r.top - h - 10, left: clamp(r.left, 8, vw - w - 8) },
        { top: r.bottom + 10, left: clamp(r.left, 8, vw - w - 8) },
        { top: clamp(r.top, TOP, vh - h - 8), left: r.right + 10 },
        { top: clamp(r.top, TOP, vh - h - 8), left: r.left - w - 10 },
      ]
      const others = [...root.current.querySelectorAll('.run-box, .stamp-layer:not(.is-sel)')].map((n) => n.getBoundingClientRect())
      const score = (s) => {
        // anything that leaves the window, or the page area, is a bad spot; overlap with other text counts by area
        const off = s.top < TOP || s.top + h > vh - 4 || s.left < 4 || s.left + w > vw - 4 ? 1e7 : 0
        const hit = others.reduce((sum, o) => sum + Math.max(0, Math.min(s.left + w, o.right) - Math.max(s.left, o.left)) * Math.max(0, Math.min(s.top + h, o.bottom) - Math.max(s.top, o.top)), 0)
        // covering the selected item itself is far worse than covering anything else
        const own = Math.max(0, Math.min(s.left + w, r.right) - Math.max(s.left, r.left)) * Math.max(0, Math.min(s.top + h, r.bottom) - Math.max(s.top, r.top))
        // text matters most, then the page toolbar
        const band = Math.max(0, BAND - s.top) * w * 0.1
        return off + hit * 10 + band + own * 100
      }
      const best = spots.reduce((a, b) => (score(b) < score(a) ? b : a))
      const top = Math.round(clamp(best.top, TOP, vh - h - 8))
      const left = Math.round(clamp(best.left, 8, vw - w - 8))
      setTbPos((p) => (p && p.top === top && p.left === left && p.maxW === maxW ? p : { top, left, maxW }))
    }
    place()
    const raf = requestAnimationFrame(place) // once more after the bar itself has been measured
    const sc = root.current?.querySelector('.stage-scroll')
    sc?.addEventListener('scroll', place)
    window.addEventListener('resize', place)
    return () => { cancelAnimationFrame(raf); sc?.removeEventListener('scroll', place); window.removeEventListener('resize', place) }
  }, [selected, items, zoom, pageId])

  const undoRef = useRef({})
  undoRef.current = { undo, redo }
  useEffect(() => {
    const key = (e) => {
      if (!root.current || root.current.offsetParent === null) return // the editor is not on screen
      const t = e.target
      const typing = t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)
      // Delete / Backspace remove what is selected (a line that was clicked goes back to the original); Esc lets go of it
      if (!typing && !e.ctrlKey && !e.metaKey && !e.altKey) {
        // Backspace only when nothing else has the focus, so it cannot fire from a button the user just used
        const idle = t === document.body || !!t.closest?.('.stage-scroll')
        if ((e.key === 'Delete' || (e.key === 'Backspace' && idle)) && undoRef.current.removeSelected?.()) { e.preventDefault(); return }
        if (e.key === 'Escape' && undoRef.current.deselect?.()) return
      }
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return
      if (typing) return // typing keeps its own undo
      const k = e.key.toLowerCase()
      if (k === 'z' && !e.shiftKey) { e.preventDefault(); undoRef.current.undo() }
      else if ((k === 'z' && e.shiftKey) || k === 'y') { e.preventDefault(); undoRef.current.redo() }
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [])

  useEffect(() => {
    if (tab === 'watermark') setWm((w) => ({ ...w, on: true }))
  }, [tab])

  const page = pages.find((p) => p.id === pageId) || pages[0]
  const ptW = page?.ptW || 595

  useEffect(() => {
    if (!page && pages[0]) setPageId(pages[0].id)
  }, [pages, page])

  useEffect(() => {
    if (!page) return
    let live = true
    setSelected(null)
    setRuns([])
    setRunsState('loading')
    const doc = sources.get(page.fileId).doc
    const rendered = renderToCanvas(doc, page.index, 760)
    rendered.then((c) => {
      if (live) setPreview({ url: c.toDataURL('image/png'), ratio: c.height / c.width })
    })
    Promise.all([rendered, getTextRuns(doc, page.index)])
      .then(([c, r]) => { if (live) { setRuns(splitAtRules(r, c)); setRunsState('ok') } })
      .catch((e) => { console.error(e); if (live) setRunsState(`${e?.name || 'Error'}: ${e?.message || e}`) })
    return () => { live = false }
  }, [page?.id])

  // checkboxes are found from the rendered page once its text lines are known (so letters are not mistaken for boxes)
  useEffect(() => {
    if (!page || tab !== 'edit' || runsState === 'loading') return
    let live = true
    setBoxes([])
    renderToCanvas(sources.get(page.fileId).doc, page.index, 1400, 1)
      .then((c) => {
        if (!live) return
        const found = detectBoxes(c, runs)
        boxCanvas.current = c
        for (const b of found) {
          const id = `${page.id}:${b.key}`
          if (samples.current.seen.has(id)) continue
          samples.current.seen.add(id)
          const list = samples.current[b.checked ? b.kind : 'off']
          if (list.length < 12) { const crop = cropBox(c, b); list.push({ crop, bw: b.px.bw, accent: b.checked ? accentOf(crop) : null }) }
        }
        setBoxes(found)
      })
      .catch((e) => console.error(e))
    return () => { live = false }
  }, [page?.id, tab, runsState])

  useEffect(() => {
    let live = true
    const text = wm.text.trim()
    if (!text) { setWmImg(null); return }
    Promise.all([
      document.fonts.load('700 100px Prompt', text),
      document.fonts.load('700 100px Sarabun', text),
    ]).catch(() => {}).then(() => {
      const url = textToPng(text, { font: WM_FONT, color: wm.color, pad: 20 })
      const img = new Image()
      img.onload = () => live && setWmImg({ dataUrl: url, ratio: img.naturalHeight / img.naturalWidth })
      img.src = url
    })
    return () => { live = false }
  }, [wm.text, wm.color])

  useEffect(() => {
    setItems((prev) => prev.map((s) => (s.box ? { ...s, dataUrl: s.on ? paintLook(s.look, boxFill, boxMark) : s.dataUrl } : s)))
  }, [boxFill, boxMark])

  const pickFromPage = async (set) => {
    try { set((await new window.EyeDropper().open()).sRGBHex) } catch { /* cancelled */ }
  }

  // the colours the document itself uses for the selected kind of mark, shown in the colour pickers
  const docLook = (() => {
    if (boxTheme === 'bw') return { mark: BW, body: '#ffffff' }
    const t = samples.current.tick[0]
    if (t) return boxColors(t.crop)
    const accent = ['cross', 'dot'].flatMap((k) => samples.current[k]).map((x) => x.accent).find(isColour)
    return accent ? { mark: '#ffffff', body: accent } : { mark: BW, body: '#ffffff' }
  })()

  const renderSeq = useRef({})

  if (!pages.length) {
    return (
      <div className="workspace">
        <div className="empty">
          <span className="empty-art" aria-hidden="true"><Icon name="sheet" size={34} /></span>
          <p className="sheet-title">{busy ? 'กำลังอ่านไฟล์…' : 'เลือกไฟล์ PDF ที่ต้องการแก้ไข'}</p>
          <button className="btn primary" onClick={() => input.current.click()} disabled={busy}><Icon name="plus" /> เลือกไฟล์ PDF</button>
          <input ref={input} type="file" accept="application/pdf,.pdf" multiple hidden onChange={(e) => { addFiles(e.target.files); e.target.value = '' }} />
          {error && <p className="error" role="alert">{error}</p>}
        </div>
      </div>
    )
  }

  const here = items.filter((s) => s.pageId === page.id)
  const sel = here.find((s) => s.id === selected)
  const patch = (id, change) => setItems((prev) => prev.map((s) => (s.id === id ? { ...s, ...change } : s)))
  const remove = (id) => { setItems((p) => p.filter((s) => s.id !== id)); setSelected(null) }
  // for the Delete / Escape keys (the key handler lives above the early return, so it reaches these through a ref)
  undoRef.current.removeSelected = () => { if (!sel) return false; remove(sel.id); return true }
  undoRef.current.deselect = () => { if (!sel) return false; setSelected(null); return true }

  const addImage = ({ dataUrl, ratio, w = 0.25 }) => {
    const id = nextId()
    setItems((prev) => [...prev, { id, kind: 'image', pageId: page.id, dataUrl, ratio, x: 0.35, y: 0.65, w }])
    setSelected(id)
  }

  const addText = async (base) => {
    const id = nextId()
    const t = { id, kind: 'text', pageId: page.id, font: 'sarabun', size: 18, color: '#111827', align: 'left', x: 0.2, y: 0.2, ...base }
    t.text = t.text || 'ข้อความ'
    t.runs = base.runs || [{ t: t.text, ...(t.bold && { b: true }), ...(t.italic && { i: true }) }]
    t.text = plain(t.runs)
    const r = await renderText(t, ptW)
    const item = { ...t, ...r }
    if (item.run) item.initial = lookKey(item)
    setItems((prev) => [...prev, item])
    setSelected(id)
  }

  const editItem = async (item, change) => {
    patch(item.id, change)
    const next = { ...item, ...change }
    if (!plain(next.runs)) return
    const n = (renderSeq.current[item.id] = (renderSeq.current[item.id] || 0) + 1)
    const r = await renderText(next, ptW)
    if (renderSeq.current[item.id] === n) patch(item.id, r)
  }

  const pickRun = async (run) => {
    const exist = here.find((s) => s.run === run)
    if (exist) { setSelected(exist.id); return }
    const { bg, ink } = sampleColors(await loadImage(preview.url), run)
    const ptH = ptW * page.ratio
    const pad = 0.004
    wantFocus.current = true
    // the document's fonts differ from ours, so match the height of the real letters instead of trusting the font size
    const runs = runsOfParts(run.parts, run.str)
    let size = run.size
    let sx = 1
    let inkTop = null
    let inkBot = null
    try {
      const orig = await originalInk(sources.get(page.fileId).doc, page.index, run, bg, ptW)
      const want = orig.pt
      // never wider than the line's own box, so a neighbouring line is not wiped out
      inkTop = orig.top === null ? null : Math.max(orig.top, run.base - (0.9 * run.size) / ptH)
      inkBot = orig.bot === null ? null : Math.min(orig.bot, run.base + (0.25 * run.size) / ptH)
      const trial = await renderText({ runs, font: run.serif ? 'pridi' : 'sarabun', size, color: ink, align: 'left' }, ptW)
      const got = await renderedInkPt(trial.dataUrl, size)
      if (want > 0 && got > 0) size = Math.min(run.size * 1.1, Math.max(run.size * 0.6, (size * want) / got)) // the PDF's own size is rarely far off
      // then the width: our font is usually wider than the document's, so squeeze the new text to the original line width
      const wide = await renderText({ runs, font: run.serif ? 'pridi' : 'sarabun', size, color: ink, align: 'left' }, ptW)
      const inner = wide.w * ptW - (2 * 8 * size) / TEXT_BASE
      if (inner > 0) sx = Math.min(1.15, Math.max(0.6, (run.w * ptW) / inner))
    } catch (e) { console.error(e) }
    await addText({
      run,
      text: run.str,
      runs,
      unknown: run.unknown,
      font: run.serif ? 'pridi' : 'sarabun',
      size,
      sx,
      color: ink,
      // the text image has a small margin and a taller line box than the original run
      x: run.x - (8 * size * sx) / TEXT_BASE / ptW,
      // sit the new text on the original baseline (in the text image the baseline is 1.105 x size below its top edge)
      y: run.base - (1.105 * size) / ptH,
      // cover only where the letters really are, never the neighbouring lines above or below
      cover: inkTop === null ? { x: run.x - pad, y: run.y - pad / 2, w: run.w + pad * 2, h: run.h + pad, color: bg } : { x: run.x - pad, y: inkTop - pad * 0.75, w: run.w + pad * 2, h: inkBot - inkTop + pad * 1.5, color: bg },
    })
  }

  // the new look of a box: copied from the document's own boxes where possible, so any checkbox theme matches
  const boxLook = (b, style = markStyle) => {
    const { tick, cross, dot, off } = samples.current
    if (b.checked) return nearest(off, b)?.crop || boxToPng(false, style, BW)
    // default: a plain black mark on the box's own white body, whatever colours the document uses
    if (boxTheme === 'bw') return markOnBox(cropBox(boxCanvas.current, b), style, BW, false)
    // the document's own ticked box is the model; the other marks are the same box with a different white mark
    const own = nearest(tick, b)
    if (style === 'tick' && own) return own.crop
    // a document with a coloured theme: solid body with a white mark; a black-and-white one: plain black mark on white
    const accent = [tick, cross, dot].flat().map((t) => t.accent).find(isColour)
    return markOnBox(cropBox(boxCanvas.current, b), style, accent || BW, !!accent)
  }

  const toggleBox = (b) => {
    const exist = here.find((s) => s.box === b.key)
    if (exist) { remove(exist.id); return } // clicking again restores the original box
    const id = nextId()
    const look = boxLook(b)
    const f = boxFrame(b)
    const pad = 0.0012
    setItems((prev) => [...prev, {
      id, kind: 'image', pageId: page.id, box: b.key, b, 
      look, on: !b.checked, dataUrl: b.checked ? paintLook(look) : paintLook(look, boxFill, boxMark), ratio: f.ratio,
      x: f.x, y: f.y, w: f.w,
      cover: { x: f.x - pad, y: f.y - pad * 0.7, w: f.w + pad * 2, h: f.h + pad * 1.4, color: b.bg },
    }])
  }

  const dragItem = (e, s) => {
    e.preventDefault()
    setSelected(s.id)
    const box = e.currentTarget.parentElement.getBoundingClientRect()
    const start = { px: e.clientX, py: e.clientY, x: s.x, y: s.y }
    const h = s.w * s.ratio * (box.width / box.height)
    const move = (ev) => {
      patch(s.id, {
        x: Math.min(1 - s.w, Math.max(0, start.x + (ev.clientX - start.px) / box.width)),
        y: Math.min(1 - h, Math.max(0, start.y + (ev.clientY - start.py) / box.height)),
      })
    }
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up) }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  const exportNow = () =>
    onExport('merge', {
      watermark: wm.on && wmImg ? { ...wmImg, opacity: wm.opacity, angle: wm.angle } : null,
      items: items.filter((s) => s.dataUrl && !untouched(s) && pages.some((p) => p.id === s.pageId)),
      flatten,
    })

  // whole-box formatting for the floating toolbar (the same rules as the side panel)
  const textTotal = sel?.runs ? [...plain(sel.runs)].length : 0
  const setWhole = (k, v) => editItem(sel, { [k]: v, runs: applyStyle(sel.runs, 0, textTotal, { [k]: undefined }) })
  const setWeight = (w) => editItem(sel, { runs: applyStyle(sel.runs, 0, textTotal, w === 'bold' ? { b: true, l: undefined } : w === 'light' ? { l: true, b: undefined } : { b: undefined, l: undefined }) })
  const weightNow = (() => {
    if (!sel?.runs) return 'normal'
    const st = stylesIn(sel.runs, 0, textTotal)
    return st.length && st.every((x) => x.b) ? 'bold' : st.length && st.every((x) => x.l) ? 'light' : 'normal'
  })()
  const fontOptions = [...FONTS, ...CUSTOM_FONTS].map((f) => ({ id: f.id, label: f.label, style: { fontFamily: fontStack(f.id) } }))

  const hasCover =items.some((s) => s.cover)
  const applied = (wm.on && wmImg ? 1 : 0) + items.filter((s) => !untouched(s) && pages.some((p) => p.id === s.pageId)).length

  return (
    <div className="editor" ref={root}>
      <section className="stage" aria-label="ตัวอย่างหน้า PDF">
        <div className="stage-bar">
          <button className="btn back" onClick={onBack}><span aria-hidden="true">‹</span> กลับ</button>
          <div className="zoom">
            <button onClick={undo} disabled={!can.undo} aria-label="ย้อนกลับ (Ctrl+Z)" title="ย้อนกลับ (Ctrl+Z)"><Icon name="undo" size={18} /></button>
            <button onClick={redo} disabled={!can.redo} aria-label="ทำซ้ำ (Ctrl+Shift+Z)" title="ทำซ้ำ (Ctrl+Shift+Z)" style={{ transform: 'scaleX(-1)' }}><Icon name="undo" size={18} /></button>
          </div>
          <div className="zoom">
            <button onClick={() => setZoom((z) => Math.max(0.5, +(z - 0.1).toFixed(1)))} aria-label="ซูมออก">−</button>
            <span>{Math.round(zoom * 100)}%</span>
            <button onClick={() => setZoom((z) => Math.min(1.6, +(z + 0.1).toFixed(1)))} aria-label="ซูมเข้า">+</button>
          </div>
          <span className="count">หน้า {pages.indexOf(page) + 1} จาก {pages.length}</span>
        </div>
        <div className="stage-scroll" onPointerDown={(e) => e.target === e.currentTarget && setSelected(null)}>
          {preview && (
            <div className="canvas" style={{ width: `calc(min(560px, 100vw - 32px) * ${zoom})`, aspectRatio: `${1 / preview.ratio}` }}>
              <img src={preview.url} alt="" draggable="false" />
              {here.filter((s) => s.cover).map((s) => (
                <span key={`c${s.id}`} className="cover-layer" style={{ left: `${s.cover.x * 100}%`, top: `${s.cover.y * 100}%`, width: `${s.cover.w * 100}%`, height: `${s.cover.h * 100}%`, background: s.cover.color }} />
              ))}
              {wm.on && wmImg && (
                <img className="wm-layer" src={wmImg.dataUrl} alt="" draggable="false" style={{ opacity: wm.opacity, transform: `translate(-50%,-50%) rotate(${-wm.angle}deg)` }} />
              )}
              {tab === 'edit' && runs.map((r, i) => (
                <button
                  key={i}
                  className="run-box"
                  style={{ left: `${r.x * 100}%`, top: `${r.y * 100}%`, width: `${r.w * 100}%`, height: `${r.h * 100}%` }}
                  onClick={() => pickRun(r)}
                  aria-label={`แก้ข้อความ ${r.str}`}
                />
              ))}
              {tab === 'edit' && boxes.map((b) => {
                const mine = here.find((s) => s.box === b.key)
                return (
                  <button
                    key={b.key}
                    className={`box-hit ${mine ? 'on' : ''}`}
                    style={{ left: `${b.x * 100}%`, top: `${b.y * 100}%`, width: `${b.w * 100}%`, height: `${b.h * 100}%` }}
                    onClick={() => toggleBox(b)}
                    aria-pressed={b.checked !== !!mine}
                    aria-label={`ช่องเลือก ${b.checked !== !!mine ? 'ติ๊กอยู่' : 'ว่าง'} กดเพื่อสลับ`}
                  />
                )
              })}
              {here.filter((s) => s.dataUrl).map((s) => (
                <img
                  key={s.id}
                  className={`stamp-layer ${s.id === selected ? 'is-sel' : ''}`}
                  src={s.dataUrl}
                  alt={s.kind === 'text' ? s.text : 'รูปภาพ'}
                  draggable="false"
                  // height is set from the item's own ratio, exactly as the export draws it (a squeezed text image must not stretch here)
                  style={{ left: `${s.x * 100}%`, top: `${s.y * 100}%`, width: `${s.w * 100}%`, height: `${((s.w * s.ratio) / page.ratio) * 100}%`, pointerEvents: s.box ? 'none' : undefined }}
                  onPointerDown={(e) => dragItem(e, s)}
                />
              ))}
            </div>
          )}
        </div>
        <ul className="strip" aria-label="เลือกหน้า">
          {pages.map((p, i) => (
            <li key={p.id}>
              <button className={p.id === page.id ? 'on' : ''} onClick={() => setPageId(p.id)} aria-label={`หน้า ${i + 1}`} aria-current={p.id === page.id}>
                <img src={p.thumb} alt="" draggable="false" />
                <span>{i + 1}</span>
              </button>
            </li>
          ))}
        </ul>
      </section>

      <aside className={`panel ${sheet ? 'is-open' : ''}`}>
        <button className="sheet-toggle" aria-expanded={sheet} onClick={() => setSheet((v) => !v)}>
          <span aria-hidden="true">{sheet ? '▾' : '▴'}</span> {sheet ? 'ย่อเมนู' : 'เปิดเมนูเครื่องมือ'}
        </button>
        <div className="seg wide tabs" role="tablist">
          {TABS.map((t) => (
            <button key={t.id} role="tab" aria-selected={tab === t.id} className={tab === t.id ? 'on' : ''} onClick={() => { setSheet(true); onTab(t.id) }}>{t.label}</button>
          ))}
        </div>

        <div className="panel-body" key={tab}>
          {tab === 'sign' && (
            <>
              <SignaturePad pen={pen} onInsert={addImage} />
              <div className="field">
                <span className="label">สีปากกา</span>
                <div className="pens">
                  {PENS.map((p) => (
                    <button key={p.value} className={pen === p.value ? 'on' : ''} style={{ '--pen': p.value }} onClick={() => setPen(p.value)} aria-label={p.name} aria-pressed={pen === p.value} />
                  ))}
                </div>
              </div>
              <div className="field">
                <span className="label">หรือนำเข้าจากรูปภาพ</span>
                <ImagePicker label="นำเข้ารูปลายเซ็นหรือตราประทับ" onPick={addImage} cleanBg={cleanBg} />
                <label className="check-row">
                  <input type="checkbox" checked={cleanBg} onChange={(e) => setCleanBg(e.target.checked)} />
                  ลบพื้นหลังสีขาวของรูป
                </label>
                <Tip>ถ่ายหรือสแกนลายเซ็นบนกระดาษขาว ระบบจะทำให้พื้นหลังโปร่งใส</Tip>
              </div>
              <div className="field">
                <label className="label" htmlFor="signname">หรือพิมพ์ชื่อเป็นลายเซ็น</label>
                <input id="signname" className="text" value={signName} onChange={(e) => setSignName(e.target.value)} placeholder="ชื่อ-นามสกุล" style={{ fontFamily: fontStack(signFont), fontSize: 22 }} />
                <FontSelect value={signFont} onChange={setSignFont} ids={SIGN_FONTS} label="แบบลายเซ็น" />
                <button className="btn" disabled={!signName.trim()} onClick={() => { addText({ text: signName.trim(), font: signFont, color: pen, size: 36 }); setSignName('') }}>
                  <Icon name="plus" /> วางลายเซ็นที่พิมพ์
                </button>
              </div>
            </>
          )}

          {tab === 'text' && (
            <>
              <div className="field">
                <label className="label" htmlFor="newtext">พิมพ์ข้อความลงบนหน้านี้</label>
                <textarea id="newtext" className="text" rows="3" placeholder="พิมพ์ที่นี่ เช่น ชื่อ วันที่ หมายเหตุ" value={draft} onChange={(e) => setDraft(e.target.value)} style={{ fontFamily: fontStack(draftFont) }} />
                <FontSelect value={draftFont} onChange={setDraftFont} label="ฟอนต์" />
                <button className="btn primary" disabled={!draft.trim()} onClick={() => { addText({ text: draft.trim(), font: draftFont }); setDraft('') }}>
                  <Icon name="plus" /> วางข้อความบนหน้า
                </button>
              </div>
              <Tip>วางแล้วลากเพื่อย้ายตำแหน่ง กดข้อความเพื่อแก้ไขขนาดและสี</Tip>
            </>
          )}

          {tab === 'image' && (
            <>
              <ImagePicker label="เลือกรูปภาพ (PNG, JPG, WebP)" onPick={addImage} />
              <Tip>แทรกรูปภาพ โลโก้ หรือรูปถ่ายลงบนหน้านี้ ลากเพื่อย้าย และปรับขนาดด้วยแถบเลื่อน</Tip>
            </>
          )}

          {tab === 'edit' && (
            <>
              <p className="hint strong">คลิกข้อความบนหน้ากระดาษ (กรอบสีน้ำเงิน) เพื่อแก้ไข <Tip>ระบบจะปิดทับข้อความเดิมด้วยสีพื้นหลังแล้ววางข้อความใหม่แทน ฟอนต์อาจไม่ตรงกับต้นฉบับ</Tip></p>
              {runsState === 'loading' && <p className="hint" role="status">กำลังอ่านข้อความในหน้านี้…</p>}
              {runsState === 'ok' && !runs.length && <p className="hint">ไม่พบข้อความที่แก้ไขได้ในหน้านี้ ไฟล์อาจเป็นภาพสแกน</p>}
              {runsState !== 'loading' && runsState !== 'ok' && (
                <p className="error" role="alert">อ่านข้อความในหน้านี้ไม่ได้ ({runsState}) · เวอร์ชัน {__APP_VERSION__}</p>
              )}
              <div className="field">
                <div className="label-row">
                  <span className="label">ช่อง checkbox ในหน้านี้ ({boxes.length} ช่อง)</span>
                  <Tip>คลิกที่ช่อง (กรอบสีเขียว) เพื่อสลับติ๊ก/ว่าง คลิกซ้ำเพื่อคืนค่าเดิม<br /><br />เลือกรูปแบบเครื่องหมายก่อนคลิกช่อง ค่าเริ่มต้นเป็นขาวดำ (เครื่องหมายดำ พื้นขาว) ถ้าเลือก “ตามเอกสาร” ระบบจะคัดลอกหน้าตาช่อง (สี ขอบ มุม) จากช่องที่ติ๊กและช่องว่างในเอกสารนี้ ตรวจจากภาพหน้ากระดาษ อาจพลาดช่องที่รูปร่างไม่ปกติ</Tip>
                </div>
                <div className="chips marks">
                  {MARK_STYLES.map((m) => (
                    <button key={m.id} className={markStyle === m.id ? 'on' : ''} aria-pressed={markStyle === m.id} onClick={() => setMarkStyle(m.id)}>{m.glyph} {m.label}</button>
                  ))}
                </div>
                <div className="seg wide theme-seg" role="radiogroup" aria-label="สีของช่อง">
                  {[['bw', 'ขาวดำ'], ['doc', 'ตามเอกสาร']].map(([id, text]) => (
                    <button key={id} role="radio" aria-checked={boxTheme === id} className={boxTheme === id ? 'on' : ''} onClick={() => { setBoxTheme(id); setBoxMark(null); setBoxFill(null) }}>{text}</button>
                  ))}
                </div>
                <details className="more">
                  <summary>ปรับสีเอง (ไม่บังคับ)</summary>
                  <div className="color-panel">
                    <div className="color-preview" aria-hidden="true" style={{ background: boxFill || docLook.body, color: boxMark || docLook.mark }}>
                      {markStyle === 'tick' && <svg viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12.5l4.5 4.5L19 7" /></svg>}
                      {markStyle === 'cross' && <svg viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg>}
                      {markStyle === 'dot' && <svg viewBox="0 0 24 24" width="30" height="30" fill="currentColor"><circle cx="12" cy="12" r="5.5" /></svg>}
                      <small>ตัวอย่าง</small>
                    </div>
                    <div className="color-rows">
                      {[['เครื่องหมาย', 'ตัวถูก ผิด จุด', 'boxmark', boxMark, setBoxMark, docLook.mark], ['พื้นในช่อง', 'สีด้านหลังเครื่องหมาย', 'boxfill', boxFill, setBoxFill, docLook.body]].map(([label, hint, id, val, set, dflt]) => (
                        <div className="bg-row" key={id}>
                          <label className="label" htmlFor={id}>{label} <small>{hint}</small></label>
                          <div className="bg-ctrl">
                            <ColorField id={id} label={label} value={val || dflt} onChange={set} />
                            {'EyeDropper' in window && <button className="icon-btn" title="ดูดสีจากหน้า" aria-label={`ดูดสี${label}จากหน้า`} onClick={() => pickFromPage(set)}><Icon name="drop" size={18} /></button>}
                            <button className="icon-btn" title="รีเซ็ตเป็นค่าเริ่มต้น" aria-label={`รีเซ็ตสี${label}`} disabled={!val} onClick={() => set(null)}><Icon name="undo" size={18} /></button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                  <div className="color-note">ใช้กับทุกช่องที่ติ๊ก ขอบช่องคงเดิม <Tip>ช่องสีแสดงสีที่จะได้ตอนนี้ ถ้าเลือกสีเอง จะใช้กับทุกช่องที่ติ๊ก ขอบคงเดิม</Tip></div>
                </details>
              </div>
              <div className="label-row">
                <label className="check-row">
                  <input type="checkbox" checked={flatten} onChange={(e) => setFlatten(e.target.checked)} />
                  ลบข้อความเดิมถาวร
                </label>
                <Tip>เปิดตัวเลือกนี้ หน้าที่แก้ไขจะกลายเป็นภาพ ข้อความเดิมจะค้นหาหรือคัดลอกไม่ได้อีก{hasCover && !flatten ? ' ถ้าไม่เปิด ข้อความเดิมยังคงอยู่ใต้ชั้นปิดทับ' : ''}</Tip>
              </div>
            </>
          )}

          {tab === 'watermark' && (
            <>
              <label className="check-row">
                <input type="checkbox" checked={wm.on} onChange={(e) => setWm({ ...wm, on: e.target.checked })} />
                ใส่ลายน้ำทุกหน้า
              </label>
              <div className="field">
                <label className="label" htmlFor="wmtext">ข้อความลายน้ำ</label>
                <input id="wmtext" className="text" value={wm.text} onChange={(e) => setWm({ ...wm, text: e.target.value })} />
                <div className="chips">
                  {['CONFIDENTIAL', 'สำเนาถูกต้อง', 'ห้ามคัดลอก'].map((t) => (
                    <button key={t} onClick={() => setWm({ ...wm, text: t })}>{t}</button>
                  ))}
                </div>
              </div>
              <div className="field">
                <label className="label" htmlFor="op">ความโปร่งใส <b>{Math.round(wm.opacity * 100)}%</b></label>
                <input id="op" type="range" min="0.05" max="0.8" step="0.01" value={wm.opacity} onChange={(e) => setWm({ ...wm, opacity: +e.target.value })} />
              </div>
              <div className="field">
                <label className="label" htmlFor="ang">มุมเอียง <b>{wm.angle}°</b></label>
                <input id="ang" type="range" min="0" max="90" step="1" value={wm.angle} onChange={(e) => setWm({ ...wm, angle: +e.target.value })} />
              </div>
              <div className="field">
                <span className="label">สี</span>
                <div className="pens">
                  {['#2338D4', '#C8312B', '#111827'].map((c) => (
                    <button key={c} className={wm.color === c ? 'on' : ''} style={{ '--pen': c }} onClick={() => setWm({ ...wm, color: c })} aria-label={c} aria-pressed={wm.color === c} />
                  ))}
                </div>
                <ColorField id="wmcolor" label="สีลายน้ำ" value={wm.color} onChange={(c) => setWm({ ...wm, color: c })} />
              </div>
            </>
          )}

          {sel && (
            <div className="field inspector">
              <span className="label">{sel.kind === 'text' ? 'ข้อความที่เลือก' : 'รูปที่เลือก'}</span>
              {sel.unknown > 0 && <p className="error" role="alert">ไฟล์เก็บวรรณยุกต์ {sel.unknown} ตัวในบรรทัดนี้ไว้อ่านไม่ได้ ระบบเดาให้ว่า ่ หรือ ้ ช่วยตรวจและแก้ในช่องข้อความ</p>}
              {sel.kind === 'text' ? (
                <TextInspector key={sel.id} item={sel} onEdit={(c) => editItem(sel, c)} pens={PENS} onUndo={undo} onRedo={redo} />
              ) : (
                <>
                  <label className="label" htmlFor="size">ขนาด</label>
                  <input id="size" type="range" min="0.05" max="0.9" step="0.01" value={sel.w} onChange={(e) => patch(sel.id, { w: Math.min(+e.target.value, 1 - sel.x) })} />
                </>
              )}
              <button className="btn danger" onClick={() => remove(sel.id)} title={sel.run ? 'ลบการแก้ไข ข้อความจะกลับเป็นต้นฉบับ' : undefined}>
                <Icon name="trash" /> ลบรายการนี้
              </button>
            </div>
          )}
        </div>

        <div className="panel-foot">
          {error && <p className="error" role="alert">{error}</p>}
          <button className="btn primary full" disabled={busy || !applied} onClick={exportNow}>
            {busy ? <span className="spin" aria-hidden="true" /> : <Icon name="download" />} {busy ? 'กำลังสร้างไฟล์…' : 'สร้างและดาวน์โหลด'}
          </button>
        </div>
      </aside>

      {tbPos && sel && (
        <div className="textbar" ref={tbRef} style={{ top: tbPos.top, left: tbPos.left, maxWidth: tbPos.maxW }} role="toolbar" aria-label={sel.kind === 'text' ? 'จัดรูปแบบข้อความที่เลือก' : 'ปรับรูปที่เลือก'}>
          {sel.kind === 'text' ? (
            <>
              <textarea
                className="text tb-text"
                rows={Math.min(4, plain(sel.runs).split('\n').length)}
                value={plain(sel.runs)}
                spellCheck={false}
                aria-label="ข้อความ"
                ref={(el) => { if (el && wantFocus.current) { wantFocus.current = false; el.focus(); el.setSelectionRange(el.value.length, el.value.length) } }}
                onChange={(e) => editItem(sel, { runs: replaceText(sel.runs, e.target.value), text: e.target.value })}
              />
              <div className="tb-font"><Select value={sel.font} onChange={(id) => setWhole('font', id)} label="ฟอนต์" options={fontOptions} /></div>
              <div className="tb-size" role="group" aria-label="ขนาดตัวอักษร">
                <button onClick={() => setWhole('size', Math.max(1, Math.round(sel.size) - 1))} aria-label="ลดขนาด">−</button>
                <input type="number" min="1" max="400" step="1" inputMode="decimal" value={Math.round(sel.size * 10) / 10} aria-label="ขนาดตัวอักษร (pt)" onFocus={(e) => e.target.select()} onChange={(e) => { const n = parseFloat(e.target.value); if (n >= 1 && n <= 400) setWhole('size', n) }} />
                <button onClick={() => setWhole('size', Math.min(400, Math.round(sel.size) + 1))} aria-label="เพิ่มขนาด">+</button>
              </div>
              <div className="seg tb-weight" role="radiogroup" aria-label="ความหนา">
                {[['light', 'บาง'], ['normal', 'ปกติ'], ['bold', 'หนา']].map(([id, text]) => (
                  <button key={id} role="radio" aria-checked={weightNow === id} className={weightNow === id ? 'on' : ''} style={{ fontWeight: id === 'bold' ? 700 : id === 'light' ? 300 : 500 }} onClick={() => setWeight(id)}>{text}</button>
                ))}
              </div>
              <div className="tb-colors" role="group" aria-label="สีข้อความ">
                {PENS.map((c) => (
                  <button key={c.value} className={sel.color === c.value ? 'on' : ''} style={{ '--pen': c.value }} onClick={() => setWhole('color', c.value)} aria-label={c.name} aria-pressed={sel.color === c.value} />
                ))}
                <input type="color" value={sel.color} onChange={(e) => setWhole('color', e.target.value)} aria-label="เลือกสีเอง" title={sel.color} />
              </div>
            </>
          ) : (
            <label className="tb-slider">
              <span>ขนาด</span>
              <input type="range" min="0.05" max="0.9" step="0.01" value={sel.w} aria-label="ขนาดรูป" onChange={(e) => patch(sel.id, { w: Math.min(+e.target.value, 1 - sel.x) })} />
            </label>
          )}
          <button className="icon-btn tb-del" onClick={() => remove(sel.id)} aria-label="ลบรายการนี้" title={sel.run ? 'ลบ (ข้อความจะกลับเป็นต้นฉบับ) · Delete' : 'ลบ · Delete'}>
            <Icon name="trash" size={18} />
          </button>
        </div>
      )}
    </div>
  )
}

function ImagePicker({ label, onPick, cleanBg }) {
  return (
    <label className="btn full">
      <Icon name="upload" /> {label}
      <input type="file" accept="image/*" hidden onChange={async (e) => { const f = e.target.files[0]; e.target.value = ''; if (f) onPick(await imageToPng(f, cleanBg)) }} />
    </label>
  )
}

function SignaturePad({ pen, onInsert }) {
  const ref = useRef(null)
  const [inked, setInked] = useState(false)
  const last = useRef(null)

  const pos = (e) => {
    const r = ref.current.getBoundingClientRect()
    return [((e.clientX - r.left) / r.width) * ref.current.width, ((e.clientY - r.top) / r.height) * ref.current.height]
  }
  const down = (e) => {
    ref.current.setPointerCapture(e.pointerId)
    last.current = pos(e)
    const ctx = ref.current.getContext('2d')
    ctx.fillStyle = pen
    ctx.beginPath(); ctx.arc(...last.current, 2, 0, 7); ctx.fill()
    setInked(true)
  }
  const move = (e) => {
    if (!last.current) return
    const ctx = ref.current.getContext('2d')
    const p = pos(e)
    ctx.strokeStyle = pen; ctx.lineWidth = 4; ctx.lineCap = 'round'; ctx.lineJoin = 'round'
    ctx.beginPath(); ctx.moveTo(...last.current); ctx.lineTo(...p); ctx.stroke()
    last.current = p
  }
  const clear = () => { const c = ref.current; c.getContext('2d').clearRect(0, 0, c.width, c.height); setInked(false) }
  const insert = () => {
    const out = trim(ref.current)
    if (out) { onInsert(out); clear() }
  }

  return (
    <div className="pad-wrap">
      <canvas ref={ref} className="pad" width="800" height="320" onPointerDown={down} onPointerMove={move} onPointerUp={() => (last.current = null)} onPointerCancel={() => (last.current = null)} aria-label="พื้นที่วาดลายเซ็น" />
      <span className="pad-line" aria-hidden="true" />
      <div className="pad-actions">
        <button className="btn" onClick={clear} disabled={!inked}><Icon name="undo" /> ล้าง</button>
        <button className="btn primary" onClick={insert} disabled={!inked}>ใส่ลงใน PDF</button>
      </div>
    </div>
  )
}

function trim(canvas) {
  const { width: w, height: h } = canvas
  const d = canvas.getContext('2d').getImageData(0, 0, w, h).data
  let x0 = w, y0 = h, x1 = 0, y1 = 0
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (d[(y * w + x) * 4 + 3] > 0) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y) }
  }
  if (x1 < x0) return null
  const pad = 6
  x0 = Math.max(0, x0 - pad); y0 = Math.max(0, y0 - pad); x1 = Math.min(w, x1 + pad); y1 = Math.min(h, y1 + pad)
  const out = document.createElement('canvas')
  out.width = x1 - x0; out.height = y1 - y0
  out.getContext('2d').drawImage(canvas, x0, y0, out.width, out.height, 0, 0, out.width, out.height)
  return { dataUrl: out.toDataURL('image/png'), ratio: out.height / out.width }
}

function imageToPng(file, cleanBg) {
  return new Promise((resolve) => {
    const img = new Image()
    img.onload = () => {
      const scale = Math.min(1, 1600 / img.naturalWidth)
      const c = document.createElement('canvas')
      c.width = Math.round(img.naturalWidth * scale)
      c.height = Math.round(img.naturalHeight * scale)
      const ctx = c.getContext('2d', { willReadFrequently: true })
      ctx.drawImage(img, 0, 0, c.width, c.height)
      let out = c
      if (cleanBg) { knockOutWhite(ctx, c.width, c.height); out = cropToInk(c) }
      URL.revokeObjectURL(img.src)
      resolve({ dataUrl: out.toDataURL('image/png'), ratio: out.height / out.width })
    }
    img.src = URL.createObjectURL(file)
  })
}

/**
 * Make the paper transparent while keeping the ink, so a photographed signature sits cleanly on the page.
 * The paper level is measured from the image itself, so grey or yellowish photos work too.
 */
function knockOutWhite(ctx, w, h) {
  const img = ctx.getImageData(0, 0, w, h)
  const d = img.data
  const lums = new Uint8Array(w * h)
  const hist = new Uint32Array(256)
  for (let i = 0, k = 0; i < d.length; i += 4, k++) {
    const lum = Math.round(0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2])
    lums[k] = lum
    hist[lum]++
  }
  // paper = brightness that 70% of the pixels sit below (ink is a small share of the image)
  let acc = 0, paper = 255
  for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc >= w * h * 0.7) { paper = v; break } }
  paper = Math.max(paper, 120)
  const clear = paper * 0.88 // as bright as this: paper
  const keep = paper * 0.55 // as dark as this: solid ink
  for (let i = 0, k = 0; i < d.length; i += 4, k++) {
    const lum = lums[k]
    const a = lum >= clear ? 0 : lum <= keep ? 255 : Math.round(((clear - lum) / (clear - keep)) * 255)
    d[i + 3] = Math.min(d[i + 3], a)
  }
  ctx.putImageData(img, 0, 0)
}

/** Crop a canvas to the visible (non-transparent) part, dropping specks of noise at the edges. */
function cropToInk(c) {
  const { width: w, height: h } = c
  const d = c.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, w, h).data
  let x0 = w, y0 = h, x1 = -1, y1 = -1
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (d[(y * w + x) * 4 + 3] > 60) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y }
  }
  if (x1 < x0) return c
  const pad = 6
  x0 = Math.max(0, x0 - pad); y0 = Math.max(0, y0 - pad); x1 = Math.min(w - 1, x1 + pad); y1 = Math.min(h - 1, y1 + pad)
  const out = document.createElement('canvas')
  out.width = x1 - x0 + 1; out.height = y1 - y0 + 1
  out.getContext('2d').drawImage(c, x0, y0, out.width, out.height, 0, 0, out.width, out.height)
  return out
}
