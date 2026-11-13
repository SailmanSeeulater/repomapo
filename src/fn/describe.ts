import { calls, isCallable, qualifiedName, touches, usedBy } from '../data/callGraph'
import { isTestPath } from '../data/index'
import type { Index, Link, Sym } from '../types'

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

/** "a", "a and b", "a, b and c", "a, b, c and 4 more". */
export function listNames(names: string[], max = 3): string {
  if (names.length <= 1) return names.join('')
  if (names.length <= max) return names.slice(0, -1).join(', ') + ' and ' + names[names.length - 1]
  return names.slice(0, max).join(', ') + ` and ${names.length - max} more`
}

/** Everything a function can end up calling, however many calls away, and the files that code is in. */
export function reach(index: Index, sym: Sym): { functions: number; files: number } {
  const seen = new Set<string>([sym.id])
  const files = new Set<number>()
  const queue = [sym]
  for (let i = 0; i < queue.length; i++)
    for (const l of calls(index, queue[i]))
      if (!seen.has(l.sym.id)) {
        seen.add(l.sym.id)
        files.add(l.sym.def.file)
        queue.push(l.sym)
      }
  return { functions: seen.size - 1, files: files.size }
}

export interface Relations {
  by: Link[]
  out: Link[]
  touched: Link[]
}

/** A symbol's edges without the ones to itself (recursion). */
export function relations(index: Index, sym: Sym): Relations {
  const other = (l: Link) => l.sym !== sym
  return { by: usedBy(index, sym).filter(other), out: calls(index, sym).filter(other), touched: touches(index, sym).filter(other) }
}

/**
 * What the index alone can say about a symbol, in sentences. Every statement is a count or a name
 * read off the graph, so it is true whenever the index is.
 */
export function describeSymbol(index: Index, sym: Sym): { headline: string; about: string[] } {
  const { by, out, touched } = relations(index, sym)
  const name = sym.name
  const fn = isCallable(sym)
  const short = (l: Link) => l.sym.name
  // name the callers in the code itself before the ones in tests
  const inTest = (l: Link) => Number(isTestPath(index.files[l.sym.def.file].path))
  const callers = [...by].sort((a, b) => inTest(a) - inTest(b))

  let headline: string
  if (!fn) headline = by.length ? `${name} is used in ${plural(by.length, 'place')}.` : `Nothing in this repo uses ${name}.`
  else if (by.length && out.length) headline = `${name} is called from ${plural(by.length, 'place')} and calls ${plural(out.length, 'function')}.`
  else if (by.length) headline = `${name} is called from ${plural(by.length, 'place')} and calls nothing else in this repo.`
  else if (out.length) headline = `Nothing in this repo calls ${name}. It calls ${plural(out.length, 'function')}.`
  else headline = `Nothing in this repo calls ${name}, and it calls nothing in it.`

  const about: string[] = []
  const lines = sym.body ? sym.body[2] - sym.body[0] + 1 : 0
  const kind = sym.kind[0].toUpperCase() + sym.kind.slice(1)
  about.push(`${kind} ${qualifiedName(index, sym)}, defined at line ${sym.def.line} of ${index.files[sym.def.file].path}${lines > 1 ? `, ${lines} lines long` : ''}.`)
  if (by.length) about.push(`${fn ? 'Called' : 'Used'} by ${listNames(callers.map(short))}.`)
  else if (fn) about.push('With no caller in the repo it is an entry point, a test, or something a framework calls.')
  if (out.length) about.push(`It calls ${listNames(out.map(short))}.`)
  if (touched.length) about.push(`It touches ${listNames(touched.map(short))}.`)
  const r = fn ? reach(index, sym) : { functions: 0, files: 0 }
  if (r.functions > out.length) about.push(`Through those calls it reaches ${plural(r.functions, 'function')} in ${plural(r.files, 'file')}.`)
  return { headline, about }
}
