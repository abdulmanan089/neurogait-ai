// Builds the static GitHub Pages site (a static-only host) from `bun run build` output.
// Usage: GITHUB_PAGES_BASE=/repo/ bun scripts/render-static.mjs <outDir>
//
// 1. Preferred: render each page with the built server bundle. Tries the
//    subpath URL first, then the root URL; root-rendered HTML gets its
//    asset/link paths rewritten to include the base.
// 2. Fallback: write a SPA shell (#root + CSS + entry script) from <outDir>/assets.
// Always writes index.html, 404.html and .nojekyll; exits 0 when they exist.
import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const rawBase = (process.env.GITHUB_PAGES_BASE || "/").replace(/^\/+|\/+$/g, "");
const base = rawBase ? `/${rawBase}/` : "/";
const out = process.argv[2] || "site";
const PAGES = ["", "assess", "auth"];

console.log(`[pages] base=${base} out=${out}`);

function write(page, html) {
  const dir = join(out, page);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "index.html"), html);
  console.log(`[pages] wrote ${join(dir, "index.html")}`);
  if (page === "") {
    writeFileSync(join(out, "404.html"), html);
    console.log(`[pages] wrote ${join(out, "404.html")}`);
  }
}

// Prefix root-relative src/href values with the base unless already present.
function rebase(html) {
  if (base === "/") return html;
  const b = base.slice(0, -1); // "/repo"
  return html.replace(/(\s(?:src|href)=["'])\/(?!\/)([^"']*)/g, (m, pre, rest) =>
    `/${rest}`.startsWith(base) || `/${rest}` === b ? m : `${pre}${base}${rest}`,
  );
}

function withTimeout(p, ms) {
  return Promise.race([
    p,
    new Promise((_, rej) => {
      const t = setTimeout(() => rej(new Error("render timeout")), ms);
      t.unref?.();
    }),
  ]);
}

async function renderWithServer() {
  const entry = join(process.cwd(), "dist/server/index.mjs");
  if (!existsSync(entry)) throw new Error("server bundle not found at dist/server/index.mjs");
  const mod = await import(pathToFileURL(entry).href);
  const handler = mod.default ?? mod;
  if (typeof handler.fetch !== "function") throw new Error("server bundle has no fetch handler");
  const ctx = { waitUntil() {}, passThroughOnException() {} };
  const pages = {};
  for (const page of PAGES) {
    const tries = [
      { url: `http://localhost${base}${page}`, needsRebase: false },
      { url: `http://localhost/${page}`, needsRebase: true },
    ];
    let done = false;
    for (const t of tries) {
      try {
        const res = await withTimeout(handler.fetch(new Request(t.url), {}, ctx), 15000);
        const html = await res.text();
        console.log(`[pages] GET ${t.url} -> ${res.status}`);
        if (res.status === 200 && html.includes("<html")) {
          pages[page] = t.needsRebase ? rebase(html) : html;
          done = true;
          break;
        }
      } catch (err) {
        console.log(`[pages] GET ${t.url} failed: ${err?.message ?? err}`);
      }
    }
    if (!done) throw new Error(`could not render /${page}`);
  }
  return pages;
}

function shell() {
  const dir = join(out, "assets");
  const assets = existsSync(dir) ? readdirSync(dir) : [];
  const js = assets.filter((f) => /^index-[\w-]+\.js$/.test(f));
  const css = assets.filter((f) => f.endsWith(".css"));
  console.log(`[pages] shell assets: ${css.length} css, ${js.length} js`);
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
  <body><div id="root"></div></body>
</html>
`;
}

mkdirSync(out, { recursive: true });

// Best effort: a crash here must never leave the deploy without pages.
let rendered = false;
try {
  const pages = await renderWithServer();
  for (const page of PAGES) write(page, pages[page]);
  rendered = true;
  console.log("[pages] rendered pages with the built app");
} catch (err) {
  console.warn(`::warning:: full render unavailable (${err?.message ?? err}); writing SPA shell instead`);
}

if (!rendered) {
  try {
    const html = shell();
    for (const page of PAGES) write(page, html);
    console.warn("::warning:: served pages are the plain SPA shell, not the rendered app");
  } catch (err) {
    console.error(`[pages] shell generation failed: ${err?.message ?? err}`);
  }
}

try {
  writeFileSync(join(out, ".nojekyll"), "");
} catch (err) {
  console.error(`[pages] could not write .nojekyll: ${err?.message ?? err}`);
}

let ok = true;
for (const f of ["index.html", "404.html", ".nojekyll"]) {
  const present = existsSync(join(out, f));
  console.log(`[pages] check ${out}/${f}: ${present ? "ok" : "MISSING"}`);
  if (!present) ok = false;
}
if (!ok) process.exit(1);
console.log(`[pages] static site ready in ${out}/ (base ${base})`);
process.exit(0);

