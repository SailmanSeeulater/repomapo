import { baseName, dirName } from '../data/index'
import type { Index, Pos } from '../types'
import { LH, PAD, clamp, visibleRows, visualCol, wirePath, type Pt } from './geometry'
import { ICON_CLOSE, esc, highlight } from './highlight'
import { COLLAPSE, activeSymbols, type ThreadsState } from './store'

const OVERSCAN = 20
const MAX_STUBS = 5
const STUB_W = 170
const STUB_STEP = 22

export interface StageHandlers {
  /** A name in the code was clicked. */
  onSymbol(id: string): void
  onHover(id: string | null): void
  /** A count or a stub was clicked: go to that line. */
  onHop(file: number, line: number): void
  /** A gutter mark was clicked. */
  onLib(key: string): void
  onClose(file: number): void
  /** Any click inside a pane: it counts as used. */
  onTouch(file: number): void
}

interface Pane {
  file: number
  el: HTMLElement
  body: HTMLElement
  lines: HTMLElement
  from: number
  to: number
  digits: number
}

type Shown = Pick<ThreadsState, 'open' | 'focus' | 'hover' | 'lib' | 'pins' | 'all'>

/**
 * The code panes and the threads over them. This part is plain DOM on purpose: rows are created
 * and thrown away as panes scroll, and every thread is recomputed from scroll positions on each
 * frame, which React would only get in the way of. React owns everything around it and passes the
 * state in through sync().
 */
export class ThreadStage {
  private panes = new Map<number, Pane>()
  private scroll = new Map<number, number>()
  private widths = new Map<number, number>()
  private svg: SVGSVGElement
  private tags: HTMLElement
  private state: Shown = { open: [], focus: null, hover: null, lib: null, pins: [null, null, null], all: false }
  private cw = 7.5
  private flash: string | null = null
  private raf = 0
  private observer: ResizeObserver | null = null
  private calm = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches
  private dead = false

  constructor(
    private root: HTMLElement,
    private index: Index,
    private on: StageHandlers,
  ) {
    root.innerHTML = '<svg class="wires" aria-hidden="true"></svg><div class="tags"></div>'
    this.svg = root.querySelector('svg')!
    this.tags = root.querySelector('.tags')!
    this.measure()
    root.addEventListener('click', this.click)
    root.addEventListener('keydown', this.keydown)
    root.addEventListener('mouseover', this.over)
    root.addEventListener('mouseout', this.out)
    window.addEventListener('resize', this.redraw)
    if (typeof ResizeObserver === 'function') {
      this.observer = new ResizeObserver(() => {
        let rebuilt = false
        for (const p of this.panes.values()) rebuilt = this.renderRows(p) || rebuilt
        if (rebuilt) this.paint()
        this.redraw()
      })
      this.observer.observe(root)
    }
    document.fonts?.ready.then(() => {
      if (this.dead) return
      this.measure()
      this.redraw()
    })
  }

  destroy() {
    this.dead = true
    cancelAnimationFrame(this.raf)
    this.observer?.disconnect()
    window.removeEventListener('resize', this.redraw)
    this.root.removeEventListener('click', this.click)
    this.root.removeEventListener('keydown', this.keydown)
    this.root.removeEventListener('mouseover', this.over)
    this.root.removeEventListener('mouseout', this.out)
    this.root.innerHTML = ''
  }

  /** Bring the panes and threads in line with the store. */
  sync(next: Shown) {
    const before = this.state.open.map((p) => p.file).join(',')
    this.state = next
    if (before !== next.open.map((p) => p.file).join(',') || this.panes.size !== next.open.length) this.renderPanes()
    this.paint()
    this.draw()
  }

  /** Scroll a line into view in its pane (which must be open), optionally flashing it. */
  reveal(o: { file: number; line: number }, opts: { flash?: boolean; instant?: boolean } = {}) {
    const p = this.panes.get(o.file)
    if (!p) return
    const top = PAD + (o.line - 1) * LH
    const seen = top >= p.body.scrollTop && top + LH <= p.body.scrollTop + p.body.clientHeight
    if (opts.flash) {
      const key = o.file + ':' + o.line
      this.flash = key
      setTimeout(() => {
        if (this.flash !== key) return
        this.flash = null
        this.root.querySelectorAll('.ln.flash').forEach((e) => e.classList.remove('flash'))
      }, 1200)
      this.renderRows(p, true)
      this.paint()
    }
    if (seen) return
    const target = Math.max(0, top - p.body.clientHeight / (opts.instant ? 3 : 2))
    if (opts.instant || this.calm) {
      p.body.scrollTop = target
      this.scroll.set(o.file, target)
      if (this.renderRows(p)) this.paint()
      this.draw()
    } else p.body.scrollTo({ top: target, behavior: 'smooth' })
  }

