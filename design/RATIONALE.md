# bb-plugin-workspaces: a workspace rail as one derived stylesheet

Candidate design from arena runner 1 (claude-code / claude-opus-5-5). The sketch files it cites (`sketch*.ts(x)`, in git history at `be58ef3`) became [src/domain.ts](../src/domain.ts), [src/shell-css.ts](../src/shell-css.ts), [server.ts](../server.ts), [src/client.ts](../src/client.ts), [src/ui/](../src/ui/) and [app.tsx](../app.tsx), and were deleted once those modules existed. Live evidence: [evidence/gate-check.cjs](evidence/gate-check.cjs) writes `gate-check.json` and a screenshot to the gitignored `.evidence/`.

## Problem

Add a full-height column to the left of BB's whole sidebar, holding workspaces (name, initials, a color or an image). Picking a workspace shows only that client's projects (Acme, Globex, Initech, Umbrella) in BB's own list. The color field opens a popover with preset swatches plus a custom picker.

Here's why the shape isn't obvious. BB 0.44 / SDK 0.5.29 has no slot for a column beside the sidebar, and no API that filters the built-in list. The replacement thread-list slot lost its `Original` prop, so wrapping BB's list isn't an option either. The literal UX therefore needs host DOM hooks that nobody guarantees. The design problem is to keep that coupling small, self-disabling, and impossible to leak. Constraints that carry over from Phase A:

- The sidebar reserves its width with an in-flow `[data-sidebar=gap]` spacer, and the visible `[data-sidebar=panel]` is `position: fixed`.
- The built-in list wraps each project in `[data-sidebar-visibility-group="project:<id>"]` and the personal project in `="threads"`. This is the unit its own `hiddenGroups` preference hides. I found it in a live DOM dump for this design, and it's a better hook than the prototype's `data-sidebar-project-id`.
- Plugin frontends run per window. Plugin storage is server-side. Realtime signals aren't replayed.
- The user's conventions apply: TanStack Query for API calls, react-hook-form for forms, loading/empty/error states everywhere, no `any`/`unknown`/casts, one component per file.

## Usage (caller's view)

### README (what the user reads)

> **Workspaces** adds a column at the far left of BB.
>
> - **All** (grid icon, top) shows every project. Below it is one tile per workspace: its initials on its color, or its image. **+** creates a workspace.
> - Click a tile and the sidebar shows that workspace's projects. Projects you haven't filed anywhere yet show in every workspace, so a new project never disappears on you.
> - Right-click a tile to **Edit**, **Move up / down** or **Delete**. Deleting a workspace leaves its projects in BB, just unfiled.
> - In the editor, initials follow the name (Acme → AC) until you type your own. **Appearance** is a Color (swatch → popover with 12 presets and a custom picker) or an Image (square-cropped to 128px). **Projects** is a checklist. Ticking a project that lives in another workspace moves it here.
> - Each window remembers its own workspace, and a new window opens on the one you used last. Your laptop and phone never switch each other.
> - If you open a thread from another workspace (palette, notification), its project is revealed in place and a dot marks the workspace it belongs to.
> - On a phone, or with the sidebar collapsed, use the **Workspaces** button in the sidebar footer. The palette has *Next / Previous workspace*, *Show all projects*, *Switch workspace…* and *New workspace…*, all rebindable.
> - Agents can file projects: `bb workspaces list`, `bb workspaces assign <project-id> <workspace>`, `bb workspaces unassign <project-id>`.

### Call sites (the plugin's own code, written before the types)

The overlay: one hook in, one stylesheet and one rail out.

```tsx
// src/ui/RailOverlay.tsx
export function RailOverlay() {
  const state = useBoard();
  return (
    <WorkspacesProvider>
      <style>{shellCss(state.mask)}</style>
      <WorkspaceRail state={state} />
      <EditorHost />
    </WorkspacesProvider>
  );
}
```

The editor submits a domain draft. Wire encoding, toasts and invalidation live behind the mutation hook.

```tsx
// src/ui/WorkspaceEditor.tsx
const save = useSaveWorkspace();
const form = useForm<EditorValues>({ resolver: zodResolver(editorSchema), defaultValues });
const onSubmit = form.handleSubmit((values) =>
  save.mutate(toDraft(target.id, values), { onSuccess: onClose }),
);
```

