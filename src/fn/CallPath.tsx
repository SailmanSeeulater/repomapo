import { useMemo } from 'react'
import { isType } from '../data/callGraph'
import { Go, toFunction } from '../nav'
import type { Index, Sym } from '../types'
import { neighborhood } from './neighborhood'

const W = 172
const H = 46
const GX = 84
const GY = 12
const TOP = 30
const TITLES: Record<number, string> = { [-1]: 'calls it', 0: 'this one', 1: 'it calls', 2: 'which call' }

/** The type a symbol is declared in, for the small line above its name. */
function ownerOf(index: Index, s: Sym): string {
  let p = index.graph.parent.get(s.id)
  while (p && !isType(p)) p = index.graph.parent.get(p.id)
  return p ? p.name : index.files[s.def.file].path.split('/').pop()!
}

const clip = (t: string, n: number) => (t.length > n ? t.slice(0, n - 1) + '…' : t)

/** Callers on the left, the symbol, then what it calls and what those call, one column per step. */
export function CallPath({ index, sym }: { index: Index; sym: Sym }) {
  const { boxes, paths, width, height, cols } = useMemo(() => {
    const hood = neighborhood(index, sym)
    const rows = Math.max(...hood.levels.map((l) => l.syms.length + (l.more ? 1 : 0)))
    const height = TOP + rows * (H + GY)
    const at = new Map<string, { x: number; y: number }>()
    const boxes: { s: Sym; x: number; y: number }[] = []
    const cols: { x: number; title: string; more: number; bottom: number }[] = []
    hood.levels.forEach((l, c) => {
      const x = c * (W + GX)
      const y0 = TOP + ((rows - l.syms.length - (l.more ? 1 : 0)) * (H + GY)) / 2
      l.syms.forEach((s, i) => {
        const y = y0 + i * (H + GY)
        at.set(s.id, { x, y })
        boxes.push({ s, x, y })
      })
      cols.push({ x, title: TITLES[l.depth], more: l.more, bottom: y0 + l.syms.length * (H + GY) })
    })
    const paths = hood.edges.map(([a, b]) => {
      const p = at.get(a)!
      const q = at.get(b)!
      const x1 = p.x + W
      const mid = x1 + GX / 2
      return `M${x1},${p.y + H / 2} H${mid} V${q.y + H / 2} H${q.x}`
    })
    return { boxes, paths, width: hood.levels.length * (W + GX) - GX, height, cols }
  }, [index, sym])

  return (
    <div className="overflow-x-auto pb-1">
      <svg className="cpath" width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="group" aria-label={`Calls around ${sym.name}`}>
        {cols.map((c, i) => (
          <g key={i}>
            <text className="col" x={c.x} y={12}>
              {c.title}
            </text>
            {i > 0 && <line className="guide" x1={c.x - GX / 2} y1={0} x2={c.x - GX / 2} y2={height} />}
            {c.more > 0 && (
              <text className="col" x={c.x} y={c.bottom + 16}>
                and {c.more} more
              </text>
            )}
          </g>
        ))}
        {paths.map((d, i) => (
          <path key={i} d={d} />
        ))}
        {boxes.map(({ s, x, y }) => {
          const inner = (
            <>
              <rect x={x} y={y} width={W} height={H} />
              <text className="own" x={x + 12} y={y + 18}>
                {clip(ownerOf(index, s), 24)}
              </text>
              <text x={x + 12} y={y + 35}>
                {clip(s.name, 21)}
              </text>
            </>
          )
          return s === sym ? (
            <g key={s.id} className="me">
              {inner}
            </g>
          ) : (
            <Go key={s.id} to={toFunction(index, s)} aria-label={`${ownerOf(index, s)}.${s.name}`}>
              {inner}
            </Go>
          )
        })}
      </svg>
    </div>
  )
}
