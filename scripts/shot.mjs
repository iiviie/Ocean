import puppeteer from "puppeteer-core";
const b = await puppeteer.launch({ executablePath: "/usr/bin/chromium", headless: "new", args: ["--no-sandbox"] });
const p = await b.newPage();
await p.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
const errs = [];
p.on("pageerror", (e) => errs.push(e.message));
await p.goto("http://localhost:5173/", { waitUntil: "networkidle0" });
await new Promise((r) => setTimeout(r, 700));
// select a clip so the inspector + slider show
await p.evaluate(() => {
  const clip = [...document.querySelectorAll('[title="c1"]')][0];
  clip?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
});
await new Promise((r) => setTimeout(r, 300));
await p.screenshot({ path: "/tmp/ocean-ui.png" });
console.log("errors:", errs.length ? errs.join("\n") : "(none)");
await b.close();
