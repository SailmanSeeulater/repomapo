import { describe, expect, it } from 'vitest'
import { buildIndex, defaultFiles, findFile, findSymbol, isRawIndex } from '../src/data/index'
import { rawSample, sample } from './helpers/sample'

describe('the sample index', () => {
  const index = sample()

  it('puts every occurrence on the name it belongs to', () => {
    for (const s of index.syms)
      for (const o of [s.def, ...s.refs]) {
        const found = index.files[o.file].lines[o.line - 1].slice(o.col, o.col + o.len)
        expect(found).toBe(s.name)
      }
  })

  it('has Envelope used ten times across all three files', () => {
    const envelope = index.syms.find((s) => s.name === 'Envelope')!
    expect(envelope.kind).toBe('class')
    expect(envelope.refs).toHaveLength(10)
    expect(new Set(envelope.refs.map((r) => r.file)).size).toBe(3)
  })

  it('keeps occurrences per line sorted by column and without overlaps', () => {
    for (const lines of index.occ)
      for (const list of lines.values())
        for (let i = 1; i < list.length; i++) expect(list[i].start).toBeGreaterThanOrEqual(list[i - 1].end)
  })

  it('marks library lines', () => {
    const store = findFile(index, 'MessageStore.kt')
    const names = [...index.libAt[store].values()].flat().map((k) => index.libs[k].name)
    expect(names).toContain('StringRedisTemplate')
  })
})

describe('buildIndex', () => {
  it('drops occurrences that no longer fit the source', () => {
    const raw = rawSample()
    const envelope = raw.symbols.find((s) => s.name === 'Envelope')!
    envelope.refs.push({ file: 0, line: 9999, col: 0, len: 8 }, { file: 0, line: 1, col: 500, len: 8 })
    raw.symbols.push({ id: 'gone', name: 'gone', kind: 'class', def: { file: 0, line: 9999, col: 0, len: 4 }, refs: [] })
    const index = buildIndex(raw, 'x')
    expect(index.syms.find((s) => s.name === 'Envelope')!.refs).toHaveLength(10)
    expect(index.syms.some((s) => s.name === 'gone')).toBe(false)
  })

  it('recognises an index', () => {
    expect(isRawIndex(rawSample())).toBe(true)
    expect(isRawIndex({ files: [{ path: 'a' }], symbols: [] })).toBe(false)
    expect(isRawIndex('<!doctype html>')).toBe(false)
    expect(isRawIndex(null)).toBe(false)
  })
})

describe('lookups', () => {
  const index = sample()

  it('finds a file by full path or by its ending', () => {
    const full = index.files[1].path
    expect(findFile(index, full)).toBe(1)
    expect(findFile(index, 'service/MessageService.kt')).toBe(findFile(index, 'MessageService.kt'))
    expect(findFile(index, 'Service.kt')).toBe(-1) // an ending must start at a path segment
    expect(findFile(index, 'Nope.kt')).toBe(-1)
  })

  it('finds the symbol defined at a place', () => {
    const relay = index.syms.find((s) => s.name === 'relay')!
    const path = index.files[relay.def.file].path
    expect(findSymbol(index, `${path}:${relay.def.line}:${relay.def.col}`)).toBe(relay)
    expect(findSymbol(index, `${path}:${relay.def.line}:0`)).toBeNull()
    expect(findSymbol(index, 'Nope.kt:1')).toBeNull()
  })

  it('opens all three sample files by default', () => {
    expect(defaultFiles(index)).toEqual([0, 1, 2])
  })
})
