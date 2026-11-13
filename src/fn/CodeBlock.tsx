import { useMemo, type MouseEvent } from 'react'
import { esc, highlight } from '../threads/highlight'
import type { Index } from '../types'

/** One line of source as HTML: keywords coloured, every indexed name wrapped so it can be clicked. */
export function lineHtml(index: Index, file: number, line: number, mark: (sym: string, role: 'def' | 'ref') => string): string {
  const text = index.files[file].lines[line - 1] ?? ''
  let html = ''
  let p = 0
  for (const o of index.occ[file].get(line) ?? []) {
    if (o.start < p) continue
    html += highlight(text.slice(p, o.start))
    html += `<span class="sym ${mark(o.sym, o.role)}" data-sym="${o.sym}">${esc(text.slice(o.start, o.end))}</span>`
    p = o.end
  }
  return html + highlight(text.slice(p))
}

/**
 * A stretch of one file. `body` is the range that gets the tint (the function itself, when context
 * lines are shown around it); `hot` are the lines to light up.
 */
export function CodeBlock({ index, file, from, to, body, hot, mark, onSymbol }: { index: Index; file: number; from: number; to: number; body?: [number, number]; hot?: Set<number>; mark(sym: string, role: 'def' | 'ref'): string; onSymbol(id: string): void }) {
  const rows = useMemo(() => {
    const out: { line: number; html: string }[] = []
    for (let l = from; l <= to; l++) out.push({ line: l, html: lineHtml(index, file, l, mark) })
    return out
  }, [index, file, from, to, mark])

  const click = (e: MouseEvent) => {
    const id = (e.target as HTMLElement).closest<HTMLElement>('[data-sym]')?.dataset.sym
    if (id) onSymbol(id)
  }

  return (
    <div className="cb" onClick={click}>
      {rows.map((r) => (
        <div key={r.line} data-line={r.line} className={`cb-row${body && r.line >= body[0] && r.line <= body[1] ? ' in' : ''}${hot?.has(r.line) ? ' hot' : ''}`}>
          <span className="cb-no">{r.line}</span>
          <span className="cb-tx" dangerouslySetInnerHTML={{ __html: r.html || ' ' }} />
        </div>
      ))}
    </div>
  )
}
