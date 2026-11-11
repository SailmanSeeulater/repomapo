import { useCallback, useEffect, useRef, useState, type MouseEvent, type ReactNode } from 'react'
import { indexFromFile, loadIndex } from './data/index'
import { RepoMap } from './map/RepoMap'
import { ThreadView, type ThreadsLink } from './threads/ThreadView'
import type { Index } from './types'
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
  const picker = useRef<HTMLInputElement>(null)

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

  const go = useCallback((next: Link) => {
    history.pushState(null, '', location.pathname + writeLink(next))
    setLink(next)
    window.scrollTo(0, 0)
  }, [])

  /** Rewrite the address bar without adding a history entry or re-rendering. */
  const replace = useCallback((next: Partial<Link>) => {
    try {
      history.replaceState(null, '', location.pathname + writeLink(next))
    } catch {
      /* not allowed on some origins */
    }
  }, [])

  const toView = (view: View): Link => {
    const t = threads.current
    if (view === 'threads') return { view, data: link.data, focus: null, files: t?.files ?? [], sym: t?.sym ?? null, at: null }
    return { view, data: link.data, focus: link.view === 'threads' ? (t?.recent ?? null) : link.focus, files: [], sym: null, at: null }
  }
  const openFile = (path: string): Link => ({ view: 'threads', data: link.data, focus: null, files: [path], sym: null, at: null })

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
      setPicked(await indexFromFile(file))
      setError(null)
    } catch (e) {
      setError(String((e as Error)?.message ?? e))
    }
  }

  const shown = picked ?? index
  const tab = (view: View, label: string) => {
    const click = (e: MouseEvent) => {
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return
      e.preventDefault()
      go(toView(view))
    }
    return (
      <a
        href={location.pathname + writeLink(toView(view))}
        onClick={click}
        aria-current={link.view === view ? 'page' : undefined}
        className={`-mb-px border-b-2 px-0.5 py-2.5 no-underline transition-colors duration-150 ${link.view === view ? 'border-thread font-semibold text-ink' : 'border-transparent text-muted hover:text-ink'}`}
      >
        {label}
      </a>
    )
  }

  let body: ReactNode
  if (error && !shown)
    body = (
      <div className="flex max-w-[72ch] flex-col gap-2 rounded-md border border-rule bg-surface p-4">
        <b>No index loaded.</b>
        <p className="m-0">{error}</p>
        <p className="m-0 text-muted">
          Build one with <code className="font-mono text-[0.9em]">npm run index -- /path/to/repo</code>, or open an index file with the button above.
        </p>
      </div>
    )
  else if (!shown)
    body = (
      <div role="status" aria-label="Loading the index" className="flex flex-col gap-[22px]">
        <div className="skeleton h-[104px]" />
        <div className="grid gap-[26px] min-[881px]:grid-cols-3">
          <div className="skeleton h-[420px]" />
          <div className="skeleton h-[420px]" />
          <div className="skeleton h-[420px]" />
        </div>
      </div>
    )
  else if (link.view === 'threads') body = <ThreadView key={shown.source} index={shown} link={link} onLink={onThreads} />
  else body = <RepoMap key={shown.source} index={shown} focus={link.focus} hrefFor={(p) => location.pathname + writeLink(openFile(p))} onOpen={(p) => go(openFile(p))} onPin={onPin} />

  const stats = shown?.meta.stats
  return (
    <div className="mx-auto flex max-w-[1560px] flex-col gap-[22px] px-4 pb-16">
      <header className="flex flex-wrap items-center justify-between gap-x-6 border-b border-rule">
        <nav aria-label="Views" className="flex items-center gap-5 text-[14px]">
          <span className="mr-1 text-[15px] font-semibold tracking-[-0.01em]">repomapo</span>
          {tab('map', 'Repo map')}
          {tab('threads', 'Thread view')}
        </nav>
        <div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-1 py-2 text-[13px]">
          {error && shown && (
            <span role="alert" className="text-thread">
              {error}
            </span>
          )}
          {shown && (
            <span className="text-muted tabular-nums">
              {shown.source}
              {shown.meta.repo ? ` · ${shown.meta.repo}` : ''} · {plural(shown.files.length, 'file')}
              {stats?.symbols != null ? ` · ${stats.symbols} symbols · ${stats.refs} usages` : ''}
            </span>
          )}
          <button className="btn" onClick={() => picker.current?.click()} title="Reads the file in your browser. Nothing is uploaded.">
            Open an index file
          </button>
          <input ref={picker} type="file" accept="application/json,.json" hidden onChange={(e) => (pick(e.target.files?.[0]), (e.target.value = ''))} />
        </div>
      </header>
      <h1 className="sr-only">{link.view === 'threads' ? 'Thread view' : 'Repo map'}</h1>
      {body}
    </div>
  )
}
