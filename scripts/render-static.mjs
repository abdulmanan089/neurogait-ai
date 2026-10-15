// Builds the static GitHub Pages site (a static-only host) from `bun run build` output.
// Usage: GITHUB_PAGES_BASE=/repo/ bun scripts/render-static.mjs <outDir>
//
// 1. Preferred: render each page with the built app so the HTML is complete.
// 2. Fallback: if that fails for any reason, write a plain SPA shell that loads
//    the hashed client entry + CSS from <outDir>/assets. Never exits non-zero
//    while the client assets exist.
import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const rawBase = process.env.GITHUB_PAGES_BASE || "/";
const base = `/${rawBase.replace(/^\/+|\/+$/g, "")}/`.replace(/^\/\/$/, "/");
const out = process.argv[2] || "site";
const PAGES = ["", "assess", "auth"];

function write(page, html) {
  const dir = join(out, page);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "index.html"), html);
  if (page === "") writeFileSync(join(out, "404.html"), html); // SPA fallback
}

async function renderWithServer() {
  const entry = join(process.cwd(), "dist/server/index.mjs");
  if (!existsSync(entry)) throw new Error("server bundle not found");
  const mod = await import(pathToFileURL(entry).href);
  const handler = mod.default ?? mod;
  const ctx = { waitUntil() {}, passThroughOnException() {} };
  const pages = {};
  for (const page of PAGES) {
    const res = await Promise.race([
      handler.fetch(new Request(`http://localhost${base}${page}`), {}, ctx),
      new Promise((_, rej) => setTimeout(() => rej(new Error("render timeout")), 15000).unref?.()),
    ]);
    const html = await res.text();
    if (res.status !== 200 || !html.includes("<html")) throw new Error(`/${page} rendered ${res.status}`);
    pages[page] = html;
  }
  return pages;
}

function shell() {
  const assets = existsSync(join(out, "assets")) ? readdirSync(join(out, "assets")) : [];
  const js = assets.filter((f) => /^index-[\w-]+\.js$/.test(f));
  const css = assets.filter((f) => f.endsWith(".css"));
  const tags = [
    ...css.map((f) => `<link rel="stylesheet" href="${base}assets/${f}">`),
    ...js.map((f) => `<script type="module" src="${base}assets/${f}"></script>`),
  ].join("\n    ");
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>NeuroGait AI</title>
    <meta name="description" content="Multimodal motor and vocal screening research tool.">
    <link rel="icon" href="${base}favicon.ico">
    ${tags}
  </head>
  <body></body>
</html>
`;
}

mkdirSync(out, { recursive: true });
try {
  const pages = await renderWithServer();
  for (const page of PAGES) write(page, pages[page]);
  console.log("rendered pages with the built app");
} catch (err) {
  console.warn(`full render unavailable (${err?.message ?? err}); writing SPA shell instead`);
  const html = shell();
  for (const page of PAGES) write(page, html);
}
writeFileSync(join(out, ".nojekyll"), "");

for (const f of ["index.html", "404.html", ".nojekyll"]) {
  if (!existsSync(join(out, f))) {
    console.error(`missing ${out}/${f}`);
    process.exit(1);
  }
}
console.log(`static site ready in ${out}/ (base ${base})`);
process.exit(0);