A palette command runs outside React, against the same cache the rail renders from.

```ts
// app.tsx
app.commands.register({
  id: "next-workspace",
  title: "Workspaces: Next workspace",
  isAvailable: () => canStep(),
  run: () => stepWorkspace(1),
});
```

The server handler is thin. The store owns the transaction, and the SDK contract owns validation.

```ts
// server.ts
workspace_save: async (input) => {
  const saved = store.save(input);
  changed();
  return saved;
},
```

Every sketch signature is derived from these call sites. `useBoard()` returns `mask` in every state because the overlay needs it before the data is ready. `shellCss` takes only the mask because the call site has nothing else to give. The editor gets its own `WorkspaceDraft` type because `toDraft` needs a domain target that isn't the wire shape.

## Shape

### Data structures first

- **`Workspace { id, name, initials, face }`** with `face = { kind: "color", color: HexColor } | { kind: "image", src: ImageDataUrl }`. "Color or image" is a discriminated union, and SQL backs it with `CHECK ((color IS NOT NULL) + (image_data IS NOT NULL) = 1)`. Initials stay as the accessible label and as the fallback if an image fails to decode.
- **`WorkspaceDoc { workspaces: Workspace[] (rail order), owner: Map<ProjectId, WorkspaceId> }`**. Membership is stored as a **partition**, one owner per project, and not as `projectIds[]` inside each workspace. A client-grouping model wants that, and the structure makes "a project in two workspaces" impossible to represent. SQL enforces the same with `membership.project_id PRIMARY KEY`, so filing a project elsewhere is an UPSERT that moves it.
- **`Selection = all | workspace(id)`** is per window. **`ActiveView`** is the resolved form. It carries the `WorkspaceEntry` itself, so "selected but deleted" can't reach a consumer.
- **`SidebarMask { hiddenProjects, hiddenRoots, hidePersonalGroup }`** describes what BB's list must hide, in domain terms. `OPEN_MASK` (hide nothing) is the value for every failure and loading state.
- **`Board { entries, active, unfiled, visiting, mask }`** is everything a surface renders. `resolveBoard({ doc, sidebar, selection, route })` is the only function that produces it. It's pure, and all visibility policy lives inside it.

Tracing the dominant access patterns through these structures:

| Access | Path | Cost |
|---|---|---|
| Render the rail | `board.entries` in order | O(W) |
| Recompute the mask on each sidebar update (thread status ticks) | one pass over projects with `owner.get`, one over threads with `hiddenProjects.has` | O(P + T), no per-workspace scans |
| Stylesheet update | `shellCss(mask)` returns a string, and React touches the `<style>` text only when the string changed | O(hidden) |
| "Which workspace owns this project?" (editor hint, route reveal) | `owner.get(projectId)` | O(1) |
| Palette next/previous | `stepSelection(cachedDoc, selection, ±1)` | O(W) |
| Save with membership | one SQLite transaction: UPSERT row, DELETE dropped members, UPSERT new members | one write |

Nothing needs a later index or cache. The owner Map is the index, and TanStack's cache is the only copy of server state.

### Load-bearing decisions

