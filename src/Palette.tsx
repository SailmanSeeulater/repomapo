import { useEffect, useMemo, useRef, useState } from 'react'
import { isCallable, isType, qualifiedName, usedBy } from './data/callGraph'
import { placeOf, toFunction, useNav } from './nav'
import { useTheme } from './theme'
import type { Index } from './types'
import type { Link, View } from './url'

interface Item {
  key: string
  tag: string
  title: string
  sub: string
  /** What the search looks in, lower case: the short name first, then the rest. */
  name: string
  more: string
  weight: number
  to?: Partial<Link>
  /** For a function: the same one on the board. */
  space?: Partial<Link>
  run?: () => void
}

const MAX = 40

/** Jump anywhere: a function, a type, a file or a view, by typing part of its name. */
export function Palette({ index, view, onClose }: { index: Index | null; view: View; onClose(): void }) {
  const nav = useNav()
  const theme = useTheme()
  const dialog = useRef<HTMLDialogElement>(null)
  const list = useRef<HTMLDivElement>(null)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)

  useEffect(() => {
    dialog.current?.showModal()
  }, [])

  const commands = useMemo<Item[]>(() => {
    const go = (v: View, title: string, sub: string): Item => ({ key: 'v' + v, tag: 'view', title, sub, name: title.toLowerCase(), more: sub.toLowerCase(), weight: 0, to: { view: v } })
    return [
      go('space', 'Space', 'Every function on one board, grouped by folder and file'),
      go('functions', 'Functions', 'Every function as a card you can filter'),
      go('map', 'Map', 'Files and what they import'),
      go('threads', 'Threads', 'Files side by side, with a thread to every usage'),
      { key: 'theme', tag: 'look', title: theme.dark ? 'Switch to light' : 'Switch to dark', sub: 'The choice is kept in this browser', name: 'theme light dark', more: 'look colour color mode', weight: 0, run: () => theme.set(theme.dark ? 'light' : 'dark') },
      ...(theme.theme === 'auto' ? [] : [{ key: 'auto', tag: 'look', title: 'Follow the system theme', sub: 'Light or dark, whichever the system is in', name: 'theme system auto', more: 'look colour color mode', weight: 0, run: () => theme.set('auto') }]),
    ]
  }, [theme])

  const items = useMemo<Item[]>(() => {
    if (!index) return []
    const out: Item[] = []
    for (const s of index.syms) {
      if (!isCallable(s) && !isType(s)) continue
      const path = index.files[s.def.file].path
      const title = qualifiedName(index, s)
      out.push({
        key: s.id,
        tag: isCallable(s) ? 'fn' : s.kind,
        title,
        sub: `${path}:${s.def.line}`,
        name: s.name.toLowerCase(),
        more: (title + ' ' + path).toLowerCase(),
        weight: usedBy(index, s).length,
        to: toFunction(index, s),
        space: isCallable(s) ? { view: 'space', fn: placeOf(index, s) } : undefined,
      })
    }
    index.files.forEach((f, i) => out.push({ key: 'f' + i, tag: 'file', title: f.path.slice(f.path.lastIndexOf('/') + 1), sub: f.path, name: f.path.slice(f.path.lastIndexOf('/') + 1).toLowerCase(), more: f.path.toLowerCase(), weight: index.defsIn[i].length, to: { view: 'threads', files: [f.path] } }))
    return out
  }, [index])

  const q = query.trim().toLowerCase()
  const results = useMemo(() => {
    if (!q) return [...commands, ...items.filter((i) => i.tag === 'fn').sort((a, b) => b.weight - a.weight).slice(0, 6)]
    const rank = (i: Item) => (i.name.startsWith(q) ? 0 : i.name.includes(q) ? 1 : i.more.includes(q) ? 2 : -1)
    return [...commands, ...items]
      .map((i) => [rank(i), i] as const)
      .filter(([r]) => r >= 0)
      .sort((a, b) => a[0] - b[0] || b[1].weight - a[1].weight || a[1].title.localeCompare(b[1].title))
      .slice(0, MAX)
      .map(([, i]) => i)
  }, [q, commands, items])

  useEffect(() => setActive(0), [q])
  useEffect(() => {
    list.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' })
  }, [active])

  /** On the board a function opens on the board; anywhere else it opens as its page. */
  const open = (item: Item, other = false) => {
    onClose()
    if (item.run) return item.run()
    const onBoard = (view === 'space') !== other
    nav.go(onBoard && item.space ? item.space : item.to!)
  }

  return (
    <dialog
      ref={dialog}
      className="palette"
      aria-label="Search"
      onClose={onClose}
      onClick={(e) => e.target === dialog.current && onClose()}
      onKeyDown={(e) => {
        if (e.key === 'ArrowDown') setActive(Math.min(results.length - 1, active + 1))
        else if (e.key === 'ArrowUp') setActive(Math.max(0, active - 1))
        else if (e.key === 'Enter' && results[active]) open(results[active], e.shiftKey)
        else return
        e.preventDefault()
      }}
    >
      <input autoFocus type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="A function, a type, a file or a view" aria-label="Search this repo" role="combobox" aria-expanded="true" aria-controls="palette-list" />
      <div ref={list} id="palette-list" role="listbox" className="palette-list">
        {!q && <p>Go to</p>}
        {results.map((item, i) => (
          <div key={item.key} role="option" aria-selected={i === active} className="palette-row" onMouseMove={() => i !== active && setActive(i)} onClick={() => open(item)}>
            <span className="tag">{item.tag}</span>
            <span className="what">
              <b>{item.title}</b>
              <span>{item.sub}</span>
            </span>
            {item.space && (
              <button
                tabIndex={-1}
                onClick={(e) => {
                  e.stopPropagation()
                  open(item, true)
                }}
              >
                {view === 'space' ? 'Read the code' : 'On the board'}
              </button>
            )}
            {!q && i === commands.length - 1 && results.length > commands.length && <hr />}
          </div>
        ))}
        {!results.length && <p>Nothing in this index matches “{query.trim()}”.</p>}
      </div>
      <footer>
        <span>↑ ↓ to move</span>
        <span>Enter to open</span>
        <span>Shift Enter for {view === 'space' ? 'the code' : 'the board'}</span>
        <span>Esc to close</span>
      </footer>
    </dialog>
  )
}
