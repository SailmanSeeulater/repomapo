/** Line height of a code row, top padding of a pane, and tab width, all in the units the CSS uses. */
export const LH = 20
export const PAD = 8
export const TAB = 4

/** Visual column of a character offset: a tab advances to the next tab stop. */
export function visualCol(text: string, col: number): number {
  let v = 0
  for (let i = 0; i < col && i < text.length; i++) v = text.charCodeAt(i) === 9 ? v + TAB - (v % TAB) : v + 1
  return v
}

/** Where an occurrence sits inside the stage, clamped to its pane. */
export interface Pt {
  y: number
  /** Left and right edge of the name. */
  l: number
  r: number
  /** True when the real position is scrolled out of the pane. */
  off: boolean
  /** The pane's left, right, top and bottom. */
  pl: number
  pr: number
  pt: number
  pb: number
  /** Which pane (the file index). */
  pane: number
}

export const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi)

/**
 * The curve from a definition to a usage. It leaves from the side facing the other pane; within
 * one pane it loops out to the right. Null when both ends are clamped to the same spot.
 */
export function wirePath(a: Pt, b: Pt, stageWidth: number): { d: string; ex: number } | null {
  if (a.off && b.off && a.pane === b.pane && Math.abs(a.y - b.y) < 2) return null
  if (a.pane !== b.pane && b.pl >= a.pr - 1) {
    const ex = b.l
    const k = Math.max(36, (ex - a.r) * 0.5)
    return { d: `M${a.r},${a.y} C${a.r + k},${a.y} ${ex - k},${b.y} ${ex},${b.y}`, ex }
  }
  if (a.pane !== b.pane && a.pl >= b.pr - 1) {
    const ex = b.r
    const k = Math.max(36, (a.l - ex) * 0.5)
    return { d: `M${a.l},${a.y} C${a.l - k},${a.y} ${ex + k},${b.y} ${ex},${b.y}`, ex }
  }
  const ex = b.r
  const bx = Math.min(stageWidth - 4, Math.max(a.r, ex) + 28 + Math.min(70, Math.abs(a.y - b.y) * 0.25))
  return { d: `M${a.r},${a.y} C${bx},${a.y} ${bx},${b.y} ${ex},${b.y}`, ex }
}

/** The visible window of rows for a scroll position, before overscan. */
export function visibleRows(scrollTop: number, height: number, count: number): [number, number] {
  return [Math.max(0, Math.floor((scrollTop - PAD) / LH)), Math.min(count, Math.ceil((scrollTop + height) / LH) + 1)]
}
