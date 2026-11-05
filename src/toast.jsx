import { useEffect, useRef, useState } from 'react'
import { Icon } from './icons.jsx'

// A small notification centre. Anything can call toast(...) or confirmBox(...); <Toasts /> is mounted once in the app.
let seq = 0
let state = { toasts: [], confirm: null }
const listeners = new Set()
const set = (patch) => {
  state = { ...state, ...patch }
  listeners.forEach((l) => l(state))
}

const ICONS = { success: 'check', info: 'info', warn: 'warn', error: 'warn' }

/**
 * Show a message. type: success | info | warn | error. action: { label, onClick } adds a button (e.g. "ย้อนกลับ").
 * The same message shown again replaces the earlier one instead of stacking.
 */
export function toast(message, { type = 'success', action, duration } = {}) {
  const id = ++seq
  const kept = state.toasts.filter((t) => t.message !== message)
  const ms = duration ?? (type === 'error' || action ? 6500 : 3200)
  set({ toasts: [...kept, { id, type, message, action, ms, leaving: false }].slice(-4) })
  return id
}

export function dismissToast(id) {
  set({ toasts: state.toasts.map((t) => (t.id === id ? { ...t, leaving: true } : t)) })
  setTimeout(() => set({ toasts: state.toasts.filter((t) => t.id !== id) }), 220)
}

/** Our own confirm dialog. Resolves to true (confirmed) or false (cancelled). */
export function confirmBox({ title, message, confirmLabel = 'ตกลง', cancelLabel = 'ยกเลิก', danger = false }) {
  return new Promise((resolve) => set({ confirm: { title, message, confirmLabel, cancelLabel, danger, resolve } }))
}

function ToastItem({ t }) {
  const [paused, setPaused] = useState(false)
  const left = useRef(t.ms)
  const since = useRef(0)
  useEffect(() => {
    if (t.leaving) return
    if (paused) return
    since.current = performance.now()
    const timer = setTimeout(() => dismissToast(t.id), left.current)
    return () => { clearTimeout(timer); left.current -= performance.now() - since.current }
  }, [paused, t.leaving, t.id])

  return (
    <div
      className={`toast ${t.type} ${t.leaving ? 'is-leaving' : ''} ${paused ? 'is-paused' : ''}`}
      role={t.type === 'error' || t.type === 'warn' ? 'alert' : 'status'}
      style={{ '--dur': `${t.ms}ms` }}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
    >
      <span className="toast-ico" aria-hidden="true"><Icon name={ICONS[t.type]} size={18} /></span>
      <span className="toast-msg">{t.message}</span>
      {t.action && (
        <button className="toast-act" onClick={() => { t.action.onClick(); dismissToast(t.id) }}>{t.action.label}</button>
      )}
      <button className="toast-x" aria-label="ปิดการแจ้งเตือน" onClick={() => dismissToast(t.id)}><Icon name="close" size={16} /></button>
    </div>
  )
}

function ConfirmDialog({ c }) {
  const ok = useRef(null)
  const cancel = useRef(null)
  const done = (v) => { c.resolve(v); set({ confirm: null }) }
  useEffect(() => {
    // a destructive question starts on "cancel", so Enter cannot delete by accident
    ;(c.danger ? cancel : ok).current?.focus()
    const key = (e) => { if (e.key === 'Escape') { e.stopPropagation(); done(false) } }
    window.addEventListener('keydown', key, true)
    return () => window.removeEventListener('keydown', key, true)
  }, [c])
  return (
    <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && done(false)}>
      <div className="modal confirm" role="alertdialog" aria-modal="true" aria-labelledby="confirm-h" aria-describedby="confirm-p">
        <span className={`confirm-ico ${c.danger ? 'danger' : ''}`} aria-hidden="true"><Icon name={c.danger ? 'trash' : 'info'} size={26} /></span>
        <h2 id="confirm-h">{c.title}</h2>
        {c.message && <p id="confirm-p" className="hint" style={{ marginBottom: 18 }}>{c.message}</p>}
        <div className="modal-actions">
          <button ref={ok} className={`btn ${c.danger ? 'danger-solid' : 'primary'}`} onClick={() => done(true)}>{c.confirmLabel}</button>
          <button ref={cancel} className="btn quiet" onClick={() => done(false)}>{c.cancelLabel}</button>
        </div>
      </div>
    </div>
  )
}

export function Toasts() {
  const [s, setS] = useState(state)
  useEffect(() => {
    listeners.add(setS)
    setS(state)
    return () => listeners.delete(setS)
  }, [])
  return (
    <>
      <div className="toasts" aria-live="polite">
        {s.toasts.map((t) => <ToastItem key={t.id} t={t} />)}
      </div>
      {s.confirm && <ConfirmDialog c={s.confirm} />}
    </>
  )
}
