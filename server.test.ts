import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { MIGRATIONS, createWorkspaceStore, type SaveInput } from "./server";
import { MAX_WORKSPACES, ProjectIdSchema, WorkspaceIdSchema, WorkspaceSchema } from "./src/domain";
import { fakeBackend } from "./test/fake-backend";

function memoryStore() {
  const db = new Database(":memory:");
  for (const statement of MIGRATIONS) db.exec(statement);
  return { db, store: createWorkspaceStore(db) };
}

function input(id: string, name: string, projectIds: string[] = [], select = false): SaveInput {
  return {
    ...WorkspaceSchema.parse({ id, name, initials: null, color: "#7C3AED", image: null }),
    projectIds: projectIds.map((projectId) => ProjectIdSchema.parse(projectId)),
    select,
  };
}

const wid = (value: string) => WorkspaceIdSchema.parse(value);
const pid = (value: string) => ProjectIdSchema.parse(value);
const face = { initials: null, color: "#7c3aed", image: null };

describe("WorkspaceStore", () => {
  it("creates workspaces in rail order, files their projects, and selects one when asked", () => {
    const { store } = memoryStore();
    store.save(input("acme", "Acme", ["proj_a", "proj_b"]));
    expect(store.save(input("globex", "Globex", ["proj_c"], true))).toEqual({
      workspaces: [
        { id: "acme", name: "Acme", ...face },
        { id: "globex", name: "Globex", ...face },
      ],
      memberships: [
        { projectId: "proj_a", workspaceId: "acme" },
        { projectId: "proj_b", workspaceId: "acme" },
        { projectId: "proj_c", workspaceId: "globex" },
      ],
      selectedWorkspaceId: "globex",
    });
  });

  it("repeats a save without changing anything", () => {
    const { store } = memoryStore();
    const first = store.save(input("acme", "Acme", ["proj_a"]));
    expect(store.save(input("acme", "Acme", ["proj_a"]))).toEqual(first);
  });

  it("moves a project filed elsewhere and drops unlisted members on update", () => {
    const { store } = memoryStore();
    store.save(input("acme", "Acme", ["proj_a", "proj_b"]));
    store.save(input("globex", "Globex", ["proj_c"]));
    expect(store.save(input("globex", "Globex renamed", ["proj_b"]))).toEqual({
      workspaces: [
        { id: "acme", name: "Acme", ...face },
        { id: "globex", name: "Globex renamed", ...face },
      ],
      memberships: [
        { projectId: "proj_a", workspaceId: "acme" },
        { projectId: "proj_b", workspaceId: "globex" },
      ],
      selectedWorkspaceId: null,
    });
  });

  it("keeps a project in at most one workspace even against raw SQL", () => {
    const { db, store } = memoryStore();
    store.save(input("acme", "Acme", ["proj_a"]));
    store.save(input("globex", "Globex"));
    expect(() =>
      db.prepare("INSERT INTO membership (project_id, workspace_id) VALUES ('proj_a', 'globex')").run(),
    ).toThrow("UNIQUE constraint failed: membership.project_id");
  });

  it("deletes a workspace, leaves its projects unfiled, selects All, and tolerates a repeat", () => {
    const { store } = memoryStore();
    store.save(input("acme", "Acme", ["proj_a"]));
    store.save(input("globex", "Globex", ["proj_c"]));
    store.select(wid("acme"));
    const expected = {
      workspaces: [{ id: "globex", name: "Globex", ...face }],
      memberships: [{ projectId: "proj_c", workspaceId: "globex" }],
      selectedWorkspaceId: null,
    };
    expect(store.remove(wid("acme"))).toEqual(expected);
    expect(store.remove(wid("acme"))).toEqual(expected);
  });

  it("reorders listed workspaces first, keeps unlisted ones after, ignores unknown ids", () => {
    const { store } = memoryStore();
    for (const id of ["a", "b", "c"]) store.save(input(id, id.toUpperCase()));
    const order = () => store.read().workspaces.map((workspace) => workspace.id);
    store.reorder([wid("c"), wid("ghost"), wid("a"), wid("c")]);
    expect(order()).toEqual(["c", "a", "b"]);
    store.reorder([wid("c"), wid("ghost"), wid("a"), wid("c")]);
    expect(order()).toEqual(["c", "a", "b"]);
  });

  it("assigns, moves and unassigns single projects", () => {
    const { store } = memoryStore();
    store.save(input("acme", "Acme"));
    store.save(input("globex", "Globex"));
    store.assign(pid("proj_a"), wid("acme"));
    expect(store.assign(pid("proj_a"), wid("globex")).memberships).toEqual([
      { projectId: "proj_a", workspaceId: "globex" },
    ]);
    expect(store.assign(pid("proj_a"), null).memberships).toEqual([]);
    expect(() => store.assign(pid("proj_a"), wid("ghost"))).toThrow("No workspace with id ghost");
  });

  it("shares one selection, rejects a deleted workspace, and selects All with null", () => {
    const { store } = memoryStore();
    store.save(input("acme", "Acme"));
    expect(store.save(input("globex", "Globex", [], true)).selectedWorkspaceId).toBe("globex");
    expect(store.select(wid("acme")).selectedWorkspaceId).toBe("acme");
    expect(store.select(wid("acme")).selectedWorkspaceId).toBe("acme");
    expect(() => store.select(wid("ghost"))).toThrow("That workspace was deleted. Pick another one.");
    expect(store.read().selectedWorkspaceId).toBe("acme");
    expect(store.remove(wid("globex")).selectedWorkspaceId).toBe("acme");
    expect(store.select(null).selectedWorkspaceId).toBeNull();
  });

  it(`caps new workspaces at ${MAX_WORKSPACES} but still saves existing ones`, () => {
    const { store } = memoryStore();
    for (let index = 0; index < MAX_WORKSPACES; index += 1) store.save(input(`w${index}`, `W${index}`));
    expect(() => store.save(input("extra", "Extra"))).toThrow(
      `You can have up to ${MAX_WORKSPACES} workspaces. Delete one to make room.`,
    );
    expect(store.save(input("w0", "Renamed")).workspaces[0]?.name).toBe("Renamed");
  });
});

