import { useEffect, useMemo, useRef } from 'react'
import { defaultFiles, findFile, findSymbol } from '../data/index'
import type { Index } from '../types'
import { parsePlace, type Link } from '../url'
import { FileTree } from './FileTree'
import { Inspector } from './Inspector'
import { ThreadStage } from './stage'
import { MAX_PANES, useThreads } from './store'

/** What the address bar should say for the current panes and locked symbol. */
export interface ThreadsLink {
  files: string[]
  sym: string | null
  /** The file used most recently: where the repo map link points. */
  recent: string | null
}

function Key({ children, dashed }: { children?: string; dashed?: boolean }) {
  return <span className={`mr-1.5 inline-block rounded-full border border-thread px-1.5 align-[-1px] font-mono text-[11px] leading-4 text-ink ${dashed ? 'border-dashed' : 'font-bold text-thread'}`}>{children}</span>
}

export function ThreadView({ index, link, onLink }: { index: Index; link: Link; onLink(l: ThreadsLink): void }) {
  const stageRef = useRef<HTMLDivElement>(null)
  const engine = useRef<ThreadStage | null>(null)
  const first = useRef(link)
  const report = useRef(onLink)
  report.current = onLink
  const open = useThreads((s) => s.open)

  /** Open a file if needed and scroll to a line in it. */
  const hop = (file: number, line: number, flash = true) => {
    useThreads.getState().openFile(file)
    engine.current?.reveal({ file, line }, { flash })
  }

  useEffect(() => {
    const store = useThreads
    const from = first.current

    // Which files open first: the ones in the link, else the three with the most threads.
    let files = from.files.map((f) => findFile(index, f)).filter((i) => i >= 0)
    if (!files.length) files = defaultFiles(index)
    const linked = findSymbol(index, from.sym)
    const place = parsePlace(from.at)
    const at = place && findFile(index, place.path) >= 0 ? { file: findFile(index, place.path), line: place.line } : null
    for (const extra of [linked?.def.file, at?.file]) if (extra != null && !files.includes(extra)) files.push(extra)
    files = [...new Set(files)].slice(-MAX_PANES)

    // Start locked on the linked symbol, else on the one with the most usages across the open panes.
    let best = linked
    if (!best) {
      let most = 0
      for (const f of files)
        for (const s of index.defsIn[f]) {
          const n = s.refs.filter((r) => files.includes(r.file)).length
          if (n > most) {
            most = n
            best = s
          }
        }
    }
    store.getState().reset(files, best?.id ?? null)

    const stage = new ThreadStage(stageRef.current!, index, {
      onSymbol(id) {
        const s = store.getState()
        const sym = index.byId.get(id)
        if (!sym) return
        if (s.focus === id) return s.setFocus(null)
        s.setFocus(id)
        s.openFile(sym.def.file) // opens the definition's file if it is not open
        stage.reveal(sym.def)
      },
      onHover: (id) => store.getState().setHover(id),
      onHop: (file, line) => {
        store.getState().openFile(file)
        stage.reveal({ file, line }, { flash: true })
      },
      onLib: (key) => store.getState().setLib(store.getState().lib === key ? null : key),
      onClose: (file) => store.getState().closeFile(file),
      onTouch: (file) => store.getState().openFile(file),
    })
    engine.current = stage

    const tell = () => {
      const s = store.getState()
      const sym = s.focus ? index.byId.get(s.focus) : null
      const recent = s.open.length ? s.open.reduce((x, y) => (y.used > x.used ? y : x)).file : null
      report.current({
        files: s.open.map((p) => index.files[p.file].path),
        sym: sym ? `${index.files[sym.def.file].path}:${sym.def.line}:${sym.def.col}` : null,
        recent: recent == null ? null : index.files[recent].path,
      })
    }
    stage.sync(store.getState())
    if (at) stage.reveal(at, { flash: true, instant: true })
    else if (best) stage.reveal(best.def, { instant: true })
    tell()
    const unsubscribe = store.subscribe((s) => {
      stage.sync(s)
      tell()
    })

    const onKey = (e: KeyboardEvent) => {
      const s = store.getState()
      if (e.key === 'Escape' && (s.focus || s.lib)) s.clear()
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
      unsubscribe()
      stage.destroy()
      engine.current = null
    }
  }, [index])

  // Threads that would be drawn between the open panes.
  const total = useMemo(() => {
    const files = new Set(open.map((p) => p.file))
    let n = 0
    for (const f of files) for (const s of index.defsIn[f] ?? []) for (const r of s.refs) if (files.has(r.file)) n++
    return n
  }, [index, open])

  return (
    <>
      <p className="m-0 max-w-[68ch] text-muted">
        Hover any underlined name to see its threads. Click it to lock it and jump to its definition; if that file is not open, it opens. Up to four files stay open, and the one you used longest ago closes.
      </p>
      <Inspector index={index} total={total} onHop={hop} />
      <div className="grid items-start gap-[26px] min-[881px]:grid-cols-[240px_minmax(0,1fr)] max-[880px]:gap-4">
        <FileTree index={index} open={open.map((p) => p.file)} onOpen={(file) => hop(file, 1, false)} />
        <div ref={stageRef} className="stage" aria-label="Code panes" />
      </div>
      <div className="flex flex-wrap gap-x-5 gap-y-1.5 text-[13px] text-muted">
        <span>
          <svg width="26" height="12" className="mr-1.5 inline align-[-1px]">
            <rect x="1" y="1" width="24" height="10" rx="2" fill="var(--thread)" />
          </svg>
          definition
        </span>
        <span>
          <svg width="26" height="12" className="mr-1.5 inline align-[-1px]">
            <line x1="1" y1="6" x2="20" y2="6" stroke="var(--thread)" strokeWidth="1.6" />
            <circle cx="21" cy="6" r="3" fill="var(--thread)" />
          </svg>
          usage
        </span>
        <span>
          <svg width="26" height="12" className="mr-1.5 inline align-[-1px]">
            <line x1="1" y1="6" x2="20" y2="6" stroke="var(--thread)" strokeWidth="1.6" strokeDasharray="3 3" />
            <circle cx="21" cy="6" r="3" fill="var(--surface)" stroke="var(--thread)" strokeWidth="1.4" />
          </svg>
          usage scrolled out of view
        </span>
        <span>
          <Key>×9</Key>one thread per file, with a count
        </span>
        <span>
          <Key dashed>File.java 4</Key>usages in a file that is not open
        </span>
        <span>
          <span className="mr-1.5 inline-block size-1.5 rounded-[1px] bg-muted align-[1px]" />
          library symbols on that line
        </span>
        <span>Esc clears the lock</span>
      </div>
    </>
  )
}
