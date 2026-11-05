/**
 * Finds checkbox-like squares on a rendered page. PDFs made from web pages draw checkboxes as plain
 * vector shapes (not form fields), so they are found from the picture: small, square, with a closed border.
 * Returns boxes as fractions of the page: { key, x, y, w, h, checked, bg }.
 */
export function detectBoxes(canvas, runs = []) {
  const W = canvas.width
  const H = canvas.height
  const data = canvas.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, W, H).data
  const mask = new Uint8Array(W * H)
  for (let i = 0, k = 0; i < data.length; i += 4, k++) mask[k] = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2] < 200 ? 1 : 0
  const scale = W / canvas.ptW
  return findSquares(mask, W, H, 6 * scale, 26 * scale)
    // a square inside a text line is a letter, unless it is as tall as the line itself (a box between two labels)
    .filter((b) => !runs.some((r) => b.cx / W > r.x && b.cx / W < r.x + r.w && b.cy / H > r.y && b.cy / H < r.y + r.h && b.bh / H < r.h * 0.8))
    .map((b) => ({
      key: `${Math.round((b.x0 / W) * 10000)}-${Math.round((b.y0 / H) * 10000)}`,
      x: b.x0 / W,
      y: b.y0 / H,
      w: b.bw / W,
      h: b.bh / H,
      checked: b.checked,
      kind: b.kind,
      bg: ringColor(data, W, H, b),
      px: { x0: b.x0, y0: b.y0, bw: b.bw, bh: b.bh, W, H },
    }))
}

/** Background around a box: the most common colour on a ring a few pixels outside it. */
function ringColor(data, W, H, b) {
  const gap = 3
  const votes = new Map()
  const add = (x, y) => {
    if (x < 0 || y < 0 || x >= W || y >= H) return
    const i = (y * W + x) * 4
    const key = (data[i] << 16) | (data[i + 1] << 8) | data[i + 2]
    votes.set(key, (votes.get(key) || 0) + 1)
  }
  for (let i = -gap; i <= b.bw + gap; i += 2) { add(b.x0 + i, b.y0 - gap); add(b.x0 + i, b.y0 + b.bh - 1 + gap) }
  for (let i = -gap; i <= b.bh + gap; i += 2) { add(b.x0 - gap, b.y0 + i); add(b.x0 + b.bw - 1 + gap, b.y0 + i) }
  let best = 0xffffff, n = 0
  // the exact most common colour (averaging would turn white into #fefefe)
  for (const [key, count] of votes) if (count > n) { n = count; best = key }
  const ch = [(best >> 16) & 255, (best >> 8) & 255, best & 255]
  if (ch.every((v) => v >= 252)) return '#ffffff' // paper white
  return '#' + ch.map((v) => v.toString(16).padStart(2, '0')).join('')
}

/** 'tick' | 'cross' | 'dot' for what is drawn inside a box, null when empty. */
function markKind(ink, area, mnx, mxx, mny, mxy, quad) {
  if (!area || ink / area <= 0.1) return null
  if (ink / area > 0.55) return 'tick' // solid fill with the tick cut out
  const bw = mxx - mnx + 1, bh = mxy - mny + 1
  const box = bw * bh
  const compact = bw < Math.sqrt(area) * 0.7 && bh < Math.sqrt(area) * 0.7
  if (compact && ink / box > 0.6) return 'dot'
  const low = Math.min(...quad) / ink
  return low > 0.15 ? 'cross' : 'tick'
}

