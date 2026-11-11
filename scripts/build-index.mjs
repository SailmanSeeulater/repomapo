#!/usr/bin/env node
// Runs scip-java on a Gradle or Maven repo and converts the SCIP index into the
// JSON the app loads (public/data/threads.json).
//
//   node scripts/build-index.mjs [repo] [options] [-- extra build-tool args]
//
//   repo               repo to index (default: sample)
//   --out <file>       where to write the JSON (default: public/data/threads.json)
//   --index <file>     convert an existing index.scip, do not run the indexer
//   --scip-java <bin>  use this scip-java instead of PATH or the pinned download
//   --locals           also emit local variables and parameters
//   --check            only run the version checks, then exit
//
// No dependencies. Needs Node 18+ and, to run the indexer, JDK 17+.

import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CACHE = path.join(ROOT, ".cache");

// Pinned indexer release. The sha256 is the one published next to the asset.
const SCIP_JAVA = {
  version: "0.14.1",
  url: "https://github.com/scip-code/scip-java/releases/download/v0.14.1/scip-java-v0.14.1",
  sha256: "06be799e2d9914e142ede285bb21c0f077e9ea84b6a835c90893c2fb048eeb53",
  // What this release supports (docs/getting-started.md and the Gradle plugin source at v0.14.1).
  minGradle: 8,          // "Drops support for Gradle versions below 8" (v0.13.0)
  minJdk: 17,            // Java 17, 21, 25
  kotlinAnalysis: "2.4", // Kotlin sources are read by a standalone Analysis API 2.4.0 indexer,
                         // so the project's own Kotlin compiler version does not have to match.
};

// ---------- args ----------

function parseArgs(argv) {
  // Defaults are relative to this project, not to the directory the script is run from.
  const a = { repo: path.join(ROOT, "sample"), out: path.join(ROOT, "public/data/threads.json"), index: null, scipJava: null, locals: false, check: false, extra: [] };
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    const v = argv[i];
    if (v === "--") { a.extra = argv.slice(i + 1); break; }
    else if (v === "--out") a.out = argv[++i];
    else if (v === "--index") a.index = argv[++i];
    else if (v === "--scip-java") a.scipJava = argv[++i];
    else if (v === "--locals") a.locals = true;
    else if (v === "--check") a.check = true;
    else if (v === "-h" || v === "--help") { console.log(fs.readFileSync(fileURLToPath(import.meta.url), "utf8").split("\n").slice(1, 15).map(l => l.replace(/^\/\/ ?/, "")).join("\n")); process.exit(0); }
    else if (v.startsWith("--")) die("unknown option " + v);
    else rest.push(v);
  }
  if (rest.length > 1) die("expected one repo path, got: " + rest.join(" "));
  if (rest.length) a.repo = rest[0];
  a.repo = path.resolve(a.repo);
  a.out = path.resolve(a.out);
  return a;
}

function die(msg) { console.error("error: " + msg); process.exit(1); }
const read = p => { try { return fs.readFileSync(p, "utf8"); } catch { return ""; } };

// ---------- version checks ----------

