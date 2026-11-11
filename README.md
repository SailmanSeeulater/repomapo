# repomapo

A map of a codebase, from the whole repo down to single lines.

- **Repo map.** Every file, grouped by folder. Hover a file to see which files it
  uses and which use it. Click it to open it in the thread view.
- **Thread view.** Up to four files side by side, with a thread from each
  symbol's definition to every usage. Click a name to lock it and jump to its
  definition; usages in files that are not open show as stubs you can click.

Both views read one index file and share one URL scheme, so any state is a link.
It runs entirely in the browser: no server, and an index you open from disk is
never uploaded.

## Run it

```bash
npm install
npm run dev
```

With no index of your own, the app shows the sample (`public/data/sample.json`,
three Kotlin files).

## Index a repo

The index comes from [scip-java](https://github.com/scip-code/scip-java), which
hooks into the repo's own build. It supports Java through Gradle or Maven and
Kotlin through Gradle, needs Gradle 8+ and JDK 17+, and the repo has to compile.

```bash
npm run index -- /path/to/repo
```

This checks the repo's versions, downloads the pinned scip-java release
(sha256-verified) into `.cache/`, runs it, and writes `public/data/threads.json`,
which the app picks up on reload. That file contains the repo's source and is
ignored by git. Other options: `node scripts/build-index.mjs --help`.

Known limits: Lombok getters and setters are threaded to their field, other
generated members are not; method parameters and locals are left out unless you
pass `--locals`; Android modules are not supported by the indexer.

## Links

| Parameter | View | Meaning |
| --- | --- | --- |
| `view=threads` | both | which view; the map when absent |
| `data=<url>` | both | the index to load, same origin only |
| `focus=<path>` | map | pin a file and show its edges |
| `files=a,b,c` | threads | files to open; a path may be given by its ending |
| `sym=<path>:<line>:<col>` | threads | lock the symbol defined there |
| `at=<path>:<line>` | threads | scroll to a line once |

## Layout

```
scripts/build-index.mjs   indexer runner and SCIP -> JSON converter (no dependencies)
sample/                   the small Kotlin project behind the sample index
src/data/                 loading the index and building lookup tables
src/map/                  repo map: file graph, layout, React view
src/threads/              thread view: stage.ts draws panes and threads in plain DOM,
                          React owns the inspector, the file tree and the state
src/url.ts                the shared URL scheme
tests/                    Vitest: converter, index, URL scheme, layout, geometry, store
prototype/                the two single-file pages this app was ported from
deploy/, DEPLOY.md        nginx config and how the site is deployed
```

## Checks

```bash
npm test
npm run build
```
