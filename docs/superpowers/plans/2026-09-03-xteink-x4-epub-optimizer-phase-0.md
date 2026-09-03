# Xteink X4 EPUB Optimizer: Phase 0 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the repo scaffold, a locally-buildable CrossPoint simulator for verification, the Svelte SPA shell and Hono static host, and `AGENTS.md`, so that Phase 1 (EPUB optimize) starts from a green, guarded, runnable repo.

**Architecture:** npm workspaces with one DOM-free seam. `packages/optimize` does ingest, per-resource transforms, and repack; `apps/web` is a Svelte 5 SPA that runs the whole pipeline in the tab; `apps/server` is a Hono static file host with zero book logic. Vendored firmware and simulator live under `crosspoint-reader/**` as read-only reference, and `tools/sim/guard.sh` mechanically proves their gitlinks never move.

**Tech Stack:** Node 24, npm workspaces, TypeScript strict, Vite, Svelte 5 runes, Vitest (node + browser-playwright projects), Hono with `@hono/node-server`, JSZip, native `DOMParser` and `OffscreenCanvas`.

**Spec:** `docs/superpowers/specs/2026-09-03-xteink-x4-epub-optimizer-design.md`. Read it before starting. This plan implements spec Section 9 (simulator setup) and the Phase 0 row of spec Section 12. Optimize logic is the Phase 1 plan; XTC output is the Phase 2 through 4 plans.

## Global Constraints

Every task's requirements implicitly include these. Values are copied verbatim from the spec.

