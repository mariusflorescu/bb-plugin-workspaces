import { useBbContext } from "@get-bb/plugin-sdk/app";
import { useMemo } from "react";
import { useBoard, useFollowRoute } from "../client";
import { shellCss } from "../shell-css";
import { EditorHost } from "./EditorHost";
import { ShelfRail } from "./ShelfRail";
import { WorkspaceRail } from "./WorkspaceRail";

export function OverlayBody() {
  const state = useBoard();
  const { projectId, threadId } = useBbContext();
  useFollowRoute({ projectId, threadId }, state.status === "ready");
  const css = useMemo(() => shellCss(state.mask), [state.mask]);
  return (
    <>
      <style>{css}</style>
      <WorkspaceRail state={state} placement="column" />
      <ShelfRail state={state} />
      <EditorHost state={state} />
    </>
  );
}
