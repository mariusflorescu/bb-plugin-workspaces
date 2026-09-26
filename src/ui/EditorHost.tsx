import { useEffect } from "react";
import { closeEditor, useEditorTarget, type BoardState } from "../client";
import { DeleteWorkspaceDialog } from "./DeleteWorkspaceDialog";
import { WorkspaceEditor } from "./WorkspaceEditor";

export function EditorHost({ state }: { readonly state: BoardState }) {
  const target = useEditorTarget();
  const entries = state.status === "ready" ? state.board.entries : null;
  const entry =
    target === null || target.kind === "create"
      ? null
      : entries?.find((candidate) => candidate.workspace.id === target.id);
  const deletedElsewhere = entries !== null && entry === undefined;
  useEffect(() => {
    if (deletedElsewhere) closeEditor();
  }, [deletedElsewhere]);

  if (target === null) return null;
  if (target.kind === "create") {
    return <WorkspaceEditor key={target.id} mode={{ kind: "create", id: target.id }} state={state} onClose={closeEditor} />;
  }
  if (entry === null || entry === undefined) return null;
  if (target.kind === "delete") return <DeleteWorkspaceDialog entry={entry} onClose={closeEditor} />;
  return <WorkspaceEditor key={target.id} mode={{ kind: "edit", entry }} state={state} onClose={closeEditor} />;
}