function detect(repo) {
  const has = f => fs.existsSync(path.join(repo, f));
  const gradle = ["settings.gradle", "settings.gradle.kts", "build.gradle", "build.gradle.kts", "gradlew"].some(has);
  const maven = has("pom.xml");
  const info = { tool: gradle ? "gradle" : maven ? "maven" : null, gradle: null, kotlin: null, jdk: null, android: false, kotlinFiles: 0 };

  const wrapper = read(path.join(repo, "gradle/wrapper/gradle-wrapper.properties"));
  const g = /distributionUrl=.*gradle-(\d+(?:\.\d+)*)/.exec(wrapper);
  if (g) info.gradle = g[1];

  // Kotlin plugin version: version catalog first, then build scripts (root and one level down).
  const scripts = [];
  for (const dir of [repo, ...subdirs(repo)]) {
    for (const f of ["build.gradle.kts", "build.gradle", "settings.gradle.kts", "settings.gradle", "pom.xml"]) {
      const t = read(path.join(dir, f)); if (t) scripts.push(t);
    }
  }
  const catalog = read(path.join(repo, "gradle/libs.versions.toml"));
  const all = scripts.join("\n");
  const k =
    /^\s*kotlin\s*=\s*"([\d.]+[\w.-]*)"/m.exec(catalog) ||
    /kotlin\(\s*"(?:jvm|multiplatform|android)"\s*\)\s+version\s+"([^"]+)"/.exec(all) ||
    /org\.jetbrains\.kotlin\.(?:jvm|multiplatform|android)["']\s*\)?\s+version\s+["']([^"']+)["']/.exec(all) ||
    /kotlin[_-]?[vV]ersion\s*=\s*["']([^"']+)["']/.exec(all + "\n" + read(path.join(repo, "gradle.properties")).replace(/^(\s*kotlin[._-]?version\s*=\s*)(\S+)/gim, '$1"$2"')) ||
    /<kotlin\.version>([^<]+)</.exec(all);
  if (k) info.kotlin = k[1];
  info.android = /com\.android\.(application|library)/.test(all);
  info.kotlinFiles = countFiles(repo, ".kt");

  try {
    const v = spawnSync("java", ["-version"], { encoding: "utf8" });
    const m = /version "(\d+)(?:\.(\d+))?/.exec(v.stderr + v.stdout);
    if (m) info.jdk = m[1] === "1" ? +m[2] : +m[1];
  } catch { /* reported below */ }
  return info;
}

function subdirs(dir) {
  try {
    return fs.readdirSync(dir, { withFileTypes: true })
      .filter(e => e.isDirectory() && !e.name.startsWith(".") && !["build", "node_modules", "target", "gradle"].includes(e.name))
      .map(e => path.join(dir, e.name));
  } catch { return []; }
}

function countFiles(dir, ext, depth = 0) {
  if (depth > 12) return 0;
  let n = 0;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith(".") || ["build", "node_modules", "target"].includes(e.name)) continue;
    if (e.isDirectory()) n += countFiles(path.join(dir, e.name), ext, depth + 1);
    else if (e.name.endsWith(ext)) n++;
  }
  return n;
}

function preflight(repo) {
  const i = detect(repo), problems = [], notes = [];
  if (!i.tool) problems.push("no Gradle or Maven build found in " + repo + " (scip-java index needs settings.gradle, build.gradle(.kts), gradlew or pom.xml at the root)");
  if (i.tool === "gradle") {
    if (!i.gradle) notes.push("no Gradle wrapper found, so the Gradle version is unknown; scip-java will call `gradle` from PATH and needs " + SCIP_JAVA.minGradle + " or newer");
    else if (+i.gradle.split(".")[0] < SCIP_JAVA.minGradle) problems.push("Gradle " + i.gradle + " is not supported; scip-java " + SCIP_JAVA.version + " needs Gradle " + SCIP_JAVA.minGradle + " or newer");
  }
  if (i.tool === "maven" && i.kotlinFiles) problems.push("this is a Maven build with " + i.kotlinFiles + " Kotlin files; scip-java indexes Kotlin only through Gradle (Java files in a Maven build are fine)");
  if (i.android) notes.push("Android Gradle modules are listed as not yet supported by scip-java; those modules may be missing from the index");
  if (i.kotlin) {
    const [maj, min] = i.kotlin.split(".").map(Number), [amaj, amin] = SCIP_JAVA.kotlinAnalysis.split(".").map(Number);
    if (maj > amaj || (maj === amaj && min > amin)) notes.push("project Kotlin " + i.kotlin + " is newer than the indexer's Kotlin Analysis API (" + SCIP_JAVA.kotlinAnalysis + "); syntax added after " + SCIP_JAVA.kotlinAnalysis + " may not index");
  } else if (i.kotlinFiles) notes.push("could not find the Kotlin plugin version in the build files");
  if (i.jdk == null) problems.push("no `java` on PATH; scip-java needs JDK " + SCIP_JAVA.minJdk + " or newer");
  else if (i.jdk < SCIP_JAVA.minJdk) problems.push("JDK " + i.jdk + " is too old; scip-java needs JDK " + SCIP_JAVA.minJdk + " or newer");

  console.log("repo        " + repo);
  console.log("build tool  " + (i.tool || "none") + (i.gradle ? " " + i.gradle : ""));
  console.log("kotlin      " + (i.kotlin || "not found") + " (" + i.kotlinFiles + " .kt files)");
  console.log("jdk         " + (i.jdk ?? "not found"));
  console.log("indexer     scip-java " + SCIP_JAVA.version + " (Gradle " + SCIP_JAVA.minGradle + "+, JDK " + SCIP_JAVA.minJdk + "+, Kotlin Analysis API " + SCIP_JAVA.kotlinAnalysis + ")");
  for (const n of notes) console.log("note: " + n);
  for (const p of problems) console.error("unsupported: " + p);
  return problems.length === 0;
}