1. **All host coupling is one pure function, `shellCss(mask)`, rendered by React as a `<style>` next to the rail** ([sketch-shell-css.ts](sketch-shell-css.ts)). Per *encode-lessons-in-structure*: the rail and its space share one component, so "the 56px exists if and only if the rail is drawn" holds by construction. Cleanup on disable, reload or crash is React unmounting one element. There are no disposers, observers, timers or foreign nodes in BB-owned React trees.
2. **Feature detection is declarative.** All four layout rules and the rail's own `display` share one `:root:has(<wrapper> > gap + panel)` gate, so they switch together. The filter rules name the exact hooks they hide. If BB renames anything, the affected rule matches nothing and BB renders as if the plugin weren't there. Every failure shows *more* of BB, never less. This was checked live: renaming `data-sidebar=gap` took down the rail and the shift together, and a collapsed sidebar and a compact viewport both drop the rail but keep the filter ([gate-check.cjs](evidence/gate-check.cjs)).
3. **Unfiled projects show in every workspace.** A project hides only when the user has filed it in another workspace. New projects, and the personal "Threads" project until the user files it, never vanish. The rule needs no "is this project new?" state, so there's nothing to track or auto-assign.
4. **The route is never masked.** Opening a thread from another workspace reveals its group instead of switching workspaces. `visiting` marks the owner tile. Navigation triggers no writes, so nothing races.
5. **Threads follow their root.** Only root threads are masked. Nested children, including cross-project children like arena runners under `/setup-pstack`, live and die with their root's row (verified live).
6. **Selection is per window** (`sessionStorage`, seeded from a per-device "last used" in `localStorage`). Per *separate-before-serializing-shared-state*: if two windows both wrote a server-side selection, one window's sidebar would change under the user mid-task. So each actor owns its own state and there's nothing to merge.
7. **The server stores records in SQLite with synchronous better-sqlite3 transactions.** Each mutation is atomic and can't interleave with another, so there's no read-modify-write window to lock (which KV's async get/set would need). Mutations are idempotent full-state operations: the client generates the id on create, `save` is an upsert with exact membership, `delete` of a missing id returns `false`, and `reorder` takes a full order (*make-operations-idempotent*).
8. **Images live in their workspace row** as a client-downscaled 128px WebP/PNG, ≤48 KB base64, and travel inline in `workspaces_get`. That means one query, no image route (which sidesteps the open question of whether `local` HTTP auth accepts the remote origin), no content addressing, and no orphan GC.
9. **One read hook, `useBoard()`,** merges four sources: the query cache kept fresh by realtime and reconnect invalidation, BB's sidebar hook, the per-window selection, and route context. The UI never sees a wire type, because `toDraft`/`toDoc` parse at the edge (*boundary-discipline*).

### Invariants and where they live

| Invariant | Enforced by |
|---|---|
| Valid ids, names, initials (1-3 graphemes), `#rrggbb`, image data URLs | zod brand schemas in `domain.ts`, shared by the RPC contract and the editor form. No cast exists anywhere because zod mints the brands. |
| Color XOR image | TS union + SQL CHECK |
| A project has at most one workspace | `ReadonlyMap` + SQL PRIMARY KEY |
| Rail space exists iff rail is drawn | same React component + one shared CSS gate |
| Failure never hides a project | `OPEN_MASK` in every non-ready `BoardState`; self-gating selectors |
| Selected workspace exists | `ActiveView` carries the entry; a dangling id resolves to All |
| IDs are safe inside CSS selectors | charset regex on the brands + `CSS.escape` |

### What it deliberately does not do

It doesn't replace or re-render BB's list, write BB UI preferences (`hiddenGroups`), sync selection across windows or devices, filter the composer's project picker, or support a project in two workspaces. Drag-to-reorder is left for later: Move up/down covers v1.

### Interface depth

- **`useBoard()`** has three fields plus a status. Behind it: RPC fetching, realtime and reconnect reconciliation, wire parsing, joining against live projects, selection persistence, route reveal and mask derivation. Every surface (rail, switcher, editor) uses only this hook plus three mutation hooks.
- **`shellCss(mask)`** is one function that hides every BB selector, the gate, escaping, collapsed and compact handling, and the empty-header fix. The only other export is `probeHost()`, the switcher's on-demand health notice.
- **`WorkspaceStore`** exposes five methods and hides the SQL, the transactions, membership moves and ordering. The RPC handlers and the CLI both call it, so the handlers aren't pass-throughs. They add the contract validation and the realtime publish.

A reader can trace a click in three files. `WorkspaceTile` calls `selection.set` (client.ts). `useBoard` then calls `resolveBoard` (domain.ts), and `RailOverlay` passes the result to `shellCss` (shell-css.ts). That call chain is two deep (*laziness-protocol*, *minimize-reader-load*).

### Module map

| Module | Owns | Size guess |
|---|---|---|
| `app.tsx` | registrations: overlay, footer disclosure, 5 commands | ~50 LoC |
| `server.ts` | migrations, RPC contract, `WorkspaceStore`, CLI | ~250 |
| `src/domain.ts` | brands, records, `resolveBoard`, `stepSelection`, face helpers | ~200 |
| `src/shell-css.ts` | BB hooks, `shellCss`, `probeHost` | ~120 |
| `src/client.ts` | `queryClient`, `selection`, `editor`, `useBoard`, mutations, command helpers | ~220 |
| `src/ui/*.tsx` | RailOverlay, WorkspaceRail, WorkspaceTile, AllTile, WorkspaceAvatar, EditorHost, WorkspaceEditor, DeleteWorkspaceDialog, ColorField, ImageField, ProjectChecklist, SwitcherDisclosure (one per file) | 40-180 each |

The scaffold's todo example, nav panel and skill are removed. A short `skills/workspaces/SKILL.md` documents the CLI for agents.

### Verification

- **Unit (vitest):** a table of `resolveBoard` cases (All, foreign vs unfiled, personal project filed, route reveal, dangling selection and memberships, child threads); `stepSelection`; `deriveInitials`; `readableInk`; `shellCss` output shape and escaping; `WorkspaceStore` against a real in-memory SQLite (idempotent save/delete/reorder, the partition move, CHECK rejection).
- **Slot tests (`renderSlot`):** the rail's loading, error+retry, empty and ready states; the editor's validation messages, API-error-keeps-input, and success toast+close; the color popover (preset pick, custom hex); the switcher's empty state.
- **Selector fixture test:** a Playwright run of `shellCss()` output against a captured BB 0.44 sidebar HTML fixture, so a BB bump shows which hook moved.
- **Live check (read-only, no install):** inject the built `shellCss()` output into http://127.0.0.1:38886 as [evidence/gate-check.cjs](evidence/gate-check.cjs) does today. It asserts the shift, the visible project set, the hidden pinned thread and header, the kept cross-project children, the collapsed sidebar, the compact viewport, hook-rename degradation and clean unmount. After install, repeat it in the desktop app for the traffic-light strip.

## Synthesis decision

Four runners on the scaffold at `a9d1fb5`: A (this package, claude-opus-5-5, `a08944e`), B (claude-fable-5-1, `53da646`), C (gpt-6-astra, `d48588d`), D (gpt-6-sol, `3b35744`). All four independently chose the same layout: an `experimental_appOverlay` rail plus CSS over BB's own list. Three of four chose partition membership (one owner per project) in SQLite and per-window selection. That convergence is the strongest signal of the arena.

**Base: A.** The cross-judge (codex / gpt-6-astra) recommended C (20/25) over A (18/25). The disagreement has two sources. First, the judge scored A down for its visibility policy (unfiled projects, the open thread's project and child threads stay visible), which is a product choice the user has not made, not a defect. Second, the judge gave C full marks for revisions, retry receipts and tombstones, which is machinery a one-user plugin does not need. A leaves the fewest moving parts for a maintainer: one pure `resolveBoard`, one pure `shellCss`, and one React-owned `<style>`, with a fail-open gate and the only live evidence.

**Grafts.**

1. From the judge (defect): `RailOverlay` puts `QueryClientProvider` above every consumer. The overlay renders the provider and an inner component that calls `useBoard()`, because the sketched order throws "No QueryClient set".
2. From the judge (defect): the collapse check was emulated (`data-state` only, `mainX` stayed 320). The live check clicks BB's real sidebar toggle (`data-collapsible=offcanvas`) and asserts geometry. `gate-check.cjs` becomes an assertion-based regression script that exits non-zero.
3. From C: requested vs applied filtering. `Board` gains `filter: "applied" | "unavailable"`, from probing the hooks `shellCss` depends on. The rail marks the active tile when filtering is unavailable instead of pretending. Failure still shows more of BB, never less.
4. From B: `Workspace` always has a `color` (the selection ring and the fallback background when an image fails) plus an optional `image`. This replaces the color XOR image union. SQL: `color NOT NULL`, `image_data` nullable.
5. From B: `initials` is nullable, and null means "derive from the name". A rename keeps following the name until the user types initials.
6. From B: every mutation returns the full `WorkspaceDoc`, and the client replaces its query cache with it instead of refetching.

**Rejected.** C's per-record revisions, receipts and tombstones (a single user; SQLite's synchronous transactions already serialize writes; last-writer-wins accepted). C's `projectIds` set per workspace (allows a project in two workspaces). D's content script owning the layout apart from the overlay (an overlay crash leaves an empty 64px strip). D's fail-closed degradation (hides BB's list when a hook changes). B's native `<input type="color">` (the macOS color panel steals focus and closes the popover).

