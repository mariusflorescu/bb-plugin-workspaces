import { describe, expect, it } from "vitest";
import {
  ALL,
  HexColorSchema,
  InitialsSchema,
  ProjectIdSchema,
  ThreadIdSchema,
  WorkspaceIdSchema,
  WorkspaceNameSchema,
  deriveInitials,
  displayInitials,
  readableInk,
  resolveBoard,
  selectionForRoute,
  stepSelection,
  hidesAnything,
  type Board,
  type ProjectId,
  type Selection,
  type SidebarSnapshot,
  type ThreadId,
  type Workspace,
  type WorkspaceDoc,
  type WorkspaceId,
} from "./domain";

const pid = (value: string): ProjectId => ProjectIdSchema.parse(value);
const tid = (value: string): ThreadId => ThreadIdSchema.parse(value);
const wid = (value: string): WorkspaceId => WorkspaceIdSchema.parse(value);

function workspace(id: string, name: string): Workspace {
  return {
    id: wid(id),
    name: WorkspaceNameSchema.parse(name),
    initials: null,
    color: HexColorSchema.parse("#7c3aed"),
    image: null,
  };
}

const ACME = workspace("acme", "Acme");
const GLOBEX = workspace("globex", "Globex");

const SIDEBAR: SidebarSnapshot = {
  projects: [
    { id: pid("acme1"), name: "web-app", isPersonal: false },
    { id: pid("globex1"), name: "api", isPersonal: false },
    { id: pid("new1"), name: "fresh-project", isPersonal: false },
    { id: pid("acme2"), name: "infra", isPersonal: false },
    { id: pid("personal"), name: "Personal", isPersonal: true },
  ],
  threads: [
    { id: tid("t_acme1"), projectId: pid("acme1"), parentId: null },
    { id: tid("t_globex1"), projectId: pid("globex1"), parentId: null },
    { id: tid("t_globex1_child"), projectId: pid("globex1"), parentId: tid("t_globex1") },
    { id: tid("t_acme1_child_in_globex1"), projectId: pid("globex1"), parentId: tid("t_acme1") },
    { id: tid("t_orphan"), projectId: pid("globex1"), parentId: tid("t_archived") },
    { id: tid("t_personal"), projectId: pid("personal"), parentId: null },
  ],
};

function doc(
  selection: Selection = ALL,
  extraOwners: readonly (readonly [string, string])[] = [],
): WorkspaceDoc {
  return {
    selection,
    workspaces: [ACME, GLOBEX],
    owner: new Map(
      [
        ["acme1", "acme"],
        ["acme2", "acme"],
        ["globex1", "globex"],
        ["deleted_project", "acme"],
        ["new1", "deleted_workspace"],
        ...extraOwners,
      ].map(([project, owner]) => [pid(project), wid(owner)]),
    ),
  };
}

const pick = (id: string): Selection => ({ kind: "workspace", id: wid(id) });

interface Summary {
  active: string;
  hiddenProjects: string[];
  hiddenRoots: string[];
  hidePersonalGroup: boolean;
  hidesAnything: boolean;
}

function summary(board: Board): Summary {
  return {
    active: board.active.kind === "all" ? "all" : board.active.entry.workspace.id,
    hiddenProjects: [...board.mask.hiddenProjects].sort(),
    hiddenRoots: [...board.mask.hiddenRoots].sort(),
    hidePersonalGroup: board.mask.hidePersonalGroup,
    hidesAnything: hidesAnything(board.mask),
  };
}

describe("resolveBoard visibility policy", () => {
  const cases: {
    name: string;
    doc: WorkspaceDoc;
    expected: Summary;
  }[] = [
    {
      name: "All workspaces hides nothing",
      doc: doc(ALL),
      expected: { active: "all", hiddenProjects: [], hiddenRoots: [], hidePersonalGroup: false, hidesAnything: false },
    },
    {
      name: "a workspace shows only its own projects: foreign, unfiled and personal hide with their roots",
      doc: doc(pick("acme")),
      expected: {
        active: "acme",
        hiddenProjects: ["globex1", "new1", "personal"],
        hiddenRoots: ["t_globex1", "t_orphan", "t_personal"],
        hidePersonalGroup: true,
        hidesAnything: true,
      },
    },
    {
      name: "the other workspace hides the first one's projects and every unfiled one",
      doc: doc(pick("globex")),
      expected: {
        active: "globex",
        hiddenProjects: ["acme1", "acme2", "new1", "personal"],
        hiddenRoots: ["t_acme1", "t_personal"],
        hidePersonalGroup: true,
        hidesAnything: true,
      },
    },
    {
      name: "a personal project filed in the workspace keeps BB's Threads group",
      doc: doc(pick("acme"), [["personal", "acme"]]),
      expected: { active: "acme", hiddenProjects: ["globex1", "new1"], hiddenRoots: ["t_globex1", "t_orphan"], hidePersonalGroup: false, hidesAnything: true },
    },
    {
      name: "a selection naming a deleted workspace resolves to All workspaces",
      doc: doc(pick("deleted_workspace")),
      expected: { active: "all", hiddenProjects: [], hiddenRoots: [], hidePersonalGroup: false, hidesAnything: false },
    },
    {
      name: "a workspace owning every live project needs no filter",
      doc: {
        selection: pick("acme"),
        workspaces: [ACME],
        owner: new Map(SIDEBAR.projects.map((project) => [project.id, wid("acme")])),
      },
      expected: { active: "acme", hiddenProjects: [], hiddenRoots: [], hidePersonalGroup: false, hidesAnything: false },
    },
  ];

  it.each(cases)("$name", ({ doc: input, expected }) => {
    const board = resolveBoard({ doc: input, sidebar: SIDEBAR });
    expect(summary(board)).toEqual(expected);
  });

  it("groups live projects by owner in BB's order and treats dangling owners as unfiled", () => {
    const board = resolveBoard({ doc: doc(), sidebar: SIDEBAR });
    expect(board.entries.map((entry) => [entry.workspace.id, entry.projects.map((project) => project.id)])).toEqual([
      ["acme", ["acme1", "acme2"]],
      ["globex", ["globex1"]],
    ]);
    expect(board.unfiled.map((project) => project.id)).toEqual(["new1", "personal"]);
  });
});

