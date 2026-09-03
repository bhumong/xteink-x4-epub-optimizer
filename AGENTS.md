# AGENTS.md

Web app that optimizes EPUB books for the Xteink X4 e-reader running CrossPoint
firmware. Everything runs in the browser; the server only hosts the static app.

## RULES: MUST FOLLOW

### 1. `crosspoint-reader/**` is read-only reference

It holds two git submodules: the CrossPoint firmware and the CrossPoint
simulator. This project never commits to either.

- Never `git add`, `git commit`, or `git push` inside a submodule.
- Never use `git add -A` or `git add .` from the repo root: it stages submodule
  gitlink changes. Add explicit paths.
- Untracked files and unstaged edits inside the submodules are allowed, because
  building the simulator needs them. The invariant that matters is that the
  pinned commits never move.
- Pins live in `tools/sim/pins.txt`. Changing one is a deliberate act, not a
  side effect of a build.

Enforced by `npm run guard`, which fails if a submodule HEAD moved or anything
is staged in or to a submodule. `tools/sim/guard.sh` runs before and after every
`sim:*` task and in CI.

### 2. No device writes

The product downloads optimized files. Do not call the reader's web server,
upload over Wi-Fi, use WebUSB, or add a WebDAV client. Delivering a file to the
SD card is the user's job.

### 3. All book processing runs in the browser

`apps/server` must stay a static file host. If a feature needs a CPU-heavy or
memory-heavy step, it goes in the client (or a Web Worker), not in a new server
endpoint. The spec records this as a product decision, not an oversight.

### 4. Device facts come from the submodule, not from memory

`docs/superpowers/specs/2026-09-03-xteink-x4-epub-optimizer-design.md`
Section 4 lists verified constraints with file and line references. Re-read the
source before asserting anything about the format, and cite `path:line` when you
do. Three that have already caused design changes:

- The XTC reader only ever _reads_ XTC. There is no writer in the firmware, and
  the parser never decompresses page data, so `compression` must be 0 and pages
  are stored raw (48,000 bytes for a 480x800 1-bit page, 96,000 for 2-bit).
- The device skips any CSS file larger than 128 KB and refuses CSS parsing with
  under 64 KB free heap (`lib/Epub/Epub.cpp:244-336`).
- XTC page-table entry 0 sets the default dimensions for the whole book, so all
  pages must be 480x800.

## Verified commands

| Task                               | Command                                                   |
| ---------------------------------- | --------------------------------------------------------- |
| Install everything                 | `npm install && npx playwright install chromium`          |
| All tests                          | `npm test`                                                |
| Node tests only (fast, no browser) | `npm run test:node`                                       |
| Browser tests only                 | `npm run test:browser`                                    |
| Typecheck                          | `npm run check`                                           |
| Lint                               | `npm run lint`                                            |
| Format check / write               | `npm run format` / `npm run format:write`                 |
| Submodule guard                    | `npm run guard`                                           |
| Guard self-test                    | `npm run guard:test`                                      |
| Prepare simulator build            | `npm run sim:setup`                                       |
| Build simulator                    | `npm run sim:build`                                       |
| Run simulator window               | `npm run sim:run`                                         |
| Dev app (Vite, port 5173)          | `npm run dev -w apps/web`                                 |
| Serve built app (Hono, port 3000)  | `npm run build -w apps/web && npm run dev -w apps/server` |

Requires: Node >= 24 (`engines` is strict via `.npmrc`). Simulator work also
requires `pio`, `sdl2-config`, and OpenSSL headers: `sudo apt install
libsdl2-dev libssl-dev` and `pip install platformio`.

## Module map

| Path                                                                                | Owns                                          | DOM? |
| ----------------------------------------------------------------------------------- | --------------------------------------------- | ---- |
| `packages/optimize/src/paths.ts`, `decode.ts`, `css.ts`, `report.ts`, `errors.ts`   | pure transforms and helpers                   | no   |
| `packages/optimize/src/ingest.ts`, `document.ts`, `images.ts`, `split.ts`, `toc.ts` | EPUB parse and rewrite                        | yes  |
| `packages/optimize/src/repack.ts`                                                   | OCF-correct zip writer                        | no   |
| `packages/optimize/src/pipeline.ts`                                                 | stage order, progress, cancellation           | yes  |
| `packages/xtc/src/`                                                                 | XTC/XTCH writer (Phase 2; does not exist yet) | no   |
| `apps/web/src/`                                                                     | Svelte 5 SPA shell and UI                     | yes  |
| `apps/server/src/`                                                                  | Hono static host; no book logic               | no   |
| `tools/sim/`                                                                        | simulator setup, guard, golden capture        | n/a  |
| `crosspoint-reader/`                                                                | vendored firmware + simulator, read-only      | n/a  |

Test files route by suffix: `*.node.test.ts` runs in the cheap node project,
`*.browser.test.ts` runs in Chromium. A test with the wrong suffix silently
never runs. Prefer the node project for anything that does not need a real DOM.

## Conventions

- Tabs, single quotes, no trailing commas, print width 100 (`prettier.config.js`).
- `strict` TypeScript, `verbatimModuleSyntax`. `noUncheckedIndexedAccess` is off
  deliberately so byte-slicing code stays readable; assert lengths in tests.
- `@xteink/optimize` resolves through regex aliases in `vitest.config.ts`. Vite's
  string-key aliases are prefix matches, which breaks `/paths.ts` subpath
  imports; keep the regex form.
- No new dependency without a reason in the commit message. Prefer native
  `DOMParser`, `OffscreenCanvas`, `TextEncoder`, `crypto` over libraries.
- Chromium-only is a supported-platform statement, not a bug to fix. Do not add
  fallback paths for other engines.
- YAGNI: build the transform when a measured device limit demands it, not when a
  book looks slightly untidy.

## Where to look

- Design and rationale: `docs/superpowers/specs/2026-09-03-xteink-x4-epub-optimizer-design.md`
- This phase's plan: `docs/superpowers/plans/2026-09-03-xteink-x4-epub-optimizer-phase-0.md`
- XTC/XTCH and cache formats: `crosspoint-reader/crosspoint-firmware/docs/file-formats.md`, `lib/Xtc/README`
- Simulator usage and env vars: `crosspoint-reader/crosspoint-simulator/README.md`
- On-device EPUB transforms (reference, not a dependency): `crosspoint-reader/crosspoint-firmware/src/network/html/FilesPage.html:3804+`
