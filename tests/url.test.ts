import { describe, expect, it } from 'vitest'
import { parsePlace, readLink, writeLink } from '../src/url'

describe('readLink', () => {
  it('defaults to the board', () => {
    expect(readLink('')).toEqual({ view: 'space', data: null, focus: null, fn: null, orbit: false, flow: false, files: [], sym: null, at: null })
  })

  it('reads a thread view link', () => {
    const l = readLink('?view=threads&files=src/A.kt,%20src/B.kt&sym=src/A.kt:7:11&at=src/B.kt:3')
    expect(l.view).toBe('threads')
    expect(l.files).toEqual(['src/A.kt', 'src/B.kt'])
    expect(l.sym).toBe('src/A.kt:7:11')
    expect(l.at).toBe('src/B.kt:3')
  })
})

describe('writeLink', () => {
  it('keeps paths readable', () => {
    expect(writeLink({ view: 'threads', files: ['src/A.kt', 'src/B.kt'], sym: 'src/A.kt:7:11' })).toBe('?view=threads&files=src/A.kt,src/B.kt&sym=src/A.kt:7:11')
  })

  it('writes only what the view uses', () => {
    expect(writeLink({ view: 'space', files: ['src/A.kt'], sym: 'x:1', orbit: true })).toBe('')
    expect(writeLink({ view: 'map', files: ['src/A.kt'], sym: 'x:1' })).toBe('?view=map')
    expect(writeLink({ view: 'map', focus: 'src/A.kt', data: 'data/x.json' })).toBe('?view=map&data=data/x.json&focus=src/A.kt')
    expect(writeLink({ view: 'threads', focus: 'src/A.kt' })).toBe('?view=threads')
  })

  it('writes a function link and nothing the function page does not use', () => {
    expect(writeLink({ view: 'function', fn: 'src/A.kt:12:8', focus: 'src/B.kt', files: ['x'] })).toBe('?view=function&fn=src/A.kt:12:8')
    expect(writeLink({ view: 'functions', fn: 'src/A.kt:12:8' })).toBe('?view=functions')
    expect(readLink('?view=function&fn=src/A.kt:12:8').fn).toBe('src/A.kt:12:8')
    expect(readLink('?view=nonsense').view).toBe('space')
  })

  it('writes a board link: the function picked, and whether it is in the middle', () => {
    expect(writeLink({ view: 'space', fn: 'src/A.kt:12:8' })).toBe('?fn=src/A.kt:12:8')
    expect(writeLink({ view: 'space', fn: 'src/A.kt:12:8', orbit: true })).toBe('?fn=src/A.kt:12:8&orbit=1')
    expect(readLink('?fn=src/A.kt:12:8&orbit=1')).toMatchObject({ view: 'space', fn: 'src/A.kt:12:8', orbit: true })
    expect(writeLink({ view: 'space', fn: 'src/A.kt:12:8', flow: true })).toBe('?fn=src/A.kt:12:8&flow=1')
    expect(readLink('?fn=src/A.kt:12:8&flow=1')).toMatchObject({ fn: 'src/A.kt:12:8', orbit: false, flow: true })
  })

  it('round-trips', () => {
    const link = { view: 'threads' as const, data: 'data/sample.json', focus: null, fn: null, orbit: false, flow: false, files: ['a/B.java', 'c d/E.java'], sym: 'a/B.java:12:4', at: null }
    expect(readLink(writeLink(link))).toEqual(link)
  })
})

describe('parsePlace', () => {
  it('reads path:line and path:line:col', () => {
    expect(parsePlace('src/A.kt:12')).toEqual({ path: 'src/A.kt', line: 12, col: null })
    expect(parsePlace('src/A.kt:12:4')).toEqual({ path: 'src/A.kt', line: 12, col: 4 })
  })

  it('rejects anything else', () => {
    expect(parsePlace(null)).toBeNull()
    expect(parsePlace('src/A.kt')).toBeNull()
    expect(parsePlace(':3')).toBeNull()
  })
})
