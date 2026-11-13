import { calls, isCallable, qualifiedName } from '../data/callGraph'
import { dirName, isTestPath } from '../data/index'
import type { Index, Sym } from '../types'

/** One function on the board. `ins` and `outs` are indexes into the model's nodes. */
export interface SNode {
  i: number
  sym: Sym
  name: string
  qname: string
  file: number
  dir: number
  test: boolean
  /** The functions that call it. */
  ins: number[]
  /** The functions it calls, most called first. */
  outs: number[]
  /** Drawn radius: grows with the number of callers. */
  r: number
}

export interface Dir {
  path: string
  /** A short name that still tells it apart from the other folders. */
  label: string
  count: number
  test: boolean
}

export interface Model {
  nodes: SNode[]
  byId: Map<string, SNode>
  dirs: Dir[]
}

export interface Pt {
  x: number
  y: number
}

/** A circle on the board that stands for a file or a folder. */
export interface Body extends Pt {
  key: number
  label: string
  r: number
  dir: number
}

/**
 * Short names for folders: the last part of each path, with as many parts before it as it takes
 * to tell two folders apart. Test folders are named among themselves and marked as tests.
 */
export function dirLabels(paths: string[]): string[] {
  const labels = paths.map(() => '')
  const name = (group: number[]) => {
    const parts = group.map((i) => paths[i].split('/').filter(Boolean))
    const take = group.map(() => 1)
    const label = (g: number) => parts[g].slice(-take[g]).join('/') || 'top folder'
    for (let again = true; again; ) {
      again = false
      const seen = new Map<string, number[]>()
      group.forEach((_, g) => (seen.get(label(g)) ?? seen.set(label(g), []).get(label(g))!).push(g))
      for (const same of seen.values())
        if (same.length > 1)
          for (const g of same)
            if (take[g] < parts[g].length) {
              take[g]++
              again = true
            }
    }
    group.forEach((i, g) => (labels[i] = label(g)))
  }
  const tests = paths.map((p) => isTestPath(p + '/'))
  name(paths.map((_, i) => i).filter((i) => !tests[i]))
  name(paths.map((_, i) => i).filter((i) => tests[i]))
  return labels.map((l, i) => (tests[i] ? `${l} (tests)` : l))
}

/** Every function in the index as a node, with the calls between them. */
export function buildModel(index: Index): Model {
  const syms = index.syms.filter(isCallable)
  const paths = [...new Set(syms.map((s) => dirName(index.files[s.def.file].path)))].sort()
  const labels = dirLabels(paths)
  const dirs: Dir[] = paths.map((path, i) => ({ path, label: labels[i], count: 0, test: isTestPath(path + '/') }))
  const dirOf = new Map(paths.map((p, i) => [p, i]))
  const nodes: SNode[] = syms.map((sym, i) => {
    const path = index.files[sym.def.file].path
    const dir = dirOf.get(dirName(path))!
    dirs[dir].count++
    return { i, sym, name: sym.name, qname: qualifiedName(index, sym), file: sym.def.file, dir, test: isTestPath(path), ins: [], outs: [], r: 0 }
  })
  const byId = new Map(nodes.map((n) => [n.sym.id, n]))
  for (const n of nodes)
    for (const l of calls(index, n.sym)) {
      const to = byId.get(l.sym.id)
      if (!to || to === n) continue
      n.outs.push(to.i)
      to.ins.push(n.i)
    }
  for (const n of nodes) n.r = 3.5 + Math.min(9, Math.sqrt(n.ins.length) * 1.6)
  return { nodes, byId, dirs }
}

const GOLDEN = Math.PI * (3 - Math.sqrt(5))

/**
 * Places circles so none overlap, biggest first, each at the first free spot on a sunflower spiral
 * out from the middle. The result is a little wider than tall, like the screens it is shown on.
 */
export function pack(radii: number[], gap = 0): Pt[] {
  const order = radii.map((_, i) => i).sort((a, b) => radii[b] - radii[a] || a - b)
  const out: Pt[] = new Array(radii.length)
  const placed: number[] = []
  for (const i of order) {
    const r = radii[i]
    const step = Math.max(r * 0.5, 4)
    for (let k = 0; ; k++) {
      const d = step * Math.sqrt(k)
      const x = d * Math.cos(k * GOLDEN) * 1.3
      const y = d * Math.sin(k * GOLDEN)
      if (placed.every((j) => Math.hypot(out[j].x - x, out[j].y - y) >= radii[j] + r + gap)) {
        out[i] = { x, y }
        placed.push(i)
        break
      }
    }
  }
  return out
}

/** The middle and radius of a circle around a set of circles. */
function enclose(items: (Pt & { r: number })[], pad: number): Pt & { r: number } {
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity
  for (const c of items) {
    x0 = Math.min(x0, c.x - c.r)
    x1 = Math.max(x1, c.x + c.r)
    y0 = Math.min(y0, c.y - c.r)
    y1 = Math.max(y1, c.y + c.r)
  }
  const x = (x0 + x1) / 2
  const y = (y0 + y1) / 2
  return { x, y, r: Math.max(...items.map((c) => Math.hypot(c.x - x, c.y - y) + c.r)) + pad }
}

export interface Systems {
  pos: Map<number, Pt>
  files: Body[]
  dirs: Body[]
}

const RING0 = 30
const RING = 26
const SPACING = 27

/**
 * The whole repo as systems: a folder is a region, a file is a sun, and the file's functions
 * orbit it on rings, the most called on the inside. Nothing here moves on its own: the same
 * index always gives the same board.
 */
