import { describe, expect, it } from 'vitest'
import { findFile } from '../src/data/index'
import { COLW, GAPX, SIDE, buildFileGraph, edgePath, groupFiles, layoutGroups, topFlows } from '../src/map/fileGraph'
import { sample } from './helpers/sample'

const index = sample()
const graph = buildFileGraph(index)
const controller = findFile(index, 'MessageController.kt')
const service = findFile(index, 'MessageService.kt')
const store = findFile(index, 'MessageStore.kt')

describe('buildFileGraph', () => {
  it('follows the layers: controller uses service and store, service uses store', () => {
    expect([...graph.uses[controller].keys()].sort()).toEqual([service, store].sort())
    expect([...graph.uses[service].keys()]).toEqual([store])
    expect(graph.uses[store].size).toBe(0)
  })

  it('mirrors every edge', () => {
    graph.uses.forEach((m, a) => m.forEach((n, b) => expect(graph.usedBy[b].get(a)).toBe(n)))
    expect(graph.inbound[store]).toBe([...graph.usedBy[store].values()].reduce((x, y) => x + y, 0))
    expect(graph.inbound[controller]).toBe(0)
  })
})

describe('groupFiles', () => {
  it('orders folders from the ones that use to the ones that are used', () => {
    const groups = groupFiles(index, graph, true)
    expect(groups.map((g) => g.label)).toEqual(['api', 'service', 'store'])
    expect(groups.every((g) => g.files.length === 1)).toBe(true)
  })
})

describe('layoutGroups', () => {
  it('uses as many columns as fit and keeps the order', () => {
    const wide = groupFiles(index, graph, true)
    layoutGroups(wide, 3 * COLW + 2 * GAPX + SIDE)
    expect(wide.map((g) => g.col)).toEqual([0, 1, 2])
    expect(wide[0].x).toBeLessThan(wide[1].x)

    const narrow = groupFiles(index, graph, true)
    const layout = layoutGroups(narrow, 340)
    expect(narrow.map((g) => g.col)).toEqual([0, 0, 0])
    expect(narrow[1].y).toBeGreaterThan(narrow[0].y)
    expect(layout.pos.size).toBe(3)
  })
})

describe('edgePath', () => {
  it('leaves from the side facing the other end', () => {
    expect(edgePath({ x: 0, y: 10 }, { x: 300, y: 50 })).toMatchObject({ ex: 300, ey: 50 })
    expect(edgePath({ x: 300, y: 10 }, { x: 0, y: 50 })).toMatchObject({ ex: COLW, ey: 50 })
    expect(edgePath({ x: 0, y: 10 }, { x: 0, y: 50 }).ex).toBe(COLW) // same column: loops on the right
  })
})

describe('topFlows', () => {
  it('ranks folder-to-folder usage', () => {
    const groups = groupFiles(index, graph, true)
    const flows = topFlows(groups, graph, 10)
    expect(flows).toHaveLength(3)
    expect(flows[0].n).toBeGreaterThanOrEqual(flows[1].n)
    expect(flows.every((f) => f.from !== f.to)).toBe(true)
  })
})
