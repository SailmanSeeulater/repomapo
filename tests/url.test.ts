import { describe, expect, it } from 'vitest'
import { parsePlace, readLink, writeLink } from '../src/url'

describe('readLink', () => {
  it('defaults to the map', () => {
    expect(readLink('')).toEqual({ view: 'map', data: null, focus: null, files: [], sym: null, at: null })
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
    expect(writeLink({ view: 'map', files: ['src/A.kt'], sym: 'x:1' })).toBe('')
    expect(writeLink({ view: 'map', focus: 'src/A.kt', data: 'data/x.json' })).toBe('?data=data/x.json&focus=src/A.kt')
    expect(writeLink({ view: 'threads', focus: 'src/A.kt' })).toBe('?view=threads')
  })

  it('round-trips', () => {
    const link = { view: 'threads' as const, data: 'data/sample.json', focus: null, files: ['a/B.java', 'c d/E.java'], sym: 'a/B.java:12:4', at: null }
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
