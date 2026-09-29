Workspaces puts a narrow column at the far left of BB, before the sidebar, with one tile per client. Pick a tile and BB's own project list shows only that client's projects. Pick **All workspaces** to see everything again.

## What you get

- **A tile per workspace.** Each shows its initials on its color, or an image you choose. Right-click a tile, or press and hold it on a phone, to edit, move or delete it.
- **Color that is quick to pick.** The color swatch opens twelve presets and a custom picker with a hex field.
- **Projects filed once.** A project belongs to one workspace. Ticking a project that is filed elsewhere moves it.
- **One selection everywhere.** Every window and device shows the same workspace, and opening a thread from another client's project switches to that client. Switch to a workspace that doesn't hold the open chat and that window shows BB's new-thread screen instead.
- **On a phone too.** Open BB's sidebar and the column is its first column; everything works by touch. With the desktop sidebar collapsed, use **Workspaces** in the sidebar footer or the palette commands *Next workspace*, *Previous workspace*, *Show all workspaces*, *Switch workspace* and *New workspace*.

## For agents

Agents file projects with `bb workspaces list`, `bb workspaces assign <project-id> <workspace>` and `bb workspaces unassign <project-id>`. The bundled skill explains when to use each.

## How it works

Workspaces and filings live in the plugin's own database on your BB server. Nothing leaves the machine, and there is no account or external service. BB 0.44 has no official slot for a column beside the sidebar, so the plugin sizes BB's layout with one stylesheet that turns itself off if BB's layout changes. When that happens BB looks exactly as it would without the plugin, and the footer switcher keeps working.
