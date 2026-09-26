import { memo } from "react";
import { Icon } from "@/components/ui/icon";
import { Skeleton } from "@/components/ui/skeleton";
import { openCreateEditor, selectWorkspace, type BoardState } from "../client";
import { ALL, hidesAnything } from "../domain";
import { RAIL_ATTR, RAIL_WIDTH_PX, SHELF_RAIL_ATTR } from "../shell-css";
import { AddTile } from "./AddTile";
import { AllTile } from "./AllTile";
import { RailTileButton } from "./RailTileButton";
import { WorkspaceTile } from "./WorkspaceTile";

const PLACEMENT = {
  // The stylesheet owns this one's display, slide and the room BB makes for it.
  column: { attr: RAIL_ATTR, className: "fixed inset-y-0 left-0 z-[11] flex-col" },
  shelf: { attr: SHELF_RAIL_ATTR, className: "absolute inset-y-0 left-0 flex flex-col pt-[env(safe-area-inset-top)]" },
} as const;

export const WorkspaceRail = memo(function WorkspaceRail({
  state,
  placement,
}: {
  readonly state: BoardState;
  readonly placement: keyof typeof PLACEMENT;
}) {
  const board = state.status === "ready" ? state.board : null;
  const active = board?.active.kind === "workspace" ? board.active.entry.workspace.id : null;
  const { attr, className } = PLACEMENT[placement];
  return (
    <nav
      {...{ [attr]: "" }}
      aria-label="Workspaces"
      className={`${className} items-center border-r border-border bg-sidebar pb-3`}
      style={{ width: RAIL_WIDTH_PX }}
    >
      <div aria-hidden="true" className="h-(--bb-app-chrome-row-height) w-full shrink-0 [-webkit-app-region:drag]" />
      <AllTile
        active={active === null}
        unfiledCount={board?.unfiled.length ?? 0}
        onSelect={() => selectWorkspace(ALL)}
      />
      <div aria-hidden="true" className="my-2 h-px w-6 shrink-0 bg-border" />
      <ul className="flex min-h-0 w-full flex-1 flex-col items-center gap-2 overflow-y-auto py-0.5 [scrollbar-width:none]">
        {state.status === "loading" ? (
          <li role="status" aria-label="Loading workspaces" className="flex w-full flex-col items-center gap-2">
            {[0, 1, 2].map((index) => (
              <Skeleton key={index} className="size-9 rounded-lg" />
            ))}
          </li>
        ) : null}
        {state.status === "error" ? (
          <li className="flex w-full justify-center">
            <RailTileButton
              label="Workspaces didn't load. Retry"
              tooltip={`${state.message} Click to retry.`}
              className="bg-surface-selected text-destructive"
              onClick={state.retry}
            >
              <Icon name="AlertTriangle" className="size-4" />
            </RailTileButton>
          </li>
        ) : null}
        {board?.entries.map((entry, index) => (
          <li key={entry.workspace.id} className="w-full">
            <WorkspaceTile
              entry={entry}
              active={entry.workspace.id === active}
              filtering={entry.workspace.id === active && hidesAnything(state.mask)}
              first={index === 0}
              last={index === board.entries.length - 1}
              onSelect={() => selectWorkspace({ kind: "workspace", id: entry.workspace.id })}
            />
          </li>
        ))}
        {state.status === "error" ? null : (
          <li className="w-full">
            <AddTile firstWorkspace={board !== null && board.entries.length === 0} onAdd={openCreateEditor} />
          </li>
        )}
      </ul>
    </nav>
  );
});
