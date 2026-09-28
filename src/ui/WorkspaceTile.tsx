import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { Icon } from "@/components/ui/icon";
import { openEditor, useMoveWorkspace } from "../client";
import type { WorkspaceEntry } from "../domain";
import { FILTER_WARNING_ATTR } from "../shell-css";
import type { ShortcutHint } from "../shortcuts";
import { projectCount } from "./format";
import { RailTileButton } from "./RailTileButton";
import { WorkspaceAvatar } from "./WorkspaceAvatar";

export function WorkspaceTile({
  entry,
  active,
  filtering,
  first,
  last,
  shortcut,
  onSelect,
}: {
  readonly entry: WorkspaceEntry;
  readonly active: boolean;
  /** This workspace is selected and hides something, so the filter warning may apply. */
  readonly filtering: boolean;
  readonly first: boolean;
  readonly last: boolean;
  readonly shortcut: ShortcutHint | null;
  readonly onSelect: () => void;
}) {
  const move = useMoveWorkspace();
  const { workspace, projects } = entry;

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <RailTileButton
          label={workspace.name}
          tooltip={
            <>
              {workspace.name} · {projectCount(projects.length)} · right-click for actions
              {filtering ? <span {...{ [FILTER_WARNING_ATTR]: "" }}> · BB's sidebar changed, so every project is shown</span> : null}
            </>
          }
          shortcut={shortcut}
          active={active}
          onClick={active ? undefined : onSelect}
          onKeyDown={(event) => {
            if (!event.shiftKey || event.key !== "F10") return;
            // Chromium on macOS never turns Shift+F10 into contextmenu; elsewhere preventDefault stops its own.
            event.preventDefault();
            const { right, top } = event.currentTarget.getBoundingClientRect();
            event.currentTarget.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, clientX: right, clientY: top }));
          }}
        >
          <WorkspaceAvatar workspace={workspace} size="rail" className={active ? "rounded-xl" : undefined} />
          {filtering ? (
            <span
              {...{ [FILTER_WARNING_ATTR]: "" }}
              aria-hidden="true"
              className="absolute -bottom-1 -right-1 flex size-4 items-center justify-center rounded-full bg-sidebar text-destructive"
            >
              <Icon name="AlertTriangle" className="size-3" />
            </span>
          ) : null}
        </RailTileButton>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem onSelect={() => openEditor({ kind: "edit", id: workspace.id })}>
          <Icon name="Edit" />
          Edit…
        </ContextMenuItem>
        <ContextMenuItem disabled={first} onSelect={() => move.mutate({ id: workspace.id, delta: -1 })}>
          <Icon name="ArrowUp" />
          Move up
        </ContextMenuItem>
        <ContextMenuItem disabled={last} onSelect={() => move.mutate({ id: workspace.id, delta: 1 })}>
          <Icon name="ArrowDown" />
          Move down
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem className="text-destructive" onSelect={() => openEditor({ kind: "delete", id: workspace.id })}>
          <Icon name="Trash2" />
          Delete…
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}
