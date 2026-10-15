// Renders the built app's pages to static HTML for GitHub Pages (static-only host).
// Usage: GITHUB_PAGES_BASE=/repo/ bun scripts/render-static.mjs <outDir>
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const base = process.env.GITHUB_PAGES_BASE || "/";
const out = process.argv[2] || "site";
const mod = await import(join(process.cwd(), "dist/server/index.mjs"));
const handler = mod.default ?? mod;
const ctx = { waitUntil() {}, passThroughOnException() {} };

for (const page of ["", "assess", "auth"]) {
  const res = await handler.fetch(new Request(`http://localhost${base}${page}`), {}, ctx);
  if (res.status !== 200) throw new Error(`/${page} rendered ${res.status}`);
  const html = await res.text();
  const dir = join(out, page);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "index.html"), html);
  if (page === "") writeFileSync(join(out, "404.html"), html); // SPA fallback
  console.log(`wrote ${join(dir, "index.html")}`);
}
