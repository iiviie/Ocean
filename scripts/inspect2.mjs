import puppeteer from "puppeteer-core";
const browser = await puppeteer.launch({ executablePath: "/usr/bin/chromium", headless: "new", args: ["--no-sandbox"] });
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900 });
const logs = [];
page.on("console", (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on("pageerror", (e) => logs.push(`[pageerror] ${e.message}`));
await page.goto("http://localhost:5173/", { waitUntil: "networkidle0" });
await new Promise((r) => setTimeout(r, 600));

// --- 1) click a clip on the timeline to select it ---
const clickedClip = await page.evaluate(() => {
  const clip = [...document.querySelectorAll(".clip")].find((c) => c.textContent?.includes("c1"));
  if (!clip) return "no c1 clip found";
  const r = clip.getBoundingClientRect();
  clip.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, clientX: r.left + 10, clientY: r.top + 10 }));
  return "dispatched mousedown on c1";
});
await new Promise((r) => setTimeout(r, 200));
const sel1 = await page.evaluate(() => ({ sliders: document.querySelectorAll('input[type="range"]').length, inspectorText: document.querySelector(".panel-inspector .panel-body")?.textContent?.slice(0, 40) }));
console.log("after clip mousedown:", clickedClip, JSON.stringify(sel1));

// --- 2) drag the Scale slider (set its value, fire input+change) ---
const sliderTest = await page.evaluate(() => {
  const sliders = [...document.querySelectorAll('input[type="range"]')];
  // find the scale slider by its label text
  const fields = [...document.querySelectorAll(".field")];
  const scaleField = fields.find((f) => f.querySelector("label")?.textContent?.startsWith("Scale"));
  const slider = scaleField?.querySelector('input[type="range"]') ?? sliders[0];
  if (!slider) return "no slider";
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
  setter.call(slider, "2.5");
  slider.dispatchEvent(new Event("input", { bubbles: true }));
  slider.dispatchEvent(new Event("change", { bubbles: true }));
  return "set scale slider to 2.5";
});
await new Promise((r) => setTimeout(r, 200));
const scaleNow = await page.evaluate(() => {
  const c1 = window.ocean.get_canvas_layout(1).objects.find((o) => o.clip === "c1");
  return c1 ? c1.w : null;
});
console.log("slider test:", sliderTest, "-> c1 normalized width now:", scaleNow);

// --- 3) Play button: does it flood and does playhead advance correctly? ---
await page.evaluate(() => [...document.querySelectorAll("button")].find((b) => b.textContent?.includes("Play"))?.click());
const t0 = await page.evaluate(() => window.ocean.recent(1));
await new Promise((r) => setTimeout(r, 1000));
const playInfo = await page.evaluate(() => {
  const log = window.ocean.recent(200);
  const playheadCmds = log.filter((e) => e.diff && e.diff.includes("playhead")).length;
  return { playheadCmds, sample: log.slice(-3) };
});
console.log("after ~1s of Play: playhead dispatches in last 200 log =", playInfo.playheadCmds);
console.log("recent sample:", JSON.stringify(playInfo.sample));

console.log("\n=== page errors (excl. ws) ===");
console.log(logs.filter((l) => !l.includes("7331") && !l.includes("WebSocket")).join("\n") || "(none)");
await browser.close();
