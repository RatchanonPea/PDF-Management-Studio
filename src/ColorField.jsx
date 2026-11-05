import { useState } from 'react'

/** "#abc" / "abc" / "#aabbcc" -> "#aabbcc", or null when it is not a colour code. */
export function normalizeHex(text) {
  const t = text.trim().replace(/^#/, '')
  if (/^[0-9a-f]{3}$/i.test(t)) return '#' + [...t].map((c) => c + c).join('').toLowerCase()
  if (/^[0-9a-f]{6}$/i.test(t)) return '#' + t.toLowerCase()
  return null
}

/** A colour swatch (opens the picker) next to its code, which can be read, copied or typed. */
export function ColorField({ value, onChange, id, label }) {
  const [draft, setDraft] = useState(null) // what is being typed; null = show the real value
  const shown = draft ?? value.toLowerCase()
  const typed = (e) => {
    const text = e.target.value
    setDraft(text)
    const hex = normalizeHex(text)
    if (hex) onChange(hex)
  }
  return (
    <span className="color-field">
      <input id={id} type="color" value={value} onChange={(e) => { setDraft(null); onChange(e.target.value) }} aria-label={label} />
      <input
        className="text hex"
        type="text"
        value={shown}
        maxLength={7}
        spellCheck={false}
        autoComplete="off"
        aria-label={`${label} (รหัสสี)`}
        placeholder="#ffffff"
        onFocus={(e) => e.target.select()}
        onChange={typed}
        onBlur={() => setDraft(null)}
        onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
      />
    </span>
  )
}
