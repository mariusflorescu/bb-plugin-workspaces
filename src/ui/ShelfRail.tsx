import { useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import type { BoardState } from "../client";
import { findShelfPanel, watchLayout } from "../shell-css";
import { WorkspaceRail } from "./WorkspaceRail";

/**
 * On phones BB's sidebar is a shelf that main slides away from. Living inside
 * that panel keeps the rail in its focus scope and inert with it when closed.
 */
export function ShelfRail({ state }: { readonly state: BoardState }) {
  const panel = useSyncExternalStore(watchLayout, findShelfPanel, () => null);
  return panel === null ? null : createPortal(<WorkspaceRail state={state} placement="shelf" />, panel);
}
