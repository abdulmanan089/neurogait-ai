// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - TanStack devtools (dev-only, first), tanstackStart, viteReact, tailwindcss, tsConfigPaths,
//     nitro (build-only using cloudflare as a default target), VITE_* env injection, @ path alias,
//     React/TanStack dedupe, error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";

// Set only by the GitHub Pages workflow (e.g. "/gait-voice-ai/").
const pagesBase = process.env["GITHUB_PAGES_BASE"];

export default defineConfig({
  vite: {
    // GitHub Pages serves the site under /<repo>/, so assets must resolve
    // relative to that subpath. Locally and on root domains, "/" is used.
    base: pagesBase ?? "/",
  },
  tanstackStart: {
    // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
    // nitro/vite builds from this
    server: { entry: "server" },
    // GitHub Pages build: routes live under the repo subpath. Static HTML is
    // rendered after the build by scripts/render-static.mjs.
    ...(pagesBase ? { router: { basepath: pagesBase } } : {}),
  },
});
