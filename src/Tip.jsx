import { useEffect, useId, useRef, useState } from 'react'

/** A small "?" button; its text opens as a tooltip on click, hover or keyboard focus. */
export function Tip({ children }) {
  const [open, setOpen] = useState(false)
  const box = useRef(null)
  const id = useId()
  const [pos, setPos] = useState(null)

  useEffect(() => {
    if (!open) return
    const out = (e) => box.current && !box.current.contains(e.target) && setOpen(false)
    const esc = (e) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('pointerdown', out)
    window.addEventListener('keydown', esc)
    return () => { document.removeEventListener('pointerdown', out); window.removeEventListener('keydown', esc) }
  }, [open])

  return (
    <span className="tip" ref={box}>
      <button type="button" className="tip-btn" aria-label="คำแนะนำ" aria-expanded={open} aria-describedby={open ? id : undefined} onClick={(e) => {
        // fixed position, kept inside the window whatever the button's place in the panel
        const r = e.currentTarget.getBoundingClientRect()
        const width = Math.min(300, window.innerWidth - 16)
        setPos({ top: r.bottom + 6, left: Math.max(8, Math.min(r.left, window.innerWidth - width - 8)), width })
        setOpen((v) => !v)
      }}>?</button>
      {open && <span className="tip-pop" role="tooltip" id={id} style={pos}>{children}</span>}
    </span>
  )
}
