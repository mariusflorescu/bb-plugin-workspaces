import { z } from "zod";

const CSS_SAFE_ID = /^[A-Za-z0-9_-]+$/;

export const WorkspaceIdSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(CSS_SAFE_ID)
  .brand<"WorkspaceId">();
export type WorkspaceId = z.infer<typeof WorkspaceIdSchema>;

export const ProjectIdSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(CSS_SAFE_ID)
  .brand<"ProjectId">();
export type ProjectId = z.infer<typeof ProjectIdSchema>;

export const ThreadIdSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(CSS_SAFE_ID)
  .brand<"ThreadId">();
export type ThreadId = z.infer<typeof ThreadIdSchema>;

const NAME_MAX_LENGTH = 40;
export const WorkspaceNameSchema = z
  .string()
  .trim()
  .min(1, "Give the workspace a name")
  .max(NAME_MAX_LENGTH, `Keep the name to ${NAME_MAX_LENGTH} characters or fewer`)
  .brand<"WorkspaceName">();
export type WorkspaceName = z.infer<typeof WorkspaceNameSchema>;

const INITIALS_MAX_GRAPHEMES = 3;
export const InitialsSchema = z
  .string()
  .trim()
  .refine((value) => countGraphemes(value) >= 1, "Initials can't be empty")
  .refine(
    (value) => countGraphemes(value) <= INITIALS_MAX_GRAPHEMES,
    `Use at most ${INITIALS_MAX_GRAPHEMES} characters`,
  )
  .brand<"Initials">();
export type Initials = z.infer<typeof InitialsSchema>;

export const HexColorSchema = z
  .string()
  .transform(normaliseHex)
  .pipe(z.string().regex(/^#[0-9a-f]{6}$/, "Use a hex color like #7c3aed"))
  .brand<"HexColor">();
export type HexColor = z.infer<typeof HexColorSchema>;

const IMAGE_MAX_DATA_URL_LENGTH = 48 * 1024;
export const ImageDataUrlSchema = z
  .string()
  .max(IMAGE_MAX_DATA_URL_LENGTH, "That image is too large, even after resizing")
  .regex(
    /^data:image\/(webp|png|jpeg);base64,[A-Za-z0-9+/]+=*$/,
    "That file isn't a supported image",
  )
  .brand<"ImageDataUrl">();
export type ImageDataUrl = z.infer<typeof ImageDataUrlSchema>;

export const WorkspaceSchema = z.object({
  id: WorkspaceIdSchema,
  name: WorkspaceNameSchema,
  initials: InitialsSchema.nullable(),
  color: HexColorSchema,
  image: ImageDataUrlSchema.nullable(),
});
export type Workspace = Readonly<z.infer<typeof WorkspaceSchema>>;

export const MAX_WORKSPACES = 16;

export const WireDocSchema = z.object({
  workspaces: z.array(WorkspaceSchema).max(MAX_WORKSPACES),
  memberships: z.array(z.object({ projectId: ProjectIdSchema, workspaceId: WorkspaceIdSchema })),
  selectedWorkspaceId: WorkspaceIdSchema.nullable(),
});
export type WireDoc = z.infer<typeof WireDocSchema>;

export const WORKSPACES_CHANGED = "workspaces-changed";
export const WorkspacesChangedSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("reread") }),
  z.object({ kind: z.literal("selection"), selectedWorkspaceId: WorkspaceIdSchema.nullable() }),
]);
export type WorkspacesChanged = z.infer<typeof WorkspacesChangedSchema>;

export type Selection =
  | { readonly kind: "all" }
  | { readonly kind: "workspace"; readonly id: WorkspaceId };

export const ALL: Selection = { kind: "all" };

export const toWireSelection = (selection: Selection): WorkspaceId | null =>
  selection.kind === "all" ? null : selection.id;

export interface WorkspaceDoc {
  readonly workspaces: readonly Workspace[];
  readonly owner: ReadonlyMap<ProjectId, WorkspaceId>;
  readonly selection: Selection;
}

export interface ProjectRef {
  readonly id: ProjectId;
  readonly name: string;
  readonly isPersonal: boolean;
}

export interface ThreadRef {
  readonly id: ThreadId;
  readonly projectId: ProjectId;
  readonly parentId: ThreadId | null;
}

