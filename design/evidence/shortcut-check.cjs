const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { chromium } = require(process.env.PW);

const BB_URL = process.env.BB_URL ?? "http://127.0.0.1:38886/";
const OUT = process.env.OUT ?? path.join(__dirname, "..", "..", ".evidence");
fs.mkdirSync(OUT, { recursive: true });
const VERIFY = /^verify-/;
const MARK = "data-bb-workspaces-overflow";
const ALL = "All workspaces";

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok: Boolean(ok), detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : `\n      ${JSON.stringify(detail)}`}`);
}

async function waitFor(read, predicate, timeout = 4000) {
  const start = Date.now();
  let value = await read();
  while (!predicate(value) && Date.now() - start < timeout) {
    await new Promise((resolve) => setTimeout(resolve, 100));
    value = await read();
  }
  return value;
}

const rpc = (page, method, input) =>
  page.evaluate(
    async ({ method, input }) => {
      const response = await fetch(`/api/v1/plugins/workspaces/rpc/${method}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(input),
      });
      const body = await response.json();
      if (!body.ok) throw new Error(`${method}: ${JSON.stringify(body.error)}`);
      return body.result;
    },
    { method, input },
  );

const userView = (doc) => ({
  workspaces: doc.workspaces.filter((w) => !VERIFY.test(w.name)),
  memberships: doc.memberships.filter((m) => !doc.workspaces.some((w) => w.id === m.workspaceId && VERIFY.test(w.name))),
});

async function deleteVerifyWorkspaces(page) {
  const doc = await rpc(page, "workspaces_get", null);
  for (const workspace of doc.workspaces.filter((w) => VERIFY.test(w.name))) {
    await rpc(page, "workspace_delete", { id: workspace.id });
  }
}

const tiles = (page) =>
  page.evaluate(() =>
    [...document.querySelectorAll("[data-bb-workspaces-rail] button[aria-pressed]")]
      .map((button) => ({ name: button.getAttribute("aria-label"), pressed: button.getAttribute("aria-pressed") === "true" }))
      .filter((tile) => tile.name !== "New workspace"),
  );
const pressed = async (page) => (await tiles(page)).find((tile) => tile.pressed)?.name ?? null;

async function pick(page, name) {
  if ((await pressed(page)) !== name) {
    await page.locator("[data-bb-workspaces-rail]").getByRole("button", { name, exact: true }).click();
  }
  await waitFor(() => pressed(page), (current) => current === name);
  await page.mouse.move(900, 450);
  await page.waitForTimeout(600);
}

const rows = (page) =>
  page.evaluate(() =>
    [...document.querySelectorAll("[data-sidebar-thread-shortcut-target]")].map((anchor) => ({
      id: anchor.getAttribute("data-sidebar-thread-id"),
      visible: anchor.checkVisibility(),
      badge: anchor.getAttribute("aria-keyshortcuts"),
    })),
  );

async function badgesWhileHoldingControl(page, shot) {
  await page.keyboard.down("Control");
  await page.waitForTimeout(900);
  const seen = await rows(page);
  await page.screenshot({ path: path.join(OUT, `shortcuts-${shot}.png`) });
  await page.keyboard.up("Control");
  return seen.filter((row) => row.badge !== null).map((row) => ({ ...row, n: Number(row.badge.match(/(\d+)$/)?.[1]) }));
}

