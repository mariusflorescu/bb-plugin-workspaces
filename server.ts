import {
  PluginCliError,
  cliCommand,
  defineCli,
  defineRpcContract,
  type BbPluginApi,
} from "@get-bb/plugin-sdk";
import type Database from "better-sqlite3";
import { z } from "zod";
import {
  MAX_WORKSPACES,
  ProjectIdSchema,
  WORKSPACES_CHANGED,
  WireDocSchema,
  WorkspaceIdSchema,
  WorkspaceSchema,
  displayInitials,
  groupProjects,
  toDoc,
  type ProjectId,
  type WireDoc,
  type Workspace,
  type WorkspaceId,
  type WorkspacesChanged,
} from "./src/domain";

// Append-only: bb.storage.migrate() rejects edited or reordered statements.
export const MIGRATIONS: readonly string[] = [
  `CREATE TABLE workspace (
     id         TEXT PRIMARY KEY,
     name       TEXT NOT NULL,
     initials   TEXT,
     color      TEXT NOT NULL,
     image      TEXT,
     position   INTEGER NOT NULL,
     updated_at INTEGER NOT NULL
   )`,
  `CREATE TABLE membership (
     project_id   TEXT PRIMARY KEY,
     workspace_id TEXT NOT NULL REFERENCES workspace(id) ON DELETE CASCADE
   )`,
  `CREATE INDEX membership_by_workspace ON membership(workspace_id)`,
  `CREATE TABLE selection (
     singleton    INTEGER PRIMARY KEY CHECK (singleton = 1),
     workspace_id TEXT
   )`,
];

const MAX_PROJECTS_PER_SAVE = 1000;

const SaveInputSchema = WorkspaceSchema.extend({
  projectIds: z.array(ProjectIdSchema).max(MAX_PROJECTS_PER_SAVE),
  select: z.boolean(),
});
export type SaveInput = z.infer<typeof SaveInputSchema>;

export const rpcContract = defineRpcContract({
  workspaces_get: { input: z.null(), output: WireDocSchema },
  workspace_save: { input: SaveInputSchema, output: WireDocSchema },
  workspace_delete: {
    input: z.object({ id: WorkspaceIdSchema }),
    output: WireDocSchema,
  },
  workspaces_reorder: {
    input: z.object({ ids: z.array(WorkspaceIdSchema).max(MAX_WORKSPACES) }),
    output: WireDocSchema,
  },
  selection_set: {
    input: z.object({ id: WorkspaceIdSchema.nullable() }),
    output: WireDocSchema,
  },
});

class UserFacingError extends Error {}

export interface WorkspaceStore {
  read(): WireDoc;
  save(input: SaveInput): WireDoc;
  remove(id: WorkspaceId): WireDoc;
  reorder(ids: readonly WorkspaceId[]): WireDoc;
  assign(projectId: ProjectId, workspaceId: WorkspaceId | null): WireDoc;
  select(workspaceId: WorkspaceId | null): WireDoc;
}

