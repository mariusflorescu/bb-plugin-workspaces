import {
  experimental_useSidebarThreads,
  useBbNavigate,
  useRealtime,
  useRealtimeConnectionState,
  useRpc,
  type BbContext,
  type PluginRpcClient,
  type PluginSidebarProject,
  type PluginSidebarThread,
  type PluginSidebarThreadsState,
} from "@get-bb/plugin-sdk/app";
import {
  MutationObserver,
  QueryClient,
  queryOptions,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useEffect, useLayoutEffect, useMemo, useRef, useSyncExternalStore } from "react";
import { toast } from "sonner";
import type { SaveInput, rpcContract } from "../server";
import {
  ALL,
  OPEN_MASK,
  ProjectIdSchema,
  ThreadIdSchema,
  WORKSPACES_CHANGED,
  WorkspaceIdSchema,
  WorkspacesChangedSchema,
  resolveBoard,
  sameSelection,
  selectionAtTile,
  selectionForRoute,
  showsRoute,
  stepSelection,
  toDoc,
  toWireSelection,
  type Board,
  type NumberedTile,
  type ProjectRef,
  type RouteFocus,
  type Selection,
  type SidebarMask,
  type SidebarSnapshot,
  type ThreadRef,
  type WireDoc,
  type WorkspaceEntry,
  type WorkspaceId,
} from "./domain";

type Rpc = PluginRpcClient<typeof rpcContract>;

export const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: Number.POSITIVE_INFINITY, retry: 2 } },
});

const docKey = queryOptions<WireDoc>({ queryKey: ["workspaces", "doc"] }).queryKey;

const railDoc = () => queryClient.getQueryData(docKey) ?? { workspaces: [] };

interface Store<T> {
  get(): T;
  set(next: T): void;
  subscribe(listener: () => void): () => void;
}