export function toDoc(wire: WireDoc): WorkspaceDoc {
  return {
    workspaces: wire.workspaces,
    owner: new Map(wire.memberships.map((membership) => [membership.projectId, membership.workspaceId])),
    selection: wire.selectedWorkspaceId === null ? ALL : { kind: "workspace", id: wire.selectedWorkspaceId },
  };
}

export interface SidebarSnapshot {
  readonly projects: readonly ProjectRef[];
  readonly threads: readonly ThreadRef[];
}

export interface WorkspaceEntry {
  readonly workspace: Workspace;
  readonly projects: readonly ProjectRef[];
}

export type ActiveView =
  | { readonly kind: "all" }
  | { readonly kind: "workspace"; readonly entry: WorkspaceEntry };

export interface SidebarMask {
  readonly hiddenProjects: ReadonlySet<ProjectId>;
  /** Root threads of hidden projects, for rows BB renders outside the project group (pinned, other modes). */
  readonly hiddenRoots: ReadonlySet<ThreadId>;
  readonly hidePersonalGroup: boolean;
}

export const OPEN_MASK: SidebarMask = {
  hiddenProjects: new Set(),
  hiddenRoots: new Set(),
  hidePersonalGroup: false,
};

export interface Board {
  readonly entries: readonly WorkspaceEntry[];
  readonly active: ActiveView;
  readonly unfiled: readonly ProjectRef[];
  readonly mask: SidebarMask;
}

export const hidesAnything = (mask: SidebarMask): boolean =>
  mask.hiddenProjects.size > 0 || mask.hiddenRoots.size > 0 || mask.hidePersonalGroup;

export function resolveBoard(input: { readonly doc: WorkspaceDoc; readonly sidebar: SidebarSnapshot }): Board {
  const { doc, sidebar } = input;
  const { entries, unfiled } = groupProjects(doc, sidebar.projects);
  const { selection } = doc;
  const selectedEntry =
    selection.kind === "workspace"
      ? entries.find((entry) => entry.workspace.id === selection.id)
      : undefined;
  if (selectedEntry === undefined) {
    return { entries, active: { kind: "all" }, unfiled, mask: OPEN_MASK };
  }

  const own = new Set(selectedEntry.projects.map((project) => project.id));
  const hiddenProjects = new Set(
    sidebar.projects.filter((project) => !own.has(project.id)).map((project) => project.id),
  );
  const threadIds = new Set(sidebar.threads.map((thread) => thread.id));
  const hiddenRoots = new Set(
    sidebar.threads
      .filter(
        (thread) =>
          (thread.parentId === null || !threadIds.has(thread.parentId)) &&
          hiddenProjects.has(thread.projectId),
      )
      .map((thread) => thread.id),
  );
  const hidePersonalGroup = sidebar.projects.some(
    (project) => project.isPersonal && hiddenProjects.has(project.id),
  );

  return {
    entries,
    active: { kind: "workspace", entry: selectedEntry },
    unfiled,
    mask: { hiddenProjects, hiddenRoots, hidePersonalGroup },
  };
}

export function groupProjects<P extends { readonly id: ProjectId }>(
  doc: Pick<WorkspaceDoc, "workspaces" | "owner">,
  projects: readonly P[],
): { readonly entries: readonly { readonly workspace: Workspace; readonly projects: readonly P[] }[]; readonly unfiled: readonly P[] } {
  const filed = new Map<WorkspaceId, P[]>();
  const unfiled: P[] = [];
  for (const project of projects) {
    const owner = liveOwner(doc, project.id);
    if (owner === null) {
      unfiled.push(project);
      continue;
    }
    const list = filed.get(owner);
    if (list === undefined) {
      filed.set(owner, [project]);
    } else {
      list.push(project);
    }
  }
  return {
    entries: doc.workspaces.map((workspace) => ({ workspace, projects: filed.get(workspace.id) ?? [] })),
    unfiled,
  };
}

function liveOwner(doc: Pick<WorkspaceDoc, "workspaces" | "owner">, projectId: ProjectId): WorkspaceId | null {
  const owner = doc.owner.get(projectId);
  return owner !== undefined && doc.workspaces.some((workspace) => workspace.id === owner) ? owner : null;
}