/** Pure part of the detector: connected blobs of `mask` that look like a checkbox. */
export function findSquares(mask, W, H, minPx, maxPx) {
  const seen = new Uint8Array(W * H)
  const stack = new Int32Array(W * H)
  const out = []
  const at = (x, y) => (x >= 0 && y >= 0 && x < W && y < H ? mask[y * W + x] : 0)
  for (let s = 0; s < W * H; s++) {
    if (!mask[s] || seen[s]) continue
    let top = 0
    let x0 = W, y0 = H, x1 = 0, y1 = 0
    stack[top++] = s
    seen[s] = 1
    while (top) {
      const p = stack[--top]
      const x = p % W
      const y = (p - x) / W
      if (x < x0) x0 = x
      if (x > x1) x1 = x
      if (y < y0) y0 = y
      if (y > y1) y1 = y
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx, ny = y + dy
          if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue
          const q = ny * W + nx
          if (mask[q] && !seen[q]) { seen[q] = 1; stack[top++] = q }
        }
      }
    }
    const bw = x1 - x0 + 1
    const bh = y1 - y0 + 1
    if (bw < minPx || bh < minPx || bw > maxPx || bh > maxPx || bw / bh < 0.8 || bw / bh > 1.25) continue

    // the border must be closed along the middle half of every side
    const t = Math.max(1, Math.round(bw * 0.12))
    let tries = 0, hits = 0
    for (let i = Math.floor(bw * 0.25); i <= Math.ceil(bw * 0.75); i++) {
      for (const side of [0, 1, 2, 3]) {
        let on = 0
        for (let d = 0; d < t; d++) {
          const px = side < 2 ? x0 + i : side === 2 ? x0 + d : x1 - d
          const py = side === 0 ? y0 + d : side === 1 ? y1 - d : y0 + Math.min(i, bh - 1)
          on = on || at(px, py)
        }
        tries++
        hits += on ? 1 : 0
      }
    }
    if (hits / tries < 0.9) continue

    // squarish corners: a rounded box still has ink just inside each corner, a filled dot does not
    const ins = Math.max(1, Math.round(bw * 0.08))
    let corners = 0
    for (const [cx, cy] of [[x0 + ins, y0 + ins], [x1 - ins, y0 + ins], [x0 + ins, y1 - ins], [x1 - ins, y1 - ins]]) {
      let on = 0
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) on = on || at(cx + dx, cy + dy)
      corners += on ? 1 : 0
    }
    if (corners < 3) continue

    // what is inside: nothing (unchecked), a solid fill (tick drawn in white), or a mark we classify by its shape
    const ix0 = x0 + t + 1, ix1 = x1 - t - 1, iy0 = y0 + t + 1, iy1 = y1 - t - 1
    const mx = (ix0 + ix1) / 2, my = (iy0 + iy1) / 2
    let ink = 0, area = 0, mnx = W, mxx = 0, mny = H, mxy = 0
    const quad = [0, 0, 0, 0]
    for (let y = iy0; y <= iy1; y++) {
      for (let x = ix0; x <= ix1; x++) {
        area++
        if (!mask[y * W + x]) continue
        ink++
        if (x < mnx) mnx = x
        if (x > mxx) mxx = x
        if (y < mny) mny = y
        if (y > mxy) mxy = y
        quad[(y > my ? 2 : 0) + (x > mx ? 1 : 0)]++
      }
    }
    out.push({ x0, y0, bw, bh, cx: x0 + bw / 2, cy: y0 + bh / 2, checked: area > 0 && ink / area > 0.1, kind: markKind(ink, area, mnx, mxx, mny, mxy, quad) })
  }
  return out
}

export const MARK_STYLES = [
  { id: 'tick', glyph: '✓', label: 'ติ๊กถูก' },
  { id: 'cross', glyph: '✗', label: 'กากบาท' },
  { id: 'dot', glyph: '●', label: 'จุด' },
]

/** The whole checkbox redrawn, so it can replace the original one underneath. */
export function boxToPng(checked, style, accent) {
  const n = 200
  const c = document.createElement('canvas')
  c.width = c.height = n
  const ctx = c.getContext('2d')
  const body = checked && style === 'tick' ? accent : '#000000'
  ctx.lineCap = 'round'; ctx.lineJoin = 'round'
  ctx.beginPath()
  ctx.roundRect(8, 8, n - 16, n - 16, 30)
  ctx.fillStyle = checked && style === 'tick' ? accent : '#ffffff'
  ctx.fill()
  ctx.strokeStyle = body; ctx.lineWidth = 14
  ctx.stroke()
  if (checked) {
    ctx.beginPath()
    if (style === 'tick') { ctx.strokeStyle = '#fff'; ctx.lineWidth = 22; ctx.moveTo(48, 104); ctx.lineTo(86, 144); ctx.lineTo(154, 58); ctx.stroke() }
    else if (style === 'cross') { ctx.strokeStyle = accent; ctx.lineWidth = 22; ctx.moveTo(52, 52); ctx.lineTo(148, 148); ctx.moveTo(148, 52); ctx.lineTo(52, 148); ctx.stroke() }
    else { ctx.fillStyle = accent; ctx.arc(n / 2, n / 2, 44, 0, Math.PI * 2); ctx.fill() }
  }
  return c
}

const MARGIN = 1

