// @vitest-environment jsdom
import { loadPluginApp } from "@get-bb/plugin-sdk/testing/app";
import { expect, it } from "vitest";

it("registers the rail overlay and the footer switcher under the host's rules", async () => {
  const app = await loadPluginApp(() => import("./app"));
  expect(app.appOverlays.map((overlay) => overlay.id)).toEqual(["rail"]);
  expect(app.experimentalSidebarFooterItems.map((item) => [item.kind, item.id, item.label, item.icon])).toEqual([
    ["disclosure", "switcher", "Workspaces", "Layers"],
  ]);
});