// ---------- indexer ----------

function onPath(bin) {
  const r = spawnSync("which", [bin], { encoding: "utf8" });
  return r.status === 0 ? r.stdout.trim() : null;
}

function ensureScipJava(explicit) {
  if (explicit) return path.resolve(explicit);
  const found = onPath("scip-java");
  if (found) return found;
  const bin = path.join(CACHE, "scip-java-v" + SCIP_JAVA.version);
  const sha = p => createHash("sha256").update(fs.readFileSync(p)).digest("hex");
  if (!fs.existsSync(bin) || sha(bin) !== SCIP_JAVA.sha256) {
    fs.mkdirSync(CACHE, { recursive: true });
    console.log("downloading scip-java " + SCIP_JAVA.version + " ...");
    execFileSync("curl", ["-fsSL", "-o", bin, SCIP_JAVA.url], { stdio: "inherit" });
    if (sha(bin) !== SCIP_JAVA.sha256) { fs.rmSync(bin); die("scip-java download does not match the pinned sha256"); }
  }
  fs.chmodSync(bin, 0o755);
  return bin;
}

// scip-java's javac wrapper (used for Maven builds) is a bash script that expands an empty array
// under `set -u`. bash older than 4.4 treats that as an error ("LAUNCHER_ARGS[@]: unbound variable"),
// and macOS ships bash 3.2 as /bin/bash. If the `bash` on PATH is that old, put a newer one in front.
function envWithModernBash() {
  const version = bin => {
    const r = spawnSync(bin, ["-c", 'echo "${BASH_VERSINFO[0]}.${BASH_VERSINFO[1]}"'], { encoding: "utf8" });
    const m = /^(\d+)\.(\d+)/.exec(r.stdout || "");
    return m ? +m[1] + +m[2] / 100 : 0;
  };
  if (version("bash") >= 4.04) return process.env;
  const newer = ["/opt/homebrew/bin/bash", "/usr/local/bin/bash"].find(b => fs.existsSync(b) && version(b) >= 4.04);
  if (!newer) {
    console.log("note: `bash` on PATH is older than 4.4. Maven builds fail in scip-java's javac wrapper with it; install a newer one (brew install bash) if that happens.");
    return process.env;
  }
  const dir = path.join(CACHE, "bin");
  fs.mkdirSync(dir, { recursive: true });
  fs.rmSync(path.join(dir, "bash"), { force: true });
  fs.symlinkSync(newer, path.join(dir, "bash"));
  console.log("using " + newer + " for the indexer (the bash on PATH is too old for scip-java's javac wrapper)");
  return { ...process.env, PATH: dir + path.delimiter + process.env.PATH };
}

function runIndexer(repo, scipJava, extra) {
  fs.mkdirSync(CACHE, { recursive: true });
  const out = path.join(CACHE, "index.scip");
  fs.rmSync(out, { force: true });
  const args = ["index", "--output", out, ...(extra.length ? ["--", ...extra] : [])];
  console.log("running: " + scipJava + " " + args.join(" ") + "   (in " + repo + ")");
  const r = spawnSync(scipJava, args, { cwd: repo, stdio: "inherit", env: envWithModernBash() });
  if (r.error) die("could not start scip-java: " + r.error.message);
  if (r.status !== 0) die("scip-java exited with status " + r.status + ". The indexer hooks into the build, so the repo has to compile.");
  if (!fs.existsSync(out)) die("scip-java finished but wrote no index at " + out);
  return out;
}

