import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Palette } from './Palette'
import { findSymbol, indexFromFile, loadIndex } from './data/index'
import { FunctionPage } from './fn/FunctionPage'
import { Gallery } from './fn/Gallery'
import { RepoMap } from './map/RepoMap'
import { Go, NavContext, placeOf, type Nav } from './nav'
import { Space } from './space/Space'
import { useTheme } from './theme'
import { ThreadView, type ThreadsLink } from './threads/ThreadView'
import type { Index, Sym } from './types'
import { readLink, writeLink, type Link, type View } from './url'

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

export default function App() {
  const [link, setLink] = useState<Link>(() => readLink(location.search))
  const [index, setIndex] = useState<Index | null>(null)
  const [error, setError] = useState<string | null>(null)
  /** An index picked from disk replaces whatever the link names until the page is reloaded. */
  const [picked, setPicked] = useState<Index | null>(null)
  /** What the thread view last showed, so the tab comes back to the same panes. */
  const threads = useRef<ThreadsLink | null>(null)
  /** The function last picked on the board, so the tab comes back to it. */
  const board = useRef<Partial<Link>>({ view: 'space' })
  const picker = useRef<HTMLInputElement>(null)
  const [searching, setSearching] = useState(false)
  const dark = useTheme((s) => s.dark)
  const setTheme = useTheme((s) => s.set)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setSearching((v) => !v)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  useEffect(() => {
    let stale = false
    setIndex(null)
    setError(null)
    loadIndex(link.data).then(
      (i) => !stale && setIndex(i),
      (e) => !stale && setError(String(e?.message ?? e)),
    )
    return () => {
      stale = true
    }
  }, [link.data])

  useEffect(() => {
    const onPop = () => setLink(readLink(location.search))
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  /** A full link from the parts a view names; the index in use carries over. */
  const fill = useCallback((next: Partial<Link>): Link => ({ view: 'space', focus: null, fn: null, orbit: false, flow: false, files: [], sym: null, at: null, ...next, data: next.data ?? link.data }), [link.data])
  const nav = useMemo<Nav>(
    () => ({
      href: (next) => location.pathname + writeLink(fill(next)),
      go: (next) => {
        const full = fill(next)
        history.pushState(null, '', location.pathname + writeLink(full))
        setLink(full)
        window.scrollTo(0, 0)
      },
    }),
    [fill],
  )

  /** Rewrite the address bar without adding a history entry or re-rendering. */
  const replace = useCallback((next: Partial<Link>) => {
    try {
      history.replaceState(null, '', location.pathname + writeLink(next))
    } catch {
      /* not allowed on some origins */
    }
  }, [])

  /** Where a dock tab leads: the thread view comes back to its panes, the map to the file last used. */
  const toView = (view: View): Partial<Link> => {
    const t = threads.current
    if (view === 'threads') return { view, files: t?.files ?? [], sym: t?.sym ?? null }
    if (view === 'map') return { view, focus: link.view === 'threads' ? (t?.recent ?? null) : link.focus }
    if (view === 'space') return board.current
    return { view }
  }
  const openFile = (path: string): Partial<Link> => ({ view: 'threads', files: [path] })

  const onThreads = useCallback(
    (t: ThreadsLink) => {
      threads.current = t
      replace({ view: 'threads', data: link.data, files: t.files, sym: t.sym })
    },
    [replace, link.data],
  )
  const onPin = useCallback((path: string | null) => replace({ view: 'map', data: link.data, focus: path }), [replace, link.data])

  const pick = async (file: File | undefined) => {
    if (!file) return
    try {
      threads.current = null
      board.current = { view: 'space' }
      setPicked(await indexFromFile(file))
      setError(null)
    } catch (e) {
      setError(String((e as Error)?.message ?? e))
    }
  }

  const shown = picked ?? index
  const section: View = link.view === 'function' ? 'functions' : link.view
  const tab = (view: View, label: string) => (
    <Go to={toView(view)} className="tab" aria-current={section === view ? 'page' : undefined}>
      {label}
    </Go>
  )
  const fn = shown && (link.view === 'function' || link.view === 'space') ? findSymbol(shown, link.fn) : null
  if (link.view === 'space') board.current = { view: 'space', fn: link.fn, orbit: link.orbit, flow: link.flow }
  /** The board picked a function. A pick is not a new page; putting one in the middle is. */
  const onBoard = (sym: Sym | null, how: 'pick' | 'orbit' | 'flow', push: boolean) => {
    const next = fill({ view: 'space', fn: sym && shown ? placeOf(shown, sym) : null, orbit: how === 'orbit', flow: how === 'flow' })
    if (push) return nav.go(next)
    replace(next)
    setLink(next)
  }

  let body: ReactNode
  if (error && !shown)
    body = (
      <div className="plate flex max-w-[72ch] flex-col gap-2">
        <h1 className="m-0 text-[22px] font-normal tracking-[-0.01em]">No index loaded.</h1>
        <p className="m-0">{error}</p>
        <p className="m-0 text-muted">
          Build one with <code className="font-mono text-[0.9em]">npm run index -- /path/to/repo</code>, or open an index file with the button above.
        </p>
      </div>
    )
  else if (!shown)
    body = (
      <div role="status" aria-label="Loading the index" className="flex flex-col gap-[22px]">
        <div className="skeleton h-[112px] max-w-[760px]" />
        <div className="skeleton h-[520px]" />
      </div>
    )
  else if (link.view === 'threads') body = <ThreadView key={shown.source} index={shown} link={link} onLink={onThreads} />
  else if (link.view === 'space') body = <Space key={shown.source} index={shown} fn={fn} orbit={link.orbit} flow={link.flow} onSelect={onBoard} />
  else if (fn) body = <FunctionPage key={shown.source + fn.id} index={shown} sym={fn} />
  else if (link.view === 'functions' || link.view === 'function') body = <Gallery key={shown.source} index={shown} />
  else body = <RepoMap key={shown.source} index={shown} focus={link.focus} hrefFor={(p) => nav.href(openFile(p))} onOpen={(p) => nav.go(openFile(p))} onPin={onPin} />

  const stats = shown?.meta.stats
  return (
    <NavContext.Provider value={nav}>
      <div className="mx-auto flex max-w-[1560px] flex-col gap-[26px] px-4 pt-3.5 pb-28">
        <header className="relative z-10 flex flex-wrap items-center justify-between gap-x-6 gap-y-2 text-[13px]">
          <div className="flex min-w-0 flex-wrap items-center gap-1.5">
            <Go to={{ view: 'space' }} className="mr-2 text-[15px] font-semibold tracking-[-0.02em] text-ink no-underline">
              repomapo
            </Go>
            {shown && (
              <>
                <span className="chip">{shown.meta.repo ?? shown.source}</span>
                <span className="chip tabular-nums">{plural(shown.files.length, 'file')}</span>
                {stats?.symbols != null && <span className="chip tabular-nums max-[640px]:hidden">{stats.symbols} symbols</span>}
                <span className="chip tabular-nums max-[640px]:hidden">{plural(shown.graph.edges, 'call edge')}</span>
              </>
            )}
          </div>
          <div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-1">
            {error && shown && (
              <span role="alert" className="text-thread">
                {error}
              </span>
            )}
            {shown && <span className="truncate text-muted max-[900px]:hidden">{shown.source}</span>}
            <button className="btn" onClick={() => picker.current?.click()} title="Reads the file in your browser. Nothing is uploaded.">
              Open an index
            </button>
            <button className="btn" onClick={() => setTheme(dark ? 'light' : 'dark')} aria-label={dark ? 'Switch to light' : 'Switch to dark'} title={dark ? 'Switch to light' : 'Switch to dark'}>
              <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" aria-hidden="true">
                {dark ? <path d="M8 1.5v1.6M8 12.9v1.6M1.5 8h1.6M12.9 8h1.6M3.4 3.4l1.1 1.1M11.5 11.5l1.1 1.1M3.4 12.6l1.1-1.1M11.5 4.5l1.1-1.1M10.8 8a2.8 2.8 0 1 1-5.6 0 2.8 2.8 0 0 1 5.6 0Z" /> : <path d="M13.6 9.6A5.9 5.9 0 0 1 6.4 2.4a5.9 5.9 0 1 0 7.2 7.2Z" />}
              </svg>
              {dark ? 'Light' : 'Dark'}
            </button>
          </div>
        </header>
        {body}
      </div>
      <nav className="dock" aria-label="Views">
        <Go to={{ view: 'space' }} className="mark" aria-label="repomapo, the whole repo on one board">
          rm
        </Go>
        {tab('space', 'Space')}
        {tab('functions', 'Functions')}
        {tab('map', 'Files')}
        {tab('threads', 'Threads')}
        <span className="sep" />
        <button className="tab" onClick={() => setSearching(true)} title="Jump to a function, a file or a view (Ctrl K, or ⌘K on a Mac)">
          <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true">
            <circle cx="7" cy="7" r="4.5" />
            <path d="m10.5 10.5 3.5 3.5" />
          </svg>
          <span className="ml-1.5 max-[520px]:hidden">Search</span>
          <kbd className="max-[760px]:hidden">⌘K</kbd>
        </button>
      </nav>
      <input ref={picker} type="file" accept="application/json,.json" hidden onChange={(e) => (pick(e.target.files?.[0]), (e.target.value = ''))} />
      {searching && <Palette index={shown} view={link.view} onClose={() => setSearching(false)} />}
    </NavContext.Provider>
  )
}
