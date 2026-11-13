import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { buildIndex } from '../src/data/index'
import { buildModel, dirLabels, orbit, pack, systems } from '../src/space/layout'

const index = buildIndex(JSON.parse(readFileSync(new URL('../public/data/sample.json', import.meta.url), 'utf8')), 'sample')
const model = buildModel(index)
const node = (qname: string) => model.nodes.find((n) => n.qname === qname)!

describe('pack', () => {
  it('places circles without overlap, and the same way every time', () => {
    const radii = [40, 12, 90, 33, 33, 60, 8, 75, 20, 51]
    const spots = pack(radii, 10)
    for (let a = 0; a < radii.length; a++)
      for (let b = a + 1; b < radii.length; b++) expect(Math.hypot(spots[a].x - spots[b].x, spots[a].y - spots[b].y)).toBeGreaterThanOrEqual(radii[a] + radii[b] + 10 - 1e-9)
    expect(pack(radii, 10)).toEqual(spots)
  })
})

describe('dirLabels', () => {
  it('uses the last part of a path, and more of it only to tell folders apart', () => {
    expect(dirLabels(['src/main/app', 'src/main/app/service', 'src/main/app/api', 'src/main/other/api'])).toEqual(['app', 'service', 'app/api', 'other/api'])
  })
  it('names test folders among themselves', () => {
    expect(dirLabels(['src/main/app/service', 'src/test/app/service', ''])).toEqual(['service', 'service (tests)', 'top folder'])
  })
})

describe('buildModel', () => {
  it('has a node per function, with the calls between them', () => {
    const relay = node('MessageService.relay')
    expect(relay.ins.map((i) => model.nodes[i].qname)).toEqual(['MessageController.send'])
    expect(relay.outs.map((i) => model.nodes[i].qname).sort()).toEqual(['MessageRepository.save', 'MessageService.validate'])
    expect(model.dirs.reduce((n, d) => n + d.count, 0)).toBe(model.nodes.length)
  })
})

describe('systems', () => {
  const sys = systems(model, () => true, (f) => index.files[f].path)
  it('puts every function inside its file, and every file inside its folder', () => {
    expect(sys.pos.size).toBe(model.nodes.length)
    for (const n of model.nodes) {
      const file = sys.files.find((f) => f.key === n.file)!
      const p = sys.pos.get(n.i)!
      expect(Math.hypot(p.x - file.x, p.y - file.y)).toBeLessThan(file.r)
      const dir = sys.dirs.find((d) => d.key === n.dir)!
      expect(Math.hypot(file.x - dir.x, file.y - dir.y) + file.r).toBeLessThanOrEqual(dir.r)
    }
  })
  it('keeps functions apart', () => {
    const all = [...sys.pos.values()]
    for (let a = 0; a < all.length; a++) for (let b = a + 1; b < all.length; b++) expect(Math.hypot(all[a].x - all[b].x, all[a].y - all[b].y)).toBeGreaterThan(20)
  })
  it('leaves out what the filter leaves out', () => {
    const one = systems(model, (n) => n.qname.startsWith('MessageService.'), () => '')
    expect(one.files).toHaveLength(1)
    expect(one.pos.size).toBe(model.nodes.filter((n) => n.qname.startsWith('MessageService.')).length)
  })
})

describe('orbit', () => {
  const relay = node('MessageService.relay')
  it('puts what a function calls on its right and what calls it on its left', () => {
    const o = orbit(model, relay.i, 1)
    expect(o.pos.get(relay.i)).toEqual({ x: 0, y: 0 })
    for (const i of relay.outs) expect(o.pos.get(i)!.x).toBeGreaterThan(0)
    for (const i of relay.ins) expect(o.pos.get(i)!.x).toBeLessThan(0)
    expect(o.pos.size).toBe(1 + relay.ins.length + relay.outs.length)
    expect(o.rings).toHaveLength(1)
  })
  it('goes further out with depth, drawing each function once', () => {
    const o = orbit(model, relay.i, 2)
    const key = node('MessageRepository.key')
    expect(Math.hypot(o.pos.get(key.i)!.x, o.pos.get(key.i)!.y)).toBeCloseTo(o.rings[1])
    expect(o.links).toContainEqual({ a: node('MessageRepository.save').i, b: key.i, side: 'out' })
    expect(o.links).toHaveLength(o.pos.size - 1)
  })
  it('counts what it leaves out', () => {
    expect(orbit(model, relay.i, 1, 1).more).toBe(relay.outs.length - 1 + Math.max(0, relay.ins.length - 1))
  })
})
