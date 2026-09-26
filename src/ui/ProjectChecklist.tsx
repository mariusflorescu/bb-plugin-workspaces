import { Checkbox } from "@/components/ui/checkbox";
import type { BoardState } from "../client";
import type { ProjectRef, Workspace, WorkspaceId } from "../domain";
import { LoadError } from "./LoadError";
import { SkeletonRows } from "./SkeletonRows";
import { WorkspaceAvatar } from "./WorkspaceAvatar";

interface Row {
  readonly project: ProjectRef;
  readonly elsewhere: Workspace | null;
}

export function ProjectChecklist({
  state,
  self,
  value,
  onChange,
}: {
  readonly state: BoardState;
  readonly self: WorkspaceId;
  readonly value: readonly string[];
  readonly onChange: (next: string[]) => void;
}) {
  if (state.status === "loading") {
    return <SkeletonRows label="Loading projects" rowClassName="h-5 w-full" className="rounded-md border border-border p-3" />;
  }
  if (state.status === "error") {
    return <LoadError message={state.message} retry={state.retry} className="rounded-md border border-border p-3" />;
  }
  const own = state.board.entries.find((entry) => entry.workspace.id === self);
  const rows: Row[] = [
    ...(own?.projects ?? []).map((project) => ({ project, elsewhere: null })),
    ...state.board.unfiled.map((project) => ({ project, elsewhere: null })),
    ...state.board.entries
      .filter((entry) => entry.workspace.id !== self)
      .flatMap((entry) => entry.projects.map((project) => ({ project, elsewhere: entry.workspace }))),
  ];
  if (rows.length === 0) {
    return (
      <p className="rounded-md border border-dashed border-border px-3 py-4 text-center text-sm text-muted-foreground">
        No projects in BB yet. Projects you add in BB show up here.
      </p>
    );
  }
  const checked = new Set(value);
  const toggle = (id: string, on: boolean) =>
    onChange(on ? [...value, id] : value.filter((candidate) => candidate !== id));
  return (
    <ul aria-label="Projects" className="max-h-56 divide-y divide-border overflow-y-auto rounded-md border border-border">
      {rows.map(({ project, elsewhere }) => {
        const isChecked = checked.has(project.id);
        return (
          <li key={project.id}>
            <label className="flex cursor-pointer items-center gap-3 px-3 py-2 text-sm">
              <Checkbox checked={isChecked} onCheckedChange={(next) => toggle(project.id, next === true)} />
              <span className="min-w-0 flex-1 truncate">{project.name}</span>
              {elsewhere === null ? null : (
                <span className="flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
                  <WorkspaceAvatar workspace={elsewhere} size="row" />
                  {isChecked ? `moves from ${elsewhere.name}` : `in ${elsewhere.name}`}
                </span>
              )}
            </label>
          </li>
        );
      })}
    </ul>
  );
}