**Policy defaults kept, pending the user.** Unfiled projects show in every workspace, the open thread's project is revealed in place, and child threads follow their root. Strict "only its projects" is a one-line change in `resolveBoard`.

## Amendment: one shared selection, strict workspaces (user, 2026-09-26)

The user replaced the policy defaults above and decision 6. Where this section and anything earlier disagree, this section wins.

1. **All workspaces is the unified view.** The All tile reads "All workspaces". A selected workspace shows only the projects it owns. Unfiled projects and the personal "Threads" group show only under All workspaces. Pinned threads of other projects stay hidden, and child threads still follow their root. This supersedes decision 3 ("unfiled show everywhere").
2. **One selection, shared.** The selection is server state: a one-row `selection` table next to the workspaces, returned in every doc as `selectedWorkspaceId`, written through the `selection_set` RPC and announced on `workspaces-changed`, so every window and device follows it. Deleting the selected workspace clears it in the same transaction, and a selection naming a missing workspace still resolves to All workspaces. This supersedes decision 6 (per-window `sessionStorage`) and the "server-wide selection" rejection under Alternatives considered.
3. **Navigation switches instead of revealing.** When the route's `(threadId, projectId)` pair changes, the selection follows it. A thread or a project page selects its project's owner, or All workspaces when the project is unfiled or the thread has no project. A route with neither (Settings, Plugins, plugin panels, compose with no project) leaves the selection alone, so opening Settings no longer flips the rail to All workspaces (parent review fix, same day). Only a change of the pair triggers this, so picking a tile while another workspace's thread is open sticks, and going from Settings to another workspace's thread still switches. The pair starts as neither, so the first route after the doc loads is a change too: a reload, deep link or notification that lands on a thread follows it, and a first page with neither leaves the selection alone (fixed after live verification, same day). `visiting` and the reveal-in-place rule (decision 4) are gone.