export function systems(model: Model, include: (n: SNode) => boolean, fileLabel: (file: number) => string): Systems {
  const byFile = new Map<number, SNode[]>()
  for (const n of model.nodes) if (include(n)) (byFile.get(n.file) ?? byFile.set(n.file, []).get(n.file)!).push(n)

  // each file around its own middle
  const local = new Map<number, { r: number; at: Map<number, Pt>; dir: number }>()
  for (const [file, list] of byFile) {
    list.sort((a, b) => b.ins.length - a.ins.length || b.outs.length - a.outs.length || a.i - b.i)
    const at = new Map<number, Pt>()
    let ring = 0
    for (let done = 0; done < list.length; ring++) {
      const R = RING0 + ring * RING
      const room = Math.max(1, Math.floor((2 * Math.PI * R) / SPACING))
      const n = Math.min(room, list.length - done)
      for (let k = 0; k < n; k++) {
        const a = (k / n) * 2 * Math.PI - Math.PI / 2 + ring * 0.6
        at.set(list[done + k].i, { x: R * Math.cos(a), y: R * Math.sin(a) })
      }
      done += n
    }
    local.set(file, { r: RING0 + (ring - 1) * RING + 20, at, dir: list[0].dir })
  }

  // files packed inside their folder, folders packed on the board
  const inDir = new Map<number, number[]>()
  for (const [file, f] of local) (inDir.get(f.dir) ?? inDir.set(f.dir, []).get(f.dir)!).push(file)
  const groups = [...inDir].sort((a, b) => a[0] - b[0]).map(([dir, files]) => {
    files.sort((a, b) => a - b)
    const spots = pack(files.map((f) => local.get(f)!.r), 30)
    const circles = files.map((f, i) => ({ file: f, x: spots[i].x, y: spots[i].y, r: local.get(f)!.r }))
    return { dir, circles, around: enclose(circles, 44) }
  })
  const spots = pack(groups.map((g) => g.around.r), 70)

  const pos = new Map<number, Pt>()
  const files: Body[] = []
  const dirs: Body[] = []
  groups.forEach((g, gi) => {
    const dx = spots[gi].x - g.around.x
    const dy = spots[gi].y - g.around.y
    dirs.push({ key: g.dir, label: model.dirs[g.dir].label, x: spots[gi].x, y: spots[gi].y, r: g.around.r, dir: g.dir })
    for (const c of g.circles) {
      files.push({ key: c.file, label: fileLabel(c.file), x: c.x + dx, y: c.y + dy, r: c.r, dir: g.dir })
      for (const [i, p] of local.get(c.file)!.at) pos.set(i, { x: c.x + dx + p.x, y: c.y + dy + p.y })
    }
  })
  return { pos, files, dirs }
}

export interface Orbit {
  pos: Map<number, Pt>
  /** Calls drawn in the picture: `a` calls `b`. `side` says which half of the picture it is in. */
  links: { a: number; b: number; side: 'in' | 'out' }[]
  /** The radius of each orbit, nearest first. */
  rings: number[]
  /** Callers and callees left out because a function has more than `per` of them. */
  more: number
}

const HALF = (75 * Math.PI) / 180

/**
 * One function as the sun. What it calls sits on orbits to its right, one orbit per call away;
 * what calls it sits on orbits to its left. A function is drawn once, on the nearest orbit it
 * belongs to, and each function shows at most `per` of its own callers or callees.
 */
export function orbit(model: Model, centre: number, depth = 2, per = 10): Orbit {
  const seen = new Set([centre])
  const grow = (next: (n: SNode) => number[]) => {
    const kids = new Map<number, number[]>()
    const levels: number[][] = []
    let more = 0
    let level = [centre]
    for (let d = 0; d < depth; d++) {
      const nextLevel: number[] = []
      for (const p of level) {
        const fresh = next(model.nodes[p]).filter((c) => !seen.has(c))
        const take = fresh.slice(0, per)
        more += fresh.length - take.length
        for (const c of take) seen.add(c)
        kids.set(p, take)
        nextLevel.push(...take)
      }
      levels.push(nextLevel)
      level = nextLevel
    }
    return { kids, levels, more }
  }
  const out = grow((n) => n.outs)
  // the callers that are most called themselves first: they are the ones a reader knows
  const into = grow((n) => [...n.ins].sort((a, b) => Number(model.nodes[a].test) - Number(model.nodes[b].test) || model.nodes[b].ins.length - model.nodes[a].ins.length || a - b))

  const rings: number[] = []
  for (let d = 0; d < depth; d++) {
    const most = Math.max(out.levels[d].length, into.levels[d].length)
    if (!most) break
    rings.push(Math.max((rings[d - 1] ?? 0) + 200, (most * 36) / (2 * HALF)))
  }

  const pos = new Map<number, Pt>([[centre, { x: 0, y: 0 }]])
  const links: Orbit['links'] = []
  const lay = (tree: ReturnType<typeof grow>, side: 'in' | 'out') => {
    const weight = (n: number): number => Math.max(1, (tree.kids.get(n) ?? []).reduce((s, c) => s + weight(c), 0))
    const place = (n: number, a0: number, a1: number, d: number) => {
      const kids = tree.kids.get(n) ?? []
      const total = kids.reduce((s, c) => s + weight(c), 0)
      let a = a0
      for (const c of kids) {
        const span = ((a1 - a0) * weight(c)) / total
        const mid = a + span / 2
        pos.set(c, { x: (side === 'out' ? 1 : -1) * rings[d] * Math.cos(mid), y: rings[d] * Math.sin(mid) })
        links.push(side === 'out' ? { a: n, b: c, side } : { a: c, b: n, side })
        place(c, a, a + span, d + 1)
        a += span
      }
    }
    place(centre, -HALF, HALF, 0)
  }
  lay(out, 'out')
  lay(into, 'in')
  return { pos, links, rings, more: out.more + into.more }
}
