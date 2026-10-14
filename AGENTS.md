<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

# NeuroGait Vision architecture
- All capture and analysis runs client-side (src/lib/neuro/*); only the numeric feature vector (src/lib/neuro/cloud.ts) is upserted to the Cloud `assessments` table under owner-only RLS — raw audio/video/landmarks never leave the browser.
- The assessment wizard lives under the _authenticated route gate (/assess); / is a public landing and /auth handles sign-in.
- Live-capture quality gates (src/lib/neuro/quality.ts) must pass before starting and before submitting each test; simulated input bypasses them.
- PDF export is generated from data with jspdf (src/lib/neuro/pdf.ts), not from a DOM screenshot, for clean pagination.
- Motor, voice and oculomotor modules share one analysis pipeline for live and simulated input (simulators emit landmarks/audio fed to the same analyzers) so fallback mode exercises real code paths.
- MediaPipe tasks-vision is dynamically imported inside the camera start handler; wasm URL version must match the installed package version.
- Numeric DSP files use // @ts-nocheck because noUncheckedIndexedAccess adds noise to bounds-checked loops; keep UI/scoring files fully typed.
- Sessions persist in localStorage (key neurogait.sessions.v1), read only in useEffect to avoid hydration mismatch.