What changed in the shape: `WorkspaceDoc` gains `selection`, `resolveBoard` takes `{ doc, sidebar, filterHooksPresent }`, `Board` loses `visiting`, and `selectionForRoute(doc, { threadId, projectId })` is the pure navigation rule, returning a selection or `"unchanged"`. The selection write is an optimistic TanStack mutation serialized by a mutation scope, so rapid picks land in order. Windows now follow each other by design; two windows on different routes will switch the shared selection as each navigates.

## Live fixes after installation (2026-09-26)

- **Graft 3 moved into the stylesheet.** The JS probe ran once when the overlay mounted, before BB's list had committed its DOM, so every selected workspace showed a false "filter unavailable" badge. The warning is now plain markup marked `data-bb-workspaces-filter-warning`, rendered while a workspace hides something, and `shellCss` hides it with `:root:has(<the filter hooks>)`, the same hooks the mask rules key on. It shows exactly while those hooks are absent, with no timing. `Board.filter` and the probe are gone.

- **The rail inside BB's mobile shelf.** On compact viewports BB's sidebar panel stays fixed at x=0 under `main`, and `main` slides right by `--sidebar-width-mobile` (0.22s). BB's own JavaScript also writes that offset inline as `min(innerWidth × 0.76, 320px)` while it animates and while a swipe follows the finger. Three shapes were measured live at iPhone 13 size:
  - A fixed rail in the plugin overlay (S1).
  - The rail portaled into the panel (S2).
  - S2 with the shelf widened to fit the rail.

  S1 and S2 behave the same for taps and geometry, because `main`'s slide reveals and covers both. But S1 sits outside the panel's `aria-modal` dialog, so Tab leaves it for `<body>`, and it stays focusable under `main` while closed. S2 stays in the panel's focus order and is `inert` with it when closed. Widening janked: `main` stalled at BB's inline 296px, then slid again to 342px once the inline style cleared. Overriding BB's inline styles would break swipes. The rail is therefore portaled into the panel, and the panel pads its content by the rail's width only while the rail is inside (`:has(> [data-bb-workspaces-shelf-rail])`). BB's sidebar content narrows from 296 to about 239px on an iPhone 13. A layout remount re-targets the portal through a `childList` observer on `#root` and the layout root.

