import type { CallGraph, Index, Link, Pos, Sym } from '../types'

const CALLABLE = new Set(['method', 'function', 'constructor', 'extension', 'getter', 'setter', 'accessor'])
const TYPE = new Set(['class', 'interface', 'object', 'enum', 'struct', 'trait'])

export const isCallable = (s: Sym) => CALLABLE.has(s.kind)
export const isType = (s: Sym) => TYPE.has(s.kind)

/** Whether a position sits inside a symbol's definition (same file, within its extent). */
export function inside(o: { file: number; line: number; col: number }, s: Sym): boolean {
  const b = s.body
  if (!b || o.file !== s.def.file) return false
  if (o.line < b[0] || o.line > b[2]) return false
  if (o.line === b[0] && o.col < b[1]) return false
  return !(o.line === b[2] && o.col >= b[3])
}

const span = (s: Sym) => (s.body![2] - s.body![0]) * 1e6 + (s.body![3] - s.body![1])

/**
 * Who uses what. Each usage belongs to the innermost function it sits in, or to the type when it
 * sits in none (a field's type, a supertype). Usages outside any definition (imports) make no edge,
 * and neither does a function using its own parameters and locals.
 */
export function buildCallGraph(syms: Sym[], fileCount: number): CallGraph {
  // Per file: the definitions a usage can belong to, smallest first, so the first hit is the innermost.
  const owners: Sym[][] = Array.from({ length: fileCount }, () => [])
  for (const s of syms) if (s.body && (isCallable(s) || isType(s))) owners[s.def.file].push(s)
  for (const list of owners) list.sort((a, b) => span(a) - span(b))
  const ownerOf = (o: Pos, not?: Sym) => owners[o.file]?.find((s) => s !== not && inside(o, s)) ?? null

  const parent = new Map<string, Sym>()
  for (const s of syms) {
    const p = ownerOf(s.def, s)
    if (p) parent.set(s.id, p)
  }

  const pairs = new Map<string, Map<string, Link>>() // from -> to -> usages
  const back = new Map<string, Map<string, Link>>()
  const add = (table: Map<string, Map<string, Link>>, key: string, other: Sym, at: Pos, impl = false) => {
    let row = table.get(key)
    if (!row) table.set(key, (row = new Map()))
    const link = row.get(other.id)
    if (link) link.at.push(at)
    else row.set(other.id, impl ? { sym: other, at: [at], impl } : { sym: other, at: [at] })
  }
  let edges = 0
  for (const target of syms)
    for (const r of target.refs) {
      const from = ownerOf(r)
      if (!from) continue
      if (from !== target && inside(target.def, from) && !isCallable(target) && !isType(target)) continue // its own parameter, local or field
      if (!pairs.get(from.id)?.has(target.id)) edges++
      add(pairs, from.id, target, r)
      add(back, target.id, from, r)
    }

  // A call to an interface's method ends at the interface. An edge from that method to each method
  // that carries it out lets a path go on into the code that runs.
  const byScip = new Map(syms.map((s) => [s.scip, s]))
  for (const s of syms) {
    if (!isCallable(s)) continue
    for (const id of s.impl ?? []) {
      const base = byScip.get(id)
      if (!base || base === s || !isCallable(base) || pairs.get(base.id)?.has(s.id)) continue
      edges++
      add(pairs, base.id, s, s.def, true)
      add(back, s.id, base, s.def, true)
    }
  }

  const ranked = (table: Map<string, Map<string, Link>>) =>
    new Map([...table].map(([k, row]) => [k, [...row.values()].sort((a, b) => b.at.length - a.at.length || a.sym.name.localeCompare(b.sym.name))]))
  return { parent, out: ranked(pairs), in: ranked(back), edges }
}

/** "MessageService.relay": a symbol with the type it is declared in. */
export function qualifiedName(index: Index, s: Sym): string {
  let p = index.graph.parent.get(s.id)
  while (p && !isType(p)) p = index.graph.parent.get(p.id)
  return p ? `${p.name}.${s.name}` : s.name
}

export const usedBy = (index: Index, s: Sym): Link[] => index.graph.in.get(s.id) ?? []
/** What a symbol calls: the functions and constructors among what it uses. */
export const calls = (index: Index, s: Sym): Link[] => (index.graph.out.get(s.id) ?? []).filter((l) => isCallable(l.sym))
/** The types, fields and constants it touches. */
export const touches = (index: Index, s: Sym): Link[] => (index.graph.out.get(s.id) ?? []).filter((l) => !isCallable(l.sym))

/** The shortest chain of calls from one symbol to another, both ends included; null when there is none. */
export function pathBetween(index: Index, from: Sym, to: Sym): Sym[] | null {
  const prev = new Map<string, Sym | null>([[from.id, null]])
  const queue = [from]
  for (let i = 0; i < queue.length; i++) {
    const s = queue[i]
    if (s === to) {
      const path: Sym[] = []
      for (let c: Sym | null = s; c; c = prev.get(c.id) ?? null) path.unshift(c)
      return path
    }
    for (const l of index.graph.out.get(s.id) ?? [])
      if (!prev.has(l.sym.id)) {
        prev.set(l.sym.id, s)
        queue.push(l.sym)
      }
  }
  return null
}