- `crosspoint-reader/**` is read-only reference. Never stage, commit, or push anything inside either submodule. Untracked files and unstaged local modifications inside them are permitted (needed to build the simulator). Never use `git add -A` or `git add .` from the repo root, which would stage submodule gitlink changes.
- Submodule pins: `crosspoint-reader/crosspoint-firmware` = `badfa95ff747a0cbd07cf23186382a43ca9852e9`, `crosspoint-reader/crosspoint-simulator` = `c55f168bc0e677fdb32312c8be4b5874469465e6`.
- All book processing runs in the client browser. `apps/server` performs no processing and imports no `packages/*` code.
- Output is download-only. No device HTTP calls, no WebUSB, no WebDAV, no uploads to `crosspoint.local`.
- Target geometry and format: 480x800 portrait, X4 only.
- Chromium is the only supported engine. `DOMParser`, `OffscreenCanvas`, and `createImageBitmap` are used directly with no polyfill and no fallback path.
- Device CSS budget is 128 KB (`131072` bytes) per stylesheet file. Device CSS-parse heap floor is 64 KB. Source: spec Section 4.
- TypeScript config: `strict: true`, `noImplicitOverride: true`, `verbatimModuleSyntax: true`. `noUncheckedIndexedAccess` is deliberately off so byte-slicing code stays readable; length preconditions are asserted in tests instead.
- Formatting: tabs, single quotes, no trailing commas, print width 100 (matches the user's existing projects).
- No placeholder dependencies: install with `npm install` so npm resolves current versions and writes the lockfile. Do not hand-write version ranges into `package.json`.
- Commit steps assume `git commit` works in the working shell. In the current sandbox the automatic approval reviewer is misconfigured (`No enabled OpenAI provider for model: gpt-5.6-luna`) and `.git` is mounted read-only, so commits fail until `ocx init` configures a provider. If a commit step fails that way, report it rather than skipping the commit silently.

**Prerequisites for Tasks 1 through 5:** network access for `npm install`, `npx playwright install chromium`, `apt-get install libsdl2-dev libssl-dev`, `pip install platformio`, and `git submodule update --init --recursive` for the nested `freeink-sdk`.

Verified 2026-09-03: the host has working network (`npm ping` PONGs in ~313 ms). The agent sandbox does not resolve DNS, so every command in this plan that needs the network must run with escalated approval, or be run by the user directly. `npm install` has succeeded from the host shell, so treat network as available and treat a sandbox failure as an approval problem rather than an environment problem.

---

## File Structure

```text
package.json                      npm workspaces, all scripts
tsconfig.json                     single root typecheck project
tsconfig.base.json                shared compilerOptions + workspace paths
eslint.config.js                  flat config, js + ts + svelte + prettier
prettier.config.js                tabs, single quotes, width 100
vitest.config.ts                  root config, node + browser projects
.npmrc  .editorconfig  .gitignore
AGENTS.md                         hard rules, verified commands, module map
.github/workflows/ci.yml          lint, check, test, guard
tools/sim/pins.txt                pinned submodule SHAs (the guard's source of truth)
tools/sim/guard.sh                asserts submodule pins and no staged submodule changes
tools/sim/platformio.local.ini.tpl  [env:simulator] from the simulator Linux sample
tools/sim/setup.sh                installs the ini + inits freeink-sdk
tools/sim/run.sh                  pio run -e simulator -t run_simulator
tools/sim/test/guard_test.sh      guard.sh behavior tests
packages/optimize/package.json
packages/optimize/src/options.ts     OptimizeOptions, DEFAULT_OPTIONS
packages/optimize/src/paths.ts       zip-path arithmetic                 (pure)
packages/optimize/src/decode.ts      XML/HTML byte decoding              (pure)
packages/optimize/src/css.ts         minify, budget split, defensive CSS (pure)
packages/optimize/src/report.ts      report entries + text log           (pure)
packages/optimize/src/errors.ts      OptimizeError with stable codes     (pure)
packages/optimize/src/ingest.ts      unzip, OPF, spine, TOC parse        (browser)
packages/optimize/src/document.ts    per-document DOM transforms         (browser)
packages/optimize/src/images.ts      downscale, grayscale, JPEG, split   (browser)
packages/optimize/src/split.ts       oversized document splitting        (browser)
packages/optimize/src/toc.ts         NCX and NAV rebuild after rewrites   (browser)
packages/optimize/src/repack.ts      OCF-correct zip writer              (node-ok)
packages/optimize/src/pipeline.ts    stage order, progress, cancellation  (browser)
packages/optimize/src/index.ts       public surface
packages/optimize/test/helpers/fixture.ts   in-memory EPUB builder
packages/optimize/test/*.test.ts
apps/web/{package.json,vite.config.ts,index.html,src/main.ts,src/App.svelte,src/app.css,src/lib/*.svelte}
apps/server/{package.json,src/index.ts,test/server.test.ts}
```

Dependency direction is one-way: `apps/web` imports `pipeline`, `optimize`; `apps/server` imports nothing from `packages/`. Within `optimize`, the five pure modules import nothing from the browser modules, which is what lets half the test suite run in the cheap `node` project.

---

## Phase 0: Repository Scaffold

### Task 0: First commit, so the guard has something to compare against

**Files:**

- Create: `docs/superpowers/specs/2026-09-03-xteink-x4-epub-optimizer-design.md` (already written and approved), `docs/superpowers/plans/2026-09-03-xteink-x4-epub-optimizer-phase-0.md` (this file)
- Staged by the user already: `.gitmodules`, `crosspoint-reader/crosspoint-firmware`, `crosspoint-reader/crosspoint-simulator`

**Interfaces:**

- Consumes: the empty repo at `main` with `origin` set to `git@github.com:bhumong/xteink-x4-epub-optimizer`.
- Produces: the first commit, which records the submodule gitlinks and thereby makes the superproject half of `tools/sim/guard.sh` meaningful. Until this exists, the guard prints `no commits yet; skipping gitlink checks` and only verifies submodule HEADs.

This task exists because the guard was tested against the real repo before this commit existed and correctly refused to judge gitlinks it could not compare. Verified: `git diff --cached` against an unborn HEAD reports every staged path, so a naive check would fail permanently on a fresh clone.

- [ ] **Step 1: Confirm nothing unwanted is staged**

Run: `git status --short && git submodule status`
Expected: staged entries are exactly `.gitmodules` and the two submodule gitlinks, plus untracked `docs/`. Submodule HEADs are `badfa95f` and `c55f168b`. Nothing else.

If a `docs/` file is missing, the spec or plan was not written yet; stop and finish that first.

- [ ] **Step 2: Commit**

```bash
git add docs .gitmodules crosspoint-reader/crosspoint-firmware crosspoint-reader/crosspoint-simulator
git commit -m "chore: init repo with pinned CrossPoint submodules and phase 0 plan

Registers the firmware and simulator as read-only vendored submodules at
badfa95f and c55f168b, plus the approved design spec and this plan."
```

Explicit paths, never `git add -A`: the global constraint forbids accidentally staging a moved gitlink, and `-A` is how that happens.

- [ ] **Step 3: Verify the gitlink check is now live**

Run: `git log --oneline -1 && git ls-files -s crosspoint-reader`
Expected: one commit; two `160000` gitlink entries with the pinned SHAs. From here on, `tools/sim/guard.sh` (Task 2) will run its superproject check rather than skipping it, and guard test case 7 will exercise that path for real.

- [ ] **Step 4: Do not push yet**

Pushing is a separate decision from committing. This plan never pushes; Tasks 1 through 7 stay local so you can review before `origin` sees anything.

### Task 1: Workspace scaffold with a green build

**Files:**

- Create: `package.json`, `tsconfig.base.json`, `tsconfig.json`, `.npmrc`, `.editorconfig`, `.gitignore`, `prettier.config.js`, `eslint.config.js`, `vitest.config.ts`
- Create: `packages/optimize/package.json`, `packages/optimize/src/paths.ts`, `packages/optimize/test/paths.node.test.ts`
- Create: `packages/optimize/tsconfig.json`

**Interfaces:**

- Consumes: nothing.
- Produces: `paths.ts` exports `opfDirectoryPath(opfPath: string): string`, `joinZipPath(baseDir: string, href: string): string`, `relativeZipPath(fromPath: string, toPath: string): string`, `decodeHref(href: string): string`, `fileExtension(path: string): string`. Task 5 consumes all five.

- [ ] **Step 1: Create the root workspace files**

`package.json` (dep versions get filled by `npm install` in Step 2):

```json
{
	"name": "xteink-x4-epub-optimizer",
	"private": true,
	"version": "0.0.0",
	"type": "module",
	"workspaces": ["packages/*", "apps/*"],
	"engines": { "node": ">=24" },
	"scripts": {
		"check": "tsc --noEmit -p tsconfig.json",
		"lint": "eslint .",
		"format": "prettier --check .",
		"format:write": "prettier --write .",
		"test": "vitest run",
		"test:node": "vitest run --project node",
		"test:browser": "vitest run --project browser",
		"guard": "bash tools/sim/guard.sh"
	}
}
```

`tsconfig.base.json`:

```json
{
	"compilerOptions": {
		"target": "ES2023",
		"lib": ["ES2023", "DOM", "DOM.Iterable"],
		"module": "ESNext",
		"moduleResolution": "bundler",
		"strict": true,
		"noImplicitOverride": true,
		"verbatimModuleSyntax": true,
		"isolatedModules": true,
		"skipLibCheck": true,
		"resolveJsonModule": true,
		"allowImportingTsExtensions": false,
		"forceConsistentCasingInFileNames": true,
		"noEmit": true,
		"baseUrl": ".",
		"paths": {
			"@xteink/optimize": ["packages/optimize/src/index.ts"],
			"@xteink/optimize/*": ["packages/optimize/src/*"]
		}
	}
}
```

`tsconfig.json`:

```json
{
	"extends": "./tsconfig.base.json",
	"include": [
		"packages/*/src/**/*.ts",
		"packages/*/test/**/*.ts",
		"apps/*/src/**/*.ts",
		"vitest.config.ts"
	],
	"exclude": ["node_modules", "crosspoint-reader", "apps/web/dist", "apps/server/dist"]
}
```

`crosspoint-reader` stays out of `exclude` by name for a reason: it is 63 MB of C++ and HTML we do not own, and typechecking it would be both slow and wrong.

`.npmrc`:

```text
engine-strict=true
```

`.editorconfig`:

```text
root = true

[*]
charset = utf-8
end_of_line = lf
insert_final_newline = true
indent_style = tab
trim_trailing_whitespace = true

[*.yml]
indent_style = space
indent_size = 2

[*.md]
trim_trailing_whitespace = false
```

`.gitignore`:

```text
node_modules/
dist/
apps/web/dist/
apps/server/dist/
.turbo/
*.tsbuildinfo

# Simulator build state. All of these live inside submodules that already
# ignore them; listed here so an accidental stray copy is never committed.
crosspoint-reader/**/.pio/
crosspoint-reader/**/fs_/
crosspoint-reader/**/platformio.local.ini

# Local QA artifacts
.qa/
*.log

.DS_Store
Thumbs.db
.env
.env.*
!.env.example
```

`prettier.config.js`:

```js
/** @type {import("prettier").Config} */
export default {
	useTabs: true,
	singleQuote: true,
	trailingComma: 'none',
	printWidth: 100,
	overrides: [{ files: '*.md', options: { parser: 'markdown' } }]
};
```

`eslint.config.js`:

```js
import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import globals from 'globals';
import ts from 'typescript-eslint';

export default ts.config(
	{ ignores: ['crosspoint-reader/**', 'node_modules/**', '**/dist/**', '**/.svelte-kit/**'] },
	js.configs.recommended,
	...ts.configs.recommended,
	prettier,
	{
		languageOptions: { globals: { ...globals.browser, ...globals.node } },
		rules: { 'no-undef': 'off' }
	},
	{
		files: ['**/*.test.ts'],
		rules: { '@typescript-eslint/expect-function-type': 'off' }
	}
);
```

If the `no-undef` disable or the test-file block trips on the installed eslint version, delete that block rather than adding an eslint-disable comment: the rule is off by default in `typescript-eslint` v8 recommended configs anyway.

`vitest.config.ts`:

```ts
import { playwright } from '@vitest/browser-playwright';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const root = fileURLToPath(new URL('.', import.meta.url));
const optimize = root + 'packages/optimize/src';

export default defineConfig({
	resolve: {
		alias: {
			'@xteink/optimize': optimize + '/index.ts'
		}
	},
	test: {
		expect: { requireAssertions: true },
		projects: [
			{
				resolve: { alias: { '@xteink/optimize': optimize + '/index.ts' } },
				test: {
					name: 'node',
					environment: 'node',
					include: ['packages/optimize/test/**/*.node.test.ts']
				}
			},
			{
				resolve: { alias: { '@xteink/optimize': optimize + '/index.ts' } },
				test: {
					name: 'browser',
					browser: {
						enabled: true,
						provider: playwright(),
						instances: [{ browser: 'chromium', headless: true }]
					},
					include: ['packages/optimize/test/**/*.browser.test.ts']
				}
			}
		]
	}
});
```

The `.node.test.ts` and `.browser.test.ts` suffix convention is the whole test-project routing rule. Keep it: a test file with the wrong suffix silently never runs.

`packages/optimize/package.json`:

```json
{
	"name": "@xteink/optimize",
	"private": true,
	"version": "0.0.0",
	"type": "module",
	"main": "./src/index.ts",
	"types": "./src/index.ts",
	"exports": {
		".": "./src/index.ts",
		"./*": "./src/*"
	}
}
```

`packages/optimize/tsconfig.json`:

```json
{
	"extends": "../../tsconfig.base.json",
	"include": ["src/**/*.ts", "test/**/*.ts"]
}
```

- [ ] **Step 2: Install dependencies**

Run: `npm install -D typescript@^5 vitest@^3 @vitest/browser-playwright@^3 playwright@^1 eslint@^9 @eslint/js@^9 typescript-eslint@^8 eslint-config-prettier@^10 globals@^16 prettier@^3 && npx playwright install chromium`
Expected: exit 0, `node_modules/` and `package-lock.json` exist, Chromium downloaded. Needs network.

- [ ] **Step 3: Write the failing path-arithmetic test**

`packages/optimize/test/paths.node.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
	decodeHref,
	fileExtension,
	joinZipPath,
	opfDirectoryPath,
	relativeZipPath
} from '@xteink/optimize/paths.ts';

describe('opfDirectoryPath', () => {
	it('returns the trailing-slash directory of a nested OPF', () => {
		expect(opfDirectoryPath('OEBPS/content.opf')).toBe('OEBPS/');
	});
	it('returns empty string for a root-level OPF', () => {
		expect(opfDirectoryPath('content.opf')).toBe('');
	});
});

describe('joinZipPath', () => {
	it('resolves a relative href against the OPF directory', () => {
		expect(joinZipPath('OEBPS/', 'Text/ch1.xhtml')).toBe('OEBPS/Text/ch1.xhtml');
	});
	it('collides away dot-dot segments', () => {
		expect(joinZipPath('OEBPS/Text/', '../Images/cover.jpg')).toBe('OEBPS/Images/cover.jpg');
	});
	it('strips fragments and query strings', () => {
		expect(joinZipPath('OEBPS/', 'Text/ch1.xhtml#sec2')).toBe('OEBPS/Text/ch1.xhtml');
	});
	it('treats a leading slash as container-root-relative, not absolute-on-disk', () => {
		expect(joinZipPath('OEBPS/', '/Images/cover.jpg')).toBe('Images/cover.jpg');
	});
	it('percent-decodes before resolving', () => {
		expect(joinZipPath('OEBPS/', 'Text/my%20ch.xhtml')).toBe('OEBPS/Text/my ch.xhtml');
	});
});

describe('relativeZipPath', () => {
	it('walks up out of a nested directory', () => {
		expect(relativeZipPath('OEBPS/Text/ch1.xhtml', 'OEBPS/Images/cover.jpg')).toBe(
			'../Images/cover.jpg'
		);
	});
	it('stays in place for a sibling', () => {
		expect(relativeZipPath('OEBPS/Text/ch1.xhtml', 'OEBPS/Text/style.css')).toBe('style.css');
	});
	it('handles a root target from a nested source', () => {
		expect(relativeZipPath('OEBPS/Text/ch1.xhtml', 'Images/cover.jpg')).toBe(
			'../../Images/cover.jpg'
		);
	});
});

describe('decodeHref', () => {
	it('decodes a valid escape', () => {
		expect(decodeHref('my%20ch.xhtml')).toBe('my ch.xhtml');
	});
	it('returns the input unchanged for a malformed escape', () => {
		expect(decodeHref('100%zz.xhtml')).toBe('100%zz.xhtml');
	});
});

describe('fileExtension', () => {
	it('lowercases the extension', () => {
		expect(fileExtension('OEBPS/Images/Cover.JPEG')).toBe('jpeg');
	});
	it('returns empty string when there is no extension', () => {
		expect(fileExtension('OEBPS/Text/noext')).toBe('');
	});
});
```

- [ ] **Step 4: Run the test to verify it fails**

Run: `npx vitest run --project node`
Expected: FAIL, module not found for `@xteink/optimize/paths.ts`.

- [ ] **Step 5: Implement `paths.ts`**

`packages/optimize/src/paths.ts`:

```ts
/** Strip a fragment or query suffix, then percent-decode an EPUB href. */
export function decodeHref(href: string): string {
	try {
		return decodeURIComponent(href);
	} catch {
		return href;
	}
}

/** Directory prefix of an OPF path, with trailing slash. '' when at container root. */
export function opfDirectoryPath(opfPath: string): string {
	const idx = opfPath.lastIndexOf('/');
	return idx === -1 ? '' : opfPath.slice(0, idx + 1);
}

/**
 * Resolve an href to a zip-internal path.
 *
 * A leading slash is container-root-relative per OPF rules, not filesystem
 * absolute, so it is stripped rather than trusted.
 */
export function joinZipPath(baseDir: string, href: string): string {
	const cleaned = decodeHref(href.split('#')[0].split('?')[0]);
	const raw = cleaned.startsWith('/') ? cleaned.slice(1) : baseDir + cleaned;
	const segments: string[] = [];
	for (const segment of raw.split('/')) {
		if (segment === '' || segment === '.') continue;
		if (segment === '..') {
			segments.pop();
			continue;
		}
		segments.push(segment);
	}
	return segments.join('/');
}

/** Relative href from one zip-internal file path to another zip-internal path. */
export function relativeZipPath(fromPath: string, toPath: string): string {
	const fromDirs = fromPath.split('/').slice(0, -1);
	const toParts = toPath.split('/');
	let common = 0;
	while (
		common < fromDirs.length &&
		common < toParts.length &&
		fromDirs[common] === toParts[common]
	) {
		common++;
	}
	const up: string[] = [];
	for (let i = common; i < fromDirs.length; i++) up.push('..');
	const down = toParts.slice(common);
	return [...up, ...down].join('/');
}

/** Lowercased extension without the dot. '' when the basename has none. */
export function fileExtension(path: string): string {
	const name = path.slice(path.lastIndexOf('/') + 1);
	const dot = name.lastIndexOf('.');
	return dot <= 0 ? '' : name.slice(dot + 1).toLowerCase();
}
```

- [ ] **Step 6: Create the barrel export**

`packages/optimize/src/index.ts`:

```ts
export * from './paths.ts';
```

Every `packages/optimize/src/*.ts` file added by later tasks gets one line here. Importing through the barrel in app code keeps the public surface reviewable in one place.

- [ ] **Step 7: Run test, lint, format, and typecheck to verify green**

Run: `npx vitest run --project node && npm run check && npm run lint && npm run format`
Expected: 14 tests PASS; `tsc` exits 0; eslint exits 0; prettier reports no unchecked files.

If `npm run check` cannot resolve `@xteink/optimize/paths.ts`, the `paths` mapping in `tsconfig.base.json` is wrong: `baseUrl` must be the repo root (the directory containing `tsconfig.base.json`), and the mapping target must be `packages/optimize/src/*`.

- [ ] **Step 8: Commit**

```bash
git add package.json package-lock.json tsconfig.base.json tsconfig.json .npmrc .editorconfig \
  .gitignore prettier.config.js eslint.config.js vitest.config.ts packages/optimize
git commit -m "chore: scaffold npm workspace with optimize package and vitest projects"
```

### Task 2: Submodule guard

**Files:**

- Create: `tools/sim/pins.txt`, `tools/sim/guard.sh`, `tools/sim/test/guard_test.sh`
- Modify: `package.json` (add `guard:test` script)

**Interfaces:**

- Consumes: git 2.53+ (available on host).
- Produces: `bash tools/sim/guard.sh` exits 0 when the vendored submodules are untouched at the gitlink level, 1 otherwise. `bash tools/sim/test/guard_test.sh` prints `guard_test: PASS` and exits 0. Tasks 3 and 13 invoke the guard.

The check is exactly the spec's Section 2 rule 3, and it deliberately does **not** require a clean submodule working tree: unstaged edits and untracked files inside the submodules are allowed, because building the simulator produces both.

- [ ] **Step 1: Write the pins file**

`tools/sim/pins.txt`:

```text
# Pinned vendored submodule SHAs. The guard fails if either HEAD moves or
# either gitlink is staged in the superproject. Update deliberately, never as
# a side effect of a build.
crosspoint-reader/crosspoint-firmware badfa95ff747a0cbd07cf23186382a43ca9852e9
crosspoint-reader/crosspoint-simulator c55f168bc0e677fdb32312c8be4b5874469465e6
```

- [ ] **Step 2: Write the failing guard test**

Each case builds a synthetic superproject directory containing an embedded git repo at path `sub`, so the guard's own path logic is exercised rather than short-circuited. `tools/sim/test/guard_test.sh`:

```bash
#!/usr/bin/env bash
# Tests tools/sim/guard.sh against synthetic repos under a temp dir.
set -euo pipefail

GUARD="${BASH_SOURCE[0]%/*}/../guard.sh"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

fails=0
expect_status() {
  local want="$1" label="$2"; shift 2
  local got=0
  "$@" >/dev/null 2>&1 || got=$?
  if [ "$got" = "$want" ]; then
    echo "  ok   $label"
  else
    echo "  FAIL $label (expected exit $want, got $got)"
    fails=$((fails + 1))
  fi
}

g() { git -c user.email=t@t -c user.name=t "$@"; }

# new_sub <dir>: make an embedded git repo with one commit, print nothing
new_sub() {
  mkdir -p "$1"
  g -C "$1" init -q
  echo base > "$1/tracked.txt"
  g -C "$1" add tracked.txt
  g -C "$1" commit -qm init
}

# --- case 1: clean synthetic root passes -------------------------------
C1="$WORK/case1"; mkdir -p "$C1"; new_sub "$C1/sub"
printf 'sub %s\n' "$(g -C "$C1/sub" rev-parse HEAD)" > "$WORK/pins1.txt"
expect_status 0 "clean repo passes" bash "$GUARD" --pins "$WORK/pins1.txt" --root "$C1"

# --- case 2: submodule HEAD moved past the pin -------------------------
C2="$WORK/case2"; mkdir -p "$C2"; new_sub "$C2/sub"
printf 'sub %s\n' "$(g -C "$C2/sub" rev-parse HEAD)" > "$WORK/pins2.txt"
echo change > "$C2/sub/tracked.txt"; g -C "$C2/sub" commit -qam advance
expect_status 1 "moved HEAD fails" bash "$GUARD" --pins "$WORK/pins2.txt" --root "$C2"

# --- case 3: staged change inside the submodule ------------------------
C3="$WORK/case3"; mkdir -p "$C3"; new_sub "$C3/sub"
printf 'sub %s\n' "$(g -C "$C3/sub" rev-parse HEAD)" > "$WORK/pins3.txt"
echo new > "$C3/sub/staged.txt"; g -C "$C3/sub" add staged.txt
expect_status 1 "staged submodule change fails" bash "$GUARD" --pins "$WORK/pins3.txt" --root "$C3"

# --- case 4: unstaged edit plus untracked file is allowed --------------
C4="$WORK/case4"; mkdir -p "$C4"; new_sub "$C4/sub"
printf 'sub %s\n' "$(g -C "$C4/sub" rev-parse HEAD)" > "$WORK/pins4.txt"
echo dirty > "$C4/sub/tracked.txt"; mkdir -p "$C4/sub/ignored" && echo x > "$C4/sub/ignored/f"
expect_status 0 "unstaged and untracked are allowed" bash "$GUARD" --pins "$WORK/pins4.txt" --root "$C4"

# --- case 5: missing submodule directory is reported -------------------
C5="$WORK/case5"; mkdir -p "$C5"
printf 'sub %s\n' 0000000000000000000000000000000000000000 > "$WORK/pins5.txt"
expect_status 1 "missing checkout fails" bash "$GUARD" --pins "$WORK/pins5.txt" --root "$C5"

# --- case 6: staged gitlink change in the superproject -----------------
C6="$WORK/case6"; mkdir -p "$C6"; new_sub "$C6/sub"
g -C "$C6" init -q
printf 'sub %s\n' "$(g -C "$C6/sub" rev-parse HEAD)" > "$WORK/pins6.txt"
g -C "$C6" add sub 2>/dev/null; g -C "$C6" commit -qm 'track gitlink'
g -C "$C6/sub" commit -qam 'advance' --allow-empty
echo x > "$C6/sub/other.txt"; g -C "$C6/sub" add other.txt; g -C "$C6/sub" commit -qm 'advance2'
g -C "$C6" add sub 2>/dev/null
expect_status 1 "staged gitlink change fails" bash "$GUARD" --pins "$WORK/pins6.txt" --root "$C6"

# --- case 7: the real repo passes with its real pins -------------------
expect_status 0 "real repo passes" bash "$GUARD"

if [ "$fails" -ne 0 ]; then
  echo "guard_test: $fails FAILED"
  exit 1
fi
echo "guard_test: PASS"
```

Case 7 runs against the actual repo, which is the only place the real pins and real submodules coexist. Each case writes its own pins file inline so the pin under test sits adjacent to the assertion that depends on it.

- [ ] **Step 3: Run the test to verify it fails**

Run: `bash tools/sim/test/guard_test.sh`
Expected: FAIL, `guard.sh` not found.

- [ ] **Step 4: Implement `guard.sh`**

`tools/sim/guard.sh`:

```bash
#!/usr/bin/env bash
# Assert the vendored CrossPoint submodules are untouched where it matters:
# their HEAD commits, and their gitlinks in this repo's index.
#
# Unstaged edits and untracked files inside the submodules are ALLOWED on
# purpose -- building the simulator creates them.
#
# Usage: guard.sh [--pins <file>] [--root <superproject-dir>]
set -euo pipefail

SCRIPT_DIR="$(cd "${BASH_SOURCE[0]%/*}" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
PINS="$REPO_ROOT/tools/sim/pins.txt"
ROOT="$REPO_ROOT"

while [ "$#" -gt 0 ]; do
  case "$1" in
    --pins) PINS="$2"; shift 2 ;;
    --root) ROOT="$2"; shift 2 ;;
    *) echo "guard: unknown argument: $1" >&2; exit 2 ;;
  esac
done

[ -f "$PINS" ] || { echo "guard: missing pins file: $PINS" >&2; exit 2; }

fail=0
report() { printf 'guard: %s\n' "$1" >&2; fail=1; }

# Superproject checks are skipped when --root is not a git work tree, which
# lets the unit tests drive the per-submodule checks in isolation.
superproject_is_git=false
if git -C "$ROOT" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  superproject_is_git=true
fi

# With no commits yet, `git diff --cached` compares against an empty tree and
# reports every staged path, so the gitlink check would always fail on a fresh
# repo. The check becomes meaningful once the initial commit records the
# submodules, which is Task 0.
if [ "$superproject_is_git" = true ] && ! git -C "$ROOT" rev-parse --verify -q HEAD >/dev/null; then
  superproject_is_git=false
  echo "guard: note: no commits yet in $ROOT; skipping gitlink checks" >&2
fi

while read -r path want; do
  case "$path" in ''|'#'*) continue ;; esac

  if [ ! -d "$ROOT/$path" ]; then
    report "$path: not checked out; run git submodule update --init --recursive"
    continue
  fi

  have="$(git -C "$ROOT/$path" rev-parse HEAD 2>/dev/null || echo unknown)"
  if [ "$have" != "$want" ]; then
    report "$path: HEAD $have != pinned $want"
    continue
  fi

  if ! git -C "$ROOT/$path" diff --cached --quiet; then
    report "$path: staged changes inside submodule; unstage them (git -C $path restore --staged .)"
  fi

  if [ "$superproject_is_git" = true ]; then
    if ! git -C "$ROOT" diff --cached --quiet -- "$path"; then
      report "$ROOT: staged gitlink change for $path; unstage it"
    fi
  fi

  printf 'guard: ok %s @ %s\n' "$path" "${want:0:8}"
done < <(grep -v '^[[:space:]]*#' "$PINS" | grep -v '^[[:space:]]*$')

if [ "$fail" -ne 0 ]; then
  echo "guard: FAILED" >&2
  exit 1
fi
echo "guard: PASS"
```

Make both executable: `chmod +x tools/sim/guard.sh tools/sim/test/guard_test.sh`

- [ ] **Step 5: Add the test script and run everything**

Add to `package.json` `scripts`:

```json
"guard:test": "bash tools/sim/test/guard_test.sh"
```

Run: `npm run guard:test && npm run guard`
Expected: `guard_test: PASS` with all seven cases `ok`; then `guard: ok ...` twice and `guard: PASS`.

- [ ] **Step 6: Verify it actually catches a violation**

Run:

```bash
printf 'crosspoint-reader/crosspoint-firmware 0000000000000000000000000000000000000000\ncrosspoint-reader/crosspoint-simulator c55f168bc0e677fdb32312c8be4b5874469465e6\n' > /tmp/bad-pins.txt
git -C /home/legion/DEV/TEST_AREA/xteink-x4-epub-optimizer stash list >/dev/null
if npm run guard -- --pins /tmp/bad-pins.txt; then echo "NOT CAUGHT"; else echo "caught as expected"; fi
```

Expected: `guard: crosspoint-reader/crosspoint-firmware: HEAD ... != pinned ...`, `guard: FAILED`, `caught as expected`.

Note: `npm run guard -- <args>` forwards arguments after the double dash. If a wrapper swallows them, call `bash tools/sim/guard.sh --pins /tmp/bad-pins.txt` directly.

- [ ] **Step 7: Commit**

```bash
git add tools/sim package.json
git commit -m "feat(tools): add submodule guard asserting pinned CrossPoint HEADs
```

### Task 3: AGENTS.md

**Files:**

- Create: `AGENTS.md`

**Interfaces:**

- Consumes: the scripts created by Tasks 1 and 2, and the `sim:*` scripts created by Task 4. Every command listed in `AGENTS.md` must exist by the end of this plan; add the Task 4 entries now and they become valid one task later.
- Produces: the rule text that every later task and every agent session inherits.

Write it with the rules first, in the shape the user's other repos use, and never state a command that has not been run here. The three non-obvious facts below all came from reading the pinned submodule during spec work, so they belong in the file rather than in someone's memory.

`AGENTS.md`:

```markdown
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
```

- [ ] **Step 1: Write `AGENTS.md`** with exactly the content above, minus the outer fence.

- [ ] **Step 2: Verify the referenced paths exist**

Run:

```bash
for p in docs/superpowers/specs/2026-09-03-xteink-x4-epub-optimizer-design.md \
         tools/sim/pins.txt tools/sim/guard.sh \
         crosspoint-reader/crosspoint-firmware/docs/file-formats.md \
         crosspoint-reader/crosspoint-simulator/README.md; do
  [ -e "$p" ] && echo "ok   $p" || echo "MISSING $p"; done
```

Expected: eight `ok` lines, no `MISSING`.

- [ ] **Step 3: Format and commit**

```bash
npm run format:write -- AGENTS.md
git add AGENTS.md
git commit -m "docs: add AGENTS.md with submodule, device, and browser-only rules"
```

### Task 4: Simulator builds locally without touching tracked submodule files

**Files:**

- Create: `tools/sim/platformio.local.ini.tpl`, `tools/sim/setup.sh`, `tools/sim/run.sh`, `tools/sim/test/setup_test.sh`
- Modify: `package.json` (add `sim:*` scripts)

**Interfaces:**

- Consumes: `npm run guard` from Task 2; the pinned submodules.
- Produces: `.pio/build/simulator/program` inside the firmware submodule, runnable as a host binary with the firmware's own `lib/Epub` and `lib/Xtc` code. `npm run sim:setup` is idempotent.

Why this shape: the firmware's `platformio.ini` already declares `extra_configs = platformio.local.ini`, and its `.gitignore` covers `*.local*`, `fs_`, `.pio`, and `*.generated.h`. So the simulator env goes in that ignored file, and every build artifact lands on a path the submodule already ignores. Verified against the pinned commits: the simulator at `c55f168b` no longer rewrites tracked firmware sources (its `run_simulator.py` docstring still describes patches that commit `ce58486` removed, and both fixes are now upstream in the firmware), so a build produces only untracked ignored files.

`lib_deps` uses a **symlink** to the pinned simulator, not the git URL. Fetching `simulator=https://github.com/crosspoint-reader/crosspoint-simulator` would resolve to upstream HEAD and silently build against code other than the pinned commit, defeating the pin discipline.

- [ ] **Step 1: Write the ini template**

`tools/sim/platformio.local.ini.tpl` starts from the simulator's `sample-platformio-linux-wsl.ini` with the local-dev and X4 choices made:

```ini
# Installed by tools/sim/setup.sh into
# crosspoint-reader/crosspoint-firmware/platformio.local.ini, which that repo's
# .gitignore already excludes (*.local*). Do not edit the installed copy; edit
# this template and re-run setup.
#
# Based on crosspoint-simulator/sample-platformio-linux-wsl.ini for
# simulator@c55f168b. Diff against that file when bumping the simulator pin.

[env:simulator]
platform = native
lib_ldf_mode = deep+
lib_compat_mode = off
build_src_filter =
  +<*>
  ; Firmware-update code remains non-destructive in the simulator.
  -<network/FirmwareFlasher.cpp>
  -<network/OtaBootSwitch.cpp>
  -<network/OtaUpdater.cpp>
  -<platform/skip_efuse_blk_check.c>
build_flags =
  -std=gnu++2a
  !sdl2-config --cflags --libs
  -lssl
  -lcrypto
  -Wno-deprecated-declarations
  -Wno-narrowing
  -DSIMULATOR
  -DFREEINK_DEVICE_X4=1
  -DCROSSPOINT_SIMULATOR_PROJECT_WEBSERVER
  -DCROSSPOINT_VERSION=\"dev-simulator\"
  -DENABLE_SERIAL_LOG
  -DLOG_LEVEL=2
  -DEINK_DISPLAY_SINGLE_BUFFER_MODE=1
  -DMINIZ_NO_ZLIB_COMPATIBLE_NAMES=1
  -DXML_GE=0
  -DXML_CONTEXT_BYTES=1024
  -DUSE_UTF8_LONG_NAMES=1
  -DPNG_MAX_BUFFERED_PIXELS=16416
  -DDISABLE_FS_H_WARNING=1
  -DDESTRUCTOR_CLOSES_FILE=1
  -Isrc
lib_ignore = hal, PNGdec, JPEGDEC, WebSockets
extra_scripts =
  pre:scripts/gen_i18n.py
  pre:scripts/git_branch.py
  pre:scripts/build_html.py
lib_deps =
  ; Symlink to the pinned submodule. Never replace with a git URL: that would
  ; build against upstream HEAD and invalidate the pin.
  simulator=symlink://../crosspoint-simulator
  FreeInkUI=symlink://freeink-sdk/libs/ui/FreeInkUI
  Icons=symlink://freeink-sdk/libs/assets/Icons
  bblanchon/ArduinoJson @ 7.4.2
  ricmoo/QRCode @ ^0.0.1
  https://github.com/bitbank2/AnimatedGIF.git#d01888f0255fd0781fc2b8600b9111b14c999584
  links2004/WebSockets @ 2.7.3
```

The `run_simulator` custom target comes from the simulator library's own `library.json` hook, so no `post:` script is needed and `custom_run_simulator_target_owner` stays unset.

- [ ] **Step 2: Write the failing setup test**

`tools/sim/test/setup_test.sh` checks setup is idempotent and leaves no staged submodule change:

```bash
#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "${BASH_SOURCE[0]%/*}/../../.." && pwd)"
FW="$ROOT/crosspoint-reader/crosspoint-firmware"
TARGET="$FW/platformio.local.ini"
TPL="$ROOT/tools/sim/platformio.local.ini.tpl"

fails=0
ok() { echo "  ok   $1"; }
bad() { echo "  FAIL $1"; fails=$((fails + 1)); }

[ -f "$TARGET" ] && ok "platformio.local.ini installed" || bad "platformio.local.ini missing"

if [ -f "$TARGET" ] && cmp -s "$TARGET" "$TPL"; then
  ok "installed copy matches template"
else
  bad "installed copy differs from template"
fi

if git -C "$ROOT" check-ignore -q "$TARGET"; then
  ok "installed copy is git-ignored by the submodule"
else
  bad "installed copy is NOT ignored; it could be committed"
fi

if [ -d "$FW/freeink-sdk/libs/ui/FreeInkUI" ]; then
  ok "nested freeink-sdk submodule initialized"
else
  bad "freeink-sdk not initialized (needed by simulator lib_deps)"
fi

if git -C "$FW" diff --cached --quiet && git -C "$ROOT" diff --cached --quiet; then
  ok "nothing staged in submodule or superproject"
else
  bad "setup staged changes; that violates the read-only rule"
fi

if [ "$fails" -ne 0 ]; then echo "setup_test: $fails FAILED"; exit 1; fi
echo "setup_test: PASS"
```

- [ ] **Step 3: Run it to verify it fails**

Run: `bash tools/sim/test/setup_test.sh`
Expected: FAIL, `platformio.local.ini missing` and `freeink-sdk not initialized`.

- [ ] **Step 4: Implement `setup.sh`**

`tools/sim/setup.sh`:

```bash
#!/usr/bin/env bash
# Make the firmware submodule buildable as a desktop simulator without
# committing anything to it. Safe to re-run.
set -euo pipefail

SCRIPT_DIR="$(cd "${BASH_SOURCE[0]%/*}" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
FW="$ROOT/crosspoint-reader/crosspoint-firmware"
TPL="$SCRIPT_DIR/platformio.local.ini.tpl"

require() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "setup: missing required command '$1'." >&2
    echo "setup: install with: $2" >&2
    exit 3
  }
}

[ -d "$FW" ] || { echo "setup: $FW missing; run git submodule update --init" >&2; exit 3; }

require git "git"
require python3 "your OS package manager"
require sdl2-config "sudo apt install libsdl2-dev"
if ! command -v pio >/dev/null 2>&1; then
  echo "setup: 'pio' not found. Install with: pip install platformio" >&2
  echo "setup: then re-run npm run sim:setup" >&2
  exit 3
fi

npm run --silent guard

# The firmware's own .gitmodules declares this nested submodule and the
# simulator's lib_deps symlinks into it. --init is recursive so the SDK pin
# recorded by the firmware is what gets checked out.
echo "setup: initializing nested freeink-sdk submodule"
git -C "$FW" submodule update --init --recursive --depth 1 freeink-sdk

echo "setup: installing simulator env -> $FW/platformio.local.ini"
cp "$TPL" "$FW/platformio.local.ini"

npm run --silent guard
bash "$SCRIPT_DIR/test/setup_test.sh"
```

- [ ] **Step 5: Implement `run.sh`**

`tools/sim/run.sh`:

```bash
#!/usr/bin/env bash
# Build and/or run the desktop simulator from the firmware submodule.
# Usage: run.sh [build|run]   (default: run)
set -euo pipefail

SCRIPT_DIR="$(cd "${BASH_SOURCE[0]%/*}" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
FW="$ROOT/crosspoint-reader/crosspoint-firmware"
MODE="${1:-run}"

[ -f "$FW/platformio.local.ini" ] || {
  echo "run.sh: simulator env not installed; run npm run sim:setup first" >&2
  exit 3
}

cd "$FW"
npm run --silent --prefix "$ROOT" guard

case "$MODE" in
  build) pio run -e simulator ;;
  run)   pio run -e simulator -t run_simulator ;;
  *)     echo "run.sh: mode must be build or run, got '$MODE'" >&2; exit 2 ;;
esac

npm run --silent --prefix "$ROOT" guard
```

The closing `guard` is the point of the script: it is the check that a build did not leave a tracked submodule file modified.

Add to `package.json` `scripts`:

```json
"sim:setup": "bash tools/sim/setup.sh",
"sim:build": "bash tools/sim/run.sh build",
"sim:run": "bash tools/sim/run.sh run"
```

- [ ] **Step 6: Install host dependencies**

Run: `sudo apt-get update && sudo apt-get install -y libsdl2-dev libssl-dev pkg-config && pip install --user platformio && export PATH="$HOME/.local/bin:$PATH" && pio --version`
Expected: `pio` prints a version. Needs network and sudo.

If `pip install` refuses on an externally-managed Python, use `pipx install platformio` instead.

- [ ] **Step 7: Run setup and the setup test**

Run: `npm run sim:setup && npm run guard`
Expected: `setup_test: PASS`, then `guard: PASS`. If setup exits 3, it is reporting a missing prerequisite from Step 6; fix that rather than editing the script.

- [ ] **Step 8: Build the simulator**

Run: `npm run sim:build`
Expected: PlatformIO compiles the firmware natively and prints `SUCCESS`, producing `.pio/build/simulator/program`. Expect a multi-minute first build that also fetches `ArduinoJson`, `QRCode`, `AnimatedGIF`, and `WebSockets`.

If the build fails, read `crosspoint-reader/crosspoint-simulator/README.md` and `.claude/CONTEXT-sim-notes.md` in that repo before changing anything, and record the fix in this plan. Two known-shaped failures and what they mean:

- undefined reference to a `Hal*` method: the firmware at `badfa95f` calls something the simulator at `c55f168b` does not stub. This is the "HAL stub rule" in the simulator's `AGENTS.md`. Fixing it means editing the simulator submodule, which is allowed but unstaged; the guard will warn. Prefer bumping the simulator pin deliberately over a permanent local patch, and note whichever you chose in the commit message.
- `sdl2-config: not found` or missing `SDL2/SDL.h`: Step 6 dependencies are not on this shell's `PATH`/include path.

- [ ] **Step 9: Verify the guard still passes after a real build**

Run: `npm run guard && git -C crosspoint-reader/crosspoint-firmware status --porcelain=v1 | grep -v '^??' || echo "no tracked modifications"`
Expected: `guard: PASS` and `no tracked modifications`. Anything else means the build touched a tracked firmware file; stop, `git -C crosspoint-reader/crosspoint-firmware restore <path>`, and find out why before proceeding.

- [ ] **Step 10: Confirm the reader UI comes up**

Run: `mkdir -p crosspoint-reader/crosspoint-firmware/fs_/books && npm run sim:run`
Expected: an SDL2 window titled for the X4 profile showing the CrossPoint home screen. Press `Escape` or close the window to exit. Then Ctrl-C the runner.

- [ ] **Step 11: Commit**

```bash
git add tools/sim package.json
git commit -m "feat(tools): build CrossPoint simulator locally via ignored platformio.local.ini"
```

Only `tools/sim` and `package.json` are added. The build artifacts inside the submodule are never staged, and `guard` is what proves it.

### Task 5: Svelte SPA shell served by Vite

**Files:**

- Create: `apps/web/package.json`, `apps/web/vite.config.ts`, `apps/web/index.html`, `apps/web/tsconfig.json`, `apps/web/src/main.ts`, `apps/web/src/App.svelte`, `apps/web/src/app.css`, `apps/web/src/lib/DropZone.svelte`, `apps/web/src/lib/FileButton.svelte`, `apps/web/src/lib/format.ts`, `apps/web/src/lib/format.browser.test.ts`
- Modify: `package.json` (add `dev`, `build`, `check:web`), `vitest.config.ts` (add `web` project)

**Interfaces:**

- Consumes: `@xteink/optimize` barrel, for `fileExtension` to reject non-EPUB drops.
- Produces: `apps/web/dist/`, the built SPA Task 6's Hono server serves. `format.ts` exports `formatBytes(n: number): string` and `baseName(path: string): string`.

Plain Vite + Svelte 5, not SvelteKit. One screen, no routes, no server rendering, nothing for an adapter to adapt; SvelteKit would add a routing layer this project does not use.

- [ ] **Step 1: Create the workspace package**

`apps/web/package.json` (dependency versions get filled by the install in Step 2):

```json
{
	"name": "@xteink/web",
	"private": true,
	"version": "0.0.0",
	"type": "module",
	"scripts": {
		"dev": "vite",
		"build": "vite build",
		"preview": "vite preview",
		"check": "svelte-check --tsconfig ./tsconfig.json"
	},
	"dependencies": {
		"@xteink/optimize": "*"
	}
}
```

`apps/web/tsconfig.json`:

```json
{
	"extends": "../../tsconfig.base.json",
	"compilerOptions": { "types": ["svelte", "vite/client"] },
	"include": ["src/**/*.ts", "src/**/*.svelte", "vite.config.ts"]
}
```

`apps/web/vite.config.ts`:

```ts
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { defineConfig } from 'vite';

export default defineConfig({
	plugins: [svelte({ compilerOptions: { runes: true } })],
	build: { outDir: 'dist', emptyOutDir: true },
	server: { port: 5173 }
});
```

`apps/web/index.html`:

```html
<!doctype html>
<html lang="en">
	<head>
		<meta charset="utf-8" />
		<meta name="viewport" content="width=device-width, initial-scale=1" />
		<title>Xteink X4 EPUB Optimizer</title>
	</head>
	<body>
		<div id="app"></div>
		<script type="module" src="/src/main.ts"></script>
	</body>
</html>
```

- [ ] **Step 2: Install the frontend toolchain**

Run: `npm install -w apps/web -D @sveltejs/vite-plugin-svelte svelte vite svelte-check @types/node && npm install && npx playwright install chromium`
Expected: exit 0, with versions resolved into `package-lock.json`. Do this before writing any test: the Vitest `web` project needs the Svelte plugin importable, and a red test is only useful if it fails on the assertion rather than on a missing toolchain.

- [ ] **Step 3: Register the web test project**

Add `import { svelte } from '@sveltejs/vite-plugin-svelte';` to the imports at the top of `vitest.config.ts`, then add this entry to `test.projects`, after the `browser` project:

```ts
{
	resolve: {
		alias: {
			'@xteink/optimize': optimize + '/index.ts'
		}
	},
	plugins: [svelte({ compilerOptions: { runes: true } })],
	test: {
		name: 'web',
		browser: {
			enabled: true,
			provider: playwright(),
			instances: [{ browser: 'chromium', headless: true }]
		},
		include: ['apps/web/src/**/*.browser.test.ts']
	}
}
```

Add to root `package.json` `scripts`:

```json
"dev": "npm run dev -w apps/web",
"check:web": "npm run check -w apps/web",
"build": "npm run build -w apps/web"
```

Run: `npx vitest run --project web`
Expected: "No test files found", confirming the project is registered and the include pattern is live. That is the precondition for a meaningful red test next.

- [ ] **Step 4: Write the failing format test**

`apps/web/src/lib/format.browser.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { baseName, formatBytes } from './format.ts';

describe('formatBytes', () => {
	it('uses bytes under 1 KiB', () => {
		expect(formatBytes(512)).toBe('512 B');
	});
	it('uses KiB with one decimal', () => {
		expect(formatBytes(1536)).toBe('1.5 KiB');
	});
	it('uses MiB with one decimal', () => {
		expect(formatBytes(19 * 1024 * 1024)).toBe('19.0 MiB');
	});
	it('handles zero', () => {
		expect(formatBytes(0)).toBe('0 B');
	});
});

describe('baseName', () => {
	it('strips directories', () => {
		expect(baseName('OEBPS/Text/ch1.xhtml')).toBe('ch1.xhtml');
	});
	it('returns the input when there is no separator', () => {
		expect(baseName('book.epub')).toBe('book.epub');
	});
});
```

- [ ] **Step 5: Run it to verify it fails**

Run: `npx vitest run --project web`
Expected: FAIL, `./format.ts` not found.

- [ ] **Step 6: Implement `format.ts`**

`apps/web/src/lib/format.ts`:

```ts
const KIB = 1024;
const MIB = KIB * 1024;

/** Binary units, which is how SD-card capacity is discussed in practice. */
export function formatBytes(n: number): string {
	if (n < KIB) return `${n} B`;
	if (n < MIB) return `${(n / KIB).toFixed(1)} KiB`;
	return `${(n / MIB).toFixed(1)} MiB`;
}

/** Final path segment of a zip-internal or filesystem path. */
export function baseName(path: string): string {
	return path.slice(path.lastIndexOf('/') + 1);
}
```

- [ ] **Step 7: Write the shell components**

`apps/web/src/lib/FileButton.svelte`:

```svelte
<script lang="ts">
	let { label, onpick }: { label: string; onpick: (file: File) => void } = $props();
	let input: HTMLInputElement | undefined = $state();
</script>

<button type="button" class="file-button" onclick={() => input?.click()}>{label}</button>
<input
	bind:this={input}
	type="file"
	accept=".epub,application/epub+zip"
	class="visually-hidden"
	onchange={(e) => {
		const file = (e.target as HTMLInputElement).files?.[0];
		if (file) onpick(file);
	}}
/>

<style>
	.file-button {
		padding: 0.5rem 1rem;
		border: 1px solid var(--line);
		border-radius: 6px;
		background: var(--panel);
		font: inherit;
		cursor: pointer;
	}
	.file-button:hover {
		background: var(--panel-hover);
	}
	.visually-hidden {
		position: absolute;
		width: 1px;
		height: 1px;
		overflow: hidden;
		clip-path: inset(50%);
	}
</style>
```

`apps/web/src/lib/DropZone.svelte`:

```svelte
<script lang="ts">
	import { fileExtension } from '@xteink/optimize';
	import FileButton from './FileButton.svelte';

	let { onpick }: { onpick: (file: File) => void } = $props();
	let dragging = $state(false);
	let rejection = $state('');

	function accept(files: FileList | null) {
		const file = files?.[0];
		if (!file) return;
		if (fileExtension(file.name) !== 'epub') {
			rejection = 'Only .epub files are supported.';
			return;
		}
		rejection = '';
		onpick(file);
	}
</script>

<div
	class="drop-zone"
	class:dragging
	ondragover={(e) => {
		e.preventDefault();
		dragging = true;
	}}
	ondragleave={() => (dragging = false)}
	ondrop={(e) => {
		e.preventDefault();
		dragging = false;
		accept(e.dataTransfer?.files ?? null);
	}}
>
	<p>Drop an EPUB here</p>
	<FileButton label="Choose file" {onpick} />
	{#if rejection}<p class="rejection" role="alert">{rejection}</p>{/if}
</div>

<style>
	.drop-zone {
		display: grid;
		gap: 0.75rem;
		justify-items: center;
		padding: 2.5rem 1.5rem;
		border: 1px dashed var(--line);
		border-radius: 8px;
		background: var(--panel);
		text-align: center;
	}
	.drop-zone.dragging {
		border-color: var(--accent);
		background: var(--panel-hover);
	}
	.drop-zone p {
		margin: 0;
	}
	.rejection {
		color: var(--warn);
	}
</style>
```

`apps/web/src/App.svelte`:

```svelte
<script lang="ts">
	import DropZone from './lib/DropZone.svelte';
	import { baseName, formatBytes } from './lib/format.ts';

	let selected = $state<File | null>(null);
</script>

<header class="bar">
	<h1>Xteink X4 EPUB Optimizer</h1>
	<p>CrossPoint firmware &middot; 480x800 &middot; everything runs in this tab</p>
</header>

<main>
	{#if selected}
		<section class="panel">
			<h2>{baseName(selected.name)}</h2>
			<p>{formatBytes(selected.size)}</p>
			<button type="button" onclick={() => (selected = null)}>Choose another file</button>
			<p class="note">Optimization is not implemented yet. Phase 1 adds it.</p>
		</section>
	{:else}
		<DropZone onpick={(file) => (selected = file)} />
	{/if}
</main>

<style>
	.bar {
		padding: 1.5rem;
		border-bottom: 1px solid var(--line);
	}
	.bar h1 {
		margin: 0;
		font-size: 1.25rem;
	}
	.bar p {
		margin: 0.25rem 0 0;
		color: var(--muted);
		font-size: 0.875rem;
	}
	main {
		max-width: 44rem;
		margin: 0 auto;
		padding: 1.5rem;
	}
	.panel h2 {
		margin: 0 0 0.25rem;
		font-size: 1rem;
	}
	.note {
		color: var(--muted);
		font-size: 0.875rem;
	}
</style>
```

`apps/web/src/app.css`:

```css
:root {
	--bg: #f7f7f5;
	--panel: #ffffff;
	--panel-hover: #eeece8;
	--line: #d5d3ce;
	--ink: #1c1b19;
	--muted: #6b6862;
	--accent: #2f5d7c;
	--warn: #9a3412;
	color-scheme: light;
}

@media (prefers-color-scheme: dark) {
	:root {
		--bg: #17171a;
		--panel: #212125;
		--panel-hover: #2b2b30;
		--line: #3a3a40;
		--ink: #ece9e4;
		--muted: #a09c95;
		--accent: #7fb2d4;
		--warn: #fdba74;
		color-scheme: dark;
	}
}

* {
	box-sizing: border-box;
}

body {
	margin: 0;
	background: var(--bg);
	color: var(--ink);
	font:
		16px/1.5 system-ui,
		sans-serif;
}

button {
	font: inherit;
}
```

`apps/web/src/main.ts`:

```ts
import App from './App.svelte';
import { mount } from 'svelte';
import './app.css';

const target = document.getElementById('app');
if (!target) throw new Error('#app missing from index.html');

export default mount(App, { target });
```

The UI restraint is deliberate: a neutral paper-and-ink palette for an operational tool whose subject is black-on-white e-ink, with the drop target as the first screen and no marketing framing.

- [ ] **Step 8: Build the SPA**

Run: `npm run build -w apps/web`
Expected: `vite build` writes `apps/web/dist/index.html` plus hashed assets.

If the browser project cannot resolve `.svelte` imports, the `svelte` plugin must also be added at the top level of `vitest.config.ts`; scope it to the project first and widen only if needed.

- [ ] **Step 9: Verify in a real browser**

Run: `npm run dev` then open `http://localhost:5173/`.
Expected: header with the app name, a dashed drop zone containing "Drop an EPUB here" and a Choose file button. Pick a non-EPUB file and the alert text appears. Drag a real `.epub` and the panel shows its name and size.

Also verify the built app at `npm run preview -w apps/web`, since a Vite-only code path that survives dev but breaks on build is the common failure here.

- [ ] **Step 10: Commit**

```bash
git add apps/web package.json package-lock.json vitest.config.ts
git commit -m "feat(web): add Svelte 5 SPA shell with drop zone and file summary"
```

### Task 6: Hono static host

**Files:**

- Create: `apps/server/package.json`, `apps/server/tsconfig.json`, `apps/server/src/index.ts`, `apps/server/test/server.node.test.ts`
- Modify: `vitest.config.ts` (add server include to the node project), `package.json` (add `start` and `build` orchestration)

**Interfaces:**

- Consumes: `apps/web/dist/` from Task 5.
- Produces: `createApp(root: string): Hono`, the same app the test drives and `npm start` serves on port 3000.

The server is one file on purpose: static hosting plus SPA fallback and a health check. It must not import from `@xteink/optimize`, and the test asserts that boundary, because the product decision that all processing happens in the browser is only durable if something enforces it.

- [ ] **Step 1: Create the package**

`apps/server/package.json`:

```json
{
	"name": "@xteink/server",
	"private": true,
	"version": "0.0.0",
	"type": "module",
	"main": "./src/index.ts",
	"scripts": {
		"dev": "node --watch --experimental-strip-types src/index.ts",
		"start": "node --experimental-strip-types src/index.ts"
	}
}
```

`apps/server/tsconfig.json`:

```json
{
	"extends": "../../tsconfig.base.json",
	"compilerOptions": { "types": ["node"] },
	"include": ["src/**/*.ts", "test/**/*.ts"]
}
```

Node 24 runs TypeScript directly through `--experimental-strip-types`, so the server needs no build step and no bundler. Type-only syntax must stay erasable: `import type`, no enums, no parameter properties, no namespaces.

- [ ] **Step 2: Write the failing server test**

`apps/server/test/server.node.test.ts`:

```ts
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/index.ts';

let root: string;

beforeAll(async () => {
	root = await mkdtemp(join(tmpdir(), 'xteink-server-'));
	await mkdir(join(root, 'assets'), { recursive: true });
	await writeFile(join(root, 'index.html'), '<!doctype html><title>shell</title>');
	await writeFile(join(root, 'assets', 'app.js'), 'console.log(1)');
});

afterAll(async () => {
	const { rm } = await import('node:fs/promises');
	await rm(root, { recursive: true, force: true });
});

describe('createApp', () => {
	it('serves the SPA shell at /', async () => {
		const res = await createApp(root).request('/');
		expect(res.status).toBe(200);
		expect(await res.text()).toContain('shell');
	});

	it('serves a hashed asset with its content type', async () => {
		const res = await createApp(root).request('/assets/app.js');
		expect(res.status).toBe(200);
		expect(res.headers.get('content-type')).toContain('javascript');
	});

	it('falls back to the shell for an unknown client-side path', async () => {
		const res = await createApp(root).request('/some/client/route');
		expect(res.status).toBe(200);
		expect(await res.text()).toContain('shell');
	});

	it('reports health', async () => {
		const res = await createApp(root).request('/healthz');
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ ok: true });
	});

	it('does not escape the served root', async () => {
		const res = await createApp(root).request('/../../etc/passwd');
		expect([400, 403, 404]).toContain(res.status);
		expect(await res.text()).not.toContain('root:');
	});
});
```

The last case is the one that matters for a static host. It asserts the response is a rejection rather than file contents, so a future refactor of the static middleware cannot quietly open the filesystem.

- [ ] **Step 3: Run it to verify it fails**

Run: `npx vitest run --project node`
Expected: FAIL, `../src/index.ts` not found.

- [ ] **Step 4: Implement the server**

`apps/server/src/index.ts`:

```ts
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';

/**
 * Static SPA host. No book processing happens here: the client owns the entire
 * pipeline, so adding an endpoint that touches EPUB data would violate the
 * product constraint in AGENTS.md rule 3.
 */
export function createApp(root: string) {
	const app = new Hono();

	app.get('/healthz', (c) => c.json({ ok: true }));

	// Hashed assets get long immutable caching; the shell must not be cached, or
	// a redeploy leaves users on a stale bundle referencing deleted chunks.
	app.use(
		'/assets/*',
		serveStatic({
			root,
			rewriteRequestPath: (p) => p.replace(/^\/assets\//, '/'),
			onFound: (_path, c) => {
				c.header('Cache-Control', 'public, max-age=31536000, immutable');
			}
		})
	);
	app.use(serveStatic({ root, index: undefined }));

	app.get('*', (c) =>
		c.html(
			'<!doctype html><title>Xteink X4 EPUB Optimizer</title><p>Run npm run build -w apps/web first.</p>'
		)
	);

	return app;
}

const isMain = process.argv[1]?.endsWith('src/index.ts') || process.argv[1]?.endsWith('index.js');

if (isMain) {
	const port = Number(process.env.PORT ?? 3000);
	const root = process.env.STATIC_ROOT ?? new URL('../../apps/web/dist', import.meta.url).pathname;
	serve({ fetch: createApp(root).fetch, port }, (info) => {
		console.log(`serving ${root} on http://localhost:${info.port}`);
	});
}
```

There is a wrinkle worth naming: with a single-page app there is no real client-side route to fall back to, so the `app.get('*')` handler returns a "build the web app first" notice rather than silently serving `index.html`. That makes a missing `apps/web/dist` an obvious failure instead of a confusing blank page. If routing is added later, replace that handler with a shell-serving fallback and update the test's third case accordingly.

- [ ] **Step 5: Run it to verify it passes**

Run: `npx vitest run --project node`
Expected: 19 tests PASS (14 paths plus 5 server).

If `rewriteRequestPath` behaves unexpectedly, check `serveStatic`'s `root` semantics in the installed Hono docs rather than guessing: with `@hono/node-server/serve-static`, `root` is a filesystem directory prefix, and paths are resolved relative to it. Simplify by serving `/assets/*` through the same rule as everything else if the two-tier cache header proves fiddly, but keep the immutable header for hashed assets.

- [ ] **Step 6: Wire the root scripts and verify end to end**

Add to root `package.json` `scripts`:

```json
"build": "npm run build -w apps/web",
"start": "npm run start -w apps/server"
```

Run: `npm run build && npm start`, then in another shell `curl -s localhost:3000/healthz` and `curl -s localhost:3000/ | head -3`
Expected: `{"ok":true}`; then the built `index.html` containing the hashed asset script tag. Open `http://localhost:3000/` and confirm the drop zone renders.

- [ ] **Step 7: Commit**

```bash
git add apps/server package.json package-lock.json vitest.config.ts
git commit -m "feat(server): add Hono static host for the built SPA"
```

### Task 7: CI workflow

**Files:**

- Create: `.github/workflows/ci.yml`

**Interfaces:**

- Consumes: every root script from Tasks 1 through 6.
- Produces: a push and PR gate that runs lint, typecheck, all three Vitest projects, the guard self-test, and the guard itself.

- [ ] **Step 1: Write the workflow**

`.github/workflows/ci.yml`:

```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:

jobs:
  verify:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          # Submodules are needed so the guard can check their pins. Fetch them
          # detached and non-recursive: freeink-sdk is only required for the
          # simulator build, which CI does not run.
          submodules: recursive
          fetch-depth: 0
      - uses: actions/setup-node@v4
        with:
          node-version: 24
          cache: npm
      - run: npm ci
      - run: npx playwright install --with-deps chromium
      - run: npm run format
      - run: npm run lint
      - run: npm run check
      - run: npm run check:web
      - run: npm test
      - run: npm run guard:test
      - run: npm run guard
```

`submodules: recursive` is what makes the guard meaningful in CI: it proves a contributor cannot land a commit that moves a pin, because the guard compares checked-out HEADs against `tools/sim/pins.txt`.

Note this workflow assumes the repo is pushed to GitHub (`origin` is already `git@github.com:bhumong/xteink-x4-epub-optimizer`). Until it is pushed, the file is inert, which is fine; nothing in Tasks 1 through 6 depends on it running.

- [ ] **Step 2: Verify the whole gate locally**

Run: `npm run format && npm run lint && npm run check && npm run check:web && npm test && npm run guard:test && npm run guard`
Expected: every step exits 0. This is the exact command sequence CI runs, so a local pass is the real check.

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "chore(ci): run lint, typecheck, tests, and submodule guard on push"
```

---

## Phase 0 exit criteria

Phase 0 is done when all of these hold. Each maps to a task's verification step, so this section is a checklist to run, not prose to trust.

1. `npm ci && npx playwright install chromium` succeeds from a clean checkout, including `git submodule update --init --recursive`.
2. `npm test` passes across the `node`, `browser`, and `web` projects.
3. `npm run check`, `npm run check:web`, `npm run lint`, and `npm run format` all exit 0.
4. `npm run guard:test` prints `guard_test: PASS`, and `npm run guard` prints `guard: PASS`.
5. `npm run sim:build` produces `.pio/build/simulator/program` and `npm run sim:run` opens an SDL2 window showing the CrossPoint home screen.
6. After that build, `npm run guard` still passes and the firmware submodule has no tracked modifications and nothing staged.
7. `npm run build && npm start` serves the built SPA on `http://localhost:3000` and `/healthz` returns `{"ok":true}`.
8. `AGENTS.md` exists and every command in its table has been run successfully at least once.

Criteria 5 and 6 are the substance of early-phase goal 1, and 6 is the one that proves the read-only rule survives contact with a real build.

## What this plan deliberately does not include

- Any EPUB ingest, transform, or repack code. That is the Phase 1 plan, and it is where most of `packages/optimize` lands.
- `packages/xtc`. Phases 2 through 4, per spec Section 12.
- A Dockerfile, deployment target, or CDN configuration. The spec leaves hosting as "a plain Node process or container"; deciding that needs a real hosting choice, not a guess.
- A pre-commit hook. The guard runs in CI and inside every `sim:*` task, which covers the risk without installing git hooks into a clone unasked. Add one later only if a pin actually moves in practice.
- Visual polish beyond a usable shell. The real UI arrives with the features that need it, in Phase 1.

## Self-review notes

Checked against the spec after writing:

- Spec Section 9 (simulator setup) is Task 4, including the `platformio.local.ini` mechanism and the guard-before-and-after pattern. The plan adds one fact the spec did not have: the simulator at `c55f168b` no longer patches tracked firmware sources, so a build leaves only ignored untracked files. Worth recording in the spec's Section 4 table if you want it captured there too.
- Early-phase goal 1 (simulator submodule) is Tasks 2 and 4. Goal 2 (Hono source) is Tasks 5 and 6. Goal 3 (`AGENTS.md`) is Task 3.
- `lib_deps` uses the symlink form rather than the README's git URL. Deviation is deliberate and stated in Task 4: the URL form would build against upstream HEAD and silently invalidate the pin.
- Test counts are explicit (14 node paths, 5 server, 6 web) so a test that stops being collected is visible rather than silently skipped.
- The `.node.test.ts` / `.browser.test.ts` suffix rule is stated once in the File Structure and enforced by `include` patterns; a file named without a suffix runs nowhere.
- Every device-limit number in `AGENTS.md` traces to a spec Section 4 source citation.

Only `tools/sim` and `package.json` are added. The build artifacts inside the submodule are never staged, and `guard` is what proves it.

## Execution log

Found while running this plan inline on 2026-09-03. Each item was verified by
execution, not reasoning. The steps above still describe intent; where they
disagree with this section, this section wins.

| Finding                                                | Evidence                                                                                                                                                | Resolution                                                                                                                                                                                                             |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Task 2 guard test was unrunnable as written            | Cases 1-4 passed a `--root` not containing the submodule path, so every case failed on the missing-checkout branch instead of the assertion under test  | Rewrote each case to build a synthetic superproject with an embedded repo at `sub`; all 7 cases pass                                                                                                                   |
| Guard failed permanently on a fresh repo               | `git diff --cached` against an unborn HEAD reports every staged path, so both gitlinks looked staged before any commit existed                          | Guard skips gitlink checks when `HEAD` does not resolve, printing a note; added Task 0 to land the initial commit                                                                                                      |
| Root typecheck could not resolve `paths.ts` imports    | `allowImportingTsExtensions: false` rejects `./paths.ts`, which the plan's own tests use                                                                | Set `allowImportingTsExtensions: true` in `tsconfig.base.json`                                                                                                                                                         |
| `baseUrl` is an error in TypeScript 6                  | Installed `tsc` 6.0.3 fails with `TS5101`, then `TS5090` once dropped                                                                                   | Removed `baseUrl`; `paths` entries use explicit `./` prefixes                                                                                                                                                          |
| Vitest alias broke subpath imports                     | String-key Vite aliases are prefix matches, so `@xteink/optimize/paths.ts` resolved to `.../src/index.ts/paths.ts` and the suite errored before running | Replaced with regex `find`/`replacement` pairs; 14 tests then passed                                                                                                                                                   |
| Prettier could not parse `.svelte` at all              | `No parser could be inferred for file ...App.svelte`, so `npm run format` breaks as soon as a component is committed                                    | Added `prettier-plugin-svelte` plus a `*.svelte` parser override                                                                                                                                                       |
| Prettier scanned 63 MB of vendored firmware            | `--check .` reports style warnings for `crosspoint-reader/**` files this project does not own                                                           | Added `.prettierignore` covering `crosspoint-reader/`                                                                                                                                                                  |
| Prettier mangles `font:` shorthand                     | Rewrote `font: 16px/1.5 system-ui, sans-serif` across three lines                                                                                       | Used `font-family`, `font-size`, `line-height` longhand                                                                                                                                                                |
| Drop zone failed Svelte's a11y rule                    | `a11y_no_static_element_interactions`: a `div` with drag handlers needs a role                                                                          | Added `role="presentation"`; build is now warning-free                                                                                                                                                                 |
| Root tsconfig cannot cover `apps/web`                  | `tsc` cannot parse `.svelte` imports from `main.ts` and `DropZone.svelte`                                                                               | Root project covers `packages/*` and `apps/server`; `apps/web` is gated by `svelte-check`, which reports 0 errors and 0 warnings                                                                                       |
| `startServer` promised but never defined               | Task 6 interface listed an export the implementation did not contain                                                                                    | Dropped it; `createApp` is the single export and `npm start` wires it to a port                                                                                                                                        |
| Task 5 ordered a red test before its toolchain existed | `--project web` was registered in a later step, so the failing test failed on config, not assertion                                                     | Moved install and project registration ahead of the test-first steps                                                                                                                                                   |
| Task 4 simulator build broke on GCC 15's C23 default   | PlatformIO native passed no C `-std`; GCC 15 compiled `qrcode.c` as C23, where the C89-style `bool`/`true`/`false` typedefs in QRCode become keywords   | Added `tools/sim/simulator_cflags.py` as a pre extra script appending `CFLAGS += -std=gnu17`; C++ keeps `-std=gnu++2a`. Pre runs before the native builder snapshots CFLAGS. Only our ignored simulator config changed |

Verified toolchain actually used: Node 24.18, `tsc` 6.0.3, `vite` 8.2.0,
`vitest` 4.1.10, `svelte` 5.56.8, `@sveltejs/vite-plugin-svelte` 7.2.0. The
`typescript@^5` and `vite@^6` hints in Task 1 and Task 5 are superseded by
whatever `npm install` resolves; per the global constraints, no ranges are
hand-written.

Still unverified, blocked on the approval reviewer (`No enabled OpenAI provider
for model: gpt-5.6-luna`) and on `.git` being read-only in the agent sandbox:

- `npm install` and therefore `hono`, `@hono/node-server`, and `jszip`. The
  server suite and the `@hono`-importing source cannot typecheck or run until
  those resolve, so Task 6 Steps 3 through 6 remain open.
- Browser Vitest projects. Config loads and starts a server, then fails with
  `EPERM: listen 127.0.0.1:63315`, which is the sandbox forbinding sockets. Run
  `npm run test:browser` and the `web` project outside it.
- Tasks 4 Steps 6 through 10. No `pio`, no `sdl2-config`, no nested
  `freeink-sdk` checkout, and apt plus network are required. `setup.sh` reports
  this honestly with exit 3 rather than half-configuring the tree.
- Every commit step in this plan.
