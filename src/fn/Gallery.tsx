import { useMemo, useState } from 'react'
import { isCallable, qualifiedName } from '../data/callGraph'
import { dirName, isTestPath } from '../data/index'
import { Go, toFunction } from '../nav'
import type { Index, Sym } from '../types'
import { relations } from './describe'

const PAGE = 48
const SIDE = 4
const W = 318
const H = 190
const DOTS = ['var(--ink)', 'var(--pin0)', 'var(--pin1)', 'var(--pin2)', 'var(--thread)', 'var(--faint)']
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`
const clip = (t: string, n: number) => (t.length > n ? t.slice(0, n - 1) + '…' : t)

interface Entry {
  sym: Sym
  name: string
  dir: string
  test: boolean
  by: string[]
  out: string[]
}

type Show = 'all' | 'entry' | 'leaf' | 'hub'
const SHOWS: [Show, string, string][] = [
  ['all', 'All', 'Every function'],
  ['entry', 'Entry points', 'Functions nothing in the repo calls'],
  ['hub', 'Most called', 'Functions with three or more callers'],
  ['leaf', 'Leaves', 'Functions that call nothing else in the repo'],
]

/** A card's picture: callers on the left, the function, what it calls on the right. */
function Mini({ e }: { e: Entry }) {
  const ys = (n: number) => Array.from({ length: n }, (_, i) => H / 2 + (i - (n - 1) / 2) * 30)
  const cx = W / 2
  const label = clip(e.sym.name, 13)
  const half = label.length * 4.4 + 10
  const side = (names: string[], left: boolean) => {
    const shown = names.length > SIDE ? [...names.slice(0, SIDE - 1), `+${names.length - SIDE + 1} more`] : names
    return ys(shown.length).map((y, i) => {
      const x = left ? 80 : W - 80
      const d = left ? `M${x + 4},${y} C${cx - 74},${y} ${cx - half - 24},${H / 2} ${cx - half},${H / 2}` : `M${cx + half},${H / 2} C${cx + half + 24},${H / 2} ${cx + 74},${y} ${x - 4},${y}`
      return (
        <g key={i}>
          <path d={d} />
          <text x={x} y={y + 4} textAnchor={left ? 'end' : 'start'}>
            {clip(shown[i], 11)}
          </text>
        </g>
      )
    })
  }
  return (
    <svg viewBox={`0 0 ${W} ${H}`} aria-hidden="true">
      {side(e.by, true)}
      {side(e.out, false)}
      {!e.by.length && (
        <text className="none" x={14} y={H / 2 + 4}>
          no caller
        </text>
      )}
      {!e.out.length && (
        <text className="none" x={W - 14} y={H / 2 + 4} textAnchor="end">
          calls nothing
        </text>
      )}
      <text className="me" x={cx} y={H / 2 + 5} textAnchor="middle">
        {label}
      </text>
    </svg>
  )
}

/** Every function in the index as a card. The filters narrow by name, by role in the graph and by folder. */
export function Gallery({ index }: { index: Index }) {
  const all = useMemo<Entry[]>(
    () =>
      index.syms.filter(isCallable).map((sym) => {
        const r = relations(index, sym)
        const path = index.files[sym.def.file].path
        return { sym, name: qualifiedName(index, sym), dir: dirName(path), test: isTestPath(path), by: r.by.map((l) => l.sym.name), out: r.out.map((l) => l.sym.name) }
      }),
    [index],
  )
  const dirs = useMemo(() => [...new Set(all.map((e) => e.dir))].sort(), [all])
  const hasTests = all.some((e) => e.test)

  const [query, setQuery] = useState('')
  const [show, setShow] = useState<Show>('all')
  const [dir, setDir] = useState('')
  const [tests, setTests] = useState(false)
  const [count, setCount] = useState(PAGE)

  const list = useMemo(() => {
    const q = query.trim().toLowerCase()
    return all
      .filter((e) => (tests || !e.test) && (!dir || e.dir === dir) && (!q || e.name.toLowerCase().includes(q)))
      .filter((e) => show === 'all' || (show === 'entry' && !e.by.length) || (show === 'leaf' && !e.out.length) || (show === 'hub' && e.by.length >= 3))
      .sort((a, b) => b.by.length + b.out.length - (a.by.length + a.out.length) || a.name.localeCompare(b.name))
  }, [all, query, show, dir, tests])
  const reset = () => {
    setQuery('')
    setShow('all')
    setDir('')
    setCount(PAGE)
  }
  const filtered = query || show !== 'all' || dir
  // Trim the part every folder shares, so the folder list reads as the differences.
  const common = dirs.length > 1 ? dirs.reduce((a, b) => { let i = 0; while (i < a.length && a[i] === b[i]) i++; return a.slice(0, i) }).replace(/[^/]*$/, '') : ''

  return (
    <>
      <h1 className="display">
        {plural(all.length, 'function')} in {index.meta.repo ?? 'this repo'}, each with what calls it and what it calls.
      </h1>
      <div className="filters" role="search">
        <input type="search" value={query} onChange={(e) => (setQuery(e.target.value), setCount(PAGE))} placeholder={`Search ${all.length} functions`} aria-label="Search functions by name" />
        {SHOWS.map(([key, label, title]) => (
          <button key={key} title={title} aria-pressed={show === key} onClick={() => (setShow(key), setCount(PAGE))}>
            {label}
          </button>
        ))}
        {dirs.length > 1 && (
          <select value={dir} onChange={(e) => (setDir(e.target.value), setCount(PAGE))} aria-label="Folder">
            <option value="">Every folder</option>
            {dirs.map((d) => (
              <option key={d} value={d}>
                {d.slice(common.length) || d}
              </option>
            ))}
          </select>
        )}
        {hasTests && (
          <button aria-pressed={tests} onClick={() => setTests(!tests)} title="Include functions defined in test folders">
            Tests
          </button>
        )}
      </div>
      <p className="m-0 flex flex-wrap items-baseline gap-x-4 text-[13px] text-muted">
        <span className="tabular-nums">
          Showing {Math.min(count, list.length)} of {plural(list.length, 'function')}, most connected first.
        </span>
        {filtered && (
          <button className="border-0 bg-transparent p-0 text-[13px] text-ink underline underline-offset-[3px]" onClick={reset}>
            Reset filters
          </button>
        )}
      </p>
      {list.length ? (
        <div className="cards">
          {list.slice(0, count).map((e) => (
            <Go key={e.sym.id} to={toFunction(index, e.sym)} className="fcard" aria-label={`${e.name}, called from ${plural(e.by.length, 'place')}, calls ${plural(e.out.length, 'function')}`}>
              <Mini e={e} />
              <footer>
                <span className="dot" style={{ background: DOTS[dirs.indexOf(e.dir) % DOTS.length] }} title={e.dir} />
                <span className="nm" title={e.name}>
                  {e.name !== e.sym.name && <i>{e.name.slice(0, -e.sym.name.length)}</i>}
                  {e.sym.name}
                </span>
                <span className="io">
                  {e.by.length} in · {e.out.length} out
                </span>
              </footer>
            </Go>
          ))}
        </div>
      ) : (
        <div className="plate">
          <p className="m-0">No function matches. {filtered ? 'Loosen the search or reset the filters.' : 'This index has no functions with a known extent; rebuild it with the current scripts/build-index.mjs.'}</p>
        </div>
      )}
      {count < list.length && (
        <button className="btn self-center px-5 py-2" onClick={() => setCount(count + PAGE)}>
          Show {Math.min(PAGE, list.length - count)} more
        </button>
      )}
    </>
  )
}
