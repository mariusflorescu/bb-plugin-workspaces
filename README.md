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
- Click or tap the selected tile again, or right-click any tile, for **Edit**, **Move up**, **Move down** and **Delete**. The edit dialog has **Delete** too. Deleting a workspace keeps its projects in BB, unfiled.
- In the editor, the initials follow the name (Acme → AC) until you type your own; clear the field to follow the name again. **Color** opens twelve presets and a custom picker with a hex field. **Image** is optional and is cropped to a 128px square; it replaces the color on the tile. **Projects** is a checklist; ticking a project that lives in another workspace moves it here.
- The selection is shared: every window and device shows the same workspace, and a workspace you create becomes the selection. Opening a thread or a project page switches to the workspace that owns its project, or to All workspaces when the project is unfiled or the thread has no project. Pages with neither, such as Settings, Plugins or a plugin panel, leave the selection alone. Picking a tile while a thread stays open keeps your pick.
- On a phone, open BB's sidebar: the rail is its first column, and every action works by touch. The editor opens as a bottom sheet and keeps **Save** above the keyboard. With the desktop sidebar collapsed, use **Workspaces** in the sidebar footer. The palette has *Workspaces: Next workspace*, *Previous workspace*, *Show all workspaces*, *Switch workspace…* and *New workspace…*, which you can bind in BB's shortcut settings.

## For agents

`bb workspaces` files projects; creating and styling workspaces stays in the app. The bundled skill in `skills/workspaces/SKILL.md` tells agents when to use it.

```
bb workspaces list [--json]
bb workspaces assign <project-id> <workspace> [--json]   # workspace id, name or initials
bb workspaces unassign <project-id> [--json]
```

## How it works

BB 0.44 has no slot for a column beside the sidebar and no API to filter the built-in project list, so the plugin keeps all host coupling in one pure function. `src/shell-css.ts` turns a mask into a stylesheet that reserves the rail's width beside an expanded desktop sidebar, slides the rail on BB's own 200ms transition, and hides the masked project groups and root threads. React renders that stylesheet next to the rail, so the space exists exactly while the rail is mounted, and unmounting cleans everything up. Each rule names the full host structure it needs: if BB renames a hook, that rule matches nothing and BB looks as it would without the plugin. The footer switcher warns when the filter can't apply.

| Module | Owns |
| --- | --- |
| `src/domain.ts` | zod-branded values, the `Workspace` schema, and `resolveBoard()`, the pure visibility policy |
| `src/shell-css.ts` | every BB DOM hook, `shellCss(mask)` and the filter probe |
| `server.ts` | SQLite migrations, `WorkspaceStore`, the RPC contract and the `bb workspaces` CLI |
| `src/client.ts` | the TanStack Query cache, `useBoard()`, the mutation hooks, the shared selection and route following |
| `src/ui/*.tsx` | one component per file: the overlay, the rail and its shelf portal, tiles, editor, fields, delete dialog and footer switcher |
| `app.tsx` | registrations: the app overlay, the footer disclosure and five palette commands |

Workspaces, filings and the selection live in the plugin's SQLite database. A project has at most one workspace (`membership.project_id` is the primary key), every write is one synchronous transaction that returns the whole doc, and every write publishes `workspaces-changed` so other windows re-read. `design/RATIONALE.md` records the design and the user's amendments.

## Develop

```
npm install
npm test            # vitest: policy, stylesheet, store, RPC, CLI and slot tests
npm run typecheck
bb plugin build
```

`design/evidence/gate-check.cjs` checks the real `resolveBoard()` and `shellCss()` against a running BB web UI in a throwaway headless page. It asserts the rail and the shift, the exact visible projects for a workspace and for All workspaces, pinned and personal handling, a real collapse through BB's sidebar toggle (and that no server-synced UI setting changed), the compact drawer, degradation when hooks are renamed, and a clean unmount. It exits 1 on any failure and writes `gate-check.json` and a screenshot to `.evidence/`. When the plugin is installed in that BB, the script switches the installed copy off inside its own headless page first and asserts that BB then looks plugin-free. Run it after every BB update:

```
PW=<path to playwright> CHROME=<path to a Chromium binary> npm run gate
```

`design/evidence/mobile-drive.cjs` drives the installed plugin in the same BB as an iPhone 13 with touch. It checks:

- the rail inside BB's sidebar shelf and its open and close slide;
- every tile action by touch: switch, create, edit, move up, move down and delete;
- the editor sheet: the color swatches, a touch drag on the custom picker, the hex field, the image picker and the project list, with Save in view under a keyboard.

It creates only `verify-*` workspaces and deletes them. It sets the shared selection back to All workspaces, checks that your own workspaces and filings are unchanged, writes `mobile-drive.json` and screenshots to `.evidence/`, and exits 1 on any failure:

```
PW=<path to playwright> CHROME=<path to a Chromium binary> npm run mobile
```

Install and reload with `bb plugin install .` and `bb plugin reload workspaces`, or let `bb plugin dev` rebuild and reload on every save.

## UI components

`components/ui/` is vendored source from BB's component registry, pinned in `components.json`. Add more with `npx shadcn add @bb/<name>`. React, the portaling Radix packages and `sonner` come from the BB app at runtime and stay in `devDependencies`.

## Types and API reference

The plugin API is the npm package `@get-bb/plugin-sdk`, pinned to `0.5.29` in `devDependencies`. Its declarations are in `node_modules/@get-bb/plugin-sdk/bundled-types/`. Run `bb plugin types` to sync them with the BB you run.

## License

MIT. See [LICENSE](LICENSE).