export function createWorkspaceStore(
  db: Database.Database,
  now: () => number = Date.now,
): WorkspaceStore {
  const sql = {
    workspaces: db.prepare("SELECT id, name, initials, color, image FROM workspace ORDER BY position, rowid"),
    memberships: db.prepare(
      "SELECT project_id AS projectId, workspace_id AS workspaceId FROM membership ORDER BY project_id",
    ),
    ids: db.prepare("SELECT id FROM workspace ORDER BY position, rowid").pluck(),
    selected: db.prepare("SELECT workspace_id FROM selection WHERE singleton = 1").pluck(),
    select: db.prepare(
      `INSERT INTO selection (singleton, workspace_id) VALUES (1, ?)
       ON CONFLICT(singleton) DO UPDATE SET workspace_id = excluded.workspace_id`,
    ),
    deselect: db.prepare("UPDATE selection SET workspace_id = NULL WHERE workspace_id = ?"),
    count: db.prepare("SELECT COUNT(*) FROM workspace").pluck(),
    exists: db.prepare("SELECT COUNT(*) FROM workspace WHERE id = ?").pluck(),
    upsert: db.prepare(
      `INSERT INTO workspace (id, name, initials, color, image, position, updated_at)
       VALUES (@id, @name, @initials, @color, @image,
               (SELECT COALESCE(MAX(position), -1) + 1 FROM workspace), @updatedAt)
       ON CONFLICT(id) DO UPDATE SET
         name = excluded.name, initials = excluded.initials, color = excluded.color,
         image = excluded.image, updated_at = excluded.updated_at`,
    ),
    dropOtherMembers: db.prepare(
      "DELETE FROM membership WHERE workspace_id = ? AND project_id NOT IN (SELECT value FROM json_each(?))",
    ),
    file: db.prepare(
      `INSERT INTO membership (project_id, workspace_id) VALUES (?, ?)
       ON CONFLICT(project_id) DO UPDATE SET workspace_id = excluded.workspace_id`,
    ),
    unfile: db.prepare("DELETE FROM membership WHERE project_id = ?"),
    unfileAll: db.prepare("DELETE FROM membership WHERE workspace_id = ?"),
    delete: db.prepare("DELETE FROM workspace WHERE id = ?"),
    position: db.prepare("UPDATE workspace SET position = ? WHERE id = ?"),
  };
  const exists = (id: WorkspaceId) => z.number().parse(sql.exists.get(id)) > 0;

  const read = (): WireDoc =>
    WireDocSchema.parse({
      workspaces: sql.workspaces.all(),
      memberships: sql.memberships.all(),
      selectedWorkspaceId: sql.selected.get() ?? null,
    });

  const save = db.transaction((input: SaveInput) => {
    if (!exists(input.id) && z.number().parse(sql.count.get()) >= MAX_WORKSPACES) {
      throw new UserFacingError(`You can have up to ${MAX_WORKSPACES} workspaces. Delete one to make room.`);
    }
    sql.upsert.run({
      id: input.id,
      name: input.name,
      initials: input.initials,
      color: input.color,
      image: input.image,
      updatedAt: now(),
    });
    sql.dropOtherMembers.run(input.id, JSON.stringify(input.projectIds));
    for (const projectId of input.projectIds) sql.file.run(projectId, input.id);
    if (input.select) sql.select.run(input.id);
    return read();
  });

  const remove = db.transaction((id: WorkspaceId) => {
    sql.unfileAll.run(id);
    sql.deselect.run(id);
    sql.delete.run(id);
    return read();
  });

  const reorder = db.transaction((ids: readonly WorkspaceId[]) => {
    const current = z.array(WorkspaceIdSchema).parse(sql.ids.all());
    const listed = [...new Set(ids)].filter((id) => current.includes(id));
    const next = [...listed, ...current.filter((id) => !listed.includes(id))];
    next.forEach((id, position) => sql.position.run(position, id));
    return read();
  });

  const assign = db.transaction((projectId: ProjectId, workspaceId: WorkspaceId | null) => {
    if (workspaceId === null) {
      sql.unfile.run(projectId);
    } else if (exists(workspaceId)) {
      sql.file.run(projectId, workspaceId);
    } else {
      throw new UserFacingError(`No workspace with id ${workspaceId}`);
    }
    return read();
  });

  const select = db.transaction((workspaceId: WorkspaceId | null) => {
    if (workspaceId !== null && !exists(workspaceId)) {
      throw new UserFacingError("That workspace was deleted. Pick another one.");
    }
    sql.select.run(workspaceId);
    return read();
  });

  return { read, save, remove, reorder, assign, select };
}

export default async function plugin(bb: BbPluginApi): Promise<void> {
  const db = bb.storage.database();
  bb.storage.migrate(db, [...MIGRATIONS]);
  const store = createWorkspaceStore(db);

  const mutate = (write: () => WireDoc, signal: WorkspacesChanged = { kind: "reread" }): WireDoc => {
    let doc: WireDoc;
    try {
      doc = write();
    } catch (error) {
      if (error instanceof UserFacingError) throw error;
      bb.log.error(`workspace write failed: ${error instanceof Error ? error.message : String(error)}`);
      throw new UserFacingError("Couldn't save the change to your workspaces. Try again.");
    }
    bb.realtime.publish(WORKSPACES_CHANGED, signal);
    return doc;
  };

  bb.rpc.register(rpcContract, {
    workspaces_get: async () => store.read(),
    workspace_save: async (input) => mutate(() => store.save(input)),
    workspace_delete: async ({ id }) => mutate(() => store.remove(id)),
    workspaces_reorder: async ({ ids }) => mutate(() => store.reorder(ids)),
    selection_set: async ({ id }) => mutate(() => store.select(id), { kind: "selection", selectedWorkspaceId: id }),
  });

  bb.cli.register(workspacesCli(bb, store, mutate));
}

interface LiveProject {
  readonly id: string;
  readonly name: string;
}

