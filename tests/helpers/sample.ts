import { readFileSync } from 'node:fs'
import { buildIndex } from '../../src/data/index'
import type { RawIndex } from '../../src/types'

/** The committed index of the sample project (three Kotlin files: controller, service, store). */
export const rawSample = (): RawIndex => JSON.parse(readFileSync(new URL('../../public/data/sample.json', import.meta.url), 'utf8'))
export const sample = () => buildIndex(rawSample(), 'data/sample.json')
