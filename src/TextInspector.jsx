import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Icon } from './icons.jsx'
import { FONTS, CUSTOM_FONTS, getFont, fontStack, importFont } from './fonts.js'
import { plain, applyStyle, stylesIn, toHtml, parseDom, readSelection, writeSelection } from './rich.js'

export function FontSelect({ value, onChange, ids, label }) {
  const [err, setErr] = useState('')
  const list = [...(ids ? ids.map(getFont) : FONTS), ...CUSTOM_FONTS]
  const pick = async (e) => {
    const f = e.target.files[0]
    e.target.value = ''
    if (!f) return
    try {
      setErr('')
      onChange((await importFont(f)).id)
    } catch {
      setErr('ใช้ไฟล์ฟอนต์นี้ไม่ได้ ลองไฟล์ .ttf .otf .woff หรือ .woff2')
    }
  }
  return (
    <div className="font-select">
      <span className="label">{label}</span>
      <div className="font-row">
        <select className="text" value={value} onChange={(e) => onChange(e.target.value)} style={{ fontFamily: fontStack(value) }} aria-label={label}>
          {list.map((f) => (
            <option key={f.id} value={f.id} style={{ fontFamily: fontStack(f.id) }}>{f.label}</option>
          ))}
        </select>
        <label className="btn" title="Import ไฟล์ฟอนต์จากเครื่อง (.ttf .otf .woff .woff2)">
          <Icon name="upload" size={18} /> Import font
          <input type="file" accept=".ttf,.otf,.woff,.woff2,font/*" hidden onChange={pick} />
        </label>
      </div>
      {err && <p className="error" role="alert">{err}</p>}
    </div>
  )
}

const SIZES = [8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 32, 36, 48, 60, 72, 96, 120]

