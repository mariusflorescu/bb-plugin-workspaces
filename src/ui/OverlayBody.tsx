import { useBbContext } from "@get-bb/plugin-sdk/app";
import { useLayoutEffect, useMemo } from "react";
import { useBoard, useFollowRoute, useLeaveHiddenRoute } from "../client";
import { maskSelectors, shellCss, syncOverflowMarks, watchSidebarRows } from "../shell-css";
import { EditorHost } from "./EditorHost";
import { ShelfRail } from "./ShelfRail";
import { WorkspaceRail } from "./WorkspaceRail";

export function OverlayBody() {
  const state = useBoard();
  const route = useBbContext();
  useFollowRoute(route, state.status === "ready");
  useLeaveHiddenRoute(route);
  const hidden = useMemo(() => maskSelectors(state.mask), [state.mask]);
  const css = useMemo(() => shellCss(hidden), [hidden]);
  useOverflowMarks(hidden);
  return (
    <>
      <style>{css}</style>
      <WorkspaceRail state={state} placement="column" />
      <ShelfRail state={state} />
      <EditorHost state={state} />
    </>
  );
}

function useOverflowMarks(hidden: readonly string[]): void {
  useLayoutEffect(() => {
    syncOverflowMarks(hidden);
    const stopWatching = watchSidebarRows(() => syncOverflowMarks(hidden));
    return () => {
      stopWatching();
      syncOverflowMarks([]);
    };
  }, [hidden]);
}
