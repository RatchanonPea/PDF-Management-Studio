// Fonts offered for typed text and signatures. All are bundled (no network), Thai-capable unless noted.
export const FONTS = [
  { id: 'sarabun', label: 'Sarabun (ทางการ)', family: 'Sarabun' },
  { id: 'notosans', label: 'Noto Sans Thai', family: 'Noto Sans Thai' },
  { id: 'prompt', label: 'Prompt', family: 'Prompt' },
  { id: 'kanit', label: 'Kanit', family: 'Kanit' },
  { id: 'bai', label: 'Bai Jamjuree', family: 'Bai Jamjuree' },
  { id: 'mitr', label: 'Mitr (หัวข้อหนา)', family: 'Mitr' },
  { id: 'pridi', label: 'Pridi (มีหัว)', family: 'Pridi' },
  { id: 'itim', label: 'Itim (ลายมือ)', family: 'Itim' },
  { id: 'mali', label: 'Mali (ลายมือ)', family: 'Mali' },
  { id: 'sriracha', label: 'Sriracha (ลายมือ)', family: 'Sriracha' },
  { id: 'charmonman', label: 'Charmonman (อักษรประดิษฐ์)', family: 'Charmonman' },
  { id: 'dancing', label: 'Dancing Script (ลายเซ็น อังกฤษ)', family: 'Dancing Script' },
  { id: 'caveat', label: 'Caveat (ลายมือ อังกฤษ)', family: 'Caveat' },
]

// good looks for a signed name
export const SIGN_FONTS = ['mali', 'sriracha', 'charmonman', 'itim', 'dancing', 'caveat']

// fonts the user imported this session (kept in memory, like the PDFs)
export const CUSTOM_FONTS = []

export const getFont = (id) => FONTS.find((f) => f.id === id) || CUSTOM_FONTS.find((f) => f.id === id) || FONTS[0]

/** Register a TTF / OTF / WOFF / WOFF2 file with the browser; it never leaves this machine. */
export async function importFont(file) {
  const id = `custom-${CUSTOM_FONTS.length + 1}`
  const base = file.name.replace(/\.[^.]+$/, '').replace(/["'\\]/g, '')
  const family = `${base} (${id})`
  const face = new FontFace(family, await file.arrayBuffer())
  await face.load()
  document.fonts.add(face)
  const font = { id, label: `${base} (Import)`, family }
  CUSTOM_FONTS.push(font)
  return font
}
// Latin-only script fonts fall back to Sarabun for Thai characters
export const fontStack = (id) => `"${getFont(id).family}", Sarabun, "Bai Jamjuree", sans-serif`