/** Copy of a box from the rendered page, with a pixel of margin for anti-aliased edges. */
export function cropBox(canvas, b) {
  const { x0, y0, bw, bh } = b.px
  const out = document.createElement('canvas')
  out.width = bw + MARGIN * 2
  out.height = bh + MARGIN * 2
  const ctx = out.getContext('2d', { willReadFrequently: true })
  ctx.drawImage(canvas, x0 - MARGIN, y0 - MARGIN, out.width, out.height, 0, 0, out.width, out.height)
  clearOutside(ctx, out.width, out.height, b.bg)
  return out
}

/**
 * Make the page background around the box transparent (only what touches the edge, so a white fill inside
 * the box stays). The copy can then sit on any background, striped rows included.
 */
function clearOutside(ctx, w, h, bg) {
  const img = ctx.getImageData(0, 0, w, h)
  const d = img.data
  const ref = [1, 3, 5].map((i) => parseInt(bg.slice(i, i + 2), 16))
  const dist = (p) => Math.abs(d[p] - ref[0]) + Math.abs(d[p + 1] - ref[1]) + Math.abs(d[p + 2] - ref[2])
  const TOL = 48
  const seen = new Uint8Array(w * h)
  const stack = []
  const push = (x, y) => {
    if (x < 0 || y < 0 || x >= w || y >= h || seen[y * w + x] || dist((y * w + x) * 4) >= TOL) return
    seen[y * w + x] = 1
    stack.push(y * w + x)
  }
  for (let x = 0; x < w; x++) { push(x, 0); push(x, h - 1) }
  for (let y = 0; y < h; y++) { push(0, y); push(w - 1, y) }
  while (stack.length) {
    const p = stack.pop()
    const x = p % w, y = (p - x) / w
    d[p * 4 + 3] = Math.round((dist(p * 4) / TOL) * 255)
    push(x + 1, y); push(x - 1, y); push(x, y + 1); push(x, y - 1)
  }
  ctx.putImageData(img, 0, 0)
}

/** Where a box image sits on the page (page fractions) and its height / width, margin included. */
export function boxFrame(b) {
  const { x0, y0, bw, bh, W, H } = b.px
  return { x: (x0 - MARGIN) / W, y: (y0 - MARGIN) / H, w: (bw + MARGIN * 2) / W, h: (bh + MARGIN * 2) / H, ratio: (bh + MARGIN * 2) / (bw + MARGIN * 2) }
}

/** The theme colour of a checked box: its most saturated pixels, else its darkest. */
export function accentOf(crop) {
  const d = crop.getContext('2d').getImageData(0, 0, crop.width, crop.height).data
  let r = 0, g = 0, bl = 0, n = 0, dark = null, darkL = 999
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] < 200) continue
    const mx = Math.max(d[i], d[i + 1], d[i + 2])
    const mn = Math.min(d[i], d[i + 1], d[i + 2])
    if (mx - mn > 60) { r += d[i]; g += d[i + 1]; bl += d[i + 2]; n++ }
    const l = d[i] + d[i + 1] + d[i + 2]
    if (l < darkL) { darkL = l; dark = [d[i], d[i + 1], d[i + 2]] }
  }
  const c = n > 8 ? [r / n, g / n, bl / n] : dark
  return c ? '#' + c.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('') : null
}

/** Draw a mark on top of an existing box image, keeping that box's own border, corners and colours. */
export function markOnBox(base, style, accent, solid = true) {
  const c = document.createElement('canvas')
  c.width = base.width
  c.height = base.height
  const ctx = c.getContext('2d')
  ctx.drawImage(base, 0, 0)
  const w = c.width, h = c.height
  ctx.lineCap = 'round'; ctx.lineJoin = 'round'
  ctx.lineWidth = Math.max(2, w * 0.13)
  let mark = accent
  if (solid) {
    // a themed document: the box becomes a solid body in the theme colour with a white mark
    ctx.globalCompositeOperation = 'source-in'
    ctx.fillStyle = accent
    ctx.fillRect(0, 0, w, h)
    ctx.globalCompositeOperation = 'source-over'
    mark = '#ffffff'
  }
  // otherwise (nothing to copy from) the box keeps its own white body and gets a plain mark in `accent`
  ctx.strokeStyle = mark; ctx.fillStyle = mark
  ctx.beginPath()
  if (style === 'tick') { ctx.moveTo(w * 0.24, h * 0.52); ctx.lineTo(w * 0.43, h * 0.72); ctx.lineTo(w * 0.77, h * 0.29); ctx.stroke() }
  else if (style === 'cross') { ctx.moveTo(w * 0.3, h * 0.3); ctx.lineTo(w * 0.7, h * 0.7); ctx.moveTo(w * 0.7, h * 0.3); ctx.lineTo(w * 0.3, h * 0.7); ctx.stroke() }
  else { ctx.arc(w / 2, h / 2, w * 0.2, 0, Math.PI * 2); ctx.fill() }
  return c
}