describe("selectionForRoute", () => {
  it.each([
    { name: "a thread selects its project's owner", threadId: "t_globex1", projectId: "globex1", expected: pick("globex") },
    { name: "a thread in an unfiled project selects All workspaces", threadId: "t_personal", projectId: "personal", expected: ALL },
    { name: "a thread with no project selects All workspaces", threadId: "t_orphan", projectId: null, expected: ALL },
    { name: "a project page selects its owner", threadId: null, projectId: "acme2", expected: pick("acme") },
    { name: "an unfiled project page selects All workspaces", threadId: null, projectId: "personal", expected: ALL },
    { name: "a project whose owner was deleted selects All workspaces", threadId: null, projectId: "new1", expected: ALL },
    { name: "neither a thread nor a project leaves the selection alone", threadId: null, projectId: null, expected: "unchanged" },
  ])("$name", ({ threadId, projectId, expected }) => {
    const route = { threadId: threadId === null ? null : tid(threadId), projectId: projectId === null ? null : pid(projectId) };
    expect(selectionForRoute(doc(pick("acme")), route)).toEqual(expected);
  });
});

describe("stepSelection", () => {
  const cases: { from: Selection; delta: 1 | -1; to: Selection; empty?: boolean }[] = [
    { from: ALL, delta: 1, to: pick("acme") },
    { from: pick("acme"), delta: 1, to: pick("globex") },
    { from: pick("globex"), delta: 1, to: ALL },
    { from: ALL, delta: -1, to: pick("globex") },
    { from: pick("acme"), delta: -1, to: ALL },
    { from: pick("deleted_workspace"), delta: 1, to: pick("acme") },
    { from: ALL, delta: 1, to: ALL, empty: true },
  ];
  it.each(cases)("$from.kind $from.id by $delta", ({ from, delta, to, empty }) => {
    const current = empty === true ? { selection: from, workspaces: [], owner: new Map() } : doc(from);
    expect(stepSelection(current, delta)).toEqual(to);
  });
});

describe("deriveInitials", () => {
  it.each([
    ["Acme", "AC"],
    ["InGen", "IG"],
    ["INITECH", "IN"],
    ["umbrella", "UM"],
    ["Acme Corp", "AC"],
    ["  acme   corp  ", "AC"],
    ["🚀 Launch", "🚀L"],
    ["élan vital", "ÉV"],
    ["x", "X"],
  ])("%s → %s", (name, initials) => {
    expect(deriveInitials(name)).toBe(initials);
  });

  it("prefers the user's initials and derives only when they are null", () => {
    expect(displayInitials({ name: ACME.name, initials: InitialsSchema.parse("PX") })).toBe("PX");
    expect(displayInitials({ name: ACME.name, initials: null })).toBe("AC");
  });
});

describe("readableInk", () => {
  it.each([
    ["#7c3aed", "light"],
    ["#475569", "light"],
    ["#000000", "light"],
    ["#ca8a04", "dark"],
    ["#ffffff", "dark"],
  ])("%s → %s ink", (color, ink) => {
    expect(readableInk(HexColorSchema.parse(color))).toBe(ink);
  });
});

describe("value schemas", () => {
  it.each([
    ["#AABBCC", "#aabbcc"],
    [" 7C3AED ", "#7c3aed"],
    ["#0ea5e9", "#0ea5e9"],
  ])("normalises color %j to %s", (input, output) => {
    expect(HexColorSchema.parse(input)).toBe(output);
  });

  it.each([
    [HexColorSchema, "red", "Use a hex color like #7c3aed"],
    [HexColorSchema, "#abc", "Use a hex color like #7c3aed"],
    [WorkspaceNameSchema, "   ", "Give the workspace a name"],
    [WorkspaceNameSchema, "x".repeat(41), "Keep the name to 40 characters or fewer"],
    [InitialsSchema, "ABCD", "Use at most 3 characters"],
  ] as const)("rejects %#: %j", (schema, input, message) => {
    const result = schema.safeParse(input);
    expect(result.success ? null : result.error.issues[0]?.message).toBe(message);
  });

  it("counts an emoji as one initial", () => {
    expect(InitialsSchema.parse(" 🚀🚀🚀 ")).toBe("🚀🚀🚀");
  });
});
