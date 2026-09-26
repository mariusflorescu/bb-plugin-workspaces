import { Fragment, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { Icon } from "@/components/ui/icon";
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { openEditor, useMoveWorkspace } from "../client";
import type { WorkspaceEntry } from "../domain";
import { FILTER_WARNING_ATTR } from "../shell-css";
import { projectCount } from "./format";
import { RailTileButton } from "./RailTileButton";
import { WorkspaceAvatar } from "./WorkspaceAvatar";

/**
 * A tap on an unselected tile selects it; a tap on the selected tile opens its
 * actions, which is the touch path (iOS doesn't fire contextmenu reliably on
 * long-press). Right-click opens the same actions on desktop.
 */
export function WorkspaceTile({
  entry,
  active,
  filtering,
  first,
  last,
  onSelect,
}: {
  readonly entry: WorkspaceEntry;
  readonly active: boolean;
  /** This workspace is selected and hides something, so the filter warning may apply. */
  readonly filtering: boolean;
  readonly first: boolean;
  readonly last: boolean;
  readonly onSelect: () => void;
}) {
  const move = useMoveWorkspace();
  const [actionsOpen, setActionsOpen] = useState(false);
  const { workspace, projects } = entry;
  const actions = [
    { label: "Edit…", icon: "Edit", disabled: false, destructive: false, run: () => openEditor({ kind: "edit", id: workspace.id }) },
    { label: "Move up", icon: "ArrowUp", disabled: first, destructive: false, run: () => move.mutate({ id: workspace.id, delta: -1 }) },
    { label: "Move down", icon: "ArrowDown", disabled: last, destructive: false, run: () => move.mutate({ id: workspace.id, delta: 1 }) },
    { label: "Delete…", icon: "Trash2", disabled: false, destructive: true, run: () => openEditor({ kind: "delete", id: workspace.id }) },
  ] as const;

  return (
    <Popover open={actionsOpen} onOpenChange={setActionsOpen}>
      <ContextMenu>
        <PopoverAnchor asChild>
          <ContextMenuTrigger asChild>
            <RailTileButton
              label={workspace.name}
              tooltip={
                <>
                  {workspace.name} · {projectCount(projects.length)}
                  {active ? " · click again for actions" : null}
                  {filtering ? <span {...{ [FILTER_WARNING_ATTR]: "" }}> · BB's sidebar changed, so every project is shown</span> : null}
                </>
              }
              active={active}
              aria-haspopup={active ? "menu" : undefined}
              aria-expanded={active ? actionsOpen : undefined}
              onClick={() => (active ? setActionsOpen(true) : onSelect())}
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
        </PopoverAnchor>
        <ContextMenuContent>
          {actions.map((action) => (
            <Fragment key={action.label}>
              {action.destructive ? <ContextMenuSeparator /> : null}
              <ContextMenuItem
                disabled={action.disabled}
                className={action.destructive ? "text-destructive" : undefined}
                onSelect={action.run}
              >
                <Icon name={action.icon} />
                {action.label}
              </ContextMenuItem>
            </Fragment>
          ))}
        </ContextMenuContent>
      </ContextMenu>
      <PopoverContent side="right" align="start" className="w-48 p-1" mobileTitle={`${workspace.name} actions`}>
        <div role="menu" aria-label={`${workspace.name} actions`} className="flex flex-col gap-0.5">
          {actions.map((action) => (
            <Button
              key={action.label}
              type="button"
              role="menuitem"
              variant="ghost"
              disabled={action.disabled}
              className={cn("h-11 justify-start gap-3 px-3 md:h-8", action.destructive && "text-destructive")}
              onClick={() => {
                setActionsOpen(false);
                action.run();
              }}
            >
              <Icon name={action.icon} />
              {action.label}
            </Button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
