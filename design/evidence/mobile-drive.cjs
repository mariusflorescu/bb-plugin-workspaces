const fs = require("node:fs");
const path = require("node:path");
const { chromium, devices } = require(process.env.PW);

const BB_URL = process.env.BB_URL ?? "http://127.0.0.1:38886/";
const OUT = process.env.OUT ?? path.join(__dirname, "..", "..", ".evidence");
fs.mkdirSync(OUT, { recursive: true });
const VERIFY = /^verify-/;

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

async function cleanUp(page) {
  const doc = await rpc(page, "workspaces_get", null);
  for (const workspace of doc.workspaces.filter((w) => VERIFY.test(w.name))) {
    await rpc(page, "workspace_delete", { id: workspace.id });
  }
  await rpc(page, "selection_set", { id: null });
}

async function touchDrag(cdp, from, to, steps = 8) {
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: from.x, y: from.y }] });
  for (let step = 1; step <= steps; step += 1) {
    const x = from.x + ((to.x - from.x) * step) / steps;
    const y = from.y + ((to.y - from.y) * step) / steps;
    await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x, y }] });
  }
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
}

const shelfState = (page) =>
  page.evaluate(() => {
    const panel = document.querySelector('[data-sidebar="panel"][data-vaul-drawer-direction="left"]');
    const rail = panel?.querySelector(":scope > [data-bb-workspaces-shelf-rail]");
    const content = panel?.querySelector(':scope > [data-sidebar="sidebar"]');
    const box = (el) => el && (({ x, y, width, height }) => ({ x: Math.round(x), y: Math.round(y), w: Math.round(width), h: Math.round(height) }))(el.getBoundingClientRect());
    const tile = rail?.querySelector("button");
    const tileBox = tile?.getBoundingClientRect();
    const hit = tileBox ? document.elementFromPoint(tileBox.x + tileBox.width / 2, tileBox.y + tileBox.height / 2) : null;
    return {
      state: panel?.getAttribute("data-state") ?? null,
      inert: panel?.hasAttribute("inert") ?? null,
      rail: box(rail),
      content: box(content),
      mainX: Math.round(document.querySelector('main[data-sidebar="inset"]').getBoundingClientRect().x),
      tiles: rail ? [...rail.querySelectorAll("button[aria-label]")].map((b) => ({ name: b.getAttribute("aria-label"), pressed: b.getAttribute("aria-pressed") })) : [],
      tileReachable: hit !== null && tile !== undefined && (hit === tile || tile.contains(hit)),
    };
  });

