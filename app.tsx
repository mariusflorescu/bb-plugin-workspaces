import { definePluginApp } from "@get-bb/plugin-sdk/app";
import { canStep, openCreateEditor, selectWorkspace, stepWorkspace } from "./src/client";
import { ALL } from "./src/domain";
import { RailOverlay } from "./src/ui/RailOverlay";
import { SwitcherDisclosure } from "./src/ui/SwitcherDisclosure";

export default definePluginApp((app) => {
  app.slots.experimental_appOverlay({ id: "rail", component: RailOverlay });

  const switcher = app.experimental_sidebarFooter.register({
    kind: "disclosure",
    id: "switcher",
    label: "Workspaces",
    icon: "Layers",
    component: SwitcherDisclosure,
  });

  app.commands.register({
    id: "next-workspace",
    title: "Workspaces: Next workspace",
    isAvailable: canStep,
    run: () => stepWorkspace(1),
  });
  app.commands.register({
    id: "previous-workspace",
    title: "Workspaces: Previous workspace",
    isAvailable: canStep,
    run: () => stepWorkspace(-1),
  });
  app.commands.register({
    id: "all-workspaces",
    title: "Workspaces: Show all workspaces",
    run: () => selectWorkspace(ALL),
  });
  app.commands.register({
    id: "switch-workspace",
    title: "Workspaces: Switch workspace…",
    run: () => switcher.open(),
  });
  app.commands.register({
    id: "new-workspace",
    title: "Workspaces: New workspace…",
    run: openCreateEditor,
  });
});
