import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import type { PluginSidebarProject } from "@get-bb/plugin-sdk/app";
import plugin from "../server";

export const PROJECTS: readonly PluginSidebarProject[] = [
  sidebarProject("proj_acme", "web-app"),
  sidebarProject("proj_globex", "api"),
  sidebarProject("proj_new", "fresh-project"),
  sidebarProject("proj_personal", "Personal", true),
];

function sidebarProject(id: string, name: string, isPersonal = false): PluginSidebarProject {
  return { id, name, isPersonal, href: `/projects/${id}`, settingsHref: `/projects/${id}/settings` };
}

interface SeedWorkspace {
  readonly id: string;
  readonly name: string;
  readonly initials?: string | null;
  readonly color?: string;
  readonly image?: string | null;
  readonly projectIds?: readonly string[];
}

export async function fakeBackend(seed: readonly SeedWorkspace[] = []) {
  const { bb, harness } = createFakePluginHost({
    pluginId: "workspaces",
    sdk: { projects: { list: async () => PROJECTS.map((p) => ({ id: p.id, name: p.name, kind: p.isPersonal ? "personal" : "standard" })) } },
  });
  await plugin(bb);
  const call = (method: string) => (input: Parameters<typeof harness.behavior.callRpc>[1]) =>
    harness.behavior.callRpc(method, input);
  for (const workspace of seed) {
    await harness.behavior.callRpc("workspace_save", {
      initials: null,
      color: "#7c3aed",
      image: null,
      projectIds: [],
      select: false,
      ...workspace,
    });
  }
  if (seed.length > 0) await harness.behavior.callRpc("selection_set", { id: null });
  return {
    harness,
    rpc: {
      workspaces_get: call("workspaces_get"),
      workspace_save: call("workspace_save"),
      workspace_delete: call("workspace_delete"),
      workspaces_reorder: call("workspaces_reorder"),
      selection_set: call("selection_set"),
    },
  };
}

export type FakeRpc = Awaited<ReturnType<typeof fakeBackend>>["rpc"];
