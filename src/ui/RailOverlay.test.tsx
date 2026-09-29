// @vitest-environment jsdom
import { renderSlot, type RenderSlotOptions } from "@get-bb/plugin-sdk/testing/app";
import { act, fireEvent, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mountBbCompactLayout, mountBbDesktopLayout, threadRow } from "../../test/bb-layout";
import { PROJECTS, fakeBackend, type FakeRpc } from "../../test/fake-backend";
import "../../test/ui-lifecycle";
import { pickWorkspace } from "../client";
import { FILTER_WARNING_ATTR } from "../shell-css";
import { WorkspaceIdSchema } from "../domain";
import { RailOverlay } from "./RailOverlay";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const SEED = [
  { id: "acme", name: "Acme", projectIds: ["proj_acme"] },
  { id: "globex", name: "Globex", color: "#0d9488", projectIds: ["proj_globex"] },
];

function mountRail(rpc: Partial<FakeRpc>, context?: RenderSlotOptions["context"]) {
  const slot = renderSlot({ component: RailOverlay }, {}, { rpc, sidebarThreads: { projects: PROJECTS }, context });
  const rail = () => within(slot.getByRole("navigation", { name: "Workspaces" }));
  const stylesheet = () => slot.container.querySelector("style")?.textContent ?? "";
  return { slot, rail, stylesheet };
}

const menuItems = (menu: HTMLElement) =>
  within(menu)
    .getAllByRole("menuitem")
    .map((item) => `${item.textContent}${item.getAttribute("aria-disabled") === "true" ? " (disabled)" : ""}`);

let unmountLayout = () => {};

beforeEach(() => {
  unmountLayout = mountBbDesktopLayout();
});

afterEach(() => {
  unmountLayout();
});

