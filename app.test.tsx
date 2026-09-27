// @vitest-environment jsdom
import { collectPluginAppRegistrations } from "@get-bb/plugin-sdk/internal/plugin-app-collector";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { within } from "@testing-library/react";
import { expect, it, onTestFinished, vi } from "vitest";
import { mountBbDesktopLayout } from "./test/bb-layout";
import { PROJECTS, fakeBackend } from "./test/fake-backend";
import "./test/ui-lifecycle";
import { RailOverlay } from "./src/ui/RailOverlay";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

it("registers the rail overlay and the footer switcher under the host's rules", async () => {
  const app = await loadPluginApp(() => import("./app"));
  expect(app.appOverlays.map((overlay) => overlay.id)).toEqual(["rail"]);
  expect(app.experimentalSidebarFooterItems.map((item) => [item.kind, item.id, item.label, item.icon])).toEqual([
    ["disclosure", "switcher", "Workspaces", "Layers"],
  ]);
});

const chord = (key: string) => ({ key, mod: true, alt: true, meta: false, control: false, shift: false });

it("gives the palette commands BB-valid default chords: Mod+Alt+1-9 by rail tile, Mod+Alt+arrows to step", async () => {
  await loadPluginApp(() => import("./app"));
  const { commandPaletteActions } = collectPluginAppRegistrations((await import("./app")).default);
  expect(commandPaletteActions.map((command) => [command.id, command.title, command.defaultShortcut])).toEqual([
    ["next-workspace", "Workspaces: Next workspace", chord("ArrowDown")],
    ["previous-workspace", "Workspaces: Previous workspace", chord("ArrowUp")],
    ["all-workspaces", "Workspaces: Show all workspaces", chord("1")],
    ...[2, 3, 4, 5, 6, 7, 8, 9].map((tile) => [`switch-to-tile-${tile}`, `Workspaces: Switch to tile ${tile}`, chord(String(tile))]),
    ["switch-workspace", "Workspaces: Switch workspace…", null],
    ["new-workspace", "Workspaces: New workspace…", null],
  ]);
});

it("offers a tile's command only while that tile exists, and switches to it", async () => {
  await loadPluginApp(() => import("./app"));
  const { commandPaletteActions } = collectPluginAppRegistrations((await import("./app")).default);
  const context = { threadId: null, projectId: null, openPanel: () => false };
  const available = () =>
    commandPaletteActions.filter((command) => command.isAvailable?.(context) ?? true).map((command) => command.id);
  const command = (id: string) => {
    const found = commandPaletteActions.find((candidate) => candidate.id === id);
    if (found === undefined) throw new Error(`no command ${id}`);
    return found;
  };

  const unmountLayout = mountBbDesktopLayout();
  onTestFinished(unmountLayout);
  const backend = await fakeBackend([
    { id: "acme", name: "Acme", projectIds: ["proj_acme"] },
    { id: "globex", name: "Globex", projectIds: ["proj_globex"] },
  ]);
  const slot = renderSlot({ component: RailOverlay }, {}, { rpc: backend.rpc, sidebarThreads: { projects: PROJECTS } });
  const rail = within(slot.getByRole("navigation", { name: "Workspaces" }));
  const globex = await rail.findByRole("button", { name: "Globex" });
  expect(available()).toEqual([
    "next-workspace",
    "previous-workspace",
    "all-workspaces",
    "switch-to-tile-2",
    "switch-to-tile-3",
    "switch-workspace",
    "new-workspace",
  ]);

  await command("switch-to-tile-3").run(context);
  await vi.waitFor(() => expect(globex.getAttribute("aria-pressed")).toBe("true"));
  await command("all-workspaces").run(context);
  await vi.waitFor(() => expect(rail.getByRole("button", { name: "All workspaces" }).getAttribute("aria-pressed")).toBe("true"));
});
