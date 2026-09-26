const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { chromium } = require(process.env.PW);

const BB_URL = process.env.BB_URL ?? "http://127.0.0.1:38886/";
const OUT = process.env.OUT ?? path.join(__dirname, "..", "..", ".evidence");
fs.mkdirSync(OUT, { recursive: true });
const SRC = path.join(__dirname, "..", "..", "src");
const RAIL_HOST_ID = "ws-gate";

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok: Boolean(ok), detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : `\n      ${JSON.stringify(detail)}`}`);
}
function skip(name, reason) {
  results.push({ name, ok: true, skipped: reason });
  console.log(`SKIP  ${name}: ${reason}`);
}
const sameList = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const bbJson = (...args) => JSON.parse(execFileSync("bb", [...args, "--json"], { encoding: "utf8" }));
const uiPreferences = () => bbJson("settings", "ui", "list").preferences;

async function loadPolicy() {
  const domain = await import(pathToFileURL(path.join(SRC, "domain.ts")).href);
  const shell = await import(pathToFileURL(path.join(SRC, "shell-css.ts")).href);
  return { ...domain, ...shell };
}

function buildScenario(policy, domProjects) {
  const projects = bbJson("project", "list", "--include-personal").map((project) => ({
    id: policy.ProjectIdSchema.parse(project.id),
    name: project.name,
    isPersonal: project.kind === "personal",
  }));
  const threads = bbJson("thread", "list").map((thread) => ({
    id: policy.ThreadIdSchema.parse(thread.id),
    projectId: policy.ProjectIdSchema.parse(thread.projectId),
    parentId: thread.parentThreadId === null ? null : policy.ThreadIdSchema.parse(thread.parentThreadId),
  }));
  const third = Math.ceil(domProjects.length / 3);
  const near = domProjects.slice(0, third);
  const far = domProjects.slice(third, 2 * third);
  const workspace = (id, name) => ({
    id: policy.WorkspaceIdSchema.parse(id),
    name: policy.WorkspaceNameSchema.parse(name),
    initials: null,
    color: policy.HexColorSchema.parse("#7c3aed"),
    image: null,
  });
  const doc = (selection) => ({
    selection,
    workspaces: [workspace("near", "Near"), workspace("far", "Far")],
    owner: new Map([
      ...near.map((id) => [policy.ProjectIdSchema.parse(id), policy.WorkspaceIdSchema.parse("near")]),
      ...far.map((id) => [policy.ProjectIdSchema.parse(id), policy.WorkspaceIdSchema.parse("far")]),
    ]),
  });
  const sidebar = { projects, threads };
  const board = policy.resolveBoard({
    doc: doc({ kind: "workspace", id: policy.WorkspaceIdSchema.parse("near") }),
    sidebar,
  });
  const allBoard = policy.resolveBoard({ doc: doc(policy.ALL), sidebar });
  const threadById = new Map(threads.map((thread) => [thread.id, thread]));
  const rootProject = {};
  for (const thread of threads) {
    let root = thread;
    const seen = new Set();
    while (root.parentId !== null && threadById.has(root.parentId) && !seen.has(root.id)) {
      seen.add(root.id);
      root = threadById.get(root.parentId);
    }
    rootProject[thread.id] = root.projectId;
  }
  return {
    board,
    css: policy.shellCss(board.mask),
    allCss: policy.shellCss(allBoard.mask),
    near,
    rootProject,
    railWidth: policy.RAIL_WIDTH_PX,
    railAttr: policy.RAIL_ATTR,
    warningAttr: policy.FILTER_WARNING_ATTR,
  };
}

async function measure(page) {
  return page.evaluate(() => {
    const shown = (el) => el !== null && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== "hidden";
    const x = (selector) => {
      const el = document.querySelector(selector);
      return el === null ? null : Math.round(el.getBoundingClientRect().x);
    };
    const rail = document.querySelector("[data-bb-workspaces-rail]");
    const railRect = rail?.getBoundingClientRect();
    const side = document.querySelector('[data-side="left"]');
    const pinnedHeader = document.querySelector("[data-sidebar-sticky-header]");
    const rows = [...document.querySelectorAll("[data-sidebar-thread-id]")];
    return {
      sidebarState: side?.getAttribute("data-state") ?? null,
      collapsible: side?.getAttribute("data-collapsible") ?? null,
      railShown: rail !== null && shown(rail) && railRect.right > 0,
      warningShown: shown(document.querySelector("#ws-gate [data-bb-workspaces-filter-warning]")),
      railX: railRect ? Math.round(railRect.x) : null,
      railWidth: railRect ? Math.round(railRect.width) : null,
      railTransition: rail ? getComputedStyle(rail).transition : null,
      gapTransition: (() => {
        const gap = document.querySelector('[data-sidebar="gap"]');
        return gap ? getComputedStyle(gap).transition : null;
      })(),
      mainX: x('[data-sidebar="inset"]'),
      panelX: x('[data-sidebar="panel"]'),
      triggerX: x('[data-testid="app-sidebar-trigger-overlay"]'),
      projects: [...document.querySelectorAll("[data-sidebar-project-id]")]
        .filter(shown)
        .map((el) => el.getAttribute("data-sidebar-project-id")),
      displayedProjects: [...document.querySelectorAll("[data-sidebar-project-id]")]
        .filter((el) => el.getClientRects().length > 0)
        .map((el) => el.getAttribute("data-sidebar-project-id")),
      allProjects: [...document.querySelectorAll("[data-sidebar-project-id]")].map((el) => el.getAttribute("data-sidebar-project-id")),
      threadsGroupShown: shown(document.querySelector('[data-sidebar-visibility-group="threads"]')),
      pinnedHeaderShown: shown(pinnedHeader),
      pinnedRows: pinnedHeader
        ? [...pinnedHeader.querySelectorAll("[data-sidebar-sticky-section] > [data-sidebar-sticky-group] > [data-sidebar-rename-row] [data-sidebar-thread-id]")].map((el) => ({
            id: el.getAttribute("data-sidebar-thread-id"),
            shown: shown(el),
          }))
        : [],
      rows: rows.map((el) => ({ id: el.getAttribute("data-sidebar-thread-id"), shown: shown(el), inPinned: pinnedHeader?.contains(el) ?? false })),
    };
  });
}

// An installed copy of the plugin already shifts and filters BB. Its <style>
// keeps a React-owned text but not a media attribute, and its rail keeps no
// attribute React would restore, so both stay off for this throwaway page.
async function switchOffInstalledCopy(page, railAttr) {
  const count = await page.evaluate((attr) => {
    let found = 0;
    for (const style of document.querySelectorAll("style")) {
      if (style.textContent.includes(`[${attr}]`)) {
        style.media = "not all";
        found += 1;
      }
    }
    for (const rail of document.querySelectorAll(`[${attr}]`)) {
      rail.removeAttribute(attr);
      rail.style.setProperty("display", "none", "important");
      found += 1;
    }
    return found;
  }, railAttr);
  await page.waitForTimeout(600);
  return count;
}

async function mount(page, scenario) {
  await page.evaluate(({ css, id, attr, warningAttr, width }) => {
    const host = document.querySelector("[data-bb-plugin-app-overlays]") ?? document.body;
    const wrap = document.createElement("div");
    wrap.id = id;
    const style = document.createElement("style");
    style.textContent = css;
    const rail = document.createElement("nav");
    rail.setAttribute(attr, "");
    rail.style.cssText = `position: fixed; inset: 0 auto 0 0; width: ${width}px; z-index: 11; flex-direction: column; background: #888`;
    const warning = document.createElement("span");
    warning.setAttribute(warningAttr, "");
    warning.style.cssText = "display: flex; width: 16px; height: 16px; background: red";
    rail.append(warning);
    wrap.append(style, rail);
    host.append(wrap);
  }, { css: scenario.css, id: RAIL_HOST_ID, attr: scenario.railAttr, warningAttr: scenario.warningAttr, width: scenario.railWidth });
  await page.waitForTimeout(600);
}

