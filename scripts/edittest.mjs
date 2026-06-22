import puppeteer from "puppeteer-core";
const b = await puppeteer.launch({ executablePath: "/usr/bin/chromium", headless: "new", args: ["--no-sandbox"] });
const p = await b.newPage();
await p.setViewport({ width: 1440, height: 900 });
const errs = [];
p.on("pageerror", (e) => errs.push(e.message));
await p.goto("http://localhost:5173/", { waitUntil: "networkidle0" });
await new Promise((r) => setTimeout(r, 700));

const v1count = () => p.evaluate(() => window.ocean.get_timeline().find((t) => t.id === "t1").clips.length);
const c1start = () => p.evaluate(() => window.ocean.get_timeline().find((t) => t.id === "t1").clips.find((c) => c.id === "c1")?.in);

// --- SPLIT: playhead to 2s, select c1, click scissors ---
await p.evaluate(() => window.ocean.dispatch({ type: "set_playhead", atTicks: 2 * 600 }));
await p.evaluate(() => document.querySelector('[title="c1"]')?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true })));
await new Promise((r) => setTimeout(r, 100));
const beforeSplit = await v1count();
await p.evaluate(() => [...document.querySelectorAll("button")].find((b) => b.title?.startsWith("Split"))?.click());
await new Promise((r) => setTimeout(r, 150));
const afterSplit = await v1count();
console.log(`SPLIT: v1 clips ${beforeSplit} -> ${afterSplit} ${afterSplit === beforeSplit + 1 ? "✓" : "✗"}`);
console.log("  structuredClone errors:", errs.filter((e) => e.includes("structuredClone")).length === 0 ? "none ✓" : "STILL PRESENT ✗");

// --- MOVE: drag c1 right by ~80px ---
const beforeMove = await c1start();
const box = await p.evaluate(() => {
  const el = document.querySelector('[title="c1"]');
  const r = el.getBoundingClientRect();
  return { x: r.left + 30, y: r.top + r.height / 2 };
});
await p.mouse.move(box.x, box.y);
await p.mouse.down();
await p.mouse.move(box.x + 80, box.y, { steps: 8 });
await p.mouse.up();
await new Promise((r) => setTimeout(r, 150));
const afterMove = await c1start();
console.log(`MOVE: c1 start ${beforeMove}s -> ${afterMove}s ${afterMove > beforeMove ? "✓ moved" : "✗ no move"}`);

// --- DELETE: select c2, press Delete ---
const beforeDel = await v1count();
await p.evaluate(() => window.ocean.dispatch({ type: "select_clips", clipIds: ["c2"] }));
await p.keyboard.press("Delete");
await new Promise((r) => setTimeout(r, 150));
const afterDel = await v1count();
console.log(`DELETE: v1 clips ${beforeDel} -> ${afterDel} ${afterDel === beforeDel - 1 ? "✓ removed" : "✗ not removed"}`);

console.log("all pageerrors:", errs.length ? errs.join(" | ") : "(none)");
await b.close();
