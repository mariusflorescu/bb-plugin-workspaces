// @vitest-environment jsdom
import { renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { toast } from "sonner";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mountBbDesktopLayout } from "../../test/bb-layout";
import { PROJECTS, fakeBackend, type FakeRpc } from "../../test/fake-backend";
import "../../test/ui-lifecycle";
import { RailOverlay } from "./RailOverlay";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const SEED = [{ id: "globex", name: "Globex", color: "#0d9488", projectIds: ["proj_globex"] }];

async function openNewWorkspace(rpc: FakeRpc) {
  const user = userEvent.setup();
  const slot = renderSlot({ component: RailOverlay }, {}, { rpc, sidebarThreads: { projects: PROJECTS } });
  const rail = within(slot.getByRole("navigation", { name: "Workspaces" }));
  await user.click(await rail.findByRole("button", { name: "New workspace" }));
  const dialog = within(await slot.findByRole("dialog", { name: "New workspace" }));
  return { user, slot, rail, dialog };
}

let unmountLayout = () => {};

beforeEach(() => {
  unmountLayout = mountBbDesktopLayout();
  vi.mocked(toast.success).mockClear();
  vi.mocked(toast.error).mockClear();
});

afterEach(() => {
  unmountLayout();
});

describe("the workspace editor", () => {
  it("explains what's wrong with each field", async () => {
    const backend = await fakeBackend(SEED);
    const signalsBefore = backend.harness.inspection.realtimeSignals.length;
    const { user, dialog } = await openNewWorkspace(backend.rpc);
    await user.click(dialog.getByRole("button", { name: "Create workspace" }));
    expect(await dialog.findByText("Give the workspace a name")).toBeTruthy();
    await user.type(dialog.getByLabelText("Initials"), "ABCD");
    await user.click(dialog.getByRole("button", { name: "Create workspace" }));
    expect(await dialog.findByText("Use at most 3 characters")).toBeTruthy();
    expect(backend.harness.inspection.realtimeSignals).toHaveLength(signalsBefore);
  });

  it("derives the initials from the name until the user types their own", async () => {
    const backend = await fakeBackend(SEED);
    const { user, dialog } = await openNewWorkspace(backend.rpc);
    await user.type(dialog.getByLabelText("Name"), "Acme Corp");
    expect(dialog.getByLabelText("Initials").getAttribute("placeholder")).toBe("AC");
  });

  it("keeps the dialog and the input when the save fails, and says why in the dialog", async () => {
    const backend = await fakeBackend(SEED);
    const { user, slot, dialog } = await openNewWorkspace({
      ...backend.rpc,
      workspace_save: () => {
        throw new Error("fetch failed");
      },
    });
    await user.type(dialog.getByLabelText("Name"), "Initech");
    await user.click(dialog.getByRole("button", { name: "Create workspace" }));
    expect(await dialog.findByText("Couldn't save the workspace. Check that BB is reachable and try again.")).toBeTruthy();
    expect(vi.mocked(toast.error).mock.calls).toEqual([]);
    expect(slot.getByRole("dialog", { name: "New workspace" })).toBeTruthy();
    expect(dialog.getByLabelText<HTMLInputElement>("Name").value).toBe("Initech");
  });

  it("saves, toasts, closes, selects the new workspace and moves checked projects into it", async () => {
    const backend = await fakeBackend(SEED);
    const { user, slot, rail, dialog } = await openNewWorkspace(backend.rpc);
    await user.type(dialog.getByLabelText("Name"), "Acme");
    await user.click(dialog.getByRole("checkbox", { name: /web-app/ }));
    await user.click(dialog.getByRole("checkbox", { name: /api/ }));
    expect(dialog.getByText("moves from Globex")).toBeTruthy();
    await user.click(dialog.getByRole("button", { name: "Create workspace" }));

    const tile = await rail.findByRole("button", { name: "Acme" });
    await vi.waitFor(() => expect(tile.getAttribute("aria-pressed")).toBe("true"));
    expect(slot.queryByRole("dialog")).toBeNull();
    expect(vi.mocked(toast.success).mock.calls).toEqual([["Saved Acme"]]);
    const doc = await backend.harness.behavior.callRpc("workspaces_get", null);
    expect(doc).toMatchObject({
      memberships: [
        { projectId: "proj_acme", workspaceId: expect.not.stringMatching(/^globex$/) },
        { projectId: "proj_globex", workspaceId: expect.not.stringMatching(/^globex$/) },
      ],
    });
  });

  it("closes the edit dialog when another window deletes the workspace", async () => {
    const backend = await fakeBackend(SEED);
    const user = userEvent.setup();
    const slot = renderSlot({ component: RailOverlay }, {}, { rpc: backend.rpc, sidebarThreads: { projects: PROJECTS } });
    const rail = within(slot.getByRole("navigation", { name: "Workspaces" }));
    await user.pointer({ keys: "[MouseRight]", target: await rail.findByRole("button", { name: "Globex" }) });
    await user.click(await slot.findByRole("menuitem", { name: "Edit…" }));
    await slot.findByRole("dialog", { name: "Edit Globex" });
    await backend.harness.behavior.callRpc("workspace_delete", { id: "globex" });
    await slot.behavior.emitRealtime("workspaces-changed", null);
    await vi.waitFor(() => expect(slot.queryByRole("dialog")).toBeNull());
  });

  it("offers Delete from the edit dialog, which touch can reach without the context menu", async () => {
    const backend = await fakeBackend(SEED);
    const user = userEvent.setup();
    const slot = renderSlot({ component: RailOverlay }, {}, { rpc: backend.rpc, sidebarThreads: { projects: PROJECTS } });
    const rail = within(slot.getByRole("navigation", { name: "Workspaces" }));
    await user.pointer({ keys: "[MouseRight]", target: await rail.findByRole("button", { name: "Globex" }) });
    await user.click(await slot.findByRole("menuitem", { name: "Edit…" }));
    const dialog = within(await slot.findByRole("dialog", { name: "Edit Globex" }));
    await user.click(dialog.getByRole("button", { name: "Delete…" }));
    expect(await slot.findByRole("alertdialog", { name: "Delete Globex?" })).toBeTruthy();
    expect(slot.queryByRole("dialog", { name: "Edit Globex" })).toBeNull();
  });

  it("edits an existing workspace with its current values", async () => {
    const backend = await fakeBackend(SEED);
    const user = userEvent.setup();
    const slot = renderSlot({ component: RailOverlay }, {}, { rpc: backend.rpc, sidebarThreads: { projects: PROJECTS } });
    const rail = within(slot.getByRole("navigation", { name: "Workspaces" }));
    await user.pointer({ keys: "[MouseRight]", target: await rail.findByRole("button", { name: "Globex" }) });
    await user.click(await slot.findByRole("menuitem", { name: "Edit…" }));
    const dialog = within(await slot.findByRole("dialog", { name: "Edit Globex" }));
    expect(dialog.getByLabelText<HTMLInputElement>("Name").value).toBe("Globex");
    expect(dialog.getByRole("checkbox", { name: /api/ }).getAttribute("aria-checked")).toBe("true");
    await user.type(dialog.getByLabelText("Initials"), "GL!");
    await user.click(dialog.getByRole("button", { name: "Save" }));
    await vi.waitFor(() => expect(slot.queryByRole("dialog")).toBeNull());
    expect(await backend.harness.behavior.callRpc("workspaces_get", null)).toEqual({
      workspaces: [{ id: "globex", name: "Globex", initials: "GL!", color: "#0d9488", image: null }],
      memberships: [{ projectId: "proj_globex", workspaceId: "globex" }],
      selectedWorkspaceId: null,
    });
  });
});
