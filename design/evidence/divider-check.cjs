const fs = require("node:fs");
const path = require("node:path");
const { chromium, devices } = require(process.env.PW);

const BB_URL = process.env.BB_URL ?? "http://127.0.0.1:38886/";
const OUT = process.env.OUT ?? path.join(__dirname, "..", "..", ".evidence");
fs.mkdirSync(OUT, { recursive: true });
const FADE_PX = 32;

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

function settled(read) {
  let previous;
  return waitFor(read, (value) => {
    const same = JSON.stringify(value) === previous;
    previous = JSON.stringify(value);
    return same;
  });
}

const railBox = (page, selector) =>
  page.evaluate((selector) => {
    const rail = document.querySelector(selector);
    if (rail === null) return null;
    const box = rail.getBoundingClientRect();
    return { top: Math.round(box.top), bottom: Math.round(box.bottom), right: Math.round(box.right) };
  }, selector);

async function railSettled(page, selector) {
  await waitFor(() => railBox(page, selector), (box) => box !== null, 10000);
  return settled(() => railBox(page, selector));
}

const titleBarRowBottom = (page) =>
  page.evaluate(() => {
    const probe = document.body.appendChild(document.createElement("div"));
    probe.style.cssText = "position:fixed;top:0;height:calc(env(safe-area-inset-top) + var(--bb-app-chrome-row-height))";
    const bottom = Math.round(probe.getBoundingClientRect().bottom);
    probe.remove();
    return bottom;
  });

const darkApplied = (page) => page.evaluate(() => document.documentElement.classList.contains("dark"));

const dividerRows = (page, strip, top) =>
  page.evaluate(
    async ({ base64, top }) => {
      const image = new Image();
      image.src = `data:image/png;base64,${base64}`;
      await image.decode();
      const canvas = document.createElement("canvas");
      canvas.width = image.width;
      canvas.height = image.height;
      const context = canvas.getContext("2d");
      context.drawImage(image, 0, 0);
      const column = (x) => context.getImageData(x, 0, 1, image.height).data;
      const edge = column(image.width - 1);
      const inside = column(0);
      const rows = [];
      for (let row = 0; row < image.height; row += 1) {
        const at = row * 4;
        if ([0, 1, 2, 3].some((channel) => edge[at + channel] !== inside[at + channel])) rows.push(top + row);
      }
      return rows;
    },
    { base64: strip.toString("base64"), top },
  );

async function measure(page, name, selector, titleBarRow) {
  const box = await railSettled(page, selector);
  check(`${name}: the rail is on the page`, box !== null, selector);
  if (box === null) return null;
  const strip = await page.screenshot({ clip: { x: box.right - 4, y: box.top, width: 4, height: box.bottom - box.top } });
  const rows = await dividerRows(page, strip, box.top);
  const detail = { ...box, titleBarRow, dividerFrom: rows[0] ?? null, dividerTo: rows.at(-1) ?? null, rows: rows.length };
  check(`${name}: nothing is drawn at the rail's right edge inside the title-bar row`, rows.length > 0 && rows[0] >= titleBarRow, detail);
  check(
    `${name}: the divider runs from under the fade to the rail's bottom`,
    rows.length >= box.bottom - titleBarRow - FADE_PX && rows[0] <= titleBarRow + FADE_PX && rows.at(-1) === box.bottom - 1,
    detail,
  );
  await page.screenshot({ path: path.join(OUT, `divider-${name}.png`), clip: { x: 0, y: 0, width: 420, height: 180 } });
  return detail;
}

const shelfState = (page) =>
  page.evaluate(() => {
    const panel = document.querySelector('[data-sidebar="panel"][data-vaul-drawer-direction="left"]');
    const tile = panel?.querySelector(":scope > [data-bb-workspaces-shelf-rail] button");
    const tileBox = tile?.getBoundingClientRect();
    const hit = tileBox ? document.elementFromPoint(tileBox.x + tileBox.width / 2, tileBox.y + tileBox.height / 2) : null;
    return { state: panel?.getAttribute("data-state") ?? null, tileReachable: hit !== null && (hit === tile || tile.contains(hit)) };
  });

async function openShelf(page) {
  if ((await shelfState(page)).state !== "open") {
    await page.locator('[data-testid="app-sidebar-trigger-overlay"] button').first().tap();
    await waitFor(() => shelfState(page), (s) => s.state === "open" && s.tileReachable);
  }
  return shelfState(page);
}

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROME, headless: true });
  const evidence = {};
  try {
    for (const scheme of ["light", "dark"]) {
      const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, colorScheme: scheme });
      await page.goto(BB_URL, { waitUntil: "networkidle" });
      const titleBarRow = await titleBarRowBottom(page);
      check(`${scheme}: BB sets the title-bar row height`, titleBarRow > 0, titleBarRow);
      evidence[scheme] = await measure(page, scheme, "[data-bb-workspaces-rail]", titleBarRow);
      check(`${scheme}: BB applied the ${scheme} theme`, (await darkApplied(page)) === (scheme === "dark"), scheme);
      await page.close();
    }

    const phone = await browser.newPage({ ...devices["iPhone 13"], deviceScaleFactor: 1 });
    await phone.goto(BB_URL, { waitUntil: "networkidle" });
    const shelf = await openShelf(phone);
    check("shelf: BB's sidebar opened with the rail inside", shelf.state === "open" && shelf.tileReachable, shelf);
    evidence.shelf = await measure(phone, "shelf", "[data-bb-workspaces-shelf-rail]", await titleBarRowBottom(phone));
    await phone.close();
  } finally {
    await browser.close();
  }
  fs.writeFileSync(path.join(OUT, "divider-check.json"), `${JSON.stringify({ results, evidence }, null, 1)}\n`);
  const failed = results.filter((result) => !result.ok);
  console.log(`\n${results.length - failed.length}/${results.length} passed${failed.length > 0 ? `, ${failed.length} failed` : ""}`);
  process.exit(failed.length > 0 ? 1 : 0);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
