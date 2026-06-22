import puppeteer from "puppeteer-core";
const b = await puppeteer.launch({ executablePath: "/usr/bin/chromium", headless: "new", args: ["--no-sandbox"] });
const p = await b.newPage();
await p.setViewport({ width: 1440, height: 900 });
const errs = [];
p.on("pageerror", (e) => errs.push(e.message));
await p.goto("http://localhost:5173/", { waitUntil: "networkidle0" });
await new Promise((r) => setTimeout(r, 700));

const tcBefore = await p.$eval(".font-mono", (el) => el.textContent);

// click on the ruler ~40% across to seek
const box = await p.evaluate(() => {
  const ruler = document.querySelector(".cursor-ew-resize");
  const r = ruler.getBoundingClientRect();
  return { x: r.left + r.width * 0.4, y: r.top + r.height / 2 };
});
await p.mouse.click(box.x, box.y);
await new Promise((r) => setTimeout(r, 200));
const tcAfter = await p.$eval(".font-mono", (el) => el.textContent);

// double-click a media tile to add a clip
const tracksBefore = await p.evaluate(() => window.ocean.get_project().tracks);
await p.evaluate(() => {
  const tile = document.querySelector('[title^="intro.mp4"]');
  tile?.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
});
await new Promise((r) => setTimeout(r, 200));
const proj = await p.evaluate(() => window.ocean.get_project());

console.log("seek: timecode", tcBefore, "->", tcAfter, tcBefore !== tcAfter ? "✓ MOVED" : "✗ no change");
console.log("double-click add: tracks", tracksBefore, "->", proj.tracks);
console.log("pageerrors:", errs.length ? errs.join("\n") : "(none)");
await p.screenshot({ path: "/tmp/ocean-func.png" });
await b.close();