async function sampleSlide(page, act) {
  await page.evaluate(() => {
    window.__slide = [];
    const main = document.querySelector('main[data-sidebar="inset"]');
    const rail = document.querySelector("[data-bb-workspaces-shelf-rail]");
    const tick = () => {
      window.__slide.push({ main: Math.round(main.getBoundingClientRect().x), rail: rail ? Math.round(rail.getBoundingClientRect().x) : null });
      if (window.__slide.length < 45) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  await act();
  await page.waitForTimeout(900);
  return page.evaluate(() => window.__slide);
}

const monotonic = (xs, direction) => xs.every((x, i) => i === 0 || (direction > 0 ? x >= xs[i - 1] : x <= xs[i - 1]));

async function openShelf(page) {
  if ((await shelfState(page)).state !== "open") {
    await page.locator('[data-testid="app-sidebar-trigger-overlay"] button').first().tap();
    await waitFor(() => shelfState(page), (s) => s.state === "open" && s.tileReachable);
  }
}

const tile = (page, name) => page.locator(`[data-bb-workspaces-shelf-rail] button[aria-label="${name}"]`);
const inViewport = (box, height) => box !== null && box.y >= 0 && box.y + box.height <= height + 1;

async function createWorkspace(page, name) {
  await openShelf(page);
  await tile(page, "New workspace").tap();
  const dialog = page.getByRole("dialog", { name: "New workspace" });
  await dialog.waitFor();
  await dialog.getByLabel("Name").tap();
  await page.keyboard.type(name);
  return dialog;
}

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROME, headless: true });
  const context = await browser.newContext({ ...devices["iPhone 13"] });
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  const evidence = {};
  const shot = (name) => page.screenshot({ path: path.join(OUT, `mobile-${name}.png`) });
  let before = null;
  try {
    await page.goto(BB_URL, { waitUntil: "networkidle" });
    await page.waitForTimeout(3000);
    await cleanUp(page);
    before = userView(await rpc(page, "workspaces_get", null));
    const height = page.viewportSize().height;

    const closed = await shelfState(page);
    evidence.closed = closed;
    check("shelf closed: the rail sits inside BB's panel, inert and covered by main", closed.rail !== null && closed.inert === true && closed.mainX === 0 && !closed.tileReachable, closed);

    const opening = await sampleSlide(page, () => page.locator('[data-testid="app-sidebar-trigger-overlay"] button').first().tap());
    const open = await waitFor(() => shelfState(page), (s) => s.state === "open" && s.tileReachable);
    evidence.opening = opening;
    evidence.open = open;
    check("shelf open: the rail is the first column, BB's content starts at its right edge", open.rail?.x === 0 && open.rail?.w === 56 && open.content?.x === 56 && open.tileReachable, open);
    check("shelf open: BB's main slides once, without stalling or reversing, and the rail never moves", monotonic(opening.map((f) => f.main), 1) && opening.every((f) => f.rail === 0) && opening.at(-1).main === open.mainX, opening.map((f) => f.main));
    check("shelf open: the rail lists All workspaces, the user's workspaces and +", open.tiles[0]?.name === "All workspaces" && open.tiles.at(-1)?.name === "New workspace" && before.workspaces.every((w) => open.tiles.some((t) => t.name === w.name)), open.tiles);
    check("shelf open: the footer switcher is still there", (await page.locator('[data-sidebar="panel"] button[aria-label="Workspaces"]').count()) > 0, null);
    await shot("shelf-open");

    const editor = await createWorkspace(page, "verify-mobile-a");
    const sheetBox = await editor.boundingBox();
    const save = editor.getByRole("button", { name: "Create workspace" });
    check("editor: opens as a bottom sheet with Save in view", sheetBox !== null && Math.round(sheetBox.y + sheetBox.height) >= height - 1 && inViewport(await save.boundingBox(), height), { sheetBox, save: await save.boundingBox() });
    await shot("editor");

    await page.setViewportSize({ width: 390, height: 380 });
    await page.waitForTimeout(400);
    check("editor: with the viewport resized for a keyboard, Save stays in view", inViewport(await save.boundingBox(), 380), await save.boundingBox());
    await page.setViewportSize({ width: 390, height });
    await page.waitForTimeout(300);
    await page.evaluate(() => {
      Object.defineProperty(window.visualViewport, "height", { configurable: true, get: () => 360 });
      window.visualViewport.dispatchEvent(new Event("resize"));
    });
    await page.waitForTimeout(400);
    check("editor: with an iOS keyboard over the page, Save stays above it", inViewport(await save.boundingBox(), 360), await save.boundingBox());
    await shot("editor-keyboard");
    await page.evaluate(() => {
      delete window.visualViewport.height;
      window.visualViewport.dispatchEvent(new Event("resize"));
    });
    await page.waitForTimeout(300);

    const colorButton = editor.getByRole("button", { name: /^Color #/ });
    await colorButton.tap();
    const colorSheet = page.getByRole("dialog", { name: "Workspace color" });
    await colorSheet.getByRole("radiogroup", { name: "Preset colors" }).waitFor();
    const width = page.viewportSize().width;
    const onScreen = (s) => s.x >= 0 && s.x + s.width <= width && s.y >= 0 && s.y + s.height <= height;
    const swatches = await waitFor(
      () => colorSheet.getByRole("radio").evaluateAll((radios) => radios.map((r) => (({ x, y, width, height }) => ({ x, y, width, height }))(r.getBoundingClientRect()))),
      (all) => all.length === 12 && all.every(onScreen),
    );
    check("color sheet: all 12 swatches are fully on screen once the sheet settles", swatches.length === 12 && swatches.every(onScreen), swatches);
    await shot("color-sheet");
    await colorSheet.getByRole("radio", { name: "#0d9488" }).tap();
    await colorSheet.waitFor({ state: "hidden" });
    check("color sheet: tapping a preset applies it and closes the sheet", (await colorButton.getAttribute("aria-label")) === "Color #0d9488", await colorButton.getAttribute("aria-label"));

    await colorButton.tap();
    await colorSheet.waitFor();
    const saturation = await colorSheet.locator(".react-colorful__saturation").boundingBox();
    check("color sheet: the custom picker fits the screen", saturation !== null && saturation.x >= 0 && saturation.x + saturation.width <= width, saturation);
    await touchDrag(cdp, { x: saturation.x + 10, y: saturation.y + 10 }, { x: saturation.x + saturation.width * 0.8, y: saturation.y + saturation.height * 0.5 });
    await page.waitForTimeout(200);
    const dragged = await colorButton.getAttribute("aria-label");
    check("color sheet: a touch drag on the picker changes the color", dragged !== "Color #0d9488" && /^Color #[0-9a-f]{6}$/.test(dragged), dragged);
    const hex = colorSheet.getByRole("textbox", { name: "Hex color" });
    await hex.tap();
    await hex.fill("");
    await page.keyboard.type("123abc");
    await page.waitForTimeout(200);
    check("color sheet: a typed hex applies", (await colorButton.getAttribute("aria-label")) === "Color #123abc", await colorButton.getAttribute("aria-label"));
    await page.keyboard.press("Escape");
    await colorSheet.waitFor({ state: "hidden" });

    const logo = await page.screenshot({ clip: { x: 0, y: 0, width: 300, height: 180 } });
    await page.setInputFiles("#workspace-image", { name: "logo.png", mimeType: "image/png", buffer: logo });
    const preview = editor.locator("img[src^='data:image/']");
    await preview.waitFor({ timeout: 4000 });
    check("image: a picked file is cropped into the preview and can be removed", (await preview.count()) > 0 && (await editor.getByRole("button", { name: "Remove" }).count()) === 1, null);

    const projects = editor.getByRole("list", { name: "Projects" });
    const listBox = await projects.boundingBox();
    const scroll = await projects.evaluate((list) => ({ scrollHeight: list.scrollHeight, clientHeight: list.clientHeight }));
    await touchDrag(cdp, { x: listBox.x + listBox.width / 2, y: listBox.y + listBox.height - 12 }, { x: listBox.x + listBox.width / 2, y: listBox.y + 12 });
    await page.waitForTimeout(300);
    const scrolled = await projects.evaluate((list) => list.scrollTop);
    check("projects: the checklist scrolls by touch", scroll.scrollHeight > scroll.clientHeight && scrolled > 0, { ...scroll, scrolled });

    await save.tap();
    await editor.waitFor({ state: "hidden" });
    check("editor: Save creates the workspace, confirms it and closes", (await page.getByText("Saved verify-mobile-a").count()) > 0, null);
    await openShelf(page);
    const afterCreate = await waitFor(() => shelfState(page), (s) => s.tiles.some((t) => t.name === "verify-mobile-a" && t.pressed === "true"));
    check("create: the new workspace is in the shelf rail and selected", afterCreate.tiles.some((t) => t.name === "verify-mobile-a" && t.pressed === "true"), afterCreate.tiles);

    const second = await createWorkspace(page, "verify-mobile-b");
    await second.getByRole("button", { name: "Create workspace" }).tap();
    await second.waitFor({ state: "hidden" });
    await openShelf(page);
    await waitFor(() => shelfState(page), (s) => s.tiles.some((t) => t.name === "verify-mobile-b" && t.pressed === "true"));
    const order = async () => (await shelfState(page)).tiles.map((t) => t.name).filter((n) => VERIFY.test(n));

    await tile(page, "verify-mobile-b").tap();
    const actions = page.getByRole("menu", { name: "verify-mobile-b actions" });
    await actions.waitFor();
    check("touch: tapping the selected tile opens its actions", (await actions.getByRole("menuitem").allTextContents()).map((t) => t.trim()).join("|") === "Edit…|Move up|Move down|Delete…", await actions.getByRole("menuitem").allTextContents());
    await shot("tile-actions");
    await actions.getByRole("menuitem", { name: "Move up" }).tap();
    await openShelf(page);
    const movedUp = await waitFor(order, (o) => o[0] === "verify-mobile-b");
    check("touch: Move up reorders the rail", movedUp.join(",") === "verify-mobile-b,verify-mobile-a", movedUp);
    await tile(page, "verify-mobile-b").tap();
    await actions.waitFor();
    await actions.getByRole("menuitem", { name: "Move down" }).tap();
    await openShelf(page);
    const movedDown = await waitFor(order, (o) => o[0] === "verify-mobile-a");
    check("touch: Move down reorders it back", movedDown.join(",") === "verify-mobile-a,verify-mobile-b", movedDown);

    await tile(page, "verify-mobile-b").tap();
    await actions.waitFor();
    await actions.getByRole("menuitem", { name: "Edit…" }).tap();
    const edit = page.getByRole("dialog", { name: "Edit verify-mobile-b" });
    await edit.waitFor();
    await edit.getByLabel("Initials").tap();
    await page.keyboard.type("VB");
    await edit.getByRole("button", { name: "Save" }).tap();
    await edit.waitFor({ state: "hidden" });
    const edited = await waitFor(() => rpc(page, "workspaces_get", null), (d) => d.workspaces.some((w) => w.name === "verify-mobile-b" && w.initials === "VB"));
    check("touch: Edit from the actions saves", edited.workspaces.some((w) => w.name === "verify-mobile-b" && w.initials === "VB"), edited.workspaces.map((w) => [w.name, w.initials]));

    await openShelf(page);
    await tile(page, "verify-mobile-a").tap();
    const switched = await waitFor(() => shelfState(page), (s) => s.tiles.some((t) => t.name === "verify-mobile-a" && t.pressed === "true"), 2000);
    check("touch: one tap on another tile switches to it (no tooltip in the way)", switched.tiles.some((t) => t.name === "verify-mobile-a" && t.pressed === "true"), switched.tiles);
    await tile(page, "All workspaces").tap();
    const all = await waitFor(() => shelfState(page), (s) => s.tiles[0]?.pressed === "true", 2000);
    check("touch: one tap on All workspaces switches back", all.tiles[0]?.pressed === "true", all.tiles);

    await tile(page, "verify-mobile-a").tap();
    await waitFor(() => shelfState(page), (s) => s.tiles.some((t) => t.name === "verify-mobile-a" && t.pressed === "true"));
    await tile(page, "verify-mobile-a").tap();
    const actionsA = page.getByRole("menu", { name: "verify-mobile-a actions" });
    await actionsA.waitFor();
    await actionsA.getByRole("menuitem", { name: "Delete…" }).tap();
    const confirmA = page.getByRole("alertdialog", { name: "Delete verify-mobile-a?" });
    await confirmA.waitFor();
    await confirmA.getByRole("button", { name: "Delete workspace" }).tap();
    await confirmA.waitFor({ state: "hidden" });
    await openShelf(page);
    const goneA = await waitFor(() => shelfState(page), (s) => !s.tiles.some((t) => t.name === "verify-mobile-a"));
    check("touch: Delete from the actions removes the workspace", !goneA.tiles.some((t) => t.name === "verify-mobile-a"), goneA.tiles);

    await tile(page, "verify-mobile-b").tap();
    await waitFor(() => shelfState(page), (s) => s.tiles.some((t) => t.name === "verify-mobile-b" && t.pressed === "true"));
    await tile(page, "verify-mobile-b").tap();
    await actions.waitFor();
    await actions.getByRole("menuitem", { name: "Edit…" }).tap();
    await edit.waitFor();
    await edit.getByRole("button", { name: "Delete…" }).tap();
    const confirmB = page.getByRole("alertdialog", { name: "Delete verify-mobile-b?" });
    await confirmB.waitFor();
    await confirmB.getByRole("button", { name: "Delete workspace" }).tap();
    await confirmB.waitFor({ state: "hidden" });
    const docAfter = await waitFor(() => rpc(page, "workspaces_get", null), (d) => !d.workspaces.some((w) => VERIFY.test(w.name)));
    check("touch: Delete from the edit sheet removes the workspace", !docAfter.workspaces.some((w) => VERIFY.test(w.name)), docAfter.workspaces.map((w) => w.name));

    await openShelf(page);
    const peek = (await shelfState(page)).mainX + 20;
    const closing = await sampleSlide(page, () => page.touchscreen.tap(Math.min(peek, 385), 400));
    const shut = await shelfState(page);
    evidence.closing = closing;
    check("shelf close: main slides back once and covers the rail again", monotonic(closing.map((f) => f.main), -1) && shut.mainX === 0 && !shut.tileReachable && shut.inert === true, { slide: closing.map((f) => f.main), shut });
  } catch (error) {
    check("drive completed without an exception", false, String(error));
  } finally {
    try {
      await cleanUp(page);
      const after = await rpc(page, "workspaces_get", null);
      check("cleanup: no verify-* workspace is left and the selection is All workspaces", !after.workspaces.some((w) => VERIFY.test(w.name)) && after.selectedWorkspaceId === null, { names: after.workspaces.map((w) => w.name), selected: after.selectedWorkspaceId });
      if (before !== null) {
        check("cleanup: the user's own workspaces and filings are exactly as before", JSON.stringify(userView(after)) === JSON.stringify(before), { before, after: userView(after) });
      }
    } catch (error) {
      check("cleanup ran", false, String(error));
    }
    await browser.close();
  }
  fs.writeFileSync(path.join(OUT, "mobile-drive.json"), `${JSON.stringify({ results, evidence }, null, 1)}\n`);
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} passed${failed.length > 0 ? `, ${failed.length} failed` : ""}`);
  process.exit(failed.length > 0 ? 1 : 0);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
