# repomapo

A map of a codebase, from the whole repo down to single lines.

- **Space.** The whole repo on one board you drag and zoom. A folder is a region,
  a file is a sun, and the file's functions orbit it, the most called on the
  inside and drawn larger. Pick a function and its calls light up: teal for what
  calls it, red for what it calls. Double-click it (or press "See its orbit") to
  put it in the middle, with what it calls on orbits to its right and what calls
  it to its left, one, two or three calls away. The filter bar finds functions by
  name and makes entry points, the most called or leaves stand out; the folder
  list is the key to the colours and makes a folder stand out. "Start here"
  lists where work begins (HTTP routes, scheduled jobs, listeners, startup code,
  and functions nothing in the repo calls); pick one and everything it sets off
  lights up in the order the code calls it, to walk step by step with the arrow
  keys. A call to an interface's method goes on into the methods that implement
  it, when the index records them. This is the view the site opens on.
- **Repo map.** Every file, grouped by folder. Hover a file to see which files it
  uses and which use it. Click it to open it in the thread view.
- **Functions.** Every function as a card: what calls it on the left, what it
  calls on the right. Filter by name, folder, entry points, leaves or most called.
- **Function page.** One function read like a case study: a sentence stating its
  relations, its callers threaded into its code, its callees lined up with the
  lines that call them, what it touches, and the call path around it.
- **Thread view.** Up to four files side by side, with a thread from each
  symbol's definition to every usage. Click a name to lock it and jump to its
  definition; usages in files that are not open show as stubs you can click.

Search (Ctrl K, or ⌘K on a Mac) jumps to any function, type, file or view from
anywhere. The switch at the top right chooses light or dark; until it is used the
site follows the system.

All views read one index file and share one URL scheme, so any state is a link.
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
| `view=map`, `functions`, `function`, `threads` | all | which view; the board (`space`) when absent |
| `data=<url>` | all | the index to load, same origin only |
| `focus=<path>` | map | pin a file and show its edges |
| `fn=<path>:<line>:<col>` | function, space | the symbol defined there; the path may be given by its ending. On the board it is the function picked |
| `orbit=1` | space | put that function in the middle, with its calls around it |
| `flow=1` | space | light up what that function sets off, to walk step by step |
| `files=a,b,c` | threads | files to open; a path may be given by its ending |
| `sym=<path>:<line>:<col>` | threads | lock the symbol defined there |
| `at=<path>:<line>` | threads | scroll to a line once |

## Layout

```
scripts/build-index.mjs   indexer runner and SCIP -> JSON converter (no dependencies)
sample/                   the small Kotlin project behind the sample index
src/data/                 loading the index, lookup tables, and the call graph
                          (callGraph.ts: each usage belongs to the function it sits in)
                          and where work begins (flows.ts: routes, timers, listeners,
                          main, and the steps each one sets off)
src/fn/                   functions gallery, function page, call path, and the
                          sentences the index alone can state about a symbol
src/space/                the board: layout.ts places folders, files and functions
                          (and one function's orbits), Space.tsx draws them on a canvas
src/Palette.tsx           search: jump to a function, type, file or view
src/theme.ts              light or dark, by the system or by the switch
src/map/                  repo map: file graph, layout, React view
src/threads/              thread view: stage.ts draws panes and threads in plain DOM,
                          React owns the inspector, the file tree and the state
src/url.ts, src/nav.tsx   the shared URL scheme and in-app links
tests/                    Vitest: converter, index, URL scheme, layout, geometry, store
prototype/                the two single-file pages this app was ported from
drafts/                   seven redesign drafts and their pictures; the app follows
                          3 (case study), 2 (gallery) and 4 (call path)
deploy/, DEPLOY.md        nginx config and how the site is deployed
```

## Checks

```bash
npm test
npm run build
```