  // ---------- panes ----------

  private measure() {
    const probe = document.createElement('span')
    probe.className = 'lines'
    probe.style.cssText = 'position:absolute;visibility:hidden;white-space:pre'
    probe.textContent = '0'.repeat(200)
    this.root.appendChild(probe)
    this.cw = probe.getBoundingClientRect().width / 200 || this.cw
    probe.remove()
  }

  private renderPanes() {
    for (const p of this.panes.values()) if (p.body.isConnected) this.scroll.set(p.file, p.body.scrollTop) // scroll events can lag
    this.root.querySelectorAll('.pane, .empty').forEach((e) => e.remove())
    this.panes.clear()
    const open = this.state.open
    this.root.style.setProperty('--n', String(Math.max(1, open.length)))
    if (!open.length) {
      const e = document.createElement('div')
      e.className = 'empty'
      e.innerHTML = '<b>No files open.</b><p>Pick a file from the list.</p>'
      this.root.insertBefore(e, this.svg)
    }
    for (const { file } of open) {
      const f = this.index.files[file]
      let width = this.widths.get(file)
      if (width == null) this.widths.set(file, (width = f.lines.reduce((m, t) => Math.max(m, visualCol(t, t.length)), 0)))
      const digits = Math.max(3, String(f.lines.length).length)
      const el = document.createElement('div')
      el.className = 'pane'
      el.dataset.file = String(file)
      const name = esc(baseName(f.path))
      el.innerHTML =
        `<div class="pane-head"><b>${name}</b><span>${esc(dirName(f.path))}</span><button class="x icon-btn" data-close="${file}" aria-label="Close ${name}">${ICON_CLOSE}</button></div>` +
        `<div class="pane-body" tabindex="0" aria-label="${name}"><div class="lines" style="height:${f.lines.length * LH}px;min-width:${width + digits + 4}ch;--digits:${digits}"></div></div>`
      this.root.insertBefore(el, this.svg)
      const p: Pane = { file, el, body: el.querySelector('.pane-body')!, lines: el.querySelector('.lines')!, from: -1, to: -1, digits }
      this.panes.set(file, p)
      p.body.scrollTop = this.scroll.get(file) ?? 0
      p.body.addEventListener(
        'scroll',
        () => {
          this.scroll.set(file, p.body.scrollTop)
          if (this.renderRows(p)) this.paint()
          this.redraw()
        },
        { passive: true },
      )
    }
    for (const p of this.panes.values()) this.renderRows(p, true)
  }

  /** Only the lines near the viewport exist in the DOM. Returns true when rows were rebuilt. */
  private renderRows(p: Pane, force = false): boolean {
    const { occ, libAt, libs, files } = this.index
    const lines = files[p.file].lines
    const n = lines.length
    const [a, b] = visibleRows(p.body.scrollTop, p.body.clientHeight || 480, n)
    if (!force && (a >= p.from + 3 || p.from === 0) && (b <= p.to - 3 || p.to === n)) return false
    p.from = Math.max(0, a - OVERSCAN)
    p.to = Math.min(n, b + OVERSCAN)
    let html = ''
    for (let i = p.from; i < p.to; i++) {
      const l = i + 1
      const text = lines[i]
      let out = ''
      let at = 0
      for (const t of occ[p.file].get(l) ?? []) {
        if (t.start < at) continue
        out += highlight(text.slice(at, t.start)) + `<span class="tok" role="button" tabindex="0" data-sym="${t.sym}" data-role="${t.role}">${esc(text.slice(t.start, t.end))}</span>`
        at = t.end
      }
      out += highlight(text.slice(at))
      const here = libAt[p.file].get(l)
      const names = here ? esc(here.map((k) => libs[k].name).join(', ')) : ''
      const mark = here ? `<button class="lib" data-lib="${p.file}:${l}" title="Library: ${names}" aria-label="Library symbols on line ${l}: ${names}"></button>` : ''
      html += `<div class="ln${this.flash === p.file + ':' + l ? ' flash' : ''}" style="top:${i * LH}px"><span class="no">${l}</span><span class="gm">${mark}</span><span class="code">${out || ' '}</span></div>`
    }
    p.lines.innerHTML = html
    return true
  }

  // ---------- threads ----------