function liveSelection(doc: Pick<WorkspaceDoc, "workspaces" | "selection">): Selection {
  const { selection } = doc;
  return selection.kind === "workspace" && doc.workspaces.some((workspace) => workspace.id === selection.id) ? selection : ALL;
}

export interface RouteFocus {
  readonly projectId: ProjectId | null;
  readonly threadId: ThreadId | null;
}

/** A route with neither a thread nor a project (settings, plugins, compose with no project) belongs to no workspace. */
export function selectionForRoute(doc: WorkspaceDoc, route: RouteFocus): Selection | "unchanged" {
  if (route.threadId === null && route.projectId === null) return "unchanged";
  const owner = route.projectId === null ? null : liveOwner(doc, route.projectId);
  return owner === null ? ALL : { kind: "workspace", id: owner };
}

export function showsRoute(doc: WorkspaceDoc, route: RouteFocus): boolean {
  const selection = liveSelection(doc);
  return selection.kind === "all" || route.projectId === null || liveOwner(doc, route.projectId) === selection.id;
}

export function sameSelection(a: Selection, b: Selection): boolean {
  return a.kind === "all" ? b.kind === "all" : b.kind === "workspace" && a.id === b.id;
}

export function railOrder(doc: Pick<WorkspaceDoc, "workspaces">): readonly Selection[] {
  return [ALL, ...doc.workspaces.map((workspace): Selection => ({ kind: "workspace", id: workspace.id }))];
}

export const NUMBERED_TILES = [1, 2, 3, 4, 5, 6, 7, 8, 9] as const;
export type NumberedTile = (typeof NUMBERED_TILES)[number];

export function selectionAtTile(doc: Pick<WorkspaceDoc, "workspaces">, tile: NumberedTile): Selection | null {
  return railOrder(doc)[tile - 1] ?? null;
}

export function stepSelection(doc: WorkspaceDoc, delta: 1 | -1): Selection {
  const order = railOrder(doc);
  const index = Math.max(0, order.findIndex((entry) => sameSelection(entry, doc.selection)));
  return order[(index + delta + order.length) % order.length] ?? ALL;
}

export function deriveInitials(name: string): string {
  const words = name.trim().split(/\s+/).filter((word) => word !== "");
  const [first, second] = words;
  if (first === undefined) return "";
  if (second !== undefined) {
    return (firstGrapheme(first) + firstGrapheme(second)).toUpperCase();
  }
  const humps = first.split(/(?<=\p{Ll})(?=\p{Lu})/u);
  const [head, next] = humps;
  if (head !== undefined && next !== undefined) {
    return (firstGrapheme(head) + firstGrapheme(next)).toUpperCase();
  }
  return graphemes(first).slice(0, 2).join("").toUpperCase();
}

export function displayInitials(workspace: { readonly name: string; readonly initials: string | null }): string {
  return workspace.initials ?? deriveInitials(workspace.name);
}

/** The ink with the higher WCAG contrast against the tile color. */
export function readableInk(color: HexColor): "light" | "dark" {
  const channel = (offset: number): number => {
    const value = Number.parseInt(color.slice(offset, offset + 2), 16) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  const luminance = 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
  const againstWhite = 1.05 / (luminance + 0.05);
  const againstBlack = (luminance + 0.05) / 0.05;
  return againstWhite >= againstBlack ? "light" : "dark";
}

export const PRESET_COLORS: readonly HexColor[] = [
  "#7c3aed",
  "#4f46e5",
  "#2563eb",
  "#0ea5e9",
  "#0d9488",
  "#16a34a",
  "#65a30d",
  "#ca8a04",
  "#ea580c",
  "#dc2626",
  "#db2777",
  "#475569",
].map((value) => HexColorSchema.parse(value));

const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });

function graphemes(value: string): string[] {
  return [...segmenter.segment(value)].map((part) => part.segment);
}

function firstGrapheme(value: string): string {
  return graphemes(value)[0] ?? "";
}

function countGraphemes(value: string): number {
  return graphemes(value).length;
}

function normaliseHex(value: string): string {
  return `#${value.trim().toLowerCase().replace(/^#/, "")}`;
}
