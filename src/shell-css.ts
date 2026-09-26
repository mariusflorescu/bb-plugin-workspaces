import type { ProjectId, SidebarMask, ThreadId } from "./domain";

export const RAIL_WIDTH_PX = 56;
export const RAIL_ATTR = "data-bb-workspaces-rail";
/** The rail BB's mobile shelf hosts; the shelf makes room for it only while it is inside. */
export const SHELF_RAIL_ATTR = "data-bb-workspaces-shelf-rail";
/** Marks every "the filter can't apply" hint; the stylesheet shows them only while BB's list lacks the filter hooks. */
export const FILTER_WARNING_ATTR = "data-bb-workspaces-filter-warning";

const RAIL = `[${RAIL_ATTR}]`;
const RAIL_VAR = "--bb-workspaces-rail-width";
// BB 0.44 animates the gap's width and the panel's left with duration-200 ease-linear.
const HOST_TRANSITION = "200ms linear";

const BB_0_44 = {
  layoutRoot: '#root > [data-testid="app-layout-root"]',
  // Desktop only: the compact drawer has no gap, so nothing here matches there.
  wrapper: '#root > [data-testid="app-layout-root"] > [data-side="left"]',
  // Compact only. The panel stays put under main, which slides right by a width
  // BB's JavaScript computes, so the rail takes room inside the panel instead of widening it.
  shelfPanel: '#root > [data-testid="app-layout-root"] > [data-sidebar="panel"][data-vaul-drawer-direction="left"]',
  expanded: '[data-state="expanded"]',
  sidebarWidth: "--sidebar-width",
  gap: '[data-sidebar="gap"]',
  panel: '[data-sidebar="panel"]',
  trigger: '[data-testid="app-sidebar-trigger-overlay"]',
  visibilityGroup: "[data-sidebar-visibility-group]",
  // The project item wraps the whole project (header and threads), so it is an
  // independent second match if the visibility-group key is renamed.
  projectGroup: (id: ProjectId) =>
    `[data-sidebar-visibility-group="project:${id}"], ` +
    `[data-sidebar-sticky-project-item][data-sidebar-project-id="${id}"]`,
  projectItem: "[data-sidebar-sticky-project-item][data-sidebar-project-id]",
  personalGroup: '[data-sidebar-visibility-group="threads"]',
  threadRow: (id: ThreadId) => `[data-sidebar-thread-id="${id}"]`,
  anyThreadRow: "[data-sidebar-thread-id]",
  // A thread's own row group: its rename-row is a direct child, nested children sit deeper.
  threadTree: "[data-sidebar-sticky-group]",
  renameRow: "[data-sidebar-rename-row]",
  section: "[data-sidebar-sticky-section]",
  headedGroup: "[data-sidebar-sticky-header]",
} as const;

const DESKTOP = `:root:has(${BB_0_44.wrapper} > ${BB_0_44.gap} + ${BB_0_44.panel})`;
const EXPANDED = `:root:has(${BB_0_44.wrapper}${BB_0_44.expanded} > ${BB_0_44.gap} + ${BB_0_44.panel})`;
const SHIFTED = `${EXPANDED} ${BB_0_44.wrapper}`;
const FILTER_HOOKS = [
  BB_0_44.visibilityGroup,
  BB_0_44.projectItem,
  `${BB_0_44.threadTree} > ${BB_0_44.renameRow} ${BB_0_44.anyThreadRow}`,
].join(", ");

const LAYOUT_CSS = [
  `:root { ${RAIL_VAR}: ${RAIL_WIDTH_PX}px; }`,
  `${RAIL} { display: none; }`,
  `${DESKTOP} ${RAIL} { display: flex; transform: translateX(-100%); visibility: hidden; transition: transform ${HOST_TRANSITION}, visibility ${HOST_TRANSITION}; }`,
  `${EXPANDED} ${RAIL} { transform: none; visibility: visible; }`,
  `${SHIFTED} > ${BB_0_44.gap} { width: calc(var(${BB_0_44.sidebarWidth}) + var(${RAIL_VAR})) !important; }`,
  `${SHIFTED} > ${BB_0_44.gap} + ${BB_0_44.panel} { left: var(${RAIL_VAR}) !important; }`,
  `${SHIFTED} ~ ${BB_0_44.trigger} { left: var(${RAIL_VAR}) !important; }`,
  `:root:has(${FILTER_HOOKS}) [${FILTER_WARNING_ATTR}] { display: none !important; }`,
  `${BB_0_44.shelfPanel}:has(> [${SHELF_RAIL_ATTR}]) { padding-left: var(${RAIL_VAR}); }`,
].join("\n");

export function shellCss(mask: SidebarMask): string {
  return [LAYOUT_CSS, ...maskRules(mask)].join("\n");
}

function maskRules(mask: SidebarMask): string[] {
  const rules: string[] = [];
  const hide = (selector: string) => rules.push(`${selector} { display: none !important; }`);
  if (mask.hiddenProjects.size > 0) {
    hide([...mask.hiddenProjects].map(BB_0_44.projectGroup).join(",\n"));
  }
  if (mask.hidePersonalGroup) hide(BB_0_44.personalGroup);
  if (mask.hiddenRoots.size > 0) {
    const roots = `:is(${[...mask.hiddenRoots].map(BB_0_44.threadRow).join(", ")})`;
    hide(`${BB_0_44.threadTree}:has(> ${BB_0_44.renameRow} ${roots})`);
    // A headed group ("Pinned") whose every root row is masked would leave a
    // bare label.
    const rootRows = `${BB_0_44.section} > ${BB_0_44.threadTree} > ${BB_0_44.renameRow} ${BB_0_44.anyThreadRow}`;
    hide(`${BB_0_44.headedGroup}:has(${rootRows}):not(:has(${rootRows}:not(${roots})))`);
  }
  return rules;
}

export function findShelfPanel(): Element | null {
  return document.querySelector(BB_0_44.shelfPanel);
}

/** Calls back when BB swaps its layout (a viewport crossing the compact breakpoint remounts the panel). */
export function watchShelfPanel(onChange: () => void): () => void {
  const observer = new MutationObserver(() => {
    observeLayout();
    onChange();
  });
  const observeLayout = () => {
    observer.disconnect();
    const root = document.getElementById("root");
    if (root !== null) observer.observe(root, { childList: true });
    const layout = document.querySelector(BB_0_44.layoutRoot);
    if (layout !== null) observer.observe(layout, { childList: true });
  };
  observeLayout();
  return () => observer.disconnect();
}
