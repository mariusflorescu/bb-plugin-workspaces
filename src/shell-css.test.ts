// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import {
  OPEN_MASK,
  ProjectIdSchema,
  ThreadIdSchema,
  type SidebarMask,
} from "./domain";
import { FILTER_WARNING_ATTR, shellCss } from "./shell-css";

const mask = (input: {
  projects?: string[];
  roots?: string[];
  personal?: boolean;
}): SidebarMask => ({
  hiddenProjects: new Set((input.projects ?? []).map((id) => ProjectIdSchema.parse(id))),
  hiddenRoots: new Set((input.roots ?? []).map((id) => ThreadIdSchema.parse(id))),
  hidePersonalGroup: input.personal ?? false,
});

const LAYOUT_LINES = shellCss(OPEN_MASK).split("\n");
const maskLines = (css: string) => css.split("\n").slice(LAYOUT_LINES.length);

describe("shellCss", () => {
  it("keeps the same layout for every mask, so the rail exists in All too", () => {
    const filtered = shellCss(mask({ projects: ["proj_a"], roots: ["thr_a"], personal: true }));
    expect(filtered.split("\n").slice(0, LAYOUT_LINES.length)).toEqual(LAYOUT_LINES);
  });

  it.each([
    { name: "the open mask hides nothing", input: {}, expected: [] },
    {
      name: "hidden projects match the visibility group and the project item",
      input: { projects: ["proj_a", "proj_b"] },
      expected: [
        '[data-sidebar-visibility-group="project:proj_a"], [data-sidebar-sticky-project-item][data-sidebar-project-id="proj_a"],',
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
    expect(maskLines(shellCss(mask(input)))).toEqual(expected);
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
    document.head.innerHTML = `<style>${shellCss(OPEN_MASK)}</style>`;
    document.body.innerHTML = html;
    const warning = document.createElement("span");
    warning.setAttribute(FILTER_WARNING_ATTR, "");
    document.body.append(warning);
    expect(getComputedStyle(warning).display !== "none").toBe(shown);
  });
});
