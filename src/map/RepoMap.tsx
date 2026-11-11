import { useEffect, useMemo, useRef, useState, type MouseEvent } from 'react'
import { baseName, dirName, findFile } from '../data/index'
import type { Index } from '../types'
import { COLW, ROW, buildFileGraph, edgePath, groupFiles, layoutGroups, topFlows } from './fileGraph'

const MAX_FLOWS = 28
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

function useWidth() {
  const ref = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)
  useEffect(() => {
    const el = ref.current!
    setWidth(el.clientWidth)
    const ro = new ResizeObserver(() => setWidth(el.clientWidth))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return [ref, width] as const
}

/**
 * Every file in the index, grouped by folder. Hovering a file shows what it uses and what uses it;
 * clicking it opens it in the thread view.
 */
export function RepoMap({ index, focus, hrefFor, onOpen, onPin }: { index: Index; focus: string | null; hrefFor(path: string): string; onOpen(path: string): void; onPin(path: string | null): void }) {
  const [ref, width] = useWidth()
  const [hover, setHover] = useState<number | null>(null)
  const [pin, setPin] = useState<number | null>(() => (focus ? findFile(index, focus) : -1))
  const [tests, setTests] = useState(true)
  const [find, setFind] = useState('')
  const svgRef = useRef<SVGSVGElement>(null)

  const graph = useMemo(() => buildFileGraph(index), [index])
  const { groups, layout } = useMemo(() => {
    const groups = groupFiles(index, graph, tests)
    return { groups, layout: layoutGroups(groups, width) }
  }, [index, graph, tests, width])
  const flows = useMemo(() => (width ? topFlows(groups, graph, MAX_FLOWS) : []), [groups, graph, width])
  const maxIn = Math.max(1, ...graph.inbound)
  const chars = Math.floor((COLW - 58) / 7.25)
  const needle = find.trim().toLowerCase()

  const candidate = hover ?? (pin != null && pin >= 0 ? pin : null)
  const shown = candidate != null && layout.pos.has(candidate) ? candidate : null

  // Bring a file pinned by the link into view once the map has a width.
  const scrolled = useRef(false)
  useEffect(() => {
    if (scrolled.current || !width || pin == null || pin < 0) return
    scrolled.current = true
    svgRef.current?.querySelector(`[data-file="${pin}"]`)?.scrollIntoView({ block: 'center' })
  }, [width, pin])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      setPin(null)
      onPin(null)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onPin])

  const pinFirstMatch = () => {
    const hit = index.files.findIndex((f, i) => layout.pos.has(i) && f.path.toLowerCase().includes(needle))
    if (!needle || hit < 0) return
    setPin(hit)
    onPin(index.files[hit].path)
    svgRef.current?.querySelector(`[data-file="${hit}"]`)?.scrollIntoView({ block: 'center' })
  }

  const click = (e: MouseEvent, i: number) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return // let the browser open a new tab
    e.preventDefault()
    onOpen(index.files[i].path)
  }

  const edges = []
  if (shown != null) {
    const a = layout.pos.get(shown)!
    const maxOut = Math.max(1, ...graph.uses[shown].values())
    const maxBy = Math.max(1, ...graph.usedBy[shown].values())
    for (const [b, n] of graph.usedBy[shown]) {
      const from = layout.pos.get(b)
      if (!from) continue
      const c = edgePath(from, a)
      edges.push(
        <g key={'in' + b}>
          <path d={c.d} fill="none" stroke="var(--thread)" strokeWidth={1 + (1.8 * n) / maxBy} strokeOpacity="0.85" strokeLinecap="round" />
          <circle cx={c.ex} cy={c.ey} r="2.8" fill="var(--thread)" />
        </g>,
      )
    }
    for (const [b, n] of graph.uses[shown]) {
      const to = layout.pos.get(b)
      if (!to) continue
      const c = edgePath(a, to)
      edges.push(
        <g key={'out' + b}>
          <path d={c.d} fill="none" stroke="var(--pin0)" strokeWidth={1 + (1.8 * n) / maxOut} strokeOpacity="0.85" strokeLinecap="round" />
          <circle cx={c.ex} cy={c.ey} r="2.8" fill="var(--pin0)" />
        </g>,
      )
    }
  }

  const path = shown != null ? index.files[shown].path : ''
  return (
    <>
      <p className="m-0 max-w-[68ch] text-muted">Every file in the index, grouped by folder. Hover a file to see which files it uses and which use it. Click it to open it in the thread view.</p>
      <section aria-label="Selected file" className="flex flex-col gap-2.5 rounded-md border border-rule bg-panel px-3.5 py-3">
        <div className="flex min-h-[44px] flex-wrap items-baseline gap-x-2.5 gap-y-1.5">
            {shown == null ? (
              <span className="text-[13px] text-muted">Hover a file to see what it uses and what uses it. Click to open it in the thread view.</span>
            ) : (
              <>
                <span className="text-[13px] text-muted">{hover == null ? 'pinned file' : 'file'}</span>
                <span className="font-mono text-[15px] font-bold [overflow-wrap:anywhere]">{baseName(path)}</span>
                <span className="text-[13px] text-muted">
                  {dirName(path)} · defines {plural(graph.defs[shown], 'symbol')}, uses {plural(graph.uses[shown].size, 'file')}, used by {plural(graph.usedBy[shown].size, 'file')} ({plural(graph.inbound[shown], 'usage')}). Numbers on the rows count usages.
                </span>
              </>
            )}
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2.5 text-[13px]">
            <input
              type="search"
              value={find}
              onChange={(e) => setFind(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && pinFirstMatch()}
              placeholder="Find a file"
              aria-label="Find a file"
              className="w-[200px] max-w-full rounded border border-rule bg-sunk px-2 py-1 text-ink"
            />
            <label className="inline-flex cursor-pointer items-center gap-2">
              <input type="checkbox" className="m-0 size-[15px] accent-thread" checked={tests} onChange={(e) => setTests(e.target.checked)} /> Show test files
            </label>
          </div>
        <div className="flex flex-wrap gap-x-5 gap-y-1.5 border-t border-rule pt-2.5 text-[13px] text-muted">
          <span>
            <svg width="26" height="12" className="mr-1.5 inline align-[-1px]">
              <line x1="1" y1="6" x2="20" y2="6" stroke="var(--pin0)" strokeWidth="1.6" />
              <circle cx="21" cy="6" r="3" fill="var(--pin0)" />
            </svg>
            uses (symbols defined in that file)
          </span>
          <span>
            <svg width="26" height="12" className="mr-1.5 inline align-[-1px]">
              <line x1="1" y1="6" x2="20" y2="6" stroke="var(--thread)" strokeWidth="1.6" />
              <circle cx="21" cy="6" r="3" fill="var(--thread)" />
            </svg>
            used by
          </span>
          <span>
            <svg width="26" height="12" className="mr-1.5 inline align-[-1px]">
              <rect x="1" y="2" width="24" height="8" fill="var(--muted)" opacity="0.3" />
            </svg>
            bar length: how much the rest of the repo uses the file
          </span>
          <span>
            <svg width="26" height="12" className="mr-1.5 inline align-[-1px]">
              <line x1="1" y1="6" x2="25" y2="6" stroke="var(--muted)" strokeWidth="3" opacity="0.4" />
            </svg>
            heaviest folder-to-folder flows
          </span>
          <span>Esc clears a pinned file</span>
        </div>
      </section>

      <div ref={ref}>
        {width > 0 && (
          <svg ref={svgRef} role="group" aria-label="Files by folder" width="100%" height={layout.height} viewBox={`0 0 ${width} ${layout.height}`} className="block overflow-visible" onMouseLeave={() => setHover(null)}>
            {shown == null && (
              <g pointerEvents="none">
                {flows.map((f, i) => (
                  <path key={i} d={edgePath({ x: f.from.x, y: f.from.y + 13 }, { x: f.to.x, y: f.to.y + 13 }).d} fill="none" stroke="var(--muted)" strokeWidth={1 + (3 * f.n) / flows[0].n} strokeOpacity="0.3" />
                ))}
              </g>
            )}
            {groups.map((g) => (
              <g key={g.dir}>
                <rect x={g.x} y={g.y} width={COLW} height={g.h} rx="6" fill="var(--surface)" stroke="var(--rule)" />
                <text x={g.x + 10} y={g.y + 17} className="fill-muted font-mono text-[11px]">
                  <title>{g.dir}</title>
                  {g.label}
                </text>
                {g.files.map((i) => {
                  const p = layout.pos.get(i)!
                  const file = index.files[i].path
                  const name = baseName(file).replace(/\.[A-Za-z]+$/, '')
                  const out = shown != null ? graph.uses[shown].get(i) : undefined
                  const by = shown != null ? graph.usedBy[shown].get(i) : undefined
                  const self = i === shown
                  const related = self || out != null || by != null
                  const match = !!needle && file.toLowerCase().includes(needle)
                  return (
                    <a
                      key={i}
                      href={hrefFor(file)}
                      data-file={i}
                      onClick={(e) => click(e, i)}
                      onMouseEnter={() => setHover(i)}
                      onFocus={() => setHover(i)}
                      onBlur={() => setHover(null)}
                      aria-label={`${file}, uses ${plural(graph.uses[i].size, 'file')}, used by ${plural(graph.usedBy[i].size, 'file')}. Opens in the thread view.`}
                      className="group cursor-pointer outline-none transition-opacity duration-100"
                      style={{ opacity: shown != null && !related ? 0.32 : 1 }}
                    >
                      <rect x={p.x + 1} y={p.y - ROW / 2} width={COLW - 2} height={ROW} fill={self ? 'var(--ink)' : match ? 'color-mix(in srgb, var(--pin1) 22%, transparent)' : 'transparent'} className={self ? '' : 'group-hover:fill-sunk group-focus:fill-sunk'} />
                      {!self && <rect x={p.x + 1} y={p.y - ROW / 2 + 3} width={Math.sqrt(graph.inbound[i] / maxIn) * (COLW - 2)} height={ROW - 6} fill="var(--muted)" opacity="0.16" />}
                      <text x={p.x + 10} y={p.y + 4} fill={self ? 'var(--surface)' : 'var(--ink)'} fontWeight={self ? 700 : 400} className="font-mono text-xs">
                        {name.length > chars ? name.slice(0, chars - 1) + '…' : name}
                      </text>
                      <text x={p.x + COLW - 8} y={p.y + 4} textAnchor="end" fontWeight="700" fill={out != null && by != null ? 'var(--ink)' : out != null ? 'var(--pin0)' : 'var(--thread)'} className="font-mono text-[11px] tabular-nums">
                        {out != null && by != null ? `${out} / ${by}` : (out ?? by ?? '')}
                      </text>
                    </a>
                  )
                })}
              </g>
            ))}
            <g pointerEvents="none">{edges}</g>
          </svg>
        )}
      </div>
    </>
  )
}