- **Touch.** iOS doesn't fire `contextmenu` reliably on long-press, so the context menu alone left phones without edit, move or delete. A tap on the selected tile opens the same four actions in a popover, which BB's vendored popover turns into a bottom sheet on phones. The edit dialog also offers Delete. Coarse pointers get no tooltips.
- **Verification on a phone.** `design/evidence/mobile-drive.cjs` drives the installed plugin as an iPhone 13 with touch, next to `gate-check.cjs`.

## Keyboard shortcuts (2026-09-27)

**BB's thread shortcuts counted masked rows.** BB 0.44 binds `thread.jump.1` to `thread.jump.9` to ⌘1-9 and `thread.previous` and `thread.next` to ⌘⇧[ and ⌘⇧] (⌃ in a browser). It builds both lists from `[data-sidebar-thread-shortcut-target]` rows in DOM order, and the previous and next list also reads the thread ids that windowed-out rows leave in `data-sidebar-windowed-nav`. It skips only rows inside an element with `data-sidebar-overflow="true"`, which BB's thread-list plugin sets on the lists in its More popups. It never checks visibility, and it jumps with `element.click()`. Under a workspace, the ⌃-hold badges started at ⌃2 because a hidden pinned thread took ⌃1. ⌃1 opened that thread, and route following switched the rail to All workspaces. ⌃⇧[ and ⌃⇧] walked into hidden threads, including windowed-out rows of hidden projects, and switched workspaces.

**Fix: the same selectors mark what they hide.** `maskSelectors(mask)` is now the one list of hidden elements. `shellCss` hides each selector, and `syncOverflowMarks` sets `data-sidebar-overflow="true"` on each matching element inside BB's sidebar panels. A second attribute, `data-bb-workspaces-overflow`, records which flags are the plugin's. The marker removes only those, and it skips elements that BB flagged itself. A mark on a project or Threads group also covers the windowed-out rows inside it. The overlay syncs the marks in a layout effect when the mask changes. A `MutationObserver` on the sidebar panels, re-attached when the layout swaps, re-syncs at most once a frame as rows remount. Unmount removes every mark. If BB renames a hook, nothing is marked and BB numbers rows as it does without the plugin, the same rule as the stylesheet. `design/evidence/shortcut-check.cjs` checks this in BB's web UI. Against the build installed before the fix, 10 of its 15 checks failed.

**Rail chords.** Tile n of the rail (All workspaces is tile 1) has the default chord ⌥⌘n for n up to 9, and ⌥⌘↓ and ⌥⌘↑ step the rail. BB reads ⌥ with a digit from `event.code`, so ⌥⌘2 matches on macOS even though ⌥2 types ™. No BB 0.44 binding uses ⌥ with a digit or an arrow, and BB drops a plugin default only when it collides. Tooltips and `aria-keyshortcuts` show the defaults. The SDK's `system.config()` returns the user's `keybindingOverrides`, but BB works out the effective bindings inside the app: it merges plugin defaults with overrides and drops a default that collides. Showing rebound chords would mean copying that logic into the plugin.

