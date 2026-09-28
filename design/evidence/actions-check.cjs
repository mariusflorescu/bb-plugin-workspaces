const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { chromium } = require(process.env.PW);

const BB_URL = process.env.BB_URL ?? "http://127.0.0.1:38886/";
const OUT = process.env.OUT ?? path.join(__dirname, "..", "..", ".evidence");
fs.mkdirSync(OUT, { recursive: true });
const VERIFY = /^verify-/;
const NAME = "verify-actions";
const ACTIONS = "Edit…|Move up|Move down|Delete…";

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

const tile = (page) => page.locator("[data-bb-workspaces-rail]").getByRole("button", { name: NAME, exact: true });
const openMenus = (page) =>
  page.getByRole("menu").evaluateAll((menus) => menus.map((menu) => [...menu.querySelectorAll('[role="menuitem"]')].map((item) => item.textContent.trim()).join("|")));

async function menusAfter(page, shot, act) {
  await act();
  await page.waitForTimeout(600);
  const menus = await openMenus(page);
  await page.screenshot({ path: path.join(OUT, `actions-${shot}.png`) });
  await page.keyboard.press("Escape");
  await waitFor(() => openMenus(page), (open) => open.length === 0, 2000);
  return menus;
}

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROME, headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const evidence = {};
  let before = null;
  let startSelection;
  try {
    await page.goto(BB_URL, { waitUntil: "domcontentloaded" });
    await page.waitForSelector("[data-bb-workspaces-rail] button[aria-pressed=true]", { timeout: 20000 });
    await deleteVerifyWorkspaces(page);
    const start = await rpc(page, "workspaces_get", null);
    startSelection = start.selectedWorkspaceId;
    before = userView(start);

    await rpc(page, "workspace_save", { id: crypto.randomUUID(), name: NAME, initials: null, color: "#475569", image: null, projectIds: [], select: false });
    await tile(page).click();
    await waitFor(() => tile(page).getAttribute("aria-pressed"), (pressed) => pressed === "true");
    await page.mouse.move(900, 450);
    await page.waitForTimeout(400);

    await tile(page).hover();
    const tooltip = await waitFor(() => page.getByRole("tooltip").allTextContents(), (texts) => texts.length > 0, 3000);
    evidence.tooltip = tooltip;
    check("desktop: the tile's tooltip says right-click for actions", tooltip.some((text) => text.includes(" · right-click for actions")), tooltip);

    const leftClick = await menusAfter(page, "left-click", () => tile(page).click());
    const stillSelected = await tile(page).getAttribute("aria-pressed");
    evidence.leftClick = { menus: leftClick, pressed: stillSelected };
    check("desktop: a left-click on the selected tile opens no menu and keeps it selected", leftClick.length === 0 && stillSelected === "true", evidence.leftClick);

    const rightClick = await menusAfter(page, "right-click", () => tile(page).click({ button: "right" }));
    evidence.rightClick = rightClick;
    check("desktop: a right-click on the selected tile opens its four actions", rightClick.length === 1 && rightClick[0] === ACTIONS, rightClick);

    const shiftF10 = await menusAfter(page, "shift-f10", async () => {
      await tile(page).focus();
      await page.keyboard.press("Shift+F10");
    });
    evidence.shiftF10 = shiftF10;
    check("keyboard: Shift+F10 on the focused tile opens its four actions", shiftF10.length === 1 && shiftF10[0] === ACTIONS, shiftF10);

    const menuKey = await menusAfter(page, "menu-key", async () => {
      await tile(page).focus();
      await page.keyboard.press("ContextMenu");
    });
    evidence.menuKey = menuKey;
    check("keyboard: the Menu key on the focused tile opens its four actions", menuKey.length === 1 && menuKey[0] === ACTIONS, menuKey);
  } catch (error) {
    check("check completed without an exception", false, String(error));
  } finally {
    try {
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
  fs.writeFileSync(path.join(OUT, "actions-check.json"), `${JSON.stringify({ results, evidence }, null, 1)}\n`);
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} passed${failed.length > 0 ? `, ${failed.length} failed` : ""}`);
  process.exit(failed.length > 0 ? 1 : 0);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
