import { definePluginApp } from "@get-bb/plugin-sdk/app";
import { canStep, hasTile, openCreateEditor, selectTile, selectWorkspace, stepWorkspace } from "./src/client";
import { ALL, NUMBERED_TILES } from "./src/domain";
import { tileShortcut } from "./src/shortcuts";
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
    defaultShortcut: { key: "ArrowDown", mod: true, alt: true },
    isAvailable: canStep,
    run: () => stepWorkspace(1),
  });
  app.commands.register({
    id: "previous-workspace",
    title: "Workspaces: Previous workspace",
    defaultShortcut: { key: "ArrowUp", mod: true, alt: true },
    isAvailable: canStep,
    run: () => stepWorkspace(-1),
  });
  app.commands.register({
    id: "all-workspaces",
    title: "Workspaces: Show all workspaces",
    defaultShortcut: tileShortcut(1),
    run: () => selectWorkspace(ALL),
  });
  for (const tile of NUMBERED_TILES.slice(1)) {
    app.commands.register({
      id: `switch-to-tile-${tile}`,
      title: `Workspaces: Switch to tile ${tile}`,
      defaultShortcut: tileShortcut(tile),
      isAvailable: () => hasTile(tile),
      run: () => selectTile(tile),
    });
  }
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
