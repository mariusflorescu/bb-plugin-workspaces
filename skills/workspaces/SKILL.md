---
name: workspaces
description: File BB projects into client workspaces with the `bb workspaces` CLI from the Workspaces plugin. Use when the user asks which workspace a project belongs to, to put a project under a client (for example "file this under Acme"), to take a project out of a workspace, or to list workspaces and their projects.
---

# Workspaces

The Workspaces plugin adds a column at the far left of BB with one tile per
workspace. A workspace groups the projects you do for one client. A project
belongs to at most one workspace; a project in none is unfiled.

The selected workspace is shared by every window and device. While a
workspace is selected, BB's sidebar shows only that workspace's projects.
Unfiled projects and the personal Threads group show only under
**All workspaces**. Opening a thread from another workspace's project
switches the selection to that workspace.

Creating, renaming, coloring, reordering and deleting workspaces happen in
the app. The CLI files projects.

## Commands

| Command | Effect |
| --- | --- |
| `bb workspaces list` | Workspaces in rail order with their project ids and names, then the unfiled projects. |
| `bb workspaces assign <project-id> <workspace>` | File a project in a workspace. `<workspace>` is its id, name or initials, case-insensitive. A project filed elsewhere moves. |
| `bb workspaces unassign <project-id>` | Take a project out of its workspace. |

Add `--json` to any command when the output drives code. Errors under
`--json` print `{"ok": false, "error": {"code", "message", "hint"}}`.

## Procedure

1. Run `bb workspaces list` first. Use the project and workspace ids it
   prints; do not guess them. `bb project list --include-personal` also
   lists project ids.
2. File one project at a time: `bb workspaces assign proj_abc123 Acme`.
   If the name matches more than one workspace, the command fails with the
   candidates; pass the workspace id instead.
3. To undo a filing, run `bb workspaces unassign <project-id>`.
4. End with a short summary of what moved where. The output of `assign`
   names the workspace a project moved from.

## Rules

- Change filings only through `bb workspaces`. Do not edit the plugin's
  database.
- Assigning a project moves it out of any other workspace. Ask before you
  move a project that is already filed somewhere else, unless the user asked
  for exactly that move.
- `workspace_not_found` means no workspace has that id, name or initials. Ask
  the user to create it in the app with the **+** tile, then run `list`
  again.
- `project_not_found` means the project id is wrong or the project was
  deleted. Run `bb project list --include-personal`.