const renameAttr = (page, from, to, value) =>
  page.evaluate(({ from, to, value }) => {
    for (const el of document.querySelectorAll(value === undefined ? `[${from}]` : `[${from}="${value}"]`)) {
      el.setAttribute(to, el.getAttribute(from));
      el.removeAttribute(from);
    }
  }, { from, to, value });

const restyle = (page, css) =>
  page.evaluate(({ id, css }) => {
    document.querySelector(`#${id} style`).textContent = css;
  }, { id: RAIL_HOST_ID, css });

function checkFilter(label, state, scenario) {
  const expectedProjects = state.allProjects.filter((id) => scenario.near.includes(id));
  check(`${label}: exactly the selected workspace's own projects are visible, unfiled ones hide`, sameList(state.projects, expectedProjects) && expectedProjects.length > 0, { shown: state.projects, expected: expectedProjects });
  check(`${label}: the personal Threads group is hidden`, state.threadsGroupShown === false, state.threadsGroupShown);
  const expectRow = (id) => !scenario.board.mask.hiddenProjects.has(scenario.rootProject[id]);
  if (state.pinnedRows.length === 0) {
    skip(`${label}: pinned handling`, "no pinned threads in this BB");
  } else {
    const wrong = state.pinnedRows.filter((row) => row.shown !== expectRow(row.id));
    check(`${label}: pinned rows follow their root's project`, wrong.length === 0, wrong);
    const headerExpected = state.pinnedRows.some((row) => expectRow(row.id));
    check(`${label}: the Pinned header shows iff a pinned row survives`, state.pinnedHeaderShown === headerExpected, { shown: state.pinnedHeaderShown, headerExpected });
  }
  const wrongRows = state.rows.filter((row) => !row.inPinned && row.shown && !expectRow(row.id));
  check(`${label}: no rendered thread row of a hidden root survives`, wrongRows.length === 0, wrongRows);
}

