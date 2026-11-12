<!-- Owns project constraints and commentless-format documentation; keep this shell minimal. -->
# Negareh desktop

Plain HTML/CSS and strict TypeScript in one Tauri window. Node.js is build tooling only;
the shipped executable uses the system Windows WebView2 runtime. Do not access the
separate existing Rust implementation. No framework, plugins, custom memory manager,
or resource pools are needed.
The Windows shell enables only Tauri's `wry` feature; no dynamic ACL, asset compression,
or optional platform features are requested. WebView2 manages multiple processes;
memory use and startup speed require measurement, not assumptions from this setup.

Use Node.js 22.13+ within Node 22, or a supported LTS version of Node 24+, npm, Rust's MSVC toolchain,
Visual Studio C++ Build Tools, and Windows WebView2.

- `npm ci`: install locked development dependencies.
- `npm run tauri dev`: run the desktop app with frontend hot reload.
- `npm run check`: strict types and type-aware ESLint (including unsafe access and async misuse).
- `npm run tauri build -- --no-bundle`: check/build the frontend and compile the desktop executable.
- `cargo fmt --manifest-path src-tauri/Cargo.toml -- --check`: check native source formatting.
- `npm run bench -- --name final-build`: build-stage timings and artifact sizes; launches nothing.
- `npm run bench -- --startup-only --samples 1 --name startup-1`: one launch, held for inspection.
- Add `--fresh-native` to a build benchmark for one clean native compile in an isolated temporary target.

`package.json` owns npm metadata, scripts, and development dependencies.
`tsconfig.json` owns frontend compiler constraints.
`src-tauri/tauri.conf.json` owns window/build/security settings.
`src-tauri/capabilities/main.json` grants only main-window controls and event listen/unlisten.
These JSON files cannot contain header comments. Generated `package-lock.json`,
`src-tauri/Cargo.lock`, build output, and any generated binary assets retain their native formats.
`src-tauri/icons/icon.ico` is the local icon required by the Windows resource build.
Every authored source/config file that supports comments starts with a concise purpose header.

Use ordinary JavaScript garbage collection. Code that acquires listeners, timers,
subscriptions, or native handles must own and release them when its scope ends;
cancel pending async work when its owner is disposed. The shell aborts DOM listeners,
unsubscribes native resize events, and clears its debounce timer/frame on pagehide.
Keep DOM access checked, avoid `any` and unchecked assertions, and handle rejected promises.
Prefer guard clauses and early returns. Check cheap decisive rejection conditions before
allocations, IO, IPC, or expensive work when correctness and required side effects permit.
Keep nesting shallow; ESLint limits depth and unnecessary `else` after returns, but cannot
prove optimal check ordering. Do not impose blanket return-type rules as performance claims.
Enable the editor's TypeScript and ESLint integrations for feedback while editing.
Do not add redundant tooling or dependencies without a concrete need.
Vite omits the module-preload polyfill because this app targets Windows WebView2.
Tabs own independent workspace trees and local contexts while sharing one active project. Keep this foundation limited to Tabs, Tiles, Surfaces, Surface Deck and Surface Rail; do not add application editors.
Document editing commands remain separate from layout Undo/Redo. Render is absent from the global menu. Window buttons use the native Tauri
window API; they are custom drawn and do not implement the Windows Snap Layout hover UI.

Every app launch must be followed immediately by a screenshot and actual visual inspection
before any further action, including benchmark launches. Run one inspected warm-up, then
three one-sample startup runs. Close each measured window after inspection; the tool waits
for clean exit. Screenshot/inspection time is outside readiness timing. Do not parallelize
launches, minimize the measured window, or benchmark while compiling. Reports go to ignored
`benchmarks/`. Baseline predates this inspection gate; its launch timing endpoint is unchanged.
Ready means initialized main content crossed a browser paint opportunity, not a measured
display/compositor timestamp. The boot card has no timeout or minimum duration; it can be
brief on fast machines. Use reported native/renderer timings, not screenshot latency.
Benchmark timeouts guard failed launches/operator waits; they are not performance thresholds.
Readiness IPC writes only to the benchmark-supplied environment path; normal readiness calls do no IO.
Keep `src-tauri/capabilities/` present: its absence made Cargo rebuild on every invocation.
`scripts/build.mjs` always bundles, compares output bytes, preserves identical files/mtimes,
and removes stale files only inside dist; this prevents needless native asset re-embedding.
It supports this project's single bundle and bundled local artwork, with no public-directory assets; extend deliberately
if those constraints change. Never substitute timestamp-based source skipping for checks.