describe("the rail", () => {
  it("shows skeletons while loading and keeps BB's full list", () => {
    const { rail, stylesheet } = mountRail({ workspaces_get: () => new Promise(() => {}) });
    expect(rail().getByRole("status", { name: "Loading workspaces" })).toBeTruthy();
    expect(stylesheet()).not.toMatch(/data-sidebar-visibility-group="|data-sidebar-thread-id="/);
  });

  it("offers a retry when the workspaces don't load, then shows them", async () => {
    const backend = await fakeBackend(SEED);
    let failNext = true;
    const { rail } = mountRail({
      ...backend.rpc,
      workspaces_get: (input) => {
        if (failNext) {
          failNext = false;
          throw new Error("database is locked");
        }
        return backend.rpc.workspaces_get(input);
      },
    });
    fireEvent.click(await rail().findByRole("button", { name: "Workspaces didn't load. Retry" }));
    expect(await rail().findByRole("button", { name: "Acme" })).toBeTruthy();
  });

  it("with no workspaces offers only All and the + tile", async () => {
    const backend = await fakeBackend();
    const { rail } = mountRail(backend.rpc);
    await rail().findByRole("button", { name: "New workspace" });
    expect(rail().getAllByRole("button").map((button) => button.getAttribute("aria-label"))).toEqual([
      "All workspaces",
      "New workspace",
    ]);
  });

  it("lists workspaces in rail order and filters BB's list to the picked one", async () => {
    const backend = await fakeBackend(SEED);
    const { rail, stylesheet } = mountRail(backend.rpc);
    const acme = await rail().findByRole("button", { name: "Acme" });
    expect(rail().getAllByRole("button").map((button) => button.getAttribute("aria-label"))).toEqual([
      "All workspaces",
      "Acme",
      "Globex",
      "New workspace",
    ]);
    fireEvent.click(acme);
    await vi.waitFor(() => expect(acme.getAttribute("aria-pressed")).toBe("true"));
    expect(rail().getByRole("button", { name: "All workspaces" }).getAttribute("aria-pressed")).toBe("false");
    for (const hidden of ["proj_globex", "proj_new"]) {
      expect(stylesheet()).toContain(`[data-sidebar-visibility-group="project:${hidden}"]`);
    }
    expect(stylesheet()).toContain('[data-sidebar-visibility-group="threads"]');
    expect(stylesheet()).not.toContain('"project:proj_acme"');
  });

  it("names each tile's default chord in its tooltip and aria-keyshortcuts", async () => {
    const backend = await fakeBackend(SEED);
    const { slot, rail } = mountRail(backend.rpc);
    const globex = await rail().findByRole("button", { name: "Globex" });
    expect(rail().getAllByRole("button").map((button) => button.getAttribute("aria-keyshortcuts"))).toEqual([
      "Control+Alt+1",
      "Control+Alt+2",
      "Control+Alt+3",
      null,
    ]);
    await userEvent.hover(globex);
    expect((await slot.findByRole("tooltip")).textContent).toBe("Globex · 1 project · right-click for actions · Ctrl+Alt+3");
  });

  it("shows the filter warning on the selected tile only while BB's list lacks the filter hooks", async () => {
    const backend = await fakeBackend(SEED);
    const { rail } = mountRail(backend.rpc);
    const acme = await rail().findByRole("button", { name: "Acme" });
    fireEvent.click(acme);
    await vi.waitFor(() => expect(acme.getAttribute("aria-pressed")).toBe("true"));
    const warning = acme.querySelector(`[${FILTER_WARNING_ATTR}]`);
    expect(warning).not.toBeNull();
    expect(warning && getComputedStyle(warning).display).not.toBe("none");
    expect(rail().getByRole("button", { name: "Globex" }).querySelector(`[${FILTER_WARNING_ATTR}]`)).toBeNull();

    const group = document.createElement("div");
    group.setAttribute("data-sidebar-visibility-group", "project:proj_acme");
    document.body.append(group);
    expect(warning && getComputedStyle(warning).display).toBe("none");
    group.remove();
  });

  it("takes the groups it hides out of BB's thread shortcuts, marks remounted rows, and leaves no mark after unmount", async () => {
    const group = (key: string) => `<div data-sidebar-visibility-group="${key}">${threadRow(`thr_${key.replace(/\W/g, "_")}`)}</div>`;
    const panel = document.querySelector('[data-sidebar="panel"]');
    panel?.insertAdjacentHTML("beforeend", ["project:proj_acme", "project:proj_globex", "threads"].map(group).join(""));
    const flagged = () =>
      [...document.querySelectorAll('[data-sidebar-overflow="true"][data-bb-workspaces-overflow]')].map((element) =>
        element.getAttribute("data-sidebar-visibility-group"),
      );
    const backend = await fakeBackend(SEED);
    const { slot, rail } = mountRail(backend.rpc);
    fireEvent.click(await rail().findByRole("button", { name: "Acme" }));
    await vi.waitFor(() => expect(flagged()).toEqual(["project:proj_globex", "threads"]));

    act(() => {
      panel?.querySelector('[data-sidebar-visibility-group="project:proj_globex"]')?.remove();
      panel?.insertAdjacentHTML("afterbegin", group("project:proj_globex"));
    });
    await vi.waitFor(() => expect(flagged()).toEqual(["project:proj_globex", "threads"]));

    fireEvent.click(rail().getByRole("button", { name: "Globex" }));
    await vi.waitFor(() => expect(flagged()).toEqual(["project:proj_acme", "threads"]));

    slot.unmount();
    expect(document.querySelectorAll("[data-sidebar-overflow], [data-bb-workspaces-overflow]")).toHaveLength(0);
  });

  it("hides the rail but keeps filtering where BB has no desktop sidebar (compact)", async () => {
    unmountLayout();
    const backend = await fakeBackend(SEED);
    const { slot, stylesheet } = mountRail(backend.rpc);
    act(() => pickWorkspace({ kind: "workspace", id: WorkspaceIdSchema.parse("acme") }));
    await vi.waitFor(() => expect(stylesheet()).toContain('"project:proj_globex"'));
    expect(slot.queryByRole("navigation", { name: "Workspaces" })).toBeNull();
  });

  it("puts the rail inside BB's compact shelf, makes room for it there, and follows a remounted panel", async () => {
    unmountLayout();
    const compact = mountBbCompactLayout();
    unmountLayout = compact.unmount;
    const backend = await fakeBackend(SEED);
    const { slot } = mountRail(backend.rpc);
    const shelfRail = () => {
      const nav = document.querySelector('[data-sidebar="panel"] > nav');
      if (!(nav instanceof HTMLElement)) throw new Error("no rail inside the shelf panel");
      return within(nav);
    };
    expect(await shelfRail().findByRole("button", { name: "Acme" })).toBeTruthy();
    const padding = () => {
      const panel = document.querySelector('[data-sidebar="panel"]');
      return panel && getComputedStyle(panel).paddingLeft;
    };
    expect(padding()).toBe("var(--bb-workspaces-rail-width)");
    expect(slot.getAllByRole("navigation", { name: "Workspaces" }).map((nav) => nav.parentElement?.getAttribute("data-sidebar"))).toEqual([
      "panel",
    ]);

    act(() => compact.remountPanel());
    await vi.waitFor(() => expect(document.querySelector('[data-sidebar="panel"] > nav')).not.toBeNull());
    expect(await shelfRail().findByRole("button", { name: "Globex" })).toBeTruthy();
    expect(padding()).toBe("var(--bb-workspaces-rail-width)");
    compact.unmount();
    await vi.waitFor(() => expect(document.querySelector('[data-sidebar="panel"] > nav')).toBeNull());
  });

  it("carries the plugin's CSS scope on the shelf rail, which lives outside the plugin root", async () => {
    unmountLayout();
    const compact = mountBbCompactLayout();
    unmountLayout = compact.unmount;
    const backend = await fakeBackend(SEED);
    mountRail(backend.rpc);
    const nav = await vi.waitFor(() => {
      const nav = document.querySelector('[data-sidebar="panel"] > nav');
      if (nav === null) throw new Error("no rail inside the shelf panel");
      return nav;
    });
    expect(nav.closest("[data-bb-plugin-root]")).not.toBeNull();
  });

  it("keeps BB's shelf untouched when there is no compact panel", async () => {
    const backend = await fakeBackend(SEED);
    const { rail } = mountRail(backend.rpc);
    await rail().findByRole("button", { name: "Acme" });
    expect(document.querySelectorAll('[data-sidebar="panel"] > nav')).toHaveLength(0);
  });

  it("gives touch no tooltips, so a tap goes straight to the tile", async () => {
    const matchMedia = window.matchMedia;
    window.matchMedia = (media: string) => ({ ...matchMedia(media), matches: media === "(pointer: coarse)" });
    try {
      const backend = await fakeBackend(SEED);
      const { slot, rail } = mountRail(backend.rpc);
      const globex = await rail().findByRole("button", { name: "Globex" });
      await userEvent.hover(globex);
      await new Promise((resolve) => setTimeout(resolve, 500));
      expect(slot.queryByRole("tooltip")).toBeNull();
      fireEvent.click(globex);
      await vi.waitFor(() => expect(globex.getAttribute("aria-pressed")).toBe("true"));
      expect(slot.queryByRole("tooltip")).toBeNull();
    } finally {
      window.matchMedia = matchMedia;
    }
  });

  it("opens a tile's actions only from its context menu, then moves and deletes from there", async () => {
    const backend = await fakeBackend(SEED);
    const { slot, rail } = mountRail(backend.rpc);
    const acme = await rail().findByRole("button", { name: "Acme" });
    fireEvent.click(acme);
    await vi.waitFor(() => expect(acme.getAttribute("aria-pressed")).toBe("true"));
    fireEvent.click(acme);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(slot.queryByRole("menu")).toBeNull();

    fireEvent.contextMenu(acme);
    expect(menuItems(await slot.findByRole("menu"))).toEqual(["Edit…", "Move up (disabled)", "Move down", "Delete…"]);
    fireEvent.click(slot.getByRole("menuitem", { name: "Move down" }));
    await vi.waitFor(() =>
      expect(rail().getAllByRole("button").map((button) => button.getAttribute("aria-label"))).toEqual([
        "All workspaces",
        "Globex",
        "Acme",
        "New workspace",
      ]),
    );

    fireEvent.contextMenu(rail().getByRole("button", { name: "Acme" }));
    fireEvent.click(await slot.findByRole("menuitem", { name: "Delete…" }));
    const dialog = await slot.findByRole("alertdialog", { name: "Delete Acme?" });
    expect(within(dialog).getByText("Its project stays in BB, unfiled, and shows under All workspaces.")).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete workspace" }));
    await vi.waitFor(() => expect(rail().queryByRole("button", { name: "Acme" })).toBeNull());
    expect(slot.queryByRole("alertdialog")).toBeNull();
    expect(await backend.harness.behavior.callRpc("workspaces_get", null)).toEqual({
      workspaces: [{ id: "globex", name: "Globex", initials: null, color: "#0d9488", image: null }],
      memberships: [{ projectId: "proj_globex", workspaceId: "globex" }],
      selectedWorkspaceId: null,
    });
  });

  it("opens the focused tile's actions with Shift+F10 and runs one from the keyboard", async () => {
    const backend = await fakeBackend(SEED);
    const { slot, rail } = mountRail(backend.rpc);
    const globex = await rail().findByRole("button", { name: "Globex" });
    globex.focus();
    await userEvent.keyboard("{Shift>}{F10}{/Shift}");
    expect(menuItems(await slot.findByRole("menu"))).toEqual(["Edit…", "Move up", "Move down (disabled)", "Delete…"]);
    await userEvent.keyboard("{ArrowDown}");
    expect(document.activeElement?.textContent).toBe("Move up");
    await userEvent.keyboard("{Enter}");
    await vi.waitFor(() =>
      expect(rail().getAllByRole("button").map((button) => button.getAttribute("aria-label"))).toEqual([
        "All workspaces",
        "Globex",
        "Acme",
        "New workspace",
      ]),
    );
    expect(document.activeElement).toBe(rail().getByRole("button", { name: "Globex" }));
  });
});