  /** Mark the rendered names of the active symbols. */
  private paint() {
    const color = new Map(activeSymbols(this.state).map((a) => [a.id, a.color]))
    this.root.querySelectorAll<HTMLElement>('.tok').forEach((el) => {
      const c = color.get(el.dataset.sym!)
      el.classList.toggle('lit', !!c)
      el.classList.toggle('def', !!c && el.dataset.role === 'def')
      if (c) el.style.setProperty('--c', c)
      else el.style.removeProperty('--c')
    })
    this.root.querySelectorAll('.ln').forEach((ln) => ln.classList.toggle('lit-line', !!ln.querySelector('.tok.lit')))
    this.root.querySelectorAll<HTMLElement>('.lib').forEach((el) => el.classList.toggle('on', el.dataset.lib === this.state.lib))
    this.root.classList.toggle('dim', color.size > 0 && !this.state.all)
  }

  /**
   * Where an occurrence sits inside the stage, computed from its line and column so it works for
   * lines that are not rendered. Null when its file is not open.
   */
  private point(o: Pos, origin: DOMRect, rects: Map<number, DOMRect>): Pt | null {
    const p = this.panes.get(o.file)
    const r = rects.get(o.file)
    if (!p || !r) return null
    const left = r.left - origin.left
    const right = left + p.body.clientWidth
    const top = r.top - origin.top
    const bottom = r.bottom - origin.top
    const text = this.index.files[o.file].lines[o.line - 1] ?? ''
    const x0 = left - p.body.scrollLeft + (p.digits + 2) * this.cw
    const cy = top + PAD - p.body.scrollTop + (o.line - 1) * LH + LH / 2
    const xl = x0 + visualCol(text, o.col) * this.cw - 2
    const xr = x0 + visualCol(text, o.col + o.len) * this.cw + 2
    const y = clamp(cy, top + 3, bottom - 3)
    return { y, l: clamp(xl, left + 3, right - 3), r: clamp(xr, left + 3, right - 3), off: y !== cy || xr < left || xl > right, pl: left, pr: right, pt: top, pb: bottom, pane: o.file }
  }

  private redraw = () => {
    cancelAnimationFrame(this.raf)
    this.raf = requestAnimationFrame(() => this.draw())
  }