(async () => {
  const policy = await loadPolicy();
  const browser = await chromium.launch({ executablePath: process.env.CHROME, headless: true });
  const evidence = {};
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await page.goto(BB_URL, { waitUntil: "networkidle" });
    await page.waitForTimeout(3000);
    evidence.installedCopyElementsSwitchedOff = await switchOffInstalledCopy(page, policy.RAIL_ATTR);
    const before = await measure(page);
    evidence["desktop:before"] = before;
    check("desktop: BB's expanded sidebar is present", before.sidebarState === "expanded" && before.allProjects.length > 1, before.sidebarState);
    check("desktop: BB is measured without the plugin (no rail, no shift, every project)", !before.railShown && before.panelX === 0 && sameList(before.projects, before.allProjects), before);
    const scenario = buildScenario(policy, before.allProjects);
    evidence.hiddenProjects = [...scenario.board.mask.hiddenProjects];
    evidence.hiddenRoots = [...scenario.board.mask.hiddenRoots];

    await mount(page, scenario);
    const applied = await measure(page);
    evidence["desktop:applied"] = applied;
    check("desktop: the rail is drawn at the far left, full width", applied.railShown && applied.railX === 0 && applied.railWidth === scenario.railWidth, applied);
    check("desktop: BB's panel, main area and toggle shift right by the rail width", applied.panelX === before.panelX + scenario.railWidth && applied.mainX === before.mainX + scenario.railWidth && applied.triggerX === before.triggerX + scenario.railWidth, applied);
    check("desktop: the rail moves on BB's sidebar transition", applied.railTransition.includes("transform 0.2s linear") && applied.gapTransition.includes("0.2s linear"), { rail: applied.railTransition, gap: applied.gapTransition });
    checkFilter("desktop", applied, scenario);
    check("filter warning: hidden while BB's list has its filter hooks", applied.warningShown === false, applied.warningShown);
    await page.screenshot({ path: path.join(OUT, "gate-desktop.png") });

    await restyle(page, scenario.allCss);
    await page.waitForTimeout(300);
    const allWorkspaces = await measure(page);
    evidence["desktop:all workspaces"] = allWorkspaces;
    check("all workspaces: every project and the Threads group are visible", sameList(allWorkspaces.projects, before.projects) && allWorkspaces.threadsGroupShown === before.threadsGroupShown && allWorkspaces.pinnedHeaderShown === before.pinnedHeaderShown, allWorkspaces.projects);
    check("all workspaces: the rail and the shift stay", allWorkspaces.railShown && allWorkspaces.mainX === applied.mainX, allWorkspaces);
    await restyle(page, scenario.css);
    await page.waitForTimeout(300);

    const settingsBefore = uiPreferences();
    const toggle = page.locator('[data-testid="app-sidebar-trigger-overlay"] button[data-sidebar="trigger"]');
    await toggle.click();
    await page.waitForTimeout(600);
    const collapsed = await measure(page);
    evidence["desktop:collapsed"] = collapsed;
    check("collapse: BB's own toggle collapses the sidebar off-canvas", collapsed.sidebarState === "collapsed" && collapsed.collapsible === "offcanvas", collapsed);
    check("collapse: the rail slides away and no space is reserved", !collapsed.railShown && collapsed.mainX === 0, collapsed);
    check("collapse: the filter stays on the collapsed (visibility: hidden) list", sameList(collapsed.displayedProjects, applied.projects), collapsed.displayedProjects);

    await toggle.click();
    await page.waitForTimeout(100);
    const midway = await page.evaluate(() => {
      const rail = document.querySelector("[data-bb-workspaces-rail]");
      const panel = document.querySelector('[data-sidebar="panel"]');
      return { railRight: Math.round(rail.getBoundingClientRect().right), panelX: Math.round(panel.getBoundingClientRect().x) };
    });
    evidence["desktop:expanding"] = midway;
    check("expand: the rail and the panel are both mid-slide", midway.railRight > 0 && midway.railRight < scenario.railWidth && midway.panelX < scenario.railWidth, midway);
    await page.waitForTimeout(600);
    const reexpanded = await measure(page);
    check("expand: the shifted layout returns", reexpanded.railShown && reexpanded.mainX === applied.mainX && reexpanded.panelX === applied.panelX, reexpanded);
    const settingsAfter = uiPreferences();
    const changed = Object.keys(settingsAfter).filter((key) => JSON.stringify(settingsAfter[key]?.value) !== JSON.stringify(settingsBefore[key]?.value));
    for (const key of changed) {
      const value = settingsBefore[key].value;
      execFileSync("bb", ["settings", "ui", "set", key, typeof value === "string" ? value : JSON.stringify(value)]);
    }
    check("collapse: clicking the toggle changed no server-synced UI setting", changed.length === 0, { changedAndRestored: changed });

    await renameAttr(page, "data-sidebar", "data-sidebar-renamed", "gap");
    await page.waitForTimeout(600);
    const gapRenamed = await measure(page);
    evidence["degrade:gap renamed"] = gapRenamed;
    check("degrade: a renamed layout hook drops the rail and the shift together", !gapRenamed.railShown && gapRenamed.mainX === before.mainX && gapRenamed.panelX === before.panelX, gapRenamed);
    check("degrade: a renamed layout hook keeps the filter", sameList(gapRenamed.projects, applied.projects), gapRenamed.projects);
    await renameAttr(page, "data-sidebar-renamed", "data-sidebar", "gap");

    await renameAttr(page, "data-sidebar-visibility-group", "data-renamed-visibility-group");
    await renameAttr(page, "data-sidebar-sticky-project-item", "data-renamed-project-item");
    await page.waitForTimeout(300);
    const groupsRenamed = await measure(page);
    evidence["degrade:group hooks renamed"] = groupsRenamed;
    check("degrade: renamed project hooks show every project", sameList(groupsRenamed.projects, before.allProjects), groupsRenamed.projects);
    const personalRenamed = await page.evaluate(() => {
      const group = document.querySelector('[data-renamed-visibility-group="threads"]');
      return group === null ? null : group.getClientRects().length > 0;
    });
    check("degrade: a renamed personal group hook shows the Threads group", personalRenamed === true, personalRenamed);
    await renameAttr(page, "data-renamed-visibility-group", "data-sidebar-visibility-group");
    await renameAttr(page, "data-renamed-project-item", "data-sidebar-sticky-project-item");

    await renameAttr(page, "data-sidebar-thread-id", "data-renamed-thread-id");
    await page.waitForTimeout(300);
    const rowsRenamed = await page.evaluate(() => {
      const header = document.querySelector("[data-sidebar-sticky-header]");
      return { headerShown: header === null ? null : header.getClientRects().length > 0 };
    });
    evidence["degrade:thread hook renamed"] = rowsRenamed;
    if (rowsRenamed.headerShown === null) {
      skip("degrade: a renamed thread hook shows the Pinned group", "no pinned group in this BB");
    } else {
      check("degrade: a renamed thread hook shows the Pinned group", rowsRenamed.headerShown === true, rowsRenamed);
    }
    await renameAttr(page, "data-renamed-thread-id", "data-sidebar-thread-id");

    await renameAttr(page, "data-sidebar-visibility-group", "data-renamed-visibility-group");
    await renameAttr(page, "data-sidebar-sticky-project-item", "data-renamed-project-item");
    await renameAttr(page, "data-sidebar-thread-id", "data-renamed-thread-id");
    await page.waitForTimeout(300);
    const hooksGone = await measure(page);
    evidence["degrade:every filter hook renamed"] = { warningShown: hooksGone.warningShown };
    check("filter warning: shown once every filter hook is renamed", hooksGone.warningShown === true, hooksGone.warningShown);
    await renameAttr(page, "data-renamed-visibility-group", "data-sidebar-visibility-group");
    await renameAttr(page, "data-renamed-project-item", "data-sidebar-sticky-project-item");
    await renameAttr(page, "data-renamed-thread-id", "data-sidebar-thread-id");
    await page.waitForTimeout(300);
    const restored = await measure(page);
    check("degrade: restoring the hooks restores the filter", sameList(restored.projects, applied.projects), restored.projects);

    await page.evaluate((id) => document.getElementById(id).remove(), RAIL_HOST_ID);
    await page.waitForTimeout(600);
    const unmounted = await measure(page);
    evidence["desktop:unmounted"] = unmounted;
    check("unmount: BB's layout is exactly as before", unmounted.mainX === before.mainX && unmounted.panelX === before.panelX && unmounted.triggerX === before.triggerX, unmounted);
    check("unmount: every project and the Threads group are back", sameList(unmounted.projects, before.projects) && unmounted.threadsGroupShown === before.threadsGroupShown, unmounted.projects);
    await page.close();

    const compact = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await compact.goto(BB_URL, { waitUntil: "networkidle" });
    await compact.waitForTimeout(3000);
    await switchOffInstalledCopy(compact, policy.RAIL_ATTR);
    const compactBefore = await measure(compact);
    check("compact: BB's drawer list renders every project", sameList(compactBefore.projects, compactBefore.allProjects) && compactBefore.allProjects.length > 1, compactBefore.projects);
    await mount(compact, scenario);
    const compactApplied = await measure(compact);
    evidence["compact:applied"] = compactApplied;
    check("compact: no rail and no shift beside the drawer", !compactApplied.railShown && compactApplied.mainX === compactBefore.mainX && compactApplied.panelX === compactBefore.panelX, compactApplied);
    checkFilter("compact", compactApplied, scenario);
    await compact.close();
  } finally {
    await browser.close();
  }
  fs.writeFileSync(path.join(OUT, "gate-check.json"), `${JSON.stringify({ results, evidence }, null, 1)}\n`);
  const failed = results.filter((result) => !result.ok);
  console.log(`\n${results.length - failed.length}/${results.length} passed${failed.length > 0 ? `, ${failed.length} failed` : ""}`);
  process.exit(failed.length > 0 ? 1 : 0);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
