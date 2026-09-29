import type { ExperimentalSidebarFooterDisclosureProps } from "@get-bb/plugin-sdk/app";
import { Button, buttonVariants } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";
import { openCreateEditor, openEditor, pickWorkspace, useBoard } from "../client";
import { ALL, hidesAnything, type Selection } from "../domain";
import { FILTER_WARNING_ATTR } from "../shell-css";
import { projectCount } from "./format";
import { LoadError } from "./LoadError";
import { SkeletonRows } from "./SkeletonRows";
import { WorkspaceAvatar } from "./WorkspaceAvatar";

const rowClass = cn(buttonVariants({ variant: "ghost", size: "sm" }), "w-full min-w-0 justify-start gap-2.5 px-2 font-normal");

export function SwitcherPanel({ dismiss }: ExperimentalSidebarFooterDisclosureProps) {
  const state = useBoard();
  const choose = (next: Selection) => {
    pickWorkspace(next);
    dismiss();
  };
  const create = () => {
    openCreateEditor();
    dismiss();
  };

  if (state.status === "loading") {
    return <SkeletonRows label="Loading workspaces" rowClassName="h-7 w-full" className="p-2" />;
  }
  if (state.status === "error") {
    return <LoadError message={state.message} retry={state.retry} className="p-2" />;
  }

  const { board } = state;
  const activeId = board.active.kind === "workspace" ? board.active.entry.workspace.id : null;
  if (board.entries.length === 0) {
    return (
      <div className="flex flex-col items-start gap-2 p-2 text-sm">
        <p className="font-medium">No workspaces yet</p>
        <p className="text-muted-foreground">Group your projects by client, then pick a workspace to see only its projects.</p>
        <Button type="button" size="sm" onClick={create}>
          <Icon name="Plus" />
          New workspace
        </Button>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-1 p-1">
      {activeId !== null && hidesAnything(state.mask) ? (
        <p
          {...{ [FILTER_WARNING_ATTR]: "" }}
          role="status"
          className="flex items-start gap-2 px-2 py-1.5 text-xs text-muted-foreground"
        >
          <Icon name="AlertTriangle" className="mt-0.5 size-3.5 shrink-0 text-destructive" />
          This BB version's sidebar isn't recognised, so it shows every project.
        </p>
      ) : null}
      <ul aria-label="Workspaces" className="flex flex-col">
        <li>
          <button type="button" aria-pressed={activeId === null} className={rowClass} onClick={() => choose(ALL)}>
            <span className="flex size-5 items-center justify-center rounded-[5px] bg-surface-selected">
              <Icon name="GridView" className="size-3" />
            </span>
            <span className="flex-1 truncate">All workspaces</span>
            {activeId === null ? <Icon name="Check" className="size-4" /> : null}
          </button>
        </li>
        {board.entries.map((entry) => {
          const active = entry.workspace.id === activeId;
          return (
            <li key={entry.workspace.id} className="group/row flex items-center">
              <button
                type="button"
                aria-pressed={active}
                className={rowClass}
                onClick={() => choose({ kind: "workspace", id: entry.workspace.id })}
              >
                <WorkspaceAvatar workspace={entry.workspace} size="row" />
                <span className="min-w-0 flex-1 truncate">{entry.workspace.name}</span>
                <span className="shrink-0 text-xs text-muted-foreground">{projectCount(entry.projects.length)}</span>
                {active ? <Icon name="Check" className="size-4 shrink-0" /> : null}
              </button>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={`Edit ${entry.workspace.name}`}
                className="size-7 shrink-0 text-muted-foreground"
                onClick={() => {
                  openEditor({ kind: "edit", id: entry.workspace.id });
                  dismiss();
                }}
              >
                <Icon name="Edit" className="size-3.5" />
              </Button>
            </li>
          );
        })}
      </ul>
      <Button type="button" variant="ghost" size="sm" className="justify-start text-muted-foreground" onClick={create}>
        <Icon name="Plus" />
        New workspace
      </Button>
    </div>
  );
}
