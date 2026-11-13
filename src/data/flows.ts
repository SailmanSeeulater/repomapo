import type { Index, Pos, Sym } from '../types'
import { calls, isCallable, isType, qualifiedName, usedBy } from './callGraph'
import { isTestPath } from './index'

export type EntryKind = 'http' | 'job' | 'event' | 'start' | 'other'

/** A place where work begins: something outside the repo's own code sets it off. */
export interface Entry {
  sym: Sym
  kind: EntryKind
  /** What sets it off, as far as the source says: "GET /api/todos", "Scheduled", or its name. */
  label: string
  /** How many functions it can end up calling. */
  reach: number
}

export const ENTRY_KINDS: [EntryKind, string, string][] = [
  ['http', 'HTTP routes', 'A request to this address runs it'],
  ['job', 'Scheduled jobs', 'A timer runs it'],
  ['event', 'Listeners', 'An event or a message runs it'],
  ['start', 'Startup', 'It runs when the program starts'],
  ['other', 'Called from outside', 'Nothing in this repo calls it, so a framework, a library or a user of the code does'],
]

const isTest = (index: Index, s: Sym) => isTestPath(index.files[s.def.file].path)

/** The annotations written on a definition: the lines right above it, and what precedes it on its own line. */
export function annotationsOf(index: Index, s: Sym): string {
  const lines = index.files[s.def.file].lines
  const out = [lines[s.def.line - 1].slice(0, s.def.col).trim()]
  for (let i = s.def.line - 2; i >= 0 && out.length <= 10; i--) {
    const t = lines[i].trim()
    if (!t || /[;{}]$/.test(t) || /^(\/\/|\/?\*)/.test(t)) break
    out.unshift(t)
  }
  const text = out.join(' ')
  return text.includes('@') ? text.slice(text.indexOf('@')) : ''
}

const firstString = (args: string | undefined) => /"([^"]*)"/.exec(args ?? '')?.[1] ?? ''
const join = (a: string, b: string) => ('/' + a + '/' + b).replace(/\/+/g, '/').replace(/(.)\/$/, '$1')

function enclosingType(index: Index, s: Sym): Sym | null {
  let p = index.graph.parent.get(s.id)
  while (p && !isType(p)) p = index.graph.parent.get(p.id)
  return p ?? null
}

/** What sets a function off, read from its annotations and its name; null when the source does not say. */
export function trigger(index: Index, s: Sym): { kind: EntryKind; label: string } | null {
  const notes = annotationsOf(index, s)
  const spring = /@(Get|Post|Put|Delete|Patch|Request)Mapping\b(?:\s*\(([^)]*)\))?/.exec(notes)
  const jaxrs = /@(GET|POST|PUT|DELETE|PATCH)\b/.exec(notes)
  if (spring || jaxrs) {
    const type = enclosingType(index, s)
    const onType = type ? annotationsOf(index, type) : ''
    const prefix = firstString(/@(?:RequestMapping|Path)\s*\(([^)]*)\)/.exec(onType)?.[1])
    const verb = jaxrs ? jaxrs[1] : spring![1] === 'Request' ? (/RequestMethod\.(\w+)/.exec(spring![2] ?? '')?.[1] ?? 'ANY') : spring![1].toUpperCase()
    const path = jaxrs ? firstString(/@Path\s*\(([^)]*)\)/.exec(notes)?.[1]) : firstString(spring![2])
    return { kind: 'http', label: `${verb} ${join(prefix, path)}` }
  }
  if (/@Scheduled\b/.test(notes)) return { kind: 'job', label: 'Scheduled' }
  const listener = /@(\w*(?:Listener|Handler)|MessageMapping|SubscribeMapping)\b/.exec(notes)
  if (listener) return { kind: 'event', label: listener[1] }
  if (/@(PostConstruct|Bean)\b/.test(notes)) return { kind: 'start', label: /@Bean\b/.test(notes) ? 'Bean' : 'PostConstruct' }
  if (s.name === 'main') return { kind: 'start', label: 'main' }
  return null
}

/** Everything a function can end up calling, however many calls away. */
function reachOf(index: Index, sym: Sym): number {
  const seen = new Set([sym.id])
  const queue = [sym]
  for (let i = 0; i < queue.length; i++)
    for (const l of calls(index, queue[i]))
      if (!seen.has(l.sym.id)) {
        seen.add(l.sym.id)
        queue.push(l.sym)
      }
  return seen.size - 1
}

/**
 * Where to start reading: the functions something outside the repo sets off. Those the source
 * marks (a route, a timer, a listener, main) come first; then the ones nothing in the repo calls
 * and that go on to call something. Tests are left out. Within a kind, the furthest reaching first,
 * except routes, which are in address order.
 */
export function entryPoints(index: Index): Entry[] {
  const out: Entry[] = []
  for (const s of index.syms) {
    if (!isCallable(s) || isTest(index, s)) continue
    const t = trigger(index, s)
    if (t) {
      out.push({ sym: s, ...t, reach: reachOf(index, s) })
      continue
    }
    if (s.kind === 'constructor' || usedBy(index, s).some((l) => !isTest(index, l.sym))) continue
    const reach = reachOf(index, s)
    if (reach) out.push({ sym: s, kind: 'other', label: qualifiedName(index, s), reach })
  }
  const order = ENTRY_KINDS.map(([k]) => k)
  const route = (e: Entry) => e.label.slice(e.label.indexOf(' ') + 1)
  return out.sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind) || (a.kind === 'http' ? route(a).localeCompare(route(b)) || a.label.localeCompare(b.label) : b.reach - a.reach || a.label.localeCompare(b.label)))
}

export interface Step {
  sym: Sym
  /** How many calls from the start. */
  depth: number
  /** The step that calls it: an index into the flow's steps, -1 for the start. */
  parent: number
  /** Where that call is written; for an interface's method, where the method that carries it out is declared. */
  at: Pos | null
  /** Reached through an interface, not through a call written in the code. */
  impl: boolean
}

export interface Flow {
  steps: Step[]
  /** Functions left out because the flow was cut at `max` steps or `depth` calls. */
  more: number
}

const before = (a: Pos, b: Pos) => a.line - b.line || a.col - b.col

/**
 * What happens after a function is set off, in the order the code is written: each function it
 * calls, and under each one what that calls in turn. A function appears once, where it is first
 * reached; calls into tests and to constructors that do nothing but build an object are left out.
 */
export function flowFrom(index: Index, start: Sym, depth = 6, max = 60): Flow {
  const steps: Step[] = [{ sym: start, depth: 0, parent: -1, at: null, impl: false }]
  const seen = new Set([start.id])
  let more = 0
  const visit = (at: number) => {
    const from = steps[at]
    const next = calls(index, from.sym)
      .filter((l) => !isTest(index, l.sym) && !(l.sym.kind === 'constructor' && !calls(index, l.sym).length))
      .sort((a, b) => Number(!!a.impl) - Number(!!b.impl) || before(a.at[0], b.at[0]))
    for (const l of next) {
      if (seen.has(l.sym.id)) continue
      if (from.depth >= depth || steps.length >= max) {
        more++
        continue
      }
      seen.add(l.sym.id)
      steps.push({ sym: l.sym, depth: from.depth + 1, parent: at, at: l.at[0], impl: !!l.impl })
      visit(steps.length - 1)
    }
  }
  visit(0)
  return { steps, more }
}