function createStore<T>(initial: T): Store<T> {
  let value = initial;
  const listeners = new Set<() => void>();
  return {
    get: () => value,
    set: (next) => {
      value = next;
      for (const listener of listeners) listener();
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

export interface EditorTarget {
  readonly kind: "create" | "edit" | "delete";
  readonly id: WorkspaceId;
}

const editorStore = createStore<EditorTarget | null>(null);

export const openEditor = (target: EditorTarget): void => editorStore.set(target);
export const openCreateEditor = (): void =>
  editorStore.set({ kind: "create", id: WorkspaceIdSchema.parse(crypto.randomUUID()) });
export const closeEditor = (): void => editorStore.set(null);
export const useEditorTarget = (): EditorTarget | null =>
  useSyncExternalStore(editorStore.subscribe, editorStore.get);

export type BoardState =
  | { readonly status: "loading"; readonly mask: SidebarMask }
  | { readonly status: "error"; readonly mask: SidebarMask; readonly message: string; readonly retry: () => void }
  | { readonly status: "ready"; readonly mask: SidebarMask; readonly board: Board };

// The palette runs outside React, so the selection write uses the rpc client
// the mounted overlay last bound.
let boundRpc: Rpc | null = null;

const patchSelection = (selectedWorkspaceId: WorkspaceId | null) => {
  const doc = queryClient.getQueryData(docKey);
  if (doc !== undefined) queryClient.setQueryData(docKey, { ...doc, selectedWorkspaceId });
};

// query-core keeps a mutation alive while an observer holds it and each
// mutate() releases the previous one, so one observer per window lets finished
// picks be collected. The scope runs picks one at a time, in order.
const selectionObserver = new MutationObserver<WireDoc, Error, Selection, { previous: WireDoc | undefined }>(
  queryClient,
  {
    scope: { id: "workspace-selection" },
    mutationFn: (selection) => {
      if (boundRpc === null) throw new Error("Workspaces aren't loaded yet.");
      return boundRpc.call("selection_set", { id: toWireSelection(selection) });
    },
    onMutate: async (selection) => {
      await queryClient.cancelQueries({ queryKey: docKey });
      const previous = queryClient.getQueryData(docKey);
      patchSelection(toWireSelection(selection));
      return { previous };
    },
    onError: (error, _selection, context) => {
      if (context?.previous !== undefined) queryClient.setQueryData(docKey, context.previous);
      toast.error(describeError(error, "switch workspaces"));
    },
    onSuccess: (doc) => {
      queryClient.setQueryData(docKey, doc);
    },
  },
);

function writeSelection(next: Selection): void {
  selectionObserver.mutate(next).catch(() => undefined);
}

const localPicks = createStore<Selection>(ALL);

export function selectWorkspace(next: Selection): void {
  writeSelection(next);
  localPicks.set(next);
}

/** Every write returns the whole doc, which lands after this; a re-read now would flash older state. */
const writeResponsePending = () => queryClient.isMutating() > 0;

function useDocQuery(rpc: Rpc) {
  const client = useQueryClient();
  useEffect(() => {
    boundRpc = rpc;
  }, [rpc]);
  const reread = () => void client.invalidateQueries({ queryKey: docKey }, { cancelRefetch: false });
  useRealtime(WORKSPACES_CHANGED, (payload) => {
    if (writeResponsePending()) return;
    const signal = WorkspacesChangedSchema.safeParse(payload);
    if (signal.success && signal.data.kind === "selection") {
      patchSelection(signal.data.selectedWorkspaceId);
    } else {
      reread();
    }
  });
  // Realtime signals aren't replayed, so re-read after every reconnect (not the first connect).
  const connection = useRealtimeConnectionState();
  const wasDisconnected = useRef(false);
  useEffect(() => {
    if (connection === "reconnecting") wasDisconnected.current = true;
    if (connection === "connected" && wasDisconnected.current) {
      wasDisconnected.current = false;
      void client.invalidateQueries({ queryKey: docKey }, { cancelRefetch: false });
    }
  }, [client, connection]);
  return useQuery({ queryKey: docKey, queryFn: () => rpc.call("workspaces_get"), select: toDoc });
}

// BB hands out a new threads array on every status tick but keeps unchanged
// thread objects.
const threadRefs = new WeakMap<PluginSidebarThread, ThreadRef | null>();
const projectRefs = new WeakMap<PluginSidebarProject, ProjectRef | null>();

function toThreadRef(thread: PluginSidebarThread): ThreadRef | null {
  const cached = threadRefs.get(thread);
  if (cached !== undefined) return cached;
  const id = ThreadIdSchema.safeParse(thread.id);
  const projectId = ProjectIdSchema.safeParse(thread.projectId);
  const parentId = thread.parentThreadId === null ? null : ThreadIdSchema.safeParse(thread.parentThreadId);
  const ref =
    thread.isHidden || thread.isArchived || !id.success || !projectId.success || (parentId !== null && !parentId.success)
      ? null
      : { id: id.data, projectId: projectId.data, parentId: parentId === null ? null : parentId.data };
  threadRefs.set(thread, ref);
  return ref;
}

function toProjectRef(project: PluginSidebarProject): ProjectRef | null {
  const cached = projectRefs.get(project);
  if (cached !== undefined) return cached;
  const id = ProjectIdSchema.safeParse(project.id);
  const ref = id.success ? { id: id.data, name: project.name, isPersonal: project.isPersonal } : null;
  projectRefs.set(project, ref);
  return ref;
}

function sameRefs<T extends object>(a: readonly T[], b: readonly T[], keys: readonly (keyof T)[]): boolean {
  return a.length === b.length && a.every((item, index) => keys.every((key) => item[key] === b[index]?.[key]));
}

function useSnapshot(sidebar: PluginSidebarThreadsState): SidebarSnapshot {
  const last = useRef<SidebarSnapshot>({ projects: [], threads: [] });
  const projects = sidebar.projects.map(toProjectRef).filter((ref): ref is ProjectRef => ref !== null);
  const threads = sidebar.threads.map(toThreadRef).filter((ref): ref is ThreadRef => ref !== null);
  if (
    !sameRefs(projects, last.current.projects, ["id", "name", "isPersonal"]) ||
    !sameRefs(threads, last.current.threads, ["id", "projectId", "parentId"])
  ) {
    last.current = { projects, threads };
  }
  return last.current;
}

export function useBoard(): BoardState {
  const rpc = useRpc<typeof rpcContract>();
  const query = useDocQuery(rpc);
  const sidebar = experimental_useSidebarThreads();
  const snapshot = useSnapshot(sidebar);
  const board = useMemo(
    () => (query.data === undefined ? null : resolveBoard({ doc: query.data, sidebar: snapshot })),
    [query.data, snapshot],
  );
  const { refetch } = query;
  const failure = query.isError
    ? "Couldn't load your workspaces."
    : sidebar.status === "error"
      ? "BB's project list isn't available right now."
      : null;
  const loading = sidebar.status === "loading";
  return useMemo((): BoardState => {
    if (failure !== null) {
      return { status: "error", mask: OPEN_MASK, message: failure, retry: () => void refetch() };
    }
    if (loading || board === null) return { status: "loading", mask: OPEN_MASK };
    return { status: "ready", mask: board.mask, board };
  }, [failure, loading, board, refetch]);
}

export function describeError(error: Error, action: string): string {
  if ("code" in error && error.code === "handler_error") return error.message;
  if ("code" in error && error.code === "invalid_input") {
    return `Couldn't ${action}: some values weren't accepted. Check the form and try again.`;
  }
  return `Couldn't ${action}. Check that BB is reachable and try again.`;
}

function useDocMutation<Variables>(
  call: (rpc: Rpc, variables: Variables) => Promise<WireDoc>,
  onError?: (error: Error) => void,
) {
  const rpc = useRpc<typeof rpcContract>();
  const client = useQueryClient();
  return useMutation({
    mutationFn: (variables: Variables) => call(rpc, variables),
    onSuccess: (doc) => {
      client.setQueryData(docKey, doc);
    },
    onError,
  });
}

export const useSaveWorkspace = () => useDocMutation((rpc, input: SaveInput) => rpc.call("workspace_save", input));

export const useDeleteWorkspace = () =>
  useDocMutation((rpc, entry: WorkspaceEntry) => rpc.call("workspace_delete", { id: entry.workspace.id }));

export const useMoveWorkspace = () =>
  useDocMutation(
    (rpc, { id, delta }: { readonly id: WorkspaceId; readonly delta: 1 | -1 }) => {
      const ids = railDoc().workspaces.map((workspace) => workspace.id);
      const from = ids.indexOf(id);
      const to = from + delta;
      if (from !== -1 && to >= 0 && to < ids.length) ids.splice(to, 0, ...ids.splice(from, 1));
      return rpc.call("workspaces_reorder", { ids });
    },
    (error) => toast.error(describeError(error, "move the workspace")),
  );

export function canStep(): boolean {
  return railDoc().workspaces.length > 0;
}

export function stepWorkspace(delta: 1 | -1): void {
  const wire = queryClient.getQueryData(docKey);
  if (wire === undefined || wire.workspaces.length === 0) return;
  selectWorkspace(stepSelection(toDoc(wire), delta));
}

export const hasTile = (tile: NumberedTile): boolean => selectionAtTile(railDoc(), tile) !== null;

export function selectTile(tile: NumberedTile): void {
  const target = selectionAtTile(railDoc(), tile);
  if (target !== null) selectWorkspace(target);
}

const NEITHER: RouteFocus = { projectId: null, threadId: null };

function toRouteFocus(route: BbContext): RouteFocus {
  const projectId = ProjectIdSchema.safeParse(route.projectId);
  const threadId = ThreadIdSchema.safeParse(route.threadId);
  return { projectId: projectId.success ? projectId.data : null, threadId: threadId.success ? threadId.data : null };
}

/**
 * Only a change of the route's (thread, project) pair moves the selection; a
 * tile pick alone never does. The pair starts as neither, so the route a
 * reload, deep link or notification lands on is followed too.
 */
export function useFollowRoute(route: BbContext, ready: boolean): void {
  const { projectId, threadId } = toRouteFocus(route);
  const baseline = useRef<RouteFocus>(NEITHER);
  useEffect(() => {
    const wire = queryClient.getQueryData(docKey);
    if (!ready || wire === undefined) return;
    const last = baseline.current;
    baseline.current = { projectId, threadId };
    if (last.projectId === projectId && last.threadId === threadId) return;
    const doc = toDoc(wire);
    const target = selectionForRoute(doc, { projectId, threadId });
    if (target !== "unchanged" && !sameSelection(target, doc.selection)) writeSelection(target);
  }, [projectId, threadId, ready]);
}

export function useLeaveHiddenRoute(route: BbContext): void {
  const navigate = useBbNavigate();
  const { projectId, threadId } = toRouteFocus(route);
  useLayoutEffect(
    () =>
      localPicks.subscribe(() => {
        const pick = localPicks.get();
        const wire = queryClient.getQueryData(docKey);
        if (wire === undefined) return;
        if (!showsRoute({ ...toDoc(wire), selection: pick }, { projectId, threadId })) navigate.toCompose();
      }),
    [navigate, projectId, threadId],
  );
}