For dependency changes, select the latest stable compatible versions, review official
advisories/release notes and relevant memory-leak reports, run npm audit and an available
Cargo advisory check, and document compatibility exceptions and unresolved findings.
Do not treat a clean audit as proof of safety or install large audit tools without need.

Dependency review (2026-10-27): npm audit reported no known vulnerabilities.
TypeScript 6.0.3 is intentional: latest stable is 7.0.2, but typescript-eslint 8.72.1
supports TypeScript below 6.1. Tauri 2.12.5, tauri-build 2.7.4, CLI 2.12.4,
Vite 8.3.5, ESLint 10.13.0, typescript-eslint 8.72.1, and the Tauri API 2.12.4 were current stable releases.
The API is bundled frontend code for window controls, not a Node runtime or optional plugin.
`ESNext.Disposable` supplies its required declaration types; it adds no memory manager.
Official release/advisory pages were reviewed; Tauri 2.12.5 includes the fixes for
GHSA-w28w-mhc8-qvjv and GHSA-7gmj-67g7-phm9. An open high-volume event-emission memory-growth
report (tauri-apps/tauri#12724) has not been reproduced here; this shell owns one native
resize subscription and removes it on pagehide. No claim of leak freedom is made.
Typed linting can consume substantial memory on large types;
the tsconfig includes only frontend sources.

Neither cargo-audit nor cargo-deny was installed. An OSV query of the Cargo lockfile
(including RustSec/GitHub advisories) flagged GHSA-qwgh-2vcv-g2f7 for block-buffer
0.10.4 through tauri-codegen -> sha2 -> digest. The advisory concerns buffer reuse
after a caught callback panic; applicability to this build path is unproven. The
reported fix is 0.12.1, incompatible with digest 0.10's requirement, so this finding
remains unresolved upstream; do not force a major transitive override. The dependency
is used by build-time code generation, not a runtime frontend feature.
glib 0.18.5 (RUSTSEC-2024-0429) and proc-macro-error 1.0.4 (RUSTSEC-2024-0370,
unmaintained) are also lockfile findings, absent from the Windows target graph.
Review them before adding Linux support. This lookup is not a full cargo-audit run.

Review sources: [Tauri releases](https://github.com/tauri-apps/tauri/releases),
[Vite releases](https://github.com/vitejs/vite/releases),
[ESLint releases](https://github.com/eslint/eslint/releases),
[TypeScript releases](https://github.com/microsoft/TypeScript/releases),
[typescript-eslint compatibility](https://typescript-eslint.io/users/dependency-versions/),
[block-buffer advisory](https://github.com/RustCrypto/utils/security/advisories/GHSA-qwgh-2vcv-g2f7),
[Tauri event memory report](https://github.com/tauri-apps/tauri/issues/12724).


Welcome/project foundation (2026-10-27): `src/project.ts` owns one version-1 project
(name and notes), welcome actions, dirty state and Save / Don't Save / Cancel.
`src-tauri/src/project.rs` owns native file dialogs, constrained IO, one persisted recent
path and a separate recovery snapshot in app-local data. `.negareh` is the chosen
extension. Every launch begins with a fresh unsaved Untitled; untouched blanks do not
replace previous recovery. Recovered projects are unsaved copies, so recovery never
implicitly overwrites the original. A 300ms edit debounce leaves a small crash-loss
window; writes sync a temporary sibling before replacement, without a promise of
power-loss durability. Don't Save retains a recovery snapshot. File selectors and
save failure/cancellation must leave edited work open. Native close and project close
use the same protection. There is no drawing/editor architecture yet.

No verified repository URL was present; release/donation destinations are centralized
as null in `src/project.ts` and the welcome actions honestly remain unavailable.
Configure verified destinations and native URL opening together before enabling them.
`rfd` 0.17.2 (default features disabled) earns its place for native open/save dialogs
without filesystem or shell plugin permissions; serde/serde_json declare the already
used serialization dependencies explicitly. Reviewed official rfd release notes and
Windows async-dialog history; 0.17.2 requires Rust 1.88+. npm audit found zero known
vulnerabilities; OSV queries for rfd 0.17.2, serde 1.0.229 and serde_json 1.0.154 returned
no advisories. This is not a full Cargo audit; prior upstream findings above remain.
Source: https://github.com/PolyMeilex/rfd/releases

`src/assets/welcome.webp` is a locally bundled, optimized 1600px manga banner generated
with the built-in ImageGen tool, credited in the UI as AI-generated artwork.
Prompt: Original manga panel montage of a rain-lit futuristic city, expressive eye,
hand drawing panels, and windswept young adult protagonist; crisp black ink and
screentones, muted slate blue and warm parchment highlights, diagonal gutters,
dark quiet left third for branding, no lettering, logos or watermark.

Development MCP (2026-10-27): `scripts/mcp.mjs` serves genuine MCP over stdio using
the current official `@modelcontextprotocol/server` 2.4.0 SDK and zod 4.6.7 (development
dependencies only; three installed packages including MCP core). These dependencies
provide protocol negotiation, typed discovery and validation, rather than a custom
JSON-RPC implementation. Official v2 SDK release/stdio/tool documentation was reviewed;
npm audit reported zero known vulnerabilities. Older 2025-11-25 clients were tested.
Sources: https://github.com/modelcontextprotocol/typescript-sdk/releases
https://ts.sdk.modelcontextprotocol.io/v2/serving/stdio.html
https://ts.sdk.modelcontextprotocol.io/v2/servers/tools

Start from PowerShell with `$env:NEGAREH_MCP='1'; npm run tauri dev`. The opt-in Vite
bridge uses 127.0.0.1, rejects browser Origin headers, authenticates every request with
a fresh random token, validates a strict action schema, and refuses zero/multiple
connected apps. Credentials live outside the served workspace in app-local data;
`NEGAREH_MCP_CONNECTION` may select another external connection file. Do not expose
that file. A per-request timeout means an uncertain action must be inspected before
retrying; mutations are never automatically retried. Development server restarts may
require reloading/relaunching the dev app. Production builds omit the frontend MCP
adapter, create no MCP endpoint, and reject native explicit automation paths/geometry.
The existing release window close API remains required by normal user controls.

Point a stdio MCP client at command `node` with the single absolute argument
`D:\Organizations\Negareh\Node.js\scripts\mcp.mjs` (no npm wrapper/banner).
Tools: `negareh_state`, `negareh_action`; resource: `negareh://state`.
Discover the action enum/schema with tools/list. Inspect state first, then use explicit
actions for welcome, project name/notes/new/open/save/close/recent/recover, all menus,
tabs, About, save decisions and native window controls/geometry. Editing and
unverified repository links explicitly remain unavailable. MCP invokes the same
project and shell handlers as UI; it does not click, type, activate other windows,
or evaluate arbitrary code. Dragging/resizing maps to bounded app-window geometry.
Window actions affect the app only when explicitly requested; tests avoid minimizing,
maximizing, moving or resizing the user's desktop window. DOM text fields are exposed
as typed project edits, not as a generic DOM/eval bridge.

Examples of negareh_action arguments:
- `{"action":"project.open","path":"D:\\Projects\\Story.negareh"}`
- `{"action":"project.save","path":"D:\\Projects\\Story.negareh"}`
- `{"action":"project.new","decision":"save","savePath":"D:\\Projects\\Draft.negareh"}`
- `{"action":"tab.select","target":"tab-1"}`
- `{"action":"menu.open","target":"file"}`
Explicit destinations require `overwrite:true` when a file already exists. A dirty
replacement without a decision is rejected; cancel is a reported outcome. Unsaved
saves require a path so automation never needs to operate a native picker. Native
path operations use the same schema/version/size checks and IO as UI dialogs.
`dialog.respond` can resolve an already-open UI save prompt; it cannot invent consent.
`window.close` acknowledges a request before the window exits; inspect process/window
exit to verify completion. Tauri's protected-close callback requires the narrowly
scoped main-window destroy permission to complete an approved close.

Run `npm run test:mcp` against one fresh native dev session. It verifies MCP
initialize/list/call, resources, real native file IO, dirty cancel/failure paths,
separate recovery, recent/missing files, menus/tabs/dialogs and unavailable actions.
It uses temporary project files, restores original persisted history/recovery, and
resets the project; do not run it on a session with user edits. After this test,
relaunch the dev app to refresh the view's recent-file metadata restored on disk.
It deliberately does not exercise intrusive native geometry/minimize/maximize actions.

`scripts/capture-window.py` is dependency-free Python using ctypes, PrintWindow and
stdlib PNG encoding. Example: `python scripts/capture-window.py --process
D:/Organizations/Negareh/Node.js/src-tauri/target/release/negareh-desktop.exe --output
benchmarks/welcome-final.png`. Optional `--pid` disambiguates verified instances.
It targets exact executable path/title, rejects ambiguity and minimized windows,
releases GDI/process handles, and never activates/restores windows or sends input.
It reports foreground before/after equality. A background-window capture was visually
verified with target_foreground=false and foreground_unchanged=true. Some GPU/driver
surfaces may still yield stale or blank content even when PrintWindow succeeds;
always view the PNG, and never silently fall back to desktop capture or foregrounding.



Workspace foundation (2026-10-27):
- `src/workspace-model.ts` owns stable-ID tabs, a flat binary split graph, proportional
  geometry, validation and per-tab structural history. Iterative traversal supports
  deeply nested layouts without using call-stack depth as a layout limit. Binary
  branches normalize joins; compatible leaves must share a complete matching edge
  and form a representable rectangular partition. Split changes replace only the
  affected branch; other surface instances retain identity.
- `src/workspace.ts` owns retained DOM/lifecycle, scoped input, deck/rail controls,
  pointer capture and cancellable split/divider/join previews. Geometry is scheduled
  by animation frame; pointer moves do not serialize, write recovery, or create
  history. A completed drag makes one history entry. Unchanged geometry avoids DOM
  writes. Escape, pointer cancellation/lost capture, blur and viewport resize cancel
  safely. Already-visited hidden tabs retain their DOM; unvisited tabs mount lazily.
- `src/surfaces.ts` owns registration, definitions, icons, modes with explicit write
  permission, grouped tools, contextual commands, option/modifier descriptors,
  nondestructive view controls, default local data and serialize/restore hooks.
  Definitions mount/update/dispose with an owned AbortSignal. Register definitions
  before creating the workspace; the registry default selects the initial surface.
  Only `test.text` and `test.inspect` are supplied as infrastructure fixtures using
  the existing canonical name/notes fields. They are not application editors.
- `src/project.ts` remains the one canonical project owner. Surface writes pass
  through its shared update path and through surface mode/tool checks. View controls
  receive a read-only project capability. Notifications preserve unchanged DOM text,
  inputs, selected records and independent per-type local state.

Tabs retain existing titlebar position, styling and keyboard selection/close behavior.
New tabs have one tile. Double-click or F2 renames a tab; its context menu moves it
left/right, as does Ctrl+Shift+PageUp/PageDown. Layout Undo/Redo is Ctrl+Alt+Z /
Ctrl+Alt+Shift+Z and is separate from text/document undo. Tool shortcuts apply only
inside the focused tile, never text inputs or global menus. Temporary modifiers clear
on keyup, blur, tool/mode/type/context changes. MCP state reports the active context.

Every tile has a permanent horizontal deck: universal type selector, supported modes
and definition menus left; active tool options center; definition-owned view controls
and layout/appearance controls right. Narrow decks scroll instead of overlapping.
The optional rail occupies space below the deck. Its resize grip snaps to one-column
Compact or two-column Grid, then expands continuously into a labeled list. Thresholds
use actual button, padding, gap, border and label-font metrics. Groups reflow
independently, tool selection is preserved, and native title tooltips follow the
existing shell style (Expanded omits the already-visible name). Persisted rail width
is constrained for display when space shrinks without changing its saved preference.
Tiles have 240x180 CSS-pixel frame minimums independent of surface type, ensuring a
surface replacement cannot change geometry. Too-small workspaces scroll; saved split
ratios are never replaced by transient constrained geometry.

Project format version 1 stays backward compatible; optional `workspace` has its own
version 1, flat stable-ID node list, ordered tabs/active tab, focused tiles and scroll
contexts, axes/ratios, active types and cached per-type modes/tools/options/selection,
rail preferences and view state. Unknown types retain opaque serialized local data
and display an unavailable message. Invalid/cyclic UI graphs restore a safe default
while keeping valid canonical content. Valid empty tab sets stay empty. Resource
bounds are 10,000 layout nodes, 1,000 tabs, 4 MB serialized workspace and 32 nested
levels inside local JSON data (not layout nesting); native project files are bounded
at 12.1 MB. Legacy projects without workspace receive a default tab/tile.

Content dirty state and layout dirty state are separate. Layout operations do not
alter authored content, but UI changes participate in Save/Don't Save/Cancel and the
existing separate recovery snapshot. Layout history and held keys are runtime-only;
current UI state is persisted. Save/open/recovery use the same native validation and
safe sibling-file replacement. UI-only unsaved recovery is tested. Registry-defined
serialization must return bounded JSON; no canonical project records belong in local
surface data. The existing 300ms recovery debounce/crash-loss limitation still applies.

MCP adds tab.rename/reorder, tile.focus, layout.split/resize/join and preview-split /
preview-join / commit / cancel / undo / redo, surface.switch/mode/tool/toggle/modifier /
action/view/write, and rail.resize/visible. Use tools/list for exact typed fields;
`target` is the stable tab/tile/split ID, `other` selects the removed join tile,
`axis` is horizontal/vertical, `ratio` is proportional, `value` selects a registered
surface/mode/tool/command, `width` is CSS pixels, and `enabled` handles visibility or
held modifiers. `surface.write` has field=name|notes and enforces mode/tool permission.
MCP resources expose definitions, geometry/minimums, state, focus, rail thresholds,
preview, history availability and lifecycle counters. The same handlers serve UI.
Dismiss modal dialogs before workspace actions; unrelated/missing targets and
unsupported tools/modes/options are rejected. Production still omits the MCP adapter.

Verification commands:
- `npm run test:workspace`: dependency-free model/validation/geometry tests using
  Node 22.13+ type stripping. It covers unequal splits, full non-overlapping partition,
  minima, state/tab isolation, cross-branch join/survivor/rejection, history,
  roundtrip, unknown types, cyclic fallback and 1,500 nested splits. It writes CPU
  measurements to ignored benchmarks/workspace-model-verification.json. These are
  model CPU timings, not UI frame-rate or compositor latency claims.
- `npm run test:mcp`: against one fresh disposable native dev session; includes
  real save/open/recovery, UI-only recovery, Read-mode write rejection, per-type
  state and geometry, tools/rail/modifiers, lifecycle balance, tab state, history,
  exact saved workspace restore, corrupted/legacy fallback, empty tabs and missing
  surface data preservation. `NEGAREH_TEST_IDENTIFIER` isolates its app data and
  `NEGAREH_MCP_CONNECTION` selects a separate dev bridge.
- `npm run test:workspace-ui`: isolated headless Playwright checks actual corner and
  divider capture/preview/cancel/commit, join survivor DOM identity, state/shared data,
  Read inputs, generic zoom/appearance controls, rail modes/grouping/tooltips,
  keyboard contexts/modifiers, tab rename/reorder/switch, hidden-tab retention and
  small-window overflow/restoration. It disables only the browser's MCP enrollment
  so it cannot compete with the native client. Use an existing Playwright installation
  via PLAYWRIGHT_MODULE and, if needed, CHROME_EXECUTABLE; no new runtime dependency
  was added. NEGAREH_TEST_URL defaults to http://127.0.0.1:5174.

Native integration verification used a separate dev URL (5174), app identifier
ir.negareh.workspace-test, connection file and build target. Tauri's documented
TAURI_CONFIG merge selects that isolated dev URL/identifier. User-visible development
on 5173 stays separate; tests must not mutate the user's open session. All native
launches are immediately captured with capture-window.py and the PNG visually
inspected. Test captures were verified from a background window without foreground
changes. Release, welcome/loading styles, Render removal and build timestamp logic
remain intact. No new dependency was added for this architecture extension.
