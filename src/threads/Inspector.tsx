import { isCallable, isType, usedBy } from '../data/callGraph'
import { baseName } from '../data/index'
import { Go, toFunction } from '../nav'
import type { Index, Pos } from '../types'
import { COLLAPSE, PIN_COLORS, useThreads } from './store'

const MAX_HOPS = 60
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

const btn = 'btn'
const kind = 'text-[13px] text-muted'

function CloseIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true">
      <path d="M2.5 2.5l7 7M9.5 2.5l-7 7" />
    </svg>
  )
}
const hopBase = 'flex-none rounded border px-2 py-0.5 font-mono text-xs tabular-nums transition-colors duration-150'

/** The bar above the panes: what is selected, where it is used, and the pins. */
export function Inspector({ index, total, onHop }: { index: Index; total: number; onHop(file: number, line: number): void }) {
  const { open, focus, hover, lib, pins, all, togglePin, unpin, setAll, clear } = useThreads()
  const isOpen = (file: number) => open.some((p) => p.file === file)
  const where = (o: { file: number; line: number }) => `${baseName(index.files[o.file].path)}:${o.line}`
  const sym = index.byId.get(hover ?? focus ?? '') ?? null

  let who = <span className="text-[13px] text-muted">Nothing selected. Hover or click an underlined name in the code.</span>
  let acts = null
  let hops = null

  if (sym) {
    const files = new Set(sym.refs.map((r) => r.file)).size
    const away = sym.refs.filter((r) => !isOpen(r.file)).length
    const pinned = pins.includes(sym.id)
    const full = pins.every(Boolean)
    who = (
      <>
        <span className={kind}>{sym.kind}</span>
        <span className="font-mono text-[15px] font-bold [overflow-wrap:anywhere]">{sym.name}</span>
        <span className="text-[13px] text-muted">
          {plural(sym.refs.length, 'usage')} in {plural(files, 'file')}
          {away ? `, ${away} in files not open` : ''}
          {sym.refs.length > COLLAPSE ? '. One thread per file' : ''}
          {isOpen(sym.def.file) ? '' : `. Defined in ${where(sym.def)}, not open`}
        </span>
      </>
    )
    acts =
      focus === sym.id ? (
        <>
          {(isCallable(sym) || isType(sym)) && (
            <Go to={toFunction(index, sym)} className={btn} title="Its callers, its code and what it calls">
              Callers and calls ({usedBy(index, sym).length})
            </Go>
          )}
          <button className={btn} onClick={togglePin} disabled={!pinned && full}>
            {pinned ? 'Unpin' : 'Pin'}
          </button>
          <button className={btn} onClick={clear}>
            Clear
          </button>
        </>
      ) : (
        <span className="text-[13px] text-muted">Click to lock</span>
      )
    // Usages in open panes first; a chip for a file that is not open opens it.
    const refs = [...sym.refs].sort((x, y) => Number(!isOpen(x.file)) - Number(!isOpen(y.file)))
    const chip = (o: Pos, i: number, def: boolean) => (
      <button
        key={def ? 'def' : i}
        onClick={() => onHop(o.file, o.line)}
        title={isOpen(o.file) ? undefined : `Opens ${index.files[o.file].path}`}
        className={`${hopBase} ${def ? 'border-thread' : ''} ${isOpen(o.file) ? `bg-sunk ${def ? '' : 'border-transparent'} hover:border-muted` : `border-dashed bg-transparent text-muted hover:border-muted hover:text-ink ${def ? '' : 'border-rule'}`}`}
      >
        {def ? 'defined ' : ''}
        {where(o)}
      </button>
    )
    hops = (
      <>
        <span className="flex-none text-xs text-muted">Jump to</span>
        {chip(sym.def, 0, true)}
        {refs.slice(0, MAX_HOPS).map((r, i) => chip(r, i, false))}
        {refs.length > MAX_HOPS && <span className="flex-none text-xs text-muted">and {refs.length - MAX_HOPS} more</span>}
      </>
    )
  } else if (lib) {
    // A gutter mark was clicked: list the library symbols used on that line.
    const [file, line] = lib.split(':').map(Number)
    const list = index.libAt[file]?.get(line) ?? []
    who = (
      <>
        <span className={kind}>library</span>
        <span className="font-mono text-[15px] font-bold">{where({ file, line })}</span>
        <span className="text-[13px] text-muted">{plural(list.length, 'library symbol')} on this line. Libraries get no threads.</span>
      </>
    )
    acts = (
      <button className={btn} onClick={clear}>
        Clear
      </button>
    )
    hops = list.map((k) => (
      <span key={k} className={`${hopBase} inline-flex items-baseline gap-2 border-transparent bg-sunk`}>
        {index.libs[k].name}
        <span className="text-[11px] text-muted">
          {index.libs[k].pkg || 'unknown package'} · {plural(index.libs[k].uses, 'use')}
        </span>
      </span>
    ))
  }

  return (
    <section aria-label="Selected symbol" className="flex flex-col gap-2.5 rounded-[10px] bg-panel px-3.5 py-3">
      <div className="flex min-h-[30px] flex-wrap items-center justify-between gap-x-4 gap-y-2.5">
        <div className="flex min-w-0 flex-wrap items-baseline gap-x-2.5 gap-y-1.5">{who}</div>
        <div className="flex flex-wrap items-center gap-2">{acts}</div>
      </div>
      <div className="hops flex min-h-7 items-center gap-1.5 overflow-x-auto pb-0.5">{hops}</div>
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t border-rule pt-2.5">
        <div className="flex flex-wrap items-center gap-1.5 text-[13px] text-muted">
          {pins.some(Boolean) ? 'Pinned' : 'Pin up to three symbols to compare their threads.'}
          {pins.map((p, i) => {
            const s = p ? index.byId.get(p) : null
            if (!s) return null
            return (
              <span key={i} className="inline-flex items-center gap-1.5 rounded border py-0.5 pr-1 pl-2 font-mono text-xs text-ink" style={{ borderColor: PIN_COLORS[i] }}>
                <span className="size-2 rounded-full" style={{ background: PIN_COLORS[i] }} />
                {s.name}
                <button className="icon-btn size-5" onClick={() => unpin(i)} aria-label={`Unpin ${s.name}`}>
                  <CloseIcon />
                </button>
              </span>
            )
          })}
        </div>
        <label className="inline-flex cursor-pointer items-center gap-2 text-[13px]">
          <input type="checkbox" className="m-0 size-[15px] accent-thread" checked={all} onChange={(e) => setAll(e.target.checked)} />
          <span>
            Draw all <b className="tabular-nums">{total}</b> threads at once
          </span>
        </label>
      </div>
    </section>
  )
}
