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
- All capture and analysis runs client-side (src/lib/neuro/*, src/components/neuro/*); no backend — keeps patient audio/video on-device.
- Motor, voice and oculomotor modules share one analysis pipeline for live and simulated input (simulators emit landmarks/audio fed to the same analyzers) so fallback mode exercises real code paths.
- MediaPipe tasks-vision is dynamically imported inside the camera start handler; wasm URL version must match the installed package version.
- Numeric DSP files use // @ts-nocheck because noUncheckedIndexedAccess adds noise to bounds-checked loops; keep UI/scoring files fully typed.
- Sessions persist in localStorage (key neurogait.sessions.v1), read only in useEffect to avoid hydration mismatch.