describe("switching away from the chat on screen", () => {
  const ON_ACME_THREAD = { projectId: "proj_acme", threadId: "thr_acme" };
  const pressed = (tile: HTMLElement) => vi.waitFor(() => expect(tile.getAttribute("aria-pressed")).toBe("true"));

  it("follows the chat's workspace on load, stays for that workspace and All, and leaves for another workspace", async () => {
    const backend = await fakeBackend(SEED);
    const { slot, rail } = mountRail(backend.rpc, ON_ACME_THREAD);
    const acme = await rail().findByRole("button", { name: "Acme" });
    await pressed(acme);
    fireEvent.click(rail().getByRole("button", { name: "All workspaces" }));
    await pressed(rail().getByRole("button", { name: "All workspaces" }));
    fireEvent.click(acme);
    await pressed(acme);
    expect(slot.inspection.navigateCalls).toEqual([]);

    fireEvent.click(rail().getByRole("button", { name: "Globex" }));
    await pressed(rail().getByRole("button", { name: "Globex" }));
    expect(slot.inspection.navigateCalls).toEqual([{ method: "toCompose" }]);
  });

  it("stays when another window switches workspaces, and leaves when this window picks the same one", async () => {
    const backend = await fakeBackend(SEED);
    const { slot, rail } = mountRail(backend.rpc, ON_ACME_THREAD);
    await pressed(await rail().findByRole("button", { name: "Acme" }));
    await backend.harness.behavior.callRpc("selection_set", { id: "globex" });
    await slot.behavior.emitRealtime("workspaces-changed", { kind: "selection", selectedWorkspaceId: "globex" });
    await pressed(rail().getByRole("button", { name: "Globex" }));
    expect(slot.inspection.navigateCalls).toEqual([]);

    act(() => pickWorkspace({ kind: "workspace", id: WorkspaceIdSchema.parse("globex") }));
    expect(slot.inspection.navigateCalls).toEqual([{ method: "toCompose" }]);
  });
});
