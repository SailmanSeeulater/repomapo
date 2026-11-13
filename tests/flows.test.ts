import { describe, expect, it } from 'vitest'
import { qualifiedName } from '../src/data/callGraph'
import { annotationsOf, entryPoints, flowFrom, trigger } from '../src/data/flows'
import { buildIndex } from '../src/data/index'
import type { RawIndex } from '../src/types'
import { sample } from './helpers/sample'

const index = sample()
const named = (q: string) => index.syms.find((s) => qualifiedName(index, s) === q)!

describe('entryPoints', () => {
  it('finds the routes of the sample, with the address the class and the method give', () => {
    expect(entryPoints(index).map((e) => [e.kind, e.label, qualifiedName(index, e.sym), e.reach])).toEqual([
      ['http', 'POST /v1/messages', 'MessageController.send', 4],
      ['http', 'GET /v1/messages/{userId}', 'MessageController.inbox', 3],
    ])
  })
})

describe('trigger', () => {
  const lines = [
    'class Jobs {', //                                   1
    '    @Scheduled(cron = "0 0 * * * *")', //            2
    '    @Transactional', //                              3
    '    public void tick() { work(); }', //              4
    '', //                                                5
    '    void work() {}', //                              6
    '    @EventListener void heard() { work(); }', //     7
    '    public static void main() { work(); }', //       8
    '    void unused() { work(); }', //                   9
    '}',
  ]
  const def = (line: number, name: string) => ({ file: 0, line, col: lines[line - 1].indexOf(name + '('), len: name.length })
  const fn = (id: string, line: number, refs: [number, number][] = []) => ({ id, name: id, kind: 'method', def: def(line, id), body: [line, 4, line, lines[line - 1].length] as [number, number, number, number], refs: refs.map(([l, c]) => ({ file: 0, line: l, col: c, len: 4 })) })
  const raw: RawIndex = {
    files: [{ path: 'src/Jobs.java', lines }],
    symbols: [
      { id: 'Jobs', name: 'Jobs', kind: 'class', def: { file: 0, line: 1, col: 6, len: 4 }, body: [1, 0, 10, 1], refs: [] },
      fn('tick', 4),
      fn('work', 6, [4, 7, 8, 9].map((l) => [l, lines[l - 1].indexOf('work(')] as [number, number])),
      fn('heard', 7),
      fn('main', 8),
      fn('unused', 9),
    ],
  }
  const jobs = buildIndex(raw, 'jobs')
  const sym = (name: string) => jobs.syms.find((s) => s.name === name)!

  it('reads the annotations above a definition, and stops at the member before it', () => {
    expect(annotationsOf(jobs, sym('tick'))).toBe('@Scheduled(cron = "0 0 * * * *") @Transactional public void')
    expect(annotationsOf(jobs, sym('work'))).toBe('')
  })
  it('says what sets a function off', () => {
    expect(trigger(jobs, sym('tick'))).toEqual({ kind: 'job', label: 'Scheduled' })
    expect(trigger(jobs, sym('heard'))).toEqual({ kind: 'event', label: 'EventListener' })
    expect(trigger(jobs, sym('main'))).toEqual({ kind: 'start', label: 'main' })
    expect(trigger(jobs, sym('work'))).toBeNull()
  })
  it('lists the marked ones first, then what nothing in the repo calls, and never what is only called', () => {
    expect(entryPoints(jobs).map((e) => [e.kind, e.sym.name])).toEqual([['job', 'tick'], ['event', 'heard'], ['start', 'main'], ['other', 'unused']])
  })
})

describe('flowFrom', () => {
  it('walks the calls in the order they are written, each function once', () => {
    const flow = flowFrom(index, named('MessageController.send'))
    expect(flow.steps.map((s) => [s.depth, qualifiedName(index, s.sym)])).toEqual([
      [0, 'MessageController.send'],
      [1, 'MessageService.relay'],
      [2, 'MessageService.validate'],
      [2, 'MessageRepository.save'],
      [3, 'MessageRepository.key'],
    ])
    expect(flow.steps.map((s) => s.parent)).toEqual([-1, 0, 1, 1, 3])
    expect(flow.more).toBe(0)
  })
  it('counts what it leaves out when it is cut short', () => {
    const flow = flowFrom(index, named('MessageController.send'), 1)
    expect(flow.steps.map((s) => s.sym.name)).toEqual(['send', 'relay'])
    expect(flow.more).toBe(2)
  })
})