// ---------- SCIP protobuf decoding ----------
// Field numbers are from scip.proto. Only the fields the thread view needs are read.

class Reader {
  constructor(buf, pos = 0, end = buf.length) { this.b = buf; this.p = pos; this.e = end; }
  more() { return this.p < this.e; }
  varint() {
    let lo = 0, shift = 0, b;
    do {
      b = this.b[this.p++];
      if (shift < 28) lo |= (b & 0x7f) << shift;
      else lo += (b & 0x7f) * 2 ** shift;
      shift += 7;
    } while (b & 0x80);
    return shift <= 28 ? lo >>> 0 : lo;
  }
  int32() { const v = this.varint(); return v > 0x7fffffff ? Number(BigInt.asIntN(32, BigInt(v))) : v; }
  tag() { const t = this.varint(); return [t >>> 3, t & 7]; }
  sub() { const n = this.varint(), r = new Reader(this.b, this.p, this.p + n); this.p += n; return r; }
  str() { const n = this.varint(), s = this.b.toString("utf8", this.p, this.p + n); this.p += n; return s; }
  skip(wire) {
    if (wire === 0) this.varint();
    else if (wire === 1) this.p += 8;
    else if (wire === 2) { const n = this.varint(); this.p += n; } // not `p += varint()`: that reads p before the varint advances it
    else if (wire === 5) this.p += 4;
    else throw new Error("unsupported protobuf wire type " + wire + " at byte " + this.p);
  }
}

function ints(r, wire, into) {
  if (wire === 2) { const s = r.sub(); while (s.more()) into.push(s.int32()); }
  else into.push(r.int32());
}

function decodeRange(r, fields) { // SingleLineRange or MultiLineRange -> [startLine, startChar, endLine, endChar]
  const v = {};
  while (r.more()) { const [f, w] = r.tag(); if (w === 0) v[f] = r.int32(); else r.skip(w); }
  return fields === 3 ? [v[1] || 0, v[2] || 0, v[1] || 0, v[3] || 0] : [v[1] || 0, v[2] || 0, v[3] || 0, v[4] || 0];
}

function decodeOccurrence(r) {
  const o = { range: [], symbol: "", roles: 0, typed: null };
  while (r.more()) {
    const [f, w] = r.tag();
    if (f === 1) ints(r, w, o.range);
    else if (f === 2) o.symbol = r.str();
    else if (f === 3) o.roles = r.int32();
    else if (f === 8) o.typed = decodeRange(r.sub(), 3);
    else if (f === 9) o.typed = decodeRange(r.sub(), 4);
    else r.skip(w);
  }
  const g = o.range;
  o.range = o.typed || (g.length === 3 ? [g[0], g[1], g[0], g[2]] : g.length === 4 ? g : null);
  return o;
}

function decodeSymbolInfo(r) {
  const s = { symbol: "", kind: 0, displayName: "", implements: [] };
  while (r.more()) {
    const [f, w] = r.tag();
    if (f === 1) s.symbol = r.str();
    else if (f === 5) s.kind = r.int32();
    else if (f === 6) s.displayName = r.str();
    else if (f === 4) {
      const rel = r.sub(); let sym = "", impl = false;
      while (rel.more()) { const [rf, rw] = rel.tag(); if (rf === 1) sym = rel.str(); else if (rf === 3) impl = rel.int32() !== 0; else rel.skip(rw); }
      if (impl && sym) s.implements.push(sym);
    } else r.skip(w);
  }
  return s;
}

function decodeDocument(r) {
  const d = { path: "", language: "", text: null, encoding: 0, occurrences: [], symbols: [] };
  while (r.more()) {
    const [f, w] = r.tag();
    if (f === 1) d.path = r.str();
    else if (f === 2) d.occurrences.push(decodeOccurrence(r.sub()));
    else if (f === 3) d.symbols.push(decodeSymbolInfo(r.sub()));
    else if (f === 4) d.language = r.str();
    else if (f === 5) d.text = r.str();
    else if (f === 6) d.encoding = r.int32();
    else r.skip(w);
  }
  return d;
}

