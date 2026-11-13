import { describe, expect, it } from 'vitest'
import { qualifiedName } from '../src/data/callGraph'
import { describeSymbol, listNames, reach, relations } from '../src/fn/describe'
import { neighborhood } from '../src/fn/neighborhood'
import { sample } from './helpers/sample'

const index = sample()
const fn = (name: string) => index.syms.find((s) => qualifiedName(index, s) === name)!

describe('listNames', () => {
  it('reads like a sentence at every length', () => {
    expect(listNames([])).toBe('')
    expect(listNames(['a'])).toBe('a')
    expect(listNames(['a', 'b'])).toBe('a and b')
    expect(listNames(['a', 'b', 'c'])).toBe('a, b and c')
    expect(listNames(['a', 'b', 'c', 'd', 'e'])).toBe('a, b, c and 2 more')
  })
})

describe('describeSymbol', () => {
  it('counts callers and callees in the headline', () => {
    expect(describeSymbol(index, fn('MessageService.relay')).headline).toBe('relay is called from 1 place and calls 2 functions.')
    expect(describeSymbol(index, fn('MessageController.send')).headline).toBe('Nothing in this repo calls send. It calls 1 function.')
    expect(describeSymbol(index, fn('MessageRepository.key')).headline).toBe('key is called from 2 places and calls nothing else in this repo.')
  })

  it('speaks of use, not calls, for a type', () => {
    const envelope = index.syms.find((s) => s.name === 'Envelope' && s.kind === 'class')!
    expect(describeSymbol(index, envelope).headline).toMatch(/^Envelope is used in \d+ places\.$/)
  })

  it('names what the function calls and how far those calls go', () => {
    const about = describeSymbol(index, fn('MessageService.relay')).about.join(' ')
    expect(about).toContain('defined at line 12 of src/main/kotlin/dev/example/relay/service/MessageService.kt, 4 lines long')
    expect(about).toContain('Called by send.')
    expect(about).toContain('It calls save and validate.')
    expect(about).toContain('Through those calls it reaches 3 functions in 2 files.')
  })

  it('says what a function with no caller may be', () => {
    expect(describeSymbol(index, fn('MessageController.send')).about.join(' ')).toContain('entry point')
  })
})

describe('reach and relations', () => {
  it('follows calls to the end', () => {
    expect(reach(index, fn('MessageController.send'))).toEqual({ functions: 4, files: 2 })
    expect(reach(index, fn('MessageRepository.key'))).toEqual({ functions: 0, files: 0 })
  })

  it('splits calls from what is only touched', () => {
    const r = relations(index, fn('MessageService.relay'))
    expect(r.out.map((l) => l.sym.name).sort()).toEqual(['save', 'validate'])
    expect(r.touched.map((l) => l.sym.name).sort()).toEqual(['Envelope', 'repo'])
  })
})

describe('neighborhood', () => {
  it('lays out one step back and two steps on', () => {
    const hood = neighborhood(index, fn('MessageService.relay'))
    expect(hood.levels.map((l) => [l.depth, l.syms.map((s) => s.name).sort()])).toEqual([
      [-1, ['send']],
      [0, ['relay']],
      [1, ['save', 'validate']],
      [2, ['key']],
    ])
    const name = (id: string) => index.byId.get(id)!.name
    expect(hood.edges.map(([a, b]) => `${name(a)}>${name(b)}`).sort()).toEqual(['relay>save', 'relay>validate', 'save>key', 'send>relay'])
  })

  it('caps a level and says how many are left out', () => {
    const hood = neighborhood(index, fn('MessageRepository.key'), 1)
    const callers = hood.levels.find((l) => l.depth === -1)!
    expect(callers.syms).toHaveLength(1)
    expect(callers.more).toBe(1)
  })
})