/** Type a size or pick one from the list, like Word's size box. */
function SizeBox({ value, onPick }) {
  const [draft, setDraft] = useState(null)
  const [open, setOpen] = useState(false)
  const box = useRef(null)

  useEffect(() => {
    if (!open) return
    const out = (e) => box.current && !box.current.contains(e.target) && setOpen(false)
    document.addEventListener('pointerdown', out)
    return () => document.removeEventListener('pointerdown', out)
  }, [open])

  const step = (d) => onPick(Math.min(400, Math.max(1, Math.round(value) + d)))
  return (
    <div className="size-combo" ref={box}>
      <input
        id="fsn"
        className="text size-input"
        type="text"
        inputMode="decimal"
        role="combobox"
        aria-expanded={open}
        aria-controls="size-list"
        aria-label="ขนาดตัวอักษร (พิมพ์ได้)"
        value={draft ?? value}
        onFocus={(e) => e.target.select()}
        onChange={(e) => {
          setDraft(e.target.value)
          const n = parseFloat(e.target.value)
          if (n >= 1 && n <= 400) onPick(n)
        }}
        onBlur={() => setDraft(null)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); setDraft(null); setOpen(false); e.currentTarget.blur() }
          else if (e.key === 'ArrowUp') { e.preventDefault(); setDraft(null); step(1) }
          else if (e.key === 'ArrowDown') { e.preventDefault(); setDraft(null); step(-1) }
          else if (e.key === 'Escape') setOpen(false)
        }}
      />
      <button type="button" className="size-toggle" aria-label="เลือกขนาดจากรายการ" aria-haspopup="listbox" onClick={() => setOpen((v) => !v)}>▾</button>
      {open && (
        <ul id="size-list" className="size-list" role="listbox" aria-label="ขนาดตัวอักษร">
          {SIZES.map((n) => (
            <li key={n} role="option" aria-selected={n === value}>
              <button type="button" className={n === value ? 'on' : ''} onMouseDown={(e) => e.preventDefault()} onClick={() => { setDraft(null); onPick(n); setOpen(false) }}>{n}</button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

const keep = (e) => e.preventDefault() // keep the text selection while a toolbar button is pressed

/**
 * Word-style editing of one text item. Formatting applies to the highlighted characters only;
 * with nothing highlighted it applies to the whole box.
 */
export function TextInspector({ item, onEdit, pens }) {
  const root = useRef(null)
  const emitted = useRef('')
  const [sel, setSel] = useState({ a: 0, b: 0 })

  const total = [...plain(item.runs)].length
  const ranged = sel.b > sel.a && sel.a < total
  const a = ranged ? sel.a : 0
  const b = ranged ? Math.min(sel.b, total) : total
  const styles = stylesIn(item.runs, a, b)
  const first = styles[0] || {}

  const keyOf = (runs) => JSON.stringify([runs, item.font, item.size])

  useLayoutEffect(() => {
    if (keyOf(item.runs) === emitted.current) return
    emitted.current = keyOf(item.runs)
    root.current.innerHTML = toHtml(item.runs, item)
    if (ranged && document.activeElement === root.current) writeSelection(root.current, sel.a, sel.b)
  }, [item.runs, item.font, item.size])

  useEffect(() => {
    const onSel = () => {
      const s = root.current && readSelection(root.current)
      if (s) setSel(s)
    }
    document.addEventListener('selectionchange', onSel)
    return () => document.removeEventListener('selectionchange', onSel)
  }, [])

  const typed = () => {
    const runs = parseDom(root.current)
    emitted.current = keyOf(runs)
    onEdit({ runs, text: plain(runs) })
  }

  const edit = (runs) => onEdit({ runs, text: plain(runs) })
  const toggle = (k) => total && edit(applyStyle(item.runs, a, b, { [k]: styles.every((s) => s[k]) ? undefined : true }))
  // font / colour / size: the selection only, or the whole box (and reset per-run overrides) when nothing is selected
  const setProp = (k, v) =>
    ranged ? edit(applyStyle(item.runs, a, b, { [k]: v })) : onEdit({ [k]: v, runs: applyStyle(item.runs, 0, total, { [k]: undefined }) })

  const onKeyDown = (e) => {
    if (e.key === 'Enter') { e.preventDefault(); document.execCommand('insertLineBreak'); return }
    if (!(e.ctrlKey || e.metaKey)) return
    const k = { b: 'b', i: 'i', u: 'u' }[e.key.toLowerCase()]
    if (k) { e.preventDefault(); toggle(k) }
  }
  const onPaste = (e) => {
    e.preventDefault()
    e.clipboardData.getData('text/plain').split(/\r?\n/).forEach((line, n) => {
      if (n) document.execCommand('insertLineBreak')
      if (line) document.execCommand('insertText', false, line)
    })
  }

  const colour = first.color || item.color
  const fmt = [['b', <b>B</b>, 'ตัวหนา (Ctrl+B)'], ['i', <i>I</i>, 'ตัวเอียง (Ctrl+I)'], ['u', <u>U</u>, 'ขีดเส้นใต้ (Ctrl+U)'], ['s', <s>S</s>, 'ขีดฆ่า']]

  return (
    <>
      <p className="scope" role="status">
        {ranged ? <>จัดรูปแบบ <b>เฉพาะส่วนที่เลือก</b> ({b - a} ตัวอักษร)</> : <>จัดรูปแบบ <b>ทั้งกล่องข้อความ</b> · ลากคลุมตัวอักษรเพื่อเลือกเฉพาะส่วน</>}
      </p>
      <FontSelect value={first.font || item.font} onChange={(id) => setProp('font', id)} label="ฟอนต์" />
      <div className="fmt" role="toolbar" aria-label="จัดรูปแบบตัวอักษร">
        {fmt.map(([k, face, title]) => (
          <button key={k} className={total && styles.every((s) => s[k]) ? 'on' : ''} aria-pressed={!!total && styles.every((s) => s[k])} onMouseDown={keep} onClick={() => toggle(k)} title={title}>{face}</button>
        ))}
        <span className="sep" aria-hidden="true" />
        {[['left', 'alignL', 'ชิดซ้าย'], ['center', 'alignC', 'กึ่งกลาง'], ['right', 'alignR', 'ชิดขวา']].map(([v, ic, t]) => (
          <button key={v} className={(item.align || 'left') === v ? 'on' : ''} aria-pressed={(item.align || 'left') === v} onMouseDown={keep} onClick={() => onEdit({ align: v })} title={t} aria-label={t}><Icon name={ic} size={18} /></button>
        ))}
      </div>
      <div
        ref={root}
        className="rich"
        contentEditable
        suppressContentEditableWarning
        role="textbox"
        aria-multiline="true"
        aria-label="แก้ไขข้อความ"
        spellCheck={false}
        style={{ color: item.color, textAlign: item.align || 'left' }}
        onInput={typed}
        onKeyDown={onKeyDown}
        onPaste={onPaste}
      />
      <div className="size-row">
        <label className="label" htmlFor="fsn">ขนาดตัวอักษร</label>
        <SizeBox value={Math.round((first.size || item.size) * 10) / 10} onPick={(n) => setProp('size', n)} />
        <span className="unit">pt</span>
      </div>
      <input id="fs" type="range" min="6" max="96" step="1" value={Math.min(96, Math.max(6, Math.round(first.size || item.size)))} onChange={(e) => setProp('size', +e.target.value)} aria-label="ปรับขนาดด้วยแถบเลื่อน" />
      <div className="pens">
        {[colour, ...pens.map((p) => p.value)].filter((c, i, arr) => arr.indexOf(c) === i).map((c) => (
          <button key={c} className={colour === c ? 'on' : ''} style={{ '--pen': c }} onMouseDown={keep} onClick={() => setProp('color', c)} aria-label={c} aria-pressed={colour === c} />
        ))}
      </div>
    </>
  )
}