function decodeIndex(buf) {
  const idx = { tool: "", toolVersion: "", projectRoot: "", documents: [] };
  const r = new Reader(buf);
  while (r.more()) {
    const [f, w] = r.tag();
    if (f === 1) {
      const m = r.sub();
      while (m.more()) {
        const [mf, mw] = m.tag();
        if (mf === 2) { const t = m.sub(); while (t.more()) { const [tf, tw] = t.tag(); if (tf === 1) idx.tool = t.str(); else if (tf === 2) idx.toolVersion = t.str(); else t.skip(tw); } }
        else if (mf === 3) idx.projectRoot = m.str();
        else m.skip(mw);
      }
    } else if (f === 2) idx.documents.push(decodeDocument(r.sub()));
    else r.skip(w);
  }
  return idx;
}

// ---------- SCIP -> thread view JSON ----------

const KINDS = { 66: "method", 72: "accessor", 7: "class", 8: "constant", 9: "constructor", 11: "enum", 12: "enum member", 84: "extension", 15: "field", 17: "function", 18: "getter", 21: "interface", 26: "method", 29: "module", 30: "namespace", 33: "object", 35: "package", 37: "parameter", 41: "property", 45: "setter", 75: "object", 79: "field", 80: "method", 81: "property", 82: "variable", 49: "struct", 53: "trait", 54: "type", 55: "type alias", 58: "type parameter", 60: "value", 61: "variable" };

// When the indexer leaves `kind` unset, the last descriptor of the symbol string still says what it is.
function kindFromSymbol(sym) {
  if (sym.startsWith("local ")) return "local";
  if (/<init>\(\S*\)\.$/.test(sym)) return "constructor";
  if (sym.endsWith(").")) return "method";
  if (sym.endsWith("#")) return "class";
  if (sym.endsWith(")")) return "parameter";
  if (sym.endsWith("]")) return "type parameter";
  if (sym.endsWith("/")) return "package";
  if (sym.endsWith(".")) return "field";
  return "symbol";
}

// When several symbols share one definition range (a Kotlin constructor property is a
// parameter, a property and a getter at once), the lowest rank names the merged symbol.
const RANK = ["class", "interface", "object", "enum", "struct", "trait", "type alias", "type", "property", "field", "constant", "enum member", "method", "function", "extension", "variable", "value", "constructor", "getter", "setter", "accessor", "parameter", "type parameter", "local", "symbol"];
const rank = k => { const i = RANK.indexOf(k); return i < 0 ? RANK.length : i; };

// Convert a character offset in the index's position encoding to a UTF-16 offset (what JS strings use).
function toUtf16(line, col, encoding) {
  if (encoding === 1) return Buffer.from(line, "utf8").subarray(0, col).toString("utf8").length; // UTF-8 bytes
  if (encoding === 3) return Array.from(line).slice(0, col).join("").length;                      // code points
  return col;
}

