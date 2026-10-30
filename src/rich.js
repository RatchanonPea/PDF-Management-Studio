import { fontStack } from './fonts.js'

// A rich text item is a list of runs: { t, b, i, u, s, color, font, size }. Anything unset inherits the item's own value.
const KEYS = ['b', 'i', 'u', 's', 'color', 'font', 'size']
const same = (a, b) => KEYS.every((k) => a[k] === b[k])
const styleOf = (r) => Object.fromEntries(KEYS.filter((k) => r[k] !== undefined && r[k] !== false).map((k) => [k, r[k]]))

export const plain = (runs) => runs.map((r) => r.t).join('')

export function toChars(runs) {
  const out = []
  for (const r of runs) for (const ch of r.t) out.push({ ch, st: styleOf(r) })
  return out
}

export function fromChars(chars) {
  const runs = []
  for (const { ch, st } of chars) {
    const last = runs[runs.length - 1]
    if (last && same(last, st)) last.t += ch
    else runs.push({ ...st, t: ch })
  }
  return runs
}

// offsets are counted in characters of the plain text (a newline counts as one)
export function applyStyle(runs, a, b, patch) {
  const chars = toChars(runs)
  for (let k = a; k < b && k < chars.length; k++) {
    const st = { ...chars[k].st }
    for (const [key, v] of Object.entries(patch)) {
      if (v === undefined || v === false) delete st[key]
      else st[key] = v
    }
    chars[k] = { ch: chars[k].ch, st }
  }
  return fromChars(chars)
}

/** Style of every character in [a, b); an empty range reads the character before the caret. */
export function stylesIn(runs, a, b) {
  const chars = toChars(runs)
  if (b > a) return chars.slice(a, b).map((c) => c.st)
  const c = chars[Math.max(0, Math.min(chars.length - 1, a - 1))] || chars[0]
  return c ? [c.st] : [{}]
}

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

export function toHtml(runs, base) {
  const html = []
  for (const r of runs) {
    const st = styleOf(r)
    const css = [
      `font-family:${fontStack(st.font || base.font)}`,
      `font-size:${(st.size || base.size) / base.size}em`,
      st.color ? `color:${st.color}` : '',
      st.b ? 'font-weight:700' : '',
      st.i ? 'font-style:italic' : '',
      st.u || st.s ? `text-decoration:${[st.u && 'underline', st.s && 'line-through'].filter(Boolean).join(' ')}` : '',
    ].filter(Boolean).join(';')
    r.t.split('\n').forEach((seg, n) => {
      if (n) html.push('<br>')
      if (seg) html.push(`<span data-st='${esc(JSON.stringify(st)).replace(/'/g, '&#39;')}' style="${css.replace(/"/g, "'")}">${esc(seg)}</span>`)
    })
  }
  // a final newline needs a placeholder, otherwise the browser does not show the empty last line
  if (plain(runs).endsWith('\n')) html.push('<br>')
  return html.join('')
}

const BLOCK = new Set(['DIV', 'P'])

export function parseDom(root) {
  const chars = []
  const styleFor = (node) => {
    for (let n = node.parentNode; n && n !== root.parentNode; n = n.parentNode) {
      if (n.dataset && n.dataset.st) { try { return JSON.parse(n.dataset.st) } catch { return {} } }
      if (n === root) break
    }
    return {}
  }
  const walk = (node) => {
    for (const c of node.childNodes) {
      if (c.nodeType === 3) {
        for (const ch of c.nodeValue.replace(/​/g, '')) chars.push({ ch, st: styleFor(c) })
      } else if (c.nodeName === 'BR') {
        const prev = c.previousSibling
        const isLast = !c.nextSibling && c.parentNode === root
        if (isLast && prev && prev.nodeName === 'BR') continue // placeholder
        chars.push({ ch: '\n', st: {} })
      } else if (c.nodeType === 1) {
        if (BLOCK.has(c.nodeName) && chars.length && chars[chars.length - 1].ch !== '\n') chars.push({ ch: '\n', st: {} })
        walk(c)
      }
    }
  }
  walk(root)
  return fromChars(chars)
}

/** Caret / selection as character offsets inside the editor. */
export function readSelection(root) {
  const sel = window.getSelection()
  if (!sel || !sel.rangeCount || !root.contains(sel.anchorNode)) return null
  const count = (container, offset) => {
    const r = document.createRange()
    r.selectNodeContents(root)
    r.setEnd(container, offset)
    const frag = r.cloneContents()
    return [...frag.textContent.replace(/​/g, '')].length + frag.querySelectorAll('br').length
  }
  const rg = sel.getRangeAt(0)
  const a = count(rg.startContainer, rg.startOffset)
  const b = count(rg.endContainer, rg.endOffset)
  return { a: Math.min(a, b), b: Math.max(a, b) }
}

export function writeSelection(root, a, b) {
  const locate = (target) => {
    let n = 0
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT)
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (node.nodeType === 3) {
        const len = [...node.nodeValue].length
        if (target <= n + len) return [node, [...node.nodeValue].slice(0, target - n).join('').length]
        n += len
      } else if (node.nodeName === 'BR') {
        if (target <= n) return [node.parentNode, [...node.parentNode.childNodes].indexOf(node)]
        n += 1
      }
    }
    return [root, root.childNodes.length]
  }
  const rg = document.createRange()
  rg.setStart(...locate(a))
  rg.setEnd(...locate(b))
  const sel = window.getSelection()
  sel.removeAllRanges()
  sel.addRange(rg)
}
