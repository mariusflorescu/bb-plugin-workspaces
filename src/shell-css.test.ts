// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { mountBbDesktopLayout, threadRow } from "../test/bb-layout";
import {
  ProjectIdSchema,
  ThreadIdSchema,
  type SidebarMask,
} from "./domain";
import { FILTER_WARNING_ATTR, maskSelectors, shellCss, syncOverflowMarks } from "./shell-css";

const mask = (input: {
  projects?: string[];
  roots?: string[];
  personal?: boolean;
}): SidebarMask => ({
  hiddenProjects: new Set((input.projects ?? []).map((id) => ProjectIdSchema.parse(id))),
  hiddenRoots: new Set((input.roots ?? []).map((id) => ThreadIdSchema.parse(id))),
  hidePersonalGroup: input.personal ?? false,
});

const css = (input: Parameters<typeof mask>[0]) => shellCss(maskSelectors(mask(input)));
const LAYOUT_LINES = css({}).split("\n");
const maskLines = (css: string) => css.split("\n").slice(LAYOUT_LINES.length);

describe("shellCss", () => {
  it("keeps the same layout for every mask, so the rail exists in All too", () => {
    const filtered = css({ projects: ["proj_a"], roots: ["thr_a"], personal: true });
    expect(filtered.split("\n").slice(0, LAYOUT_LINES.length)).toEqual(LAYOUT_LINES);
  });

  it.each([
    { name: "the open mask hides nothing", input: {}, expected: [] },
    {
      name: "hidden projects match the visibility group and the project item",
      input: { projects: ["proj_a", "proj_b"] },
      expected: [
        '[data-sidebar-visibility-group="project:proj_a"], [data-sidebar-sticky-project-item][data-sidebar-project-id="proj_a"] { display: none !important; }',
        '[data-sidebar-visibility-group="project:proj_b"], [data-sidebar-sticky-project-item][data-sidebar-project-id="proj_b"] { display: none !important; }',
      ],
    },
    {
      name: "a filed personal project hides the Threads group",
      input: { personal: true },
      expected: ['[data-sidebar-visibility-group="threads"] { display: none !important; }'],
    },
    {
      name: "hidden roots take their tree and an emptied header",
      input: { roots: ["thr_a", "thr_b"] },
      expected: [
        '[data-sidebar-sticky-group]:has(> [data-sidebar-rename-row] :is([data-sidebar-thread-id="thr_a"], [data-sidebar-thread-id="thr_b"])) { display: none !important; }',
        '[data-sidebar-sticky-header]:has([data-sidebar-sticky-section] > [data-sidebar-sticky-group] > [data-sidebar-rename-row] [data-sidebar-thread-id]):not(:has([data-sidebar-sticky-section] > [data-sidebar-sticky-group] > [data-sidebar-rename-row] [data-sidebar-thread-id]:not(:is([data-sidebar-thread-id="thr_a"], [data-sidebar-thread-id="thr_b"])))) { display: none !important; }',
      ],
    },
  ])("$name", ({ input, expected }) => {
    expect(maskLines(css(input))).toEqual(expected);
  });
});

const SIDEBAR_ROWS =
  `<div data-sidebar-sticky-header data-testid="pinned"><div data-sidebar-sticky-section>${threadRow("thr_globex_pin")}</div></div>` +
  `<div data-sidebar-visibility-group="project:proj_acme" data-testid="acme">${threadRow("thr_acme")}</div>` +
  `<div data-sidebar-visibility-group="project:proj_globex" data-testid="globex">${threadRow("thr_globex")}</div>` +
  `<div data-sidebar-visibility-group="threads" data-testid="personal">${threadRow("thr_personal")}</div>` +
  `<div data-sidebar-overflow="true" data-sidebar-visibility-group="project:proj_initech" data-testid="bb-popup">${threadRow("thr_initech")}</div>`;

function mountSidebar(rows = SIDEBAR_ROWS): void {
  document.body.innerHTML = "";
  mountBbDesktopLayout();
  document.querySelector('[data-sidebar="panel"]')?.insertAdjacentHTML("beforeend", rows);
}

const flags = () =>
  Object.fromEntries(
    [...document.querySelectorAll("[data-testid]")]
      .filter((element) => element.hasAttribute("data-sidebar-overflow"))
      .map((element) => [element.getAttribute("data-testid"), element.hasAttribute("data-bb-workspaces-overflow") ? "plugin" : "bb"]),
  );

describe("the overflow marks", () => {
  it("take exactly the hidden rows out of BB's thread shortcuts, follow the mask, and leave BB's own flags alone", () => {
    mountSidebar();
    expect(flags()).toEqual({ "bb-popup": "bb" });

    syncOverflowMarks(maskSelectors(mask({ projects: ["proj_globex", "proj_initech", "proj_personal"], roots: ["thr_globex_pin"], personal: true })));
    expect(flags()).toEqual({
      pinned: "plugin",
      "tree-thr_globex_pin": "plugin",
      globex: "plugin",
      personal: "plugin",
      "bb-popup": "bb",
    });
    expect(document.querySelector('[data-testid="globex"]')?.getAttribute("data-sidebar-overflow")).toBe("true");

    syncOverflowMarks(maskSelectors(mask({ projects: ["proj_acme", "proj_initech"] })));
    expect(flags()).toEqual({ acme: "plugin", "bb-popup": "bb" });

    syncOverflowMarks([]);
    expect(flags()).toEqual({ "bb-popup": "bb" });
    expect(document.querySelector('[data-testid="bb-popup"]')?.getAttribute("data-sidebar-overflow")).toBe("true");
  });

  it("marks nothing outside BB's sidebar panels", () => {
    mountSidebar();
    document.body.insertAdjacentHTML("beforeend", '<div data-testid="elsewhere" data-sidebar-visibility-group="project:proj_acme"></div>');
    syncOverflowMarks(maskSelectors(mask({ projects: ["proj_acme"] })));
    expect(flags()).toEqual({ acme: "plugin", "bb-popup": "bb" });
  });

  it("marks nothing when BB renames its hooks, so BB counts every row as it would without the plugin", () => {
    mountSidebar(SIDEBAR_ROWS.replaceAll("data-sidebar-visibility-group", "data-sidebar-group-key"));
    syncOverflowMarks(maskSelectors(mask({ projects: ["proj_globex"], personal: true })));
    expect(flags()).toEqual({ "bb-popup": "bb" });
  });
});

describe("the filter warning", () => {
  it.each([
    { name: "hides while BB's list has project groups", html: '<div data-sidebar-visibility-group="project:proj_a"></div>', shown: false },
    {
      name: "hides while only the project item hook is left",
      html: '<div data-sidebar-sticky-project-item data-sidebar-project-id="proj_a"></div>',
      shown: false,
    },
    {
      name: "hides while thread rows sit in their groups (chronological mode)",
      html: '<div data-sidebar-sticky-group><div data-sidebar-rename-row><a data-sidebar-thread-id="thr_a"></a></div></div>',
      shown: false,
    },
    { name: "shows once every filter hook is gone", html: '<div data-sidebar-group-key="project:proj_a"><a data-thread="thr_a"></a></div>', shown: true },
  ])("$name", ({ html, shown }) => {
    document.head.innerHTML = `<style>${css({})}</style>`;
    document.body.innerHTML = html;
    const warning = document.createElement("span");
    warning.setAttribute(FILTER_WARNING_ATTR, "");
    document.body.append(warning);
    expect(getComputedStyle(warning).display !== "none").toBe(shown);
  });
});