async function loadedPlugin() {
  return (await fakeBackend()).harness;
}

describe("RPC", () => {
  it("returns the whole doc from a save and signals other windows", async () => {
    const harness = await loadedPlugin();
    const saved = await harness.behavior.callRpc("workspace_save", {
      id: "acme",
      name: " Acme ",
      initials: null,
      color: "#AABBCC",
      image: null,
      projectIds: ["proj_acme"],
      select: true,
    });
    expect(saved).toEqual({
      workspaces: [{ id: "acme", name: "Acme", initials: null, color: "#aabbcc", image: null }],
      memberships: [{ projectId: "proj_acme", workspaceId: "acme" }],
      selectedWorkspaceId: "acme",
    });
    expect(await harness.behavior.callRpc("workspaces_get", null)).toEqual(saved);
    expect(harness.inspection.realtimeSignals.map((signal) => [signal.channel, signal.payload])).toEqual([
      ["workspaces-changed", { kind: "reread" }],
    ]);
  });

  it("sets the shared selection and sends it to every window in the signal", async () => {
    const harness = await loadedPlugin();
    await harness.behavior.callRpc("workspace_save", { id: "acme", name: "Acme", initials: null, color: "#7c3aed", image: null, projectIds: [], select: false });
    expect(await harness.behavior.callRpc("selection_set", { id: null })).toMatchObject({ selectedWorkspaceId: null });
    expect(harness.inspection.realtimeSignals.map((signal) => [signal.channel, signal.payload])).toEqual([
      ["workspaces-changed", { kind: "reread" }],
      ["workspaces-changed", { kind: "selection", selectedWorkspaceId: null }],
    ]);
    await expect(harness.behavior.callRpc("selection_set", { id: "ghost" })).rejects.toMatchObject({
      message: "That workspace was deleted. Pick another one.",
    });
  });

  it("rejects an invalid color at the wire with the field's message", async () => {
    const harness = await loadedPlugin();
    await expect(
      harness.behavior.callRpc("workspace_save", {
        id: "acme",
        name: "Acme",
        initials: null,
        color: "purple",
        image: null,
        projectIds: [],
        select: false,
      }),
    ).rejects.toMatchObject({ code: "invalid_input" });
    expect(harness.inspection.realtimeSignals).toEqual([]);
  });

  it("passes a user-facing store error through as the RPC message", async () => {
    const harness = await loadedPlugin();
    for (let index = 0; index < MAX_WORKSPACES; index += 1) {
      await harness.behavior.callRpc("workspace_save", { id: `w${index}`, name: `W${index}`, initials: null, color: "#7c3aed", image: null, projectIds: [], select: false });
    }
    await expect(
      harness.behavior.callRpc("workspace_save", { id: "extra", name: "Extra", initials: null, color: "#7c3aed", image: null, projectIds: [], select: false }),
    ).rejects.toMatchObject({ message: `You can have up to ${MAX_WORKSPACES} workspaces. Delete one to make room.` });
  });
});

