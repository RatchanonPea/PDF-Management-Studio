import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'

/**
 * A dropdown with a styled list. options: [{ id, label, style? }] (style is applied to the label, e.g. its own font).
 * Opens upward when there is no room below, closes on outside click / Escape, and works with the arrow keys.
 */
export function Select({ value, onChange, options, label, style }) {
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const [pos, setPos] = useState(null)
  const btn = useRef(null)
  const list = useRef(null)
  const id = useId()
  const current = options.find((o) => o.id === value) || options[0]

  const openList = () => {
    const r = btn.current.getBoundingClientRect()
    const below = window.innerHeight - r.bottom - 12
    const above = r.top - 12
    const up = below < 200 && above > below
    const room = Math.max(120, up ? above : below)
    // at least as wide as the button, wide enough for a font name on one line, and kept inside the window
    const width = Math.min(window.innerWidth - 16, Math.max(r.width, 280))
    const left = Math.max(8, Math.min(r.left, window.innerWidth - width - 8))
    setPos({ left, width, maxHeight: Math.min(300, room), ...(up ? { bottom: window.innerHeight - r.top + 6 } : { top: r.bottom + 6 }), up })
    setActive(Math.max(0, options.findIndex((o) => o.id === value)))
    setOpen(true)
  }
  const close = (refocus = true) => { setOpen(false); if (refocus) btn.current?.focus() }
  const choose = (o) => { onChange(o.id); close() }

  useEffect(() => {
    if (!open) return
    const out = (e) => !btn.current.contains(e.target) && !list.current?.contains(e.target) && close(false)
    // scrolling the page closes the list (it is fixed in place), scrolling inside the list does not
    const away = (e) => { if (!(e?.target instanceof Node && list.current?.contains(e.target))) close(false) }
    document.addEventListener('pointerdown', out)
    window.addEventListener('resize', away)
    window.addEventListener('scroll', away, true)
    return () => { document.removeEventListener('pointerdown', out); window.removeEventListener('resize', away); window.removeEventListener('scroll', away, true) }
  }, [open])

  // keep the highlighted row in view
  useLayoutEffect(() => {
    const box = list.current
    const row = box?.querySelector('[data-active="true"]')
    if (!box || !row) return
    // moved by hand: scrollIntoView would also scroll the page behind and close the list
    if (row.offsetTop < box.scrollTop) box.scrollTop = row.offsetTop - 6
    else if (row.offsetTop + row.offsetHeight > box.scrollTop + box.clientHeight) box.scrollTop = row.offsetTop + row.offsetHeight - box.clientHeight + 6
  }, [open, active])

  const onKey = (e) => {
    if (!open) {
      if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(e.key)) { e.preventDefault(); openList() }
      return
    }
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close() }
    else if (e.key === 'ArrowDown') { e.preventDefault(); setActive((i) => Math.min(options.length - 1, i + 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((i) => Math.max(0, i - 1)) }
    else if (e.key === 'Home') { e.preventDefault(); setActive(0) }
    else if (e.key === 'End') { e.preventDefault(); setActive(options.length - 1) }
    else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); choose(options[active]) }
    else if (e.key === 'Tab') close(false)
  }

  return (
    <>
      <button
        ref={btn}
        type="button"
        className={`select ${open ? 'is-open' : ''}`}
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        aria-label={label}
        onClick={() => (open ? close() : openList())}
        onKeyDown={onKey}
      >
        <span className="select-value" style={current?.style}>{current?.label}</span>
        <svg className="select-chev" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6" /></svg>
      </button>
      {open && pos && (
        <ul ref={list} id={id} className={`select-list ${pos.up ? 'up' : ''}`} role="listbox" aria-label={label} style={{ left: pos.left, width: pos.width, maxHeight: pos.maxHeight, top: pos.top, bottom: pos.bottom }}>
          {options.map((o, i) => (
            <li key={o.id} role="option" aria-selected={o.id === value} data-active={i === active}>
              <button type="button" tabIndex={-1} className={o.id === value ? 'on' : ''} onMouseEnter={() => setActive(i)} onMouseDown={(e) => e.preventDefault()} onClick={() => choose(o)}>
                <span style={o.style}>{o.label}</span>
                {o.id === value && <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7" /></svg>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </>
  )
}
