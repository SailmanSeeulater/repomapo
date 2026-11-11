import { describe, expect, it } from 'vitest'
import { convert, decodeIndex, libraryName, packageOf } from '../scripts/build-index.mjs'
import { document, index, occurrence, symbolInfo } from './helpers/scip.mjs'

const OWN = 'scip-java maven maven/com.acme/app 1.0 '
const JDK = 'scip-java maven jdk 21 '

const userJava = ['package app;', '@Data', 'public class User {', '    private String email;', '}'].join('\n')
const serviceJava = ['package app;', 'class Service {', '    String mail(User user) {', '        return user.getEmail();', '    }', '}'].join('\n')

function fixture() {
  return index({
    documents: [
      document({
        path: 'src/User.java',
        text: userJava,
        occurrences: [
          occurrence({ symbol: OWN + 'app/User#', range: [2, 13, 17], def: true, enclosing: true }),
          // Lombok: the constructor shares the class name's range, the getter is "defined" across lines
          occurrence({ symbol: OWN + 'app/User#`<init>`().', range: [2, 13, 17], def: true }),
          occurrence({ symbol: OWN + 'app/User#email.', range: [3, 19, 24], def: true, encoding: 'typed' }),
          occurrence({ symbol: OWN + 'app/User#getEmail().', range: [1, 0, 1], def: true, multiline: true }),
          // generated code reported at the annotation
          occurrence({ symbol: OWN + 'app/User#', range: [1, 0, 5] }),
          occurrence({ symbol: JDK + 'java/lang/String#', range: [3, 12, 18], encoding: 'packed4' }),
        ],
        symbols: [symbolInfo({ symbol: OWN + 'app/User#', kind: 7, displayName: 'User' })],
      }),
      document({
        path: 'src/Service.java',
        text: serviceJava,
        occurrences: [
          occurrence({ symbol: OWN + 'app/Service#', range: [1, 6, 13], def: true }),
          occurrence({ symbol: OWN + 'app/Service#mail().', range: [2, 11, 15], def: true }),
          occurrence({ symbol: OWN + 'app/User#', range: [2, 16, 20], encoding: 'typed', enclosing: true }),
          occurrence({ symbol: 'local 0', range: [2, 21, 25], def: true }),
          occurrence({ symbol: 'local 0', range: [3, 15, 19] }),
          occurrence({ symbol: OWN + 'app/User#getEmail().', range: [3, 20, 28] }),
          occurrence({ symbol: JDK + 'java/lang/String#', range: [2, 4, 10] }),
          occurrence({ symbol: JDK + 'java/lang/', range: [0, 0, 7] }),
        ],
      }),
    ],
  })
}

const run = (opts = {}) => convert(decodeIndex(fixture()), '/nowhere', { locals: false, ...opts })
const text = (json, o) => json.files[o.file].lines[o.line - 1].slice(o.col, o.col + o.len)

describe('decodeIndex', () => {
  it('reads all three range encodings and skips fields it does not need', () => {
    const idx = decodeIndex(fixture())
    expect(idx.tool).toBe('fixture')
    expect(idx.documents.map((d) => d.path)).toEqual(['src/User.java', 'src/Service.java'])
    const ranges = idx.documents[0].occurrences.map((o) => o.range)
    expect(ranges[0]).toEqual([2, 13, 2, 17]) // packed, three elements, followed by a skipped field
    expect(ranges[2]).toEqual([3, 19, 3, 24]) // typed single-line range
    expect(ranges[5]).toEqual([3, 12, 3, 18]) // packed, four elements
    // the occurrence after one with a skipped length-delimited field still decodes
    expect(idx.documents[1].occurrences[3].symbol).toBe('local 0')
  })
})

describe('convert', () => {
  it('writes every position on the name it belongs to', () => {
    const json = run()
    expect(json.files.map((f) => f.path)).toEqual(['src/Service.java', 'src/User.java'])
    for (const s of json.symbols) expect(text(json, s.def)).toBe(s.name)
  })

  it('merges symbols that share a definition range', () => {
    const json = run()
    const users = json.symbols.filter((s) => s.name === 'User')
    expect(users).toHaveLength(1)
    expect(users[0].kind).toBe('class')
    expect(json.meta.stats.merged).toBe(1)
  })

  it('threads generated getter calls to the field and drops usages reported at annotations', () => {
    const json = run()
    const email = json.symbols.find((s) => s.name === 'email')
    expect(email.refs.map((r) => text(json, r))).toEqual(['getEmail'])
    const user = json.symbols.find((s) => s.name === 'User')
    expect(user.refs.map((r) => text(json, r))).toEqual(['User'])
    expect(json.meta.stats.annotation).toBe(1)
    expect(json.meta.stats.accessors).toBe(1)
  })

  it('leaves locals out unless asked', () => {
    expect(run().symbols.some((s) => s.name === 'user')).toBe(false)
    const withLocals = run({ locals: true }).symbols.find((s) => s.name === 'user')
    expect(withLocals.refs).toHaveLength(1)
  })

  it('lists library symbols per line, without package segments', () => {
    const json = run()
    expect(json.libs).toEqual([{ name: 'String', pkg: 'jdk 21', uses: 2 }])
    expect(json.files[0].libs).toEqual([[3, 0]])
    expect(json.files[1].libs).toEqual([[4, 0]])
  })
})

describe('symbol strings', () => {
  it('splits the package from the descriptor', () => {
    expect(packageOf(JDK + 'java/lang/String#')).toMatchObject({ raw: 'jdk 21', label: 'jdk 21', descriptor: 'java/lang/String#' })
    expect(packageOf('scip-java maven maven/org.springframework/spring-web 6.2.8 org/x/Y#').label).toBe('org.springframework:spring-web 6.2.8')
    expect(packageOf('scip-java maven . . dev/example/A#').label).toBe('')
  })

  it('names a library symbol the way it reads in code', () => {
    expect(libraryName('java/lang/String#')).toBe('String')
    expect(libraryName('java/util/List#of(+1).')).toBe('List.of')
    expect(libraryName('java/lang/RuntimeException#`<init>`(+1).')).toBe('RuntimeException')
    expect(libraryName('java/lang/Integer#MAX_VALUE.')).toBe('Integer.MAX_VALUE')
  })
})