  private draw() {
    if (this.dead) return
    const { index, state } = this
    const origin = this.root.getBoundingClientRect()
    const W = origin.width
    const rects = new Map<number, DOMRect>()
    for (const p of this.panes.values()) rects.set(p.file, p.body.getBoundingClientRect())
    const at = (o: Pos) => this.point(o, origin, rects)
    const key = (o: { file: number; line: number }) => o.file + ':' + o.line
    const where = (o: { file: number; line: number }) => esc(baseName(index.files[o.file].path)) + ':' + o.line

    const thread = (a: Pt, b: Pt, color: string) => {
      const w = wirePath(a, b, W)
      if (!w) return ''
      const dash = a.off || b.off ? ' stroke-dasharray="4 4"' : ''
      const dot = b.off
        ? `<circle cx="${w.ex}" cy="${b.y}" r="3.2" style="fill:var(--surface);stroke:${color}" stroke-width="1.5"/>`
        : `<circle cx="${w.ex}" cy="${b.y}" r="3.2" style="fill:${color}"/>`
      return `<path d="${w.d}" fill="none" style="stroke:${color}" stroke-width="1.7" stroke-linecap="round"${dash}/>` + dot
    }

    let out = ''
    let tags = ''
    if (state.all) {
      for (const p of this.panes.values())
        for (const s of index.defsIn[p.file]) {
          const a = at(s.def)!
          for (const r of s.refs) {
            const b = at(r)
            if (!b || (a.off && b.off)) continue
            const w = wirePath(a, b, W)
            if (w) out += `<path d="${w.d}" fill="none" style="stroke:var(--muted)" stroke-width="1" stroke-opacity="0.55"${a.off || b.off ? ' stroke-dasharray="4 4"' : ''}/>`
          }
        }
    }

    const shown = state.hover ?? state.focus
    const stubX = (pt: Pt) => pt.pr - 6 - STUB_W
    for (const { id, color } of activeSymbols(state)) {
      const s = index.byId.get(id)
      if (!s) continue
      const a = at(s.def)
      const main = id === shown
      const byFile = new Map<number, Pos[]>()
      for (const r of s.refs) {
        if (!byFile.has(r.file)) byFile.set(r.file, [])
        byFile.get(r.file)!.push(r)
      }
      // The usage that stands for a file: the first one on screen, else the first one.
      const pick = (list: Pos[]) => {
        const pts = list.map((r) => at(r)!)
        let i = pts.findIndex((q) => !q.off)
        if (i < 0) i = 0
        return { i, b: pts[i] }
      }

      if (!a) {
        // The definition's file is not open: each pane that uses the symbol gets a stub that opens it.
        if (!main) continue
        for (const [file, list] of byFile) {
          if (!this.panes.has(file)) continue
          const { b } = pick(list)
          const x = stubX(b)
          if (x > b.r + 12) out += `<path d="M${b.r},${b.y} L${x},${b.y}" fill="none" style="stroke:${color}" stroke-width="1.4" stroke-dasharray="3 3"/>`
          tags += `<button class="tag stub" style="left:${x}px;top:${b.y - 9}px;width:${STUB_W}px;--c:${color}" data-hop="${key(s.def)}" title="Opens ${esc(index.files[s.def.file].path)}"><span>defined in ${where(s.def)}</span></button>`
        }
        continue
      }

      const collapsed = s.refs.length > COLLAPSE
      for (const [file, list] of byFile) {
        if (!this.panes.has(file)) continue
        if (!collapsed) {
          for (const r of list) out += thread(a, at(r)!, color)
          continue
        }
        // One thread per file, ending on a count that steps to the next usage when clicked.
        const { i, b } = pick(list)
        out += thread(a, b, color)
        if (list.length > 1) {
          let n = (i + 1) % list.length
          while (n !== i && list[n].line === list[i].line) n = (n + 1) % list.length // skip a second usage on the same line
          tags += `<button class="tag count" style="left:${Math.min(b.r + 7, b.pr - 44)}px;top:${b.y - 9}px;--c:${color}" data-hop="${key(list[n])}" title="${list.length} usages in this file. Click for the next one."><b>×${list.length}</b></button>`
        }
      }

      // Usages in files that are not open: stubs at the edge of the definition's pane, busiest first.
      if (!main) continue
      const away = [...byFile].filter(([file]) => !this.panes.has(file)).sort((x, y) => y[1].length - x[1].length)
      if (!away.length) continue
      const rows = Math.min(MAX_STUBS, away.length) + (away.length > MAX_STUBS ? 1 : 0)
      const x = stubX(a)
      let y = clamp(a.r > x - 16 ? a.y + STUB_STEP : a.y, a.pt + 14, Math.max(a.pt + 14, a.pb - 14 - (rows - 1) * STUB_STEP))
      for (const [file, list] of away.slice(0, MAX_STUBS)) {
        if (x > a.r + 12) {
          const mid = (a.r + x) / 2
          out += `<path d="M${a.r},${a.y} C${mid},${a.y} ${mid},${y} ${x},${y}" fill="none" style="stroke:${color}" stroke-width="1.4" stroke-dasharray="3 3"/>`
        }
        tags += `<button class="tag stub" style="left:${x}px;top:${y - 9}px;width:${STUB_W}px;--c:${color}" data-hop="${key(list[0])}" title="Opens ${esc(index.files[file].path)}"><span>${esc(baseName(index.files[file].path))}</span><b>${list.length}</b></button>`
        y += STUB_STEP
      }
      if (away.length > MAX_STUBS) {
        const rest = away.slice(MAX_STUBS)
        const uses = rest.reduce((n, e) => n + e[1].length, 0)
        tags += `<span class="tag more" style="left:${x}px;top:${y - 9}px;width:${STUB_W}px"><span>and ${rest.length} more file${rest.length === 1 ? '' : 's'}</span><b>${uses}</b></span>`
      }
    }
    this.svg.innerHTML = out
    this.tags.innerHTML = tags
  }

  // ---------- events ----------

  private click = (e: MouseEvent) => {
    const t = e.target as HTMLElement
    const shut = t.closest<HTMLElement>('[data-close]')
    if (shut) return this.on.onClose(+shut.dataset.close!)
    const tag = t.closest<HTMLElement>('.tag[data-hop]')
    if (tag) {
      const [file, line] = tag.dataset.hop!.split(':').map(Number)
      return this.on.onHop(file, line)
    }
    const lib = t.closest<HTMLElement>('.lib')
    if (lib) return this.on.onLib(lib.dataset.lib!)
    const pane = t.closest<HTMLElement>('.pane')
    if (pane) this.on.onTouch(+pane.dataset.file!)
    const tok = t.closest<HTMLElement>('.tok')
    if (tok) this.on.onSymbol(tok.dataset.sym!)
  }

  private keydown = (e: KeyboardEvent) => {
    const t = e.target as HTMLElement
    if ((e.key === 'Enter' || e.key === ' ') && t.classList.contains('tok')) {
      e.preventDefault()
      t.click()
    }
  }

  private over = (e: MouseEvent) => {
    const tok = (e.target as HTMLElement).closest<HTMLElement>('.tok')
    if (tok) this.on.onHover(tok.dataset.sym!)
  }

  private out = (e: MouseEvent) => {
    if ((e.target as HTMLElement).closest('.tok')) this.on.onHover(null)
  }
}
