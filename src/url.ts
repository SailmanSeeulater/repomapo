/**
 * The one URL scheme both views share. Everything is a query parameter, so a link works on any
 * static host:
 *
 *   ?view=map|threads   which view (map when absent)
 *   ?data=<url>         the index to load (the local index, else the sample, when absent)
 *   ?focus=<path>       map: pin this file and show its edges
 *   ?files=a,b,c        threads: the files open as panes; a path may be given by its ending
 *   ?sym=<path>:<line>:<col>   threads: lock the symbol defined there
 *   ?at=<path>:<line>   threads: scroll to this line once
 */
export type View = 'map' | 'threads'

export interface Link {
  view: View
  data: string | null
  focus: string | null
  files: string[]
  sym: string | null
  at: string | null
}

export function readLink(search: string): Link {
  const q = new URLSearchParams(search)
  return {
    view: q.get('view') === 'threads' ? 'threads' : 'map',
    data: q.get('data'),
    focus: q.get('focus'),
    files: (q.get('files') ?? '').split(',').map((s) => s.trim()).filter(Boolean),
    sym: q.get('sym'),
    at: q.get('at'),
  }
}

/** The query string for a link, "" for the bare map. Paths stay readable: / , : are not escaped. */
export function writeLink(link: Partial<Link>): string {
  const q = new URLSearchParams()
  if (link.view === 'threads') q.set('view', 'threads')
  if (link.data) q.set('data', link.data)
  if (link.view === 'threads') {
    if (link.files?.length) q.set('files', link.files.join(','))
    if (link.sym) q.set('sym', link.sym)
    if (link.at) q.set('at', link.at)
  } else if (link.focus) q.set('focus', link.focus)
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
