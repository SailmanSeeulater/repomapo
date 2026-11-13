/** One place in the source: `line` counts from 1, `col` from 0, both as the indexer reports them. */
export interface Pos {
  file: number
  line: number
  col: number
  len: number
}

// ---- the JSON written by scripts/build-index.mjs ----

export interface RawSymbol {
  /** The full SCIP symbol string. */
  id: string
  name?: string
  kind?: string
  def: Pos
  /** The whole definition, body included: [startLine, startCol, endLine, endCol], lines from 1. */
  body?: Extent
  refs: Pos[]
  /** The ids of what it implements or overrides, when that is defined in the repo too. */
  impl?: string[]
}

export type Extent = [number, number, number, number]

export interface RawFile {
  path: string
  lines: string[]
  /** Rows of [line, libIndex, libIndex, ...]: the library symbols used on that line. */
  libs?: number[][]
}

export interface Lib {
  name: string
  pkg: string
  uses: number
}

export interface IndexMeta {
  tool?: string
  toolVersion?: string
  repo?: string
  generated?: string
  stats?: { symbols?: number; refs?: number; files?: number; libs?: number }
}

export interface RawIndex {
  meta?: IndexMeta
  files: RawFile[]
  symbols: RawSymbol[]
  libs?: Lib[]
}

// ---- what the app works with ----

export interface Sym {
  /** Short id used in the DOM and the store ("s12"). */
  id: string
  scip: string
  name: string
  kind: string
  def: Pos
  body?: Extent
  refs: Pos[]
  /** The SCIP ids of what it implements or overrides. */
  impl?: string[]
}

/** One end of an edge in the call graph: the other symbol, and the usages that make the edge. */
export interface Link {
  sym: Sym
  at: Pos[]
  /** Not a call written in the code: an interface's method and a method that carries it out. `at` is where that method is declared. */
  impl?: boolean
}

export interface CallGraph {
  /** The type or function a symbol is declared in. */
  parent: Map<string, Sym>
  /** What a function or type uses, most used first. */
  out: Map<string, Link[]>
  /** The functions and types that use a symbol, most uses first. */
  in: Map<string, Link[]>
  /** How many edges there are (pairs of symbols, not usages). */
  edges: number
}

export interface Occ {
  sym: string
  role: 'def' | 'ref'
  start: number
  end: number
}

export interface Index {
  /** Where it came from, for display: a URL or a file name. */
  source: string
  meta: IndexMeta
  files: RawFile[]
  syms: Sym[]
  byId: Map<string, Sym>
  /** occ[file]: line -> the symbol occurrences on it, sorted by column. */
  occ: Map<number, Occ[]>[]
  /** defsIn[file]: the symbols defined in that file. */
  defsIn: Sym[][]
  libs: Lib[]
  /** libAt[file]: line -> indexes into `libs`. */
  libAt: Map<number, number[]>[]
  graph: CallGraph
}
