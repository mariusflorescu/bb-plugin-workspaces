// @vitest-environment jsdom
import { renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { act, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { PROJECTS, THREADS, fakeBackend } from "../test/fake-backend";
import "../test/ui-lifecycle";
import { selectWorkspace, useBoard, useFollowRoute, useReturnToLastThread, useSaveWorkspace } from "./client";
import { ALL, HexColorSchema, WorkspaceIdSchema, WorkspaceNameSchema } from "./domain";
import { WorkspacesProvider } from "./ui/WorkspacesProvider";

function BoardText() {
  const state = useBoard();
  const save = useSaveWorkspace();
  if (state.status === "loading") return <p>loading</p>;
  if (state.status === "error") return <p>{state.message}</p>;
  const { board } = state;
  return (
    <div>
      <p>active: {board.active.kind === "all" ? "All" : board.active.entry.workspace.name}</p>
      <p>rail: {board.entries.map((entry) => entry.workspace.name).join(", ")}</p>
      <p>hidden: {[...state.mask.hiddenProjects].join(", ") || "none"}</p>
      <button type="button" onClick={() => selectWorkspace({ kind: "workspace", id: WorkspaceIdSchema.parse("acme") })}>
        pick Acme
      </button>
      <button
        type="button"
        onClick={() =>
          save.mutate({
            id: WorkspaceIdSchema.parse("inn"),
            name: WorkspaceNameSchema.parse("Initech"),
            initials: null,
            color: HexColorSchema.parse("#16a34a"),
            image: null,
            projectIds: [],
            select: false,
          })
        }
      >
        add Initech
      </button>
    </div>
  );
}

function Probe() {
  return (
    <WorkspacesProvider>
      <BoardText />
    </WorkspacesProvider>
  );
}

interface Route {
  readonly threadId: string | null;
  readonly projectId: string | null;
}

function RouteFollower({ route }: { readonly route: Route }) {
  const state = useBoard();
  useFollowRoute(route, state.status === "ready");
  useReturnToLastThread(route, state);
  return null;
}

function RouteProbe({ route }: { readonly route: Route }) {
  return (
    <WorkspacesProvider>
      <BoardText />
      <RouteFollower route={route} />
    </WorkspacesProvider>
  );
}

const SEED = [
  { id: "acme", name: "Acme", projectIds: ["proj_acme"] },
  { id: "globex", name: "Globex", projectIds: ["proj_globex"] },
];

const selectionCalls = (slot: ReturnType<typeof renderSlot>) =>
  slot.inspection.rpcCalls.filter((call) => call.method === "selection_set").map((call) => call.input);

const docReads = (calls: readonly { method: string }[]) => calls.filter((call) => call.method === "workspaces_get").length;



const selected = async (backend: Awaited<ReturnType<typeof fakeBackend>>) => {
  const doc = await backend.harness.behavior.callRpc("workspaces_get", null);
  return typeof doc === "object" && doc !== null && "selectedWorkspaceId" in doc ? doc.selectedWorkspaceId : undefined;
};

describe("useBoard", () => {
  it("shows loading, then the rail, and a pick filters to that workspace for every window", async () => {
    const backend = await fakeBackend(SEED);
    const slot = renderSlot({ component: Probe }, {}, { rpc: backend.rpc, sidebarThreads: { projects: PROJECTS } });
    expect(slot.getByText("loading")).toBeTruthy();
    expect(await slot.findByText("rail: Acme, Globex")).toBeTruthy();
    expect(slot.getByText("hidden: none")).toBeTruthy();

    fireEvent.click(slot.getByText("pick Acme"));
    expect(await slot.findByText("active: Acme")).toBeTruthy();
    expect(slot.getByText("hidden: proj_globex, proj_new, proj_personal")).toBeTruthy();
    await vi.waitFor(async () => expect(await selected(backend)).toBe("acme"));
  });

  it("follows a pick made in another window from the signal alone, without re-reading", async () => {
    const backend = await fakeBackend(SEED);
    const slot = renderSlot({ component: Probe }, {}, { rpc: backend.rpc, sidebarThreads: { projects: PROJECTS } });
    await slot.findByText("active: All");
    await backend.harness.behavior.callRpc("selection_set", { id: "globex" });
    await slot.behavior.emitRealtime("workspaces-changed", { kind: "selection", selectedWorkspaceId: "globex" });
    expect(await slot.findByText("active: Globex")).toBeTruthy();
    expect(docReads(slot.inspection.rpcCalls)).toBe(1);
  });

  it("follows the route's thread or project, leaves pages with neither alone, and never undoes a pick", async () => {
    const backend = await fakeBackend(SEED);
    const options = { rpc: backend.rpc, sidebarThreads: { projects: PROJECTS } };
    const slot = renderSlot({ component: RouteProbe }, { route: { threadId: null, projectId: null } }, options);
    const go = async (route: Route, expected: string) => {
      slot.lifecycle.rerender(<RouteProbe route={route} />);
      expect(await slot.findByText(`active: ${expected}`)).toBeTruthy();
    };
    const pick = async (id: string, expected: string) => {
      act(() => selectWorkspace({ kind: "workspace", id: WorkspaceIdSchema.parse(id) }));
      expect(await slot.findByText(`active: ${expected}`)).toBeTruthy();
    };
    await slot.findByText("active: All");

    await go({ threadId: "thr_2", projectId: "proj_acme" }, "Acme");
    await pick("globex", "Globex");
    await go({ threadId: "thr_2", projectId: "proj_acme" }, "Globex");
    await go({ threadId: null, projectId: null }, "Globex");
    await go({ threadId: "thr_2", projectId: "proj_acme" }, "Acme");
    await go({ threadId: null, projectId: "proj_globex" }, "Globex");
    await go({ threadId: null, projectId: "proj_new" }, "All");
    await pick("acme", "Acme");
    await go({ threadId: null, projectId: null }, "Acme");
    await go({ threadId: "thr_3", projectId: null }, "All");

    await vi.waitFor(async () => expect(await selected(backend)).toBeNull());
    expect(selectionCalls(slot)).toEqual([
      { id: "acme" },
      { id: "globex" },
      { id: "acme" },
      { id: "globex" },
      { id: null },
      { id: "acme" },
      { id: null },
    ]);
  });

  it("follows the thread a cold load lands on", async () => {
    const backend = await fakeBackend(SEED);
    await backend.harness.behavior.callRpc("selection_set", { id: "globex" });
    const slot = renderSlot(
      { component: RouteProbe },
      { route: { threadId: "thr_1", projectId: "proj_acme" } },
      { rpc: backend.rpc, sidebarThreads: { projects: PROJECTS } },
    );
    expect(await slot.findByText("active: Acme")).toBeTruthy();
    await vi.waitFor(async () => expect(await selected(backend)).toBe("acme"));
    expect(selectionCalls(slot)).toEqual([{ id: "acme" }]);
  });

  it("leaves the selection alone when a cold load lands on neither a thread nor a project", async () => {
    const backend = await fakeBackend(SEED);
    await backend.harness.behavior.callRpc("selection_set", { id: "globex" });
    const slot = renderSlot(
      { component: RouteProbe },
      { route: { threadId: null, projectId: null } },
      { rpc: backend.rpc, sidebarThreads: { projects: PROJECTS } },
    );
    expect(await slot.findByText("active: Globex")).toBeTruthy();
    expect(selectionCalls(slot)).toEqual([]);
    expect(await selected(backend)).toBe("globex");
  });

  it("re-reads on the realtime signal and after a reconnect, not on the first connect", async () => {
    const backend = await fakeBackend(SEED);
    const slot = renderSlot({ component: Probe }, {}, { rpc: backend.rpc, sidebarThreads: { projects: PROJECTS } });
    await slot.findByText("rail: Acme, Globex");
    expect(docReads(slot.inspection.rpcCalls)).toBe(1);

    await backend.harness.behavior.runCli(["assign", "proj_new", "acme"]);
    await backend.harness.behavior.callRpc("workspace_delete", { id: "globex" });
    await slot.behavior.emitRealtime("workspaces-changed", null);
    expect(await slot.findByText("rail: Acme")).toBeTruthy();

    await backend.harness.behavior.callRpc("workspace_save", { id: "globex", name: "Globex", initials: null, color: "#7c3aed", image: null, projectIds: [], select: false });
    await slot.behavior.setRealtimeConnectionState("reconnecting");
    await slot.behavior.setRealtimeConnectionState("connected");
    expect(await slot.findByText("rail: Acme, Globex")).toBeTruthy();
    expect(docReads(slot.inspection.rpcCalls)).toBe(3);
  });

  it("replaces the cache with the doc a save returns instead of re-reading", async () => {
    const backend = await fakeBackend(SEED);
    const slot = renderSlot({ component: Probe }, {}, { rpc: backend.rpc, sidebarThreads: { projects: PROJECTS } });
    await slot.findByText("rail: Acme, Globex");
    fireEvent.click(slot.getByText("add Initech"));
    expect(await slot.findByText("rail: Acme, Globex, Initech")).toBeTruthy();
    expect(docReads(slot.inspection.rpcCalls)).toBe(1);
  });

  it("reports a failed read in a sentence a person can act on", async () => {
    const slot = renderSlot(
      { component: Probe },
      {},
      {
        rpc: {
          workspaces_get: () => {
            throw new Error("database is locked");
          },
        },
        sidebarThreads: { projects: PROJECTS },
      },
    );
    expect(await slot.findByText("Couldn't load your workspaces.")).toBeTruthy();
  });
});

describe("landing on a pick", () => {
  const NOWHERE: Route = { threadId: null, projectId: null };
  const ON_ACME: Route = { threadId: "thr_acme", projectId: "proj_acme" };
  const ON_GLOBEX: Route = { threadId: "thr_globex", projectId: "proj_globex" };

  function mountRoutes(backend: Awaited<ReturnType<typeof fakeBackend>>, route: Route) {
    const slot = renderSlot(
      { component: RouteProbe },
      { route },
      { rpc: backend.rpc, sidebarThreads: { projects: PROJECTS, threads: THREADS }, pluginId: "workspaces" },
    );
    const go = async (next: Route, expected: string) => {
      slot.lifecycle.rerender(<RouteProbe route={next} />);
      expect(await slot.findByText(`active: ${expected}`)).toBeTruthy();
    };
    const pick = async (id: string | null, expected: string) => {
      act(() => selectWorkspace(id === null ? ALL : { kind: "workspace", id: WorkspaceIdSchema.parse(id) }));
      expect(await slot.findByText(`active: ${expected}`)).toBeTruthy();
    };
    return { slot, go, pick };
  }

  it("returns to each workspace's last thread, and stays for All and for the workspace on screen", async () => {
    const { slot, go, pick } = mountRoutes(await fakeBackend(SEED), NOWHERE);
    await slot.findByText("active: All");

    await go(ON_ACME, "Acme");
    await pick("globex", "Globex");
    await go(NOWHERE, "Globex");
    await pick("acme", "Acme");
    await go(ON_ACME, "Acme");
    await go(ON_GLOBEX, "Globex");
    await pick("acme", "Acme");
    await go(ON_ACME, "Acme");
    await pick("globex", "Globex");
    await go(ON_GLOBEX, "Globex");
    await pick(null, "All");
    await pick("globex", "Globex");

    expect(slot.inspection.navigateCalls).toEqual([
      { method: "toCompose" },
      { method: "toThread", threadId: "thr_acme" },
      { method: "toThread", threadId: "thr_acme" },
      { method: "toThread", threadId: "thr_globex" },
    ]);
  });

  it("never moves off a route it follows, a project page included, then lands this window's pick", async () => {
    const { slot, go, pick } = mountRoutes(await fakeBackend(SEED), NOWHERE);
    await slot.findByText("active: All");

    await go(ON_GLOBEX, "Globex");
    await go(ON_ACME, "Acme");
    await go({ threadId: null, projectId: "proj_globex" }, "Globex");
    await go({ threadId: null, projectId: "proj_acme" }, "Acme");
    await go({ threadId: null, projectId: "proj_new" }, "All");
    expect(slot.inspection.navigateCalls).toEqual([]);

    await pick("globex", "Globex");
    expect(slot.inspection.navigateCalls).toEqual([{ method: "toThread", threadId: "thr_globex" }]);
  });

  it("stays when another window switches workspaces, and lands when this window picks the same one", async () => {
    const backend = await fakeBackend(SEED);
    const { slot, go, pick } = mountRoutes(backend, ON_GLOBEX);
    await slot.findByText("active: Globex");
    await go(ON_ACME, "Acme");

    await backend.harness.behavior.callRpc("selection_set", { id: "globex" });
    await slot.behavior.emitRealtime("workspaces-changed", { kind: "selection", selectedWorkspaceId: "globex" });
    expect(await slot.findByText("active: Globex")).toBeTruthy();
    expect(slot.inspection.navigateCalls).toEqual([]);

    await pick("globex", "Globex");
    expect(slot.inspection.navigateCalls).toEqual([{ method: "toThread", threadId: "thr_globex" }]);
  });

  it("falls back to the new-thread screen when the last thread was archived", async () => {
    const { slot, go, pick } = mountRoutes(await fakeBackend(SEED), { threadId: "thr_archived", projectId: "proj_globex" });
    await slot.findByText("active: Globex");
    await go(ON_ACME, "Acme");

    await pick("globex", "Globex");
    expect(slot.inspection.navigateCalls).toEqual([{ method: "toCompose" }]);
  });

  it("falls back once the last thread's project is filed in another workspace", async () => {
    const backend = await fakeBackend(SEED);
    const { slot, go, pick } = mountRoutes(backend, ON_ACME);
    await slot.findByText("active: Acme");
    await go(ON_GLOBEX, "Globex");
    await pick("acme", "Acme");
    await go(ON_ACME, "Acme");
    await go(ON_GLOBEX, "Globex");

    await backend.harness.behavior.runCli(["assign", "proj_acme", "globex"]);
    await slot.behavior.emitRealtime("workspaces-changed", null);
    expect(await slot.findByText("hidden: proj_new, proj_personal")).toBeTruthy();
    await pick("acme", "Acme");

    expect(slot.inspection.navigateCalls).toEqual([
      { method: "toThread", threadId: "thr_acme" },
      { method: "toCompose" },
    ]);
  });

  it.each([
    { name: "a stored thread", stored: JSON.stringify([["acme", "thr_acme"]]), expected: [{ method: "toThread", threadId: "thr_acme" }] },
    { name: "text that isn't JSON", stored: "{acme: thr_acme", expected: [{ method: "toCompose" }] },
    { name: "an object instead of pairs", stored: JSON.stringify({ acme: "thr_acme" }), expected: [{ method: "toCompose" }] },
    { name: "an id BB can't have made", stored: JSON.stringify([["acme", "thr acme"]]), expected: [{ method: "toCompose" }] },
  ])("reads the memory an earlier session left: $name", async ({ stored, expected }) => {
    localStorage.setItem("workspaces:last-threads", stored);
    const { slot, pick } = mountRoutes(await fakeBackend(SEED), ON_GLOBEX);
    await slot.findByText("active: Globex");

    await pick("acme", "Acme");
    expect(slot.inspection.navigateCalls).toEqual(expected);
  });
});
