import puppeteer from "puppeteer-core";

const EXEC = "/usr/bin/chromium";
const URL = "http://localhost:5173/";

const browser = await puppeteer.launch({
  executablePath: EXEC,
  headless: "new",
  args: ["--no-sandbox", "--disable-setuid-sandbox"],
});
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900 });

const logs = [];
page.on("console", (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on("pageerror", (e) => logs.push(`[pageerror] ${e.message}`));
page.on("requestfailed", (r) => logs.push(`[reqfail] ${r.url()} ${r.failure()?.errorText}`));

await page.goto(URL, { waitUntil: "networkidle0", timeout: 15000 });
await new Promise((r) => setTimeout(r, 800));

// 1) does the agent bridge exist + project load?
const proj = await page.evaluate(() => (window.ocean ? window.ocean.get_project() : null));
console.log("get_project():", JSON.stringify(proj));

// 2) count buttons + check pointer-events on what sits under the title-bar buttons
const ui = await page.evaluate(() => {
  const btns = [...document.querySelectorAll("button")];
  const sliders = [...document.querySelectorAll('input[type="range"]')];
  // what element is actually at the center of the first titlebar button?
  const probe = (sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return { rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }, topTag: top?.tagName, topClass: top?.className, isSelf: top === el || el.contains(top) };
  };
  return {
    buttonCount: btns.length,
    sliderCount: sliders.length,
    titlebarBtn: probe(".titlebar .actions button"),
    addVideoBtn: probe(".timeline-toolbar button:nth-child(4)"),
  };
});
console.log("ui probe:", JSON.stringify(ui, null, 2));

// 3) actually try clicking "+Video" and see if a track is added
const before = await page.evaluate(() => window.ocean.get_project().tracks);
try {
  // click the +Video button by text
  await page.evaluate(() => {
    const b = [...document.querySelectorAll("button")].find((x) => x.textContent?.includes("+Video"));
    b?.click();
  });
  await new Promise((r) => setTimeout(r, 300));
} catch (e) {
  console.log("click error", e.message);
}
const after = await page.evaluate(() => window.ocean.get_project().tracks);
console.log(`tracks before=${before} after=${after} (click ${after > before ? "WORKED" : "DID NOT register"})`);

await page.screenshot({ path: "/tmp/ocean-shot.png" });
console.log("screenshot -> /tmp/ocean-shot.png");

console.log("\n=== console/errors ===");
console.log(logs.join("\n") || "(none)");

await browser.close();