async function openPage(page, route) {
  await page.goto(new URL(route, BB_URL).href, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("[data-bb-workspaces-rail] button[aria-pressed=true]", { timeout: 20000 });
  await waitFor(() => rows(page), (seen) => seen.length > 0, 10000);
  await page.waitForTimeout(500);
}

const currentThread = async (page) => {
  const route = await page.evaluate(() => location.pathname);
  const match = route.match(/\/threads\/([^/]+)/);
  const id = match === null ? null : match[1];
  const projectId = id === null ? null : await page.evaluate(async (id) => (await (await fetch(`/api/v1/threads/${id}`)).json()).projectId, id);
  return { route, id, projectId, rail: await pressed(page) };
};

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROME, headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const evidence = {};
  let before = null;
  let startSelection;
  try {
    await openPage(page, "/");
    await deleteVerifyWorkspaces(page);
    const start = await rpc(page, "workspaces_get", null);
    startSelection = start.selectedWorkspaceId;
    before = userView(start);
    const apple = await page.evaluate(() => /Mac|iPhone|iPad|iPod/.test(navigator.platform));
    const mod = apple ? "Meta" : "Control";
    const say = (key) => (apple ? `⌥⌘${key}` : `Ctrl+Alt+${key}`);
    evidence.platform = { apple, mod };

    const empty = { id: crypto.randomUUID(), name: "verify-shortcuts-empty", initials: null, color: "#475569", image: null, projectIds: [], select: false };
    await rpc(page, "workspace_save", empty);
    await pick(page, empty.name);
    const emptyBadges = await badgesWhileHoldingControl(page, "empty-hold");
    evidence.emptyBadges = emptyBadges;
    check("empty workspace: holding ⌃ numbers no thread", emptyBadges.length === 0, emptyBadges);
    await page.keyboard.press("Control+1");
    await page.waitForTimeout(1000);
    const afterEmptyJump = { path: await page.evaluate(() => location.pathname), rail: await pressed(page) };
    check("empty workspace: ⌃1 opens nothing and the rail stays on it", afterEmptyJump.path === "/" && afterEmptyJump.rail === empty.name, afterEmptyJump);
    await rpc(page, "workspace_delete", { id: empty.id });
    await openPage(page, "/");

    const doc = await rpc(page, "workspaces_get", null);
    const real = doc.workspaces.filter((w) => !VERIFY.test(w.name));
    evidence.candidates = [];
    let fixture = null;
    for (const workspace of real) {
      await pick(page, workspace.name);
      const seen = await rows(page);
      const visible = seen.filter((row) => row.visible);
      const hidden = seen.filter((row) => !row.visible);
      evidence.candidates.push({ workspace: workspace.name, visibleRows: visible.length, hiddenRows: hidden.length });
      if (hidden.length > 0 && visible.length > 0) {
        fixture = { workspace, visible };
        break;
      }
    }
    check(
      "fixture: a workspace hides at least one numbered thread row and shows at least one",
      fixture !== null,
      "no fixture: no workspace hides a [data-sidebar-thread-shortcut-target] row while showing one; pin a thread of another workspace's project, or file a project with threads into a second workspace",
    );

    if (fixture !== null) {
      const { workspace, visible } = fixture;
      const own = new Set(doc.memberships.filter((m) => m.workspaceId === workspace.id).map((m) => m.projectId));
      const inside = (at) => at.id !== null && own.has(at.projectId) && at.rail === workspace.name;
      evidence.fixture = { workspace: workspace.name, visibleRows: visible.map((row) => row.id) };

      const marks = await page.evaluate((mark) => {
        const all = [...document.querySelectorAll(`[${mark}]`)];
        return { inSidebar: all.filter((el) => el.closest('[data-sidebar="panel"]') !== null).length, elsewhere: all.filter((el) => el.closest('[data-sidebar="panel"]') === null).length };
      }, MARK);
      evidence.marks = marks;
      check("marks: no element outside BB's sidebar carries the plugin's overflow mark", marks.elsewhere === 0, marks);

      const badges = await badgesWhileHoldingControl(page, "workspace-hold");
      evidence.workspaceBadges = badges;
      check(
        "workspace: holding ⌃ numbers only the rows it shows, 1 to n from the top",
        badges.length === Math.min(9, visible.length) && badges.every((badge, index) => badge.visible && badge.n === index + 1),
        { badges, visibleRows: visible.length },
      );

      await page.keyboard.press("Control+1");
      const jumped = await waitFor(() => currentThread(page), (at) => at.id !== null, 3000);
      await page.waitForTimeout(600);
      const jumpedSettled = await currentThread(page);
      evidence.controlOne = { expected: visible[0].id, ...jumpedSettled };
      check("workspace: ⌃1 opens the first thread it shows and the rail stays on it", jumped.id === visible[0].id && jumpedSettled.rail === workspace.name, evidence.controlOne);

      const first = visible[0].id;
      const last = visible.at(-1).id;
      await openPage(page, `threads/${first}`);
      await pick(page, workspace.name);
      await page.keyboard.press("Control+Shift+BracketLeft");
      await page.waitForTimeout(1200);
      const previous = await currentThread(page);
      evidence.previousFromFirst = { from: first, ...previous };
      check("workspace: ⌃⇧[ from its first thread stays inside it", inside(previous), evidence.previousFromFirst);

      await openPage(page, `threads/${last}`);
      await pick(page, workspace.name);
      await page.keyboard.press("Control+Shift+BracketRight");
      await page.waitForTimeout(1200);
      const next = await currentThread(page);
      evidence.nextFromLast = { from: last, ...next };
      check("workspace: ⌃⇧] from its last thread stays inside it", inside(next), evidence.nextFromLast);
      await page.screenshot({ path: path.join(OUT, "shortcuts-after-step.png") });
    }

    await openPage(page, "/");
    const order = (await tiles(page)).map((tile) => tile.name);
    evidence.railOrder = order;
    check("rail: there is a workspace to switch to", order.length >= 2, order);
    if (order.length >= 2) {
      if ((await pressed(page)) === ALL) await pick(page, order[1]);
      const chord = async (key, expected) => {
        await page.keyboard.press(`Alt+${mod}+${key}`);
        return waitFor(() => pressed(page), (current) => current === expected, 2000);
      };
      const toAll = await chord("Digit1", ALL);
      check(`rail: ${say("1")} selects All workspaces`, toAll === ALL, toAll);
      const toFirst = await chord("Digit2", order[1]);
      check(`rail: ${say("2")} selects the first workspace tile`, toFirst === order[1], { expected: order[1], got: toFirst });
      const below = order[2] ?? ALL;
      const down = await chord("ArrowDown", below);
      check(`rail: ${say("↓")} steps down the rail`, down === below, { expected: below, got: down });
      const up = await chord("ArrowUp", order[1]);
      check(`rail: ${say("↑")} steps back up`, up === order[1], { expected: order[1], got: up });
    }
  } catch (error) {
    check("check completed without an exception", false, String(error));
  } finally {
    try {
      await openPage(page, "/");
      await deleteVerifyWorkspaces(page);
      if (startSelection !== undefined) await rpc(page, "selection_set", { id: startSelection });
      const after = await rpc(page, "workspaces_get", null);
      check(
        "cleanup: no verify-* workspace is left and the selection is back where it started",
        !after.workspaces.some((w) => VERIFY.test(w.name)) && after.selectedWorkspaceId === startSelection,
        { names: after.workspaces.map((w) => w.name), selected: after.selectedWorkspaceId, startSelection },
      );
      if (before !== null) {
        check("cleanup: the user's own workspaces and filings are exactly as before", JSON.stringify(userView(after)) === JSON.stringify(before), { before, after: userView(after) });
      }
    } catch (error) {
      check("cleanup ran", false, String(error));
    }
    await browser.close();
  }
  fs.writeFileSync(path.join(OUT, "shortcut-check.json"), `${JSON.stringify({ results, evidence }, null, 1)}\n`);
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} passed${failed.length > 0 ? `, ${failed.length} failed` : ""}`);
  process.exit(failed.length > 0 ? 1 : 0);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
