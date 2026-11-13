import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { isCallable, isType, qualifiedName } from '../data/callGraph'
import { baseName } from '../data/index'
import { Go, placeOf, toFunction, toThreads, useNav } from '../nav'
import type { Index, Link, Sym } from '../types'
import { CallPath } from './CallPath'
import { CodeBlock } from './CodeBlock'
import { describeSymbol, relations } from './describe'

const CARD = 54
const GAP = 6
const MAX_LINES = 140
const MIN_LINES = 14
const MAX_CALLERS = 8
const MAX_SITES = 3
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

function useWide(query: string) {
  const [wide, setWide] = useState(() => typeof matchMedia === 'function' && matchMedia(query).matches)
  useEffect(() => {
    const m = matchMedia(query)
    const on = () => setWide(m.matches)
    m.addEventListener('change', on)
    return () => m.removeEventListener('change', on)
  }, [query])
  return wide
}

interface Wire {
  key: string
  d: string
  x: number
  y: number
}

/** One symbol read like a case study: what the index says about it, then its callers, its code and its callees. */
export function FunctionPage({ index, sym }: { index: Index; sym: Sym }) {
  const nav = useNav()
  const wide = useWide('(min-width: 900px)')
  const { by, out, touched } = useMemo(() => relations(index, sym), [index, sym])
  const { headline, about } = useMemo(() => describeSymbol(index, sym), [index, sym])
  const fn = isCallable(sym)
  const file = sym.def.file
  const path = index.files[file].path

  // The lines shown: the whole definition, cut off when it is very long.
  const first = sym.body ? sym.body[0] : sym.def.line
  const last = sym.body ? sym.body[2] : sym.def.line
  const to = Math.min(last, first + MAX_LINES - 1)
  // A short function gets a few lines of its surroundings, so it does not float without context.
  const pad = Math.max(2, Math.ceil((MIN_LINES - (to - first + 1)) / 2))
  const shownFrom = Math.max(1, first - pad)
  const shownTo = to < last ? to : Math.min(index.files[file].lines.length, to + pad)

  const [allCallers, setAllCallers] = useState(false)
  const callers = useMemo(() => (allCallers ? by : by.slice(0, MAX_CALLERS)), [by, allCallers])
  // Callees in the order they are first called, so their cards line up with the code.
  const callees = useMemo(() => {
    const line = (l: Link) => Math.min(...l.at.map((a) => a.line))
    return [...out].sort((a, b) => line(a) - line(b))
  }, [out])

  const [hot, setHot] = useState<string | null>(null)
  const hotLines = useMemo(() => {
    const l = hot?.startsWith('out:') ? callees.find((c) => 'out:' + c.sym.id === hot) : null
    return l ? new Set(l.at.map((a) => a.line)) : undefined
  }, [hot, callees])

  const calleeIds = useMemo(() => new Set(out.map((l) => l.sym.id)), [out])
  const mark = useCallback((id: string, role: 'def' | 'ref') => (id === sym.id && role === 'def' ? 'me' : calleeIds.has(id) ? 'call' : ''), [sym, calleeIds])

  const onSymbol = (id: string) => {
    const s = index.byId.get(id)
    if (!s || s === sym) return
    nav.go(isCallable(s) || isType(s) ? toFunction(index, s) : toThreads(index, s))
  }

  // Where the cards sit and how the threads run. Measured from the rendered code rows.
  const stage = useRef<HTMLDivElement>(null)
  const [geo, setGeo] = useState<{ byTop: number[]; outTop: number[]; wires: Wire[]; height: number }>({ byTop: [], outTop: [], wires: [], height: 0 })
  const measure = useCallback(() => {
    const el = stage.current
    if (!el || !wide) return
    const box = el.getBoundingClientRect()
    const win = el.querySelector('.fn-win')!.getBoundingClientRect()
    const [left, right] = [...el.querySelectorAll('.fn-cards')].map((c) => c.getBoundingClientRect())
    const rowY = (line: number) => {
      const r = el.querySelector(`[data-line="${Math.min(Math.max(line, first), to)}"]`)?.getBoundingClientRect()
      return r ? r.top + r.height / 2 - box.top : 0
    }
    const colTop = left.top - box.top
    const wires: Wire[] = []
    const curve = (x1: number, y1: number, x2: number, y2: number) => {
      const k = (x2 - x1) * 0.5
      return `M${x1},${y1} C${x1 + k},${y1} ${x2 - k},${y2} ${x2},${y2}`
    }

    const defY = rowY(sym.def.line)
    const byTop = callers.map((_, i) => Math.max(0, defY - colTop - CARD / 2) + i * (CARD + GAP))
    callers.forEach((l, i) => {
      const y = colTop + byTop[i] + CARD / 2
      wires.push({ key: 'by:' + l.sym.id, d: curve(left.right - box.left + 4, y, win.left - box.left - 4, defY), x: win.left - box.left - 4, y: defY })
    })

    const outTop: number[] = []
    callees.forEach((l, i) => {
      const sites = [...new Set(l.at.map((a) => a.line))].filter((n) => n <= to).sort((a, b) => a - b)
      const want = (sites.length ? rowY(sites[0]) : rowY(to)) - colTop - CARD / 2
      const top = Math.max(want, i ? outTop[i - 1] + CARD + GAP : 0, 0)
      outTop.push(top)
      const y = colTop + top + CARD / 2
      for (const n of sites.slice(0, MAX_SITES)) wires.push({ key: 'out:' + l.sym.id, d: curve(win.right - box.left + 4, rowY(n), right.left - box.left - 4, y), x: win.right - box.left + 4, y: rowY(n) })
    })
    const more = by.length > callers.length || allCallers ? 30 : 0
    const height = Math.max(byTop.length ? byTop[byTop.length - 1] + CARD + more : 0, outTop.length ? outTop[outTop.length - 1] + CARD : 0)
    const next = { byTop, outTop, wires, height }
    // only re-render when something moved, or measuring would chase its own tail
    setGeo((old) => (JSON.stringify(old) === JSON.stringify(next) ? old : next))
  }, [wide, callers, callees, by.length, allCallers, first, to, sym])

  useLayoutEffect(() => {
    measure()
    const el = stage.current
    if (!el) return
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    document.fonts?.ready.then(measure)
    return () => ro.disconnect()
  }, [measure])

  const card = (l: Link, key: string, top: number | undefined) => (
    <Go key={key} to={toFunction(index, l.sym)} className="fn-card" style={wide ? { top } : undefined} onMouseEnter={() => setHot(key)} onMouseLeave={() => setHot(null)} onFocus={() => setHot(key)} onBlur={() => setHot(null)}>
      <span className="nm">
        {qualifiedName(index, l.sym) !== l.sym.name && <i>{qualifiedName(index, l.sym).slice(0, -l.sym.name.length)}</i>}
        {l.sym.name}
      </span>
      <span className="at">
        {baseName(index.files[l.at[0].file].path)}:{l.at[0].line}
        {l.at.length > 1 ? ` and ${l.at.length - 1} more` : ''}
      </span>
      {l.at.length > 1 && <span className="n">{l.at.length}×</span>}
    </Go>
  )

  const colHeight = wide ? { height: geo.height } : undefined
  return (
    <>
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="chip">{sym.kind}</span>
        <span className="chip">{qualifiedName(index, sym)}</span>
        <span className="chip font-mono text-[12px]" title={`${path}:${sym.def.line}`}>
          <span className="truncate">
            {path}:{sym.def.line}
          </span>
        </span>
      </div>
      <h1 className="display">{headline}</h1>

      <div className="fn-layout">
        <nav className="fn-toc" aria-label="On this page">
          <h2>About this {fn ? 'function' : sym.kind}</h2>
          <p>{about.join(' ')}</p>
          <a href="#code">
            {fn ? 'Called by' : 'Used by'} <span>{by.length}</span>
          </a>
          {fn && (
            <a href="#code">
              Calls <span>{out.length}</span>
            </a>
          )}
          <a href="#touches">
            Touches <span>{touched.length}</span>
          </a>
          <a href="#path">Call path</a>
          <Go to={toThreads(index, sym)}>Every usage, as threads</Go>
          {isCallable(sym) && <Go to={{ view: 'space', fn: placeOf(index, sym), orbit: true }}>Its orbit, on the board</Go>}
          {isCallable(sym) && out.length > 0 && <Go to={{ view: 'space', fn: placeOf(index, sym), flow: true }}>What it sets off, step by step</Go>}
        </nav>

        <div className="flex min-w-0 flex-col gap-9">
          <div id="code" ref={stage} className={`plate fn-stage${wide ? '' : ' narrow'}`}>
            <section className="fn-col" aria-label={fn ? 'Called by' : 'Used by'}>
              <span className="label">{fn ? 'Called by' : 'Used by'}</span>
              <div className="fn-cards relative" style={colHeight}>
                {callers.map((l, i) => card(l, 'by:' + l.sym.id, geo.byTop[i]))}
                {by.length > MAX_CALLERS && (
                  <button className="fn-more" style={wide ? { top: (geo.byTop[callers.length - 1] ?? 0) + CARD + 4 } : undefined} onClick={() => setAllCallers(!allCallers)}>
                    {allCallers ? `Show the first ${MAX_CALLERS}` : `Show all ${by.length}`}
                  </button>
                )}
                {!by.length && <p className="fn-none">{fn ? 'No caller in this repo.' : 'Not used in this repo.'}</p>}
              </div>
            </section>

            <div className="fn-win">
              <div className="fn-bar">
                <i />
                <i />
                <i />
                <span title={path}>{path}</span>
                <Go to={{ view: 'threads', files: [path], at: `${path}:${sym.def.line}` }}>Open the file</Go>
              </div>
              <CodeBlock index={index} file={file} from={shownFrom} to={shownTo} body={[first, to]} hot={hotLines} mark={mark} onSymbol={onSymbol} />
              {to < last && <p className="m-0 px-[14px] pt-3 text-[12px] text-muted">{plural(last - to, 'more line')} not shown.</p>}
            </div>

            <section className="fn-col" aria-label="Calls">
              <span className="label">{fn ? 'Calls' : 'Calls made inside it'}</span>
              <div className="fn-cards relative" style={colHeight}>
                {callees.map((l, i) => card(l, 'out:' + l.sym.id, geo.outTop[i]))}
                {!callees.length && <p className="fn-none">Calls nothing else in this repo.</p>}
              </div>
            </section>

            {wide && (
              <svg className="fn-wires" aria-hidden="true">
                {geo.wires.map((w, i) => (
                  <g key={i} className={hot && hot !== w.key ? 'dim' : ''}>
                    <path d={w.d} />
                    <circle cx={w.x} cy={w.y} r="2.5" />
                  </g>
                ))}
              </svg>
            )}
          </div>

          <section id="touches" className="flex flex-col gap-3">
            <h2 className="m-0 text-[13px] font-normal text-muted">Touches: the types, fields and constants it reads or names</h2>
            {touched.length ? (
              <div className="flex flex-wrap gap-1.5">
                {touched.map((l) => (
                  <Go key={l.sym.id} to={isType(l.sym) ? toFunction(index, l.sym) : toThreads(index, l.sym)} className="chip no-underline hover:bg-sunk">
                    <b className="font-semibold">{l.sym.name}</b>
                    <span className="text-muted">
                      {l.sym.kind}
                      {l.at.length > 1 ? `, ${l.at.length}×` : ''}
                    </span>
                  </Go>
                ))}
              </div>
            ) : (
              <p className="fn-none">Nothing but its own parameters and locals.</p>
            )}
          </section>

          <section id="path" className="flex flex-col gap-4">
            <h2 className="m-0 text-[13px] font-normal text-muted">Call path: one step back, two steps on</h2>
            <CallPath index={index} sym={sym} />
          </section>
        </div>
      </div>
    </>
  )
}
