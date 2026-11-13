import { describe, expect, it } from 'vitest'
import { buildCallGraph, calls, inside, pathBetween, qualifiedName, touches, usedBy } from '../src/data/callGraph'
import type { Sym } from '../src/types'
import { sample } from './helpers/sample'

const index = sample()
const named = (name: string, kind?: string) => index.syms.find((s) => s.name === name && (!kind || s.kind === kind))!
const names = (links: { sym: Sym }[]) => links.map((l) => qualifiedName(index, l.sym)).sort()

describe('the call graph of the sample', () => {
  it('knows every definition extent', () => {
    for (const s of index.syms) expect(s.body, s.name).toBeDefined()
  })

  it('puts a usage in the function it sits in', () => {
    const relay = index.syms.find((s) => s.name === 'relay' && qualifiedName(index, s) === 'MessageService.relay')!
    expect(names(calls(index, relay))).toEqual(['MessageRepository.save', 'MessageService.validate'])
    expect(names(touches(index, relay))).toContain('Envelope')
  })

  it('lists callers from other files', () => {
    const relay = index.syms.find((s) => qualifiedName(index, s) === 'MessageService.relay')!
    const callers = usedBy(index, relay)
    expect(callers).toHaveLength(1)
    expect(index.files[callers[0].sym.def.file].path).toMatch(/MessageController\.kt$/)
    expect(callers[0].at[0].file).toBe(callers[0].sym.def.file)
  })

  it('makes no edge from an import or from a function to its own parameters', () => {
    const validate = index.syms.find((s) => qualifiedName(index, s) === 'MessageService.validate')!
    for (const l of index.graph.out.get(validate.id) ?? []) expect(inside(l.sym.def, validate)).toBe(false)
    const envelope = named('Envelope', 'class')
    const uses = usedBy(index, envelope).reduce((n, l) => n + l.at.length, 0)
    expect(uses).toBeLessThan(envelope.refs.length) // the import lines belong to nothing
  })

  it('counts each pair of symbols once however often one uses the other', () => {
    const pairs = [...index.graph.out.values()].reduce((n, row) => n + row.length, 0)
    expect(index.graph.edges).toBe(pairs)
    expect([...index.graph.in.values()].reduce((n, row) => n + row.length, 0)).toBe(pairs)
  })

  it('finds the chain of calls from the controller to the store', () => {
    const from = index.syms.find((s) => index.files[s.def.file].path.endsWith('MessageController.kt') && calls(index, s).some((l) => l.sym.name === 'relay'))!
    const to = index.syms.find((s) => qualifiedName(index, s) === 'MessageRepository.save')!
    expect(pathBetween(index, from, to)!.map((s) => s.name)).toEqual([from.name, 'relay', 'save'])
    expect(pathBetween(index, to, from)).toBeNull()
  })
})

describe('buildCallGraph', () => {
  const sym = (id: string, kind: string, line: number, body: Sym['body'], refs: [number, number][] = []): Sym => ({
    id, scip: id, name: id, kind, def: { file: 0, line, col: 4, len: 1 }, body,
    refs: refs.map(([l, c]) => ({ file: 0, line: l, col: c, len: 1 })),
  })

  it('picks the innermost definition and skips symbols without an extent', () => {
    const outer = sym('Outer', 'class', 1, [1, 0, 20, 1])
    const method = sym('run', 'method', 3, [3, 4, 9, 5])
    const helper = sym('help', 'method', 12, [12, 4, 14, 5], [[5, 8], [16, 8]]) // used in run, and at class level
    const field = sym('count', 'field', 2, undefined, [[6, 8]])
    const g = buildCallGraph([outer, method, helper, field], 1)
    expect(g.in.get('help')!.map((l) => l.sym.id).sort()).toEqual(['Outer', 'run'])
    expect(g.out.get('run')!.map((l) => l.sym.id).sort()).toEqual(['count', 'help'])
    expect(g.parent.get('run')).toBe(outer)
    expect(g.parent.has('Outer')).toBe(false)
  })

  it('joins an interface method to the methods that carry it out', () => {
    const caller = sym('caller', 'method', 1, [1, 0, 4, 1])
    const declared = sym('Store.save', 'method', 6, [6, 0, 6, 20], [[2, 8]]) // called in caller
    const real = { ...sym('DbStore.save', 'method', 9, [9, 0, 12, 1]), impl: ['Store.save', 'not/in/repo'] }
    const g = buildCallGraph([caller, declared, real], 1)
    expect(g.out.get('Store.save')).toEqual([{ sym: real, at: [real.def], impl: true }])
    expect(g.in.get('DbStore.save')!.map((l) => l.sym.id)).toEqual(['Store.save'])
    expect(g.edges).toBe(2)
  })

  it('treats the end of an extent as outside it', () => {
    const one = sym('one', 'function', 1, [1, 0, 1, 20])
    expect(inside({ file: 0, line: 1, col: 19 }, one)).toBe(true)
    expect(inside({ file: 0, line: 1, col: 20 }, one)).toBe(false)
    expect(inside({ file: 1, line: 1, col: 5 }, one)).toBe(false)
  })
})
