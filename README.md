# bb-plugin-workspaces

A BB plugin that adds a column at the far left of the app, before the sidebar, holding workspaces. A workspace groups the projects you do for one client (Acme, Globex, Initech, Umbrella). Picking one makes BB's own project list show only that client's projects.

## Install

```
bb plugin install git:https://github.com/mariusflorescu/bb-plugin-workspaces
```

Requires bb 0.44 or newer. `bb plugin update workspaces` pulls later versions.

## Use it

- **All workspaces** (the grid tile at the top) shows every project. Below it is one tile per workspace: its initials on its color, or its image. **+** creates a workspace.
- Click a tile and the sidebar shows only the projects that workspace owns. Unfiled projects and the personal Threads group show only under All workspaces.
- A click or tap only selects a tile. Right-click any tile for **Edit**, **Move up**, **Move down** and **Delete**. On a phone, press and hold the tile. From the keyboard, focus the tile and press Shift+F10 or the Menu key. The edit dialog has **Delete** too. Deleting a workspace keeps its projects in BB, unfiled.
- In the editor, the initials follow the name (Acme → AC) until you type your own; clear the field to follow the name again. **Color** opens twelve presets and a custom picker with a hex field. **Image** is optional and is cropped to a 128px square; it replaces the color on the tile. **Projects** is a checklist; ticking a project that lives in another workspace moves it here.
- The selection is shared: every window and device shows the same workspace, and a workspace you create becomes the selection. Opening a thread or a project page switches to the workspace that owns its project, or to All workspaces when the project is unfiled or the thread has no project. Pages with neither, such as Settings, Plugins or a plugin panel, leave the selection alone. Picking a workspace that doesn't own the open thread or project takes that window to BB's new-thread screen. Picking All workspaces never does, and other windows keep what they show.
- On a phone, open BB's sidebar: the rail is its first column, and every action works by touch. The editor opens as a bottom sheet and keeps **Save** above the keyboard. With the desktop sidebar collapsed, use **Workspaces** in the sidebar footer.
- ⌥⌘1 selects All workspaces, and ⌥⌘2 to ⌥⌘9 select the tiles below it, top to bottom. ⌥⌘↓ and ⌥⌘↑ step down and up the rail. On Windows and Linux the chords are Ctrl+Alt+1 and so on. Each of the first nine tiles ends its tooltip with its chord. The tooltips show these defaults even after you rebind a command, because BB resolves bindings inside the app and doesn't give plugins the result.
- BB's own thread shortcuts, ⌘1 to ⌘9 and ⌘⇧[ and ⌘⇧] (⌃ instead of ⌘ in a browser), count only the threads the selected workspace shows.
- The palette has *Workspaces: Next workspace*, *Previous workspace*, *Show all workspaces*, *Switch to tile 2* to *Switch to tile 9*, *Switch workspace…* and *New workspace…*. You can rebind any of them in BB's shortcut settings.

## For agents

`bb workspaces` files projects; creating and styling workspaces stays in the app. The bundled skill in `skills/workspaces/SKILL.md` tells agents when to use it.

```
bb workspaces list [--json]
bb workspaces assign <project-id> <workspace> [--json]   # workspace id, name or initials
bb workspaces unassign <project-id> [--json]
```

## How it works

BB 0.44 has no slot for a column beside the sidebar and no API to filter the built-in project list, so the plugin keeps all host coupling in one module. `src/shell-css.ts` turns a mask into a stylesheet that reserves the rail's width beside an expanded desktop sidebar, slides the rail on BB's own 200ms transition, and hides the masked project groups and root threads. React renders that stylesheet next to the rail, so the space exists exactly while the rail is mounted, and unmounting cleans everything up. Each rule names the full host structure it needs: if BB renames a hook, that rule matches nothing and BB looks as it would without the plugin. The footer switcher warns when the filter can't apply.

BB numbers the sidebar's threads for ⌘1-9 and ⌘⇧[ ] straight from the DOM and never checks whether a row is visible, so hiding rows with CSS alone would leave them in that list. `maskSelectors(mask)` is the one list of elements the mask hides, and both halves read it. The stylesheet hides each element, and the overlay marks each one inside BB's sidebar with `data-sidebar-overflow="true"`. BB's own **More** popups use that attribute to keep their threads out of the numbered list. Each mark also carries `data-bb-workspaces-overflow`, so the plugin removes only its own marks and never touches BB's. The overlay re-marks rows as BB remounts them and removes every mark when it unmounts.

| Module | Owns |
| --- | --- |
| `src/domain.ts` | zod-branded values, the `Workspace` schema, `resolveBoard()`, the pure visibility policy, and `railOrder()`, the rail's tile order |
| `src/shell-css.ts` | every BB DOM hook, `maskSelectors(mask)`, `shellCss(selectors)`, the overflow marks and the filter probe |
| `src/shortcuts.ts` | the rail's default chords and how each one reads on the user's platform |
| `server.ts` | SQLite migrations, `WorkspaceStore`, the RPC contract and the `bb workspaces` CLI |
| `src/client.ts` | the TanStack Query cache, `useBoard()`, the mutation hooks, the shared selection and route following |
| `src/ui/*.tsx` | one component per file: the overlay, the rail and its shelf portal, tiles, editor, fields, delete dialog and footer switcher |
| `app.tsx` | registrations: the app overlay, the footer disclosure and thirteen palette commands |

