// One-shot: migrate our custom Tailwind token class names to the shadcn token
// convention across the renderer. Ordered to avoid prefix collisions.
import { readdirSync, readFileSync, writeFileSync, statSync } from "node:fs";
import { join } from "node:path";

const files = [];
(function walk(dir) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p);
    else if (/\.(tsx?|css)$/.test(e) && !p.endsWith("global.css")) files.push(p);
  }
})("src/ui");

const reps = [
  [/accent-soft/g, "__ACCENTSOFT__"], // protect
  [/text-accent\b/g, "text-primary"],
  [/bg-accent\b/g, "bg-primary"],
  [/ring-accent/g, "ring-primary"],
  [/border-accent/g, "border-primary"],
  [/accent\//g, "primary/"],
  [/bg-surface-2\b/g, "bg-muted"],
  [/to-surface-2\b/g, "to-muted"],
  [/bg-surface\b/g, "bg-card"],
  [/from-elevated\b/g, "from-secondary"],
  [/bg-elevated\b/g, "bg-secondary"],
  [/bg-hover\b/g, "bg-accent"],
  [/text-fg\b/g, "text-foreground"],
  [/text-muted\b/g, "text-muted-foreground"],
  [/bg-bg\b/g, "bg-background"],
  [/text-danger\b/g, "text-destructive"],
  [/bg-danger\b/g, "bg-destructive"],
  [/border-danger\b/g, "border-destructive"],
  [/danger\//g, "destructive/"],
  [/__ACCENTSOFT__/g, "accent-soft"], // restore
];

let changed = 0;
for (const f of files) {
  const before = readFileSync(f, "utf8");
  let after = before;
  for (const [re, to] of reps) after = after.replace(re, to);
  if (after !== before) {
    writeFileSync(f, after);
    changed++;
    console.log("migrated", f);
  }
}
console.log(`done: ${changed} files`);