describe("bb workspaces", () => {
  async function withTwoWorkspaces() {
    const harness = await loadedPlugin();
    await harness.behavior.callRpc("workspace_save", { id: "acme", name: "Acme", initials: null, color: "#7c3aed", image: null, projectIds: ["proj_acme"], select: false });
    await harness.behavior.callRpc("workspace_save", { id: "globex", name: "Globex", initials: "GL", color: "#0d9488", image: null, projectIds: [], select: false });
    return harness;
  }

  it("lists workspaces with their projects and the unfiled ones", async () => {
    const harness = await withTwoWorkspaces();
    expect(await harness.behavior.runCli(["list"])).toEqual({
      exitCode: 0,
      stdout: [
        "Acme (AC)  id: acme\n  proj_acme  web-app",
        "Globex (GL)  id: globex\n  (no projects)",
        "Unfiled\n  proj_globex  api\n  proj_new  fresh-project\n  proj_personal  Personal",
      ].join("\n\n"),
      stderr: "",
    });
  });

  it("lists as JSON without image data", async () => {
    const harness = await withTwoWorkspaces();
    const result = await harness.behavior.runCli(["list", "--json"]);
    expect(JSON.parse(result.stdout)).toEqual({
      workspaces: [
        { id: "acme", name: "Acme", initials: "AC", color: "#7c3aed", hasImage: false, projects: [{ id: "proj_acme", name: "web-app" }] },
        { id: "globex", name: "Globex", initials: "GL", color: "#0d9488", hasImage: false, projects: [] },
      ],
      unfiled: [
        { id: "proj_globex", name: "api" },
        { id: "proj_new", name: "fresh-project" },
        { id: "proj_personal", name: "Personal" },
      ],
    });
  });

  it("assigns by name or initials, reports the move, and signals the app", async () => {
    const harness = await withTwoWorkspaces();
    expect(await harness.behavior.runCli(["assign", "proj_acme", "gl"])).toEqual({
      exitCode: 0,
      stdout: "Filed web-app in Globex (moved from Acme)",
      stderr: "",
    });
    expect(await harness.behavior.runCli(["assign", "proj_globex", "acme", "--json"])).toEqual({
      exitCode: 0,
      stdout: JSON.stringify({ projectId: "proj_globex", workspaceId: "acme", previousWorkspaceId: null }),
      stderr: "",
    });
    expect(harness.inspection.realtimeSignals).toHaveLength(4);
  });

  it("unassigns a project, and says so when it wasn't filed", async () => {
    const harness = await withTwoWorkspaces();
    expect((await harness.behavior.runCli(["unassign", "proj_acme"])).stdout).toBe(
      "web-app is now unfiled and shows under All workspaces (was in Acme)",
    );
    expect((await harness.behavior.runCli(["unassign", "proj_acme"])).stdout).toBe(
      "web-app wasn't in a workspace",
    );
  });

  it("rejects an unknown project or workspace with a hint", async () => {
    const harness = await withTwoWorkspaces();
    const unknownProject = await harness.behavior.runCli(["assign", "proj_ghost", "acme"]);
    expect([unknownProject.exitCode, unknownProject.stderr]).toEqual([
      1,
      expect.stringContaining("No project with id proj_ghost"),
    ]);
    const unknownWorkspace = await harness.behavior.runCli(["assign", "proj_acme", "initech", "--json"]);
    expect(JSON.parse(unknownWorkspace.stdout)).toEqual({
      ok: false,
      error: {
        code: "workspace_not_found",
        message: 'No workspace matches "initech"',
        hint: "Run `bb workspaces list` and pass the workspace id.",
      },
    });
  });
});
