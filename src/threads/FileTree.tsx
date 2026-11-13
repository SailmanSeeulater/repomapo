import { useMemo, useState, type ReactNode } from 'react'
import { baseName, dirName } from '../data/index'
import type { Index } from '../types'

interface Node {
  dirs: Map<string, Node>
  files: number[]
}

function buildTree(index: Index): Node {
  const root: Node = { dirs: new Map(), files: [] }
  index.files.forEach((f, i) => {
    let node = root
    for (const part of f.path.split('/').slice(0, -1)) {
      if (!node.dirs.has(part)) node.dirs.set(part, { dirs: new Map(), files: [] })
      node = node.dirs.get(part)!
    }
    node.files.push(i)
  })
  return root
}

const fileBtn = 'block w-full truncate rounded border-0 bg-transparent px-1.5 py-0.5 text-left font-mono text-xs transition-colors duration-150 hover:bg-sunk active:text-thread'

/** Every file in the index as a folder tree, with a filter. Clicking a file opens it as a pane. */
export function FileTree({ index, open, onOpen }: { index: Index; open: number[]; onOpen(file: number): void }) {
  const [query, setQuery] = useState('')
  const tree = useMemo(() => buildTree(index), [index])
  const openDirs = open.map((i) => dirName(index.files[i].path) + '/')
  const q = query.trim().toLowerCase()

  const file = (i: number, full: boolean) => (
    <button key={i} className={`${fileBtn} ${open.includes(i) ? 'font-bold text-thread' : ''}`} title={index.files[i].path} onClick={() => onOpen(i)}>
      {baseName(index.files[i].path)}
      {full && <span className="block truncate text-[11px] font-normal text-muted">{dirName(index.files[i].path)}</span>}
    </button>
  )

  const render = (node: Node, prefix: string): ReactNode => (
    <>
      {[...node.dirs]
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([first, firstChild]) => {
          // fold chains of single folders into one row: src/main/java/com/example
          let name = first
          let child = firstChild
          while (child.dirs.size === 1 && !child.files.length) {
            const [n, c] = [...child.dirs][0]
            name += '/' + n
            child = c
          }
          const path = prefix + name + '/'
          return (
            <details key={path} open={openDirs.some((d) => d.startsWith(path)) || undefined}>
              <summary className="cursor-pointer truncate rounded px-1 py-0.5 font-mono text-xs text-muted hover:text-ink">{name}</summary>
              <div className="ml-2 border-l border-rule pl-3">{render(child, path)}</div>
            </details>
          )
        })}
      {[...node.files].sort((a, b) => index.files[a].path.localeCompare(index.files[b].path)).map((i) => file(i, false))}
    </>
  )

  const hits = q ? index.files.map((_, i) => i).filter((i) => index.files[i].path.toLowerCase().includes(q)) : []

  return (
    <nav aria-label="Files" className="flex max-h-[524px] min-w-0 flex-col rounded-[10px] bg-surface max-[880px]:max-h-[220px]">
      <input
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Find a file"
        aria-label="Find a file"
        className="m-2 min-w-0 rounded border border-rule bg-sunk px-2 py-1 text-[13px] text-ink"
      />
      <div className="tree-scroll overflow-auto px-1.5 pb-2 text-[13px]">
        {q ? (
          hits.length ? (
            <>
              {hits.slice(0, 80).map((i) => file(i, true))}
              {hits.length > 80 && <p className="m-0 px-1.5 py-1 text-muted">and {hits.length - 80} more</p>}
            </>
          ) : (
            <p className="m-0 px-1.5 py-1 text-muted">No file matches.</p>
          )
        ) : (
          render(tree, '')
        )}
      </div>
    </nav>
  )
}