Workspaces, filings and the selection live in the plugin's SQLite database. A project has at most one workspace (`membership.project_id` is the primary key), every write is one synchronous transaction that returns the whole doc, and every write publishes `workspaces-changed` so other windows re-read. `design/RATIONALE.md` records the design and the user's amendments.

## Develop

```
npm install
npm test            # vitest: policy, stylesheet, overflow marks, store, RPC, CLI, command and slot tests
npm run typecheck
bb plugin build
```

`design/evidence/gate-check.cjs` checks the real `resolveBoard()` and `shellCss()` against a running BB web UI in a throwaway headless page. It asserts the rail and the shift, the exact visible projects for a workspace and for All workspaces, pinned and personal handling, a real collapse through BB's sidebar toggle (and that no server-synced UI setting changed), the compact drawer, degradation when hooks are renamed, and a clean unmount. It exits 1 on any failure and writes `gate-check.json` and a screenshot to `.evidence/`. When the plugin is installed in that BB, the script switches the installed copy off inside its own headless page first and asserts that BB then looks plugin-free. Run it after every BB update:

```
PW=<path to playwright> CHROME=<path to a Chromium binary> npm run gate
```

`design/evidence/mobile-drive.cjs` drives the installed plugin in the same BB as an iPhone 13 with touch. It checks:

- the rail inside BB's sidebar shelf and its open and close slide;
- every tile action by touch: a tap switches and creates, a tap on the selected tile opens nothing, and a long-press opens the actions for edit, move up, move down and delete with no `contextmenu` event, through Radix's own timer;
- the editor sheet: the color swatches, a touch drag on the custom picker, the hex field, the image picker and the project list, with Save in view under a keyboard.

It creates only `verify-*` workspaces and deletes them. It puts the shared selection back where it was, checks that your own workspaces and filings are unchanged, writes `mobile-drive.json` and screenshots to `.evidence/`, and exits 1 on any failure:

```
PW=<path to playwright> CHROME=<path to a Chromium binary> npm run mobile
```

`design/evidence/divider-check.cjs` checks that the rail's divider stays out of the title-bar row, where macOS draws the traffic lights. It opens the installed plugin in BB's web UI in light, in dark and in the phone shelf, reads the pixel column at the rail's right edge, and asserts that nothing is drawn there inside BB's title-bar row and that the divider runs from under that row to the rail's bottom. It writes `divider-check.json` and screenshots to `.evidence/` and exits 1 on any failure:

```
PW=<path to playwright> CHROME=<path to a Chromium binary> npm run divider
```

`design/evidence/shortcut-check.cjs` checks keyboard navigation against the installed plugin in BB's web UI, where BB binds its thread shortcuts to ⌃ instead of ⌘. It checks that:

- a workspace with no projects numbers no thread while you hold ⌃, and ⌃1 opens nothing;
- under a workspace that hides a numbered thread, the ⌃ badges run from 1 over the visible threads only, ⌃1 opens the first of them, and ⌃⇧[ and ⌃⇧] stay inside the workspace;
- ⌥⌘1, ⌥⌘2, ⌥⌘↓ and ⌥⌘↑ move the rail's selection;
- no element outside BB's sidebar carries the plugin's overflow mark.

It needs one of your workspaces to hide a thread row while showing another, and fails with "no fixture" otherwise. It creates only `verify-*` workspaces and deletes them, puts the shared selection back where it was, checks that your own workspaces and filings are unchanged, writes `shortcut-check.json` and screenshots to `.evidence/`, and exits 1 on any failure:

```
PW=<path to playwright> CHROME=<path to a Chromium binary> npm run shortcuts
```

`design/evidence/actions-check.cjs` checks how a tile's actions open in BB's web UI at desktop size. It checks that a left-click on the selected tile opens no menu and keeps it selected, and that a right-click, Shift+F10 on the focused tile and the Menu key each open exactly **Edit**, **Move up**, **Move down** and **Delete**. It also checks that the tooltip says "right-click for actions". It creates one `verify-*` workspace and deletes it, puts the shared selection back where it was, checks that your own workspaces and filings are unchanged, writes `actions-check.json` and screenshots to `.evidence/`, and exits 1 on any failure:

```
PW=<path to playwright> CHROME=<path to a Chromium binary> npm run actions
```

Install and reload with `bb plugin install .` and `bb plugin reload workspaces`, or let `bb plugin dev` rebuild and reload on every save.

## UI components

`components/ui/` is vendored source from BB's component registry, pinned in `components.json`. Add more with `npx shadcn add @bb/<name>`. React, the portaling Radix packages and `sonner` come from the BB app at runtime and stay in `devDependencies`.

## Types and API reference

The plugin API is the npm package `@get-bb/plugin-sdk`, pinned to `0.5.29` in `devDependencies`. Its declarations are in `node_modules/@get-bb/plugin-sdk/bundled-types/`. Run `bb plugin types` to sync them with the BB you run.

## License

MIT. See [LICENSE](LICENSE).
