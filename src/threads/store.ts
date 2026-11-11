import { create } from 'zustand'

export const MAX_PANES = 4
export const PIN_COLORS = ['var(--pin0)', 'var(--pin1)', 'var(--pin2)']
/** Above this many usages a symbol draws one thread per file, with a count. */
export const COLLAPSE = 25

export interface OpenPane {
  file: number
  /** Higher is more recent. The lowest closes when a fifth file opens. */
  used: number
}

export interface ThreadsState {
  open: OpenPane[]
  focus: string | null
  hover: string | null
  /** "file:line" of the gutter mark whose library symbols are listed. */
  lib: string | null
  pins: (string | null)[]
  all: boolean
  clock: number
  reset(files: number[], focus: string | null): void
  /** Opens a file as a pane, or marks it as just used. */
  openFile(file: number): void
  closeFile(file: number): void
  setFocus(id: string | null): void
  setHover(id: string | null): void
  setLib(key: string | null): void
  togglePin(): void
  unpin(slot: number): void
  setAll(all: boolean): void
  clear(): void
}

export const useThreads = create<ThreadsState>((set, get) => ({
  open: [],
  focus: null,
  hover: null,
  lib: null,
  pins: [null, null, null],
  all: false,
  clock: 0,
  reset(files, focus) {
    const open = [...new Set(files)].slice(0, MAX_PANES).map((file, i) => ({ file, used: i + 1 }))
    set({ open, focus, hover: null, lib: null, pins: [null, null, null], all: false, clock: open.length })
  },
  openFile(file) {
    const { open, clock } = get()
    const used = clock + 1
    if (open.some((p) => p.file === file)) {
      set({ open: open.map((p) => (p.file === file ? { ...p, used } : p)), clock: used })
      return
    }
    let next = open
    if (next.length >= MAX_PANES) {
      const oldest = next.reduce((x, y) => (y.used < x.used ? y : x))
      next = next.filter((p) => p !== oldest)
    }
    set({ open: [...next, { file, used }], clock: used })
  },
  closeFile(file) {
    set({ open: get().open.filter((p) => p.file !== file) })
  },
  setFocus(focus) {
    set({ focus, hover: null, lib: focus ? null : get().lib })
  },
  setHover(hover) {
    if (hover !== get().hover) set({ hover })
  },
  setLib(lib) {
    set({ lib, focus: null, hover: null })
  },
  togglePin() {
    const { focus, pins } = get()
    if (!focus) return
    const at = pins.indexOf(focus)
    const free = pins.indexOf(null)
    if (at >= 0) set({ pins: pins.map((p, i) => (i === at ? null : p)) })
    else if (free >= 0) set({ pins: pins.map((p, i) => (i === free ? focus : p)) })
  },
  unpin(slot) {
    set({ pins: get().pins.map((p, i) => (i === slot ? null : p)) })
  },
  setAll(all) {
    set({ all })
  },
  clear() {
    set({ focus: null, lib: null })
  },
}))

/** Pins first, then the hovered or locked symbol, each with its colour. */
export function activeSymbols(s: Pick<ThreadsState, 'pins' | 'hover' | 'focus'>): { id: string; color: string }[] {
  const list: { id: string; color: string }[] = []
  s.pins.forEach((id, i) => {
    if (id) list.push({ id, color: PIN_COLORS[i] })
  })
  const shown = s.hover ?? s.focus
  if (shown && !s.pins.includes(shown)) list.push({ id: shown, color: 'var(--thread)' })
  return list
}
