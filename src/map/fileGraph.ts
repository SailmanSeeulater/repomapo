import { baseName, dirName, isTestPath } from '../data/index'
import type { Index } from '../types'

export interface FileGraph {
  /** uses[a]: b -> how many usages in file a point at symbols defined in file b. */
  uses: Map<number, number>[]
  /** usedBy[b]: a -> the same count, seen from the file being used. */
  usedBy: Map<number, number>[]
  /** Symbols defined in each file. */
  defs: number[]
  /** Usages of each file's symbols from other files. */
  inbound: number[]
}

/** File-to-file edges: a file uses another when it mentions a symbol defined there. */
export function buildFileGraph(index: Index): FileGraph {
  const n = index.files.length
  const g: FileGraph = { uses: Array.from({ length: n }, () => new Map()), usedBy: Array.from({ length: n }, () => new Map()), defs: Array(n).fill(0), inbound: Array(n).fill(0) }
  for (const s of index.syms) {
    const b = s.def.file
    g.defs[b]++
    for (const r of s.refs) {
      if (r.file === b) continue
      g.uses[r.file].set(b, (g.uses[r.file].get(b) ?? 0) + 1)
      g.usedBy[b].set(r.file, (g.usedBy[b].get(r.file) ?? 0) + 1)
      g.inbound[b]++
    }
  }
  return g
}

export interface Group {
  dir: string
  label: string
  test: boolean
  files: number[]
  x: number
  y: number
  h: number
  col: number
}

export const COLW = 224
export const ROW = 20
export const HEAD = 26
export const GAPX = 60
export const GAPY = 18
export const PADB = 6
/** Room on the right for edges that loop within one column. */
export const SIDE = 34

/**
 * One group per folder. Left to right, folders that mostly use others come first and folders that
 * are mostly used come last, so edges tend to run one way. Within a folder the most-used file is on top.
 */
export function groupFiles(index: Index, graph: FileGraph, showTests: boolean): Group[] {
  const by = new Map<string, Group & { out: number; in: number }>()
  index.files.forEach((f, i) => {
    if (!showTests && isTestPath(f.path)) return
    const dir = dirName(f.path)
    if (!by.has(dir)) by.set(dir, { dir, label: '', test: isTestPath(f.path), files: [], x: 0, y: 0, h: 0, col: 0, out: 0, in: 0 })
    by.get(dir)!.files.push(i)
  })
  const groups = [...by.values()]
  for (const g of groups) {
    const mine = new Set(g.files)
    for (const i of g.files) {
      for (const [b, n] of graph.uses[i]) if (!mine.has(b)) g.out += n
      for (const [a, n] of graph.usedBy[i]) if (!mine.has(a)) g.in += n
    }
    g.files.sort((a, b) => graph.inbound[b] - graph.inbound[a] || baseName(index.files[a].path).localeCompare(baseName(index.files[b].path)))
    g.label = (g.test ? 'test / ' : '') + (g.dir.slice(g.dir.lastIndexOf('/') + 1) || '(root)')
    g.h = HEAD + g.files.length * ROW + PADB
  }
  const lean = (g: { out: number; in: number }) => (g.in + 1) / (g.out + g.in + 2)
  return groups.sort((a, b) => lean(a) - lean(b) || a.dir.localeCompare(b.dir))
}

export interface Layout {
  height: number
  /** Row centre of each visible file. */
  pos: Map<number, { x: number; y: number }>
}

/** Places the groups in as many columns as fit, keeping their order. Mutates x, y and col on each group. */
export function layoutGroups(groups: Group[], width: number): Layout {
  const cols = Math.max(1, Math.floor((width - SIDE + GAPX) / (COLW + GAPX)))
  const total = groups.reduce((n, g) => n + g.h + GAPY, 0)
  const target = total / cols
  const step = cols > 1 ? Math.min(COLW + GAPX + 40, (width - SIDE - COLW) / (cols - 1)) : 0
  const pos = new Map<number, { x: number; y: number }>()
  let col = 0
  let y = 0
  let height = 0
  for (const g of groups) {
    if (y > 0 && y + g.h / 2 > target && col < cols - 1) {
      col++
      y = 0
    }
    g.col = col
    g.x = col * step
    g.y = y
    g.files.forEach((i, k) => pos.set(i, { x: g.x, y: y + HEAD + k * ROW + ROW / 2 }))
    y += g.h + GAPY
    height = Math.max(height, y)
  }
  return { height: Math.max(40, height), pos }
}

/** A curve between two rows or boxes, leaving from the side that faces the other end. */
export function edgePath(a: { x: number; y: number }, b: { x: number; y: number }): { d: string; ex: number; ey: number } {
  if (Math.abs(b.x - a.x) <= 1) {
    const x = a.x + COLW
    const bx = x + Math.min(SIDE - 6, 12 + Math.abs(a.y - b.y) * 0.12)
    return { d: `M${x},${a.y} C${bx},${a.y} ${bx},${b.y} ${x},${b.y}`, ex: x, ey: b.y }
  }
  const x1 = b.x > a.x ? a.x + COLW : a.x
  const x2 = b.x > a.x ? b.x : b.x + COLW
  const k = Math.max(24, Math.abs(x2 - x1) * 0.5) * Math.sign(x2 - x1)
  return { d: `M${x1},${a.y} C${x1 + k},${a.y} ${x2 - k},${b.y} ${x2},${b.y}`, ex: x2, ey: b.y }
}

/** The heaviest folder-to-folder flows, for the map at rest. */
export function topFlows(groups: Group[], graph: FileGraph, max: number): { from: Group; to: Group; n: number }[] {
  const of = new Map<number, number>()
  groups.forEach((g, gi) => g.files.forEach((i) => of.set(i, gi)))
  const flows = new Map<string, number>()
  groups.forEach((g, gi) => {
    for (const i of g.files)
      for (const [b, n] of graph.uses[i]) {
        const hi = of.get(b)
        if (hi == null || hi === gi) continue
        flows.set(gi + '>' + hi, (flows.get(gi + '>' + hi) ?? 0) + n)
      }
  })
  return [...flows]
    .sort((a, b) => b[1] - a[1])
    .slice(0, max)
    .map(([k, n]) => {
      const [a, b] = k.split('>').map(Number)
      return { from: groups[a], to: groups[b], n }
    })
}
