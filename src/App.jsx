import { useCallback, useEffect, useRef, useState } from 'react'
import { importPdf, exportPdf, downloadBlob, formatSize, needsPassword, renderToCanvas, renderBlobPage } from './pdf.js'
import { Icon } from './icons.jsx'
import { Editor } from './Editor.jsx'

const TOOLS = [
  { id: 'merge', view: 'workspace', icon: 'merge', title: 'รวม / แยกไฟล์', en: 'Merge & Split', desc: 'ต่อ PDF หลายไฟล์เป็นไฟล์เดียว หรือแยกทีละหน้า' },
  { id: 'organize', view: 'workspace', icon: 'grid', title: 'จัดเรียง / หมุนหน้า', en: 'Organize & Rotate', desc: 'ลากสลับลำดับ หมุน หรือลบหน้าที่ไม่ต้องการ' },
  { id: 'sign', view: 'editor', tab: 'sign', icon: 'pen', title: 'เซ็นชื่อ / ประทับตรา', en: 'E-Sign & Stamp', desc: 'วาดหรืออัปโหลดลายเซ็น แล้วลากวางบนหน้า PDF' },
  { id: 'text', view: 'editor', tab: 'text', icon: 'type', title: 'พิมพ์ข้อความ', en: 'Add Text', desc: 'พิมพ์ข้อความใหม่ลงบนหน้า เลือกขนาดและสี ลากวางได้' },
  { id: 'image', view: 'editor', tab: 'image', icon: 'image', title: 'แทรกรูปภาพ', en: 'Add Image', desc: 'นำรูปภาพ โลโก้ หรือรูปถ่ายเข้ามาวางบนหน้า PDF' },
  { id: 'edit', view: 'editor', tab: 'edit', icon: 'edit', title: 'แก้ข้อความเดิม', en: 'Edit Existing Text', desc: 'คลิกข้อความที่มีอยู่ใน PDF แล้วแก้ไขได้ทันที' },
  { id: 'watermark', view: 'editor', tab: 'watermark', icon: 'drop', title: 'ใส่ลายน้ำ', en: 'Watermark', desc: 'ใส่ข้อความ เช่น “สำเนาถูกต้อง” ทับทุกหน้า' },
  { id: 'protect', view: 'protect', icon: 'lock', title: 'ตั้ง / ปลดรหัสผ่าน', en: 'Protect & Unlock', desc: 'ตั้งรหัสผ่านก่อนดาวน์โหลด หรือเปิดไฟล์ที่ล็อกด้วยรหัสเดิม' },
]

