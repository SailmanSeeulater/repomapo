// A tiny SCIP (protobuf) writer, enough to build index fixtures for the converter tests.
// Field numbers are from scip.proto.
const varint = (n) => {
  const out = []
  let v = BigInt.asUintN(64, BigInt(n))
  do {
    const b = Number(v & 0x7fn)
    v >>= 7n
    out.push(v ? b | 0x80 : b)
  } while (v)
  return Buffer.from(out)
}
const tag = (field, wire) => varint((field << 3) | wire)
export const bytes = (field, buf) => Buffer.concat([tag(field, 2), varint(buf.length), buf])
export const str = (field, s) => bytes(field, Buffer.from(s, 'utf8'))
export const num = (field, n) => Buffer.concat([tag(field, 0), varint(n)])

/**
 * One occurrence. `range` is [line, start, end] (0-based). `encoding` picks how the range is
 * written: 'packed3', 'packed4' or 'typed' (single_line_range, field 8). `enclosing` adds a
 * single_line_enclosing_range (field 10), a length-delimited field the converter must skip.
 */
export function occurrence({ symbol, range, def = false, encoding = 'packed3', enclosing = false, multiline = false }) {
  const [line, a, b] = range
  const parts = []
  if (multiline) parts.push(bytes(1, Buffer.concat([varint(line), varint(a), varint(line + 2), varint(b)])))
  else if (encoding === 'typed') parts.push(bytes(8, Buffer.concat([num(1, line), num(2, a), num(3, b)])))
  else if (encoding === 'packed4') parts.push(bytes(1, Buffer.concat([varint(line), varint(a), varint(line), varint(b)])))
  else parts.push(bytes(1, Buffer.concat([varint(line), varint(a), varint(b)])))
  parts.push(str(2, symbol))
  if (def) parts.push(num(3, 1))
  if (enclosing) parts.push(bytes(10, Buffer.concat([num(1, line), num(2, 0), num(3, 40)])))
  return Buffer.concat(parts)
}

/** `implements` lists the symbols this one implements or overrides (relationships, field 4, with is_implementation set). */
export const symbolInfo = ({ symbol, kind = 0, displayName = '', implements: impl = [] }) =>
  Buffer.concat([str(1, symbol), ...impl.map((s) => bytes(4, Buffer.concat([str(1, s), num(3, 1)]))), ...(kind ? [num(5, kind)] : []), ...(displayName ? [str(6, displayName)] : [])])

export function document({ path, text, occurrences = [], symbols = [] }) {
  return Buffer.concat([str(1, path), str(4, 'java'), ...(text == null ? [] : [str(5, text)]), num(6, 2), ...occurrences.map((o) => bytes(2, o)), ...symbols.map((s) => bytes(3, s))])
}

export function index({ tool = 'fixture', version = '1', documents }) {
  const meta = bytes(1, Buffer.concat([bytes(2, Buffer.concat([str(1, tool), str(2, version)])), str(3, 'file:///fixture')]))
  return Buffer.concat([meta, ...documents.map((d) => bytes(2, d))])
}
