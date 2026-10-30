import { useEffect, useRef, useState } from 'react'
import { renderToCanvas, getTextRuns, textToPng, richToPng, nextId, TEXT_BASE } from './pdf.js'
import { Icon } from './icons.jsx'
import { SIGN_FONTS, getFont, fontStack } from './fonts.js'
import { FontSelect, TextInspector } from './TextInspector.jsx'
import { plain } from './rich.js'

const PENS = [
  { name: 'ดำ', value: '#111827' },
  { name: 'น้ำเงิน', value: '#1D3FD1' },
  { name: 'แดง', value: '#C8312B' },
]
const WM_FONT = '"Bai Jamjuree", Sarabun, sans-serif'
const TABS = [
  { id: 'sign', label: 'เซ็นชื่อ' },
  { id: 'text', label: 'ข้อความ' },
  { id: 'image', label: 'รูปภาพ' },
  { id: 'edit', label: 'แก้ข้อความเดิม' },
  { id: 'watermark', label: 'ลายน้ำ' },
]

const loadImage = (url) => new Promise((resolve) => { const i = new Image(); i.onload = () => resolve(i); i.src = url })

/** Rasterise a text item; its width follows from the font size in points. */
async function renderText(t, ptW) {
  const fonts = new Set([t.font, ...t.runs.map((r) => r.font).filter(Boolean)])
  const sample = plain(t.runs)
  await Promise.all([...fonts, 'sarabun'].flatMap((f) => [400, 700].map((w) => document.fonts.load(`${w} 100px "${getFont(f).family}"`, sample)))).catch(() => {})
  const dataUrl = richToPng(t.runs, { stack: fontStack, color: t.color, size: t.size, align: t.align })
  const img = await loadImage(dataUrl)
  return { dataUrl, ratio: img.naturalHeight / img.naturalWidth, w: (img.naturalWidth * (t.size / TEXT_BASE)) / ptW }
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

export function Editor({ tab, onTab, onBack, onDirty, pages, sources, addFiles, busy, error, onExport }) {
  const [pageId, setPageId] = useState(pages[0]?.id)
  const [preview, setPreview] = useState(null)
  const [runs, setRuns] = useState([])
  const [zoom, setZoom] = useState(1)
  const [items, setItems] = useState([])
  const [selected, setSelected] = useState(null)
  const [pen, setPen] = useState(PENS[1].value)
  const [draft, setDraft] = useState('')
  const [draftFont, setDraftFont] = useState('sarabun')
  const [signName, setSignName] = useState('')
  const [signFont, setSignFont] = useState(SIGN_FONTS[0])
  const [cleanBg, setCleanBg] = useState(true)
  const [flatten, setFlatten] = useState(false)
  const [wm, setWm] = useState({ text: 'สำเนาถูกต้อง', opacity: 0.25, angle: 35, color: '#2338D4', on: false })
  const [wmImg, setWmImg] = useState(null)
  const input = useRef(null)

  useEffect(() => {
    const perPage = {}
    items.forEach((s) => { perPage[s.pageId] = (perPage[s.pageId] || 0) + 1 })
    onDirty((wm.on && wmImg ? 1 : 0) + items.length, perPage)
  }, [items, wm.on, wmImg])

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
    setRuns([])
    const doc = sources.get(page.fileId).doc
    renderToCanvas(doc, page.index, 760).then((c) => {
      if (live) setPreview({ url: c.toDataURL('image/jpeg', 0.9), ratio: c.height / c.width })
    })
    getTextRuns(doc, page.index).then((r) => live && setRuns(r)).catch(() => {})
    return () => { live = false }
  }, [page?.id])

  useEffect(() => {
    let live = true
    const text = wm.text.trim()
    if (!text) { setWmImg(null); return }
    Promise.all([
      document.fonts.load('700 100px "Bai Jamjuree"', text),
      document.fonts.load('700 100px Sarabun', text),
    ]).catch(() => {}).then(() => {
      const url = textToPng(text, { font: WM_FONT, color: wm.color, pad: 20 })
      const img = new Image()
      img.onload = () => live && setWmImg({ dataUrl: url, ratio: img.naturalHeight / img.naturalWidth })
      img.src = url
    })
    return () => { live = false }
  }, [wm.text, wm.color])

  if (!pages.length) {
    return (
      <div className="workspace">
        <div className="empty">
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

  const addImage = ({ dataUrl, ratio }) => {
    const id = nextId()
    setItems((prev) => [...prev, { id, kind: 'image', pageId: page.id, dataUrl, ratio, x: 0.35, y: 0.65, w: 0.25 }])
    setSelected(id)
  }

  const addText = async (base) => {
    const id = nextId()
    const t = { id, kind: 'text', pageId: page.id, font: 'sarabun', size: 18, color: '#111827', align: 'left', x: 0.2, y: 0.2, ...base }
    t.text = t.text || 'ข้อความ'
    t.runs = [{ t: t.text }]
    const r = await renderText(t, ptW)
    setItems((prev) => [...prev, { ...t, ...r }])
    setSelected(id)
  }

  const renderSeq = useRef({})
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
    await addText({
      run,
      text: run.str,
      size: run.size,
      color: ink,
      // the text image has a small margin and a taller line box than the original run
      x: run.x - (8 * run.size) / TEXT_BASE / ptW,
      y: run.y - (0.075 * run.size + (8 * run.size) / TEXT_BASE) / ptH,
      cover: { x: run.x - pad, y: run.y - pad / 2, w: run.w + pad * 2, h: run.h + pad, color: bg },
    })
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
      items: items.filter((s) => s.dataUrl && pages.some((p) => p.id === s.pageId)),
      flatten,
    })

  const hasCover = items.some((s) => s.cover)
  const applied = (wm.on && wmImg ? 1 : 0) + items.filter((s) => pages.some((p) => p.id === s.pageId)).length

  return (
    <div className="editor">
      <section className="stage" aria-label="ตัวอย่างหน้า PDF">
        <div className="stage-bar">
          <button className="btn back" onClick={onBack}><span aria-hidden="true">‹</span> กลับ</button>
          <div className="zoom">
            <button onClick={() => setZoom((z) => Math.max(0.5, +(z - 0.1).toFixed(1)))} aria-label="ซูมออก">−</button>
            <span>{Math.round(zoom * 100)}%</span>
            <button onClick={() => setZoom((z) => Math.min(1.6, +(z + 0.1).toFixed(1)))} aria-label="ซูมเข้า">+</button>
          </div>
          <span className="count">หน้า {pages.indexOf(page) + 1} จาก {pages.length}</span>
        </div>
        <div className="stage-scroll" onPointerDown={(e) => e.target === e.currentTarget && setSelected(null)}>
          {preview && (
            <div className="canvas" style={{ width: `${560 * zoom}px`, aspectRatio: `${1 / preview.ratio}` }}>
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
              {here.filter((s) => s.dataUrl).map((s) => (
                <img
                  key={s.id}
                  className={`stamp-layer ${s.id === selected ? 'is-sel' : ''}`}
                  src={s.dataUrl}
                  alt={s.kind === 'text' ? s.text : 'รูปภาพ'}
                  draggable="false"
                  style={{ left: `${s.x * 100}%`, top: `${s.y * 100}%`, width: `${s.w * 100}%` }}
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

      <aside className="panel">
        <div className="seg wide tabs" role="tablist">
          {TABS.map((t) => (
            <button key={t.id} role="tab" aria-selected={tab === t.id} className={tab === t.id ? 'on' : ''} onClick={() => onTab(t.id)}>{t.label}</button>
          ))}
        </div>

        <div className="panel-body">
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
                <p className="hint">ถ่ายหรือสแกนลายเซ็นบนกระดาษขาว ระบบจะทำให้พื้นหลังโปร่งใส</p>
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
              <p className="hint">วางแล้วลากเพื่อย้ายตำแหน่ง กดข้อความเพื่อแก้ไขขนาดและสี</p>
            </>
          )}

          {tab === 'image' && (
            <>
              <ImagePicker label="เลือกรูปภาพ (PNG, JPG, WebP)" onPick={addImage} />
              <p className="hint">แทรกรูปภาพ โลโก้ หรือรูปถ่ายลงบนหน้านี้ ลากเพื่อย้าย และปรับขนาดด้วยแถบเลื่อน</p>
            </>
          )}

          {tab === 'edit' && (
            <>
              <p className="hint strong">คลิกข้อความบนหน้ากระดาษ (กรอบสีน้ำเงิน) เพื่อแก้ไข</p>
              {!runs.length && <p className="hint">ไม่พบข้อความที่แก้ไขได้ในหน้านี้ ไฟล์อาจเป็นภาพสแกน</p>}
              <p className="hint">ระบบจะปิดทับข้อความเดิมด้วยสีพื้นหลังแล้ววางข้อความใหม่แทน ฟอนต์อาจไม่ตรงกับต้นฉบับ</p>
              <label className="check-row">
                <input type="checkbox" checked={flatten} onChange={(e) => setFlatten(e.target.checked)} />
                ลบข้อความเดิมถาวร
              </label>
              <p className="hint">เปิดตัวเลือกนี้ หน้าที่แก้ไขจะกลายเป็นภาพ ข้อความเดิมจะค้นหาหรือคัดลอกไม่ได้อีก{hasCover && !flatten ? ' ถ้าไม่เปิด ข้อความเดิมยังคงอยู่ใต้ชั้นปิดทับ' : ''}</p>
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
              </div>
            </>
          )}

          {sel && (
            <div className="field inspector">
              <span className="label">{sel.kind === 'text' ? 'ข้อความที่เลือก' : 'รูปที่เลือก'}</span>
              {sel.kind === 'text' ? (
                <TextInspector key={sel.id} item={sel} onEdit={(c) => editItem(sel, c)} pens={PENS} />
              ) : (
                <>
                  <label className="label" htmlFor="size">ขนาด</label>
                  <input id="size" type="range" min="0.05" max="0.9" step="0.01" value={sel.w} onChange={(e) => patch(sel.id, { w: Math.min(+e.target.value, 1 - sel.x) })} />
                </>
              )}
              <button className="btn danger" onClick={() => remove(sel.id)}><Icon name="trash" /> ลบรายการนี้</button>
            </div>
          )}
        </div>

        <div className="panel-foot">
          {error && <p className="error" role="alert">{error}</p>}
          <button className="btn primary full" disabled={busy || !applied} onClick={exportNow}>
            <Icon name="download" /> {busy ? 'กำลังสร้างไฟล์…' : 'สร้างและดาวน์โหลด'}
          </button>
        </div>
      </aside>
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
      if (cleanBg) knockOutWhite(ctx, c.width, c.height)
      resolve({ dataUrl: c.toDataURL('image/png'), ratio: c.height / c.width })
    }
    img.src = URL.createObjectURL(file)
  })
}

/** Make near-white paper transparent while keeping the ink, so a photographed signature sits cleanly on the page. */
function knockOutWhite(ctx, w, h) {
  const img = ctx.getImageData(0, 0, w, h)
  const d = img.data
  for (let i = 0; i < d.length; i += 4) {
    const lum = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]
    // fully clear above 225, fully kept below 150, soft edge between
    const a = lum >= 225 ? 0 : lum <= 150 ? 255 : Math.round(((225 - lum) / 75) * 255)
    d[i + 3] = Math.min(d[i + 3], a)
  }
  ctx.putImageData(img, 0, 0)
}
