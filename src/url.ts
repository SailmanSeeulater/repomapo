/**
 * The one URL scheme both views share. Everything is a query parameter, so a link works on any
 * static host:
 *
 *   ?view=space|map|functions|function|threads   which view (space when absent)
 *   ?data=<url>         the index to load (the local index, else the sample, when absent)
 *   ?focus=<path>       map: pin this file and show its edges
 *   ?fn=<path>:<line>:<col>    function: the symbol defined there, with its callers and callees
 *                       space: the function picked out on the board
 *   ?orbit=1            space: put that function in the middle, with its calls around it
 *   ?flow=1             space: light up what happens after that function is set off, step by step
 *   ?files=a,b,c        threads: the files open as panes; a path may be given by its ending
 *   ?sym=<path>:<line>:<col>   threads: lock the symbol defined there
 *   ?at=<path>:<line>   threads: scroll to this line once
 */
export type View = 'space' | 'map' | 'functions' | 'function' | 'threads'
const VIEWS: View[] = ['space', 'map', 'functions', 'function', 'threads']

export interface Link {
  view: View
  data: string | null
  focus: string | null
  fn: string | null
  orbit: boolean
  flow: boolean
  files: string[]
  sym: string | null
  at: string | null
}

export function readLink(search: string): Link {
  const q = new URLSearchParams(search)
  return {
    view: VIEWS.find((v) => v === q.get('view')) ?? 'space',
    data: q.get('data'),
    focus: q.get('focus'),
    fn: q.get('fn'),
    orbit: q.get('orbit') === '1',
    flow: q.get('flow') === '1' && q.get('orbit') !== '1',
    files: (q.get('files') ?? '').split(',').map((s) => s.trim()).filter(Boolean),
    sym: q.get('sym'),
    at: q.get('at'),
  }
}

/** The query string for a link, "" for the bare board. Paths stay readable: / , : are not escaped. */
export function writeLink(link: Partial<Link>): string {
  const q = new URLSearchParams()
  if (link.view && link.view !== 'space') q.set('view', link.view)
  if (link.data) q.set('data', link.data)
  if (link.view === 'threads') {
    if (link.files?.length) q.set('files', link.files.join(','))
    if (link.sym) q.set('sym', link.sym)
    if (link.at) q.set('at', link.at)
  } else if (link.view === 'function') {
    if (link.fn) q.set('fn', link.fn)
  } else if (link.view === 'map') {
    if (link.focus) q.set('focus', link.focus)
  } else if ((link.view ?? 'space') === 'space' && link.fn) {
    q.set('fn', link.fn)
    if (link.orbit) q.set('orbit', '1')
    else if (link.flow) q.set('flow', '1')
  }
  const s = q.toString().replace(/%2F/g, '/').replace(/%2C/g, ',').replace(/%3A/g, ':')
  return s ? '?' + s : ''
}

export interface Place {
  path: string
  line: number
  col: number | null
}

/** "src/A.kt:12" or "src/A.kt:12:4". */
export function parsePlace(value: string | null): Place | null {
  const m = /^(.+?):(\d+)(?::(\d+))?$/.exec(value ?? '')
  return m ? { path: m[1], line: +m[2], col: m[3] == null ? null : +m[3] } : null
}