// "scip-java maven jdk 21 java/lang/String#" -> package "jdk 21", descriptor "java/lang/String#"
function packageOf(sym) {
  const p = sym.split(" ");
  if (p.length < 5) return { raw: "", label: "", descriptor: sym };
  const name = p[2].replace(/^maven\//, "").replace("/", ":");
  return { raw: p[2] + " " + p[3], label: name === "." ? "" : name + (p[3] === "." ? "" : " " + p[3]), descriptor: p.slice(4).join(" ") };
}

// "java/util/List#of(+1)." -> "List.of", "java/lang/RuntimeException#`<init>`()." -> "RuntimeException"
function libraryName(descriptor) {
  const tail = descriptor.slice(descriptor.replace(/\/$/, "").lastIndexOf("/") + 1);
  const parts = tail.split("#").map(t => t.replace(/[(\[].*$/, "").replace(/[.\/]$/, "").replace(/`/g, "")).filter(t => t && t !== "<init>");
  return parts.join(".") || descriptor.replace(/\/$/, "").replace(/\//g, ".");
}

function convert(index, repo, opts) {
  const docs = index.documents.slice().sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  const files = [], stats = { documents: docs.length, occurrences: 0, external: 0, locals: 0, multiline: 0, stale: 0, merged: 0, overlapping: 0, synthetic: 0, annotation: 0, accessors: 0 };
  const syms = new Map(); // key -> { key, kind, name, defs: [], refs: [] }
  const info = new Map();
  const IDENT = /^`[^`]+`$|^[\p{L}\p{N}_$]+$/u;
  const generated = new Set(); // symbols whose only definition is a multi-line range (Lombok output)
  const get = key => { let s = syms.get(key); if (!s) syms.set(key, s = { key, defs: [], refs: [] }); return s; };

  docs.forEach((d, fi) => {
    let text = d.text;
    if (text == null) {
      try { text = fs.readFileSync(path.join(repo, d.path), "utf8"); }
      catch { die("the index lists " + d.path + " but it is not in " + repo + ". Pass the repo the index was built from."); }
    }
    const lines = text.split(/\r?\n/);
    if (lines.length > 1 && lines[lines.length - 1] === "") lines.pop();
    files.push({ path: d.path, lines });
    const scoped = s => s.startsWith("local ") ? d.path + "#" + s : s;
    for (const s of d.symbols) info.set(scoped(s.symbol), s);
    for (const o of d.occurrences) {
      stats.occurrences++;
      if (!o.symbol || !o.range) continue;
      if (o.symbol.startsWith("local ")) { stats.locals++; if (!opts.locals) continue; }
      const [l0, c0, l1, c1] = o.range;
      if (l0 !== l1) { stats.multiline++; if (o.roles & 1) generated.add(scoped(o.symbol)); continue; }
      const line = lines[l0];
      if (line == null) { stats.stale++; continue; }
      const col = toUtf16(line, c0, d.encoding), end = toUtf16(line, c1, d.encoding);
      if (end <= col || end > line.length) { stats.stale++; continue; }
      const at = { file: fi, line: l0 + 1, col, len: end - col };
      // Lombok-generated code is reported at the annotation that produced it ("@Data",
      // "@RequiredArgsConstructor"). That is not a usage anyone wrote, so it gets no thread.
      if (!(o.roles & 1) && !IDENT.test(line.slice(col, end))) { stats.annotation++; continue; }
      const s = get(scoped(o.symbol));
      (o.roles & 1 ? s.defs : s.refs).push(at);
    }
  });

  const order = (a, b) => a.file - b.file || a.line - b.line || a.col - b.col;
  const pos = a => a.file + ":" + a.line + ":" + a.col;

  // Lombok getters and setters have no name in the source to anchor a thread on, so calls to
  // getFoo() / setFoo() / isFoo() are threaded to the field `foo` they were generated from.
  for (const s of syms.values()) {
    if (s.defs.length || !s.refs.length || !generated.has(s.key)) continue;
    const m = /^(.*#)(?:get|set|is)([\p{Lu}\p{N}_$])([\p{L}\p{N}_$]*)\(\)\.$/u.exec(s.key);
    if (!m) continue;
    const field = syms.get(m[1] + m[2].toLowerCase() + m[3] + ".") || syms.get(m[1] + "is" + m[2] + m[3] + ".");
    if (!field || !field.defs.length) continue;
    field.refs.push(...s.refs); stats.accessors += s.refs.length; s.refs = []; s.moved = true;
  }

  // Library symbols (JDK, Spring, any dependency): used here, defined elsewhere. They get no
  // threads; the page marks the lines that use them. Overloads and constructors fold into one name.
  const own = new Set();
  for (const s of syms.values()) if (s.defs.length) own.add(packageOf(s.key).raw);
  const libs = [], libIndex = new Map(), libLines = files.map(() => new Map());
  for (const s of syms.values()) {
    if (s.defs.length || s.moved || !s.refs.length || /(^|#)local \d/.test(s.key)) continue;
    const pk = packageOf(s.key);
    if (!pk.raw || own.has(pk.raw)) continue; // generated members of the repo's own classes
    if (pk.descriptor.endsWith("/")) continue;   // package segments in import and package lines
    const name = libraryName(pk.descriptor), k = pk.raw + " " + name;
    if (!libIndex.has(k)) { libIndex.set(k, libs.length); libs.push({ name, pkg: pk.label, uses: 0 }); }
    const i = libIndex.get(k);
    libs[i].uses += s.refs.length;
    for (const r of s.refs) { const m = libLines[r.file]; if (!m.has(r.line)) m.set(r.line, new Set()); m.get(r.line).add(i); }
  }
  files.forEach((f, fi) => { f.libs = [...libLines[fi]].sort((a, b) => a[0] - b[0]).map(([line, set]) => [line, ...[...set].sort((a, b) => a - b)]); });
  stats.libs = libs.length;

  // Symbols defined in the repo, grouped by where they are defined.
  const groups = new Map();
  for (const s of syms.values()) {
    if (!s.defs.length) { if (!s.moved) stats.external++; continue; }
    s.defs.sort(order);
    const i = info.get(s.key);
    s.kind = (i && KINDS[i.kind]) || kindFromSymbol(s.key.replace(/^.*#(?=local )/, ""));
    const d = s.defs[0];
    // The name as written at the definition; a constructor's display name is "<init>".
    const written = files[d.file].lines[d.line - 1].slice(d.col, d.col + d.len);
    s.name = i && i.displayName && IDENT.test(i.displayName) ? i.displayName : written;
    // Compiler-generated members (a data class's copy()) are "defined" on a parenthesis or a whole
    // parameter list. There is no name there to underline, so they get no thread.
    if (!IDENT.test(written)) { stats.synthetic++; continue; }
    const k = pos(d);
    if (groups.has(k)) { groups.get(k).push(s); stats.merged++; } else groups.set(k, [s]);
  }

  const merged = [];
  for (const g of groups.values()) {
    g.sort((a, b) => rank(a.kind) - rank(b.kind));
    const head = g[0], def = head.defs[0];
    const refs = new Map();
    for (const s of g) for (const r of s.refs.concat(s.defs.slice(1))) if (pos(r) !== pos(def)) refs.set(pos(r), r);
    merged.push({ id: head.key, name: head.name, kind: head.kind, def, refs: [...refs.values()] });
  }

  // One symbol per source position: definitions first, then usages in rank order.
  merged.sort((a, b) => rank(a.kind) - rank(b.kind) || order(a.def, b.def));
  const taken = new Set(merged.map(s => pos(s.def)));
  for (const s of merged) {
    s.refs = s.refs.filter(r => { const k = pos(r); if (taken.has(k)) { stats.overlapping++; return false; } taken.add(k); return true; }).sort(order);
  }
  merged.sort((a, b) => order(a.def, b.def));

  stats.files = files.length;
  stats.symbols = merged.length;
  stats.refs = merged.reduce((n, s) => n + s.refs.length, 0);
  return {
    meta: { tool: index.tool || "scip", toolVersion: index.toolVersion, repo: path.basename(repo), generated: new Date().toISOString(), stats },
    files,
    symbols: merged,
    libs,
  };
}

// ---------- main ----------

export { decodeIndex, convert, packageOf, libraryName };

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!fs.existsSync(args.repo)) die("no such directory: " + args.repo);

  let indexPath = args.index && path.resolve(args.index);
  if (!indexPath) {
    const ok = preflight(args.repo);
    if (!ok) process.exit(1);
    if (args.check) process.exit(0);
    indexPath = runIndexer(args.repo, ensureScipJava(args.scipJava), args.extra);
  }

  const index = decodeIndex(fs.readFileSync(indexPath));
  if (!index.documents.length) die("the index has no documents. Check the indexer output above.");
  const json = convert(index, args.repo, { locals: args.locals });
  fs.mkdirSync(path.dirname(args.out), { recursive: true });
  fs.writeFileSync(args.out, JSON.stringify(json));
  const s = json.meta.stats;
  console.log("wrote " + path.relative(process.cwd(), args.out) + ": " + s.files + " files, " + s.symbols + " symbols, " + s.refs + " usages");
  if (s.accessors) console.log("threaded " + s.accessors + " generated getter/setter calls to their fields");
  console.log("library symbols: " + s.libs + " (marked on the lines that use them, no threads)");
  console.log("skipped: " + (args.locals ? 0 : s.locals) + " local occurrences, " + s.synthetic + " compiler-generated, " + s.annotation + " at annotations, " + s.multiline + " multi-line, " + s.stale + " out of range, " + s.overlapping + " overlapping");
}

// Run only as a command, so tests can import the decoder and converter.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