**Still open.** A windowed-out row that sits outside every group, such as a hidden pinned thread scrolled far out of view or a row in chronological mode, leaves a placeholder that no selector matches. ⌘⇧[ and ⌘⇧] could still step into it. This comes from reading BB's code and hasn't been observed. The fix that closes it belongs in BB, which should skip rows that aren't displayed when it builds the list. That's reported as [get-bb/bb#4430](https://github.com/get-bb/bb/issues/4430). The overflow marks are a stopgap until then, so they shouldn't grow selectors for placeholders.

## Tradeoffs accepted

- We accept a dependency on unowned BB DOM hooks (one table of selectors, one file) in exchange for the literal full-height first column and BB's native list with all its behavior.
- We accept CSS hiding (masked rows stay in the DOM) in exchange for not rebuilding the list. The same selectors mark the hidden rows as overflow, so BB's thread shortcuts skip them (see Keyboard shortcuts).
- We accept "unfiled shows everywhere", which is looser than "only its projects" until everything is filed, in exchange for never hiding a project the user didn't file.
- We accept no cross-window or cross-device selection sync in exchange for windows that never fight.
- We accept last-writer-wins when two windows edit the same workspace at once (one user) in exchange for no revision protocol.
- We accept up to ~48 KB per image in every doc read in exchange for one query, no image endpoint, no GC. Reads only happen on edits and reconnects.
- We accept a footer "Workspaces" button that duplicates the rail on desktop in exchange for a supported switcher on phones, with a collapsed sidebar, and when a BB update breaks the rail.
- We accept bundling TanStack Query, react-hook-form and react-colorful (~25 KB gz) in exchange for the user's conventions and a picker that works inside a popover.
- We accept partition membership in exchange for O(1) ownership and an unambiguous reveal.

## Alternatives considered

- **Own `experimental_threadList` provider with the rail inside (Shape B).** Supported and data-filtered, but the rail is only as tall as the scroll area. It also exposes the whole list to us: grouping, pins, sections, collapse, reorder, status, PR badges, archived paging, modes. That's a huge surface to own in exchange for hiding one policy. It loses on depth and on the literal UX.
- **Header or navigation switcher (Shape C).** It doesn't meet "first column", and it still needs one of the other shapes to filter.
- **Content script owning the `<style>`, overlay owning the rail, joined by a module store.** This is the documented split, but it gives two lifecycles to one invariant. If the overlay crashes, the layout stays shifted around an empty strip unless you add more plumbing. The docs themselves steer DOM work that needs React context (sidebar hooks, route, query cache) to React surfaces. Rejected.
- **Imperative DOM filtering or probing** (MutationObserver toggling `hidden`, JS feature probes). More code, timing bugs with windowed rows, and cleanup obligations, where CSS gets the same result declaratively and re-evaluates itself.
- **Writing BB's `hiddenGroups` preference.** It's a global denylist, it clobbers the user's own hidden groups, it changes every window, and the built-in list only reads it once. Rejected in Phase A.
- **Server-wide selection in KV.** Two writers (windows, phone and laptop) would switch each other's sidebars. Rejected per *separate-before-serializing-shared-state*.
- **Tag membership (`projectIds[]` per workspace).** It allows double membership, needs a reverse index for every ownership question, and makes reveal ambiguous.
- **KV storage.** The 256 KB cap is hit by images, and async read-modify-write needs a mutex that SQLite's sync transactions make unnecessary.
- **Native `<input type="color">` for the custom color.** The macOS color panel takes focus outside the page, and Radix Popover dismisses on that, mid-pick.

## Open questions and risks

- Should unfiled projects show everywhere (chosen) or only under All? If you want strict "only its projects", it's a one-line change in `resolveBoard`, possibly exposed as a plugin setting.
- Should the rail stay visible as a mini-dock when the desktop sidebar is collapsed? The design hides it (nothing to filter is on screen) and relies on the footer and palette.
- In the desktop app, the rail's top strip sits under the macOS traffic lights. It's reserved (BB chrome-row height) and marked as a drag region, but the toggle and back/forward placement after the shift needs a look in the app itself. The prototype and this check ran in a browser.
- BB animates the gap width and panel `left`. The live check caught the rail appearing ~200ms before the shift finished, overlapping the panel edge. The rail should slide in on the host's transition (translateX) so they move together.
- Resolved: BB's thread shortcuts did count masked rows. The overflow marks now take them out (see Keyboard shortcuts). Windowed-out rows outside every group remain open.
- Does windowing in the built-in list leave gaps when groups are masked on long lists? Nothing showed up on this 13-project list; the check should scroll a long one.
- In chronological and machine modes, masking relies on the thread-tree hook; user-named sections may leave an emptied header. Only By-project mode was verified live.
- On page load the full list flashes until the doc arrives. The fix, if wanted, is seeding the query from a sessionStorage snapshot.
- The `:has()` gate runs on `data-state` changes anywhere. The live check should record style-recalc cost while hovering tooltips and menus.

## Next implementation step

Write `src/domain.ts` (`resolveBoard` plus brands) with its table-driven tests and `src/shell-css.ts`, then run `evidence/gate-check.cjs` against the real `shellCss()` output before any UI exists.
