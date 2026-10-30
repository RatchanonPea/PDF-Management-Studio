const P = {
  sheet: <path d="M7 3h7l4 4v14H7zM14 3v4h4" />,
  merge: <path d="M4 5h6v6H4zM14 13h6v6h-6zM10 8h2a2 2 0 0 1 2 2v3" />,
  grid: <path d="M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z" />,
  pen: <path d="M4 20l4-1L19 8l-3-3L5 16zM14 7l3 3M4 20h16" />,
  drop: <path d="M12 3s6 6.5 6 11a6 6 0 0 1-12 0c0-4.5 6-11 6-11z" />,
  lock: <path d="M6 11h12v9H6zM8.5 11V8a3.5 3.5 0 0 1 7 0v3" />,
  plus: <path d="M12 5v14M5 12h14" />,
  rotate: <path d="M19 12a7 7 0 1 1-2.2-5.1M19 4v4h-4" />,
  trash: <path d="M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13" />,
  download: <path d="M12 4v11M7 11l5 5 5-5M5 20h14" />,
  undo: <path d="M9 7L4 12l5 5M4 12h10a6 6 0 0 1 6 6" />,
  type: <path d="M5 6V4h14v2M12 4v16M9 20h6" />,
  image: <path d="M4 5h16v14H4zM4 16l5-5 4 4 3-3 4 4M15 9h.01" />,
  edit: <path d="M4 20h4L19 9l-4-4L4 16zM13 7l4 4" />,
  alignL: <path d="M4 6h16M4 10h10M4 14h16M4 18h10" />,
  alignC: <path d="M4 6h16M7 10h10M4 14h16M7 18h10" />,
  alignR: <path d="M4 6h16M10 10h10M4 14h16M10 18h10" />,
  upload: <path d="M12 16V5M7 9l5-5 5 5M5 20h14" />,
}

export function Icon({ name, size = 20 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {P[name]}
    </svg>
  )
}
