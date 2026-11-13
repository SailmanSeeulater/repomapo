import { calls, usedBy } from '../data/callGraph'
import type { Index, Sym } from '../types'

export interface Level {
  /** -1: callers. 0: the symbol. 1: what it calls. 2: what those call. */
  depth: number
  syms: Sym[]
  /** How many more belong on this level than are shown. */
  more: number
}

export interface Hood {
  levels: Level[]
  /** Calls between symbols that are both shown, as [caller id, callee id]. */
  edges: [string, string][]
}

/** The symbols one call upstream and up to two calls downstream of a symbol, most connected first. */
export function neighborhood(index: Index, sym: Sym, per = 6): Hood {
  const placed = new Set<string>([sym.id])
  const take = (all: Sym[], depth: number): Level => {
    const fresh = all.filter((s) => !placed.has(s.id) && (placed.add(s.id), true))
    const syms = fresh.slice(0, per)
    for (const s of fresh.slice(per)) placed.delete(s.id)
    return { depth, syms, more: fresh.length - syms.length }
  }
  const callers = take(usedBy(index, sym).map((l) => l.sym), -1)
  const first = take(calls(index, sym).map((l) => l.sym), 1)
  const second = take(first.syms.flatMap((s) => calls(index, s).map((l) => l.sym)), 2)
  const levels = [callers, { depth: 0, syms: [sym], more: 0 }, first, second].filter((l) => l.syms.length)

  const edges: [string, string][] = []
  const shown = new Set(levels.flatMap((l) => l.syms.map((s) => s.id)))
  for (const l of levels)
    for (const s of l.syms)
      for (const c of calls(index, s)) {
        const to = levels.find((x) => x.syms.includes(c.sym))
        if (shown.has(c.sym.id) && to && to.depth === l.depth + 1) edges.push([s.id, c.sym.id])
      }
  // a caller that is a type (a field initialiser, say) uses the symbol without calling it
  for (const s of callers.syms) if (!edges.some(([a, b]) => a === s.id && b === sym.id)) edges.push([s.id, sym.id])
  return { levels, edges }
}
