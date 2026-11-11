import { beforeEach, describe, expect, it } from 'vitest'
import { LH, PAD, visibleRows, visualCol, wirePath, type Pt } from '../src/threads/geometry'
import { esc, highlight } from '../src/threads/highlight'
import { MAX_PANES, PIN_COLORS, activeSymbols, useThreads } from '../src/threads/store'

describe('visualCol', () => {
  it('counts a tab to the next tab stop', () => {
    expect(visualCol('abc', 2)).toBe(2)
    expect(visualCol('\tx', 1)).toBe(4)
    expect(visualCol('a\tx', 2)).toBe(4)
    expect(visualCol('\t\tx', 2)).toBe(8)
  })
})

describe('visibleRows', () => {
  it('covers the viewport and stays inside the file', () => {
    expect(visibleRows(0, 480, 1000)).toEqual([0, 25])
    expect(visibleRows(PAD + 10 * LH, 100, 1000)[0]).toBe(10)
    expect(visibleRows(0, 480, 5)).toEqual([0, 5])
  })
})

describe('wirePath', () => {
  const pt = (over: Partial<Pt>): Pt => ({ y: 50, l: 10, r: 60, off: false, pl: 0, pr: 300, pt: 0, pb: 480, pane: 0, ...over })

  it('runs left to right into a pane on the right, ending on the left of the name', () => {
    const w = wirePath(pt({}), pt({ pane: 1, pl: 326, pr: 626, l: 400, r: 450, y: 90 }), 1000)!
    expect(w.ex).toBe(400)
    expect(w.d.startsWith('M60,50')).toBe(true)
  })

  it('runs right to left into a pane on the left, ending on the right of the name', () => {
    const w = wirePath(pt({ pane: 1, pl: 326, pr: 626, l: 400, r: 450 }), pt({ y: 90 }), 1000)!
    expect(w.ex).toBe(60)
    expect(w.d.startsWith('M400,50')).toBe(true)
  })

  it('loops within one pane and stays inside the stage', () => {
    const w = wirePath(pt({}), pt({ y: 400, l: 250, r: 296 }), 310)!
    expect(w.ex).toBe(296)
    expect(w.d).toContain('C306,50')
  })

  it('draws nothing when both ends are scrolled out at the same edge', () => {
    expect(wirePath(pt({ off: true, y: 3 }), pt({ off: true, y: 3 }), 1000)).toBeNull()
  })
})

describe('highlight', () => {
  it('escapes markup', () => {
    expect(esc('a < b && "c"')).toBe('a &lt; b &amp;&amp; &quot;c&quot;')
    expect(highlight('List<Envelope>')).toBe('List&lt;Envelope&gt;')
  })

  it('marks keywords, strings and annotations, and leaves keywords inside strings alone', () => {
    expect(highlight('val x')).toBe('<span class="k">val</span> x')
    expect(highlight('@Service')).toBe('<span class="a">@Service</span>')
    expect(highlight('"return this"')).toBe('<span class="s">&quot;return this&quot;</span>')
    expect(highlight('value')).toBe('value')
  })
})

describe('the threads store', () => {
  const s = () => useThreads.getState()
  beforeEach(() => s().reset([], null))

  it('closes the pane used longest ago when a fifth file opens', () => {
    s().reset([10, 11, 12, 13], null)
    s().openFile(10) // 10 is now the most recent, 11 the oldest
    s().openFile(14)
    expect(s().open.map((p) => p.file)).toEqual([10, 12, 13, 14])
    expect(s().open).toHaveLength(MAX_PANES)
  })

  it('does not reorder panes when one is used again', () => {
    s().reset([1, 2, 3], null)
    s().openFile(1)
    expect(s().open.map((p) => p.file)).toEqual([1, 2, 3])
  })

  it('pins up to three symbols, each with its own colour', () => {
    for (const id of ['a', 'b', 'c', 'd']) {
      s().setFocus(id)
      s().togglePin()
    }
    expect(s().pins).toEqual(['a', 'b', 'c'])
    expect(activeSymbols(s())).toEqual([
      { id: 'a', color: PIN_COLORS[0] },
      { id: 'b', color: PIN_COLORS[1] },
      { id: 'c', color: PIN_COLORS[2] },
      { id: 'd', color: 'var(--thread)' },
    ])
    s().setFocus('b')
    s().togglePin()
    expect(s().pins).toEqual(['a', null, 'c'])
  })

  it('shows the hovered symbol over the locked one, and a pinned one only once', () => {
    s().setFocus('a')
    s().togglePin()
    s().setHover('z')
    expect(activeSymbols(s()).map((a) => a.id)).toEqual(['a', 'z'])
    s().setHover('a')
    expect(activeSymbols(s()).map((a) => a.id)).toEqual(['a'])
  })

  it('clears the lock when a gutter mark is selected, and the mark when a symbol is locked', () => {
    s().setFocus('a')
    s().setLib('0:3')
    expect(s().focus).toBeNull()
    s().setFocus('a')
    expect(s().lib).toBeNull()
  })
})
