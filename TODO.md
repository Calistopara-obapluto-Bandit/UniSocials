# Unisocials — Deploy To-Do List

## Goal
Commit pending feature changes and push to GitHub so Render auto-deploys the updated site.

## Steps
- [x] Analyze codebase & confirm deploy path (GitHub `main` → Render auto-deploy via render.yaml).
- [x] Confirm commit strategy (Option A: commit & push as-is; secrets already in history).
- [x] Verify `data/` (buyer PII) stays gitignored (not committed).
- [x] Stage the 5 modified files.
- [x] Commit with a descriptive deploy message.
- [ ] Push `main` to GitHub (triggers Render auto-deploy).
- [ ] Confirm push reached `origin/main`.
