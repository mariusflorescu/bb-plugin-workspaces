// @vitest-environment jsdom
import { renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { PROJECTS, fakeBackend } from "../../test/fake-backend";
import "../../test/ui-lifecycle";
import { useEditorTarget } from "../client";
import { SwitcherDisclosure } from "./SwitcherDisclosure";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

function EditorKind() {
  const target = useEditorTarget();
  return <output aria-label="Open editor">{target?.kind ?? "none"}</output>;
}

function Switcher(props: { readonly dismiss: () => void }) {
  return (
    <>
      <SwitcherDisclosure {...props} />
      <EditorKind />
    </>
  );
}



describe("the footer switcher", () => {
  it("invites the first workspace when there are none", async () => {
    const backend = await fakeBackend();
    const dismiss = vi.fn();
    const user = userEvent.setup();
    const slot = renderSlot({ component: Switcher }, { dismiss }, { rpc: backend.rpc, sidebarThreads: { projects: PROJECTS } });
    expect(await slot.findByText("No workspaces yet")).toBeTruthy();
    await user.click(slot.getByRole("button", { name: "New workspace" }));
    expect(slot.getByRole("status", { name: "Open editor" }).textContent).toBe("create");
    expect(dismiss.mock.calls).toEqual([[]]);
  });

  it("switches every window to the picked workspace and closes", async () => {
    const backend = await fakeBackend([
      { id: "acme", name: "Acme", projectIds: ["proj_acme"] },
      { id: "globex", name: "Globex", projectIds: ["proj_globex", "proj_new"] },
    ]);
    const dismiss = vi.fn();
    const user = userEvent.setup();
    const slot = renderSlot({ component: Switcher }, { dismiss }, { rpc: backend.rpc, sidebarThreads: { projects: PROJECTS } });
    const list = within(await slot.findByRole("list", { name: "Workspaces" }));
    expect(list.getByRole("button", { name: "All workspaces", pressed: true })).toBeTruthy();
    expect(list.getByRole("button", { name: /^Acme\s*1 project$/, pressed: false })).toBeTruthy();
    expect(list.getByRole("button", { name: "Edit Acme" })).toBeTruthy();
    await user.click(list.getByRole("button", { name: /^Globex\s*2 projects$/ }));
    expect(dismiss.mock.calls).toEqual([[]]);
    await vi.waitFor(async () =>
      expect(await backend.harness.behavior.callRpc("workspaces_get", null)).toMatchObject({ selectedWorkspaceId: "globex" }),
    );
  });
});
