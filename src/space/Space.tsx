import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { qualifiedName } from '../data/callGraph'
import { ENTRY_KINDS, entryPoints, flowFrom, type Entry } from '../data/flows'
import { describeSymbol } from '../fn/describe'
import { Go, toFunction, toThreads } from '../nav'
import { useTheme } from '../theme'
import type { Index, Sym } from '../types'
import { buildModel, orbit as orbitLayout, systems, type Body, type Orbit, type Pt, type SNode, type Systems } from './layout'

type Role = 'all' | 'entry' | 'hub' | 'leaf'
const ROLES: [Role, string, string][] = [
  ['all', 'All', 'Every function'],
  ['entry', 'Entry points', 'Functions nothing in the repo calls'],
  ['hub', 'Most called', 'Functions with three or more callers'],
  ['leaf', 'Leaves', 'Functions that call nothing else in the repo'],
]
const MIN_K = 0.03
const MAX_K = 6
const DUR = 520
const LIST = 7
/** How many starting points of a kind are listed before "Show all". */
const FEW = 6

/** A folder's colour: hues a golden angle apart, so neighbours in the list never look alike. */
export const dirColor = (dir: number, dark: boolean) => `hsl(${Math.round((205 + dir * 137.508) % 360)} ${dark ? 62 : 58}% ${dark ? 68 : 42}%)`

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`
const base = (path: string) => path.slice(path.lastIndexOf('/') + 1)
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
const ease = (t: number) => 1 - Math.pow(1 - t, 3)
const lerp = (a: number, b: number, t: number) => a + (b - a) * t

interface View {
  x: number
  y: number
  k: number
}
type Dot = Pt & { a: number }

/** What the drawing loop reads. Kept in a ref so a frame never waits on React. */
interface Scene {
  nodes: SNode[]
  order: number[]
  mode: 'systems' | 'orbit'
  sys: Systems
  orb: Orbit | null
  sel: number
  match: (n: SNode) => boolean
  filtered: boolean
  dirsOn: Set<number>
  wires: boolean
  dark: boolean
  /** The flow being followed: its functions in step order, the step each one is, and the calls between them. */
  flow: Route | null
  step: number
}

interface Route {
  ids: number[]
  no: Map<number, number>
  links: { a: number; b: number; impl: boolean }[]
}

interface Props {
  index: Index
  /** The function picked out: selected on the board, or the sun when `orbit` is set. */
  fn: Sym | null
  orbit: boolean
  /** Follow what the function sets off, step by step, on the whole-repo board. */
  flow: boolean
  /** `push` asks for a history entry, so Back returns to the board as it was. */
  onSelect(sym: Sym | null, how: 'pick' | 'orbit' | 'flow', push: boolean): void
}

/**
 * The repo as a board to move around in. Folders are regions, files are suns, functions orbit
 * their file; pick one and its calls light up, or put it in the middle and see what it reaches.
 */
export function Space({ index, fn, orbit, flow, onSelect }: Props) {
  const model = useMemo(() => buildModel(index), [index])
  const order = useMemo(() => model.nodes.map((n) => n.i).sort((a, b) => model.nodes[b].ins.length + model.nodes[b].outs.length - model.nodes[a].ins.length - model.nodes[a].outs.length), [model])
  const dark = useTheme((s) => s.dark)

  const [query, setQuery] = useState('')
  const [role, setRole] = useState<Role>('all')
  const [tests, setTests] = useState(false)
  const [wires, setWires] = useState(false)
  const [dirsOn, setDirsOn] = useState<Set<number>>(() => new Set())
  const [depth, setDepth] = useState(2)
  // the folder list starts closed where the list of starting points is open above it, and in an orbit
  const [legendOn, setLegendOn] = useState({ systems: !!fn && (typeof innerWidth !== 'number' || innerWidth > 1100), orbit: false })

  const centre = fn ? (model.byId.get(fn.id) ?? null) : null
  const mode = orbit && centre ? 'orbit' : 'systems'
  const legend = legendOn[mode]
  const setLegend = (on: boolean) => setLegendOn({ ...legendOn, [mode]: on })
  const hasTests = useMemo(() => model.nodes.some((n) => n.test) && model.nodes.some((n) => !n.test), [model])
  // a test that is picked has to be on the board to be shown
  const showTests = tests || !hasTests || !!centre?.test
  const sys = useMemo(() => systems(model, (n) => showTests || !n.test, (f) => base(index.files[f].path)), [model, showTests, index])
  const orb = useMemo(() => (mode === 'orbit' && centre ? orbitLayout(model, centre.i, depth) : null), [model, mode, centre, depth])
  const target = orb ? orb.pos : sys.pos

  // where to start, and the flow being followed
  const entries = useMemo(() => entryPoints(index).filter((e) => model.byId.has(e.sym.id)), [index, model])
  const [startOn, setStartOn] = useState(() => !fn && (typeof innerWidth !== 'number' || innerWidth > 1100))
  const [startQ, setStartQ] = useState('')
  const [allOf, setAllOf] = useState<Set<string>>(() => new Set())
  const flowing = flow && mode === 'systems' && !!centre
  const flowed = useMemo(() => (flowing && centre ? flowFrom(index, centre.sym) : null), [flowing, centre, index])
  const route = useMemo<Route | null>(() => {
    if (!flowed) return null
    const ids = flowed.steps.map((st) => model.byId.get(st.sym.id)!.i)
    return { ids, no: new Map(ids.map((id, n) => [id, n])), links: flowed.steps.slice(1).map((st, n) => ({ a: ids[st.parent], b: ids[n + 1], impl: st.impl })) }
  }, [flowed, model])
  const [step, setStep] = useState(0)
  const at = route ? Math.min(step, route.ids.length - 1) : 0

  const q = query.trim().toLowerCase()
  const match = useCallback(
    (n: SNode) =>
      (!q || n.qname.toLowerCase().includes(q)) &&
      (role === 'all' || (role === 'entry' && !n.ins.length) || (role === 'hub' && n.ins.length >= 3) || (role === 'leaf' && !n.outs.length)) &&
      (!dirsOn.size || dirsOn.has(n.dir)),
    [q, role, dirsOn],
  )
  const filtered = !!q || role !== 'all' || dirsOn.size > 0
  const hits = useMemo(() => (filtered ? order.filter((i) => target.has(i) && match(model.nodes[i])) : []), [filtered, order, target, match, model])

  const wrap = useRef<HTMLDivElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const search = useRef<HTMLInputElement>(null)
  const scene = useRef<Scene>(null!)
  scene.current = { nodes: model.nodes, order, mode, sys, orb, sel: centre?.i ?? -1, match, filtered, dirsOn, wires, dark, flow: route, step: at }
  const live = useRef({
    view: { x: 0, y: 0, k: 1 } as View,
    cur: new Map<number, Dot>(),
    from: null as Map<number, Dot> | null,
    to: new Map<number, Pt>(),
    t0: 0,
    fly: null as { from: View; to: View; t0: number } | null,
    sysA: 1,
    hover: -1,
    w: 0,
    h: 0,
    dpr: 1,
    raf: 0,
    colors: {} as Record<string, string>,
    font: 'sans-serif',
    widths: new Map<string, number>(),
  })
  /** Set by a click on the board, so picking a function you are looking at does not move the camera. */
  const quiet = useRef(false)
  const calm = useMemo(() => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches, [])

  // ---- drawing ----

  const invalidate = useCallback(() => {
    const s = live.current
    if (!s.raf) s.raf = requestAnimationFrame(frame)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function frame(now: number) {
    const s = live.current
    const p = scene.current
    s.raf = 0
    const cv = canvas.current
    const ctx = cv?.getContext('2d')
    if (!cv || !ctx || !s.w) return
    let again = false

    if (s.from) {
      const t = calm ? 1 : Math.min(1, (now - s.t0) / DUR)
      const e = ease(t)
      const cur = new Map<number, Dot>()
      for (const [i, to] of s.to) {
        const f = s.from.get(i)
        cur.set(i, f ? { x: lerp(f.x, to.x, e), y: lerp(f.y, to.y, e), a: lerp(f.a, 1, e) } : { x: to.x, y: to.y, a: e })
      }
      if (t < 1) for (const [i, f] of s.from) if (!s.to.has(i)) cur.set(i, { x: f.x, y: f.y, a: f.a * (1 - e) })
      s.cur = cur
      if (t < 1) again = true
      else s.from = null
    }
    if (s.fly) {
      const t = calm ? 1 : Math.min(1, (now - s.fly.t0) / DUR)
      const e = ease(t)
      const { from, to } = s.fly
      s.view = { x: lerp(from.x, to.x, e), y: lerp(from.y, to.y, e), k: from.k * Math.pow(to.k / from.k, e) }
      if (t < 1) again = true
      else s.fly = null
    }
    const wantSys = p.mode === 'systems' ? 1 : 0
    if (Math.abs(s.sysA - wantSys) > 0.01) {
      s.sysA = calm ? wantSys : s.sysA + (wantSys - s.sysA) * 0.16
      again = true
    } else s.sysA = wantSys

    const c = s.colors
    const { w, h } = s
    const { x: vx, y: vy, k } = s.view
    const X = (wx: number) => (wx - vx) * k + w / 2
    const Y = (wy: number) => (wy - vy) * k + h / 2
    const off = (b: Pt & { r: number }) => X(b.x + b.r) < 0 || X(b.x - b.r) > w || Y(b.y + b.r) < 0 || Y(b.y - b.r) > h
    const circle = (x: number, y: number, r: number) => {
      ctx.beginPath()
      ctx.arc(x, y, r, 0, Math.PI * 2)
    }
    const width = (text: string, font: string) => {
      const key = font + text
      let v = s.widths.get(key)
      if (v == null) {
        ctx.font = font
        s.widths.set(key, (v = ctx.measureText(text).width))
      }
      return v
    }
    const fitText = (text: string, font: string, max: number) => {
      if (width(text, font) <= max) return text
      let t = text
      while (t.length > 3 && width(t + '…', font) > max) t = t.slice(0, -1)
      return t + '…'
    }

    ctx.setTransform(s.dpr, 0, 0, s.dpr, 0, 0)
    ctx.globalAlpha = 1
    ctx.fillStyle = c.bg
    ctx.fillRect(0, 0, w, h)

    // the board's dots: they move with it, so a drag reads as moving the board
    let gap = 48
    while (gap * k < 22) gap *= 2
    while (gap * k > 64) gap /= 2
    ctx.fillStyle = c.rule
    for (let gx = Math.floor((vx - w / 2 / k) / gap) * gap; X(gx) < w; gx += gap) for (let gy = Math.floor((vy - h / 2 / k) / gap) * gap; Y(gy) < h; gy += gap) ctx.fillRect(X(gx) - 0.75, Y(gy) - 0.75, 1.5, 1.5)

    const small = `500 11.5px ${s.font}`
    const strong = `600 12.5px ${s.font}`
    const text = `500 12px ${s.font}`
    ctx.textBaseline = 'middle'

    // folders and files
    if (s.sysA > 0.01) {
      for (const d of p.sys.dirs) {
        if (off(d)) continue
        ctx.globalAlpha = s.sysA * (p.dirsOn.size && !p.dirsOn.has(d.dir) ? 0.45 : 1)
        ctx.fillStyle = c.stage
        circle(X(d.x), Y(d.y), d.r * k)
        ctx.fill()
      }
      ctx.lineWidth = 1
      for (const f of p.sys.files) {
        if (off(f)) continue
        ctx.globalAlpha = s.sysA
        ctx.strokeStyle = c.rule
        circle(X(f.x), Y(f.y), f.r * k)
        ctx.stroke()
        // the sun: a hollow mark, so it is not taken for a function
        ctx.strokeStyle = c.faint
        circle(X(f.x), Y(f.y), clamp(4 * k, 1.5, 7))
        ctx.stroke()
        if (f.r * k > 34) {
          ctx.globalAlpha = s.sysA
          ctx.font = small
          ctx.textAlign = 'center'
          ctx.fillStyle = c.muted
          ctx.fillText(fitText(f.label, small, f.r * k * 2 + 16), X(f.x), Y(f.y + f.r) + 10)
        }
      }
      ctx.font = strong
      ctx.textAlign = 'center'
      for (const d of p.sys.dirs) {
        if (off({ ...d, r: d.r + 30 / k }) || d.r * k < 26) continue
        ctx.globalAlpha = s.sysA * (p.dirsOn.size && !p.dirsOn.has(d.dir) ? 0.45 : 1)
        const label = fitText(d.label, strong, Math.max(90, d.r * k * 2))
        const lw = width(label, strong)
        const ly = Y(d.y - d.r) - 12
        ctx.fillStyle = dirColor(d.dir, p.dark)
        circle(X(d.x) - lw / 2 - 9, ly, 3.5)
        ctx.fill()
        ctx.fillStyle = c.ink
        ctx.fillText(label, X(d.x), ly)
      }
    }

    const at = (i: number) => s.cur.get(i)
    const line = (a: Dot, b: Dot, bend: number) => {
      const ax = X(a.x), ay = Y(a.y), bx = X(b.x), by = Y(b.y)
      ctx.beginPath()
      ctx.moveTo(ax, ay)
      if (bend) ctx.quadraticCurveTo((ax + bx) / 2 - (by - ay) * bend, (ay + by) / 2 + (bx - ax) * bend, bx, by)
      else ctx.lineTo(bx, by)
      ctx.stroke()
    }

    // every call at once, faint: where the repo is dense
    if (p.mode === 'systems' && p.wires) {
      ctx.globalAlpha = 0.5 * s.sysA
      ctx.strokeStyle = c.wire
      ctx.lineWidth = 1
      ctx.beginPath()
      for (const [i, a] of s.cur)
        for (const o of p.nodes[i].outs) {
          const b = at(o)
          if (!b) continue
          ctx.moveTo(X(a.x), Y(a.y))
          ctx.lineTo(X(b.x), Y(b.y))
        }
      ctx.stroke()
    }

    // one function's orbits
    if (p.orb && s.sysA < 0.99) {
      const a = 1 - s.sysA
      ctx.globalAlpha = a
      ctx.strokeStyle = c.rule
      ctx.lineWidth = 1
      ctx.setLineDash([3, 6])
      for (const r of p.orb.rings) {
        circle(X(0), Y(0), r * k)
        ctx.stroke()
      }
      ctx.setLineDash([])
      ctx.lineWidth = 1.25
      for (const l of p.orb.links) {
        const from = at(l.a), to = at(l.b)
        if (!from || !to) continue
        const lit = s.hover < 0 || l.a === s.hover || l.b === s.hover
        ctx.globalAlpha = a * Math.min(from.a, to.a) * (lit ? 0.8 : 0.2)
        ctx.strokeStyle = l.side === 'out' ? c.thread : c.pin0
        line(from, to, 0)
      }
    }

    // the calls of the function under the pointer, or of the one picked
    // a flow: the calls already walked are drawn full, the ones still ahead faint
    if (p.flow && s.sysA > 0.5) {
      ctx.strokeStyle = c.thread
      ctx.fillStyle = c.thread
      ctx.lineWidth = 1.5
      for (const l of p.flow.links) {
        const a = at(l.a), b = at(l.b)
        if (!a || !b) continue
        ctx.globalAlpha = Math.min(a.a, b.a) * (p.flow.no.get(l.b)! <= p.step ? 0.9 : 0.28)
        ctx.setLineDash(l.impl ? [4, 4] : [])
        line(a, b, 0.14)
        // an arrowhead where the call lands, pointing the way the curve comes in
        const ax = X(a.x), ay = Y(a.y), bx = X(b.x), by = Y(b.y)
        const dir = Math.atan2(by - ((ay + by) / 2 + (bx - ax) * 0.14), bx - ((ax + bx) / 2 - (by - ay) * 0.14))
        const r = Math.max(p.nodes[l.b].r * k, 2) + 2
        const tx = bx - Math.cos(dir) * r, ty = by - Math.sin(dir) * r
        ctx.setLineDash([])
        ctx.beginPath()
        ctx.moveTo(tx, ty)
        ctx.lineTo(tx - Math.cos(dir - 0.42) * 8, ty - Math.sin(dir - 0.42) * 8)
        ctx.lineTo(tx - Math.cos(dir + 0.42) * 8, ty - Math.sin(dir + 0.42) * 8)
        ctx.closePath()
        ctx.fill()
      }
    }
    const cur = p.flow ? p.flow.ids[p.step] : p.sel

    const focus = p.mode === 'systems' ? (s.hover >= 0 ? s.hover : p.flow ? -1 : p.sel) : -1
    const near = focus >= 0 && at(focus) ? new Set([focus, ...p.nodes[focus].ins, ...p.nodes[focus].outs]) : null
    if (near) {
      const me = at(focus)!
      ctx.lineWidth = 1.4
      ctx.globalAlpha = 0.85
      ctx.strokeStyle = c.pin0
      for (const i of p.nodes[focus].ins) if (at(i)) line(at(i)!, me, 0.12)
      ctx.strokeStyle = c.thread
      for (const o of p.nodes[focus].outs) if (at(o)) line(me, at(o)!, 0.12)
    }

    const ring = (i: number, colour: string, lw: number) => {
      const d = at(i)
      if (!d) return
      ctx.globalAlpha = d.a
      ctx.strokeStyle = colour
      ctx.lineWidth = lw
      circle(X(d.x), Y(d.y), Math.max(p.nodes[i].r * k, 2) + 4)
      ctx.stroke()
    }
    for (const [i, d] of s.cur) {
      const n = p.nodes[i]
      const sx = X(d.x), sy = Y(d.y), r = Math.max(n.r * k, 1.6)
      if (sx < -r || sx > w + r || sy < -r || sy > h + r) continue
      ctx.globalAlpha = d.a * (!p.match(n) ? 0.13 : p.flow ? (p.flow.no.has(i) || near?.has(i) ? 1 : 0.13) : near && !near.has(i) ? 0.3 : 1)
      ctx.fillStyle = dirColor(n.dir, p.dark)
      circle(sx, sy, r)
      ctx.fill()
    }
    if (s.hover >= 0 && s.hover !== cur) ring(s.hover, c.muted, 1.5)
    if (cur >= 0) ring(cur, c.ink, 2)

    // names, the most connected first, none on top of another
    const boxes: number[][] = []
    const label = (i: number, force: boolean) => {
      const d = at(i)
      if (!d || d.a < 0.5) return
      const n = p.nodes[i]
      const sx = X(d.x), sy = Y(d.y)
      if (sx < -40 || sx > w + 40 || sy < -20 || sy > h + 20) return
      const font = force ? strong : text
      const no = p.flow?.no.get(i)
      const name = (no == null ? '' : `${no + 1} · `) + (force ? n.qname : n.name.length > 30 ? n.name.slice(0, 29) + '…' : n.name)
      const tw = width(name, font)
      const r = Math.max(n.r * k, 2) + 6
      const sun = p.mode === 'orbit' && i === p.sel
      const left = p.mode === 'orbit' && d.x < -1
      const x0 = sun ? sx - tw / 2 : left ? sx - r - tw : sx + r
      const y0 = sun ? sy - r - 16 : sy - 8
      const box = [x0 - 4, y0 - 1, x0 + tw + 4, y0 + 17]
      if (!force && boxes.some((b) => box[0] < b[2] && box[2] > b[0] && box[1] < b[3] && box[3] > b[1])) return
      boxes.push(box)
      ctx.globalAlpha = 1
      if (force) {
        ctx.fillStyle = c.surface
        ctx.beginPath()
        ctx.roundRect(box[0] - 2, box[1] - 2, box[2] - box[0] + 4, box[3] - box[1] + 4, 6)
        ctx.fill()
        ctx.strokeStyle = c.rule
        ctx.lineWidth = 1
        ctx.stroke()
      }
      ctx.font = font
      ctx.textAlign = 'left'
      if (!force) {
        // a halo in the board's colour keeps a name readable where a line runs under it
        ctx.strokeStyle = c.bg
        ctx.lineWidth = 3.5
        ctx.lineJoin = 'round'
        ctx.globalAlpha = 0.85
        ctx.strokeText(name, x0, y0 + 8.5)
        ctx.globalAlpha = 1
      }
      ctx.fillStyle = force || !near || near.has(i) ? c.ink : c.muted
      ctx.fillText(name, x0, y0 + 8.5)
    }
    if (cur >= 0) label(cur, true)
    if (s.hover >= 0 && s.hover !== cur) label(s.hover, true)
    // the steps just ahead get their names before the rest of the flow does
    if (p.flow) for (let n = 0; n < p.flow.ids.length; n++) label(p.flow.ids[(p.step + 1 + n) % p.flow.ids.length], false)
    if (near) for (const i of near) if (p.match(p.nodes[i]) || !p.filtered) label(i, false)
    let drawn = 0
    for (const i of p.order) {
      if (drawn > 260) break
      const n = p.nodes[i]
      if (!s.cur.has(i) || !p.match(n) || p.flow) continue
      if (p.mode === 'systems' && (n.r * k < 4.4 || (near && !near.has(i) && k < 1.5))) continue
      label(i, false)
      drawn++
    }
    ctx.globalAlpha = 1
    if (again) invalidate()
  }

  // ---- camera ----

  const insets = () => {
    const s = live.current
    const wide = s.w > 760
    // in an orbit the names hang off both sides, so they get room of their own
    const names = scene.current.orb && wide ? 190 : 0
    return { t: wide ? 124 : 276, l: (startOn && wide && !scene.current.orb ? 332 : 24) + names, r: (centre && wide ? 356 : 24) + names, b: 92 + (centre && !wide ? s.h * 0.34 : 0) }
  }
  const flyTo = (to: View, instant = false) => {
    const s = live.current
    to = { ...to, k: clamp(to.k, MIN_K, MAX_K) }
    if (instant || calm) {
      s.view = to
      s.fly = null
    } else s.fly = { from: s.view, to, t0: performance.now() }
    invalidate()
  }
  const fit = (x0: number, y0: number, x1: number, y1: number, instant = false, maxK = 2.2) => {
    const s = live.current
    const i = insets()
    const k = clamp(Math.min(Math.max(80, s.w - i.l - i.r) / Math.max(1, x1 - x0), Math.max(80, s.h - i.t - i.b) / Math.max(1, y1 - y0)), MIN_K, maxK)
    flyTo({ k, x: (x0 + x1) / 2 - (i.l - i.r) / 2 / k, y: (y0 + y1) / 2 - (i.t - i.b) / 2 / k }, instant)
  }
  const fitBodies = (list: (Pt & { r: number })[], instant = false) => {
    if (!list.length) return
    fit(Math.min(...list.map((b) => b.x - b.r)), Math.min(...list.map((b) => b.y - b.r)) - 30, Math.max(...list.map((b) => b.x + b.r)), Math.max(...list.map((b) => b.y + b.r)), instant)
  }
  const fitAll = (instant = false) => {
    const p = scene.current
    if (p.orb) fitBodies([...p.orb.pos.values()].map((q) => ({ ...q, r: 40 })), instant)
    else fitBodies(p.dirsOn.size ? p.sys.dirs.filter((d) => p.dirsOn.has(d.dir)) : p.sys.dirs, instant)
  }
  const fitFlow = (instant = false) => {
    const p = scene.current
    if (p.flow) fitBodies(p.flow.ids.flatMap((i) => (p.sys.pos.has(i) ? [{ ...p.sys.pos.get(i)!, r: 46 }] : [])), instant)
  }
  /** Moves the board only when the spot is out of sight or under a panel. */
  const bringIn = (spot: Pt) => {
    const s = live.current
    const i = insets()
    const sx = (spot.x - s.view.x) * s.view.k + s.w / 2
    const sy = (spot.y - s.view.y) * s.view.k + s.h / 2
    if (sx > i.l + 30 && sx < s.w - i.r - 30 && sy > i.t + 20 && sy < s.h - i.b - 20) return
    flyTo({ k: s.view.k, x: spot.x - (i.l - i.r) / 2 / s.view.k, y: spot.y - (i.t - i.b) / 2 / s.view.k })
  }
  const showNode = (i: number, instant = false) => {
    const spot = scene.current.sys.pos.get(i)
    if (!spot) return fitAll(instant)
    const s = live.current
    const k = Math.max(s.view.k, 1.25)
    const ins = insets()
    flyTo({ k, x: spot.x - (ins.l - ins.r) / 2 / k, y: spot.y - (ins.t - ins.b) / 2 / k }, instant)
  }
  const zoomAt = (px: number, py: number, factor: number) => {
    const s = live.current
    const k = clamp(s.view.k * factor, MIN_K, MAX_K)
    const wx = (px - s.w / 2) / s.view.k + s.view.x
    const wy = (py - s.h / 2) / s.view.k + s.view.y
    s.fly = null
    s.view = { k, x: wx - (px - s.w / 2) / k, y: wy - (py - s.h / 2) / k }
    invalidate()
  }
  const zoomBy = (factor: number) => {
    const s = live.current
    flyTo({ ...s.view, k: s.view.k * factor })
  }

  // ---- the canvas: size, colours, pointer ----

  const act = useRef({ click: (_i: number, _twice: boolean) => {}, file: (_b: Body) => {}, clear: () => {} })
  act.current = {
    click: (i, twice) => {
      const sym = model.nodes[i].sym
      if (mode === 'orbit') return i === centre?.i ? undefined : onSelect(sym, 'orbit', true)
      if (twice) return onSelect(sym, 'orbit', true)
      // in a flow, a function that is part of it is a step to go to
      if (route?.no.has(i)) return setStep(route.no.get(i)!)
      quiet.current = true
      onSelect(sym, 'pick', false)
    },
    file: (b) => fitBodies([b]),
    clear: () => {
      if (mode === 'systems' && centre && !flowing) onSelect(null, 'pick', false)
    },
  }

  useEffect(() => {
    const cv = canvas.current!
    const s = live.current
    const resize = () => {
      const r = cv.getBoundingClientRect()
      s.w = r.width
      s.h = r.height
      s.dpr = Math.min(2, window.devicePixelRatio || 1)
      cv.width = Math.round(s.w * s.dpr)
      cv.height = Math.round(s.h * s.dpr)
      invalidate()
    }
    resize()
    const ro = new ResizeObserver(resize)
    ro.observe(cv)

    const hit = (px: number, py: number): { node: number } | { file: Body } | null => {
      const p = scene.current
      const { k } = s.view
      const wx = (px - s.w / 2) / k + s.view.x
      const wy = (py - s.h / 2) / k + s.view.y
      let best = -1
      let bestD = Infinity
      for (const [i, d] of s.cur) {
        if (d.a < 0.5) continue
        const dist = Math.hypot(d.x - wx, d.y - wy)
        if (dist <= Math.max(p.nodes[i].r, 2 / k) + 6 / k && dist < bestD) {
          best = i
          bestD = dist
        }
      }
      if (best >= 0) return { node: best }
      if (p.mode === 'systems') for (const f of p.sys.files) if (Math.hypot(f.x - wx, f.y - wy) <= Math.max(9, 10 / k)) return { file: f }
      return null
    }
    const local = (e: { clientX: number; clientY: number }) => {
      const r = cv.getBoundingClientRect()
      return { x: e.clientX - r.left, y: e.clientY - r.top }
    }

    const down = new Map<number, Pt>()
    let moved = 0
    let pinch = 0
    const onDown = (e: PointerEvent) => {
      cv.setPointerCapture(e.pointerId)
      down.set(e.pointerId, local(e))
      if (down.size === 1) moved = 0
      if (down.size === 2) {
        const [a, b] = [...down.values()]
        pinch = Math.hypot(a.x - b.x, a.y - b.y)
      }
    }
    const onMove = (e: PointerEvent) => {
      const now = local(e)
      const was = down.get(e.pointerId)
      if (!was) {
        const h = hit(now.x, now.y)
        const hover = h && 'node' in h ? h.node : -1
        cv.style.cursor = h ? 'pointer' : 'grab'
        if (hover !== s.hover) {
          s.hover = hover
          invalidate()
        }
        return
      }
      down.set(e.pointerId, now)
      if (down.size === 2) {
        const [a, b] = [...down.values()]
        const d = Math.hypot(a.x - b.x, a.y - b.y)
        if (pinch) zoomAt((a.x + b.x) / 2, (a.y + b.y) / 2, d / pinch)
        pinch = d
        moved = 99
        return
      }
      moved += Math.abs(now.x - was.x) + Math.abs(now.y - was.y)
      if (moved < 4) return
      cv.style.cursor = 'grabbing'
      s.fly = null
      s.view = { ...s.view, x: s.view.x - (now.x - was.x) / s.view.k, y: s.view.y - (now.y - was.y) / s.view.k }
      invalidate()
    }
    const onUp = (e: PointerEvent) => {
      const was = down.get(e.pointerId)
      down.delete(e.pointerId)
      pinch = 0
      if (!was || down.size || moved >= 4) return
      const h = hit(was.x, was.y)
      if (!h) act.current.clear()
      else if ('node' in h) act.current.click(h.node, false)
      else act.current.file(h.file)
    }
    const onDouble = (e: MouseEvent) => {
      const at = local(e)
      const h = hit(at.x, at.y)
      if (h && 'node' in h) act.current.click(h.node, true)
      else if (!h) zoomAt(at.x, at.y, 1.8)
    }
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const at = local(e)
      zoomAt(at.x, at.y, Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : e.deltaMode ? 0.05 : 0.0016)))
    }
    const onLeave = () => {
      if (s.hover >= 0) {
        s.hover = -1
        invalidate()
      }
    }
    cv.addEventListener('pointerdown', onDown)
    cv.addEventListener('pointermove', onMove)
    cv.addEventListener('pointerup', onUp)
    cv.addEventListener('pointercancel', onUp)
    cv.addEventListener('pointerleave', onLeave)
    cv.addEventListener('dblclick', onDouble)
    cv.addEventListener('wheel', onWheel, { passive: false })
    return () => {
      ro.disconnect()
      cancelAnimationFrame(s.raf)
      s.raf = 0
      cv.removeEventListener('pointerdown', onDown)
      cv.removeEventListener('pointermove', onMove)
      cv.removeEventListener('pointerup', onUp)
      cv.removeEventListener('pointercancel', onUp)
      cv.removeEventListener('pointerleave', onLeave)
      cv.removeEventListener('dblclick', onDouble)
      cv.removeEventListener('wheel', onWheel)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // the canvas cannot read CSS variables as it draws, so they are copied whenever the theme flips
  useEffect(() => {
    const s = live.current
    const css = getComputedStyle(document.documentElement)
    for (const name of ['bg', 'stage', 'surface', 'ink', 'muted', 'faint', 'rule', 'thread', 'pin0']) s.colors[name] = css.getPropertyValue('--' + name).trim()
    s.colors.wire = dark ? 'rgb(255 255 255 / 0.13)' : 'rgb(0 0 0 / 0.11)'
    s.font = getComputedStyle(document.body).fontFamily
    s.widths.clear()
    invalidate()
    // the web font may land after the first frame
    document.fonts?.ready.then(() => (s.widths.clear(), invalidate()))
  }, [dark, invalidate])

  // a new layout: everything glides from where it is to where it belongs, and the camera follows
  useEffect(() => {
    const s = live.current
    const first = !s.cur.size
    if (first || calm) {
      s.cur = new Map([...target].map(([i, p]) => [i, { x: p.x, y: p.y, a: 1 }]))
      s.from = null
      s.sysA = mode === 'systems' ? 1 : 0
    } else {
      s.from = new Map(s.cur)
      s.t0 = performance.now()
    }
    s.to = target
    s.hover = -1
    if (scene.current.flow) fitFlow(first)
    else if (mode === 'systems' && centre) showNode(centre.i, first)
    else fitAll(first)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target])

  // a function picked from a list or a link is brought into view; one clicked on the board already is
  const selected = centre?.i ?? -1
  const lastSel = useRef(selected)
  useEffect(() => {
    if (lastSel.current === selected) return
    lastSel.current = selected
    if (flowing) return void (quiet.current = false)
    if (!quiet.current) return void (mode === 'systems' && selected >= 0 && showNode(selected))
    quiet.current = false
    // clicked on the board: it stays put, unless the panel that just opened would cover the function
    const s = live.current
    const spot = sys.pos.get(selected)
    if (!spot || mode !== 'systems') return
    const i = insets()
    const sx = (spot.x - s.view.x) * s.view.k + s.w / 2
    const sy = (spot.y - s.view.y) * s.view.k + s.h / 2
    const dx = Math.max(0, sx - (s.w - i.r - 40))
    const dy = Math.max(0, sy - (s.h - i.b - 30))
    if (dx || dy) flyTo({ ...s.view, x: s.view.x + dx / s.view.k, y: s.view.y + dy / s.view.k })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected])

  // a flow starts at its first step with all of it in view; each step after that is brought in if it is out of sight
  useEffect(() => {
    setStep(0)
    if (route) fitFlow()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route])
  const stepRow = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    const spot = route && sys.pos.get(route.ids[at])
    if (spot && at > 0) bringIn(spot)
    if (at > 0) stepRow.current?.scrollIntoView({ block: 'nearest' })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [at])

  useEffect(() => {
    invalidate()
  })

  // ---- what the panels do ----

  const pick = (n: SNode) => onSelect(n.sym, mode === 'orbit' ? 'orbit' : 'pick', mode === 'orbit')
  const follow = (sym: Sym) => {
    if (live.current.w <= 760) setStartOn(false)
    onSelect(sym, 'flow', true)
  }
  const go = (by: number) => route && setStep((n) => clamp(n + by, 0, route.ids.length - 1))
  const toggleDir = (dir: number) => {
    const next = new Set(dirsOn)
    if (!next.delete(dir)) next.add(dir)
    setDirsOn(next)
    if (mode === 'systems') {
      scene.current.dirsOn = next
      fitAll()
    }
  }
  const reset = () => {
    setQuery('')
    setRole('all')
    setDirsOn(new Set())
  }
  const onKey = (e: KeyboardEvent) => {
    const typing = (e.target as HTMLElement).tagName === 'INPUT'
    if (e.key === 'Escape') {
      if (typing && query) setQuery('')
      else if (mode === 'orbit' && centre) onSelect(centre.sym, 'pick', true)
      else if (flowing) onSelect(null, 'pick', true)
      else if (centre) onSelect(null, 'pick', false)
      return
    }
    if (typing || e.metaKey || e.ctrlKey || e.altKey) return
    if (route && (e.key === 'ArrowRight' || e.key === 'ArrowLeft')) {
      go(e.key === 'ArrowRight' ? 1 : -1)
      return e.preventDefault()
    }
    const s = live.current
    const step = 90 / s.view.k
    const move: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }
    if (move[e.key]) flyTo({ ...s.view, x: s.view.x + move[e.key][0], y: s.view.y + move[e.key][1] })
    else if (e.key === '+' || e.key === '=') zoomBy(1.4)
    else if (e.key === '-') zoomBy(1 / 1.4)
    else if (e.key === '0' || e.key === 'f') fitAll()
    else if (e.key === '/') search.current?.focus()
    else return
    e.preventDefault()
  }

  const dirs = model.dirs.map((d, i) => ({ ...d, i })).filter((d) => d.count && (showTests || !d.test)).sort((a, b) => b.count - a.count)
  const shown = target.size
  const callers = centre ? [...centre.ins].sort((a, b) => Number(model.nodes[a].test) - Number(model.nodes[b].test)).map((i) => model.nodes[i]) : []
  const callees = centre ? centre.outs.map((i) => model.nodes[i]) : []
  /** A name typed to find one function has done its job once that function is picked. */
  const found = (n: SNode) => (setQuery(''), pick(n))
  const row = (n: SNode, go = pick) => (
    <button key={n.i} className="sp-row" onClick={() => go(n)} title={`${n.qname}, in ${index.files[n.file].path}`}>
      <i style={{ background: dirColor(n.dir, dark) }} />
      <span>
        {n.name}
        {n.qname !== n.name && <em> {n.qname.slice(0, -n.name.length - 1)}</em>}
      </span>
    </button>
  )
  const some = (list: SNode[]) => (
    <>
      {list.slice(0, LIST).map((n) => row(n))}
      {list.length > LIST && centre && (
        <Go to={toFunction(index, centre.sym)} className="sp-rest">
          and {list.length - LIST} more on its page
        </Go>
      )}
    </>
  )

  // ---- start here, and the flow panel ----

  const sq = startQ.trim().toLowerCase()
  const entryRow = (e: Entry) => {
    const n = model.byId.get(e.sym.id)!
    const space = e.kind === 'http' ? e.label.indexOf(' ') : -1
    return (
      <button key={n.i} className="sp-row" aria-pressed={flowing && centre?.i === n.i} onClick={() => follow(e.sym)} title={`${n.qname}, in ${index.files[n.file].path}. It can end up calling ${plural(e.reach, 'function')}.`}>
        <i style={{ background: dirColor(n.dir, dark) }} />
        {space > 0 ? (
          <span>
            <small>{e.label.slice(0, space)}</small> {e.label.slice(space + 1)} <em>{n.name}</em>
          </span>
        ) : (
          <span>
            {n.name}
            <em> {e.kind === 'other' ? n.qname.slice(0, -n.name.length - 1) : `${n.qname.slice(0, -n.name.length - 1)} · ${e.label}`}</em>
          </span>
        )}
        <b>{e.reach}</b>
      </button>
    )
  }
  const groups = ENTRY_KINDS.map(([kind, label, title]) => {
    const all = entries.filter((e) => e.kind === kind)
    const list = sq ? all.filter((e) => (e.label + ' ' + qualifiedName(index, e.sym)).toLowerCase().includes(sq)) : all
    return { kind, label, title, list, open: !!sq || allOf.has(kind) }
  }).filter((g) => g.list.length)
  const stepNow = flowed?.steps[at]
  const stepFiles = flowed ? new Set(flowed.steps.map((st) => st.sym.def.file)).size : 0
  const entryNow = flowing && centre ? entries.find((e) => e.sym === centre.sym) : undefined

  if (!model.nodes.length)
    return (
      <div className="plate max-w-[72ch]">
        <p className="m-0">This index has no functions to place. Rebuild it with the current scripts/build-index.mjs, or open another index.</p>
      </div>
    )

  return (
    <div ref={wrap} className="space" onKeyDown={onKey}>
      <canvas
        ref={canvas}
        tabIndex={0}
        role="img"
        aria-label={
          mode === 'orbit' && centre
            ? `${centre.qname} in the middle, with the functions it calls on the right and the ones that call it on the left. The same lists are in the panel beside it.`
            : `${plural(shown, 'function')} of ${index.meta.repo ?? 'this repo'} placed by folder and file. Use the search field to find one.`
        }
      />

      <div className="sp-bar" role="search">
        {mode === 'orbit' && centre && (
          <button className="sp-back" onClick={() => onSelect(centre.sym, 'pick', true)} title="Back to every function, with this one still picked (Esc)">
            ← Whole repo
          </button>
        )}
        {entries.length > 0 && mode === 'systems' && (
          <div className="sp-seg">
            <button aria-pressed={startOn} onClick={() => setStartOn(!startOn)} title="The places where work begins in this repo: routes, timers, listeners, main">
              Start here
            </button>
          </div>
        )}
        <div className="sp-find">
          <input ref={search} type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={`Find among ${shown} functions`} aria-label="Find functions by name" onKeyDown={(e) => e.key === 'Enter' && hits.length && found(model.nodes[hits[0]])} />
          {q && (
            <div className="sp-hits">
              {hits.slice(0, LIST).map((i) => row(model.nodes[i], found))}
              <p>{hits.length ? `${plural(hits.length, 'match')}${hits.length > LIST ? ', the most connected first' : ''}. Enter picks the first.` : 'No function matches.'}</p>
            </div>
          )}
        </div>
        <div className="sp-seg" role="group" aria-label="Which functions stand out">
          {ROLES.map(([key, label, title]) => (
            <button key={key} title={title} aria-pressed={role === key} onClick={() => setRole(key)}>
              {label}
            </button>
          ))}
        </div>
        {mode === 'orbit' ? (
          <div className="sp-seg" role="group" aria-label="How many calls away to draw">
            {[1, 2, 3].map((d) => (
              <button key={d} aria-pressed={depth === d} onClick={() => setDepth(d)} title={`Draw functions up to ${plural(d, 'call')} away`}>
                {plural(d, 'call')} away
              </button>
            ))}
          </div>
        ) : (
          <div className="sp-seg">
            {hasTests && (
              <button aria-pressed={showTests} onClick={() => setTests(!tests)} disabled={!!centre?.test} title="Put functions defined in test folders on the board too">
                Tests
              </button>
            )}
            <button aria-pressed={wires} onClick={() => setWires(!wires)} title="Draw every call at once, faintly">
              All calls
            </button>
          </div>
        )}
        <p className="sp-note">
          {filtered ? `${hits.length} of ${shown} stand out.` : flowed ? `${plural(flowed.steps.length, 'function')} in this flow.` : mode === 'orbit' ? `${plural(shown, 'function')} drawn${orb?.more ? `, ${orb.more} more left out` : ''}.` : `${plural(shown, 'function')} in ${plural(sys.files.length, 'file')}.`}
          {filtered && (
            <button onClick={reset}>Reset</button>
          )}
        </p>
      </div>

      {centre && flowed && stepNow && (
        <aside className="sp-card" aria-label={`The flow from ${centre.qname}`}>
          <header>
            <span className="chip">Flow</span>
            {entryNow && entryNow.kind !== 'other' && <span className="chip min-w-0"><span className="truncate">{entryNow.label}</span></span>}
            <button className="icon-btn ml-auto h-7 w-7 flex-none" onClick={() => onSelect(null, 'pick', true)} aria-label="Leave the flow" title="Leave the flow (Esc)">
              ✕
            </button>
          </header>
          <h2>{centre.qname}</h2>
          <p className="sp-says">
            {flowed.steps.length > 1
              ? `Once it is set off it reaches ${plural(flowed.steps.length - 1, 'function')} in ${plural(stepFiles, 'file')}, listed in the order the code calls them.${flowed.more ? ` ${flowed.more} more, further on, are not drawn.` : ''}`
              : 'It calls nothing else in this repo.'}
          </p>
          {flowed.steps.length > 1 && (
            <div className="sp-stepper">
              <button className="btn" onClick={() => go(-1)} disabled={at === 0} title="The step before (←)">
                ← Back
              </button>
              <span>
                Step {at + 1} of {flowed.steps.length}
              </span>
              <button className="btn primary" onClick={() => go(1)} disabled={at === flowed.steps.length - 1} title="The next step (→)">
                Next →
              </button>
            </div>
          )}
          <div className="sp-now">
            <b>{qualifiedName(index, stepNow.sym)}</b>
            <span>
              {stepNow.parent < 0
                ? `${base(index.files[stepNow.sym.def.file].path)}:${stepNow.sym.def.line}. This is where the flow starts.`
                : stepNow.impl
                  ? `Carries out ${qualifiedName(index, flowed.steps[stepNow.parent].sym)}, which is only declared.`
                  : `Called by ${flowed.steps[stepNow.parent].sym.name} at ${base(index.files[stepNow.at!.file].path)}:${stepNow.at!.line}.`}
            </span>
            <div className="sp-acts">
              <Go to={toFunction(index, stepNow.sym)} className="btn">
                Read the code
              </Go>
              <button className="btn" onClick={() => onSelect(stepNow.sym, 'orbit', true)}>
                Its orbit
              </button>
              {at > 0 && (
                <button className="btn" onClick={() => follow(stepNow.sym)} title="Start a new flow from this function">
                  Follow from here
                </button>
              )}
            </div>
          </div>
          <ol className="sp-steps">
            {flowed.steps.map((st, n) => (
              <li key={st.sym.id}>
                <button ref={n === at ? stepRow : undefined} className="sp-row" aria-current={n === at ? 'step' : undefined} style={{ paddingLeft: 8 + Math.min(st.depth, 6) * 11 }} onClick={() => setStep(n)} title={qualifiedName(index, st.sym)}>
                  <small>{n + 1}</small>
                  <span>
                    {st.sym.name}
                    <em> {qualifiedName(index, st.sym).slice(0, -st.sym.name.length - 1)}</em>
                  </span>
                </button>
              </li>
            ))}
          </ol>
        </aside>
      )}

      {centre && !flowed && (
        <aside className="sp-card" aria-label={`About ${centre.qname}`}>
          <header>
            <span className="chip">{centre.sym.kind}</span>
            <span className="chip min-w-0">
              <i className="sp-dot" style={{ background: dirColor(centre.dir, dark) }} />
              <span className="truncate">{model.dirs[centre.dir].label}</span>
            </span>
            {mode === 'systems' && (
              <button className="icon-btn ml-auto h-7 w-7 flex-none" onClick={() => onSelect(null, 'pick', false)} aria-label="Close">
                ✕
              </button>
            )}
          </header>
          <h2>{centre.qname}</h2>
          <p className="sp-where">
            {base(index.files[centre.file].path)}:{centre.sym.def.line}
          </p>
          <p className="sp-says">{describeSymbol(index, centre.sym).headline}</p>
          <div className="sp-acts">
            {mode === 'systems' ? (
              <>
                <button className="btn primary" onClick={() => onSelect(centre.sym, 'orbit', true)} title="Put this function in the middle, with what it calls and what calls it around it">
                  See its orbit
                </button>
                {callees.length > 0 && (
                  <button className="btn" onClick={() => follow(centre.sym)} title="Light up everything this function sets off, in the order the code is written, and walk it step by step">
                    Follow it
                  </button>
                )}
              </>
            ) : (
              <button className="btn primary" onClick={() => onSelect(centre.sym, 'pick', true)}>
                Find it in the repo
              </button>
            )}
            <Go to={toFunction(index, centre.sym)} className="btn">
              Read the code
            </Go>
            <Go to={toThreads(index, centre.sym)} className="btn">
              Threads
            </Go>
          </div>
          <h3>
            <i className="sp-dot" style={{ background: 'var(--pin0)' }} />
            Called by {callers.length}
          </h3>
          {callers.length ? some(callers) : <p className="sp-none">Nothing in this repo calls it.</p>}
          <h3>
            <i className="sp-dot" style={{ background: 'var(--thread)' }} />
            Calls {callees.length}
          </h3>
          {callees.length ? some(callees) : <p className="sp-none">It calls nothing else in this repo.</p>}
        </aside>
      )}

      <div className={`sp-side${centre ? ' with-card' : ''}`}>
      {startOn && mode === 'systems' && entries.length > 0 && (
        <section className="sp-start" aria-label="Start here">
          <header>
            <h2>Start here</h2>
            <button className="icon-btn h-7 w-7 flex-none" onClick={() => setStartOn(false)} aria-label="Close">
              ✕
            </button>
          </header>
          <p>Where work begins in this repo. Pick one to follow what it sets off, step by step.</p>
          {entries.length > FEW && <input type="search" value={startQ} onChange={(e) => setStartQ(e.target.value)} placeholder={`Filter ${entries.length} starting points`} aria-label="Filter the starting points" />}
          <div className="sp-list">
            {groups.map((g) => (
              <div key={g.kind}>
                <h3 title={g.title}>
                  {g.label} <span>{g.list.length}</span>
                </h3>
                {(g.open ? g.list : g.list.slice(0, FEW)).map(entryRow)}
                {!g.open && g.list.length > FEW && (
                  <button className="sp-rest" onClick={() => setAllOf(new Set(allOf).add(g.kind))}>
                    Show all {g.list.length}
                  </button>
                )}
              </div>
            ))}
            {!groups.length && <p>No starting point matches.</p>}
          </div>
        </section>
      )}
      {dirs.length > 1 && (
        <div className="sp-legend">
          <header>
            <button onClick={() => setLegend(!legend)} aria-expanded={legend}>
              Folders <span>{dirs.length}</span>
            </button>
            {dirsOn.size > 0 && <button onClick={() => (setDirsOn(new Set()), (scene.current.dirsOn = new Set()), mode === 'systems' && fitAll())}>Show all</button>}
          </header>
          {legend && (
            <div className="sp-dirs">
              {dirs.map((d) => (
                <button key={d.i} className="sp-row" aria-pressed={dirsOn.has(d.i)} onClick={() => toggleDir(d.i)} title={`${d.path || 'top folder'}: ${plural(d.count, 'function')}. Click to make this folder stand out.`}>
                  <i style={{ background: dirColor(d.i, dark) }} />
                  <span>{d.label}</span>
                  <b>{d.count}</b>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
      </div>

      <div className="sp-zoom">
        <span>{flowed ? 'Drag to move, scroll to zoom, ← → to step through the flow' : 'Drag to move, scroll to zoom, double-click a function for its orbit'}</span>
        <button onClick={() => zoomBy(1 / 1.5)} aria-label="Zoom out" title="Zoom out (-)">
          −
        </button>
        <button onClick={() => zoomBy(1.5)} aria-label="Zoom in" title="Zoom in (+)">
          +
        </button>
        <button onClick={() => fitAll()} title="Fit everything on screen (F)">
          Fit
        </button>
      </div>
    </div>
  )
}