export default function App() {
  const [view, setView] = useState('home')
  const [tool, setTool] = useState(TOOLS[0])
  const [pages, setPages] = useState([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState(null)
  const [ask, setAsk] = useState(null)
  const [editorSeen, setEditorSeen] = useState(false)
  const [session, setSession] = useState(0)
  const [dirty, setDirty] = useState(0)
  const [library, setLibrary] = useState([])
  const [draftPages, setDraftPages] = useState({})
  const [leaving, setLeaving] = useState(null)
  const lastEditor = useRef(TOOLS[2])

  useEffect(() => {
    if (!dirty) return
    const warn = (e) => { e.preventDefault(); e.returnValue = '' }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])

  // leaving the editor with unsaved edits asks first: keep as draft or discard
  const requestLeave = (go) => (view === 'editor' && dirty ? setLeaving(() => go) : go())
  const discardDraft = () => { setEditorSeen(false); setSession((n) => n + 1); setDirty(0); setDraftPages({}) }
  const sources = useRef(new Map())

  // replace: start a new job with these files (older files stay in the library); libraryOnly: just store them
  const addFiles = useCallback(async (fileList, { replace = false, libraryOnly = false } = {}) => {
    const files = [...fileList].filter((f) => f.type === 'application/pdf' || /\.pdf$/i.test(f.name))
    if (!files.length) {
      setError('รองรับเฉพาะไฟล์ .pdf เท่านั้น')
      return false
    }
    setError('')
    setBusy(true)
    try {
      let ok = false
      let first = replace
      for (const f of files) {
        try {
          const { src, pages: added } = await importPdf(f)
          sources.current.set(src.id, src)
          setLibrary((prev) => [...prev, { id: src.id, name: src.name, size: src.bytes.length, unlocked: src.unlocked, pages: added }])
          const fresh = first
          if (!libraryOnly) setPages((prev) => (fresh ? added : [...prev, ...added]))
          first = false
          ok = true
        } catch (e) {
          if (!needsPassword(e)) throw e
          if (first && !libraryOnly) setPages([])
          first = false
          setAsk({ file: f, wrong: false, libraryOnly })
          ok = true
        }
      }
      return ok
    } catch (e) {
      setError(`เปิดไฟล์ไม่ได้ อาจมีรหัสผ่านหรือไฟล์เสียหาย (${e.message})`)
      return false
    } finally {
      setBusy(false)
    }
  }, [])

  const unlock = async (password) => {
    setBusy(true)
    try {
      const { src, pages: added } = await importPdf(ask.file, password)
      sources.current.set(src.id, src)
      setLibrary((prev) => [...prev, { id: src.id, name: src.name, size: src.bytes.length, unlocked: src.unlocked, pages: added }])
      if (!ask.libraryOnly) setPages((prev) => [...prev, ...added])
      setAsk(null)
    } catch (e) {
      if (needsPassword(e)) setAsk({ ...ask, wrong: true })
      else { setError(`เปิดไฟล์ไม่ได้ (${e.message})`); setAsk(null) }
    } finally {
      setBusy(false)
    }
  }

  const open = (t) => {
    setTool(t)
    setView(t.view)
    if (t.view === 'editor') { setEditorSeen(true); lastEditor.current = t }
  }

  const workOn = (ids) => {
    setPages(library.filter((l) => ids.includes(l.id)).flatMap((l) => l.pages))
    open(TOOLS[0])
  }
  const addToWork = (id) => setPages((prev) => (prev.some((p) => p.fileId === id) ? prev : [...prev, ...library.find((l) => l.id === id).pages]))
  const removeFromLibrary = (id) => {
    sources.current.delete(id)
    setLibrary((prev) => prev.filter((l) => l.id !== id))
    setPages((prev) => prev.filter((p) => p.fileId !== id))
  }

  const clearSession = () => {
    sources.current.clear()
    setLibrary([])
    setPages([])
    setResult(null)
    discardDraft()
    setView('home')
  }

  const runExport = async (mode, edits) => {
    setBusy(true)
    try {
      setResult(await exportPdf(pages, sources.current, edits, mode))
    } catch (e) {
      setError(`สร้างไฟล์ไม่สำเร็จ: ${e.message}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <Header view={view} libCount={library.length} onHome={() => requestLeave(() => setView('home'))} onLibrary={() => requestLeave(() => setView('library'))} />
      {dirty > 0 && view !== 'editor' && <DraftBar count={dirty} onResume={() => open(lastEditor.current)} onDiscard={discardDraft} />}
      <main>
        {(view === 'workspace' || view === 'protect') && <ToolFab tool={tool} pages={pages} onOpen={open} />}
        {view === 'library' && (
          <Library library={library} pages={pages} draftPages={draftPages} busy={busy} error={error} addFiles={addFiles} onWork={workOn} onAdd={addToWork} onRemove={removeFromLibrary} />
        )}
        {view === 'home' && (
          <Home
            onFiles={async (files) => {
              if (await addFiles(files, { replace: true })) open(TOOLS[0])
            }}
            onOpen={open}
            busy={busy}
            error={error}
          />
        )}
        {view === 'workspace' && (
          <Workspace
            tool={tool}
            onOpen={open}
            pages={pages}
            setPages={setPages}
            addFiles={addFiles}
            busy={busy}
            error={error}
            onExport={runExport}
          />
        )}
        {view === 'protect' && (
          <Protect pages={pages} sources={sources.current} addFiles={addFiles} busy={busy} error={error} onExport={runExport} />
        )}
        {editorSeen && (
          <div hidden={view !== 'editor'}>
            <Editor
              key={session}
              tab={tool.tab || 'sign'}
              onTab={(id) => open(TOOLS.find((t) => t.tab === id))}
              onBack={() => requestLeave(() => open(TOOLS[0]))}
              onDirty={(n, perPage) => { setDirty(n); setDraftPages(perPage) }}
              pages={pages}
              sources={sources.current}
              addFiles={addFiles}
              busy={busy}
              error={error}
              onExport={runExport}
            />
          </div>
        )}
      </main>
      {(view === 'home' || view === 'library') && (
        <footer className="appfoot">
          Free PDF Studio · เวอร์ชัน {__APP_VERSION__}{__APP_COMMIT__ ? ` (${__APP_COMMIT__})` : ''} · สร้างเมื่อ {__APP_BUILT__}
        </footer>
      )}
      {leaving && (
        <LeaveDialog
          count={dirty}
          onDraft={() => { const go = leaving; setLeaving(null); go() }}
          onDiscard={() => { const go = leaving; setLeaving(null); discardDraft(); go() }}
          onStay={() => setLeaving(null)}
        />
      )}
      {ask && <PasswordDialog ask={ask} busy={busy} onSubmit={unlock} onCancel={() => setAsk(null)} />}
      {result && (
        <ResultModal
          result={result}
          pageCount={pages.length}
          pages={pages}
          sources={sources.current}
          onClose={() => setResult(null)}
          onClear={clearSession}
        />
      )}
    </>
  )
}

function Header({ view, libCount, onHome, onLibrary }) {
  return (
    <header className="topbar">
      <button className="brand" onClick={onHome} aria-label="Free PDF Studio กลับหน้าแรก">
        <span className="brand-mark" aria-hidden="true">
          <Icon name="sheet" />
        </span>
        Free PDF Studio
      </button>
      <nav aria-label="เมนูหลัก">
        <button className={view === 'home' ? 'is-here' : ''} onClick={onHome}>เครื่องมือ</button>
        <button className={view === 'library' ? 'is-here' : ''} onClick={onLibrary}>คลัง PDF{libCount ? ` (${libCount})` : ''}</button>
        <a href="#privacy" onClick={(e) => { e.preventDefault(); onHome(); setTimeout(() => document.getElementById('privacy')?.scrollIntoView({ behavior: 'smooth' }), 0) }}>
          ความเป็นส่วนตัว
        </a>
        <a href="https://github.com" target="_blank" rel="noreferrer">GitHub</a>
      </nav>
    </header>
  )
}

function Home({ onFiles, onOpen, busy, error }) {
  return (
    <>
      <section className="hero">
        <div className="hero-copy">
          <h1>เครื่องมือจัดการ PDF ฟรี ปลอดภัย ไม่ต้องอัปโหลดขึ้นเซิร์ฟเวอร์</h1>
          <p>
            ไฟล์ถูกประมวลผลในเบราว์เซอร์ของคุณทั้งหมด ปิดแท็บเมื่อไหร่ ข้อมูลก็หายไปพร้อมกัน
          </p>
        </div>
        <DropSheet onFiles={onFiles} busy={busy} error={error} />
      </section>

      <section className="tools" aria-labelledby="tools-h">
        <h2 id="tools-h">เลือกเครื่องมือ</h2>
        <ul>
          {TOOLS.map((t) => (
            <li key={t.id}>
              <button className="tool-row" onClick={() => onOpen(t)}>
                <span className="tool-glyph" aria-hidden="true"><Icon name={t.icon} /></span>
                <span className="tool-name">
                  {t.title}
                  <small>{t.en}</small>
                </span>
                <span className="tool-desc">{t.desc}</span>
                <span className="tool-go">เปิด</span>
              </button>
            </li>
          ))}
        </ul>
      </section>

      <section className="privacy" id="privacy">
        <h2>ไฟล์ของคุณไม่ได้ออกจากเครื่องนี้</h2>
        <p>
          แอปนี้ไม่มีเซิร์ฟเวอร์รับไฟล์ การรวม แยก หมุน เซ็น พิมพ์ แก้ข้อความ ใส่ลายน้ำ และตั้งรหัสผ่านทำด้วย pdf-lib และ pdf.js
          ในหน่วยความจำของเบราว์เซอร์ คุณตรวจสอบได้เองจากแท็บ Network ใน DevTools ว่าไม่มีไฟล์ถูกส่งออก
        </p>
      </section>
    </>
  )
}

function DropSheet({ onFiles, busy, error }) {
  const [over, setOver] = useState(false)
  const input = useRef(null)
  return (
    <div
      className={`sheet ${over ? 'is-over' : ''}`}
      onDragOver={(e) => { e.preventDefault(); setOver(true) }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => { e.preventDefault(); setOver(false); onFiles(e.dataTransfer.files) }}
    >
      <div className="sheet-inner">
        <p className="sheet-title">{busy ? 'กำลังอ่านไฟล์…' : 'วางไฟล์ PDF ที่นี่'}</p>
        <p className="sheet-sub">เลือกได้หลายไฟล์พร้อมกัน</p>
        <button className="btn primary" onClick={() => input.current.click()} disabled={busy}>
          <Icon name="plus" /> เลือกไฟล์ PDF
        </button>
        <input ref={input} type="file" accept="application/pdf,.pdf" multiple hidden onChange={(e) => { onFiles(e.target.files); e.target.value = '' }} />
        {error && <p className="error" role="alert">{error}</p>}
      </div>
      <svg className="stamp" viewBox="0 0 220 96" aria-hidden="true">
        <defs>
          <filter id="ink" x="-5%" y="-5%" width="110%" height="110%">
            <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed="4" result="n" />
            <feDisplacementMap in="SourceGraphic" in2="n" scale="2.2" />
          </filter>
        </defs>
        <g filter="url(#ink)" fill="none" stroke="currentColor">
          <rect x="4" y="4" width="212" height="88" rx="6" strokeWidth="4" />
          <rect x="11" y="11" width="198" height="74" rx="3" strokeWidth="1.5" />
        </g>
        <g filter="url(#ink)" fill="currentColor" textAnchor="middle" fontFamily="Bai Jamjuree, Sarabun, sans-serif" fontWeight="700">
          <text x="110" y="45" fontSize="22">ประมวลผล</text>
          <text x="110" y="72" fontSize="22">ในเครื่องนี้</text>
        </g>
      </svg>
    </div>
  )
}

function ToolFab({ tool, pages, onOpen }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)

  useEffect(() => {
    if (!open) return
    const out = (e) => ref.current && !ref.current.contains(e.target) && setOpen(false)
    const esc = (e) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('pointerdown', out)
    window.addEventListener('keydown', esc)
    return () => { document.removeEventListener('pointerdown', out); window.removeEventListener('keydown', esc) }
  }, [open])

  if (!pages.length) return null
  return (
    <div className="fab" ref={ref}>
      {open && (
        <ul className="fab-menu" role="menu" aria-label="เลือกเครื่องมือ">
          {TOOLS.filter((t) => t.id !== tool.id).map((t) => (
            <li key={t.id} role="none">
              <button role="menuitem" onClick={() => { setOpen(false); onOpen(t) }}>
                <span className="tool-glyph" aria-hidden="true"><Icon name={t.icon} /></span>
                <span><b>{t.title}</b><small>{t.desc}</small></span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <button className="fab-btn" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <Icon name="grid" /> {open ? 'ปิดเมนู' : 'เครื่องมืออื่น'}
      </button>
    </div>
  )
}

function Library({ library, pages, draftPages, busy, error, addFiles, onWork, onAdd, onRemove }) {
  const [pick, setPick] = useState([])
  const input = useRef(null)
  const inWork = (id) => pages.some((p) => p.fileId === id)
  const drafts = (l) => l.pages.reduce((n, p) => n + (draftPages[p.id] || 0), 0)
  const toggle = (id) => setPick((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]))
  const chosen = pick.filter((id) => library.some((l) => l.id === id))

  return (
    <div className="workspace">
      <div className="toolbar">
        <h1>คลัง PDF</h1>
        <div className="toolbar-actions">
          <button className="btn primary" onClick={() => input.current.click()} disabled={busy}><Icon name="plus" /> เพิ่มไฟล์เข้าคลัง</button>
          <input ref={input} type="file" accept="application/pdf,.pdf" multiple hidden onChange={(e) => { addFiles(e.target.files, { libraryOnly: true }); e.target.value = '' }} />
        </div>
        <div className="toolbar-end">
          <button className="btn primary" disabled={!chosen.length} onClick={() => onWork(chosen)}>
            ทำงานกับไฟล์ที่เลือก{chosen.length ? ` (${chosen.length})` : ''}
          </button>
        </div>
      </div>
      {error && <p className="error banner" role="alert">{error}</p>}
      {!library.length ? (
        <div className="empty">
          <p className="sheet-title">ยังไม่มีไฟล์ในคลัง</p>
          <p>ไฟล์ที่เปิดไว้ในเซสชันนี้จะมาอยู่ที่นี่ กลับมาเปิดทำต่อได้โดยไม่ต้องเลือกไฟล์ใหม่</p>
        </div>
      ) : (
        <>
          <p className="count">{library.length} ไฟล์ · ไฟล์อยู่ในหน่วยความจำของเบราว์เซอร์ หายเมื่อปิดหรือรีเฟรชหน้านี้ · ติ๊กหลายไฟล์เพื่อรวมงานเข้าด้วยกัน</p>
          <ul className="lib-list">
            {library.map((l) => (
              <li key={l.id} className={`lib-item ${inWork(l.id) ? 'is-active' : ''}`}>
                <label className="lib-pick">
                  <input type="checkbox" checked={pick.includes(l.id)} onChange={() => toggle(l.id)} aria-label={`เลือก ${l.name}`} />
                </label>
                <img src={l.pages[0].thumb} alt="" draggable="false" />
                <div className="lib-info">
                  <b title={l.name}>{l.name}</b>
                  <small>{l.pages.length} หน้า · {formatSize(l.size)}{l.unlocked ? ' · ปลดล็อกแล้ว' : ''}</small>
                  <span className="badges">
                    {inWork(l.id) && <span className="badge">กำลังใช้งานอยู่</span>}
                    {drafts(l) > 0 && <span className="badge draft">ฉบับร่าง {drafts(l)} รายการ</span>}
                  </span>
                </div>
                <div className="lib-actions">
                  <button className="btn primary" onClick={() => onWork([l.id])}>เปิดไฟล์นี้</button>
                  {!inWork(l.id) && <button className="btn" onClick={() => onAdd(l.id)}>เพิ่มเข้างานปัจจุบัน</button>}
                  <button className="btn quiet" onClick={() => window.confirm(`ลบ “${l.name}” ออกจากคลัง?`) && onRemove(l.id)}>ลบ</button>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  )
}

function DraftBar({ count, onResume, onDiscard }) {
  return (
    <div className="draftbar" role="status">
      <span><b>มีฉบับร่าง</b> {count} รายการที่ยังไม่ได้ดาวน์โหลด</span>
      <button className="btn" onClick={onResume}>แก้ไขต่อ</button>
      <button className="btn quiet" onClick={onDiscard}>ทิ้งฉบับร่าง</button>
    </div>
  )
}

function LeaveDialog({ count, onDraft, onDiscard, onStay }) {
  const ref = useRef(null)
  useEffect(() => {
    ref.current?.focus()
    const esc = (e) => e.key === 'Escape' && onStay()
    window.addEventListener('keydown', esc)
    return () => window.removeEventListener('keydown', esc)
  }, [onStay])
  return (
    <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && onStay()}>
      <div className="modal" role="alertdialog" aria-modal="true" aria-labelledby="leave-h">
        <h2 id="leave-h" ref={ref} tabIndex={-1}>มีการแก้ไขที่ยังไม่ได้ดาวน์โหลด</h2>
        <p className="hint" style={{ marginBottom: 18 }}>มี {count} รายการบนไฟล์นี้ ต้องการทำอย่างไร</p>
        <div className="modal-actions">
          <button className="btn primary" onClick={onDraft}>เก็บเป็นฉบับร่าง</button>
          <button className="btn danger" onClick={onDiscard}>ยกเลิกการแก้ไข</button>
          <button className="btn quiet" onClick={onStay}>กลับไปแก้ไขต่อ</button>
        </div>
        <p className="hint" style={{ marginTop: 14 }}>ฉบับร่างเก็บไว้ในหน้านี้เท่านั้น หายเมื่อปิดหรือรีเฟรชหน้าเว็บ</p>
      </div>
    </div>
  )
}

function PasswordDialog({ ask, busy, onSubmit, onCancel }) {
  const [pw, setPw] = useState('')
  return (
    <div className="scrim">
      <form className="modal" role="dialog" aria-modal="true" aria-labelledby="pw-h" onSubmit={(e) => { e.preventDefault(); onSubmit(pw) }}>
        <h2 id="pw-h">ไฟล์นี้ถูกล็อกด้วยรหัสผ่าน</h2>
        <p className="hint" style={{ marginBottom: 14 }}>{ask.file.name}</p>
        <input className="text" type="password" autoFocus value={pw} onChange={(e) => setPw(e.target.value)} placeholder="รหัสผ่านของไฟล์" aria-label="รหัสผ่านของไฟล์" />
        {ask.wrong && <p className="error" role="alert" style={{ marginTop: 8 }}>รหัสผ่านไม่ถูกต้อง</p>}
        <div className="modal-actions" style={{ marginTop: 18 }}>
          <button className="btn primary" disabled={!pw || busy}>{busy ? 'กำลังเปิด…' : 'ปลดล็อกและเปิดไฟล์'}</button>
          <button type="button" className="btn quiet" onClick={onCancel}>ยกเลิก</button>
        </div>
      </form>
    </div>
  )
}

function Protect({ pages, sources, addFiles, busy, error, onExport }) {
  const [pw, setPw] = useState('')
  const [again, setAgain] = useState('')
  const input = useRef(null)
  const files = [...new Set(pages.map((p) => p.fileId))].map((id) => ({ ...sources.get(id), count: pages.filter((p) => p.fileId === id).length }))
  const mismatch = again && pw !== again
  const asciiOnly = /^[\x20-\x7E]*$/.test(pw)

  return (
    <div className="workspace">
      <div className="toolbar">
        <h1>ตั้ง / ปลดรหัสผ่าน</h1>
        <div className="toolbar-actions">
          <button className="btn primary" onClick={() => input.current.click()} disabled={busy}><Icon name="plus" /> เพิ่มไฟล์ PDF</button>
          <input ref={input} type="file" accept="application/pdf,.pdf" multiple hidden onChange={(e) => { addFiles(e.target.files); e.target.value = '' }} />
        </div>
      </div>
      {error && <p className="error banner" role="alert">{error}</p>}
      {!pages.length ? (
        <div className="empty">
          <p className="sheet-title">{busy ? 'กำลังอ่านไฟล์…' : 'ยังไม่มีไฟล์'}</p>
          <p>เพิ่มไฟล์ PDF ปกติเพื่อตั้งรหัสผ่าน หรือไฟล์ที่ล็อกอยู่เพื่อปลดล็อก (ต้องทราบรหัสเดิม)</p>
        </div>
      ) : (
        <div className="protect">
          <ul className="file-list">
            {files.map((f) => (
              <li key={f.id}>
                <span>{f.name}</span>
                <small>{f.count} หน้า{f.unlocked ? ' · ปลดล็อกแล้ว' : ''}</small>
              </li>
            ))}
          </ul>
          <section className="field">
            <h2>ตั้งรหัสผ่าน</h2>
            <label className="label" htmlFor="pw1">รหัสผ่านใหม่</label>
            <input id="pw1" className="text" type="password" value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="new-password" />
            <label className="label" htmlFor="pw2">ยืนยันรหัสผ่าน</label>
            <input id="pw2" className="text" type="password" value={again} onChange={(e) => setAgain(e.target.value)} autoComplete="new-password" />
            {mismatch && <p className="error" role="alert">รหัสผ่านไม่ตรงกัน</p>}
            {pw && !asciiOnly && <p className="error" role="alert">ใช้ได้เฉพาะตัวอักษรอังกฤษ ตัวเลข และสัญลักษณ์ (ข้อจำกัดของมาตรฐาน PDF)</p>}
            <p className="hint">เข้ารหัส RC4 128 บิต กันการเปิดอ่านทั่วไป ไม่ใช่การเข้ารหัสระดับสูงสุด</p>
            <button className="btn primary" disabled={busy || !pw || pw !== again || !asciiOnly} onClick={() => onExport('merge', { password: pw })}>
              <Icon name="lock" /> ตั้งรหัสผ่านและดาวน์โหลด
            </button>
          </section>
          <section className="field">
            <h2>ดาวน์โหลดแบบไม่มีรหัสผ่าน</h2>
            <p className="hint">ไฟล์ที่ปลดล็อกจะถูกบันทึกเป็นภาพของแต่ละหน้า ข้อความในไฟล์จะเลือกหรือค้นหาไม่ได้ เพราะ pdf-lib ถอดรหัสไฟล์โดยตรงไม่ได้</p>
            <button className="btn" disabled={busy} onClick={() => onExport('merge', {})}><Icon name="download" /> ดาวน์โหลดไฟล์ที่ไม่มีรหัส</button>
          </section>
        </div>
      )}
    </div>
  )
}

function Workspace({ tool, onOpen, pages, setPages, addFiles, busy, error, onExport }) {
  const [dragId, setDragId] = useState(null)
  const [overId, setOverId] = useState(null)
  const [mode, setMode] = useState('merge')
  const input = useRef(null)

  const move = (from, to) => {
    if (from === to) return
    setPages((prev) => {
      const a = prev.findIndex((p) => p.id === from)
      const b = prev.findIndex((p) => p.id === to)
      const next = [...prev]
      const [item] = next.splice(a, 1)
      next.splice(b, 0, item)
      return next
    })
  }
  const rotate = (id) => setPages((prev) => prev.map((p) => (p.id === id ? { ...p, rotation: (p.rotation + 90) % 360 } : p)))
  const remove = (id) => setPages((prev) => prev.filter((p) => p.id !== id))

  return (
    <div
      className="workspace"
      onDragOver={(e) => { if (e.dataTransfer.types.includes('Files')) e.preventDefault() }}
      onDrop={(e) => { if (e.dataTransfer.files.length) { e.preventDefault(); addFiles(e.dataTransfer.files) } }}
    >
      <div className="toolbar">
        <h1>{tool.title}</h1>
        <div className="toolbar-actions">
          <button className="btn primary" onClick={() => input.current.click()} disabled={busy}>
            <Icon name="plus" /> เพิ่มไฟล์ PDF
          </button>
          <input ref={input} type="file" accept="application/pdf,.pdf" multiple hidden onChange={(e) => { addFiles(e.target.files); e.target.value = '' }} />
          <button className="btn" disabled={!pages.length} onClick={() => setPages((p) => p.map((x) => ({ ...x, rotation: (x.rotation + 90) % 360 })))} aria-label="หมุนทุกหน้า 90 องศา" title="หมุนทุกหน้า 90 องศา">
            <Icon name="rotate" /> <span className="lbl">หมุนทั้งหมด</span>
          </button>
          <button className="btn" disabled={!pages.length} onClick={() => setPages([])} aria-label="ล้างทุกหน้าออกจากงานนี้" title="ล้างทุกหน้าออกจากงานนี้">
            <Icon name="trash" /> <span className="lbl">ล้างทั้งหมด</span>
          </button>
        </div>
        <div className="toolbar-end">
          <div className="seg" role="radiogroup" aria-label="รูปแบบไฟล์ผลลัพธ์">
            <button role="radio" aria-checked={mode === 'merge'} className={mode === 'merge' ? 'on' : ''} onClick={() => setMode('merge')}>ไฟล์เดียว</button>
            <button role="radio" aria-checked={mode === 'split'} className={mode === 'split' ? 'on' : ''} onClick={() => setMode('split')}>แยกทีละหน้า</button>
          </div>
          <button className="btn primary" disabled={!pages.length || busy} onClick={() => onExport(mode, {})}>
            <Icon name="download" /> {busy ? 'กำลังสร้างไฟล์…' : 'สร้างและดาวน์โหลด'}
          </button>
        </div>
      </div>

      {error && <p className="error banner" role="alert">{error}</p>}

      {pages.length === 0 ? (
        <div className="empty">
          <p className="sheet-title">{busy ? 'กำลังอ่านไฟล์…' : 'ยังไม่มีหน้า PDF'}</p>
          <p>ลากไฟล์มาวางตรงนี้ หรือกด “เพิ่มไฟล์ PDF” ด้านบน</p>
        </div>
      ) : (
        <>
          <p className="count">{pages.length} หน้า · ลากการ์ดเพื่อสลับลำดับ</p>
          <ol className="grid">
            {pages.map((p, i) => (
              <li
                key={p.id}
                className={`page ${dragId === p.id ? 'is-drag' : ''} ${overId === p.id && dragId !== p.id ? 'is-over' : ''}`}
                draggable
                onDragStart={(e) => { setDragId(p.id); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', p.id) }}
                onDragOver={(e) => { if (dragId) { e.preventDefault(); setOverId(p.id) } }}
                onDrop={(e) => { if (dragId) { e.preventDefault(); e.stopPropagation(); move(dragId, p.id) } setDragId(null); setOverId(null) }}
                onDragEnd={() => { setDragId(null); setOverId(null) }}
              >
                <div className="page-paper" style={{ aspectRatio: `${1 / p.ratio}` }}>
                  <img src={p.thumb} alt={`หน้า ${i + 1} จาก ${p.fileName}`} draggable="false" style={{ transform: `rotate(${p.rotation}deg)`, ...(p.rotation % 180 ? { width: `${100 * p.ratio}%`, height: `${100 / p.ratio}%` } : {}) }} />
                </div>
                <span className="page-no">{i + 1}</span>
                <span className="page-name" title={p.fileName}>{p.fileName}</span>
                <div className="page-tools">
                  <button onClick={() => rotate(p.id)} aria-label={`หมุนหน้า ${i + 1}`}><Icon name="rotate" /></button>
                  <button onClick={() => remove(p.id)} aria-label={`ลบหน้า ${i + 1}`} className="danger"><Icon name="trash" /></button>
                </div>
              </li>
            ))}
          </ol>
        </>
      )}
    </div>
  )
}

function Compare({ result, pages, sources }) {
  const [idx, setIdx] = useState(0)
  const [shots, setShots] = useState(null)
  const [pos, setPos] = useState(50)

  useEffect(() => {
    let live = true
    setShots(null)
    const p = pages[idx]
    const single = result.files.length === 1
    Promise.all([
      renderToCanvas(sources.get(p.fileId).doc, p.index, 700, 1),
      renderBlobPage(result.files[single ? 0 : idx].blob, single ? idx : 0, 700),
    ]).then(([b, a]) => live && setShots({ before: b.toDataURL('image/jpeg', 0.9), after: a.toDataURL('image/jpeg', 0.9), ratio: a.height / a.width }))
      .catch((e) => { console.error(e); live && setShots({ failed: true }) })
    return () => { live = false }
  }, [idx])

  return (
    <div className="compare">
      <div className="compare-bar">
        <button className="btn" disabled={idx === 0} onClick={() => setIdx(idx - 1)} aria-label="หน้าก่อนหน้า">‹</button>
        <span>หน้า {idx + 1} จาก {pages.length}</span>
        <button className="btn" disabled={idx >= pages.length - 1} onClick={() => setIdx(idx + 1)} aria-label="หน้าถัดไป">›</button>
      </div>
      {!shots && <p className="hint">กำลังสร้างตัวอย่าง…</p>}
      {shots?.failed && <p className="error">แสดงตัวอย่างไม่ได้</p>}
      {shots?.after && (
        <div className="compare-view" style={{ aspectRatio: `${1 / shots.ratio}` }}>
          <img src={shots.after} alt="หลังแก้ไข" draggable="false" />
          <img className="before" src={shots.before} alt="ก่อนแก้ไข" draggable="false" style={{ clipPath: `inset(0 ${100 - pos}% 0 0)` }} />
          <span className="tag l">ก่อน</span>
          <span className="tag r">หลัง</span>
          <span className="handle" style={{ left: `${pos}%` }} aria-hidden="true" />
          <input type="range" min="0" max="100" value={pos} onChange={(e) => setPos(+e.target.value)} aria-label="เลื่อนเพื่อเทียบก่อนและหลัง" />
        </div>
      )}
    </div>
  )
}

function ResultModal({ result, pageCount, pages, sources, onClose, onClear }) {
  const [compare, setCompare] = useState(false)
  const total = result.files.reduce((s, f) => s + f.blob.size, 0)
  const ref = useRef(null)
  useEffect(() => {
    ref.current?.focus()
    const esc = (e) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', esc)
    return () => window.removeEventListener('keydown', esc)
  }, [onClose])
  const single = result.files.length === 1
  const [base, setBase] = useState(single ? result.files[0].name.replace(/\.pdf$/i, '') : 'page')
  const clean = base.replace(/[\\/:*?"<>|]/g, '').trim() || 'document'
  const named = result.files.map((f, i) => ({ ...f, name: single ? `${clean}.pdf` : `${clean}-${String(i + 1).padStart(2, '0')}.pdf` }))

  return (
    <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal ${compare ? 'wide' : ''}`} role="dialog" aria-modal="true" aria-labelledby="done-h">
        <svg className="check" viewBox="0 0 52 52" aria-hidden="true">
          <circle cx="26" cy="26" r="24" />
          <path d="M15 27l8 8 14-16" />
        </svg>
        <h2 id="done-h" ref={ref} tabIndex={-1}>ประมวลผล PDF เรียบร้อย</h2>
        <div className="field name-field">
          <label className="label" htmlFor="outname">{single ? 'ชื่อไฟล์' : 'ชื่อไฟล์ (ต่อท้ายด้วยเลขหน้า)'}</label>
          <div className="name-row">
            <input id="outname" className="text" value={base} onChange={(e) => setBase(e.target.value)} onFocus={(e) => e.target.select()} />
            <span>{single ? '.pdf' : '-01.pdf'}</span>
          </div>
        </div>
        {result.encrypted ? (
          <p className="hint" style={{ marginBottom: 14 }}>ไฟล์ที่ตั้งรหัสผ่านไม่สามารถแสดงตัวอย่างเปรียบเทียบได้</p>
        ) : (
          <>
            <button className="btn full" style={{ marginBottom: 14 }} aria-expanded={compare} onClick={() => setCompare((v) => !v)}>
              {compare ? 'ซ่อนการเปรียบเทียบ' : 'เปรียบเทียบก่อน / หลัง'}
            </button>
            {compare && <Compare result={result} pages={pages} sources={sources} />}
          </>
        )}
        <dl>
          <div><dt>ไฟล์</dt><dd>{single ? named[0].name : `${result.files.length} ไฟล์ (หน้าละไฟล์)`}</dd></div>
          <div><dt>ขนาด</dt><dd>{formatSize(total)}</dd></div>
          <div><dt>จำนวนหน้า</dt><dd>{pageCount}</dd></div>
          <div><dt>เวลาที่ใช้</dt><dd>{(result.ms / 1000).toFixed(2)} วินาที</dd></div>
        </dl>
        <div className="modal-actions">
          <button className="btn primary" onClick={() => named.forEach((f, i) => setTimeout(() => downloadBlob(f), i * 250))}>
            <Icon name="download" /> ดาวน์โหลด PDF
          </button>
          <button className="btn" onClick={onClose}>แก้ไขต่อ</button>
          <button className="btn quiet" onClick={onClear}>ล้างข้อมูลในเบราว์เซอร์</button>
        </div>
      </div>
    </div>
  )
}