/** Pick the remembered sample whose size is closest to this box. */
export function nearest(list, b) {
  let best = null, gap = Infinity
  for (const t of list) { const g = Math.abs(t.bw - b.px.bw); if (g < gap) { gap = g; best = t } }
  return best
}

/**
 * Recolour a box image: `fill` is the body colour behind the mark (the blue of a ticked box) and `mark` is
 * the colour of the tick / cross / dot on it. Either may be null to keep the original. The outer ring and
 * the transparent surroundings are left alone.
 */
/** Body colour (most common inside the ring) and mark colour (furthest from it) of box pixels. */
function bodyAndMark(d, w, h, ring) {
  const votes = new Map()
  for (let y = ring; y < h - ring; y++) {
    for (let x = ring; x < w - ring; x++) {
      const i = (y * w + x) * 4
      if (d[i + 3] < 200) continue
      const key = `${d[i] >> 4},${d[i + 1] >> 4},${d[i + 2] >> 4}`
      const v = votes.get(key) || { n: 0, r: 0, g: 0, b: 0 }
      v.n++; v.r += d[i]; v.g += d[i + 1]; v.b += d[i + 2]
      votes.set(key, v)
    }
  }
  let top = null
  for (const v of votes.values()) if (!top || v.n > top.n) top = v
  if (!top) return null
  const body = [top.r / top.n, top.g / top.n, top.b / top.n]
  let far = 0, markRef = body
  for (let y = ring; y < h - ring; y++) {
    for (let x = ring; x < w - ring; x++) {
      const i = (y * w + x) * 4
      if (d[i + 3] < 200) continue
      const g = Math.abs(d[i] - body[0]) + Math.abs(d[i + 1] - body[1]) + Math.abs(d[i + 2] - body[2])
      if (g > far) { far = g; markRef = [d[i], d[i + 1], d[i + 2]] }
    }
  }
  return { body, markRef, far }
}

const toHex = (c) => '#' + c.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')

/** The colours a box image really uses: { body, mark } as hex, mark null when it has none. */
export function boxColors(src) {
  const w = src.width, h = src.height
  const d = src.getContext('2d').getImageData(0, 0, w, h).data
  const f = bodyAndMark(d, w, h, Math.max(2, Math.round(w * 0.1)))
  return f ? { body: toHex(f.body), mark: f.far > 60 ? toHex(f.markRef) : null } : null
}

export function recolorBox(src, fill, mark) {
  const w = src.width, h = src.height
  const c = document.createElement('canvas')
  c.width = w; c.height = h
  const ctx = c.getContext('2d', { willReadFrequently: true })
  ctx.drawImage(src, 0, 0)
  if (!fill && !mark) return c
  const img = ctx.getImageData(0, 0, w, h)
  const d = img.data
  const ring = Math.max(2, Math.round(w * 0.1))
  const inside = (x, y) => x >= ring && x < w - ring && y >= ring && y < h - ring
  const found = bodyAndMark(d, w, h, ring)
  if (!found) return c
  const { body, markRef, far } = found
  const gap = (i) => Math.abs(d[i] - body[0]) + Math.abs(d[i + 1] - body[1]) + Math.abs(d[i + 2] - body[2])
  const hasMark = far > 60
  const parse = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16))
  const newBody = fill ? parse(fill) : body
  const newMark = mark ? parse(mark) : markRef
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!inside(x, y)) continue
      const i = (y * w + x) * 4
      if (d[i + 3] < 10) continue
      const t = hasMark ? Math.min(1, gap(i) / far) : 0 // 0 = body colour, 1 = mark colour
      // keep pixels that are neither body nor mark (e.g. noise) by only blending along the body-mark line
      for (let j = 0; j < 3; j++) d[i + j] = Math.round(newBody[j] * (1 - t) + newMark[j] * t)
    }
  }
  ctx.putImageData(img, 0, 0)
  return c
}
