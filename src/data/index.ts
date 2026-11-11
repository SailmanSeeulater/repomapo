import type { Index, Occ, Pos, RawIndex, Sym } from '../types'
import { parsePlace } from '../url'

export const LOCAL_INDEX = 'data/threads.json'
export const SAMPLE_INDEX = 'data/sample.json'

export function isRawIndex(v: unknown): v is RawIndex {
  const r = v as RawIndex
  return !!r && Array.isArray(r.files) && Array.isArray(r.symbols) && r.files.every((f) => typeof f?.path === 'string' && Array.isArray(f.lines))
}

/** Turns the JSON into the lookup tables the views need. Occurrences that no longer fit the source are dropped. */
export function buildIndex(raw: RawIndex, source: string): Index {
  const files = raw.files
  const syms: Sym[] = raw.symbols.map((s, i) => ({ id: 's' + i, scip: s.id, name: s.name || s.id, kind: s.kind || 'symbol', def: s.def, refs: s.refs }))
  const occ: Map<number, Occ[]>[] = files.map(() => new Map())
  const defsIn: Sym[][] = files.map(() => [])
  const fits = (o: Pos) => {
    const text = files[o.file]?.lines[o.line - 1]
    return text != null && o.len > 0 && o.col >= 0 && o.col + o.len <= text.length
  }
  const put = (o: Pos, sym: string, role: Occ['role']) => {
    let list = occ[o.file].get(o.line)
    if (!list) occ[o.file].set(o.line, (list = []))
    list.push({ sym, role, start: o.col, end: o.col + o.len })
  }
  const kept: Sym[] = []
  for (const s of syms) {
    if (!fits(s.def)) continue // index is older than the source
    s.refs = s.refs.filter(fits)
    kept.push(s)
    defsIn[s.def.file].push(s)
    put(s.def, s.id, 'def')
    for (const r of s.refs) put(r, s.id, 'ref')
  }
  for (const m of occ) for (const list of m.values()) list.sort((a, b) => a.start - b.start)
  return {
    source,
    meta: raw.meta ?? {},
    files,
    syms: kept,
    byId: new Map(kept.map((s) => [s.id, s])),
    occ,
    defsIn,
    libs: raw.libs ?? [],
    libAt: files.map((f) => new Map((f.libs ?? []).map((row) => [row[0], row.slice(1)]))),
  }
}

async function fetchIndex(url: string): Promise<Index> {
  const res = await fetch(url, { cache: 'no-store' })
  if (!res.ok) throw new Error(`${url} returned ${res.status}`)
  let raw: unknown
  try {
    raw = await res.json()
  } catch {
    throw new Error(`${url} is not JSON`)
  }
  if (!isRawIndex(raw)) throw new Error(`${url} is not an index written by scripts/build-index.mjs`)
  return buildIndex(raw, url)
}

/** The index named in the link; with none named, the local index if there is one, else the sample. */
export async function loadIndex(data: string | null): Promise<Index> {
  if (data) return fetchIndex(data)
  try {
    return await fetchIndex(LOCAL_INDEX)
  } catch {
    return fetchIndex(SAMPLE_INDEX)
  }
}

/** An index the visitor picked from disk. It is read in the browser and goes nowhere else. */
export async function indexFromFile(file: File): Promise<Index> {
  let raw: unknown
  try {
    raw = JSON.parse(await file.text())
  } catch {
    throw new Error(`${file.name} is not JSON`)
  }
  if (!isRawIndex(raw)) throw new Error(`${file.name} is not an index written by scripts/build-index.mjs`)
  return buildIndex(raw, file.name)
}

export const baseName = (path: string) => path.slice(path.lastIndexOf('/') + 1)
export const dirName = (path: string) => (path.lastIndexOf('/') < 0 ? '' : path.slice(0, path.lastIndexOf('/')))
export const isTestPath = (path: string) => /(^|\/)(test|tests|androidTest)\//.test(path)

/** A file by its full path or by the end of it ("model/User.java"). -1 when none matches. */
export function findFile(index: Index, path: string): number {
  const exact = index.files.findIndex((f) => f.path === path)
  return exact >= 0 ? exact : index.files.findIndex((f) => f.path.endsWith('/' + path))
}

/** The symbol defined at "path:line" or "path:line:col". */
export function findSymbol(index: Index, place: string | null): Sym | null {
  const p = parsePlace(place)
  const file = p ? findFile(index, p.path) : -1
  if (!p || file < 0) return null
  return index.defsIn[file].find((s) => s.def.line === p.line && (p.col == null || s.def.col === p.col)) ?? null
}

/** With no files asked for: the three non-test files with the most threads touching them. */
export function defaultFiles(index: Index, count = 3): number[] {
  const score = index.files.map(() => 0)
  for (const s of index.syms)
    for (const r of s.refs) {
      score[r.file]++
      if (r.file !== s.def.file) score[s.def.file]++
    }
  const test = (i: number) => Number(isTestPath(index.files[i].path))
  return index.files
    .map((_, i) => i)
    .sort((x, y) => test(x) - test(y) || score[y] - score[x] || x - y)
    .slice(0, count)
    .sort((x, y) => x - y)
}