function workspacesCli(
  bb: BbPluginApi,
  store: WorkspaceStore,
  mutate: (write: () => WireDoc) => WireDoc,
) {
  const json = { type: "boolean", description: "Print machine-readable JSON" } as const;
  const liveProjects = async (): Promise<LiveProject[]> =>
    (await bb.sdk.projects.list({ includePersonal: true })).map((project) => ({
      id: project.id,
      name: project.name,
    }));
  const projectArg = async (value: string): Promise<LiveProject & { id: ProjectId }> => {
    const id = ProjectIdSchema.safeParse(value);
    const project = (await liveProjects()).find((candidate) => candidate.id === value);
    if (!id.success || project === undefined) {
      throw new PluginCliError(`No project with id ${value}`, {
        code: "project_not_found",
        hint: "Run `bb project list --include-personal` to see project ids.",
      });
    }
    return { ...project, id: id.data };
  };
  const ownerName = (doc: WireDoc, projectId: ProjectId) => {
    const owner = toDoc(doc).owner.get(projectId);
    return owner === undefined ? null : { id: owner, name: doc.workspaces.find((w) => w.id === owner)?.name ?? owner };
  };

  return defineCli({
    name: "workspaces",
    summary: "Group BB projects into workspaces, one per client",
    description:
      "Workspaces fill the rail at the far left of BB. A project lives in at most one workspace; " +
      "create, rename and style workspaces in the app.",
    commands: {
      list: cliCommand({
        summary: "List workspaces in rail order with their projects, then the unfiled projects",
        options: { json },
        async run(input) {
          const live = await liveProjects();
          const projects = live.flatMap((project) => {
            const id = ProjectIdSchema.safeParse(project.id);
            return id.success ? [{ ...project, id: id.data }] : [];
          });
          const grouped = groupProjects(toDoc(store.read()), projects);
          const workspaces = grouped.entries.map(({ workspace, projects: members }) => ({
            id: workspace.id,
            name: workspace.name,
            initials: displayInitials(workspace),
            color: workspace.color,
            hasImage: workspace.image !== null,
            projects: members,
          }));
          const { unfiled } = grouped;
          if (input.options.json) {
            return { exitCode: 0, stdout: JSON.stringify({ workspaces, unfiled }) };
          }
          const block = (title: string, members: readonly LiveProject[]) =>
            [title, ...(members.length === 0 ? ["  (no projects)"] : members.map((p) => `  ${p.id}  ${p.name}`))].join("\n");
          const text = [
            ...workspaces.map((w) => block(`${w.name} (${w.initials})  id: ${w.id}`, w.projects)),
            block("Unfiled", unfiled),
          ];
          return {
            exitCode: 0,
            stdout: workspaces.length === 0 ? `No workspaces yet. Create one from the + in BB's workspace rail.\n\n${text.join("\n\n")}` : text.join("\n\n"),
          };
        },
      }),
      assign: cliCommand({
        summary: "File a project in a workspace, moving it out of any other",
        positionals: [
          { name: "project-id", description: "The project's id (proj_...)", required: true },
          { name: "workspace", description: "The workspace's id, name or initials, case-insensitive", required: true },
        ],
        options: { json },
        async run(input) {
          const project = await projectArg(input.positionals["project-id"]);
          const before = store.read();
          const target = resolveWorkspace(before.workspaces, input.positionals.workspace);
          const previous = ownerName(before, project.id);
          mutate(() => store.assign(project.id, target.id));
          const moved = previous !== null && previous.id !== target.id ? ` (moved from ${previous.name})` : "";
          return input.options.json
            ? { exitCode: 0, stdout: JSON.stringify({ projectId: project.id, workspaceId: target.id, previousWorkspaceId: previous?.id ?? null }) }
            : { exitCode: 0, stdout: `Filed ${project.name} in ${target.name}${moved}` };
        },
      }),
      unassign: cliCommand({
        summary: "Take a project out of its workspace; unfiled projects show under All workspaces",
        positionals: [{ name: "project-id", description: "The project's id (proj_...)", required: true }],
        options: { json },
        async run(input) {
          const project = await projectArg(input.positionals["project-id"]);
          const previous = ownerName(store.read(), project.id);
          if (previous !== null) mutate(() => store.assign(project.id, null));
          return input.options.json
            ? { exitCode: 0, stdout: JSON.stringify({ projectId: project.id, previousWorkspaceId: previous?.id ?? null }) }
            : {
                exitCode: 0,
                stdout:
                  previous === null
                    ? `${project.name} wasn't in a workspace`
                    : `${project.name} is now unfiled and shows under All workspaces (was in ${previous.name})`,
              };
        },
      }),
    },
  });
}

function resolveWorkspace(workspaces: readonly Workspace[], query: string): Workspace {
  const needle = query.trim().toLowerCase();
  const byId = workspaces.find((workspace) => workspace.id.toLowerCase() === needle);
  if (byId !== undefined) return byId;
  const matches = workspaces.filter(
    (workspace) =>
      workspace.name.toLowerCase() === needle || displayInitials(workspace).toLowerCase() === needle,
  );
  const [only, ...rest] = matches;
  if (only !== undefined && rest.length === 0) return only;
  throw new PluginCliError(
    only === undefined
      ? `No workspace matches "${query}"`
      : `"${query}" matches ${matches.length} workspaces: ${matches.map((w) => `${w.name} (${w.id})`).join(", ")}`,
    {
      code: only === undefined ? "workspace_not_found" : "workspace_ambiguous",
      hint: "Run `bb workspaces list` and pass the workspace id.",
    },
  );
}
